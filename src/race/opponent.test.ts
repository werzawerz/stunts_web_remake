import { describe, expect, it } from 'vitest';
import type { OpponentProfile } from '../original/opponents';
import { CARS, createCar } from '../physics/car';
import { checkTrackPath } from '../track/check';
import { buildSampleTrack } from '../track/sampleTrack';
import { findStart } from '../track/start';
import { buildTrack } from '../track/trackBuilder';
import { opponentLines, opponentWon, type RaceOutcome } from '../ui/opponentResult';
import { collideCars, opponentCaps, Rival } from './opponent';
import { buildRoute } from './route';

/** A made-up opponent: plain speeds, a little trouble with loops. */
const profile: OpponentProfile = {
  id: 9,
  name: 'Test Driver',
  initials: 'TD',
  bio: ['Test Driver'],
  sped: [150, 120, 100, 45, 35, 25, 90, 70, 50, 120, 115, 50, 40, 120, 120, 50],
  trouble: Array.from({ length: 186 }, (_, c) => (c === 0x40 || c === 0x41 ? 2 : 0)),
  lines: { ev1a: 'I won.', ev2a: 'You crashed.', ev3a: 'Again?', ed1a: 'I lost.', ed2a: 'The car.', ed4a: 'Oops.' },
  winFrames: [1, 2],
  loseFrames: [1, 2],
};

describe('computer opponents', () => {
  it('says the right things after the race', () => {
    const o = (playerSec: number | null, opponentSec: number | null, collision = false): RaceOutcome => ({ playerSec, opponentSec, collision, seed: 0 });
    expect(opponentWon(o(null, 80))).toBe(true); // you crashed
    expect(opponentWon(o(90, 80))).toBe(true);
    expect(opponentWon(o(70, 80))).toBe(false);
    expect(opponentWon(o(70, null))).toBe(false); // they didn't finish
    expect(opponentLines(profile, o(null, 80))).toEqual(['You crashed.', 'Again?']);
    expect(opponentLines(profile, o(90, 80))).toEqual(['I won.', 'Again?']);
    expect(opponentLines(profile, o(70, 80))).toEqual(['I lost.', 'The car.']);
    expect(opponentLines(profile, o(null, null, true))).toEqual(['Oops.']);
  });

  it('wrecks both cars in a hard hit, and only nudges them in a soft one', () => {
    const spec = CARS[0]!;
    const a = createCar(spec, [0, 0, 0.6], 'N');
    const b = createCar(spec, [2, 0, 0.6], 'N');
    a.vel = [5, 0, 0];
    b.vel = [-5, 0, 0];
    expect(collideCars(a, b)).toBe(true);
    expect(a.crashed && b.crashed).toBe(true);
    const c = createCar(spec, [0, 0, 0.6], 'N');
    const d = createCar(spec, [2, 0, 0.6], 'N');
    c.vel = [2, 10, 0];
    d.vel = [0, 10, 0];
    expect(collideCars(c, d)).toBe(false);
    expect(c.crashed || d.crashed).toBe(false);
    expect(d.pos[0] - c.pos[0]).toBeGreaterThanOrEqual(2.4 - 1e-9);
  });

  it('drives a lap of the demo circuit, the same way every time', () => {
    const track = buildSampleTrack();
    const built = buildTrack(track);
    const start = findStart(track)!;
    const route = buildRoute(built.pieces, start.dir)!;
    route.graph = checkTrackPath(track).graph;
    const caps = opponentCaps(route, track, profile);
    expect(caps.length).toBe(route.line3d.length);
    expect(caps.every((v) => v > 0)).toBe(true);
    const f = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }[start.dir] as [number, number];
    const pos: [number, number, number] = [start.centre[0] - f[0] * 12, start.centre[1] - f[1] * 12, 1];
    const run = (): { time: number; crashed: boolean; caps: number[] } => {
      const rival = new Rival(profile, CARS[0]!, route, track);
      const s0 = rival.create(pos, start.dir);
      rival.learn(s0, built.world);
      const s = structuredClone(s0);
      for (let t = 0; t < 60 * 400 && s.lap.phase !== 'finished' && !s.car.crashed; t++) rival.step(s, built.world, true);
      return { time: s.lap.ticks, crashed: s.car.crashed, caps: [...rival.caps] };
    };
    const a = run();
    const b = run();
    expect(a.crashed).toBe(false);
    expect(a.time).toBeGreaterThan(0);
    expect(b).toEqual(a);
    // It started beside the player, not on top of them.
    const rival = new Rival(profile, CARS[0]!, route, track);
    const s = rival.create(pos, start.dir);
    expect(Math.hypot(s.car.pos[0] - pos[0], s.car.pos[1] - pos[1])).toBeGreaterThan(4);
  });
});
