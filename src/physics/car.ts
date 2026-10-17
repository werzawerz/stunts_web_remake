import { ORIGINAL_CARS } from './cars.generated';
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

/** Physics numbers converted from an original car (see tools/stunts/gen-cars.mjs). */
export interface OriginalCarData {
  id: string;
  name: string;
  /** kg */
  mass: number;
  /** Engine rpm per m/s of road speed for each forward gear (the original's "gear ratio"). */
  gearRatios: number[];
  idleRpm: number;
  downshiftRpm: number;
  upshiftRpm: number;
  /** Rev limiter. */
  maxRpm: number;
  /** Torque (N·m) per 128 rpm, from 0 rpm up. */
  torque: number[];
  /** Torque used below 2560 rpm in first gear and below idle rpm in the other gears. */
  idleTorque: number;
  /** Quadratic aero drag (N per (m/s)^2). */
  drag: number;
  /** Constant braking deceleration (m/s^2). */
  brakeDecel: number;
  /** Cornering grip on asphalt, in g. */
  grip: number;
  /** Grip multipliers for paved, dirt, ice, grass. */
  surfaceGrip: number[];
  wheelbase: number;
  halfTrack: number;
  /** The original's own selection-screen figures, used to validate the simulation. */
  claims: { zeroToSixty: number | null; topMph: number | null };
}

export interface CarSpec extends OriginalCarData {
  /** Height of the car's origin above the road. */
  rideHeight: number;
  /** tan(max steering angle) at standstill. */
  maxSteerTan: number;
  /** Speed (m/s) at which keyboard steering lock has halved. */
  steerFalloff: number;
}

export const CARS: CarSpec[] = ORIGINAL_CARS.map((d) => ({
  ...d,
  rideHeight: 0.6,
  maxSteerTan: 0.42,
  steerFalloff: 32,
}));

export const DEFAULT_CAR: CarSpec = CARS[0]!;

/** Grass slowdown, deceleration per m/s of speed (measured on the original: ~0.144/s). */
const GRASS_DRAG = 0.144;

export interface CarState {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** Angular velocity, only used while airborne (captured at take-off). */
  angVel: Vec3;
  /** Roll rate (rad/s, about the car's length) in the air after tipping over a side edge. */
  roll: number;
  steer: number;
  /** -1 = reverse, 1..n forward gears. */
  gear: number;
  /** Manual gearbox: gears change only with GearUp/GearDown (the original's A and Z keys). */
  manual: boolean;
  /** Previous tick's input, to react to gear-key presses rather than holds. */
  lastInput: number;
  rpm: number;
  /** Brake held since the car was moving forward: it brakes to a stop and stays there; a fresh
   *  press at a standstill is needed to reverse. */
  brakeLatched: boolean;
  grounded: boolean;
  surface: SurfaceId;
  /** Sideways slip speed (m/s): > ~2 means the tyres are sliding. */
  slip: number;
  /** Cornering beyond the tyres' grip this tick (the original squeals then). */
  sliding: boolean;
  crashed: boolean;
  crashReason: string;
  /** What the car crashed into, when known (debugging and messages; not part of the hash). */
  crashDetail?: string;
  ticks: number;
}

export type Heading = 'N' | 'E' | 'S' | 'W';
const HEADING_FWD: Record<Heading, Vec3> = { N: [0, 1, 0], E: [1, 0, 0], S: [0, -1, 0], W: [-1, 0, 0] };

export function createCar(_spec: CarSpec, pos: Vec3, heading: Heading, speed = 0, manual = false): CarState {
  const f = HEADING_FWD[heading];
  const u: Vec3 = [0, 0, 1];
  return {
    pos: [...pos],
    vel: scale(f, speed),
    quat: quatFromBasis(cross(f, u), f, u),
    angVel: [0, 0, 0],
    roll: 0,
    steer: 0,
    gear: 1,
    manual,
    lastInput: 0,
    rpm: 0,
    brakeLatched: false,
    grounded: false,
    surface: SURFACE.Grass,
    slip: 0,
    sliding: false,
    crashed: false,
    crashReason: '',
    ticks: 0,
  };
}

export const speedOf = (s: CarState): number => length(s.vel);

function torqueAt(spec: CarSpec, rpm: number, gear: number): number {
  // The original replaces the bottom of the curve with the idle torque.
  if (rpm < (gear === 1 ? 2560 : spec.idleRpm)) return spec.idleTorque;
  const x = rpm / 128;
  const i = Math.floor(x);
  const t = spec.torque;
  if (i >= t.length - 1) return t[t.length - 1] ?? 0;
  return t[i]! + (t[i + 1]! - t[i]!) * (x - i);
}

const RAY_UP = 0.3;

/**
 * Going over the side of a bridge or an elevated road, the wheels on one side lose the road first
 * and the car tips over that side (rad/s): it lands on its side or roof and crashes, as in the
 * original. Only over real drops (> TIP_DROP m), not kerbs or pipe walls.
 */
