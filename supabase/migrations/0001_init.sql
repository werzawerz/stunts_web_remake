-- Stunts web: tracks + lap times. Run in Supabase dashboard → SQL Editor.

create table if not exists public.tracks (
  id text primary key,                       -- slug, e.g. 'default'
  name text not null check (char_length(name) between 1 and 40),
  author text not null default 'unknown' check (char_length(author) <= 40),
  trk_base64 text,                           -- 1802+ byte TRK, base64; null for built-in tracks shipped with the client
  created_at timestamptz not null default now()
);

create table if not exists public.lap_times (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references public.tracks(id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 20),
  car text not null check (char_length(car) between 1 and 30),
  time_ms integer not null check (time_ms between 1000 and 3600000),
  input_log_base64 text check (char_length(input_log_base64) <= 400000), -- replay inputs, validated later
  created_at timestamptz not null default now()
);

create index if not exists lap_times_track_time_idx on public.lap_times (track_id, time_ms);

alter table public.tracks enable row level security;
alter table public.lap_times enable row level security;

-- Anyone can read. Only lap times can be inserted anonymously; no updates/deletes from clients.
drop policy if exists "tracks are public" on public.tracks;
create policy "tracks are public" on public.tracks for select using (true);

drop policy if exists "lap times are public" on public.lap_times;
create policy "lap times are public" on public.lap_times for select using (true);

drop policy if exists "anyone can submit a lap" on public.lap_times;
create policy "anyone can submit a lap" on public.lap_times for insert to anon, authenticated with check (true);

insert into public.tracks (id, name, author) values ('default', 'Default', 'stunts-web')
on conflict (id) do nothing;
