import { describe, expect, it } from 'vitest';
import { buildSampleTrack } from '../track/sampleTrack';
import { HILL_HEIGHT as HILL, TILE } from '../track/constants';
import { buildTrack } from '../track/trackBuilder';
import { CollisionWorld } from './collision';
import { createCar, DEFAULT_CAR, INPUT, speedOf, stateHash, stepCar, type CarState, type Heading } from './car';
import { quatRotate, type Vec3 } from './vec';

// Flat paved slab 0.01 m above the analytic grass ground, 4 km square.
const S = 2000;
const paved = new CollisionWorld(
  [-S, -S, 0.01, S, -S, 0.01, S, S, 0.01, -S, -S, 0.01, S, S, 0.01, -S, S, 0.01],
  [0, 0],
);
const grass = new CollisionWorld([], []);
const sample = buildTrack(buildSampleTrack()).world;

interface Run {
  s: CarState;
  maxU: number;
  maxSlip: number;
  at: (t: number) => CarState;
}

function run(
  world: CollisionWorld,
  pos: Vec3,
  heading: Heading,
  speed: number,
  ticks: number,
  input: number | ((t: number, s: CarState) => number),
): Run {
  const s = createCar(DEFAULT_CAR, pos, heading, speed);
  let maxU = pos[2];
  let maxSlip = 0;
  const snaps = new Map<number, CarState>();
  for (let t = 0; t < ticks; t++) {
    stepCar(s, DEFAULT_CAR, typeof input === "function" ? input(t, s) : input, world);
    maxU = Math.max(maxU, s.pos[2]);
    maxSlip = Math.max(maxSlip, s.slip);
    snaps.set(t + 1, structuredClone(s));
  }
  return { s, maxU, maxSlip, at: (t) => snaps.get(t)! };
}

const upZ = (s: CarState): number => quatRotate(s.quat, [0, 0, 1])[2];

