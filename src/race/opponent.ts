import { ELEMENT_SHAPES } from '../original/elementTable.generated';
import type { OpponentProfile } from '../original/opponents';
import { createCar, speedOf, stepCar, DT, type CarSpec, type CarState } from '../physics/car';
import type { CollisionWorld } from '../physics/collision';
import type { Vec3 } from '../physics/vec';
import { onSlope } from '../track/check';
import { ELEMENT_PATHS } from '../track/elementPaths.generated';
import type { Track } from '../track/trkFormat';
import { Autopilot } from './autopilot';
import { createLap, stepLap, type LapState } from './lap';
import type { Route } from './route';

/*
 * A computer opponent racing the same track at the same time, as in the original: our track
 * driver (autopilot.ts) held to the opponent's own limits from the original files. Each piece has
 * a speed class (from the game's element table: road, sharp corner, large corner - plus the
 * surface - banked corner, ramp/bridge, slalom, corkscrew, chicane, loop, pipe); the opponent's
 * "sped" table gives their speed for it in mph. Their "path" table marks pieces they struggle
 * with (Bernie on loops, Otto on elevated road...), which we take as driving those slower: on a
 * loop that can mean not making it round. Deterministic, so replays re-simulate it.
 *
 * Our driver isn't the original's, and some pieces (the pipe obstacle, tunnel mouths after a
 * bend, rows of short jumps) are beyond it at an opponent's full speed. So before the race the
 * opponent drives its lap once in advance (learn()): wherever it crashes, its speeds on the way
 * there come down and it tries that stretch again. Where slower doesn't help (Bernie too slow for
 * the loop), the crash stays: that's their weakness.
 */

const MPH = 0.44704;
/** Opponents corner closer to the grip limit than the careful test driver (learning catches the rest). */
const OPPONENT_CORNER_GRIP = 0.68;
/** Take-off speed (m/s) for jumps: faster overshoots the landing ramps on rows of short jumps. */
const OPPONENT_JUMP_SPEED = 42;
/** How much each trouble level slows them on that piece. */
const TROUBLE_SLOWDOWN = 0.05;
/** Never slower than this share of their speed there (they still get round a corner). */
const MIN_FACTOR = 0.4;
/** Starting beside the player: this far to the right of the line (m), fading over the first stretch. */
const START_OFFSET = 4.5;
const OFFSET_FADE = 150;

/** The speed cap (m/s) per point of the route's line for an opponent. */
export function opponentCaps(route: Route, track: Track, profile: OpponentProfile): number[] {
  const perPiece = route.pieces.map((piece) => {
    const [x, z] = piece.anchor;
    let code = track.elements[x]?.[z] ?? 0;
    const t = track.terrain[x]?.[z] ?? 0;
    if (t >= 0x07 && t <= 0x0a) code = onSlope(t, code) || code;
    const surface = ELEMENT_SHAPES[code]?.paint ?? 0;
    let mph = 0;
    for (const block of ELEMENT_PATHS[code] ?? []) {
      let cls = block[5];
      if (cls < 0) continue;
      if (cls === 0 || cls === 3 || cls === 6) cls += surface;
      mph = Math.max(mph, profile.sped[cls] ?? 0);
    }
    if (mph === 0) return Infinity;
    const trouble = profile.trouble[code] ?? 0;
    return mph * MPH * Math.max(MIN_FACTOR, 1 - TROUBLE_SLOWDOWN * trouble);
  });
  return route.linePiece.map((i) => perPiece[i] ?? Infinity);
}

/** Everything about the opponent that changes during a race (copied into replay frames). */
export interface RivalState {
  car: CarState;
  lap: LapState;
  /** Where its driver is along the line. */
  idx: number;
  /** Distance driven (m). */
  dist: number;
}

export function cloneRival(s: RivalState): RivalState {
  return {
    car: structuredClone(s.car),
    lap: structuredClone(s.lap),
    idx: s.idx,
    dist: s.dist,
  };
}

