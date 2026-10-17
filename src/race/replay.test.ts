import { describe, expect, it } from 'vitest';
import { createCar, DEFAULT_CAR, INPUT, stateHash, stepCar, type CarState } from '../physics/car';
import { buildSampleTrack } from '../track/sampleTrack';
import { buildTrack } from '../track/trackBuilder';
import { TILE } from '../track/constants';
import { Replay } from './replay';

const world = buildTrack(buildSampleTrack()).world;
const start = (): CarState => createCar(DEFAULT_CAR, [10 * TILE, 5.5 * TILE, 0.7], 'E');
const step = (s: CarState, input: number): void => stepCar(s, DEFAULT_CAR, input, world);
// 20 s of driving: throttle, weaving, a brake.
const inputs = Array.from({ length: 1200 }, (_, t) =>
  INPUT.Throttle | (t % 200 < 40 ? INPUT.Left : t % 200 < 80 ? INPUT.Right : 0) | (t > 900 && t < 960 ? INPUT.Brake : 0),
);

describe('replay', () => {
  it('reproduces the live run exactly, at any tick, seeking forwards or backwards', () => {
    const live = start();
    const hashes = [stateHash(live)];
    for (const i of inputs) {
      step(live, i);
      hashes.push(stateHash(live));
    }
    const r = new Replay(inputs, start, step);
    for (const t of [1200, 37, 600, 599, 0, 1061, 300]) expect(stateHash(r.frameAt(t).state), `tick ${t}`).toBe(hashes[t]);
  });

  it('plays forward one tick at a time like the live run', () => {
    const r = new Replay(inputs, start, step);
    const f = r.frameAt(500);
    for (let k = 0; k < 100; k++) r.advance(f);
    expect(f.tick).toBe(600);
    expect(stateHash(f.state)).toBe(stateHash(r.frameAt(600).state));
  });
});
