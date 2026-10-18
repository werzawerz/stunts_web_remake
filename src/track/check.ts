import { ELEMENT_PATHS } from './elementPaths.generated';
import { GRID, type Track } from './trkFormat';

/*
 * The original's track check, as its track editor ("C", and before a track can be driven) and the
 * race setup apply it. Rules worked out from the game (restunts disassembly, read for facts only);
 * the code is ours. In order:
 *
 *  1. Terrain edges: neighbouring terrain tiles must meet at the same height profile (a hill
 *     can't just stop at flat ground without a slope, slopes must line up).
 *  2. Exactly one start/finish line.
 *  3. The path, followed from the start/finish line in its driving direction. Each element has
 *     one or more paths through it (ELEMENT_PATHS: entry and exit edge, and the road's type at
 *     each end: ground, elevated, banked, pipe...). Entering an element its type must match what
 *     the previous one ended with. Forks are all followed. A path ends when it gets back onto an
 *     element it already drove (driving it the other way is "wrong way"), or when the road
 *     simply stops (allowed). Leaving an elevated end into empty tiles is a jump: at most one
 *     empty tile, after at least two plain pieces of run-up. At least one path must get back to
 *     the start/finish line.
 */

export type TrackError =
  | 'terrainEdge'
  | 'manyStarts'
  | 'noStart'
  | 'longJump'
  | 'internal'
  | 'wrongWay'
  | 'manyPaths'
  | 'joinMismatch'
  | 'noRunway'
  | 'noPath'
  | 'manyPieces';

/** The original editor's messages ("]" breaks its lines). */
export const TRACK_ERROR_TEXT: Record<TrackError | 'ok', string[]> = {
  terrainEdge: ['Terrain Edge mismatch error!'],
  manyStarts: ['Too many start/finish', 'lines on track.', 'Use one only.'],
  noStart: ['No start/finish', 'line on track.', 'Must have one.'],
  longJump: ['Jump distance is long.', 'Only one block may be jumped!'],
  internal: ['Internal error.'],
  wrongWay: ['Track allows travelling', 'wrong way.', 'Only one direction allowed.'],
  manyPaths: ['Internal error.', 'Path stack overflow.', 'Reduce number paths.'],
  joinMismatch: ['Joining edge of track piece', 'and previous track piece', 'must be the same.'],
  noRunway: ['Straightaway before', 'jump is too short!'],
  noPath: ['Must be at least one', 'complete path around the track.'],
  manyPieces: ['Internal error.', 'Too many track pieces.', 'Make track shorter.'],
  ok: ['Track ok.'],
};

export interface TrackCheck {
  error: TrackError | null;
  /** Where the check stopped (the tile it was looking at), for pointing the cursor at it. */
  at: [number, number] | null;
}

// Terrain edge profiles per terrain code 0x00-0x12, one table per side: 0 ground level, 1 hill
// level, 2/3 the sides of slopes rising west/east, 4/5 the sides of slopes rising south/north.
const EDGE_EAST = [0, 0, 0, 0, 0, 0, 1, 2, 0, 3, 1, 0, 0, 3, 2, 2, 3, 1, 1];
const EDGE_WEST = [0, 0, 0, 0, 0, 0, 1, 2, 1, 3, 0, 2, 3, 0, 0, 1, 1, 3, 2];
const EDGE_NORTH = [0, 0, 0, 0, 0, 0, 1, 1, 5, 0, 4, 5, 0, 0, 4, 1, 5, 4, 1];
const EDGE_SOUTH = [0, 0, 0, 0, 0, 0, 1, 0, 5, 1, 4, 0, 5, 4, 0, 5, 1, 1, 4];

type Dir = 'N' | 'E' | 'S' | 'W';
const STEP: Record<Dir, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };

/** Start/finish codes and the way they face. */
const START_DIR = new Map<number, Dir>([
  [0x01, 'N'], [0x86, 'N'], [0x93, 'N'],
  [0xb4, 'E'], [0x88, 'E'], [0x95, 'E'],
  [0xb3, 'S'], [0x87, 'S'], [0x94, 'S'],
  [0xb5, 'W'], [0x89, 'W'], [0x96, 'W'],
]);

