-- Tracks made in the editor, shared with every device. Until there is sign-in: anyone may add a
-- track (ids 'user-<uuid>', the TRK file required, size capped), nobody can change or delete one
-- (so nobody can overwrite someone else's). Their lap times work like any track's.

alter table public.tracks drop constraint if exists tracks_trk_size;
alter table public.tracks add constraint tracks_trk_size
  check (trk_base64 is null or char_length(trk_base64) <= 4000);

drop policy if exists "anyone can share a track" on public.tracks;
create policy "anyone can share a track" on public.tracks for insert to anon, authenticated
  with check (
    id like 'user-%'
    and char_length(id) <= 60
    and trk_base64 is not null
  );

create index if not exists tracks_created_idx on public.tracks (created_at desc);
