import { SURFACE, type CollisionWorld, type Hit, type SurfaceId } from './collision';
import {
  add,
  angularVelocityBetween,
  cross,
  dot,
  length,
  normalize,
  quatFromBasis,
  quatIntegrate,
  quatRotate,
  scale,
  sub,
  type Quat,
  type Vec3,
} from './vec';

/*
 * Stunts-style car model. Facts from the community's analysis of the original
 * (https://wiki.stunts.hu/wiki/Car_model_physics, /Car_parameters):
 *  - speed = engine rpm / gear ratio; force from a torque curve; quadratic aero drag sets top speed
 *  - brakes give a constant deceleration (~0.9 g), independent of mass and grip
 *  - cornering is grip-limited (~1.2 g on asphalt); beyond that the car slides
 *  - surface grip: asphalt 1, dirt 3/4, ice 1/4, grass 1/2; grass also slows the car ∝ speed
 * The car is kinematic and planted: it follows the road surface and only leaves it when the
 * surface falls away faster than gravity can pull the car down (crests, ramp lips, loop tops
 * taken too slowly). In the air it flies ballistically and keeps its spin.
 */

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
const RPM_TO_RADS = (2 * Math.PI) / 60;

export interface CarSpec {
  name: string;
  mass: number;
  /** Engine rpm per m/s of road speed for each forward gear (Stunts: "gear ratio"). */
  gearRatios: number[];
  reverseRatio: number;
  idleRpm: number;
  maxRpm: number;
  upshiftRpm: number;
  downshiftRpm: number;
  /** Torque (N·m) sampled at equal steps from 0 to `torqueMaxRpm`. */
  torque: number[];
  torqueMaxRpm: number;
  drivetrainEfficiency: number;
  /** Share of grip available for traction (≈0.6 rear drive, 1 all-wheel drive). */
  driveGrip: number;
  /** Quadratic aero drag (N per (m/s)^2). */
  drag: number;
  /** Constant braking deceleration (m/s^2). */
  brakeDecel: number;
  /** Cornering grip on asphalt, in g. */
  grip: number;
  wheelbase: number;
  halfTrack: number;
  /** Height of the car's origin above the road. */
  rideHeight: number;
  /** tan(max steering angle) at standstill. */
  maxSteerTan: number;
  /** Speed (m/s) at which keyboard steering lock has halved. */
  steerFalloff: number;
}

export const DEFAULT_CAR: CarSpec = {
  name: 'Streak GT',
  mass: 1300,
  gearRatios: [400, 240, 165, 125, 95],
  reverseRatio: 380,
  idleRpm: 900,
  maxRpm: 7500,
  upshiftRpm: 6900,
  downshiftRpm: 3800,
  torque: [250, 290, 330, 370, 400, 410, 400, 370, 300],
  torqueMaxRpm: 8000,
  drivetrainEfficiency: 0.85,
  driveGrip: 0.55,
  drag: 0.55,
  brakeDecel: 0.95 * G,
  grip: 1.2,
  wheelbase: 3.1,
  halfTrack: 1.0,
  rideHeight: 0.6,
  maxSteerTan: 0.42,
  steerFalloff: 32,
};

/** Grip multiplier per surface: paved, dirt, ice, grass (original defaults 100h, C0h, 40h, 80h). */
const SURFACE_GRIP = [1, 0.75, 0.25, 0.5];
/** Grass slowdown, deceleration per m/s of speed (measured on the original: ~0.144/s). */
const GRASS_DRAG = 0.144;

export interface CarState {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** Angular velocity, only used while airborne (captured at take-off). */
  angVel: Vec3;
  steer: number;
  /** -1 = reverse, 1..n forward gears. */
  gear: number;
  rpm: number;
  grounded: boolean;
  surface: SurfaceId;
  /** Sideways slip speed (m/s): > ~2 means the tyres are sliding. */
  slip: number;
  crashed: boolean;
  crashReason: string;
  ticks: number;
}

export type Heading = 'N' | 'E' | 'S' | 'W';
const HEADING_FWD: Record<Heading, Vec3> = { N: [0, 1, 0], E: [1, 0, 0], S: [0, -1, 0], W: [-1, 0, 0] };