/** Learning: how far before a crash (m) speeds come down, and by how much. */
const LEARN_APPROACH = 120;
const LEARN_AFTER = 10;
/** Speeds tried at a crash spot, as shares of the first attempt's there. */
const LEARN_SPEEDS = [0.9, 0.8, 0.7, 1.0, 0.6, 0.5, 1.1];
/** How far back (ticks) each try restarts. */
const LEARN_REWIND = 60 * 6;

export class Rival {
  private readonly driver: Autopilot;
  /** Speed limit per point of the line (m/s): from the opponent's table, then what it learnt. */
  readonly caps: number[];

  constructor(
    readonly profile: OpponentProfile,
    readonly spec: CarSpec,
    private readonly route: Route,
    track: Track,
  ) {
    this.caps = opponentCaps(route, track, profile);
    this.driver = new Autopilot(route.line3d, spec, Infinity, route.guided, route.lip, this.caps);
    this.driver.jumpSpeed = OPPONENT_JUMP_SPEED;
    this.driver.cornerGrip = OPPONENT_CORNER_GRIP;
  }

  /**
   * Drive the lap in advance from `start`, and wherever it crashes try that stretch again at
   * other speeds (jumps want neither too slow nor too fast) until it gets round, or keep the
   * attempt that got furthest. Deterministic. Returns the ticks simulated.
   */
  learn(start: RivalState, world: CollisionWorld, maxTicks = 60 * 900): number {
    const steps = this.learning(start, world, maxTicks);
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
  }

  /** learn(), a slice at a time: yields every few hundred ticks so it can run between frames. */
  *learning(start: RivalState, world: CollisionWorld, maxTicks = 60 * 900): Generator<void, number> {
    const line = this.route.line3d;
    const n = line.length;
    const base = [...this.caps];
    const seen = new Float64Array(n); // top speed at each line point in the latest attempt
    const snaps: { tick: number; s: RivalState }[] = [];
    /** Per crash spot: tries so far, and the speeds of the first attempt over its approach. */
    const spots = new Map<number, { tries: number; ref: Map<number, number> }>();
    let best = { dist: -1, caps: [...this.caps] };
    let s = cloneRival(start);
    let tick = 0;
    let work = 0;
    while (tick < maxTicks && work < maxTicks * 3) {
      if (tick % 120 === 0 && (snaps.length === 0 || snaps[snaps.length - 1]!.tick < tick)) snaps.push({ tick, s: cloneRival(s) });
      this.step(s, world, true);
      tick++;
      work++;
      seen[s.idx] = Math.max(seen[s.idx]!, speedOf(s.car));
      if (work % 300 === 0) yield;
      if (s.lap.phase === 'finished') return work;
      if (!s.car.crashed) continue;
      if (s.dist > best.dist) best = { dist: s.dist, caps: [...this.caps] };
      const at = s.idx;
      const key = Math.floor(at / 25);
      let spot = spots.get(key);
      if (!spot) {
        // The approach and a little beyond, with the speeds this first attempt had there.
        const ref = new Map<number, number>();
        let i = at;
        let back = 0;
        for (let g = 0; g < n && back <= LEARN_APPROACH; g++) {
          ref.set(i, seen[i]! > 0 ? seen[i]! : this.caps[i]!);
          const j = (i - 1 + n) % n;
          back += Math.hypot(line[i]![0] - line[j]![0], line[i]![1] - line[j]![1]);
          i = j;
        }
        i = at;
        let fwd = 0;
        for (let g = 0; g < n && fwd <= LEARN_AFTER; g++) {
          const j = (i + 1) % n;
          fwd += Math.hypot(line[j]![0] - line[i]![0], line[j]![1] - line[i]![1]);
          ref.set(j, seen[j]! > 0 ? seen[j]! : this.caps[j]!);
          i = j;
        }
        spot = { tries: 0, ref };
        spots.set(key, spot);
      }
      spot.tries++;
      if (spot.tries > LEARN_SPEEDS.length) break; // no speed gets through: keep the best try
      const f = LEARN_SPEEDS[spot.tries - 1]!;
      for (const [i, v] of spot.ref) this.caps[i] = Math.max(4, Math.min(base[i]!, v * f));
      // Back to a few seconds before, and try again.
      while (snaps.length > 1 && snaps[snaps.length - 1]!.tick > tick - LEARN_REWIND) snaps.pop();
      const snap = snaps[snaps.length - 1]!;
      s = cloneRival(snap.s);
      tick = snap.tick;
      seen.fill(0);
    }
    for (let i = 0; i < n; i++) this.caps[i] = best.caps[i]!;
    return work;
  }

