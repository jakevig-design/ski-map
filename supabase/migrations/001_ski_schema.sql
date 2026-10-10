-- Ski map tables. Prefixed ski_ in public, like every other app in this shared
-- Supabase project (centcom_, fitness_, bm_…), rather than a separate schema:
-- that would need adding to the API's exposed schemas by hand. See DECISIONS.md.
-- Anyone can read; only jakevig@gmail.com can write. RLS is the lock — the
-- editor UI appearing only when signed in is cosmetic.

create table if not exists public.ski_mountains (
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

create table if not exists public.ski_trips (
  id           bigint generated always as identity primary key,
  mountain_id  bigint not null references public.ski_mountains(id) on delete cascade,
  year         int check (year between 1970 and 2100),   -- null = not entered yet
  with_h       boolean not null default false,           -- stored, hidden in UI for now
  with_m       boolean not null default false,           -- stored, hidden in UI for now
  note         text,
  created_at   timestamptz default now()
);
create index if not exists ski_trips_mountain_id on public.ski_trips (mountain_id);

alter table public.ski_mountains enable row level security;
alter table public.ski_trips     enable row level security;

drop policy if exists "public read mountains" on public.ski_mountains;
drop policy if exists "public read trips"     on public.ski_trips;
create policy "public read mountains" on public.ski_mountains for select using (true);
create policy "public read trips"     on public.ski_trips     for select using (true);

drop policy if exists "owner write mountains" on public.ski_mountains;
drop policy if exists "owner write trips"     on public.ski_trips;
create policy "owner write mountains" on public.ski_mountains for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jakevig@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jakevig@gmail.com');
create policy "owner write trips" on public.ski_trips for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jakevig@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jakevig@gmail.com');

grant select on public.ski_mountains, public.ski_trips to anon, authenticated;
grant insert, update, delete on public.ski_mountains, public.ski_trips to authenticated;
revoke insert, update, delete on public.ski_mountains, public.ski_trips from anon;
