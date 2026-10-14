import { dot, cross, sub, normalize, type Vec3 } from './vec';

/** Driving-surface kinds; grip multipliers live in car.ts. */
export const SURFACE = { Paved: 0, Dirt: 1, Ice: 2, Grass: 3 } as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

export interface Hit {
  /** Distance along the ray. */
  t: number;
  /** Unit surface normal, facing the ray origin. */
  n: Vec3;
  surface: SurfaceId;
  /** Road direction for guided pieces (loops): the car is steered along it. */
  guide?: Vec3;
}

const CELL = 20;
const key = (ix: number, iy: number): number => (ix + 200) * 1000 + (iy + 200);

/** Put each triangle (9 numbers) into every grid cell its 2D bounding box touches. */
function bucket(positions: number[], count: number, cells: Map<number, number[]>): void {
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (let v = 0; v < 3; v++) {
      const e = positions[o + v * 3]!;
      const n = positions[o + v * 3 + 1]!;
      minE = Math.min(minE, e); maxE = Math.max(maxE, e);
      minN = Math.min(minN, n); maxN = Math.max(maxN, n);
    }
    for (let ix = Math.floor(minE / CELL); ix <= Math.floor(maxE / CELL); ix++) {
      for (let iy = Math.floor(minN / CELL); iy <= Math.floor(maxN / CELL); iy++) {
        const k = key(ix, iy);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(t);
      }
    }
  }
}

/**
 * Driveable geometry: a triangle soup bucketed into a 2D grid, plus an analytic ground plane at
 * height 0 (grass). Triangles are in sim space (east, north, up) and double-sided.
 * Pure data, no Three.js: it is part of the deterministic simulation.
 */
export class CollisionWorld {
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Int32Array;
  private query = 0;
  private readonly water = new Set<number>();
  private waterTile = CELL;

  /**
   * positions: 9 numbers per triangle; surfaces: one id per triangle; guides: optional 3 numbers
   * per triangle (all zero = not guided).
   */
  private readonly wallCells = new Map<number, number[]>();
  private readonly wallStamp: Int32Array;
  private wallQuery = 0;

  /**
   * positions: 9 numbers per triangle; surfaces: one id per triangle; guides: optional 3 numbers
   * per triangle (all zero = not guided); walls: 9 numbers per obstacle triangle (see `sweep`).
   */
  constructor(
    private readonly positions: number[],
    private readonly surfaces: number[],
    private readonly guides: number[] = [],
    private readonly walls: number[] = [],
    /** Optional label per wall triangle (what it belongs to), for crash messages and debugging. */
    private readonly wallTags: string[] = [],
  ) {
    this.stamp = new Int32Array(surfaces.length);
    bucket(positions, surfaces.length, this.cells);
    this.wallStamp = new Int32Array(walls.length / 9);
    bucket(walls, walls.length / 9, this.wallCells);
  }

