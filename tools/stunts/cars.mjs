// node tools/stunts/cars.mjs [dir] [--json]
// Reads the original CAR*.RES files (local copy only) and converts their "simd" physics block
// into our CarSpec units. Field offsets from wiki.stunts.hu/wiki/Car_files, unit conversions
// from wiki.stunts.hu/wiki/Car_model_physics.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseResources } from './formats.mjs';

const MPH = 0.44704;
const G = 9.81;

export function readSimd(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = (o) => dv.getUint16(o, true);
  const gears = b[0];
  const ratios = [];
  for (let i = 0; i < gears; i++) ratios.push(w(0x10 + i * 2));
  const torque = [...b.subarray(0x3b, 0x3b + 103)]; // one byte per 128 rpm
  const wheels = [];
  for (let i = 0; i < 4; i++) wheels.push([0, 1, 2].map((k) => dv.getInt16(0xd2 + i * 6 + k * 2, true)));
  return {
    gears,
    mass: w(0x02),
    brakes: w(0x04),
    idleRpm: w(0x06),
    downRpm: w(0x08),
    upRpm: w(0x0a),
    maxRpm: w(0x0c),
    ratios,
    drag: w(0x38),
    idleTorque: b[0x3a],
    torque,
    grip: w(0xa4),
    airGrip: w(0xb4),
    surfaceGrip: [0, 1, 2, 3].map((i) => w(0xb6 + i * 2)),
    height: w(0xd0),
    wheels,
  };
}

/** Parse "0-60 5.2 sec" and "Top Speed 165 MPH" from the selection-screen text. */
export function readClaims(text) {
  const z = /0-60\s+([\d.]+)/.exec(text);
  const t = /Top Speed\s+(\d+)/i.exec(text);
  return { zeroToSixty: z ? Number(z[1]) : null, topMph: t ? Number(t[1]) : null };
}

export function loadCars(dir) {
  return readdirSync(dir)
    .filter((f) => /^CAR.*\.RES$/i.test(f))
    .map((f) => {
      const res = parseResources(new Uint8Array(readFileSync(join(dir, f))));
      const text = (id) => Buffer.from(res.get(id) ?? []).toString('latin1').replace(/\0.*$/s, '');
      return {
        file: f,
        id: text('gsna').trim(),
        name: text('gnam'),
        description: text('edes').split(']').filter(Boolean),
        claims: readClaims(text('edes')),
        simd: readSimd(res.get('simd')),
      };
    });
}

if (process.argv[1] && /[\\/]cars\.mjs$/.test(process.argv[1])) {
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'original_game/STUNTS11';
  const cars = loadCars(dir);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(cars, null, 1));
  } else {
    for (const c of cars) {
      const s = c.simd;
      const topGearMph = s.ratios.map((r) => ((256 * s.maxRpm) / r).toFixed(0));
      const tmax = Math.max(...s.torque);
      console.log(
        `${c.id.padEnd(5)} ${c.name.padEnd(28)} 0-60 ${c.claims.zeroToSixty}s top ${c.claims.topMph}mph | ` +
          `gears ${s.gears} mass ${s.mass} brakes ${s.brakes} drag ${s.drag} grip ${s.grip} air ${s.airGrip} ` +
          `rpm ${s.idleRpm}/${s.downRpm}/${s.upRpm}/${s.maxRpm} peakT ${tmax}@${s.torque.indexOf(tmax) * 128} ` +
          `redline mph/gear ${topGearMph.join(',')} surf ${s.surfaceGrip.join(',')}`,
      );
    }
  }
  void MPH;
  void G;
}
