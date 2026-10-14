-- Leaderboards for the six tracks that ship with the original game. Only the ids and names are
-- stored; the track data itself is read from the player's own Stunts files.
insert into public.tracks (id, name, author) values
  ('orig-default', 'Default', 'Stunts (1990)'),
  ('orig-bernies', 'Bernies', 'Stunts (1990)'),
  ('orig-cherris', 'Cherris', 'Stunts (1990)'),
  ('orig-helens', 'Helens', 'Stunts (1990)'),
  ('orig-joes', 'Joes', 'Stunts (1990)'),
  ('orig-skids', 'Skids', 'Stunts (1990)')
on conflict (id) do nothing;

update public.tracks set name = 'Demo circuit' where id = 'default';
