import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARS, createCar, DEFAULT_CAR, INPUT, stepCar } from '../physics/car';
import { TILE } from './constants';
import { parseResources, parseShape, unpack, type Shape } from '../original/formats';
import { findStart } from './start';
import { buildTrack } from './trackBuilder';
import { parseTrk } from './trkFormat';

// Uses the developer's own Stunts copy when present (git-ignored); skipped elsewhere.
const DIR = 'original_game/STUNTS11';
const available = existsSync(`${DIR}/GAME1.P3S`);

function loadShapes(): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  for (const f of ['GAME1.P3S', 'GAME2.P3S']) {
    for (const [name, bytes] of parseResources(unpack(new Uint8Array(readFileSync(`${DIR}/${f}`))))) {
      shapes.set(name, parseShape(bytes));
    }
  }
  return shapes;
}

describe.skipIf(!available)('original tracks built from the original shapes', () => {
  const shapes = available ? loadShapes() : new Map<string, Shape>();
  for (const name of ['DEFAULT', 'BERNIES', 'CHERRIS', 'HELENS', 'JOES', 'SKIDS']) {
    it(`${name}: drives away from the start line on the original road without hitting anything`, () => {
      const track = parseTrk(new Uint8Array(readFileSync(`${DIR}/${name}.TRK`)));
      const built = buildTrack(track, shapes);
      const start = findStart(track)!;
      const f = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }[start.dir] as [number, number];
      const e = start.centre[0] - f[0] * 12;
      const n = start.centre[1] - f[1] * 12;
      const hit = built.world.raycast([e, n, 300], [0, 0, -1], 400)!;
      const car = createCar(DEFAULT_CAR, [e, n, 300 - hit.t + 1], start.dir);
      // The bump bug showed as many tiny hops (the car popping over road markings). Count hops
      // shorter than 0.1 s after the first landing; real take-offs (crests) last longer.
      let landed = false;
      let air = 0;
      let hops = 0;
      for (let t = 0; t < 60 * 4; t++) {
        stepCar(car, DEFAULT_CAR, INPUT.Throttle, built.world);
        if (car.grounded) {
          if (landed && air > 0 && air < 6) hops++;
          landed = true;
          air = 0;
        } else if (landed) air++;
      }
      expect(hops, 'tiny hops').toBe(0);
      expect(car.crashed, car.crashReason).toBe(false);
      const travelled = (car.pos[0] - e) * f[0] + (car.pos[1] - n) * f[1];
      expect(travelled).toBeGreaterThan(30); // well past the start banner
    });
  }
});

describe.skipIf(!available)('Default hill (user report: crash at the bottom of the slope)', () => {
  it('the Indy drives down the hill flat out without leaving the road or crashing', () => {
    const shapes = loadShapes();
    const track = parseTrk(new Uint8Array(readFileSync(`${DIR}/DEFAULT.TRK`)));
    const world = buildTrack(track, shapes).world;
    const indy = CARS.find((c) => c.id === 'indy')!;
    for (const v0 of [10, 30, 45]) {
      const e = 7.5 * TILE;
      const n = 12.6 * TILE;
      const hit = world.raycast([e, n, 300], [0, 0, -1], 400)!;
      const car = createCar(indy, [e, n, 300 - hit.t + 0.7], 'S', v0);
      let air = 0;
      for (let t = 0; t < 60 * 4; t++) {
        stepCar(car, indy, INPUT.Throttle, world);
        if (t > 30 && !car.grounded) air++;
      }
      expect(car.crashed, `v0 ${v0}: ${car.crashReason} ${car.crashDetail ?? ''}`).toBe(false);
      // Like in the original, fast cars fly off the top; the landing isn't steep enough to crash.
      if (v0 >= 30) expect(air, `v0 ${v0}: ticks in the air`).toBeGreaterThan(30);
    }
  });
});
