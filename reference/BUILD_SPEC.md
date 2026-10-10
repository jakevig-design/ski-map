# Ski Map: Claude Code Build Spec

Build a public, read-only map of every ski area Jake has skied, with a private editor that only Jake can use. It is a digital version of his framed, pinned "Ski Areas" posters.

- **Live URL:** https://ski.jvtestspace.com
- **Repo:** `jakevig-design/ski-map` (GitHub)
- **Stack:** Vite + React + TypeScript, d3-geo for the map (SVG), Supabase (Postgres + Auth), Vercel
- **Visual reference:** `reference/mockup.html` (open it in a browser). Match its layout, palette, type and interactions unless this spec says otherwise.

---

## 0. Autonomy instructions (read first)

- Build this end to end without stopping. Do not ask for confirmation between steps or phases.
- Make reasonable decisions on anything this spec leaves open and record each one in `DECISIONS.md` at the repo root.
- If a step is blocked (missing credential, external service down), skip only that step, log it in `BLOCKERS.md` with the exact manual action needed, and keep going with everything else.
- Report blockers once, at the end, not mid-build.
- Never ask for or print the Supabase service role key or JWT secret. Nothing in this build needs them. Schema and seed go through SQL migrations.
- Commit after each numbered section with a clear message. Push to `main`.

### Permissions

Create `.claude/settings.json` in the repo so these run without prompts:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(git:*)",
      "Bash(gh:*)", "Bash(supabase:*)", "Bash(vercel:*)", "Bash(curl:*)",
      "Bash(mkdir:*)", "Bash(ls:*)", "Bash(cp:*)", "Bash(mv:*)"
    ]
  }
}
```

---

## 1. Repo and scaffold

1. Create `jakevig-design/ski-map` with `gh repo create` (public is fine, no secrets live in the repo).
2. Scaffold Vite + React + TS. Dependencies: `d3`, `topojson-client`, `@supabase/supabase-js`. Dev dependencies: `mapshaper`, `@types/d3`, `@types/topojson-client`.
3. Copy the provided `mockup.html` to `reference/mockup.html`.
4. Add `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Only the anon key is used client side.

---

## 2. Map data (build-time scripts, output committed)

All map data is static JSON committed under `public/data/`. No tile server and no API keys.

### 2a. Base geography: `scripts/build-geo.mjs`

Download these from `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/`:
- `ne_10m_land.geojson`
- `ne_10m_admin_1_states_provinces_lakes.geojson`
- `ne_10m_lakes.geojson`

Process them with mapshaper:
- Land: clip to bbox `-180,10,-40,80`.
- Admin-1: keep `iso_a2` in US, CA, MX; keep only the `iso_a2`, `name` and `postal` fields.
- Lakes: clip to bbox `-140,25,-60,62`; keep `scalerank <= 6`.
- Simplify each layer to a size that keeps coastlines crisp at zoom 10x. The target is under 600 KB total for all three files. Use `keep-shapes`.
- Write TopoJSON to `public/data/land.json`, `admin.json` and `lakes.json`, quantization 1e5.

The mockup used the 50m versions. The 10m versions are there so coastlines and lakes stay sharp when zoomed in.

### 2b. All North American ski areas: `scripts/build-ski-areas.mjs`

- Source: OpenSkiMap, `https://tiles.openskimap.org/geojson/ski_areas.geojson` (data is OpenStreetMap, ODbL).
- Keep features where:
  - `properties.type === "skiArea"`
  - `properties.activities` includes `"downhill"`
  - `properties.status` is `"operating"` or missing
  - the country is US, CA or MX, taken from `properties.location.iso3166_1Alpha2`
- Reduce each feature to `{ id, name, lat, lon, region }`:
  - Use a point geometry as-is. For a polygon, use its centroid.
  - `region` is the state or province postal code, from `properties.location.iso3166_2` (for example `US-VT` becomes `VT`).
- Drop features with no name.
- Write to `public/data/ski-areas.json`.
- If the URL fails, log it in `BLOCKERS.md`, write an empty array, and continue. The app must work with only Jake's pins.

---

## 3. Supabase

