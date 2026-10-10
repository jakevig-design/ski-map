# Decisions

Choices the spec left open, and the places this build departs from it.

## Departures from the spec

- **Public app, no private lock.** Jake's jvtestspace.com sites are each either public or private (private ones are gated at Vercel's edge). This one is public: anyone can read the map, the repo is public, and it's listed on jvtestspace.com. The editor isn't a private area — it's just write access, limited to Jake by RLS.
- **Tables `public.ski_mountains` / `public.ski_trips`, not a `ski` schema.** Every app in the shared Supabase project (centcom, fitness, warp) uses prefixed tables in `public`. A separate schema would need adding to the API's exposed schemas in the dashboard by hand; prefixes need nothing. Columns, constraints and policies are as specified.
- **Google sign-in, not email magic link, and public sign-ups stay on.** The Supabase project is shared with centcom, fitness and the music player, which all use Google sign-in. Turning off sign-ups is project-wide and would stop any new account signing in to those apps. It isn't needed here either: the write policies check for `jakevig@gmail.com`, so any other account that signs in can still only read. `/login` shows one "Sign in with Google" button.
- **Polygon centroids are planar.** d3's `geoCentroid` treats OpenSkiMap's polygon winding as "the whole globe minus this ring" and returns points on the far side of the Earth, so `build-ski-areas.mjs` uses an area-weighted planar centroid of the largest ring. Ski areas are small enough for that to be exact in practice.
- **OpenSkiMap field names.** The spec reads `properties.location.iso3166_1Alpha2` / `iso3166_2`; the current export has them under `properties.places[0]`. The script accepts either.

## Choices

- **Geometry detail:** simplified to 11% with `keep-shapes`: 152 + 139 + 192 = 482 KB, under the 600 KB budget, crisp at 10×.
- **Background areas:** 854 after filtering (578 US, 275 CA, 1 MX). That's under the spec's 1,500 threshold for canvas, so they're SVG, which also gives free hit-testing. Each has an invisible larger hit circle so the small triangles are easy to tap.
- **Background labels** (zoom ≥ 5) join the same collision pass as Jake's labels, after them, so they never cover his.
- **Seeding is idempotent:** `002_seed.sql` skips mountains that already exist by name, and trips for mountains that already have some, so re-running it does nothing.
- **OpenSkiMap matching:** all 29 seeded mountains matched within 8 km (farthest: Park City, 3.9 km; Whistler Blackcomb, 3.7 km). Names match when they share a distinctive word (ignoring "ski", "resort", "mountain"…). None were left unmatched.
- **Year inputs save as you type**, once the value is a valid year (1970–2100); clearing the field sets it back to "Year TBD". A trip's input is disabled for the moment its insert is in flight.
- **Writes** confirm with `.select().single()`, so an update RLS silently ignores (0 rows) counts as a failure and rolls back, the same as an outright error.
- **Status list order:** within a region, skied, then planned, then wishlist.
- **Search** covers Jake's mountains and background areas, his first; diacritics are ignored ("tremblant" finds "Mont-Tremblant").
- **Fly-to on phones** centres the target a little lower, so the card at the top doesn't cover it.
- **Region names** come from a built-in table of US states, Canadian provinces and Mexican states (`src/lib/regions.ts`).
- **No `confirm()`:** deleting a trip or removing a mountain asks inline (Delete / Keep).
- **Signed in as someone other than Jake:** the rail shows "Signed in · Sign out" and no editor.
