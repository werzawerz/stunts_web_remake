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
Project: https://nopkuhlhvxkrlpvmclab.supabase.co (publishable key in `.env.local`).
Admin access is through the Supabase MCP server in `.mcp.json`, which is scoped to this project and reads `SUPABASE_ACCESS_TOKEN` from the user's environment. Every schema change is written first as a new `supabase/migrations/NNNN_*.sql` file and committed, then applied with the MCP `apply_migration` tool. Never use ad-hoc DDL that skips the migration files.
Schema lives in `supabase/migrations/*.sql` (binary data stored as base64 text — simpler than bytea through supabase-js):
- `tracks(id text pk slug, name, author, trk_base64, created_at)` — seeded with `default`
- `lap_times(id uuid pk, track_id text fk, player_name ≤20, car, time_ms 1s..1h, input_log_base64, created_at)`
RLS: public select on both; anon insert on `lap_times` only (checks via column constraints). Later: Edge Function re-simulates `input_log` to validate times.
Client access only via `src/net/supabase.ts` (`getLeaderboard`, `submitLapTime`); it no-ops when env vars are missing.

## Deploy
Push to `main` on GitHub → Cloudflare Pages/Netlify builds `npm run build`, output `dist/`. Set the two env vars in the host dashboard.
