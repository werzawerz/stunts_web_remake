import { ELEMENT_SHAPES } from '../original/elementTable.generated';
import { GRID, type Track } from './trkFormat';

/*
 * Editing a track like the original's track editor: the catalogue of pieces (codes per rotation,
 * from the TRK format tables, skill `stunts-track-format`) and placing / removing them on the 30x30
 * grid with the fillers multi-tile pieces need. Pure data, no drawing.
 */

export interface PieceDef {
  name: string;
  /** Codes for each rotation (R cycles them). */
  codes: number[];
  /** Terrain pieces go on the terrain layer. */
  terrain?: boolean;
}

export interface Category {
  name: string;
  pieces: PieceDef[];
}

const p = (name: string, ...codes: number[]): PieceDef => ({ name, codes });
const t = (name: string, ...codes: number[]): PieceDef => ({ name, codes, terrain: true });

export const CATALOG: Category[] = [
  {
    name: 'Roads',
    pieces: [
      p('road', 0x04, 0x05),
      p('dirt road', 0x0e, 0x0f),
      p('icy road', 0x18, 0x19),
      p('start/finish line', 0x01, 0xb5, 0xb3, 0xb4),
      p('dirt start/finish line', 0x86, 0x89, 0x87, 0x88),
      p('icy start/finish line', 0x93, 0x96, 0x94, 0x95),
      p('crossroad', 0x4a),
      p('dirt crossroad', 0x7d),
      p('icy crossroad', 0x8a),
    ],
  },
  {
    name: 'Corners',
    pieces: [
      p('sharp corner', 0x06, 0x07, 0x08, 0x09),
      p('large corner', 0x0a, 0x0b, 0x0c, 0x0d),
      p('dirt sharp corner', 0x10, 0x11, 0x12, 0x13),
      p('dirt large corner', 0x14, 0x15, 0x16, 0x17),
      p('icy sharp corner', 0x1a, 0x1b, 0x1c, 0x1d),
      p('icy large corner', 0x1e, 0x1f, 0x20, 0x21),
      p('banked corner', 0x34, 0x35, 0x36, 0x37),
      p('split sharp corner', 0x4f, 0x4b, 0x4d, 0x51, 0x4c, 0x52, 0x50, 0x4e),
      p('split large corner', 0x5b, 0x57, 0x59, 0x5d, 0x58, 0x5e, 0x5c, 0x5a),
      p('dirt split corner', 0x82, 0x7e, 0x80, 0x84, 0x7f, 0x85, 0x83, 0x81),
      p('icy split corner', 0x8f, 0x8b, 0x8d, 0x91, 0x8c, 0x92, 0x90, 0x8e),
      p('chicane', 0x3c, 0x3e, 0x3d, 0x3f),
    ],
  },
  {
    name: 'Elevated',
    pieces: [
      p('elevated road', 0x22, 0x23),
      p('solid elevated road', 0x63, 0x64),
      p('elevated span over road', 0x65, 0x66),
      p('elevated span', 0x67, 0x68),
      p('elevated corner', 0x69, 0x6a, 0x6b, 0x6c),
      p('elevated ramp', 0x26, 0x25, 0x27, 0x24),
      p('bridge ramp', 0x3a, 0x39, 0x3b, 0x38),
      p('solid ramp', 0x61, 0x60, 0x62, 0x5f),
    ],
  },
  {
    name: 'Specials',
    pieces: [
      p('loop', 0x40, 0x41),
      p('tunnel', 0x42, 0x43),
      p('pipe', 0x44, 0x45),
      p('pipe start/end', 0x46, 0x48, 0x47, 0x49),
      p('pipe obstacle', 0x53, 0x54),
      p('slalom road', 0x73, 0x74),
      p('highway', 0x6d, 0x6e),
      p('highway start/end', 0x6f, 0x72, 0x71, 0x70),
      p('banked road', 0x32, 0x30, 0x33, 0x31),
      p('banked road start/end', 0x28, 0x2e, 0x2a, 0x2c, 0x2f, 0x2b, 0x2d, 0x29),
      p('corkscrew', 0x55, 0x56),
      p('left corkscrew up/down', 0x75, 0x76, 0x77, 0x78),
      p('right corkscrew up/down', 0x79, 0x7a, 0x7b, 0x7c),
    ],
  },
  {
    name: 'Scenery',
    pieces: [
      p('palm tree', 0x97),
      p('cactus', 0x98),
      p('pine tree', 0x99),
      p('tennis court', 0x9a),
      p('gas station', 0x9b, 0x9c, 0x9d, 0x9e),
      p('barn', 0x9f, 0xa0, 0xa1, 0xa2),
      p('office building', 0xa3, 0xa4, 0xa5, 0xa6),
      p('windmill', 0xa7, 0xa8, 0xa9, 0xaa),
      p('ship', 0xad, 0xae, 0xac, 0xab),
      p("Joe's diner", 0xaf, 0xb0, 0xb1, 0xb2),
    ],
  },
  {
    name: 'Terrain',
    pieces: [
      t('flat ground', 0x00),
      t('water', 0x01),
      t('coast', 0x05, 0x02, 0x03, 0x04),
      t('hill', 0x06),
      t('hill slope', 0x07, 0x08, 0x09, 0x0a),
      t('angled slope (high corner)', 0x0b, 0x0c, 0x0d, 0x0e),
      t('angled slope (low corner)', 0x11, 0x12, 0x0f, 0x10),
    ],
  },
];

