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
}

const CELL = 20;
const key = (ix: number, iy: number): number => (ix + 200) * 1000 + (iy + 200);

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

  /** positions: 9 numbers per triangle; surfaces: one id per triangle. */
  constructor(
    private readonly positions: number[],
    private readonly surfaces: number[],
  ) {
    const count = surfaces.length;
    this.stamp = new Int32Array(count);
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
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(t);
        }
      }
    }
  }

  /** Mark a 20 m grid tile (x east, z north) as water. */
  addWater(x: number, z: number): void {
    this.water.add(key(x, z));
  }

  isWater(e: number, n: number): boolean {
    return this.water.has(key(Math.floor(e / CELL), Math.floor(n / CELL)));
  }

  /** Nearest hit along unit direction d within maxT, or null. */
  raycast(o: Vec3, d: Vec3, maxT: number): Hit | null {
    let best: Hit | null = null;

    // Analytic ground.
    if (d[2] < -1e-9 && o[2] >= -0.5) {
      const t = -o[2] / d[2];
      if (t >= 0 && t <= maxT) best = { t, n: [0, 0, 1], surface: SURFACE.Grass };
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
          if (best && dist >= best.t) continue;
          let n = normalize(cross(e1, e2));
          if (dot(n, d) > 0) n = [-n[0], -n[1], -n[2]];
          best = { t: dist, n, surface: this.surfaces[t]! as SurfaceId };
        }
      }
    }
    return best;
  }
}
