import { describe, expect, it } from 'vitest';
import { TILE } from '../track/constants';
import { buildSampleTrack } from '../track/sampleTrack';
import { buildTrack } from '../track/trackBuilder';
import { createLap, lapTotal, stepLap, type LapState } from './lap';
import { buildRoute, elementAt, type Route } from './route';
import type { Vec3 } from '../physics/vec';

const route = buildRoute(buildTrack(buildSampleTrack()).pieces, 'E')!;

/** Centre of an element's first tile, at road height 0. */
const at = (i: number): Vec3 => {
  const [x, z] = route.pieces[i]!.cells[0]!;
  return [(x + 0.5) * TILE, (z + 0.5) * TILE, 0];
};
const velAlong = (i: number): Vec3 => [route.dirs[i]![0] * 30, route.dirs[i]![1] * 30, 0];

/** Drive through the given elements (one tick each), then over the finish line. */
function drive(r: Route, visit: number[]): LapState {
  const s = createLap();
  const behindLine: Vec3 = [r.line.centre[0] - r.line.dir[0] * 12, r.line.centre[1] - r.line.dir[1] * 12, 0];
  stepLap(s, r, behindLine, velAlong(0), true, false);
  for (const i of visit) stepLap(s, r, at(i), velAlong(i), true, false);
  const pastLine: Vec3 = [r.line.centre[0] + r.line.dir[0] * 2, r.line.centre[1] + r.line.dir[1] * 2, 0];
  stepLap(s, r, pastLine, velAlong(0), true, false);
  return s;
}

const all = (from = 1, to = route.pieces.length): number[] => Array.from({ length: to - from }, (_, k) => from + k);
const without = (skip: number[]): number[] => all().filter((i) => !skip.includes(i));

describe('route', () => {
  it('follows the demo circuit from start/finish all the way round', () => {
    // Row 5 (16 tiles, the loop is one 2-tile element) + east column (16) + north row (16)
    // + west column (16) + 4 large corners.
    expect(route.closed).toBe(true);
    expect(route.pieces.length).toBe(15 + 16 + 16 + 16 + 4);
    expect(route.pieces[0]!.kind).toBe('start');
    expect(route.pieces[1]!.anchor).toEqual([11, 5]);
    expect(route.dirs[1]).toEqual([1, 0]);
    expect(route.pieces.some((p) => p.kind === 'loop')).toBe(true);
  });

  it('maps every tile of an element, including multi-tile ones', () => {
    const loopIdx = route.pieces.findIndex((p) => p.kind === 'loop');
    expect(elementAt(route, 14.5 * TILE, 5.5 * TILE)).toBe(loopIdx);
    expect(elementAt(route, 15.5 * TILE, 5.5 * TILE)).toBe(loopIdx);
    expect(elementAt(route, 15.5 * TILE, 15.5 * TILE)).toBe(-1); // the hill, off the route
  });
});

describe('lap and penalty (original rules)', () => {
  it('a clean lap finishes with no penalty', () => {
    const s = drive(route, all());
    expect(s.phase).toBe('finished');
    expect(s.penaltySec).toBe(0);
  });

  it('the clock waits until the car moves', () => {
    const s = createLap();
    stepLap(s, route, at(0), [0, 0, 0], false, false);
    expect(s.phase).toBe('ready');
    expect(s.ticks).toBe(0);
  });

  it('skipping up to two elements in a row is free', () => {
    expect(drive(route, without([10])).penaltySec).toBe(0);
    expect(drive(route, without([10, 11])).penaltySec).toBe(0);
  });

  it('skipping three costs the 18 s minimum (chain of 5 × 3 s = 15 s < 18 s)', () => {
    expect(drive(route, without([10, 11, 12])).penaltySec).toBe(18);
  });

  it('skipping five costs 3 s × chain of 7 = 21 s', () => {
    expect(drive(route, without([10, 11, 12, 13, 14])).penaltySec).toBe(21);
  });

  it('leaving again before the chain closes extends the chain', () => {
    // Skip 10-12, touch 13 only, then skip 14-16: one chain from 10 to re-entry 17 → 7 skipped, 9 in chain.
    expect(drive(route, without([10, 11, 12, 14, 15, 16])).penaltySec).toBe(27);
  });

  it('skipping elements just before the finish always costs 3 s each', () => {
    const n = route.pieces.length;
    expect(drive(route, all(1, n - 2)).penaltySec).toBe(6);
  });

  it('total time adds the penalty to the clock', () => {
    const s = drive(route, without([10, 11, 12]));
    expect(lapTotal(s)).toBeCloseTo(s.ticks / 60 + 18, 6);
  });

  it('does not say wrong way over the top of a loop', () => {
    const loopIdx = route.pieces.findIndex((q) => q.kind === 'loop');
    const s = createLap();
    stepLap(s, route, at(loopIdx - 1), velAlong(loopIdx - 1), true, false);
    const backwards = velAlong(loopIdx).map((v) => -v) as Vec3;
    stepLap(s, route, at(loopIdx), backwards, true, false);
    expect(s.wrongWay).toBe(false);
  });

  it('flags driving the wrong way', () => {
    const s = createLap();
    stepLap(s, route, at(1), velAlong(1), true, false);
    expect(s.wrongWay).toBe(false);
    const back = velAlong(1).map((v) => -v) as Vec3;
    stepLap(s, route, at(1), back, true, false);
    expect(s.wrongWay).toBe(true);
  });
});