Use Jake's existing personal Supabase project. Do not create a new project; the free plan caps active projects. Put everything in a dedicated schema called `ski`, and expose that schema in the API settings. If the project ref is not in the environment, log it as a blocker and finish everything else.

### 3a. Migration: `supabase/migrations/001_ski_schema.sql`

```sql
create schema if not exists ski;

create table ski.mountains (
  id            bigint generated always as identity primary key,
  name          text not null,
  region        text not null,          -- postal code: VT, QC, BC...
  country       text not null,          -- US, CA, MX
  lat           double precision not null,
  lon           double precision not null,
  status        text not null check (status in ('skied','planned','wishlist')),
  openskimap_id text unique,
  created_at    timestamptz default now()
);

create table ski.trips (
  id           bigint generated always as identity primary key,
  mountain_id  bigint not null references ski.mountains(id) on delete cascade,
  year         int check (year between 1970 and 2100),   -- null = not entered yet
  with_h       boolean not null default false,           -- stored, hidden in UI for now
  with_m       boolean not null default false,           -- stored, hidden in UI for now
  note         text,
  created_at   timestamptz default now()
);

alter table ski.mountains enable row level security;
alter table ski.trips     enable row level security;

-- Public can read
create policy "public read mountains" on ski.mountains for select using (true);
create policy "public read trips"     on ski.trips     for select using (true);

-- Only Jake can write
create policy "owner write mountains" on ski.mountains for all
  using ((auth.jwt() ->> 'email') = 'jakevig@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jakevig@gmail.com');
create policy "owner write trips" on ski.trips for all
  using ((auth.jwt() ->> 'email') = 'jakevig@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jakevig@gmail.com');

grant usage on schema ski to anon, authenticated;
grant select on all tables in schema ski to anon, authenticated;
grant insert, update, delete on all tables in schema ski to authenticated;
grant usage on all sequences in schema ski to authenticated;
```

### 3b. Seed: `supabase/migrations/002_seed.sql`

These are the 26 skied and 3 planned mountains. Coordinates are approximate. After seeding, run `scripts/match-openskimap.mjs`, which:
- matches each seeded mountain to the nearest `ski-areas.json` entry within 8 km with a similar name,
- writes a follow-up migration `003_openskimap_ids.sql` that sets `openskimap_id` and snaps `lat`/`lon` to the OpenSkiMap point,
- lists any mountain with no match in `DECISIONS.md` and leaves it as seeded.

Every skied mountain gets one trip with `year = null`, except Tremblant, which gets three. Planned mountains get no trips. Do not invent years. Jake fills them in through the editor.

| Name | Region | Country | Lat | Lon | Status | Trips |
|---|---|---|---|---|---|---|
| Tremblant | QC | CA | 46.209 | -74.585 | skied | 3 |
| Whiteface | NY | US | 44.366 | -73.903 | skied | 1 |
| Gore | NY | US | 43.673 | -74.006 | skied | 1 |
| West Mountain | NY | US | 43.287 | -73.716 | skied | 1 |
| Hunter | NY | US | 42.203 | -74.226 | skied | 1 |
| Okemo | VT | US | 43.401 | -72.717 | skied | 1 |
| Ascutney | VT | US | 43.432 | -72.450 | skied | 1 |
| Sugarloaf | ME | US | 45.031 | -70.313 | skied | 1 |
| Sunday River | ME | US | 44.473 | -70.857 | skied | 1 |
| Butternut | MA | US | 42.183 | -73.322 | skied | 1 |
| Elk Mountain | PA | US | 41.722 | -75.557 | skied | 1 |
| Montage | PA | US | 41.356 | -75.659 | skied | 1 |
| Blue Mountain | PA | US | 40.811 | -75.513 | skied | 1 |
| Whistler Blackcomb | BC | CA | 50.115 | -122.949 | skied | 1 |
| Big Sky | MT | US | 45.284 | -111.401 | skied | 1 |
| Jackson Hole | WY | US | 43.588 | -110.828 | skied | 1 |
| Powder Mountain | UT | US | 41.379 | -111.781 | skied | 1 |
| Snowbasin | UT | US | 41.216 | -111.857 | skied | 1 |
| Park City | UT | US | 40.651 | -111.508 | skied | 1 |
| Alta | UT | US | 40.588 | -111.638 | skied | 1 |
| Snowbird | UT | US | 40.581 | -111.657 | skied | 1 |
| Steamboat | CO | US | 40.457 | -106.804 | skied | 1 |
| Winter Park | CO | US | 39.887 | -105.763 | skied | 1 |
| Vail | CO | US | 39.606 | -106.355 | skied | 1 |
| Telluride | CO | US | 37.937 | -107.846 | skied | 1 |
| Arizona Snowbowl | AZ | US | 35.331 | -111.711 | skied | 1 |
| Jay Peak | VT | US | 44.938 | -72.505 | planned | 0 |
| Mad River Glen | VT | US | 44.202 | -72.918 | planned | 0 |
| Killington | VT | US | 43.620 | -72.797 | planned | 0 |

