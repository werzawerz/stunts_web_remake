// Stunts .TRK reader/writer. Spec: skill `stunts-track-format` / https://wiki.stunts.hu/wiki/Track_file

export const GRID = 30;
export const TRK_SIZE = 1802;
const ELEMENTS_OFFSET = 0x000;
const HORIZON_OFFSET = 0x384;
const TERRAIN_OFFSET = 0x385;
const EXTRA_OFFSET = 0x709;

export enum Horizon {
  Desert = 0,
  Tropical = 1,
  Alpine = 2,
  City = 3,
  Country = 4,
  Chaotic = 5,
}

/** Grids are indexed [x][z]: x = 0 west → 29 east, z = 0 south → 29 north. */
export interface Track {
  elements: number[][];
  terrain: number[][];
  horizon: Horizon;
  extra: number;
  /** Bytes after the standard 1802 (e.g. Bliss metadata); kept for lossless round-trips. */
  overlay: Uint8Array;
}

function makeGrid(): number[][] {
  return Array.from({ length: GRID }, () => new Array<number>(GRID).fill(0));
}

export function createEmptyTrack(horizon: Horizon = Horizon.Desert): Track {
  return { elements: makeGrid(), terrain: makeGrid(), horizon, extra: 0, overlay: new Uint8Array(0) };
}

// The two grids are stored with opposite row orders: elements south→north, terrain north→south.
function elementIndex(x: number, z: number): number {
  return ELEMENTS_OFFSET + z * GRID + x;
}
function terrainIndex(x: number, z: number): number {
  return TERRAIN_OFFSET + (GRID - 1 - z) * GRID + x;
}

export function parseTrk(data: Uint8Array): Track {
  // Short files are legal in Stunts: missing bytes keep their defaults (zero).
  const buf = new Uint8Array(TRK_SIZE);
  buf.set(data.subarray(0, TRK_SIZE));
  const track = createEmptyTrack();
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      track.elements[x]![z] = buf[elementIndex(x, z)]!;
      track.terrain[x]![z] = buf[terrainIndex(x, z)]!;
    }
  }
  const horizon = buf[HORIZON_OFFSET]!;
  track.horizon = horizon <= Horizon.Chaotic ? horizon : Horizon.Desert;
  track.extra = buf[EXTRA_OFFSET]!;
  track.overlay = data.length > TRK_SIZE ? data.slice(TRK_SIZE) : new Uint8Array(0);
  return track;
}

export function serializeTrk(track: Track): Uint8Array {
  const out = new Uint8Array(TRK_SIZE + track.overlay.length);
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      out[elementIndex(x, z)] = track.elements[x]![z]!;
      out[terrainIndex(x, z)] = track.terrain[x]![z]!;
    }
  }
  out[HORIZON_OFFSET] = track.horizon;
  out[EXTRA_OFFSET] = track.extra;
  out.set(track.overlay, TRK_SIZE);
  return out;
}
