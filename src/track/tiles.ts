// Tile code → gameplay meaning. Only MVP pieces are mapped; everything else decodes as `unknown`
// so imported tracks still load. Code tables: skill `stunts-track-format`.

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Surface = 'paved' | 'dirt' | 'ice';

export type TileInfo =
  | { kind: 'blank' }
  | { kind: 'filler' }
  | { kind: 'unknown'; code: number }
  | { kind: 'start'; surface: Surface; dir: Dir }
  | { kind: 'road'; surface: Surface; axis: 'NS' | 'EW' }
  | { kind: 'elevatedRoad'; axis: 'NS' | 'EW' }
  | { kind: 'ramp'; style: 'solid' | 'elevated'; dir: Dir } // dir = direction of ascent
  | { kind: 'loop'; axis: 'NS' | 'EW' }
  | { kind: 'corner'; surface: Surface; size: 'sharp' | 'large'; edges: [Dir, Dir] }
  | { kind: 'scenery'; type: 'palm' | 'cactus' | 'pine' };

export type Terrain =
  | { kind: 'flat' }
  | { kind: 'water' }
  | { kind: 'hill' }
  | { kind: 'slope'; ascent: Dir };

export const FILLER_CODES = [0xfd, 0xfe, 0xff] as const;

// Column order used throughout the wiki tables.
const TRAVEL: Dir[] = ['N', 'W', 'S', 'E']; // S>N, E>W, N>S, W>E
const CORNER_EDGES: [Dir, Dir][] = [
  ['S', 'E'],
  ['W', 'S'],
  ['N', 'E'],
  ['W', 'N'],
];

const table = new Map<number, TileInfo>();

function add4(codes: number[], make: (i: number) => TileInfo): void {
  codes.forEach((c, i) => table.set(c, make(i)));
}

table.set(0x00, { kind: 'blank' });
for (const c of FILLER_CODES) table.set(c, { kind: 'filler' });

add4([0x01, 0xb5, 0xb3, 0xb4], (i) => ({ kind: 'start', surface: 'paved', dir: TRAVEL[i]! }));
add4([0x86, 0x89, 0x87, 0x88], (i) => ({ kind: 'start', surface: 'dirt', dir: TRAVEL[i]! }));
add4([0x93, 0x96, 0x94, 0x95], (i) => ({ kind: 'start', surface: 'ice', dir: TRAVEL[i]! }));

const roads: [number, Surface][] = [
  [0x04, 'paved'],
  [0x0e, 'dirt'],
  [0x18, 'ice'],
];
for (const [c, surface] of roads) {
  table.set(c, { kind: 'road', surface, axis: 'NS' });
  table.set(c + 1, { kind: 'road', surface, axis: 'EW' });
}

table.set(0x22, { kind: 'elevatedRoad', axis: 'NS' });
table.set(0x23, { kind: 'elevatedRoad', axis: 'EW' });
add4([0x61, 0x60, 0x62, 0x5f], (i) => ({ kind: 'ramp', style: 'solid', dir: TRAVEL[i]! }));
add4([0x26, 0x25, 0x27, 0x24], (i) => ({ kind: 'ramp', style: 'elevated', dir: TRAVEL[i]! }));
table.set(0x40, { kind: 'loop', axis: 'NS' });
table.set(0x41, { kind: 'loop', axis: 'EW' });

const corners: [number, Surface, 'sharp' | 'large'][] = [
  [0x06, 'paved', 'sharp'],
  [0x0a, 'paved', 'large'],
  [0x10, 'dirt', 'sharp'],
  [0x14, 'dirt', 'large'],
  [0x1a, 'ice', 'sharp'],
  [0x1e, 'ice', 'large'],
];
for (const [base, surface, size] of corners) {
  add4([base, base + 1, base + 2, base + 3], (i) => ({ kind: 'corner', surface, size, edges: CORNER_EDGES[i]! }));
}

table.set(0x97, { kind: 'scenery', type: 'palm' });
table.set(0x98, { kind: 'scenery', type: 'cactus' });
table.set(0x99, { kind: 'scenery', type: 'pine' });

/** Terrain grid codes. Coasts and angled slopes fall back to flat until those pieces are built. */
export function decodeTerrain(code: number): Terrain {
  if (code === 0x01) return { kind: 'water' };
  if (code === 0x06) return { kind: 'hill' };
  if (code >= 0x07 && code <= 0x0a) return { kind: 'slope', ascent: TRAVEL[code - 0x07]! };
  return { kind: 'flat' };
}

export function decodeTile(code: number): TileInfo {
  return table.get(code) ?? { kind: 'unknown', code };
}

/** Inverse lookup used by our own track authoring/editor. */
export function encodeTile(info: TileInfo): number {
  const want = JSON.stringify(info);
  for (const [code, t] of table) {
    if (JSON.stringify(t) === want) return code;
  }
  if (info.kind === 'unknown') return info.code;
  throw new Error(`No tile code for ${want}`);
}

/**
 * Footprint in tiles, anchored at the NW-most tile (where the code is stored); the rest hold fillers.
 * w extends east, h extends south.
 */
export function footprint(info: TileInfo): { w: number; h: number } {
  if (info.kind === 'corner' && info.size === 'large') return { w: 2, h: 2 };
  // Loops span two tiles along the travel axis.
  if (info.kind === 'loop') return info.axis === 'NS' ? { w: 1, h: 2 } : { w: 2, h: 1 };
  return { w: 1, h: 1 };
}