/**
 * Roads and ramps on slopes are driven as their own elements (0xB6..0xC5): straight roads going up
 * or down the slope, and ramps climbing against it. Anything else on a slope isn't track.
 */
const ON_SLOPE: Record<number, [number[], number][]> = {
  0x07: [[[0x04], 0xb6], [[0x0e], 0xba], [[0x18], 0xbe], [[0x27, 0x3b, 0x62], 0xc2]],
  0x08: [[[0x05], 0xb7], [[0x0f], 0xbb], [[0x19], 0xbf], [[0x24, 0x38, 0x5f], 0xc3]],
  0x09: [[[0x04], 0xb8], [[0x0e], 0xbc], [[0x18], 0xc0], [[0x26, 0x3a, 0x61], 0xc4]],
  0x0a: [[[0x05], 0xb9], [[0x0f], 0xbd], [[0x19], 0xc1], [[0x25, 0x39, 0x60], 0xc5]],
};
export function onSlope(terrain: number, code: number): number {
  const subs = ON_SLOPE[terrain];
  if (!subs) return code;
  return subs.find(([codes]) => codes.includes(code))?.[1] ?? 0;
}

/**
 * Edge points of an element's tiles (anchor = the NW tile): 1 north, 2 south, 3 east, 4 west of
 * the anchor; then the other tiles of bigger pieces. Leaving through a point: the next tile
 * (offset from the anchor) and heading.
 */
const EXIT: Record<number, [number, number, Dir]> = {
  1: [0, 1, 'N'],
  2: [0, -1, 'S'],
  3: [1, 0, 'E'],
  4: [-1, 0, 'W'],
  5: [1, 1, 'N'],
  6: [-1, -1, 'W'],
  7: [1, -1, 'E'],
  8: [2, 0, 'E'],
  9: [2, -1, 'E'],
  10: [1, -1, 'S'],
  11: [0, -2, 'S'],
  12: [1, -2, 'S'],
};
/** Entering a tile heading `dir`: the point on its own edge. */
const ENTRY: Record<Dir, number> = { N: 2, E: 4, S: 1, W: 3 };
/** Entering the other tiles of bigger pieces: offset to the anchor, and the point per heading. */
const FILLER_ENTRY: Record<number, { to: [number, number]; at: Partial<Record<Dir, number>> }> = {
  0xfd: { to: [-1, 1], at: { N: 12, W: 9 } }, // south-east tile of a 2x2
  0xfe: { to: [0, 1], at: { N: 11, E: 6, W: 7 } }, // south tile
  0xff: { to: [-1, 0], at: { N: 10, S: 5, W: 8 } }, // east tile
};

const MAX_BRANCHES = 64;
const MAX_PIECES = 0x385;

interface Branch {
  x: number;
  z: number;
  code: number;
  block: number;
  backward: boolean;
  type: number;
  runway: number;
  prevX: number;
  prevZ: number;
}

