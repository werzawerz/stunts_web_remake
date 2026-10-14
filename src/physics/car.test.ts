import { describe, expect, it } from 'vitest';
import { buildSampleTrack } from '../track/sampleTrack';
import { buildTrack } from '../track/trackBuilder';
import { CollisionWorld } from './collision';
import { createCar, DEFAULT_CAR, INPUT, speedOf, stateHash, stepCar, type Heading } from './car';
import { quatRotate, type Vec3 } from './vec';

// Flat paved slab (0.01 m above the analytic grass ground), 3 km square.
const S = 1500;
const flat = new CollisionWorld(
  [-S, -S, 0.01, S, -S, 0.01, S, S, 0.01, -S, -S, 0.01, S, S, 0.01, -S, S, 0.01],
  [0, 0],
);
const sample = buildTrack(buildSampleTrack()).world;

function run(
  world: CollisionWorld,
  pos: Vec3,
  heading: Heading,
  speed: number,
  ticks: number,
  input: number | ((t: number) => number),
) {
  const s = createCar(DEFAULT_CAR, pos, heading, speed);
  let maxU = pos[2];
  for (let t = 0; t < ticks; t++) {
    stepCar(s, DEFAULT_CAR, typeof input === 'function' ? input(t) : input, world);
    maxU = Math.max(maxU, s.pos[2]);
  }
  return { s, maxU };
}

describe('car physics', () => {
  it('settles on flat ground at ride height and stays put', () => {
    const { s } = run(flat, [0, 0, 0.8], 'N', 0, 240, 0);
    expect(s.pos[2]).toBeGreaterThan(0.5);
    expect(s.pos[2]).toBeLessThan(0.7);
    expect(speedOf(s)).toBeLessThan(0.1);
    expect(s.crashed).toBe(false);
  });

  it('accelerates in a straight line and respects top speed', () => {
    const { s } = run(flat, [0, 0, 0.6], 'N', 0, 60 * 6, INPUT.Throttle);
    expect(s.vel[1]).toBeGreaterThan(18);
    expect(Math.abs(s.pos[0])).toBeLessThan(0.5);
    const long = run(flat, [0, 0, 0.6], 'N', 0, 60 * 30, INPUT.Throttle).s;
    expect(speedOf(long)).toBeLessThan(DEFAULT_CAR.maxSpeed + 1);
    expect(speedOf(long)).toBeGreaterThan(45); // ~160 km/h after 30 s
  });

  it('brakes hard from 108 km/h, then reverses if the brake is held (like the original)', () => {
    const braking = run(flat, [0, 0, 0.6], 'N', 30, 60 * 2, INPUT.Brake).s;
    expect(braking.vel[1]).toBeGreaterThan(0);
    expect(speedOf(braking)).toBeLessThan(12); // >9 m/s^2 average deceleration
    const held = run(flat, [0, 0, 0.6], 'N', 30, 60 * 8, INPUT.Brake).s;
    expect(held.vel[1]).toBeLessThan(0);
    expect(held.pos[1]).toBeLessThan(80); // stopping distance was sane, not a runaway
  });

  it('steers: turning left moves the car west of its heading', () => {
    const { s } = run(flat, [0, 0, 0.6], 'N', 20, 120, INPUT.Throttle | INPUT.Left);
    expect(s.pos[0]).toBeLessThan(-5);
    expect(s.crashed).toBe(false);
  });

  it('is deterministic: same inputs give the same state hash', () => {
    const script = (t: number): number =>
      INPUT.Throttle | (t % 120 < 40 ? INPUT.Left : t % 120 < 80 ? INPUT.Right : 0) | (t % 300 > 250 ? INPUT.Brake : 0);
    const a = run(sample, [190, 110, 0.62], 'E', 0, 900, script).s;
    const b = run(sample, [190, 110, 0.62], 'E', 0, 900, script).s;
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.pos).toEqual(b.pos);
  });

  it('drives the demo track start straight', () => {
    const { s } = run(sample, [190, 110, 0.62], 'E', 0, 60 * 3, INPUT.Throttle);
    expect(s.vel[0]).toBeGreaterThan(12); // reaching 43 km/h within 3 s
    expect(s.pos[0]).toBeGreaterThan(200);
    expect(Math.abs(s.pos[1] - 110)).toBeLessThan(3);
    expect(s.pos[2]).toBeLessThan(1);
  });

  it('completes the loop at moderate speed', () => {
    // Loop occupies east 280..320 on row 5.
    const { s, maxU } = run(sample, [250, 110, 0.62], 'E', 26, 60 * 5, INPUT.Throttle);
    expect(s.crashed).toBe(false);
    expect(maxU).toBeGreaterThan(15); // actually went round the top
    expect(s.pos[0]).toBeGreaterThan(325);
    expect(quatRotate(s.quat, [0, 0, 1])[2]).toBeGreaterThan(0.8);
  });

  it('climbs the ramp onto the elevated section', () => {
    const { s, maxU } = run(sample, [470, 130, 0.62], 'N', 22, 60 * 3, INPUT.Throttle);
    expect(s.crashed).toBe(false);
    expect(maxU).toBeGreaterThan(9);
    expect(s.pos[1]).toBeGreaterThan(190);
  });

  it('crashes when driven into the pond', () => {
    // Pond covers east 200..280, north 240..320.
    const { s } = run(sample, [240, 200, 0.62], 'N', 20, 60 * 3, INPUT.Throttle);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toBe('splash');
  });
});
