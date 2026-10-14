import { SURFACE, type CollisionWorld } from './collision';
import {
  add,
  cross,
  dot,
  length,
  normalize,
  quatConj,
  quatFromBasis,
  quatIntegrate,
  quatRotate,
  scale,
  sub,
  type Quat,
  type Vec3,
} from './vec';

// Input bitmask (one per fixed tick; this is what replays store).
export const INPUT = {
  Throttle: 1,
  Brake: 2,
  Left: 4,
  Right: 8,
  GearUp: 16,
  GearDown: 32,
  Reset: 64,
} as const;

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
const SUBSTEPS = 4;
const G = 9.81;

/** Mirrors the fields of the original car*.res "simd" block where it makes sense (mass, grip, drag...). */
export interface CarSpec {
  name: string;
  mass: number;
  /** Total drive force at standstill (N), shared by driven wheels. */
  engineForce: number;
  /** Speed (m/s) where engine force has faded to zero. */
  maxSpeed: number;
  reverseForce: number;
  brakeForce: number;
  /** Quadratic aero drag coefficient (N per (m/s)^2). */
  drag: number;
  /** Base tyre friction coefficient. */
  grip: number;
  /** Front/rear axle grip multipliers. */
  frontGrip: number;
  rearGrip: number;
  halfTrack: number;
  halfWheelbase: number;
  wheelRadius: number;
  suspRest: number;
  springK: number;
  springDamp: number;
  /** Max steering as tan(angle) at standstill. */
  maxSteerTan: number;
  /** Speed (m/s) at which steering authority has halved. */
  steerFalloff: number;
}

export const DEFAULT_CAR: CarSpec = {
  name: 'Streak',
  mass: 1200,
  engineForce: 8200,
  maxSpeed: 78,
  reverseForce: 4000,
  brakeForce: 14000,
  drag: 0.42,
  grip: 1.25,
  frontGrip: 1.0,
  rearGrip: 1.1,
  halfTrack: 0.82,
  halfWheelbase: 1.3,
  wheelRadius: 0.33,
  suspRest: 0.4,
  springK: 60000,
  springDamp: 5500,
  maxSteerTan: 0.5,
  steerFalloff: 28,
};

/** Grip multiplier per surface: paved, dirt, ice, grass. */
const SURFACE_GRIP = [1.0, 0.72, 0.18, 0.6];
/** Rolling resistance per surface, as deceleration (m/s^2) per m/s of speed. */
const SURFACE_DRAG = [0.03, 0.08, 0.02, 0.22];

export interface CarState {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** World-space angular velocity (rad/s). */
  angVel: Vec3;
  /** Smoothed steering input in [-1, 1]. */
  steer: number;
  /** Suspension compression per wheel (m): FL, FR, RL, RR. */
  compression: [number, number, number, number];
  crashed: boolean;
  crashReason: string;
  upsideDownTicks: number;
  ticks: number;
}

export type Heading = 'N' | 'E' | 'S' | 'W';
const HEADING_FWD: Record<Heading, Vec3> = { N: [0, 1, 0], E: [1, 0, 0], S: [0, -1, 0], W: [-1, 0, 0] };

export function createCar(_spec: CarSpec, pos: Vec3, heading: Heading, speed = 0): CarState {
  const f = HEADING_FWD[heading];
  const u: Vec3 = [0, 0, 1];
  const r = cross(f, u); // right-hand side when facing f
  return {
    pos: [...pos],
    vel: scale(f, speed),
    quat: quatFromBasis(r, f, u),
    angVel: [0, 0, 0],
    steer: 0,
    compression: [0, 0, 0, 0],
    crashed: false,
    crashReason: '',
    upsideDownTicks: 0,
    ticks: 0,
  };
}

export const speedOf = (s: CarState): number => length(s.vel);

// Wheel order: FL, FR, RL, RR.
const WHEEL_SIGN: [number, number][] = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

/** Advance one fixed tick (1/60 s). Pure: depends only on (state, spec, input, world). */
export function stepCar(s: CarState, spec: CarSpec, input: number, world: CollisionWorld): void {
  const live = !s.crashed;
  const throttle = live && (input & INPUT.Throttle) !== 0 ? 1 : 0;
  const brake = live && (input & INPUT.Brake) !== 0 ? 1 : 0;
  const steerTarget = live ? (input & INPUT.Right ? 1 : 0) - (input & INPUT.Left ? 1 : 0) : 0;

  // Keyboard steering ramps in and returns to centre a bit faster than it ramps out.
  const rate = (steerTarget === 0 ? 7 : 4.5) * DT;
  if (s.steer < steerTarget) s.steer = Math.min(steerTarget, s.steer + rate);
  else if (s.steer > steerTarget) s.steer = Math.max(steerTarget, s.steer - rate);

  const h = DT / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) substep(s, spec, throttle, brake, world, h);

  // Crash rules.
  const up = quatRotate(s.quat, [0, 0, 1]);
  const speed = speedOf(s);
  if (up[2] < 0 && speed < 4) s.upsideDownTicks++;
  else s.upsideDownTicks = 0;
  if (!s.crashed && s.upsideDownTicks > 30) crash(s, 'rolled over');
  if (!s.crashed && world.isWater(s.pos[0], s.pos[1]) && s.pos[2] < 1.2) crash(s, 'splash');
  s.ticks++;
}

function crash(s: CarState, reason: string): void {
  s.crashed = true;
  s.crashReason = reason;
}

