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

## Next (in order)
1. **Racing** — start countdown, lap timer, per-tile checkpoints (no shortcuts), results screen,
   online leaderboard via Supabase (`submitLapTime` / `getLeaderboard` already exist).
2. **Deploy** — GitHub repo + Cloudflare Pages or Netlify, public URL, Supabase keys as env vars.

## Later
3. **Original tracks** — load the six original `.TRK` files locally (DEFAULT, BERNIES, CHERRIS,
   HELENS, JOES, SKIDS); import any `.TRK` from disk.
4. **Collisions** — solid ramp/elevated side walls, hill sides, gantry, buildings and scenery
   (crash on hard hits, like the original).
5. **More track pieces** (measured from the original shapes): banked roads/corners, corkscrews,
   pipes and half-pipes, tunnels, bridges, chicanes, split corners, slalom, highway, crossroads,
   buildings (gas station, barn, office, windmill, ship, diner), coasts and angled hill slopes.
6. **Car looks** — our own low-poly model per car class (wedge supercar, 4x4, rally hatch,
   prototype racer, open-wheel racer) and a car selection screen.
7. **Track editor** — 30×30 grid editor like the original; save/share tracks via Supabase.
8. **Replays and ghosts** — the deterministic simulation already allows input-log replays.
9. **Sound** — engine pitch from rpm, skids, crash.
10. **AI opponents** following the track path.
11. **Manual gearbox** (the original offers auto or manual).
12. **Server-side lap validation** — re-simulate submitted input logs in a Supabase Edge Function.

## Principles
- Faithful to the original: check mechanics on wiki.stunts.hu and measurements in the original
  files; compare against screenshots.
- Own assets only: original files are read locally for measurements and never committed or shipped.
- Deterministic simulation (fixed 60 Hz, pure functions of input) so replays and validation work.
