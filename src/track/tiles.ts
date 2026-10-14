// Tile code → gameplay meaning. Code tables: skill `stunts-track-format`.
// Pieces we haven't modelled yet still decode to the closest piece we have (a `style` tag says what
// they really are), so every original track loads with a complete, drivable route. Remaining
// unknown codes decode as `unknown` and are skipped.

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Surface = 'paved' | 'dirt' | 'ice';
export type Axis = 'NS' | 'EW';
/** What a stand-in road really is in the original (drawn and driven as a plain road for now). */
export type RoadStyle = 'banked' | 'tunnel' | 'pipe' | 'halfpipe' | 'highway' | 'slalom' | 'cork';
export type Building = 'tennis' | 'gas' | 'barn' | 'office' | 'windmill' | 'ship' | 'diner';

export type TileInfo =
  | { kind: 'blank' }
  | { kind: 'filler' }
  | { kind: 'unknown'; code: number }
  | { kind: 'start'; surface: Surface; dir: Dir }
  | { kind: 'road'; surface: Surface; axis: Axis; style?: RoadStyle }
  /** Two-tile straight stand-in (corkscrew left/right). */
  | { kind: 'longRoad'; axis: Axis; style: RoadStyle }
  | { kind: 'crossroad'; surface: Surface }
  /** S-bend over 2x2 tiles; `from` is the column (W or E half) where it enters on the S/W side. */
  | { kind: 'chicane'; axis: Axis; from: 'W' | 'E' }
  | { kind: 'elevatedRoad'; axis: Axis; solid?: boolean; span?: 'plain' | 'overRoad' }
  | { kind: 'elevatedCorner'; edges: [Dir, Dir] }
  | { kind: 'ramp'; style: 'solid' | 'elevated' | 'bridge'; dir: Dir } // dir = direction of ascent
  | { kind: 'loop'; axis: Axis }
  | { kind: 'corner'; surface: Surface; size: 'sharp' | 'large'; edges: [Dir, Dir]; banked?: boolean }
  /** A corner and a straight sharing the tile(s): a fork. */
  | { kind: 'split'; surface: Surface; size: 'sharp' | 'large'; edges: [Dir, Dir]; axis: Axis }
  | { kind: 'scenery'; type: 'palm' | 'cactus' | 'pine' }
  | { kind: 'building'; type: Building; facing: Dir };

export type Terrain =
  | { kind: 'flat' }
  | { kind: 'water' }
  | { kind: 'hill' }
  | { kind: 'slope'; ascent: Dir }
  /** Hill corner pieces: height (0 or 1 × hill height) at the SW, SE, NE, NW tile corners. */
  | { kind: 'corner'; heights: [number, number, number, number] }
  /** Diagonal coast: the water half is the triangle at this tile corner. */
  | { kind: 'coast'; water: 'NW' | 'SW' | 'SE' | 'NE' };

export const FILLER_CODES = [0xfd, 0xfe, 0xff] as const;

// Column order used throughout the wiki tables.
const TRAVEL: Dir[] = ['N', 'W', 'S', 'E']; // S>N, E>W, N>S, W>E
const CORNER_EDGES: [Dir, Dir][] = [
  ['S', 'E'],
  ['W', 'S'],
  ['N', 'E'],
  ['W', 'N'],
];
const AXIS_OF = (d: Dir): Axis => (d === 'N' || d === 'S' ? 'NS' : 'EW');

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

// Stand-ins: banked roads and their entries, tunnels, pipes, half-pipes, highways, slalom.
// Banked road codes name the direction of banking; the road runs across it.
add4([0x32, 0x30, 0x33, 0x31], (i) => ({
  kind: 'road',
  surface: 'paved',
  axis: AXIS_OF(TRAVEL[i]!) === 'NS' ? 'EW' : 'NS',
  style: 'banked',
}));
for (const c of [0x28, 0x2e, 0x2a, 0x2c]) table.set(c, { kind: 'road', surface: 'paved', axis: 'NS', style: 'banked' });
for (const c of [0x2f, 0x2b, 0x2d, 0x29]) table.set(c, { kind: 'road', surface: 'paved', axis: 'EW', style: 'banked' });
const straights: [number, RoadStyle][] = [
  [0x42, 'tunnel'],
  [0x44, 'pipe'],
  [0x53, 'halfpipe'],
  [0x6d, 'highway'],
  [0x73, 'slalom'],
];
for (const [c, style] of straights) {
  table.set(c, { kind: 'road', surface: 'paved', axis: 'NS', style });
  table.set(c + 1, { kind: 'road', surface: 'paved', axis: 'EW', style });
}
add4([0x46, 0x48, 0x47, 0x49], (i) => ({ kind: 'road', surface: 'paved', axis: AXIS_OF(TRAVEL[i]!), style: 'pipe' }));
add4([0x6f, 0x72, 0x71, 0x70], (i) => ({ kind: 'road', surface: 'paved', axis: AXIS_OF(TRAVEL[i]!), style: 'highway' }));
table.set(0x55, { kind: 'longRoad', axis: 'NS', style: 'cork' });
table.set(0x56, { kind: 'longRoad', axis: 'EW', style: 'cork' });
table.set(0x4a, { kind: 'crossroad', surface: 'paved' });
table.set(0x7d, { kind: 'crossroad', surface: 'dirt' });
table.set(0x8a, { kind: 'crossroad', surface: 'ice' });
table.set(0x3c, { kind: 'chicane', axis: 'NS', from: 'W' });
table.set(0x3e, { kind: 'chicane', axis: 'NS', from: 'E' });
table.set(0x3d, { kind: 'chicane', axis: 'EW', from: 'W' });
table.set(0x3f, { kind: 'chicane', axis: 'EW', from: 'E' });
add4([0x34, 0x35, 0x36, 0x37], (i) => ({ kind: 'corner', surface: 'paved', size: 'large', edges: CORNER_EDGES[i]!, banked: true }));
add4([0x3a, 0x39, 0x3b, 0x38], (i) => ({ kind: 'ramp', style: 'bridge', dir: TRAVEL[i]! }));
table.set(0x63, { kind: 'elevatedRoad', axis: 'NS', solid: true });
table.set(0x64, { kind: 'elevatedRoad', axis: 'EW', solid: true });
table.set(0x65, { kind: 'elevatedRoad', axis: 'NS', span: 'overRoad' });
table.set(0x66, { kind: 'elevatedRoad', axis: 'EW', span: 'overRoad' });
table.set(0x67, { kind: 'elevatedRoad', axis: 'NS', span: 'plain' });
table.set(0x68, { kind: 'elevatedRoad', axis: 'EW', span: 'plain' });
add4([0x69, 0x6a, 0x6b, 0x6c], (i) => ({ kind: 'elevatedCorner', edges: CORNER_EDGES[i]! }));