export function checkTrackPath(track: Track): TrackCheck {
  const terr = (x: number, z: number): number => track.terrain[x]?.[z] ?? 0;
  const inGrid = (x: number, z: number): boolean => x >= 0 && x < GRID && z >= 0 && z < GRID;

  // 1. Terrain edges.
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const t = terr(x, z);
      if (x + 1 < GRID && EDGE_EAST[t] !== EDGE_WEST[terr(x + 1, z)]) return { error: 'terrainEdge', at: [x, z] };
      if (z > 0 && EDGE_SOUTH[t] !== EDGE_NORTH[terr(x, z - 1)]) return { error: 'terrainEdge', at: [x, z] };
    }
  }

  // 2. One start/finish line.
  let start: { x: number; z: number; dir: Dir } | null = null;
  for (let z = GRID - 1; z >= 0; z--) {
    for (let x = 0; x < GRID; x++) {
      const dir = START_DIR.get(track.elements[x]![z]!);
      if (!dir) continue;
      if (start) return { error: 'manyStarts', at: [x, z] };
      start = { x, z, dir };
    }
  }
  if (!start) return { error: 'noStart', at: null };

  // 3. The path.
  const elem = (x: number, z: number): number => {
    const c = track.elements[x]![z]!;
    return c >= 0xb6 && c < 0xfd ? 0x04 : c; // stray slope codes in a file read as plain road
  };
  const visited: { x: number; z: number; block: number; backward: boolean }[] = [];
  const stack: Branch[] = [];
  let complete = false;
  // Where we are, heading where, and what the road was when it left the previous element.
  let x = start.x;
  let z = start.z;
  let dir: Dir = start.dir;
  let type = 0;
  let runway = 0;
  let gap = 0;
  let prevX = start.x;
  let prevZ = start.z;

  for (;;) {
    let next: Branch | null = null;
    if (inGrid(x, z)) {
      let code = elem(x, z);
      const t = terr(x, z);
      if (code !== 0 && t >= 0x07 && t <= 0x0a) code = onSlope(t, code);
      let ax = x;
      let az = z;
      let entry = 0;
      const filler = FILLER_ENTRY[code];
      if (filler) {
        ax = x + filler.to[0];
        az = z + filler.to[1];
        entry = filler.at[dir] ?? 0;
        code = inGrid(ax, az) ? elem(ax, az) : 0;
      } else entry = ENTRY[dir];
      if (gap === 0 && entry === 0) return { error: 'internal', at: [x, z] };

      const found: Branch[] = [];
      for (const [b, [inPt, outPt, inType, outType]] of (ELEMENT_PATHS[code] ?? []).entries()) {
        let backward: boolean;
        if (inPt === entry) {
          if (inType !== type) return { error: 'joinMismatch', at: [ax, az] };
          backward = false;
        } else if (outPt === entry) {
          if (outType !== type) return { error: 'joinMismatch', at: [ax, az] };
          backward = true;
        } else continue;
        // Back onto a piece already driven: the same way ends this path (at the start/finish
        // line: a complete lap), the other way is driving the track backwards.
        let closed = false;
        for (const [i, v] of visited.entries()) {
          if (v.x !== ax || v.z !== az || v.block !== b) continue;
          if (v.backward !== backward) return { error: 'wrongWay', at: [ax, az] };
          closed = true;
          if (i === 0) complete = true;
        }
        if (closed) continue;
        found.push({ x: ax, z: az, code, block: b, backward, type, runway, prevX, prevZ });
      }
      if (found.length > 0) {
        for (const extra of found.slice(1)) {
          if (stack.length >= MAX_BRANCHES) return { error: 'manyPaths', at: [ax, az] };
          stack.push(extra);
        }
        next = found[0]!;
      }
    }

    if (!next) {
      // Off an elevated end: a jump over at most one empty tile, after a run-up (never off the map).
      if (inGrid(x, z) && type === 1 && gap < 2) {
        if (runway < 2) return { error: 'noRunway', at: [prevX, prevZ] };
        runway++;
        gap++;
        const [dx, dz] = STEP[dir];
        x = prevX + dx * (gap + 1);
        z = prevZ + dz * (gap + 1);
        continue;
      }
      // The road ends here: carry on with a fork left for later.
      const b = stack.pop();
      if (!b) return complete ? { error: null, at: null } : { error: 'noPath', at: null };
      next = b;
      ({ type, runway, prevX, prevZ } = b);
    }

    // Drive through the element.
    if (gap > 1) return { error: 'longJump', at: [next.x, next.z] };
    gap = 0;
    visited.push({ x: next.x, z: next.z, block: next.block, backward: next.backward });
    const [inPt, outPt, inType, outType, plain] = ELEMENT_PATHS[next.code]![next.block]!;
    runway = plain === 0 ? runway + 1 : 0;
    if (visited.length >= MAX_PIECES) return { error: 'manyPieces', at: [next.x, next.z] };
    const exit = next.backward ? inPt : outPt;
    type = next.backward ? inType : outType;
    prevX = next.x;
    prevZ = next.z;
    const step = EXIT[exit];
    if (!step) {
      x = -1; // nowhere to go: the road ends
      z = -1;
      continue;
    }
    x = next.x + step[0];
    z = next.z + step[1];
    dir = step[2];
  }
}
