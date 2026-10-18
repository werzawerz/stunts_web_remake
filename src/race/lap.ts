import { elementAt, type Route } from './route';
import type { Vec3 } from '../physics/vec';
import { TILE } from '../track/constants';
import type { PathGraph } from '../track/check';
import { GRID } from '../track/trkFormat';

/*
 * Lap timing and the original's shortcut penalty, as the game works it out (restunts disassembly,
 * read for facts only; wiki.stunts.hu/wiki/Penalty_time describes the effects):
 *
 * The track's path is the graph the track check records (PathGraph): pieces in order, each with up
 * to two that follow it, so every way through a fork is part of the track. Whenever the car's tile
 * leaves the piece it was last seen on, the game searches the path ahead of the last confirmed
 * piece for the nearest piece covering that tile, counting the pieces passed over:
 *  - 0-2 passed over: fine, that piece is confirmed;
 *  - more (a shortcut): the car must then drive three pieces in a row along the path before the
 *    new piece is confirmed; the penalty is 3 s for every piece passed over by then (so at least
 *    18 s: 3 skipped + the 3 driven);
 *  - reaching the start/finish piece: whatever was passed over costs 3 s each;
 *  - not found ahead (or off the map): lost, no penalty, until it finds the path again.
 * Only tiles count, not heights. Pure and deterministic: driven by the car position every tick.
 */

export type LapPhase = 'ready' | 'running' | 'finished';

export interface LapState {
  phase: LapPhase;
  /** Ticks since the clock started. */
  ticks: number;
  penaltySec: number;
  /** Driving against the route direction (for the HUD). */
  wrongWay: boolean;
  /** Last confirmed piece of the path (index into the PathGraph). */
  confirmed: number;
  /** Piece the car was last found on. */
  last: number;
  /** 0 on the path, 1 lost (not found ahead), 2 going backwards along it. */
  lost: 0 | 1 | 2;
  /** Pieces driven in a row since a shortcut. */
  streak: number;
  /** Tiles of the piece the car was last found on: no search while it stays on them. */
  box: [number, number, number, number] | null;
  /** The start/finish piece has been reached from the path: the lap is complete at the line. */
  lapDone: boolean;
}

export function createLap(): LapState {
  return {
    phase: 'ready',
    ticks: 0,
    penaltySec: 0,
    wrongWay: false,
    confirmed: 0,
    last: 0,
    lost: 0,
    streak: 0,
    box: null,
    lapDone: false,
  };
}

/** Elapsed race time in seconds including penalties. */
export const lapTotal = (s: LapState, hz = 60): number => s.ticks / hz + s.penaltySec;

const PENALTY_PER_PIECE = 3;

const isNext = (g: PathGraph, a: number, b: number): boolean => g.next1[a] === b || g.next2[a] === b;

/**
 * Search the path ahead of the confirmed piece for the car's tile. Null while the car stays on
 * the piece it was last found on; otherwise the piece found and how many were passed over (-1
 * once the search went past start/finish, -2 when not found at all).
 */
function find(g: PathGraph, s: LapState, tx: number, tz: number): { piece: number; passed: number } | null {
  const b = s.box;
  if (b && tx >= b[0] && tx <= b[1] && tz >= b[2] && tz <= b[3]) return null;
  if (tx < 0 || tx >= GRID || tz < 0 || tz >= GRID) return { piece: s.confirmed, passed: -2 };
  const seen = new Uint8Array(g.pieces.length);
  const forks: { from: number; passed: number }[] = [];
  let best: { piece: number; passed: number } | null = null;
  let from = s.confirmed;
  let passed = 0;
  for (;;) {
    const v = g.next1[from] ?? -1;
    if (v < 0 || seen[v]) {
      // This way is exhausted: try a fork's other way, else settle on the best match.
      const f = forks.pop();
      if (f) {
        ({ from, passed } = f);
        continue;
      }
      if (best) return best;
      s.box = [tx, tx, tz, tz];
      return { piece: s.confirmed, passed: -2 };
    }
    seen[v] = 1;
    const p = g.pieces[v]!;
    if (tx >= p.x0 && tx <= p.x1 && tz >= p.z0 && tz <= p.z1) {
      // On the first piece after a fork the fork itself stays the reference.
      const piece = g.next2[from] !== -1 ? from : v;
      s.box = [p.x0, p.x1, p.z0, p.z1];
      if (passed <= 0) return { piece, passed };
      if (!best || passed < best.passed) best = { piece, passed };
    }
    // The other way out of a fork is followed later, from its own next piece on.
    const other = g.next2[from]!;
    if (other !== -1) forks.push({ from: other, passed });
    if (v === 0) passed = -1;
    else if (passed !== -1) passed++;
    from = v;
  }
}

/** The original's bookkeeping after a search: confirm pieces, and add penalties. */
function track(g: PathGraph, s: LapState, tx: number, tz: number): void {
  const r = find(g, s, tx, tz);
  if (!r) return;
  const { piece, passed } = r;
  if (passed === -2) {
    s.lost = 1;
    s.streak = 0;
  } else if (s.lost === 1) {
    s.lost = 0;
    s.streak = 0;
  }
  if (s.lost === 0) {
    const confirm = (): void => {
      s.confirmed = piece;
      s.streak = 0;
      if (passed > 0) s.penaltySec += PENALTY_PER_PIECE * passed;
    };
    if (piece === 0 && s.last !== 0) {
      s.lapDone = true;
      confirm();
    } else if (passed >= 0 && passed < 3) {
      s.streak = 0;
      s.confirmed = piece;
    } else if (passed === -1 || passed > 3) {
      if (isNext(g, s.last, piece)) s.streak++;
      else {
        if (isNext(g, piece, s.last)) s.lost = 2;
        s.streak = 1;
      }
      if (s.streak >= 3) confirm();
    }
  }
  s.last = piece;
}

/**
 * Advance one tick. `moving` starts the clock (the race starts when the car first moves);
 * `crashed` freezes it.
 */
export function stepLap(s: LapState, route: Route, pos: Vec3, vel: Vec3, moving: boolean, crashed: boolean): void {
  if (s.phase === 'finished' || crashed) return;
  if (s.phase === 'ready') {
    if (!moving) return;
    s.phase = 'running';
  }
  s.ticks++;

  // Wrong way (HUD): moving against the route direction of the element we are on. Not inside
  // loops: over the top of the ring the car really moves backwards, while going the right way.
  const p = elementAt(route, pos[0], pos[1], 1, pos[2]);
  if (p >= 0) {
    const d = route.dirs[p]!;
    s.wrongWay = route.pieces[p]!.kind !== 'loop' && vel[0] * d[0] + vel[1] * d[1] < -3;
  }

  // Tracks that fail the track check have no path: they can't be raced.
  const g = route.graph;
  if (!g) return;
  const st = g.pieces[0]!;
  s.box ??= [st.x0, st.x1, st.z0, st.z1];
  const tx = Math.floor(pos[0] / TILE);
  const tz = Math.floor(pos[1] / TILE);
  track(g, s, tx, tz);

  // Finish: over the start/finish line once the lap is complete.
  if (s.lapDone && tx >= st.x0 && tx <= st.x1 && tz >= st.z0 && tz <= st.z1) {
    const { centre, dir } = route.line;
    const past = (pos[0] - centre[0]) * dir[0] + (pos[1] - centre[1]) * dir[1];
    if (past >= 0 && past < 30) s.phase = 'finished';
  }
}