export function createCar(_spec: CarSpec, pos: Vec3, heading: Heading, speed = 0): CarState {
  const f = HEADING_FWD[heading];
  const u: Vec3 = [0, 0, 1];
  return {
    pos: [...pos],
    vel: scale(f, speed),
    quat: quatFromBasis(cross(f, u), f, u),
    angVel: [0, 0, 0],
    steer: 0,
    gear: 1,
    rpm: 0,
    grounded: false,
    surface: SURFACE.Grass,
    slip: 0,
    crashed: false,
    crashReason: '',
    ticks: 0,
  };
}

export const speedOf = (s: CarState): number => length(s.vel);

function torqueAt(spec: CarSpec, rpm: number): number {
  const t = spec.torque;
  const x = (Math.min(Math.max(rpm, 0), spec.torqueMaxRpm) / spec.torqueMaxRpm) * (t.length - 1);
  const i = Math.min(Math.floor(x), t.length - 2);
  return t[i]! + (t[i + 1]! - t[i]!) * (x - i);
}

const RAY_UP = 0.3;

interface Probe {
  hit: Hit;
  /** Normal of the road triangle under the car (the road is faceted, like the original's planes). */
  n: Vec3;
}

/** Look for road under the car along -up, from slightly above the car's origin. */
function probe(world: CollisionWorld, spec: CarSpec, pos: Vec3, up: Vec3, reach: number): Probe | null {
  const hit = world.raycast(add(pos, scale(up, RAY_UP)), scale(up, -1), RAY_UP + spec.rideHeight + reach, up);
  return hit ? { hit, n: hit.n } : null;
}

/** Road direction from a guide vector, oriented like the current heading and lying in the road plane. */
function alongGuide(guide: Vec3, fwd: Vec3, n: Vec3): Vec3 {
  const g = dot(guide, fwd) < 0 ? scale(guide, -1) : guide;
  const p = normalize(sub(g, scale(n, dot(g, n))));
  return length(p) > 0.5 ? p : fwd;
}

function crash(s: CarState, reason: string): void {
  if (s.crashed) return;
  s.crashed = true;
  s.crashReason = reason;
}

/** Advance one fixed tick (1/60 s). Pure: depends only on (state, spec, input, world). */
export function stepCar(s: CarState, spec: CarSpec, input: number, world: CollisionWorld): void {
  const live = !s.crashed;
  const throttle = live && (input & INPUT.Throttle) !== 0;
  const brake = live && (input & INPUT.Brake) !== 0;
  const steerTarget = live ? (input & INPUT.Right ? 1 : 0) - (input & INPUT.Left ? 1 : 0) : 0;

  // The keyboard moves the steering wheel at a fixed rate; it springs back faster.
  const rate = (steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(s.steer) ? 6 : 3.5) * DT;
  if (s.steer < steerTarget) s.steer = Math.min(steerTarget, s.steer + rate);
  else if (s.steer > steerTarget) s.steer = Math.max(steerTarget, s.steer - rate);

  const h = DT / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    if (s.grounded) groundStep(s, spec, throttle, brake, world, h);
    else airStep(s, spec, world, h);
  }

  if (!s.crashed && world.isWater(s.pos[0], s.pos[1]) && s.pos[2] < 1.5) crash(s, 'splash');
  s.ticks++;
}