const ELEMENT_NAMES = new Map<number, string>();
const TERRAIN_NAMES = new Map<number, string>();
for (const c of CATALOG) for (const pc of c.pieces) for (const code of pc.codes) (pc.terrain ? TERRAIN_NAMES : ELEMENT_NAMES).set(code, pc.name);

/** What the original's editor would call a tile (element, else terrain). */
export function tileName(track: Track, x: number, z: number): string {
  const a = anchorOf(track, x, z);
  const code = a ? track.elements[a[0]]![a[1]]! : 0;
  if (code !== 0) return ELEMENT_NAMES.get(code) ?? 'unknown piece';
  return TERRAIN_NAMES.get(track.terrain[x]![z]!) ?? 'flat ground';
}

export const FILLER_SW = 0xfe;
export const FILLER_SE = 0xfd;
export const FILLER_NE = 0xff;

/** Tiles a piece covers: it extends east (w) and south (h) from its anchor, as in the original. */
export function footprintOf(code: number): { w: number; h: number } {
  const multi = ELEMENT_SHAPES[code]?.multi ?? 0;
  return multi === 3 ? { w: 2, h: 2 } : multi === 1 ? { w: 1, h: 2 } : multi === 2 ? { w: 2, h: 1 } : { w: 1, h: 1 };
}

const inGrid = (x: number, z: number): boolean => x >= 0 && x < GRID && z >= 0 && z < GRID;

/** The anchor tile of the piece covering (x, z), or null for an empty tile. */
export function anchorOf(track: Track, x: number, z: number): [number, number] | null {
  const code = track.elements[x]?.[z] ?? 0;
  if (code === 0) return null;
  if (code === FILLER_SW) return inGrid(x, z + 1) ? [x, z + 1] : null;
  if (code === FILLER_SE) return inGrid(x - 1, z + 1) ? [x - 1, z + 1] : null;
  if (code === FILLER_NE) return inGrid(x - 1, z) ? [x - 1, z] : null;
  return [x, z];
}

/** Remove the piece covering (x, z), with all its tiles. */
export function removeAt(track: Track, x: number, z: number): void {
  const a = anchorOf(track, x, z);
  if (!a) {
    if (inGrid(x, z)) track.elements[x]![z] = 0; // a stray filler
    return;
  }
  const { w, h } = footprintOf(track.elements[a[0]]![a[1]]!);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (inGrid(a[0] + i, a[1] - j)) track.elements[a[0] + i]![a[1] - j] = 0;
}

/** Place a piece with its anchor at (x, z); false when it doesn't fit on the grid. */
export function placeAt(track: Track, x: number, z: number, code: number): boolean {
  const { w, h } = footprintOf(code);
  if (!inGrid(x, z) || !inGrid(x + w - 1, z - h + 1)) return false;
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) removeAt(track, x + i, z - j);
  track.elements[x]![z] = code;
  if (h > 1) track.elements[x]![z - 1] = FILLER_SW;
  if (w > 1) track.elements[x + 1]![z] = FILLER_NE;
  if (w > 1 && h > 1) track.elements[x + 1]![z - 1] = FILLER_SE;
  return true;
}

export function setTerrain(track: Track, x: number, z: number, code: number): void {
  if (inGrid(x, z)) track.terrain[x]![z] = code;
}

const STARTS = new Set([0x01, 0xb5, 0xb3, 0xb4, 0x86, 0x89, 0x87, 0x88, 0x93, 0x96, 0x94, 0x95]);
export const isStart = (code: number): boolean => STARTS.has(code);

/** Number of start/finish lines (a drivable track has exactly one). */
export function startCount(track: Track): number {
  let n = 0;
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) if (isStart(track.elements[x]![z]!)) n++;
  return n;
}
