# Blockers

Manual steps this build couldn't do itself. Each is a one-time setup.

## 1. Run the migrations (Supabase SQL editor)
No database access from the build machine. Paste `supabase/migrations/001_ski_schema.sql`, `002_seed.sql` and `003_openskimap_ids.sql`, in that order (one paste is fine), into the SQL editor of the shared project `xdmhyjofbbtmjqprjsxj`. Until then the map shows the background ski areas and a load error in the rail.

## 2. DNS for ski.jvtestspace.com (GoDaddy)
The domain is attached to the Vercel project but has no DNS record. In GoDaddy → jvtestspace.com → DNS, add:

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | `ski` | `cname.vercel-dns.com` | 1 hour |

Meanwhile the site is live at https://ski-map-eta.vercel.app.

## 3. Supabase redirect URL for sign-in
Supabase → Authentication → URL Configuration → Redirect URLs: add `https://ski.jvtestspace.com/**` (and `http://localhost:5173/**` for local editing). Without it, signing in at /login returns to the project's default site instead of the map.
