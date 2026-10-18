import { ELEMENT_SHAPES } from '../original/elementTable.generated';
import { checkTrackPath, onSlope, TRACK_ERROR_TEXT, type TrackCheck } from './check';
import { ELEMENT_NAMES, PALETTE_PAGES } from './editorTables.generated';
import { GRID, type Track } from './trkFormat';

/*
 * Editing a track like the original's track editor (pure data, no drawing): its palette pages and
 * piece names (editorTables.generated.ts, from the original's TEDIT.PRE), placing and removing
 * pieces with the fillers bigger pieces need, and its placement rules (skill `stunts-track-format`
 * for the codes, the original's messages for the rules). The track check is in check.ts.
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

// The original's placement messages ("]" breaks a line in its strings).
export const MESSAGES = {
  water: ['Limited objects allowed on water.', 'Only Overpass pieces with stilts,', 'overpass span & boat allowed.'],
  angled: ['No Objects are Allowed on', 'the angled terrain edge blocks.'],
  slope: ['Only straight roads, or', 'elevated ramp is allowed', 'on straight edges of terrain.'],
};

/** Pieces allowed on water: elevated road on stilts, elevated span and the boat. */
const ON_WATER = new Set([0x22, 0x23, 0x67, 0x68, 0xab, 0xac, 0xad, 0xae]);

/**
 * The original's placement rules, checked on every tile the piece would cover: nothing but
 * overpasses and the boat on water, nothing on the angled hill and coast corners, and on slopes
 * only straight roads going up or down and ramps climbing against the slope (to hill height), the
 * pieces the original drives as slope roads. Returns the message, or null.
 */
export function placementError(track: Track, x: number, z: number, code: number): string[] | null {
  if (code === 0) return null;
  const { w, h } = footprintOf(code);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const t = track.terrain[x + i]?.[z - j] ?? 0;
      if (t === 0x01 && !ON_WATER.has(code)) return MESSAGES.water;
      if ((t >= 0x02 && t <= 0x05) || (t >= 0x0b && t <= 0x12)) return MESSAGES.angled;
      if (t >= 0x07 && t <= 0x0a && onSlope(t, code) === 0) return MESSAGES.slope;
    }
  }
  return null;
}

/** The original's track check: its result and message (see check.ts). */
export function checkTrack(track: Track): TrackCheck & { message: string[] } {
  const r = checkTrackPath(track);
  return { ...r, message: TRACK_ERROR_TEXT[r.error ?? 'ok'] };
}

/** A terrain background for a new track from the original's presets (rows north first). */
export function terrainFromPreset(bytes: Uint8Array | null): number[][] {
  const grid = Array.from({ length: GRID }, () => new Array<number>(GRID).fill(0));
  if (!bytes) return grid;
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) grid[x]![z] = bytes[(GRID - 1 - z) * GRID + x] ?? 0;
  return grid;
}
