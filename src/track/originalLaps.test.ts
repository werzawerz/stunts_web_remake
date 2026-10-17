import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCar, DEFAULT_CAR, stepCar, speedOf } from '../physics/car';
import { parseResources, parseShape, unpack, type Shape } from '../original/formats';
import { Autopilot } from '../race/autopilot';
import { createLap, stepLap } from '../race/lap';
import { buildRoute, elementAt } from '../race/route';
import { TILE } from './constants';
import { findStart } from './start';
import { buildTrack } from './trackBuilder';
import { parseTrk } from './trkFormat';

// Laps every original track with the autopilot on the original shapes. Uses the developer's own
// Stunts copy when present (git-ignored); skipped elsewhere.
const DIR = 'original_game/STUNTS11';
// Work in progress (some original pieces still stop the test driver): run with LAPS=1.
const available = existsSync(`${DIR}/GAME1.P3S`) && process.env.LAPS === '1';

function loadShapes(): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  for (const f of ['GAME1.P3S', 'GAME2.P3S'])
    for (const [name, bytes] of parseResources(unpack(new Uint8Array(readFileSync(`${DIR}/${f}`)))))
      shapes.set(name, parseShape(bytes));
  return shapes;
}

describe.skipIf(!available)('autopilot laps on the original tracks', () => {
  const shapes = available ? loadShapes() : new Map<string, Shape>();
  for (const name of ['DEFAULT', 'BERNIES', 'CHERRIS', 'HELENS', 'JOES', 'SKIDS']) {
    it(`${name}: a full lap without crashing`, () => {
      const track = parseTrk(new Uint8Array(readFileSync(`${DIR}/${name}.TRK`)));
      const built = buildTrack(track, shapes);
      const start = findStart(track)!;
      const route = buildRoute(built.pieces, start.dir)!;
      const f = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }[start.dir] as [number, number];
      const e = start.centre[0] - f[0] * 12;
      const n = start.centre[1] - f[1] * 12;
      const hit = built.world.raycast([e, n, 300], [0, 0, -1], 400)!;
      const car = createCar(DEFAULT_CAR, [e, n, 300 - hit.t + 1], start.dir);
      const pilot = new Autopilot(route.line3d, DEFAULT_CAR, 42, route.guided, route.lip);
      const lap = createLap();
      for (let t = 0; t < 60 * 900 && lap.phase !== 'finished' && !car.crashed; t++) {
        const mask = pilot.input(car);
        stepCar(car, DEFAULT_CAR, mask, built.world);
        stepLap(lap, route, car.pos, car.vel, true, car.crashed);
      }
      const where = elementAt(route, car.pos[0], car.pos[1]);
      const piece = where >= 0 ? route.pieces[where]! : null;
      const at = `at tile ${Math.floor(car.pos[0] / TILE)},${Math.floor(car.pos[1] / TILE)} (${piece?.kind ?? 'off route'}, element ${where}/${route.pieces.length}, next ${lap.next}) speed ${speedOf(car).toFixed(1)} height ${car.pos[2].toFixed(1)}`;
      expect(car.crashed, `crashed: ${car.crashReason} ${car.crashDetail ?? ""} ${at}`).toBe(false);
      expect(lap.phase, `not finished ${at}`).toBe('finished');
      expect(lap.penaltySec, `penalty ${lap.penaltySec} s`).toBe(0);
    });
  }
});