describe('Stunts-style car model', () => {
  it('drops onto the road and sits at ride height', () => {
    const { s } = run(paved, [0, 0, 1], 'N', 0, 120, 0);
    expect(s.grounded).toBe(true);
    expect(s.pos[2]).toBeCloseTo(0.01 + DEFAULT_CAR.rideHeight, 2);
    expect(speedOf(s)).toBeLessThan(0.05);
    expect(s.crashed).toBe(false);
  });

  it('accelerates through the gears: 0-100 km/h in 4-8 s, top speed ~250-290 km/h', () => {
    const r = run(paved, [0, -S + 50, 0.51], 'N', 0, 60 * 45, INPUT.Throttle);
    let t100 = -1;
    for (let t = 1; t <= 60 * 45; t++) {
      if (speedOf(r.at(t)) >= 27.8) {
        t100 = t / 60;
        break;
      }
    }
    expect(t100).toBeGreaterThan(4);
    expect(t100).toBeLessThan(8);
    expect(r.s.gear).toBe(5);
    expect(speedOf(r.s) * 3.6).toBeGreaterThan(250);
    expect(speedOf(r.s) * 3.6).toBeLessThan(290);
    expect(Math.abs(r.s.pos[0])).toBeLessThan(0.01); // straight as an arrow
  });

  it('brakes with a constant ~0.95 g, stays stopped while held, reverses on a fresh press', () => {
    const r = run(paved, [0, 0, 0.51], 'N', 30, 60 * 8, (t) => (t < 60 * 5 || t >= 60 * 5 + 20 ? INPUT.Brake : 0));
    expect(speedOf(r.at(60))).toBeGreaterThan(19.5);
    expect(speedOf(r.at(60))).toBeLessThan(21.5);
    expect(speedOf(r.at(120))).toBeLessThan(12.5); // still linear: 30 → ~11.4 after 2 s
    expect(r.at(60 * 4).pos[1]).toBeLessThan(52); // stopping distance v²/2a ≈ 50 m
    // Still holding the brake after stopping: no reverse.
    expect(r.at(60 * 5).gear).toBe(1);
    expect(speedOf(r.at(60 * 5))).toBeLessThan(0.1);
    // Released and pressed again: reverse.
    expect(r.s.gear).toBe(-1);
    expect(r.s.vel[1]).toBeLessThan(-2);
  });

  it('holds its line at moderate speed and slides when cornering past the grip limit', () => {
    const slow = run(paved, [0, 0, 0.51], 'N', 8, 120, INPUT.Left);
    expect(slow.s.pos[0]).toBeLessThan(-2);
    expect(slow.maxSlip).toBeLessThan(1);
    const fast = run(paved, [0, 0, 0.51], 'N', 50, 120, INPUT.Throttle | INPUT.Left);
    expect(fast.maxSlip).toBeGreaterThan(2);
  });

  it('is slowed down hard on grass', () => {
    const r = run(grass, [0, 0, 0.5], 'N', 0, 60 * 30, INPUT.Throttle);
    expect(speedOf(r.s) * 3.6).toBeLessThan(130);
  });

  // Demo track landmarks, in tiles (x east, z north): start/finish (10,5) heading east, loop on
  // tiles 14-15 of row 5, ramp up at (23,8), elevated (23,9..11), ramp down at (23,12), pond 10-13 x 12-15.
  const T = (x: number): number => x * TILE;
  const RIDE = 0.1 + DEFAULT_CAR.rideHeight;

  it('is deterministic: same inputs give the same state hash', () => {
    const script = (t: number): number =>
      INPUT.Throttle | (t % 120 < 40 ? INPUT.Left : t % 120 < 80 ? INPUT.Right : 0) | (t % 300 > 250 ? INPUT.Brake : 0);
    const a = run(sample, [T(10), T(5.5), RIDE], 'E', 0, 900, script).s;
    const b = run(sample, [T(10), T(5.5), RIDE], 'E', 0, 900, script).s;
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('drives the demo start straight', () => {
    const { s } = run(sample, [T(10), T(5.5), RIDE], 'E', 0, 60 * 3, INPUT.Throttle);
    expect(s.vel[0]).toBeGreaterThan(14);
    expect(Math.abs(s.pos[1] - T(5.5))).toBeLessThan(0.5);
    expect(s.grounded).toBe(true);
  });

  it('goes round the loop with enough speed, guided, and comes out on the centre line', () => {
    const r = run(sample, [T(13.2), T(5.5), RIDE], 'E', 42, 60 * 9, INPUT.Throttle);
    expect(r.s.crashed).toBe(false);
    expect(r.maxU).toBeGreaterThan(55);
    expect(r.s.pos[0]).toBeGreaterThan(T(16.5));
    expect(Math.abs(r.s.pos[1] - T(5.5))).toBeLessThan(5); // still well on the 14.6 m road
    expect(upZ(r.s)).toBeGreaterThan(0.95);
    expect(r.s.grounded).toBe(true);
  });

  it('falls out of the loop when too slow', () => {
    const r = run(sample, [T(14), T(5.5), RIDE], 'E', 22, 60 * 6, 0);
    expect(r.maxU).toBeLessThan(55);
    expect(r.s.pos[0]).toBeLessThan(T(16));
  });

  it('climbs the ramp onto the elevated section', () => {
    const r = run(sample, [T(23.5), T(7.3), RIDE], 'N', 20, 60 * 8, INPUT.Throttle);
    expect(r.s.crashed).toBe(false);
    expect(r.maxU).toBeGreaterThan(27);
    expect(r.s.pos[1]).toBeGreaterThan(T(9.5));
  });

  it('takes the ramp, elevated road and descent at a sensible speed without crashing', () => {
    for (const v0 of [15, 25]) {
      // Throttle only below ~100 km/h: the crest at the top of the descent is then followed.
      const r = run(sample, [T(23.5), T(7.1), RIDE], 'N', v0, 60 * 18, (_t, car) => (speedOf(car) < 27 ? INPUT.Throttle : 0));
      expect(r.s.crashed, `entry speed ${v0} m/s: ${r.s.crashReason}`).toBe(false);
      expect(r.s.pos[1]).toBeGreaterThan(T(13));
    }
  });

  it('flies off the ramp crest flat out and lands without crashing', () => {
    const r = run(sample, [T(23.5), T(7.1), RIDE], 'N', 20, 60 * 14, INPUT.Throttle);
    expect(r.s.crashed, r.s.crashReason).toBe(false);
    expect(r.maxU).toBeGreaterThan(HILL + 2); // launched above the elevated deck, like the original
    expect(r.s.pos[1]).toBeGreaterThan(T(13));
  });

  it('crashes when driven into the pond', () => {
    const { s } = run(sample, [T(12), T(11), RIDE], 'N', 20, 60 * 5, INPUT.Throttle);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toBe('splash');
  });
});

describe('walls and obstacles', () => {
  // A paved slab with a 3 m high wall across the road 40 m ahead (north).
  const S2 = 500;
  const wallAt = 40;
  const slabWithWall = new CollisionWorld(
    [-S2, -S2, 0.01, S2, -S2, 0.01, S2, S2, 0.01, -S2, -S2, 0.01, S2, S2, 0.01, -S2, S2, 0.01],
    [0, 0],
    [],
    [-20, wallAt, 0, 20, wallAt, 0, 20, wallAt, 3, -20, wallAt, 0, 20, wallAt, 3, -20, wallAt, 3],
  );

  it('scrapes along a wall hit at a shallow angle instead of crashing', () => {
    // A wall slanting 20 degrees across the car's path (like a highway median's side).
    const k = Math.tan((20 * Math.PI) / 180);
    const slanted = new CollisionWorld(
      [-S2, -S2, 0.01, S2, -S2, 0.01, S2, S2, 0.01, -S2, -S2, 0.01, S2, S2, 0.01, -S2, S2, 0.01],
      [0, 0],
      [],
      [3, 0, 0, 3 - 200 * k, 200, 0, 3 - 200 * k, 200, 3, 3, 0, 0, 3 - 200 * k, 200, 3, 3, 0, 3],
    );
    const { s } = run(slanted, [0, 0, 0.61], 'N', 25, 60 * 3, INPUT.Throttle);
    expect(s.crashed, s.crashReason).toBe(false);
  });

  it('landing crashes depend on the angle, not the height (as in the original)', () => {
    // Dropped from 60 m: almost straight down crashes, a fast shallow flight lands fine.
    const steep = run(slabWithWall, [0, -400, 60], 'N', 3, 60 * 4, 0);
    expect(steep.s.crashed).toBe(true);
    const shallow = run(slabWithWall, [0, -400, 60], 'N', 45, 60 * 4, 0);
    expect(shallow.s.crashed, shallow.s.crashReason).toBe(false);
  });

  it('crashes when hitting a wall fast', () => {
    const { s } = run(slabWithWall, [0, 0, 0.61], 'N', 25, 60 * 4, INPUT.Throttle);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toBe('hit an obstacle');
    expect(s.pos[1]).toBeLessThan(wallAt);
  });

  it('just stops against a wall when touching it slowly', () => {
    const { s } = run(slabWithWall, [0, wallAt - 8, 0.61], 'N', 3, 60 * 4, 0);
    expect(s.crashed).toBe(false);
    expect(s.pos[1]).toBeLessThan(wallAt);
  });

  it('cannot pass through a wall even at very high speed', () => {
    const { s } = run(slabWithWall, [0, 0, 0.61], 'N', 90, 60 * 2, INPUT.Throttle);
    expect(s.pos[1]).toBeLessThan(wallAt);
  });
});
