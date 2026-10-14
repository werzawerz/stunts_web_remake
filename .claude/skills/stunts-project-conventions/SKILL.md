---
name: stunts-project-conventions
description: Architecture, rules and workflows for this Stunts web remake (Vite + TypeScript + Three.js + Supabase). Covers folder layout, determinism rules for the simulation, coding conventions, test/build commands, DB schema and deploy. Use before writing or reviewing any code in this repo.
---

# Project conventions

## Stack
Vite + TypeScript (strict) · Three.js (rendering only) · Vitest · Supabase (`@supabase/supabase-js`) · static hosting (Cloudflare Pages / Netlify).

## Layout
```
src/
  main.ts               bootstrap + game state machine (menu → race → results)
  core/loop.ts          fixed-timestep loop, SIM_HZ = 60, render interpolates
  core/input.ts         keyboard → per-tick input bitmask
  track/constants.ts    TILE_METRES, HILL_HEIGHT, ...
  track/trkFormat.ts    parse/serialize TRK (pure, no DOM)
  track/tiles.ts        code → TileInfo {kind, surface, dir, footprint}
  track/trackBuilder.ts grid → { meshes (render), surfaces (physics), checkpoints }
  track/pieces/*.ts     one module per piece family; each exports render mesh + physics surface
  physics/              pure deterministic sim (car.ts, collision.ts, math)
  race/                 lap timer, checkpoints, penalties
  render/               Three.js scene, horizon, cameras
  ui/                   HTML overlay HUD and menus
  net/supabase.ts       only file that talks to Supabase
supabase/migrations/    SQL schema + RLS
public/tracks/          our own .trk files
```

## Determinism rules (simulation = `physics/`, `race/`, `track/` data)
- Pure functions of (state, input bitmask) per fixed tick `DT = 1/60`.
- No `Date`, `performance.now`, `Math.random`, no Three.js types, no DOM inside the sim.
- Use our own small vector math (`physics/vec.ts`), plain numbers; avoid order-dependent iteration over Maps/Sets.
- Replays = initial state + array of input bitmasks. A test asserts identical state hash for identical inputs.
- Rendering reads sim state and interpolates between previous and current tick.

## Input bitmask
bit0 throttle · bit1 brake/reverse · bit2 left · bit3 right · bit4 gear up · bit5 gear down · bit6 reset/restart.

## Coding conventions
- ES modules, named exports, no default exports. Small files; one piece family per file.
- Comments explain *why* (e.g. a Stunts quirk we reproduce), not what.
- Units: metres, seconds, radians, km/h only in UI.

## Commands
- `npm run dev` — local dev server
- `npm run test` — Vitest
- `npm run build` / `npm run preview` — production build check
- `npm run typecheck` — `tsc --noEmit`

## Seeing the game (visual verification)
Claude can look at the running game itself with headless Chromium (software WebGL):
1. `npm run dev -- --port 5173 --strictPort` (background).
2. `node tools/shot.mjs <out.png> [url] [key:holdMs,...] [waitMs]`, then Read the PNG. Page console output and errors are printed.
3. Camera pose via URL: `?cam=x,y,z,yawDeg,pitchDeg` in render space (x east, y up, z = −north; yaw 0 looks north, positive yaw turns left/west).
Playwright is a devDependency; its Chromium is installed with `npx playwright install chromium`.
Gotcha: the software GL has a coarse depth buffer — never put coplanar surfaces within a few cm of each other; the ground mesh uses polygonOffset for this reason.