// Split corners (a corner and a straight sharing the tile): north-south and east-west straights.
const splits: [number[], number[], Surface, 'sharp' | 'large'][] = [
  [[0x4f, 0x4b, 0x4d, 0x51], [0x4c, 0x52, 0x50, 0x4e], 'paved', 'sharp'],
  [[0x5b, 0x57, 0x59, 0x5d], [0x58, 0x5e, 0x5c, 0x5a], 'paved', 'large'],
  [[0x82, 0x7e, 0x80, 0x84], [0x7f, 0x85, 0x83, 0x81], 'dirt', 'sharp'],
  [[0x8f, 0x8b, 0x8d, 0x91], [0x8c, 0x92, 0x90, 0x8e], 'ice', 'sharp'],
];
for (const [ns, ew, surface, size] of splits) {
  add4(ns, (i) => ({ kind: 'split', surface, size, edges: CORNER_EDGES[i]!, axis: 'NS' }));
  add4(ew, (i) => ({ kind: 'split', surface, size, edges: CORNER_EDGES[i]!, axis: 'EW' }));
}

table.set(0x97, { kind: 'scenery', type: 'palm' });
table.set(0x98, { kind: 'scenery', type: 'cactus' });
table.set(0x99, { kind: 'scenery', type: 'pine' });

// Buildings: (S, N, E, W) facing; the ship by bow direction.
const FACING: Dir[] = ['S', 'N', 'E', 'W'];
table.set(0x9a, { kind: 'building', type: 'tennis', facing: 'S' });
add4([0x9b, 0x9c, 0x9d, 0x9e], (i) => ({ kind: 'building', type: 'gas', facing: FACING[i]! }));
add4([0x9f, 0xa0, 0xa1, 0xa2], (i) => ({ kind: 'building', type: 'barn', facing: FACING[i]! }));
add4([0xa3, 0xa4, 0xa5, 0xa6], (i) => ({ kind: 'building', type: 'office', facing: FACING[i]! }));
add4([0xa7, 0xa8, 0xa9, 0xaa], (i) => ({ kind: 'building', type: 'windmill', facing: FACING[i]! }));
add4([0xad, 0xae, 0xac, 0xab], (i) => ({ kind: 'building', type: 'ship', facing: FACING[i]! }));
add4([0xaf, 0xb0, 0xb1, 0xb2], (i) => ({ kind: 'building', type: 'diner', facing: FACING[i]! }));

// Corner heights [SW, SE, NE, NW] for the angled hill pieces 0B-12 (wiki "Track file").
const HILL_CORNERS: Record<number, [number, number, number, number]> = {
  // Outer edge: only the named corner is raised.
  0x0b: [0, 0, 0, 1], // NW
  0x0c: [1, 0, 0, 0], // SW
  0x0d: [0, 1, 0, 0], // SE
  0x0e: [0, 0, 1, 0], // NE
  // Inner edge: only the named corner is lowered.
  0x11: [1, 1, 1, 0], // NW
  0x12: [0, 1, 1, 1], // SW
  0x0f: [1, 0, 1, 1], // SE
  0x10: [1, 1, 0, 1], // NE
};
const COAST: ('NW' | 'SW' | 'SE' | 'NE')[] = ['SW', 'SE', 'NE', 'NW']; // codes 02-05

/** Terrain grid codes. */
export function decodeTerrain(code: number): Terrain {
  if (code === 0x01) return { kind: 'water' };
  if (code === 0x06) return { kind: 'hill' };
  if (code >= 0x07 && code <= 0x0a) return { kind: 'slope', ascent: TRAVEL[code - 0x07]! };
  const heights = HILL_CORNERS[code];
  if (heights) return { kind: 'corner', heights };
  if (code >= 0x02 && code <= 0x05) return { kind: 'coast', water: COAST[code - 0x02]! };
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
  if ((info.kind === 'corner' || info.kind === 'split') && info.size === 'large') return { w: 2, h: 2 };
  if (info.kind === 'chicane' || info.kind === 'elevatedCorner') return { w: 2, h: 2 };
  // Loops and corkscrews span two tiles along the travel axis.
  if (info.kind === 'loop' || info.kind === 'longRoad') return info.axis === 'NS' ? { w: 1, h: 2 } : { w: 2, h: 1 };
  return { w: 1, h: 1 };
}
