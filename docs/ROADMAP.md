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
      from the local files, five signs; Track as a simple list, Option box, Escape opens it)
- [x] Car selection like the original's showroom: car turning on the stage, acceleration graph,
      the original description, Done/Next/Last/Auto-Manual/Color; manual gearbox (A up, Z down)

## Next (in order)
2a. **Import any `.TRK` from disk** (file picker; leaderboard keyed by track content).
5. Digital speed readouts in the cockpits that have them.
6. **Deploy** — GitHub repo + Cloudflare Pages or Netlify, public URL, Supabase keys as env vars.

## Later
7. **Track editor** — 30×30 grid editor like the original; save/share tracks via Supabase.
8. **Replays and ghosts** — the deterministic simulation already allows input-log replays.
9. **Sound** — engine pitch from rpm, skids, crash.
10. **AI opponents** following the track path.
12. **Server-side lap validation** — re-simulate submitted input logs in a Supabase Edge Function.

## Open decisions
- **Original car files on the public site.** The game can show the original cars wherever the
  files are available (`public/original/` is shipped with a build). Whether to publish them is the
  owner's call; it must be revisited before any monetisation, where "players load their own
  Stunts files" or our own models are the safe options.

## Principles
- Faithful to the original: check mechanics on wiki.stunts.hu and measurements in the original
  files; compare against screenshots.
- Original files stay out of the repo: they are read at runtime from the owner's local copy
  (measurements, car models, cockpits); our own stand-ins are used when they are absent.
- Deterministic simulation (fixed 60 Hz, pure functions of input) so replays and validation work.