function groundStep(
  s: CarState,
  spec: CarSpec,
  throttle: boolean,
  brake: boolean,
  world: CollisionWorld,
  h: number,
): void {
  const up0 = quatRotate(s.quat, [0, 0, 1]);
  const fwd0 = quatRotate(s.quat, [0, 1, 0]);
  const here = probe(world, spec, s.pos, up0, 0.4);
  if (!here) {
    s.grounded = false;
    return;
  }
  const n = here.n;
  s.surface = here.hit.surface;
  const mu = SURFACE_GRIP[s.surface]!;
  // Basis aligned with the road; guided pieces (loops) set the heading themselves.
  const guide = here.hit.guide;
  let fwd = normalize(sub(fwd0, scale(n, dot(fwd0, n))));
  if (guide) fwd = alongGuide(guide, fwd, n);
  let right = cross(fwd, n);

  let vel = sub(s.vel, scale(n, dot(s.vel, n)));
  const gravity: Vec3 = [0, 0, -G];
  vel = add(vel, scale(sub(gravity, scale(n, dot(gravity, n))), h));

  // Grip available for cornering and traction. On walls/loops the road presses the car on, so
  // keep a floor instead of using the raw gravity component.
  const load = Math.max(0.5, n[2]);
  const gripAccel = spec.grip * G * mu * load;

  // --- drivetrain --------------------------------------------------------------------------
  let vf = dot(vel, fwd);
  if (s.gear > 0 && brake && vf < 0.5) s.gear = -1;
  else if (s.gear < 0 && throttle && vf > -0.5) s.gear = 1;
  const ratio = s.gear > 0 ? spec.gearRatios[s.gear - 1]! : spec.reverseRatio;
  s.rpm = Math.max(spec.idleRpm, Math.abs(vf) * ratio);
  if (s.gear > 0) {
    if (s.rpm > spec.upshiftRpm && s.gear < spec.gearRatios.length) s.gear++;
    else if (s.rpm < spec.downshiftRpm && s.gear > 1) s.gear--;
  }
  const driving = (s.gear > 0 && throttle) || (s.gear < 0 && brake);
  if (driving && s.rpm < spec.maxRpm) {
    const force = torqueAt(spec, s.rpm) * RPM_TO_RADS * ratio * spec.drivetrainEfficiency;
    const accel = Math.min(force / spec.mass, gripAccel * spec.driveGrip);
    vel = add(vel, scale(fwd, (s.gear > 0 ? accel : -accel) * h));
  }
  // Brakes: constant deceleration toward standstill (throttle brakes while reversing).
  const braking = (s.gear > 0 && brake) || (s.gear < 0 && throttle);
  if (braking) {
    vf = dot(vel, fwd);
    const dv = Math.min(Math.abs(vf), spec.brakeDecel * h);
    vel = sub(vel, scale(fwd, Math.sign(vf) * dv));
  }

  // --- resistances -------------------------------------------------------------------------
  const sp = length(vel);
  if (sp > 1e-6) {
    let decel = (spec.drag * sp * sp) / spec.mass + 0.12; // aero + a little rolling resistance
    if (s.surface === SURFACE.Grass) decel += GRASS_DRAG * sp;
    if (s.crashed) decel += 6;
    vel = scale(vel, Math.max(0, sp - decel * h) / sp);
  }

  // --- steering: bicycle model, yaw limited by front grip -------------------------------------
  vf = dot(vel, fwd);
  const steerTan = (s.steer * spec.maxSteerTan) / (1 + (vf / spec.steerFalloff) ** 2);
  let yaw = guide ? 0 : (vf * steerTan) / spec.wheelbase;
  const maxYaw = (gripAccel * 1.15) / Math.max(Math.abs(vf), 1);
  yaw = Math.max(-maxYaw, Math.min(maxYaw, yaw));
  fwd = normalize(add(fwd, scale(right, yaw * h)));
  right = cross(fwd, n);

  // --- lateral grip: remove sideways velocity, at most gripAccel per second ---------------------
  const vs = dot(vel, right);
  const fix = Math.min(Math.abs(vs), gripAccel * h);
  vel = sub(vel, scale(right, Math.sign(vs) * fix));
  s.slip = Math.abs(dot(vel, right));

  // --- move and follow the surface -----------------------------------------------------------
  const qBefore = s.quat;
  let pos = add(s.pos, scale(vel, h));
  const there = probe(world, spec, pos, n, 1.0);
  const takeOff = (): void => {
    s.vel = vel;
    s.pos = pos;
    s.quat = quatFromBasis(right, fwd, n);
    // No tumbling from road kinks: the car leaves the road with the attitude it had.
    s.angVel = [0, 0, 0];
    s.grounded = false;
  };
  if (!there) return takeOff();
  const n2 = there.n;
  const gap = there.hit.t - RAY_UP - spec.rideHeight; // >0: car is above its ride height
  // The road may fall away by what gravity pulls in one substep, plus a small allowance for the
  // faceted road (a couple of degrees per segment). More than that and the car takes off.
  const gIn = Math.max(0, -dot(gravity, n2));
  const allowed = 0.5 * gIn * h * h + 0.004 + length(vel) * h * 0.035;
  if (gap > allowed) return takeOff();

  pos = sub(pos, scale(n2, gap));
  // Turn the velocity into the new road plane, keeping its magnitude (loops keep their speed).
  const spd = length(vel);
  const vt = sub(vel, scale(n2, dot(vel, n2)));
  vel = length(vt) > 1e-6 ? scale(normalize(vt), spd) : vt;
  fwd = normalize(sub(fwd, scale(n2, dot(fwd, n2))));
  if (there.hit.guide) {
    fwd = alongGuide(there.hit.guide, fwd, n2);
    // Keep the car's speed but point it down the guided road.
    vel = scale(fwd, Math.sign(dot(vel, fwd)) * length(vel));
  }
  right = cross(fwd, n2);
  s.pos = pos;
  s.vel = vel;
  s.quat = quatFromBasis(right, fwd, n2);
  s.angVel = angularVelocityBetween(qBefore, s.quat, h);
}