  /**
   * First wall crossed by the segment a→b, as a fraction t of the way and the wall's unit normal
   * facing back towards a; null when the way is clear.
   */
  sweep(a: Vec3, b: Vec3): { t: number; n: Vec3; tag?: string } | null {
    const d = sub(b, a);
    const x0 = Math.floor((Math.min(a[0], b[0]) - 0.01) / CELL);
    const x1 = Math.floor((Math.max(a[0], b[0]) + 0.01) / CELL);
    const y0 = Math.floor((Math.min(a[1], b[1]) - 0.01) / CELL);
    const y1 = Math.floor((Math.max(a[1], b[1]) + 0.01) / CELL);
    const q = ++this.wallQuery;
    const W = this.walls;
    let best: { t: number; n: Vec3; tag?: string } | null = null;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.wallCells.get(key(ix, iy));
        if (!list) continue;
        for (const t of list) {
          if (this.wallStamp[t] === q) continue;
          this.wallStamp[t] = q;
          const o = t * 9;
          const v0: Vec3 = [W[o]!, W[o + 1]!, W[o + 2]!];
          const e1: Vec3 = [W[o + 3]! - v0[0], W[o + 4]! - v0[1], W[o + 5]! - v0[2]];
          const e2: Vec3 = [W[o + 6]! - v0[0], W[o + 7]! - v0[1], W[o + 8]! - v0[2]];
          const p = cross(d, e2);
          const det = dot(e1, p);
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const tv = sub(a, v0);
          const u = dot(tv, p) * inv;
          if (u < 0 || u > 1) continue;
          const qv = cross(tv, e1);
          const v = dot(d, qv) * inv;
          if (v < 0 || u + v > 1) continue;
          const s = dot(e2, qv) * inv;
          if (s < 0 || s > 1 || (best && s >= best.t)) continue;
          let n = normalize(cross(e1, e2));
          if (dot(n, d) > 0) n = [-n[0], -n[1], -n[2]];
          best = { t: s, n, tag: this.wallTags[t] };
        }
      }
    }
    return best;
  }

  /** Mark track tile (x east, z north) of size `tile` metres as water. */
  addWater(x: number, z: number, tile: number): void {
    this.waterTile = tile;
    this.water.add(key(x, z));
  }

  isWater(e: number, n: number): boolean {
    return this.water.has(key(Math.floor(e / this.waterTile), Math.floor(n / this.waterTile)));
  }

  /**
   * Nearest hit along unit direction d within maxT, or null.
   * With `prefer`: where two roads cross (inside a loop) a car keeps following the surface it is
   * already on. A hit within ~20° of `prefer` wins over a nearer one, but only when the nearer one
   * is tilted very differently (> ~35°); a ramp foot or hill corner is simply the road ahead.
   */
  raycast(o: Vec3, d: Vec3, maxT: number, prefer?: Vec3): Hit | null {
    let best: Hit | null = null;
    let bestAligned: Hit | null = null;
    const consider = (hit: Hit): void => {
      if (!best || hit.t < best.t) best = hit;
      if (prefer && dot(hit.n, prefer) > 0.94 && (!bestAligned || hit.t < bestAligned.t)) bestAligned = hit;
    };

    // Analytic ground.
    if (d[2] < -1e-9 && o[2] >= -0.5) {
      const t = -o[2] / d[2];
      if (t >= 0 && t <= maxT) consider({ t, n: [0, 0, 1], surface: SURFACE.Grass });
    }

    const ex = o[0] + d[0] * maxT;
    const ey = o[1] + d[1] * maxT;
    const x0 = Math.floor((Math.min(o[0], ex) - 0.01) / CELL);
    const x1 = Math.floor((Math.max(o[0], ex) + 0.01) / CELL);
    const y0 = Math.floor((Math.min(o[1], ey) - 0.01) / CELL);
    const y1 = Math.floor((Math.max(o[1], ey) + 0.01) / CELL);
    const q = ++this.query;
    const P = this.positions;

    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(key(ix, iy));
        if (!list) continue;
        for (const t of list) {
          if (this.stamp[t] === q) continue;
          this.stamp[t] = q;
          const b = t * 9;
          const v0: Vec3 = [P[b]!, P[b + 1]!, P[b + 2]!];
          const e1: Vec3 = [P[b + 3]! - v0[0], P[b + 4]! - v0[1], P[b + 5]! - v0[2]];
          const e2: Vec3 = [P[b + 6]! - v0[0], P[b + 7]! - v0[1], P[b + 8]! - v0[2]];
          // Möller–Trumbore.
          const p = cross(d, e2);
          const det = dot(e1, p);
          if (Math.abs(det) < 1e-9) continue;
          const inv = 1 / det;
          const tv = sub(o, v0);
          const u = dot(tv, p) * inv;
          if (u < -1e-6 || u > 1 + 1e-6) continue;
          const qv = cross(tv, e1);
          const v = dot(d, qv) * inv;
          if (v < -1e-6 || u + v > 1 + 1e-6) continue;
          const dist = dot(e2, qv) * inv;
          if (dist < 0 || dist > maxT) continue;
          let n = normalize(cross(e1, e2));
          if (dot(n, d) > 0) n = [-n[0], -n[1], -n[2]];
          const hit: Hit = { t: dist, n, surface: this.surfaces[t]! as SurfaceId };
          const gx = this.guides[t * 3] ?? 0;
          const gy = this.guides[t * 3 + 1] ?? 0;
          const gz = this.guides[t * 3 + 2] ?? 0;
          if (gx !== 0 || gy !== 0 || gz !== 0) hit.guide = [gx, gy, gz];
          consider(hit);
        }
      }
    }
    if (bestAligned && best && prefer && dot((best as Hit).n, prefer) < 0.82) return bestAligned;
    return best;
  }
}
