---
name: stunts-track-format
description: Full spec of the original Stunts .TRK track file (30x30 element grid, horizon, terrain grid), every tile code with orientation, multi-tile fillers, and our world-coordinate conventions. Use whenever reading/writing TRK data, adding track pieces, mapping tile codes, or building track geometry/colliders.
---

# Stunts TRK track format

Source: https://wiki.stunts.hu/wiki/Track_file (CC BY-NC-SA 4.0 — facts only, we write our own code).

## File layout (1802 bytes)
| Offset | Size | Content |
|---|---|---|
| 0x000 | 900 | Element grid 30×30. **Rows stored bottom→top** (row 0 = southmost), each row west→east |
| 0x384 | 1 | Horizon code |
| 0x385 | 900 | Terrain grid 30×30. **Rows stored top→bottom** (row 0 = northmost), each row west→east |
| 0x709 | 1 | Extra byte, ignored by game (usually 00; Bliss writes 0x99) |

- Files may be longer (≤13802 bytes) with an overlay (Bliss `smdf` metadata: 4-char chunk ID, LE word length, value; IDs `Titl`,`Autr`,`Comm`,`Chmp`,`Date`,`Tool`,`Etim`,`Colr`). Preserve unknown trailing bytes on round-trip.
- Files shorter than 1802 bytes are valid: only provided bytes overwrite defaults (zeros).
- NOTE the two grids use opposite row order. Normalise both into `grid[x][z]` with z=0 south in our code.

## Horizon codes
00 Desert · 01 Tropical · 02 Alpine · 03 City · 04 Country · 05 Chaotic (glitchy, treat as Desert)

## Terrain codes
| Element | Codes |
|---|---|
| Flat ground | 00 |
| Water | 01 |
| Diagonal coast (corner inside water) NW/SW/SE/NE | 05/02/03/04 |
| Flat hill (raised plateau) | 06 |
| Hill slope, uphill S>N / E>W / N>S / W>E | 07/08/09/0A |
| Angled slope outer (heightened corner) NW/SW/SE/NE | 0B/0C/0D/0E |
| Angled slope inner (lowered corner) NW/SW/SE/NE | 11/12/0F/10 |
>0x12 may crash the original — treat as flat.

## Element codes
Orientation column order for linear pieces: **S>N, E>W, N>S, W>E** (direction of travel / ascent). Two-code pieces are (N-S axis, E-W axis).

| Element | Codes |
|---|---|
| Blank | 00 |
| Start/finish paved | 01, B5, B3, B4 |
| Start/finish dirt | 86, 89, 87, 88 |
| Start/finish icy | 93, 96, 94, 95 |
| Road paved / dirt / icy | 04,05 / 0E,0F / 18,19 |
| Crossroad paved / dirt / icy | 4A / 7D / 8A |
| Elevated road | 22, 23 |
| Solid elevated road | 63, 64 |
| Elevated span over road | 65, 66 |
| Elevated span | 67, 68 |
| Elevated ramp (ascending) | 26, 25, 27, 24 |
| Bridge ramp (ascending) | 3A, 39, 3B, 38 |
| Solid ramp (ascending) | 61, 60, 62, 5F |
| Left cork up/down | 75, 76, 77, 78 |
| Right cork up/down | 79, 7A, 7B, 7C |
| Loop (2×1) | 40, 41 |
| Cork left/right (2×1) | 55, 56 |
| Tunnel | 42, 43 |
| Slalom road | 73, 74 |
| Pipe | 44, 45 |
| Half pipe (obstacle) | 53, 54 |
| Pipe start/end | 46, 48, 47, 49 |
| Highway | 6D, 6E |
| Highway start/end | 6F, 72, 71, 70 |
| Banked road (banking dir) | 32, 30, 33, 31 |

Corners — column order **S-E, W-S, N-E, W-N** (the two tile edges connected):
| Element | Codes |
|---|---|
| Paved sharp corner | 06, 07, 08, 09 |
| Paved large corner (2×2) | 0A, 0B, 0C, 0D |
| Dirt sharp / large | 10–13 / 14–17 |
| Icy sharp / large | 1A–1D / 1E–21 |
| Banked corner | 34, 35, 36, 37 |
| Elevated corner | 69, 6A, 6B, 6C |

Split corners (corner + straight crossing), columns S-E, W-S, N-E, W-N:
| Element | N-S road | E-W road |
|---|---|---|
| Paved sharp | 4F,4B,4D,51 | 4C,52,50,4E |
| Paved large | 5B,57,59,5D | 58,5E,5C,5A |
| Dirt sharp | 82,7E,80,84 | 7F,85,83,81 |
| Icy sharp | 8F,8B,8D,91 | 8C,92,90,8E |

Chicane (SW-NE / SE-NW, 2×2): N-S 3C,3E · E-W 3D,3F
Banked road start/end NW/SW/SE/NE: N-S 28,2E,2A,2C · E-W 2F,2B,2D,29

Scenery: ghost player 02, ghost opponent 03, palm 97, cactus 98, pine 99, tennis court 9A; directional (S,N,E,W): gas station 9B–9E, barn 9F–A2, office A3–A6, windmill A7–AA, ship AD,AE,AC,AB, Joe's diner AF–B2.

## Multi-tile pieces & fillers
- The code lives only in the **top-left** (NW-most) tile of the footprint; other tiles hold fillers: **FE = SW filler, FD = SE filler, FF = NE filler** (relative to the NW anchor).
- 2×1: loops (filler in SW → piece spans N-S... depends on orientation), cork l/r (filler NE). 2×2: large corners, cork up/down, chicanes → three fillers.
- Missing fillers are legal ("illusion tracks"); don't crash, just render the piece.
- B6–FC are undocumented; treat as blank for gameplay.

## Our world conventions (decided by us, keep consistent)
- Constants live in `src/track/constants.ts`: `TILE` = 20 m, `ROAD_HALF_WIDTH` = 6 m, `HILL_HEIGHT` = 10 m, `SLAB` = 0.8 m.
- Grid/sim space is (east, north, up). Tile (x,z) occupies [x·TILE,(x+1)·TILE] × [z·TILE,(z+1)·TILE].
- **Three.js is right-handed with +Y up, so render space is (east, up, −north)**: north = −Z. `MeshBuilder` does this conversion; keep sim code in (east, north, up).
- Multi-tile pieces extend **east and south** from the NW anchor tile (anchor (x,z) covers x..x+w−1, z−h+1..z). Fillers: FE = tile south of the anchor, FD = south-east, FF = east.
- Corner pieces: the arc centre is the block corner lying between the two connected edges; radius 0.5 tile (sharp) or 1.5 tiles (large). A rectangular circuit's corners therefore use the edge pair on the *inside* of the bend.
- Hill (terrain 06) height and elevated road height are the same level (`HILL_HEIGHT`), as in the original where elevated roads connect to hills.
- Not yet built: coasts, angled slopes (rendered flat), banked/cork/pipe/tunnel/highway pieces, split corners, chicanes.
- Physical model in the original is built from shared planes (GAME.PRE `plan` resource, normals scaled to 8192); we instead generate analytic surfaces per piece (see `stunts-project-conventions`).
