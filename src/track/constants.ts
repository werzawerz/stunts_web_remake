// World units are metres. Grid coordinates: x = east, z = north (see skill `stunts-track-format`).
// Three.js is right-handed with +Y up, so render space maps north to -Z (see MeshBuilder).
//
// Proportions are measured from the original's track shapes (GAME1/GAME2.P3S, read locally with
// tools/stunts): a tile is 1024 game units and one unit is 1/5 ft, which also matches the
// original's speed units.

export const UNIT = 0.3048 / 5;
export const TILE = 1024 * UNIT; // 62.4 m
export const ROAD_HALF_WIDTH = 120 * UNIT; // 7.3 m
/** Hills, elevated roads and ramp tops share one level, as in the original (450 units). */
export const HILL_HEIGHT = 450 * UNIT; // 27.4 m
/** Side walls of elevated roads and ramps stand 30 units above the road. */
export const RAIL_HEIGHT = 30 * UNIT;
/** Thickness of elevated road slabs. */
export const SLAB = 1.2;
