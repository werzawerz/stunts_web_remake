import { INPUT, speedOf, type CarSpec, type CarState } from '../physics/car';
import { quatRotate } from '../physics/vec';

/*
 * A simple driver that follows the route's centre line with the same digital inputs a player
 * has. Used to test that every track can be lapped, and a starting point for computer opponents.
 * Deterministic (only + - * / and sqrt), like the rest of the simulation.
 */

const G = 9.81;
/** Speed (m/s) to crest a hill top or ramp lip at when a bend follows: the car lands in time. */
const CREST_SPEED = 14;
/** Bends this far (m) past a crest count as following it. */
const CREST_REACH = 100;

export class Autopilot {
  private idx = 0;

  constructor(
    private readonly line: [number, number, number][],
    private readonly spec: CarSpec,
    /** Top speed the driver aims for on straights (m/s). */
    private readonly cruise = 42,
    /** Per line point: guided (loops steer the car themselves; their bends need no slowing). */
    private readonly guided: boolean[] = [],
  ) {}

  /** Index of the line point closest to the car, searching forward from the last one. */
  private advance(pos: [number, number, number]): void {
    const n = this.line.length;
    let best = this.idx;
    let bestD = Infinity;
    for (let k = 0; k < 60; k++) {
      const i = (this.idx + k) % n;
      const p = this.line[i]!;
      const d = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2 + ((p[2] - pos[2]) * 0.5) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.idx = best;
  }

  /** Whether the line `dist` metres ahead is on a guided piece. */
  private guidedAhead(dist: number): boolean {
    const n = this.line.length;
    let i = this.idx;
    let left = dist;
    for (let k = 0; k < n; k++) {
      const a = this.line[i]!;
      const b = this.line[(i + 1) % n]!;
      const seg = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      if (seg >= left) return this.guided[i] === true;
      left -= seg;
      i = (i + 1) % n;
    }
    return false;
  }

  /** Point `dist` metres further along the line from the current index. */
  private ahead(dist: number): [number, number, number] {
    const n = this.line.length;
    let i = this.idx;
    let left = dist;
    for (let k = 0; k < n; k++) {
      const a = this.line[i]!;
      const b = this.line[(i + 1) % n]!;
      const seg = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      if (seg >= left) {
        const t = seg > 0 ? left / seg : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      left -= seg;
      i = (i + 1) % n;
    }
    return this.line[i]!;
  }

  input(car: CarState): number {
    const v = speedOf(car);
    this.advance(car.pos);
    const fwd = quatRotate(car.quat, [0, 1, 0]);
    const fl = Math.sqrt(fwd[0] * fwd[0] + fwd[1] * fwd[1]) || 1;
    const fx = fwd[0] / fl;
    const fy = fwd[1] / fl;

    // Steering: aim at a point ahead; digital left/right like a keyboard player.
    const look = this.ahead(10 + v * 0.45);
    const tx = look[0] - car.pos[0];
    const ty = look[1] - car.pos[1];
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    // >0: target is to the left. Damped by the turn already under way (a quarter second of yaw),
    // so the driver lets go in time instead of overshooting the line.
    const side = (fx * ty - fy * tx) / tl - car.angVel[2] * 0.18;
    let mask = 0;
    if (side > 0.03) mask |= INPUT.Left;
    else if (side < -0.03) mask |= INPUT.Right;

    // Speed: limited by the tightest horizontal bend in the next stretch of road, with the grip
    // of the surface the car is on (dirt and ice corners are slower).
    const grip = this.spec.grip * (this.spec.surfaceGrip[car.surface] ?? 1);
    let limit = this.cruise;
    const step = 8;
    let prev = this.ahead(0);
    let cur = this.ahead(step);
    // Where the road tips over a crest (a hill top, the end of an elevated road) into a real descent
    // (> 6 m): fast cars fly off there and can't steer until they land. Not ramp lips reached
    // climbing: those are jumps (gaps between bridge ramps) and want speed.
    let crest = -1;
    for (let d = 2 * step; d <= 140; d += step) {
      const next = this.ahead(d);
      const ax = cur[0] - prev[0];
      const ay = cur[1] - prev[1];
      const bx = next[0] - cur[0];
      const by = next[1] - cur[1];
      const la = Math.sqrt(ax * ax + ay * ay);
      const lb = Math.sqrt(bx * bx + by * by);
      // Climbing or diving road (a loop seen from above looks like a hairpin): not a bend to slow
      // down for. Loops and jumps want speed.
      const steep = Math.abs(cur[2] - prev[2]) > la * 0.5 || Math.abs(next[2] - cur[2]) > lb * 0.5;
      // Bends beyond a loop are for later: a loop has to be entered fast or the car falls off.
      if (steep) break;
      if (crest < 0 && la > 0.5 && lb > 0.5 && (cur[2] - prev[2]) / la - (next[2] - cur[2]) / lb > 0.15) {
        // A jump: bends beyond it are for after landing. With nothing to slow for before it, take
        // off flat out (gaps between bridge ramps need more than the usual cruising speed).
        if ((cur[2] - prev[2]) / la > 0.2 && cur[2] > 10) {
          if (limit >= this.cruise) limit = Infinity;
          break;
        }
        if (this.ahead(d + 2 * step)[2] < cur[2] - 6) crest = d - step;
      }
      // A climb soon after a crest (a dip between ramps): flying over the dip slams the car into the
      // rising side, so crest it slowly enough to follow the road down.
      if (crest >= 0 && d - crest < CREST_REACH && lb > 0.5 && (next[2] - cur[2]) / lb > 0.2) {
        const atCrest = Math.sqrt(CREST_SPEED * CREST_SPEED + 2 * this.spec.brakeDecel * 0.8 * Math.max(0, crest - step));
        if (atCrest < limit) limit = atCrest;
      }
      if (la > 0.5 && lb > 0.5 && !this.guidedAhead(d - step)) {
        const turn = Math.abs(ax * by - ay * bx) / (la * lb); // sin of the heading change
        if (turn > 0.01) {
          const radius = step / turn;
          const vCorner = Math.sqrt(0.75 * grip * G * radius);
          // Allow for braking distance to reach that speed by the bend.
          const reach = Math.sqrt(vCorner * vCorner + 2 * this.spec.brakeDecel * 0.8 * (d - step));
          if (reach < limit) limit = reach;
          if (crest >= 0 && d - crest < CREST_REACH && turn > 0.05) {
            const v = Math.min(vCorner, CREST_SPEED);
            const atCrest = Math.sqrt(v * v + 2 * this.spec.brakeDecel * 0.8 * Math.max(0, crest - step));
            if (atCrest < limit) limit = atCrest;
          }
        }
      }
      prev = cur;
      cur = next;
    }
    if (v < limit - 1) mask |= INPUT.Throttle;
    else if (v > limit + 2) mask |= INPUT.Brake;
    return mask;
  }
}
