import { ELEMENT_SHAPES } from '../original/elementTable.generated';
import { buildRoute } from '../race/route';
import { ELEMENT_NAMES, PALETTE_PAGES } from './editorTables.generated';
import { findStart } from './start';
import { buildTrack } from './trackBuilder';
import { GRID, type Track } from './trkFormat';

/*
 * Editing a track like the original's track editor (pure data, no drawing): its palette pages and
 * piece names (editorTables.generated.ts, from the original's TEDIT.PRE), placing and removing
 * pieces with the fillers bigger pieces need, its placement rules and its track check (skill
 * `stunts-track-format` for the codes, the original's messages for the rules).
 */

export { PALETTE_PAGES };

/** The palette's code for the other tiles of a bigger piece: to its east / south of it. */
export const PALETTE_EAST = 255;
export const PALETTE_SOUTH = 254;

/** What the original's editor calls the piece covering a tile ("" for none). */
export function tileName(track: Track, x: number, z: number): string {
  const a = anchorOf(track, x, z);
  return a ? elementName(track.elements[a[0]]![a[1]]!) : '';
}

export function elementName(code: number): string {
  return (ELEMENT_NAMES[code] ?? '').trim();
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

/** Place a piece with its anchor at (x, z) (0 erases); false when it doesn't fit on the grid. */
export function placeAt(track: Track, x: number, z: number, code: number): boolean {
  const { w, h } = footprintOf(code);
  if (!inGrid(x, z) || !inGrid(x + w - 1, z - h + 1)) return false;
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) removeAt(track, x + i, z - j);
  if (code === 0) return true;
  track.elements[x]![z] = code;
  if (h > 1) track.elements[x]![z - 1] = FILLER_SW;
  if (w > 1) track.elements[x + 1]![z] = FILLER_NE;
  if (w > 1 && h > 1) track.elements[x + 1]![z - 1] = FILLER_SE;
  return true;
}

const STARTS = new Set([0x01, 0xb5, 0xb3, 0xb4, 0x86, 0x89, 0x87, 0x88, 0x93, 0x96, 0x94, 0x95]);
export const isStart = (code: number): boolean => STARTS.has(code);

/** Number of start/finish lines (a drivable track has exactly one). */
export function startCount(track: Track): number {
  let n = 0;
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) if (isStart(track.elements[x]![z]!)) n++;
  return n;
}

// The original's messages ("]" breaks a line in its strings).
export const MESSAGES = {
  water: ['Limited objects allowed on water.', 'Only Overpass pieces with stilts,', 'overpass span & boat allowed.'],
  angled: ['No Objects are Allowed on', 'the angled terrain edge blocks.'],
  slope: ['Only straight roads, or', 'elevated ramp is allowed', 'on straight edges of terrain.'],
  noStart: ['No start/finish', 'line on track.', 'Must have one.'],
  manyStarts: ['Too many start/finish', 'lines on track.', 'Use one only.'],
  noPath: ['Must be at least one', 'complete path around the track.'],
  ok: ['Track ok.'],
};

/** Pieces allowed on water: elevated road on stilts, elevated span and the boat. */
const ON_WATER = new Set([0x22, 0x23, 0x67, 0x68, 0xab, 0xac, 0xad, 0xae]);
/** Straight roads (north-south, east-west) and elevated ramps (by the way they climb). */
const ROAD_AXIS = new Map<number, 'NS' | 'EW'>([
  [0x04, 'NS'], [0x05, 'EW'], [0x0e, 'NS'], [0x0f, 'EW'], [0x18, 'NS'], [0x19, 'EW'],
  [0x26, 'NS'], [0x27, 'NS'], [0x24, 'EW'], [0x25, 'EW'],
]);

/**
 * The original's placement rules, checked on every tile the piece would cover: nothing but
 * overpasses and the boat on water, nothing on the angled hill and coast corners, and only
 * roads or elevated ramps running straight up or down a slope. Returns the message, or null.
 */
export function placementError(track: Track, x: number, z: number, code: number): string[] | null {
  if (code === 0) return null;
  const { w, h } = footprintOf(code);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const t = track.terrain[x + i]?.[z - j] ?? 0;
      if (t === 0x01 && !ON_WATER.has(code)) return MESSAGES.water;
      if ((t >= 0x02 && t <= 0x05) || (t >= 0x0b && t <= 0x12)) return MESSAGES.angled;
      if (t >= 0x07 && t <= 0x0a) {
        const axis = t === 0x07 || t === 0x09 ? 'NS' : 'EW';
        if (ROAD_AXIS.get(code) !== axis) return MESSAGES.slope;
      }
    }
  }
  return null;
}

/** The original's track check ("C" in the editor, and before driving). */
export function checkTrack(track: Track): string[] {
  const n = startCount(track);
  if (n === 0) return MESSAGES.noStart;
  if (n > 1) return MESSAGES.manyStarts;
  const start = findStart(track)!;
  const built = buildTrack(track, null);
  built.group.traverse((o) => {
    const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    m.geometry?.dispose();
    m.material?.dispose();
  });
  const route = buildRoute(built.pieces, start.dir);
  return route?.closed ? MESSAGES.ok : MESSAGES.noPath;
}

/** A terrain background for a new track from the original's presets (rows north first). */
export function terrainFromPreset(bytes: Uint8Array | null): number[][] {
  const grid = Array.from({ length: GRID }, () => new Array<number>(GRID).fill(0));
  if (!bytes) return grid;
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) grid[x]![z] = bytes[(GRID - 1 - z) * GRID + x] ?? 0;
  return grid;
}
