// World units are metres. Grid coordinates: x = east, z = north (see skill `stunts-track-format`).
// Three.js is right-handed with +Y up, so render space maps north to -Z (see MeshBuilder).

export const TILE = 20;
export const ROAD_HALF_WIDTH = 6;
/** Hills, elevated roads and ramp tops share one level, as in the original. */
export const HILL_HEIGHT = 10;
/** Thickness of elevated road slabs. */
export const SLAB = 0.8;
