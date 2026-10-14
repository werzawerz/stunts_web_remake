import { elementAt, type Route } from './route';
import type { Vec3 } from '../physics/vec';

/*
 * Lap timing and the original's shortcut penalty (wiki.stunts.hu/wiki/Penalty_time):
 *  - an element counts as driven when the car touches any of its tiles;
 *  - skipping elements opens a "chain": the skipped elements + the re-entry element + the one after;
 *  - the chain closes when that last element is reached; more than 2 skipped ⇒ max(18 s, 3 s × chain);
 *  - leaving again before the chain closes extends it to everything since the first departure;
 *  - skipped elements right before start/finish always cost 3 s each.
 * Pure and deterministic: driven by the car position once per simulation tick.
 */

export type LapPhase = 'ready' | 'running' | 'finished';

export interface LapState {
  phase: LapPhase;
  /** Ticks since the clock started. */
  ticks: number;
  /** Next route element we expect the car to enter. */
  next: number;
  /** Open penalty chain: first skipped element and the re-entry element, or null. */
  chain: { firstSkipped: number; reentry: number } | null;
  penaltySec: number;
  /** Driving against the route direction. */
  wrongWay: boolean;
}

export function createLap(): LapState {
  return { phase: 'ready', ticks: 0, next: 1, chain: null, penaltySec: 0, wrongWay: false };
}

function chainPenalty(skipped: number): number {
  return skipped > 2 ? Math.max(18, 3 * (skipped + 2)) : 0;
}

/** Elapsed race time in seconds including penalties. */
export const lapTotal = (s: LapState, hz = 60): number => s.ticks / hz + s.penaltySec;

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

  const n = route.pieces.length;
  const p = elementAt(route, pos[0], pos[1]);

  // Wrong way: moving against the route direction of the element we are on. Not inside loops:
  // over the top of the ring the car really moves backwards, while going the right way round.
  if (p >= 0) {
    const d = route.dirs[p]!;
    s.wrongWay = route.pieces[p]!.kind !== 'loop' && vel[0] * d[0] + vel[1] * d[1] < -3;
  }

  // Finish: back on start/finish, past the line, with the lap complete (or skipped to the end).
  if (p === 0 && s.next > 1) {
    const { centre, dir } = route.line;
    const past = (pos[0] - centre[0]) * dir[0] + (pos[1] - centre[1]) * dir[1];
    if (past >= 0 && past < 30) {
      const firstSkipped = s.chain ? s.chain.firstSkipped : s.next;
      const skipped = n - firstSkipped;
      if (skipped > 0) s.penaltySec += skipped > 2 ? Math.max(18, 3 * skipped) : 3 * skipped;
      s.chain = null;
      s.next = n;
      s.phase = 'finished';
      return;
    }
  }

  if (p <= 0 || p < s.next) return; // off the route, or revisiting
  if (p === s.next) {
    s.next++;
    if (s.chain && p === s.chain.reentry + 1) {
      s.penaltySec += chainPenalty(s.chain.reentry - s.chain.firstSkipped);
      s.chain = null;
    }
    return;
  }
  // Skipped from s.next to p-1.
  if (s.chain) s.chain.reentry = p;
  else s.chain = { firstSkipped: s.next, reentry: p };
  s.next = p + 1;
}