  /**
   * On the start line beside the player (to their right). `place` puts a car at rest there (by
   * default as created; the game settles it on the road like the player's).
   */
  create(
    pos: Vec3,
    heading: 'N' | 'E' | 'S' | 'W',
    place: (pos: Vec3, heading: 'N' | 'E' | 'S' | 'W') => CarState = (q, h) => createCar(this.spec, q, h),
  ): RivalState {
    const right: Record<string, [number, number]> = { N: [1, 0], E: [0, -1], S: [-1, 0], W: [0, 1] };
    const r = right[heading]!;
    const car = place([pos[0] + r[0] * START_OFFSET, pos[1] + r[1] * START_OFFSET, pos[2]], heading);
    return { car, lap: createLap(), idx: 0, dist: 0 };
  }

  /** One tick: drive (once the race is on), and keep its lap and clock. */
  step(s: RivalState, world: CollisionWorld, racing: boolean): void {
    let input = 0;
    if (racing && !s.car.crashed && s.lap.phase !== 'finished') {
      this.driver.index = s.idx;
      this.driver.offset = START_OFFSET * Math.max(0, 1 - s.dist / OFFSET_FADE);
      input = this.driver.input(s.car);
      s.idx = this.driver.index;
    }
    stepCar(s.car, this.spec, input, world);
    s.dist += speedOf(s.car) * DT;
    if (racing) stepLap(s.lap, this.route, s.car.pos, s.car.vel, true, s.car.crashed);
  }
}

/** Two cars this close (m, centre to centre) touch. */
const CONTACT = 2.4;
/** Closing faster than this (m/s) wrecks both, as in the original. */
const WRECK_SPEED = 8;

/**
 * Cars touching: a hard hit crashes both (the original's "OOPS... sorry"), a soft one pushes them
 * apart and evens out their speeds along the hit. Returns true for a crash.
 */
export function collideCars(a: CarState, b: CarState): boolean {
  if (a.crashed && b.crashed) return false;
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dz = b.pos[2] - a.pos[2];
  if (Math.abs(dz) > 1.5) return false;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= CONTACT || d < 1e-6) return false;
  const nx = dx / d;
  const ny = dy / d;
  const closing = (a.vel[0] - b.vel[0]) * nx + (a.vel[1] - b.vel[1]) * ny;
  if (closing > WRECK_SPEED) {
    for (const c of [a, b]) {
      if (!c.crashed) {
        c.crashed = true;
        c.crashReason = 'collision';
      }
    }
    return true;
  }
  // Push apart and share the speed along the hit.
  const push = (CONTACT - d) / 2;
  a.pos = [a.pos[0] - nx * push, a.pos[1] - ny * push, a.pos[2]];
  b.pos = [b.pos[0] + nx * push, b.pos[1] + ny * push, b.pos[2]];
  if (closing > 0) {
    const half = closing / 2;
    a.vel = [a.vel[0] - nx * half, a.vel[1] - ny * half, a.vel[2]];
    b.vel = [b.vel[0] + nx * half, b.vel[1] + ny * half, b.vel[2]];
  }
  return false;
}
