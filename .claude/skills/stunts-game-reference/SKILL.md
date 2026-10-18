---
name: stunts-game-reference
description: Reference for how the original DOS game Stunts (1990, Distinctive Software / Broderbund, aka 4D Sports Driving) looks, plays and flows — cars, track pieces, horizons, cameras, race rules, penalties, replays, opponents, original car parameters. Use when designing gameplay, UI, physics feel or deciding "what would Stunts do".
---

# Stunts (1990) — game reference

Developer Distinctive Software (Kevin Pickell et al.), published by Broderbund; in Europe "4D Sports Driving" (Mindscape). Original source code is lost. Community hub: https://wiki.stunts.hu, forum https://forum.stunts.hu, competitions https://zak.stunts.hu.

## Legal stance for this project
Original assets (3D shapes, car bitmaps, tracks, music) are copyrighted. **We ship only our own assets.** We may: implement documented file formats (TRK), read community docs for facts/numbers, let users import their own .TRK files. We do NOT copy code from restunts (disassembly) or bundle original files.

## Game flow (original)
1. Main menu: Drive · Select Car · Select Track · Track Editor (and Opponent selection).
2. Before racing: "Evaluate" shows the track; the race begins with a short countdown.
3. Race = **one lap**: start at start/finish, drive the whole track through every road piece, return to start/finish. Time shown in mm:ss.hh.
4. After race: Evaluate screen shows time, penalties, and offers **Replay** (with free cameras, can be saved as .RPL) and continuing.
5. High score table per track (.HIG, top 7 entries: name, car, time).

## Rules & penalties
- **Penalties** (the game's detect_penalty, restunts seg001; implemented in `src/race/lap.ts`): the track check's path is a graph, each piece with up to two following pieces, so every way through a fork is legitimate. When the car's tile leaves the piece it was last found on, the game searches ahead of the last confirmed piece (first successors, then forks' other ways from their second piece on) for the nearest piece on that tile, counting pieces passed over. 0-2: fine. More: confirmed only after 3 pieces in a row, penalty 3 s × pieces passed over by then (min 18 s). Reaching start/finish: 3 s per piece passed over. Not found ahead: "lost", no penalty. Tiles only, no heights.
- Crash: hitting objects/walls hard, landing badly, or falling off structures blows up the car → race over (MVP: restart from last road tile or end race; original ends the race unless you "Continue" in replay).
- Driving on grass/off-road is much slower (low grip/high drag).

## Track pieces (behaviour)
- Surfaces: paved (high grip), dirt (less grip), ice (very low grip).
- Ramps / elevated roads / bridges: elevated level equals hill height. Driving off the side of elevated road = fall (often crash).
- Loop: needs enough speed or the car falls off. Corkscrew up/down, cork left/right, pipes, half-pipe, banked roads/corners, tunnels, chicanes, slalom blocks, crossroads, highway (double road).
- Water: driving into water = crash/sink.
- Scenery objects (buildings, trees, windmill with rotating blades, ship) are solid obstacles.

## Horizons / scenery
Desert (sand, mesas), Tropical (green, palms, water), Alpine (snowy mountains), City (skyline), Country (green fields). Sky colour gradient + a distant silhouette band.

## Cameras
F1 in-car (dashboard with speedometer + rev counter, steering wheel), F2 behind car (chase), F3 TV/side camera fixed at track positions, F4 rotating view. Replay offers more free cameras.

## Cars (original roster)
Acura NSX, Audi Quattro Sport, Ferrari GTO, Lamborghini Countach, Lamborghini LM-002, Lancia Delta HF Integrale, Porsche 962, Porsche March Indy, Corvette ZR1, Jaguar XJR9 IMSA, Porsche Carrera 4. **We use our own fictional cars** (names/looks invented) with similar spread: light & grippy, fast & loose, off-road truck, prototype racer.

