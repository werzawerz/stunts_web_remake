import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './collision';
import { CARS, createCar, INPUT, speedOf, stepCar } from './car';

// A long paved straight to measure acceleration and top speed.
const S = 6000;
const strip = new CollisionWorld(
  [-50, -S, 0.01, 50, -S, 0.01, 50, S, 0.01, -50, -S, 0.01, 50, S, 0.01, -50, S, 0.01],
  [0, 0],
);
const MPH = 0.44704;

describe('cars converted from the original data', () => {
  it('has all 11 original cars with sane numbers', () => {
    expect(CARS).toHaveLength(11);
    for (const c of CARS) {
      expect(c.mass).toBeGreaterThan(600);
      expect(c.mass).toBeLessThan(2700);
      expect(c.gearRatios.length).toBeGreaterThanOrEqual(5);
      expect(c.grip).toBeGreaterThan(0.9);
      expect(c.claims.topMph).not.toBeNull();
    }
  });

  // Top speed follows directly from the original's torque, gearing and drag, so it should land on
  // the car's own figure. 0-60 depends on details the data can't fully pin down (the race cars'
  // peaky engines, the claims being marketing numbers), so it gets a looser check.
  for (const spec of CARS) {
    it(`${spec.name}: top speed and 0-60 match the original's figures`, () => {
      const s = createCar(spec, [0, -S + 10, 0.61], 'N', 0);
      let t60 = Infinity;
      for (let t = 0; t < 60 * 90; t++) {
        stepCar(s, spec, INPUT.Throttle, strip);
        if (t60 === Infinity && speedOf(s) >= 60 * MPH) t60 = t / 60;
      }
      const topMph = speedOf(s) / MPH;
      expect(topMph).toBeGreaterThan(spec.claims.topMph! * 0.92);
      expect(topMph).toBeLessThan(spec.claims.topMph! * 1.08);
      expect(t60).toBeGreaterThan(spec.claims.zeroToSixty! * 0.6);
      expect(t60).toBeLessThan(spec.claims.zeroToSixty! * 1.35);
    });
  }
});
