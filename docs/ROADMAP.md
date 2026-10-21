# Stunts Web — Roadmap

Goal: recreate the 1990 DOS game Stunts in the browser as faithfully as possible (look, feel, tracks),
with our own assets, deployed as a playable web page with online lap times.

## Done
- [x] Project setup: Vite + TypeScript + Three.js, tests, project skills (`.claude/skills/`)
- [x] TRK track format reader/writer, tile code tables
- [x] Supabase project + schema (`tracks`, `lap_times`) with row-level security, MCP access
- [x] Track rendering from tiles: roads, corners, ramps, elevated roads, loop, hills, water, scenery
- [x] Stunts-style planted car physics (constant braking, grip-limited sliding, rpm/gear engine, jumps)
- [x] Stunts look: flat-shaded VGA palette, cockpit view with dashboard, chase/free cameras, horizons
- [x] World rescaled to dimensions measured from the original files (`tools/stunts`), ramp/loop fixed
- [x] Smooth native resolution by default (P cycles retro modes)
- [x] Real car handling: the 11 original cars converted from `CAR*.RES` (simulated top speeds within
      ~6% of the originals' own figures); V cycles cars
- [x] Original car models and names, read at runtime from the local Stunts files (`src/original/`);
      own stand-in model when the files are absent
- [x] Original per-car cockpits (dashboard, roof, instruments, steering wheel, gear box) with live
      needles, steering dot and gear knob, read at runtime from the local Stunts files

- [x] Racing: route from the start line, lap clock (starts when the car moves), the original's
      shortcut penalty rules (wiki "Penalty time"), "Wrong Way", results screen with name entry,
      online top 10 via Supabase (each lap stores its input log for replays/validation later)

- [x] Original tracks: the six original `.TRK` files load from the local copy (T cycles tracks,
      own leaderboard each). Every piece code they use is understood; pieces we haven't modelled
      yet are plain stand-ins (see step 4); routes follow forks, crossroads and jumps over gaps;
      hill corners, coasts and roads on hills/slopes are built
- [x] Collisions: walls and objects from the original shapes; only the front of the car hitting
      steeper than ~30° crashes (glancing hits scrape, as in the original); landings crash on the
      angle, not the height; splashes
- [x] Original track pieces drawn and driven from the original shapes (pipes, pipe obstacle,
      highway, slalom, bridges, tunnels, banks, corkscrews, buildings...). Cars fly off crests,
      loops need speed. A test driver (`src/race/autopilot.ts`, `LAPS=1 npx vitest run
      src/track/originalLaps.test.ts`) laps all six original tracks without crash or penalty

- [x] Sound effects modelled on recordings of the original (engine, tyre squeal, crash, bump)
- [x] Crash sequence and evaluation screen like the original; main menu (the original's picture
      from the local files, five signs; Option box, Escape opens it)
- [x] Track selection like the original (overview of the track, fastest time, More Tracks list);
      finish screen in the evaluation style with name entry; the original explosion frames
- [x] The Corvette ZR1's digital speedometer (original digit bitmaps, lit segments over the display)
- [x] Replays like the original: the run's inputs re-simulated; replay panel (original pictures),
      play / fast play / rewind / fast forward, cameras Inside, Overhead, Track cams, Manual; replay
      menu with Continue Driving from any point; Escape mid-race opens it; View Replay works
- [x] Save/Load REPLAY (kept in the browser), ghost car of the track's fastest stored lap
      (Option menu / G); the lap clock no longer starts while the car settles on the line
- [x] Car selection like the original's showroom: car turning on the stage, acceleration graph,
      the original description, Done/Next/Last/Auto-Manual/Color; manual gearbox (A up, Z down)
- [x] Track editor like the original (Track select → New/Edit Tracks), laid out from its screen and
      drawn with its own icons and font from the player's files: the 12×11 track window, the ten
      palette pages with every orientation, page bar, Horizon/Load/New (five terrain backgrounds)/
      Save/Done, its keyboard and mouse controls, placement rules and its full track check (terrain
      edges, one start/finish, joins, wrong way, jumps, a complete lap); tracks saved in
      the browser as TRK bytes and listed with the others (no online times for them)

- [x] Computer opponents like the original's (main menu → Opponent): the six drivers from the
      player's files, their bios and photos, Last/Next/Clock/Car/Done, their car from the showroom;
      they race beside you with their own speed table and weak spots (learnt per track before the
      race), cars collide, and afterwards their win/lose animation and lines; in replays too

- [x] Deploy: GitHub Pages via GitHub Actions on every push to main (public repo), with the original
      files the game reads published in `public/original/` (owner's decision)

## Next (in order)

## Later
11. **Sign-in** so shared tracks have owners (edit or delete your own; limits against flooding).
12. **Server-side lap validation** — re-simulate submitted input logs in a Supabase Edge Function.

## Open decisions
- **Original files on the public site.** Published by the owner's decision (2026-10-18). Must be
  revisited before any monetisation, where "players load their own Stunts files" or our own assets
  are the safe options.

## Principles
- Faithful to the original: check mechanics on wiki.stunts.hu and measurements in the original
  files; compare against screenshots.
- Original files are read at runtime: the owner's local copy in development, the published
  `public/original/` (only the files the game reads) on the site; our own stand-ins when absent.
- Deterministic simulation (fixed 60 Hz, pure functions of input) so replays and validation work.