function substep(s: CarState, spec: CarSpec, throttle: number, brake: number, world: CollisionWorld, h: number): void {
  const right = quatRotate(s.quat, [1, 0, 0]);
  const fwd = quatRotate(s.quat, [0, 1, 0]);
  const up = quatRotate(s.quat, [0, 0, 1]);
  const down = scale(up, -1);

  const speedF = dot(s.vel, fwd);
  const wheelMass = spec.mass / 4;
  const rayLen = spec.suspRest + spec.wheelRadius;

  // Steering authority falls with speed (a flat 'tan' keeps us trig-free).
  const sp = length(s.vel);
  const steerTan = (s.steer * spec.maxSteerTan) / (1 + (sp * sp) / (spec.steerFalloff * spec.steerFalloff));

  const reversing = brake > 0 && throttle === 0 && speedF < 0.8;
  let force: Vec3 = [0, 0, -G * spec.mass];
  let torque: Vec3 = [0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const [sx, sy] = WHEEL_SIGN[i]!;
    const front = sy > 0;
    const local: Vec3 = [sx * spec.halfTrack, sy * spec.halfWheelbase, 0];
    const arm = quatRotate(s.quat, local);
    const mount = add(s.pos, arm);

    const hit = world.raycast(mount, down, rayLen);
    const prev = s.compression[i]!;
    if (!hit) {
      s.compression[i] = 0;
      continue;
    }
    const springLen = hit.t - spec.wheelRadius;
    const comp = Math.min(Math.max(spec.suspRest - springLen, 0), spec.suspRest + spec.wheelRadius * 0.5);
    s.compression[i] = comp;
    const compVel = (comp - prev) / h;
    let fs = spec.springK * comp + spec.springDamp * compVel;
    if (comp > spec.suspRest * 0.9) fs += spec.springK * 6 * (comp - spec.suspRest * 0.9); // bump stop
    fs = Math.max(fs, 0);

    const n = hit.n;
    const fSpring = scale(n, fs);
    force = add(force, fSpring);
    torque = add(torque, cross(arm, fSpring));

    // Velocity of the contact patch.
    const vc = add(s.vel, cross(s.angVel, arm));
    const closing = -dot(vc, n);
    // Only a touchdown after being airborne counts; being pressed into a curved surface (loops) does not.
    if (prev === 0 && closing > 24 && !s.crashed) crash(s, 'hard landing');

    // Wheel axes in the contact plane.
    let fw: Vec3 = front ? normalize(add(fwd, scale(right, steerTan))) : fwd;
    fw = normalize(sub(fw, scale(n, dot(fw, n))));
    const sw = normalize(cross(n, fw));
    const vf = dot(vc, fw);
    const vs = dot(vc, sw);

    const mu = spec.grip * (front ? spec.frontGrip : spec.rearGrip) * SURFACE_GRIP[hit.surface]!;
    const lim = mu * fs;

    // Longitudinal: engine (rear wheels), brakes (all wheels), rolling + surface drag.
    let fx = 0;
    if (!front) {
      if (throttle > 0) fx += (spec.engineForce / 2) * Math.max(0, 1 - speedF / spec.maxSpeed);
      else if (reversing) fx -= spec.reverseForce / 2;
    }
    if (brake > 0 && !reversing) {
      const want = (-vf * wheelMass) / h;
      const cap = spec.brakeForce / 4;
      fx += Math.max(-cap, Math.min(cap, want));
    }
    fx -= vf * wheelMass * SURFACE_DRAG[hit.surface]!;

    // Lateral grip cancels most sideways slip each substep, limited by what the tyre can give.
    let fy = (-vs * wheelMass * 0.6) / h;

    // Friction circle.
    const mag = Math.sqrt(fx * fx + fy * fy);
    if (mag > lim && mag > 1e-9) {
      const k = lim / mag;
      fx *= k;
      fy *= k;
    }

    const fTire = add(scale(fw, fx), scale(sw, fy));
    force = add(force, fTire);
    torque = add(torque, cross(arm, fTire));
  }

  // Aerodynamic drag at the centre of mass.
  force = sub(force, scale(s.vel, spec.drag * sp));

  // Linear integration (semi-implicit Euler).
  s.vel = add(s.vel, scale(force, h / spec.mass));
  s.pos = add(s.pos, scale(s.vel, h));

  // Angular: solve in body space with a box inertia tensor.
  const w = 1.8, l = 4.2, hgt = 1.3;
  const Ix = (spec.mass * (l * l + hgt * hgt)) / 12;
  const Iy = (spec.mass * (w * w + hgt * hgt)) / 12;
  const Iz = (spec.mass * (w * w + l * l)) / 12;
  const inv = quatConj(s.quat);
  const tb = quatRotate(inv, torque);
  const wb = quatRotate(inv, s.angVel);
  const gyro: Vec3 = cross(wb, [Ix * wb[0], Iy * wb[1], Iz * wb[2]]);
  const nwb: Vec3 = [
    wb[0] + ((tb[0] - gyro[0]) / Ix) * h,
    wb[1] + ((tb[1] - gyro[1]) / Iy) * h,
    wb[2] + ((tb[2] - gyro[2]) / Iz) * h,
  ];
  const damp = 1 - 0.4 * h;
  s.angVel = quatRotate(s.quat, [nwb[0] * damp, nwb[1] * damp, nwb[2] * damp]);
  s.quat = quatIntegrate(s.quat, s.angVel, h);
}

/** Order-stable fingerprint of the state, for determinism tests and replay validation. */
export function stateHash(s: CarState): string {
  const nums = [...s.pos, ...s.vel, ...s.quat, ...s.angVel, s.steer, ...s.compression, s.ticks];
  let a = 0x811c9dc5;
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  for (const n of nums) {
    f64[0] = n;
    for (const word of [u32[0]!, u32[1]!]) {
      a ^= word;
      a = Math.imul(a, 0x01000193) >>> 0;
    }
  }
  return a.toString(16).padStart(8, '0') + (s.crashed ? 'X' : '');
}

export { SURFACE };
