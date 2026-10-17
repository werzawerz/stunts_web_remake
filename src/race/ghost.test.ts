import { describe, expect, it } from 'vitest';
import { createCar, DEFAULT_CAR, INPUT, stepCar } from '../physics/car';
import { buildSampleTrack } from '../track/sampleTrack';
import { buildTrack } from '../track/trackBuilder';
import { TILE } from '../track/constants';
import { Ghost } from './ghost';
import type { Vec3 } from '../physics/vec';

const world = buildTrack(buildSampleTrack()).world;
const pose: Vec3 = [10 * TILE, 5.5 * TILE, 1];
const lap = Array.from({ length: 600 }, (_, t) => INPUT.Throttle | (t > 200 && t < 260 ? INPUT.Left : 0));

describe('ghost', () => {
  for (const wait of [45, 300]) {
    it(`drives the recorded lap exactly, whenever the player set off (waited ${wait} ticks)`, () => {
      // The live run: the car stands on the line, then the lap log starts with the first throttle.
      const live = createCar(DEFAULT_CAR, pose, 'E');
      for (let i = 0; i < wait; i++) stepCar(live, DEFAULT_CAR, 0, world);
      const ghost = new Ghost(DEFAULT_CAR, lap, pose, 'E', world);
      for (let t = 0; t < lap.length; t++) {
        stepCar(live, DEFAULT_CAR, lap[t]!, world);
        ghost.follow(t + 1);
      }
      for (let k = 0; k < 3; k++) expect(ghost.car.pos[k]).toBeCloseTo(live.pos[k]!, 6);
    });
  }
});