Original car parameter set (car*.res `simd` chunk, see https://wiki.stunts.hu/wiki/Car_files): number of gears, mass, braking effectiveness, idle/downshift/upshift/max rpm, gear ratios, aerodynamic resistance, torque curve (indexed by rpm), grip, air grip, per-surface grip modifiers, collision dims, wheel coordinates. Our `CarSpec` mirrors these fields so tuning feels familiar.

## Opponents
Original had AI opponents who race the same track simultaneously. From OPP1..6.PRE (player's files): 1 Squealin' Bernie Rubber (easiest), 2 Herr Otto Partz (fear of heights), 3 Smokin' Joe Stallin (slow on straights), 4 Cherry Chassis (bad at corners), 5 Helen Wheels (likes bumping), 6 Skid Vicious (best).
- `sped` (16 bytes, mph per element type, wiki "Opponent files"): road paved/dirt/icy, sharp corner p/d/i, large corner p/d/i, banked corner, bridge, slalom, cork up/down, chicane, loop (115 for all), cork l/r. E.g. Skid 200,150,100,50,30,20,100,80,40,175,115,60,50,150,140,50; Bernie 120,75,50,40,30,20,60,40,20,90,115,20,30,70,80,50.
- `path` (186 bytes, one per element code): per-piece trouble level, matching each bio (Bernie 10 on loops, 2-5 on pipes/corks; Otto 2 on elevated pieces; Joe 1-3 on straights; Cherry 1-4 on corners; Helen and Skid none).
- `edes` bio, `enam` initials, `ev*` lines when they win, `ed*` when they lose, `ed4a` after a collision; `winn`/`lose` = frame sequences of op01-op08 in OPP?WIN.PVS / OPP?LOSE.PVS. SDOSEL.PVS = the opponent selection screen (scrn, opp0-opp6 portraits, clip).

## What the original looks like (from screenshots, e.g. https://www.oldgames.sk/en/game/stunts/screenshots/)
- 320×200, 256 colours, flat-shaded polygons, no textures; distant objects simply pop in (no fog).
- Flat green grass to the horizon, light cyan sky with a few white cloud sprites, a band of green hills and a dark tree line on the horizon.
- Paved road: dark grey with a single **yellow dashed centre line**; very wide relative to the car.
- Start/finish: tall pinkish-beige pillars either side carrying a red banner with white lettering.
- Scenery: windmill (red roof, striped), white gas station with red stripe; elevated ramps look like grey columns in the distance.
- In-car view (default): the dashboard fills the bottom ~third: black panel, blue cowl edge, round rev counter + speedometer inside a large steering wheel rim, switch rows left and right. Race clock (m:ss) at the top centre.
- Cars: recognisable real cars (Porsche 962, Countach, Ferrari GTO...) made of a few dozen faceted polygons with 2–3 shades per colour. We use our own fictional cars.
- Replay screen has VCR-style controls and the timer; "Wrong Way" text appears when driving backwards.

## Physics feel (target)
- Very arcade: strong engine, cars can jump far off ramps, gentle "floaty" air time, loops are possible at moderate speed.
- The original updates the car every 0.05 s (20 Hz); we run 60 Hz fixed and keep it deterministic.
- Measured on the original: braking ~0.91 g × brake/256, constant and mass-independent; cornering ~1.2 g at grip 100h (skids from ~70 mph at that grip); top speed = sqrt(torque·ratio/drag); grass slowdown ∝ speed (~0.144/s).
- Steering is keyboard digital with gradual wheel return; auto or manual gearbox.

## Sound (measured on the original, Sound Blaster/AdLib output via the retrogames.cz emulator)
The original has no samples: per-device drivers and voice files (`AD*/MT*/PC*/TD*` `.DRV/.VCE`,
`GEENG.SFX`, `.KMS` music), formats undocumented. Our sounds are synthesised in `src/audio/sound.ts`.
- Engine: one harmonic tone, fundamental ≈ rpm / 176 Hz (~5 Hz at 900 rpm idle, ~44 Hz at 7700);
  strongest harmonics 5th and 8th, then 2nd, 13th, 1st, 18th, 21st. Same loudness on/off throttle;
  off throttle the pitch just holds/sinks; downshifts while braking step the pitch up.
- Tyre squeal only when cornering at the grip limit (full lock from ~70 mph on asphalt): ~522 Hz
  warbling at ~26 Hz (sidebands 498/548) plus ~1045 Hz. No squeal when braking. With Sound Blaster,
  no skid sound on grass/dirt/ice (a known bug of the original).
- Crash: ~1.25 s broadband noise fading out, the squeal tone over its first ~0.85 s; engine stops.
- Bump (car bouncing off the road / landing): ~0.25 s low rough noise, ~2× engine loudness.
- Gear changes make no sound of their own (only the pitch jump).

## Open-source references
- restunts (disassembly, for constants only): https://github.com/4d-stunts/restunts
- csabahruska/stunts (Haskell remake, BSD-3): https://github.com/csabahruska/stunts
- stressed resource editor (GPL-2): https://github.com/dstien/stressed
- Track element physics planes: https://wiki.stunts.hu/wiki/Track_element_assembly
- Track format: see skill `stunts-track-format`.
