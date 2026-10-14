import { TILE } from '../track/constants';
import type { TrackPiece } from '../track/trackBuilder';
import type { Dir } from '../track/tiles';

/** The track as the race sees it: road elements in driving order, starting with start/finish. */
export interface Route {
  /** Elements in order; [0] is the start/finish element. */
  pieces: TrackPiece[];
  /** Driving direction through each element: from its entry end to its exit end (unit, east/north). */
  dirs: [number, number][];
  /** True when the route returns to start/finish. */
  closed: boolean;
  /** Tile key → element index (elements cover whole tiles, like the original's penalty check). */
  cellIndex: Map<number, number>;
  /** Start line: centre (east, north) and driving direction. */
  line: { centre: [number, number]; dir: [number, number] };
}

const cellKey = (x: number, z: number): number => x * 1000 + z;
const DIR: Record<Dir, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };

const near = (a: [number, number], b: [number, number]): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2;

/**
 * Follow the road from the start/finish element: each element continues where the previous one
 * ended. Pieces not on the route (dead ends, scenery roads) are simply not part of it.
 */
export function buildRoute(pieces: TrackPiece[], startDir: Dir): Route | null {
  const start = pieces.find((p) => p.kind === 'start');
  if (!start) return null;
  const sd = DIR[startDir];
  // Exit of the start element = the end lying further along the driving direction.
  const along = (q: [number, number]): number => q[0] * sd[0] + q[1] * sd[1];
  const startExit = along(start.ends[1]) >= along(start.ends[0]) ? 1 : 0;
  const startEntry = start.ends[1 - startExit]!;
  const unit = (from: [number, number], to: [number, number]): [number, number] => {
    const l = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  };
  const ordered: TrackPiece[] = [start];
  const dirs: [number, number][] = [unit(startEntry, start.ends[startExit]!)];

  let point = start.ends[startExit]!;
  let closed = false;
  for (let guard = 0; guard < pieces.length; guard++) {
    const next = pieces.find((q) => !ordered.includes(q) && (near(q.ends[0], point) || near(q.ends[1], point)));
    if (!next) {
      closed = near(point, startEntry);
      break;
    }
    const entry = near(next.ends[0], point) ? 0 : 1;
    ordered.push(next);
    dirs.push(unit(next.ends[entry]!, next.ends[1 - entry]!));
    point = next.ends[1 - entry]!;
  }

  const cellIndex = new Map<number, number>();
  ordered.forEach((p, i) => p.cells.forEach(([x, z]) => cellIndex.set(cellKey(x, z), i)));
  const [cx, cz] = start.anchor;
  return {
    pieces: ordered,
    dirs,
    closed,
    cellIndex,
    line: { centre: [(cx + 0.5) * TILE, (cz + 0.5) * TILE], dir: sd },
  };
}

/** Index of the route element under a position, or -1 when off the route. */
export function elementAt(route: Route, e: number, n: number): number {
  return route.cellIndex.get(cellKey(Math.floor(e / TILE), Math.floor(n / TILE))) ?? -1;
}
