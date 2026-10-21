# Stunts web remake

A faithful browser remake of the 1990 DOS game **Stunts** (aka 4D Sports Driving), hobby project
of werzawerz. Vite + TypeScript (strict) + Three.js, Vitest, Supabase. **Live:**
https://werzawerz.github.io/stunts_web_remake/ (public repo `werzawerz/stunts_web_remake`, every
push to `main` deploys). Played on PC and iPhone.

**The owner's yardstick is the original game.** Look, feel, screens, rules: check what the
original does (wiki.stunts.hu, the restunts disassembly, the manual, the game itself in an
emulator, its own data files) instead of guessing. Every guess so far got sent back.

## Before working

Load the project skills (`.claude/skills/`), they hold the details:
- `stunts-game-reference` — how the original plays and looks; penalties; opponents' data
- `stunts-track-format` — TRK format, tile codes, terrain, the original editor's tables, the track check
- `stunts-project-conventions` — determinism rules, car physics, look, commands, Supabase, visual checks

The user-level skill `dos-game-remake` has the general method and the helper scripts (emulator
driver, screenshot montage/crop, pixel-run measuring, phone emulation).

## Commands

- `npm run dev -- --port 5173 --strictPort` — dev server (also serves `original_game/`)
- `npm test` — Vitest (~100 tests; tests needing the original files skip without them)
- `LAPS=1 npx vitest run src/track/originalLaps.test.ts` — the test driver laps all six original tracks (run after physics/track/route changes)
- `npx tsc --noEmit`, `npm run build`
- Debug URLs: `?track=orig-default` (ids below), `?car=e,n,u,H,speed` spawn, `?cam=x,y,z,yaw,pitch`, `?view=chase|cockpit|free`, `?menu=0`, `?vehicle=indy`, `?res=0|2|1`
- Keys in game: arrows drive, A/Z gears (manual), R restart, C camera, Esc replay panel, G ghost, M sound, T next track, V next car, P resolution, H horizon

## Original files (owner's decision, 2026-10-18)

- `original_game/STUNTS11/` — the owner's full Stunts 1.1 copy, git-ignored, read by the dev server and by tests.
- `public/original/` — **exactly the 85 files the game reads**, published with the site (marked binary in `.gitattributes`). Add a file only when the code starts loading it; never commit the rest.
- Loader: `src/original/files.ts` (`fetchOriginal`); production looks only in `<base>/original/`. Everything has a stand-in when files are missing.
- Facts from the restunts disassembly are fine; never copy its code. Generated tables come from `tools/stunts/gen-*.mjs` (elements, cars, editor tables, element paths) — never hand-edit `*.generated.ts`.

## Code map (`src/`)

- `main.ts` (~1650 lines) — the state machine and glue: screens, race loop (fixed 60 Hz, interpolated rendering), crash/finish/evaluation, replays, ghost, opponents, editor, track list, touch, sound.
- `physics/` — deterministic car model (`car.ts`, Stunts-style "planted" physics), `collision.ts` (ray casts, walls, guided loop road), cars generated from the original `CAR*.RES`.
- `track/` — `trkFormat.ts` (TRK I/O), `tiles.ts` (codes → meaning), `trackBuilder.ts` (meshes + collision from the original 3D shapes, or our own geometry), `check.ts` (**the original's track check**: terrain edges, start/finish, joins, wrong way, jumps, complete lap; also produces the path graph), `editor.ts` (palette pages, place/remove, placement rules), `trackStore.ts` (local saves + online id).
- `race/` — `route.ts` (driving line, shortest lap), `lap.ts` (**the original's penalty rules** on the path graph: forks are fine; 0-2 skipped free, else 3 s per piece, min 18 s), `replay.ts`/`replayStore.ts`, `ghost.ts`, `autopilot.ts` (track driver), `opponent.ts` (computer opponents: original speed tables, learning before the race, car collisions).
- `original/` — decoders for the original files: packing/resources/shapes (`formats.ts`), VGA sprites + palette (`cockpit.ts`), EGA icons (`egaSprite.ts`), fonts (`font.ts`), pictures (`screens.ts`), editor graphics, car models/info, opponents.
- `ui/` — 320×200 canvas screens drawn with the original pictures: `menu.ts`, `showroom.ts`, `trackSelect.ts`, `trackEditor.ts`, `opponentSelect.ts`, `opponentResult.ts`, `evaluation.ts`, `replayView.ts`, `dashboard.ts` (cockpits, HUD), `crash.ts`, `touchControls.ts` (phones).
- `render/` — horizon panoramas, car meshes, debris, free camera. `audio/sound.ts` — Web Audio synthesis (engine, squeal, crash), iOS-safe.
- `net/supabase.ts` — the only file that talks to Supabase.

Track ids: `default` (our demo circuit), `orig-default|bernies|cherris|helens|joes|skids`, `user-<uuid>` (shared online), `custom-<name>` (saved only on this device).

## Online (Supabase project `nopkuhlhvxkrlpvmclab`)

- Tables `tracks` (id, name, author, trk_base64) and `lap_times` (track_id → tracks, player_name, car, time_ms, input_log_base64). Migrations in `supabase/migrations/`; write the file first, apply with the Supabase MCP `apply_migration`, then check the advisors.
- RLS: everyone reads; anyone may add a lap; anyone may add a track with id `user-%` and a TRK file (≤ 4000 chars). No updates/deletes (no sign-in yet).
- Editor Save keeps the track locally and shares it online when it passes the track check.
- `.env.production` holds the URL + publishable key (public by design). Test policies with `begin; set local role anon; ...; rollback;`; don't create test rows in the live DB (fake the API with Playwright `page.route`).

## Deploy and phones

- `.github/workflows/deploy.yml`: tests → `vite build --base=/stunts_web_remake/` → GitHub Pages. Rehearse locally with `MSYS_NO_PATHCONV=1 npx vite build --base=/stunts_web_remake/` + `vite preview`.
- Phones: touch controls while driving, taps everywhere, `window.prompt` for names, manifest/home-screen app, portrait overlay, iOS silent-switch audio fix.

## Working conventions

- Determinism: the simulation is a pure function of state + input bitmask per tick (no `Date`, `Math.random`, DOM). Replays, ghosts, opponents in replays and future server validation depend on it.
- Verify visually: headless Chromium screenshots (`tools/shot.mjs`, or the `dos-game-remake` skill's `play.mjs`), Read the PNGs, compare with the original (emulator captures). Measure layouts with `runs.mjs`.
- Files are CRLF. For multi-site edits write a Node patch script with the Write tool (normalise `\r\n`, assert each match, write back CRLF); inline bash heredocs with nested template literals break. No Python on this machine.
- After each feature: tests, typecheck, build, update `docs/ROADMAP.md` and the relevant skill, commit with a descriptive message (ends with the Co-Authored-By line), push (deploys).
- Temporary helpers go in `tools/_*.mjs` and are not committed; remove probe tests (`_*.test.ts`) before committing.
- Talk to the owner plainly: what changed, what was verified, what wasn't. Ask only for real owner decisions.

## Known limits / next

- Computer opponents are slower than a good human (centre-line driving), especially on long tracks; SKIDS' bridge-ramp row is the test driver's weak spot in some cars.
- Corkscrew up/down pieces drive as flat large corners. No music.
- Next on the roadmap: sign-in (owners for shared tracks, limits against flooding), server-side lap validation (re-simulate input logs in an Edge Function). See `docs/ROADMAP.md`.