const TIP_RATE = 2.5;
const TIP_DROP = 6;

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

/**
 * Gravity multiplier in the air. Stunts jumps are short and snappy; real-world gravity at the
 * game's scale made them long and floaty. Tuned by feel (the original's value isn't known).
 */
const AIR_GRAVITY = 1.7;
/**
 * Landing crash, as in the original: what wrecks the car is the angle it hits the ground at, not
 * the height it fell from (wiki.stunts.hu "Game versions"; the 1991 versions allow landings close
 * to vertical). A landing crashes when the speed into the ground is above HARD_LANDING_MIN and
 * steeper than HARD_LANDING_SLOPE times the speed along the ground (~60 degrees).
 */
const HARD_LANDING_MIN = 8;
const HARD_LANDING_SLOPE = 1.7;
/** Engine braking deceleration (m/s^2) at the rev limit when off the throttle in gear. */
const ENGINE_BRAKE = 2.2;

/**
 * Speed (m/s) away from the road over a crest below which the car stays on it: facet joints and
 * slow crests don't make it hop, but hill tops and ramp lips at speed launch it, as in the original.
 */
const CREST_STICK = 3;

/**
 * Radius (m) of the loop (the original's is 975 units tall, 1/5 ft each). Upside down in it, the
 * road only holds the car while v²/r exceeds the gravity pulling it off; slower, it falls off.
 */
const LOOP_RADIUS = (975 / 2) * (0.3048 / 5);

/**
 * Hitting a wall or object wrecks the car only when the front of the car hits it, faster than
 * WALL_CRASH_SPEED (m/s, ~22 km/h) into it and at more than ~30 degrees. Glancing hits and hits
 * with the side or rear scrape along instead: in the original, cars only crash at obstacles when
 * the front wheels hit them (wiki.stunts.hu "Car parameters"), and they can grind along a wall.
 */
const WALL_CRASH_SPEED = 6;
const WALL_CRASH_SIN = 0.5;

/**
 * Sweep the car's corners from `from` to `to` against walls and objects. Returns the corrected
 * position and velocity when something was hit (and crashes the car on a hard hit), else null.
 */
