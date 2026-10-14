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

## Supabase
Env vars (Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` (git-ignored). Only the anon key ever goes to the client; protection through RLS.
Tables:
- `tracks(id uuid pk, name text, author text, trk bytea, created_at)`
- `lap_times(id uuid pk, track_id uuid fk, player_name text, car text, time_ms int, input_log bytea, created_at)`
RLS: public select on both; anon insert on `lap_times` with sanity checks (time_ms > 0, name length ≤ 20). Later: Edge Function re-simulates `input_log` to validate times.

## Deploy
Push to `main` on GitHub → Cloudflare Pages/Netlify builds `npm run build`, output `dist/`. Set the two env vars in the host dashboard.