### 3c. Auth

- Email magic link only. Turn off public signups in Auth settings so no one else can create an account.
- Add `https://ski.jvtestspace.com` and `http://localhost:5173` to the redirect URLs.
- RLS is the real lock. The UI hiding editor controls is cosmetic.

---

## 4. App

### 4a. Layout (match the mockup)

- **Desktop:** a full-bleed map on the left, with a 340px rail on the right.
- **Under 760px:** the map takes the top 62vh, and the rail stacks below it.
- **Title block:** sits over the water, bottom right of the map, and fades out when zoom > 1.6. Heading "SKI AREAS", subtitle "every mountain Jake has skied".
- **Zoom controls:** top right, with + / − / reset.

### 4b. Design tokens (from the mockup)

```
--water #8c9fa8   --land #eef0ea   --land-out #d9ddd6   --line #b9c1bb
--ink #26302f     --muted #66716f  --pin #c4283d        --plan #2f7d8c
--paper #f6f6f2   --rule #dfe2dc
Display: Zilla Slab 500/700 · UI: IBM Plex Sans Condensed · Numbers: IBM Plex Mono
```

The page uses a single light theme, on purpose, to keep the poster look. Load the fonts from Google Fonts.

### 4c. Map

- **Projection:** `d3.geoConicConformal().rotate([96,0]).parallels([33,60])`. The initial fit frames the lower 48 plus Whistler and Tremblant, using the mockup's `fitExtent` frame.
- **Layers, bottom to top:**
  1. water background
  2. land
  3. admin-1 (US filled `--land`; Canada and Mexico filled `--land-out`)
  4. lakes
  5. country borders (the mesh where `iso_a2` differs)
  6. background ski areas
  7. Jake's pins
- All strokes use `vector-effect: non-scaling-stroke`.
- **Background ski areas** (from `ski-areas.json`, minus any already in `ski.mountains` by `openskimap_id`): small hollow triangles in `--line`, no labels until zoom ≥ 5, then a muted label. This recreates the poster's "every ski area" texture. Render them on a `<canvas>` under the SVG if there are more than 1,500, for performance; hit-test on click.
- **Jake's pins:**
  - **Skied:** grey triangle with a red pin head (`--pin`).
  - **Planned:** pale triangle with a teal outline and teal head (`--plan`), italic teal label.
  - **Wishlist:** hollow triangle, ink outline, no head, italic muted label. The list starts empty, but support it.
- **Pin and label sizing:** the same scale curve as the mockup. Triangles scale by `k^0.25` while zooming, and labels by `k^0.2`.
- **Labels:** run greedy collision in screen space on every zoom.
  - Priority order: selected mountain, then trip count descending, then shorter names.
  - Try the right side first, then the left. Hide a label if both collide or it would leave the viewport.
  - Labels show the name, plus a red `N×` for trip counts above 1.
  - Years do not go on map labels.
- **Click behavior:** clicking a pin or a list row flies to it (750 ms, no animation under `prefers-reduced-motion`) and opens the card. Clicking empty map closes the card.
- **Attribution:** a small footer line in the rail: "Map data © OpenStreetMap contributors, OpenSkiMap, Natural Earth".

### 4d. Rail