function hitWalls(
  s: CarState,
  spec: CarSpec,
  world: CollisionWorld,
  from: Vec3,
  to: Vec3,
  vel: Vec3,
  up: Vec3,
  fwd: Vec3,
  right: Vec3,
): { pos: Vec3; vel: Vec3 } | null {
  const hw = spec.halfTrack * 1.15;
  const hl = (spec.wheelbase / 2) * 1.45;
  let first: { t: number; n: Vec3; tag?: string; front: boolean } | null = null;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [0, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const off = add(add(scale(right, sx * hw), scale(fwd, sy * hl)), scale(up, 0.2));
    const hit = world.sweep(add(from, off), add(to, off));
    if (hit && (!first || hit.t < first.t)) first = { ...hit, front: sy === 1 };
  }
  if (!first) return null;
  // Push back along the wall's horizontal normal.
  let n: Vec3 = [first.n[0], first.n[1], 0];
  n = length(n) > 0.2 ? normalize(n) : first.n;
  const closing = -dot(vel, n);
  if (first.front && closing > WALL_CRASH_SPEED && closing > length(vel) * WALL_CRASH_SIN) {
    crash(s, 'hit an obstacle');
    s.crashDetail = first.tag ?? '';
    return { pos: from, vel: [0, 0, 0] };
  }
  const t = Math.max(0, first.t - 0.05);
  const pos = add(from, scale(sub(to, from), t));
  // Scrape along: lose the speed into the wall plus a bit of friction.
  const along = sub(vel, scale(n, Math.min(0, dot(vel, n)) * 1.3));
  return { pos, vel: scale(along, 0.97) };
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
  // Manual gearbox: one gear per key press (reverse still comes from braking at a standstill).
  const pressed = input & ~s.lastInput;
  s.lastInput = input;
  if (live && s.manual && s.gear > 0) {
    if (pressed & INPUT.GearUp && s.gear < spec.gearRatios.length) s.gear++;
    if (pressed & INPUT.GearDown && s.gear > 1) s.gear--;
  }
  // Braking from forward motion latches until the key is released (see CarState.brakeLatched).
  if (!brake) s.brakeLatched = false;
  else if (s.gear > 0 && dot(s.vel, quatRotate(s.quat, [0, 1, 0])) > 0.5) s.brakeLatched = true;

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
  const mu = spec.surfaceGrip[s.surface] ?? 1;
  // Basis aligned with the road; guided pieces (loops) set the heading themselves.
  const guide = here.hit.guide;
  if (guide && n[2] < 0 && dot(s.vel, s.vel) < LOOP_RADIUS * G * -n[2]) {
    s.grounded = false;
    return;
  }
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
  if (s.gear > 0 && brake && vf < 0.5 && !s.brakeLatched) s.gear = -1;
  else if (s.gear < 0 && throttle && vf > -0.5) s.gear = 1;
  const ratio = s.gear > 0 ? spec.gearRatios[s.gear - 1]! : spec.gearRatios[0]!;
  s.rpm = Math.max(spec.idleRpm, Math.abs(vf) * ratio);
  if (s.gear > 0 && !s.manual) {
    if (s.rpm > spec.upshiftRpm && s.gear < spec.gearRatios.length) s.gear++;
    else if (s.rpm < spec.downshiftRpm && s.gear > 1) s.gear--;
  }
  const driving = (s.gear > 0 && throttle) || (s.gear < 0 && brake);
  if (driving && s.rpm < spec.maxRpm) {
    // Power conservation: F·v = T·ω, with ω = rpm·2π/60 and rpm = v·ratio.
    const force = torqueAt(spec, s.rpm, Math.max(s.gear, 1)) * RPM_TO_RADS * ratio;
    const accel = Math.min(force / spec.mass, gripAccel);
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
    // Aero drag; no rolling resistance on the road, as in the original. Off the throttle in gear
    // the engine brakes the car, more at high revs.
    let decel = (spec.drag * sp * sp) / spec.mass;
    if (!driving && !braking && s.gear > 0) decel += ENGINE_BRAKE * (0.4 + 0.6 * Math.min(1, s.rpm / spec.maxRpm));
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
  s.sliding = Math.abs(vs) > gripAccel * h;

  // --- move and follow the surface -----------------------------------------------------------
  const qBefore = s.quat;
  let pos = add(s.pos, scale(vel, h));
  const wall = hitWalls(s, spec, world, s.pos, pos, vel, n, fwd, right);
  if (wall) {
    pos = wall.pos;
    vel = wall.vel;
  }
  const there = probe(world, spec, pos, n, 1.0);
  const takeOff = (): void => {
    s.vel = vel;
    s.pos = pos;
    s.quat = quatFromBasis(right, fwd, n);
    // No tumbling from road kinks: the car leaves the road with the attitude it had...
    s.angVel = [0, 0, 0];
    s.roll = 0;
    s.grounded = false;
    // ...unless it goes over a side edge: road under one side's wheels only, a drop under the other.
    const wheelOnRoad = (side: number): boolean =>
      world.raycast(add(add(pos, scale(right, side * spec.halfTrack)), scale(n, RAY_UP)), scale(n, -1), RAY_UP + spec.rideHeight + 0.8) !== null;
    const dropUnder = (side: number): number => {
      const hit = world.raycast(add(pos, scale(right, side * (spec.halfTrack + 0.5))), [0, 0, -1], 200);
      return hit ? hit.t : 200;
    };
    const l = wheelOnRoad(-1);
    const r = wheelOnRoad(1);
    if (l !== r && dropUnder(l ? 1 : -1) > TIP_DROP) s.roll = l ? TIP_RATE : -TIP_RATE; // > 0 rolls the right side down
  };
  if (!there) return takeOff();
  const n2 = there.n;
  const gap = there.hit.t - RAY_UP - spec.rideHeight; // >0: car is above its ride height
  // The road may fall away by what gravity pulls in one substep, plus a small allowance for the
  // faceted road (a couple of degrees per segment). More than that and the car takes off.
  const gIn = Math.max(0, -dot(gravity, n2));
  const allowed = 0.5 * gIn * h * h + 0.004;
  // Crossing a crest (a hill top edge, a ramp lip, a facet joint) the car only leaves the road
  // if it would lift off with real vertical speed; otherwise it stays planted. Without this every
  // slow crest made a tiny hop, felt as a bump. Ramp lips at speed and road ends still launch it.
  const liftOff = dot(vel, n2); // speed away from the new road surface
  if (gap > allowed && (gap > 0.5 || liftOff > CREST_STICK)) return takeOff();

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
  s.vel = add(s.vel, [0, 0, -G * AIR_GRAVITY * h]);
  {
    const to = add(s.pos, scale(s.vel, h));
    const wall = hitWalls(
      s,
      spec,
      world,
      s.pos,
      to,
      s.vel,
      quatRotate(s.quat, [0, 0, 1]),
      quatRotate(s.quat, [0, 1, 0]),
      quatRotate(s.quat, [1, 0, 0]),
    );
    s.pos = wall ? wall.pos : to;
    if (wall) s.vel = wall.vel;
  }
  s.slip = 0;
  s.sliding = false;
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
    // Tipping over a side edge keeps rolling the car.
    if (s.roll !== 0) s.angVel = add(s.angVel, scale(f, s.roll));
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
  else {
    const along = length(sub(s.vel, scale(n, -closing)));
    if (closing > HARD_LANDING_MIN && closing > along * HARD_LANDING_SLOPE) crash(s, 'hard landing');
  }

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
  s.roll = 0;
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