/** Max rate (rad/s) at which an airborne car's nose turns to follow its flight path. */
const AIR_PITCH_RATE = 0.8;

function airStep(s: CarState, spec: CarSpec, world: CollisionWorld, h: number): void {
  s.vel = add(s.vel, [0, 0, -G * h]);
  s.pos = add(s.pos, scale(s.vel, h));
  s.slip = 0;
  // Attitude in the air: the nose slowly follows the flight path (only about the car's lateral
  // axis), so jumps land along their arc instead of flat or tumbling.
  {
    const f = quatRotate(s.quat, [0, 1, 0]);
    const r = quatRotate(s.quat, [1, 0, 0]);
    const vdir = normalize(sub(s.vel, scale(r, dot(s.vel, r))));
    if (length(vdir) > 0.5 && dot(vdir, f) > 0.2) {
      const axis = cross(f, vdir); // rotation that takes f toward vdir
      const sinA = length(axis);
      const rate = Math.min(AIR_PITCH_RATE, sinA / h);
      s.angVel = sinA > 1e-6 ? scale(axis, rate / sinA) : [0, 0, 0];
    } else s.angVel = [0, 0, 0];
  }
  s.quat = quatIntegrate(s.quat, s.angVel, h);

  const up = quatRotate(s.quat, [0, 0, 1]);
  const fwd = quatRotate(s.quat, [0, 1, 0]);
  // Landing: road within ride height under the car (along its own up, or straight down).
  let p = probe(world, spec, s.pos, up, 0);
  let usedUp = up;
  if (!p || p.hit.t > RAY_UP + spec.rideHeight) {
    p = probe(world, spec, s.pos, [0, 0, 1], 0);
    usedUp = [0, 0, 1];
    if (!p || p.hit.t > RAY_UP + spec.rideHeight) return;
  }
  const n = p.n;
  const closing = -dot(s.vel, n);
  const tilt = dot(up, n);
  if (tilt < 0.35) crash(s, 'landed badly');
  else if (closing > 32) crash(s, 'hard landing');

  const gap = p.hit.t - RAY_UP - spec.rideHeight;
  s.pos = add(s.pos, scale(usedUp, -gap));
  // The landing absorbs the speed into the road; tangential speed is kept.
  s.vel = sub(s.vel, scale(n, dot(s.vel, n)));
  let f = normalize(sub(fwd, scale(n, dot(fwd, n))));
  if (length(f) < 0.5) f = normalize(sub(s.vel, scale(n, dot(s.vel, n))));
  if (length(f) < 0.5) f = normalize(cross(n, [1, 0, 0]));
  s.quat = quatFromBasis(cross(f, n), f, n);
  s.angVel = [0, 0, 0];
  s.grounded = true;
}

/** Order-stable fingerprint of the state, for determinism tests and replay validation. */
export function stateHash(s: CarState): string {
  const nums = [...s.pos, ...s.vel, ...s.quat, ...s.angVel, s.steer, s.gear, s.rpm, s.ticks];
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