- **Stats row:** Mountains (skied count), Trips (total trips at skied mountains), States & prov. (distinct regions among skied mountains).
- **Legend:** Skied / Planned (and Wishlist only if any exist).
- **Search box:** finds any ski area by name, Jake's or background. Selecting a result flies to it.
- **List:** grouped by region, ordered west to east by the group's average longitude.
  - The group header shows the full region name and its skied count.
  - Within a group, skied mountains come first, sorted by trip count descending, then by name. Planned and wishlist come after.
  - Each row shows the name on the left. On the right it shows the years as `2008 · 2011 · 2014` in mono, then a red `3×` if trips > 1. If no trip has a year, it shows muted "Year TBD". Planned rows show a "Planned" tag.

### 4e. Mountain card

**Public view:**
- Name, then the region full name.
- A big `N×` with "trip" or "trips".
- A list of trips sorted by year (nulls last), labeled "Trip 1, Trip 2…" with the year, or "Year TBD".
- Planned mountains show "0×" and "On the list".
- Background (unskied) mountains show "Not skied yet".

**Editor view** (signed in as Jake):
- Each trip's year becomes a number input (1970 to 2100), saved on change. Each trip row also gets a delete control that asks for confirmation inline. Don't use `confirm()`.
- "Add trip" inserts a trip with `year = null` and focuses its input.
- **Planned and wishlist mountains:**
  - "Mark as skied" opens an inline year input, defaulting to the current year. On save, it sets the status to `skied` and inserts the first trip with that year.
  - "Move to wishlist" or "Move to planned" switches between those two statuses.
  - "Remove" deletes the mountain.
- **Background mountains:** "Mark as skied", "Add to planned" and "Add to wishlist". Each one inserts into `ski.mountains`, copying `openskimap_id`, name, region, country, lat and lon.
- **Do not render `with_h` or `with_m` anywhere.** They stay in the schema for later.
- All writes are optimistic. Roll back and show an inline error if Supabase rejects the write.

### 4f. Auth UI

- Visiting `/login` shows a single email field that sends a magic link.
- Signed out, there is no editor UI at all and no visible login link.
- Signed in, the rail shows a small "Editing · Sign out" line at the bottom.

### 4g. Remove from the mockup

- The "Show sample years" toggle and all sample-year code.
- The "Editor view" checkbox. The real editor appears only when signed in.

---

## 5. Deploy

1. Create a Vercel project linked to the repo, and set both `VITE_` env vars for Production and Preview.
2. Add the domain `ski.jvtestspace.com` in Vercel.
3. DNS is on GoDaddy: add a CNAME `ski` → `cname.vercel-dns.com`. If you have no GoDaddy access, put this exact record in `BLOCKERS.md` as the one manual step.
4. Keep the app free of hard-coded host assumptions (use relative asset paths and a `VITE_SITE_URL` for auth redirects). It will move to jakevigner.com later.

---

## 6. Definition of done

- [ ] https://ski.jvtestspace.com loads the map with all 29 seeded mountains and the background ski areas (or an empty background, if OpenSkiMap was blocked and that's logged).
- [ ] Tremblant shows `3×` on the map and three "Year TBD" trips on its card.
- [ ] Signed out: no editor controls, and a direct Supabase insert with the anon key is rejected by RLS. Test this with a curl call and record the result in `DECISIONS.md`.
- [ ] Signed in as jakevig@gmail.com, setting a year persists after a hard refresh and appears in the list as a year.
- [ ] "Mark as skied" on Jay Peak turns it red, adds a trip with the chosen year, and updates the stats. Revert the test afterward so Jay Peak is planned again with no trips.
- [ ] A background mountain can be added as planned from its card, and that persists.
- [ ] Works at 400px width with no horizontal scroll.
- [ ] Lighthouse performance ≥ 85 on desktop.
- [ ] `DECISIONS.md` and `BLOCKERS.md` are committed.

---

## Out of scope (later phases, do not build)

- **Phase 2:** backfill trip years from a Google Timeline export, by matching visits to ski area coordinates.
- **Phase 3:** a Frame TV export, rendering the current map as a 3840×2160 PNG in poster style.
- **Later:** showing H and M (`with_h`, `with_m`), terrain hillshade, and moving to jakevigner.com.