## Supabase
Env vars (Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` (git-ignored). Only the anon key ever goes to the client; protection through RLS.
Project: https://nopkuhlhvxkrlpvmclab.supabase.co (publishable key in `.env.local`).
Admin access is through the Supabase MCP server in `.mcp.json`, which is scoped to this project and reads `SUPABASE_ACCESS_TOKEN` from the user's environment. Every schema change is written first as a new `supabase/migrations/NNNN_*.sql` file and committed, then applied with the MCP `apply_migration` tool. Never use ad-hoc DDL that skips the migration files.
Schema lives in `supabase/migrations/*.sql` (binary data stored as base64 text — simpler than bytea through supabase-js):
- `tracks(id text pk slug, name, author, trk_base64, created_at)` — seeded with `default`
- `lap_times(id uuid pk, track_id text fk, player_name ≤20, car, time_ms 1s..1h, input_log_base64, created_at)`
RLS: public select on both; anon insert on `lap_times` only (checks via column constraints). Later: Edge Function re-simulates `input_log` to validate times.
Client access only via `src/net/supabase.ts` (`getLeaderboard`, `submitLapTime`); it no-ops when env vars are missing.

## Deploy
Push to `main` on GitHub → Cloudflare Pages/Netlify builds `npm run build`, output `dist/`. Set the two env vars in the host dashboard.

## Car physics — Stunts-style planted model (`physics/car.ts`)
Rebuilt after user feedback that the rigid-body/suspension version "did not feel like Stunts". Facts come from https://wiki.stunts.hu/wiki/Car_model_physics and /Car_parameters (see skill `stunts-game-reference`).
- Engine: rpm = speed × gear ratio (rpm per m/s); force = torque(rpm)·ratio·efficiency; auto gearbox by up/down-shift rpm; traction capped by grip × driveGrip.
- Brakes: **constant deceleration** (~0.95 g), independent of grip and mass. Holding brake at a standstill engages reverse (throttle then brakes).
- Cornering: bicycle-model yaw, capped at the front-grip limit; lateral slip removed at ≤ grip·g per second, so the car holds its line until ~1.2 g, then slides (`state.slip`).
- Surfaces: grip asphalt 1, dirt 0.75, ice 0.25, grass 0.5; grass adds a 0.144·v slowdown.
- Planted: each substep the car is re-projected onto the road under it and its velocity turned into the road plane (magnitude kept, so loops keep speed). It **takes off** only if the road falls away by more than gravity pulls in that substep (+ a small facet allowance), e.g. at a ramp crest.
- In the air: ballistic, **no spin from the road** (a road kink measured over one substep produced backflips); the nose turns slowly (0.8 rad/s) to follow the flight path so jumps land along their arc. Landing crashes only when really bad: tilt < 0.35 or > 32 m/s into the road.
- Guided road (loops): triangles carry a road direction; the car heading and velocity are turned along it and steering is ignored there.
- Ray hits prefer the surface aligned with the car's up (`CollisionWorld.raycast(..., prefer)`) so a car follows *its* road where two cross (loops).
- Loop: the original ring (≈55 m long, 59 m tall) with its sideways shift; needs ~150 km/h; slower and you fall out.
- World scale is the original's (tile 62.4 m, see skill `stunts-track-format`). The car is drawn 1.25× real size and has a 3.1 m wheelbase so car/road proportions match the original.
- Hills still have no side walls (cars pass through hill sides). No car-vs-object collisions yet.
- Debug URLs: `?car=e,n,u,H,speed` spawn the car, `?cam=...` free camera, `?view=chase|cockpit|free`, `?sharp` full resolution.

## Cars
- `src/physics/cars.generated.ts` is GENERATED by `node tools/stunts/gen-cars.mjs` from the user's local `original_game/STUNTS11/CAR*.RES` (numbers only; our own names, e.g. "Kestrel V6" for the NSX-class car). Never hand-edit it; change the converter instead.
- Conversions: mass ×46.9 kg, torque byte ×5.42 N·m (per 128 rpm), ratio ÷114.4 → rpm per m/s, drag ×0.01242 N/(m/s)², brakes 8.94 m/s²×v/256, grip 1.198 g×v/256, surface grip /256, wheel coords /64 game units.
- Engine force F = T(rpm)·(2π/60)·ratio (power conservation), traction capped at grip; idle torque replaces the curve below 2560 rpm in 1st and below idle rpm in other gears; no rolling resistance on road.
- `cars.test.ts` checks every car against its own selection-screen figures: top speed within 8%, 0–60 within −40%/+35%.
- In game: V / Shift+V cycles cars; `?vehicle=<id>` picks one (ids: nsx, audi, coun, gto, jag, lanc, l002, 962, pc4, indy, zr1).
- See `docs/ROADMAP.md` for the agreed plan.

## Look (matches screenshots of the original)
- Default: **native resolution, antialiased**, dashboard canvas scaled up to match (layout code stays in 320×200 coordinates via `Dashboard.setScale`). The user found 320×200 and 640×400 too pixelated; P still cycles to those retro modes (crisp `image-rendering: pixelated`).
- Unlit `MeshBasicMaterial`; shading is baked per face in `MeshBuilder` (a few discrete shades) and every colour is snapped to VGA 6-bit steps (`vgaQuantize`).
- Flat ground (one seamless quad: a tiled ground cracks open at 320×200), flat cyan sky, far hills + dark tree-line band + flat clouds (`render/horizon.ts`).
- Roads: grey asphalt with a yellow dashed centre line, no edge lines. Start gantry: two beige pillars and a red banner with pixel lettering.
- Default view is the **cockpit** with the 2D dashboard overlay (`ui/dashboard.ts`, drawn at 320×200); C cycles cockpit / chase / free; H cycles scenery.
