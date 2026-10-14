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
  /** Centre line of the whole lap in driving order (east, north, up), for drivers and opponents. */
  line3d: [number, number, number][];
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
  // Depth-first search with backtracking: at forks (split corners) and crossroads several pieces
  // continue from the same point; we want the way that leads back to start/finish, and failing
  // that, the longest way found.
  const ordered: TrackPiece[] = [start];
  const dirs: [number, number][] = [unit(startEntry, start.ends[startExit]!)];
  const used = new Set<TrackPiece>([start]);
  let best: { pieces: TrackPiece[]; dirs: [number, number][] } = { pieces: [...ordered], dirs: [...dirs] };
  let closed = false;
  let budget = 20000; // bounds the search on pathological tracks

  /**
   * Pieces that continue the road at `point`. After a ramp the road may continue further along
   * the same line instead: Stunts tracks jump over buildings, water and crossing roads.
   */
  const continuations = (point: [number, number]): { q: TrackPiece; end: [number, number] }[] => {
    const touching = pieces
      .filter((q) => !used.has(q))
      .flatMap((q) => q.ends.filter((e) => near(e, point)).map((end) => ({ q, end })));
    const last = ordered[ordered.length - 1]!;
    if (touching.length > 0 || last.kind !== 'ramp') return touching;
    const d = dirs[dirs.length - 1]!;
    let jump: { q: TrackPiece; end: [number, number]; dist: number } | null = null;
    for (const q of pieces) {
      if (used.has(q)) continue;
      for (const end of q.ends) {
        const dx = end[0] - point[0];
        const dy = end[1] - point[1];
        const ahead = dx * d[0] + dy * d[1];
        const side = Math.abs(dx * d[1] - dy * d[0]);
        if (ahead > 1 && ahead < 4.5 * TILE && side < 2 && (!jump || ahead < jump.dist)) jump = { q, end, dist: ahead };
      }
    }
    return jump ? [{ q: jump.q, end: jump.end }] : [];
  };

  const walk = (point: [number, number]): boolean => {
    if (--budget < 0) return false;
    if (ordered.length > 2 && near(point, startEntry)) return true;
    let progressed = false;
    for (const { q, end } of continuations(point)) {
      if (used.has(q)) continue;
      progressed = true;
      const entry = q.ends[0] === end ? 0 : 1;
      used.add(q);
      ordered.push(q);
      dirs.push(unit(q.ends[entry]!, q.ends[1 - entry]!));
      if (walk(q.ends[1 - entry]!)) return true;
      used.delete(q);
      ordered.pop();
      dirs.pop();
    }
    if (!progressed && ordered.length > best.pieces.length) best = { pieces: [...ordered], dirs: [...dirs] };
    return false;
  };
  closed = walk(start.ends[startExit]!);
  if (!closed) {
    ordered.length = 0;
    ordered.push(...best.pieces);
    dirs.length = 0;
    dirs.push(...best.dirs);
  }

  const cellIndex = new Map<number, number>();
  ordered.forEach((p, i) => p.cells.forEach(([x, z]) => cellIndex.set(cellKey(x, z), i)));
  const [cx, cz] = start.anchor;
  // Centre line in driving order: each piece's path, reversed when driven from its far end.
  const line3d: [number, number, number][] = [];
  ordered.forEach((p, i) => {
    const d = dirs[i]!;
    const forward = (p.ends[1][0] - p.ends[0][0]) * d[0] + (p.ends[1][1] - p.ends[0][1]) * d[1] >= 0;
    const pts = forward ? p.path : [...p.path].reverse();
    for (const q of pts) {
      const last = line3d[line3d.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.5) line3d.push(q);
    }
  });
  return {
    pieces: ordered,
    dirs,
    closed,
    cellIndex,
    line3d,
    line: { centre: [(cx + 0.5) * TILE, (cz + 0.5) * TILE], dir: sd },
  };
}

/** Index of the route element under a position, or -1 when off the route. */
export function elementAt(route: Route, e: number, n: number): number {
  return route.cellIndex.get(cellKey(Math.floor(e / TILE), Math.floor(n / TILE))) ?? -1;
}
