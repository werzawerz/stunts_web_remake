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
- Leaving the road or skipping track pieces is allowed while driving but **missing pieces (shortcuts)** produces a penalty time added at the end (original: time penalty proportional to skipped road). We implement checkpoints per road tile; MVP: lap only valid if all checkpoints hit, later: Stunts-like penalty.
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
Original had AI opponents (Skid Vicious, Herr Otto Partz, Cherry Chassis, Bernie Rubber, Helen Wheels, Joe "Speed" Weisberg) who race the same track simultaneously. Post-MVP for us (follow tile path).

## Physics feel (target)
- Very arcade: strong engine, cars can jump far off ramps, gentle "floaty" air time, loops are possible at moderate speed.
- Simulation ran at a fixed low rate (~20 ticks/s in the original); we run 60 Hz fixed and keep it deterministic.
- Steering is keyboard digital with gradual wheel return; auto or manual gearbox.

## Open-source references
- restunts (disassembly, for constants only): https://github.com/4d-stunts/restunts
- csabahruska/stunts (Haskell remake, BSD-3): https://github.com/csabahruska/stunts
- stressed resource editor (GPL-2): https://github.com/dstien/stressed
- Track element physics planes: https://wiki.stunts.hu/wiki/Track_element_assembly
- Track format: see skill `stunts-track-format`.
