import * as THREE from 'three';
import { HILL_HEIGHT, ROAD_HALF_WIDTH, SLAB, TILE } from './constants';
import { MeshBuilder, type V3 } from './meshBuilder';
import { decodeTerrain, decodeTile, footprint, type Dir, type Surface, type TileInfo } from './tiles';
import { GRID, Horizon, type Track } from './trkFormat';

export const GROUND_COLOR: Record<Horizon, number> = {
  [Horizon.Desert]: 0xd8b878,
  [Horizon.Tropical]: 0x5fa04a,
  [Horizon.Alpine]: 0xe8eef2,
  [Horizon.City]: 0x7d7d80,
  [Horizon.Country]: 0x6cb04a,
  [Horizon.Chaotic]: 0xd8b878,
};

const ROAD_COLOR: Record<Surface, number> = { paved: 0x4a4a52, dirt: 0x9a6b3c, ice: 0xbfe3f2 };
const LINE_COLOR = 0xf0f0f0;
const WATER_COLOR = 0x2a6fc0;
const CONCRETE = 0x9a9a9a;

// Lift roads and markings above the ground plane to avoid z-fighting.
const ROAD_LIFT = 0.1;
const LINE_LIFT = 0.15;

// Local frame per direction of travel: f = forward, r = right (both as [east, north]).
const FRAME: Record<Dir, { f: [number, number]; r: [number, number] }> = {
  N: { f: [0, 1], r: [1, 0] },
  E: { f: [1, 0], r: [0, -1] },
  S: { f: [0, -1], r: [-1, 0] },
  W: { f: [-1, 0], r: [0, 1] },
};

interface Path {
  pts: V3[];
  /** Horizontal unit lateral (east, north) per point; omitted = derive from the path tangent. */
  lat?: [number, number][];
}

type Sample = [r: number, f: number, h: number];

/** Place local (right, forward, height) samples around centre (e, n) facing `dir`. */
function framePath(c: [number, number], dir: Dir, samples: Sample[], constantLateral = false): Path {
  const fr = FRAME[dir];
  const pts = samples.map(([r, f, h]): V3 => [c[0] + r * fr.r[0] + f * fr.f[0], c[1] + r * fr.r[1] + f * fr.f[1], h]);
  return constantLateral ? { pts, lat: pts.map(() => fr.r) } : { pts };
}

function lateralAt(path: Path, i: number): [number, number] {
  if (path.lat) return path.lat[i]!;
  const a = path.pts[Math.max(0, i - 1)]!;
  const b = path.pts[Math.min(path.pts.length - 1, i + 1)]!;
  const te = b[0] - a[0];
  const tn = b[1] - a[1];
  const len = Math.hypot(te, tn) || 1;
  return [tn / len, -te / len];
}

function ribbon(mb: MeshBuilder, path: Path, offset: number, halfW: number, lift: number, color: number): void {
  const edge = (i: number, o: number): V3 => {
    const p = path.pts[i]!;
    const l = lateralAt(path, i);
    return [p[0] + l[0] * o, p[1] + l[1] * o, p[2] + lift];
  };
  for (let i = 0; i < path.pts.length - 1; i++) {
    mb.quad(edge(i, offset - halfW), edge(i, offset + halfW), edge(i + 1, offset + halfW), edge(i + 1, offset - halfW), color);
  }
}

/** Vertical side walls under a ribbon: down to the ground, or just a slab thickness. */
function skirt(mb: MeshBuilder, path: Path, halfW: number, color: number, toGround: boolean): void {
  for (const side of [-1, 1]) {
    for (let i = 0; i < path.pts.length - 1; i++) {
      const top = (k: number): V3 => {
        const p = path.pts[k]!;
        const l = lateralAt(path, k);
        return [p[0] + l[0] * halfW * side, p[1] + l[1] * halfW * side, p[2] + ROAD_LIFT];
      };
      const bottom = (k: number): V3 => {
        const t = top(k);
        return [t[0], t[1], toGround ? 0 : t[2] - SLAB];
      };
      mb.quad(top(i), top(i + 1), bottom(i + 1), bottom(i), color);
    }
  }
}

function paintRoad(mb: MeshBuilder, path: Path, surface: Surface): void {
  ribbon(mb, path, 0, ROAD_HALF_WIDTH, ROAD_LIFT, ROAD_COLOR[surface]);
  if (surface === 'dirt') return;
  for (const side of [-1, 1]) {
    ribbon(mb, path, side * (ROAD_HALF_WIDTH - 0.8), 0.25, LINE_LIFT, LINE_COLOR);
  }
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function straightPath(c: [number, number], dir: Dir, h0 = 0, h1 = h0, segs = 1): Path {
  const s: Sample[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    s.push([0, (t - 0.5) * TILE, h0 + (h1 - h0) * smooth(t)]);
  }
  return framePath(c, dir, s);
}

function pillar(mb: MeshBuilder, e: number, n: number, height: number): void {
  mb.box(e - 1.2, n - 1.2, 0, e + 1.2, n + 1.2, Math.max(height - SLAB, 0.1), CONCRETE);
}

function startGantry(mb: MeshBuilder, c: [number, number], dir: Dir): void {
  const fr = FRAME[dir];
  const at = (r: number, f: number, h: number): V3 => [c[0] + r * fr.r[0] + f * fr.f[0], c[1] + r * fr.r[1] + f * fr.f[1], h];
  // Checkered line across the road.
  const cols = 8;
  const w = (ROAD_HALF_WIDTH * 2) / cols;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < 2; j++) {
      const color = (i + j) % 2 === 0 ? 0x111111 : 0xffffff;
      const r0 = -ROAD_HALF_WIDTH + i * w;
      const f0 = (j - 1) * 1.2;
      mb.quad(at(r0, f0, 0.2), at(r0 + w, f0, 0.2), at(r0 + w, f0 + 1.2, 0.2), at(r0, f0 + 1.2, 0.2), color);
    }
  }
  // Gantry: two posts and a cross bar, built as axis-aligned boxes around each point.
  const post = (r: number): void => {
    const p = at(r, 0, 0);
    mb.box(p[0] - 0.4, p[1] - 0.4, 0, p[0] + 0.4, p[1] + 0.4, 7, 0xc02020);
  };
  post(-ROAD_HALF_WIDTH - 1);
  post(ROAD_HALF_WIDTH + 1);
  const a = at(-ROAD_HALF_WIDTH - 1, 0, 0);
  const b = at(ROAD_HALF_WIDTH + 1, 0, 0);
  mb.box(Math.min(a[0], b[0]) - 0.4, Math.min(a[1], b[1]) - 0.4, 6.2, Math.max(a[0], b[0]) + 0.4, Math.max(a[1], b[1]) + 0.4, 7, 0xc02020);
}

function cornerPath(
  anchor: [number, number],
  info: Extract<TileInfo, { kind: 'corner' }>,
  segs = 14,
): Path {
  const [x, z] = anchor;
  const span = info.size === 'large' ? 2 : 1;
  // Block extents in metres; the code sits in the NW-most tile, the block extends east and south.
  const e0 = x * TILE;
  const e1 = (x + span) * TILE;
  const n0 = (z - span + 1) * TILE;
  const n1 = (z + 1) * TILE;
  const ns = info.edges.find((d) => d === 'N' || d === 'S')!;
  const ew = info.edges.find((d) => d === 'E' || d === 'W')!;
  const C: [number, number] = [ew === 'E' ? e1 : e0, ns === 'S' ? n0 : n1];
  const B: [number, number] = [(e0 + e1) / 2, (n0 + n1) / 2];
  const r = (info.size === 'large' ? 1.5 : 0.5) * TILE;
  const a0 = Math.atan2(0, Math.sign(B[0] - C[0]));
  const a1 = Math.atan2(Math.sign(B[1] - C[1]), 0);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  const pts: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (d * i) / segs;
    pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), 0]);
  }
  return { pts };
}

/** Loop: a vertical circle with forward drift, and a sideways drift so the two passes don't collide. */
function loopPath(c: [number, number], dir: Dir): Path {
  const R = 10;
  const L = 2 * TILE;
  const D = 14;
  const s: Sample[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 2 * Math.PI;
    const f = (th / (2 * Math.PI) - 0.5) * L + R * Math.sin(th);
    const r = D * Math.sin(th) * Math.sin(th / 2) ** 2;
    s.push([r, f, R * (1 - Math.cos(th))]);
  }
  return framePath(c, dir, s, true);
}

function addScenery(mb: MeshBuilder, e: number, n: number, type: 'palm' | 'cactus' | 'pine'): void {
  if (type === 'palm') {
    mb.box(e - 0.4, n - 0.4, 0, e + 0.4, n + 0.4, 8, 0x7a5230);
    mb.box(e - 3.5, n - 3.5, 8, e + 3.5, n + 3.5, 9, 0x2f8a2f);
  } else if (type === 'cactus') {
    mb.box(e - 0.6, n - 0.6, 0, e + 0.6, n + 0.6, 6, 0x3c8c3c);
    mb.box(e - 2.2, n - 0.4, 3, e - 0.6, n + 0.4, 3.8, 0x3c8c3c);
    mb.box(e - 2.2, n - 0.4, 3, e - 1.4, n + 0.4, 5.2, 0x3c8c3c);
  } else {
    const apex: V3 = [e, n, 14];
    const r = 3.5;
    const base: V3[] = [
      [e - r, n - r, 2],
      [e + r, n - r, 2],
      [e + r, n + r, 2],
      [e - r, n + r, 2],
    ];
    for (let i = 0; i < 4; i++) mb.tri(base[i]!, base[(i + 1) % 4]!, apex, 0x1f5f2a);
    mb.box(e - 0.5, n - 0.5, 0, e + 0.5, n + 0.5, 2, 0x5a3a20);
  }
}

/**
 * Build render meshes for a track. Everything is one flat-shaded mesh in world space
 * (Three.js: x = east, y = up, z = -north).
 */
export function buildTrack(track: Track): THREE.Group {
  const mb = new MeshBuilder();
  const ground = GROUND_COLOR[track.horizon];
  const hillColor = new THREE.Color(ground).multiplyScalar(0.85).getHex();
  const size = GRID * TILE;

  // Ground: one large plane, plus a faint checker over the playfield for a sense of scale.
  const big = 6000;
  const mid = size / 2;
  mb.quad([mid - big, mid - big, 0], [mid + big, mid - big, 0], [mid + big, mid + big, 0], [mid - big, mid + big, 0], ground);
  const shade = new THREE.Color(ground).multiplyScalar(0.94).getHex();
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      if ((x + z) % 2 === 0) continue;
      const e = x * TILE;
      const n = z * TILE;
      mb.quad([e, n, 0.02], [e + TILE, n, 0.02], [e + TILE, n + TILE, 0.02], [e, n + TILE, 0.02], shade);
    }
  }

  // Terrain.
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const t = decodeTerrain(track.terrain[x]![z]!);
      const e = x * TILE;
      const n = z * TILE;
      const c: [number, number] = [e + TILE / 2, n + TILE / 2];
      if (t.kind === 'water') {
        mb.quad([e, n, 0.06], [e + TILE, n, 0.06], [e + TILE, n + TILE, 0.06], [e, n + TILE, 0.06], WATER_COLOR);
      } else if (t.kind === 'hill') {
        mb.box(e, n, 0, e + TILE, n + TILE, HILL_HEIGHT, hillColor);
      } else if (t.kind === 'slope') {
        const fr = FRAME[t.ascent];
        const at = (r: number, f: number, h: number): V3 => [
          c[0] + r * fr.r[0] + f * fr.f[0],
          c[1] + r * fr.r[1] + f * fr.f[1],
          h,
        ];
        const h = TILE / 2;
        mb.quad(at(-h, -h, 0), at(h, -h, 0), at(h, h, HILL_HEIGHT), at(-h, h, HILL_HEIGHT), hillColor);
        mb.tri(at(-h, -h, 0), at(-h, h, 0), at(-h, h, HILL_HEIGHT), hillColor);
        mb.tri(at(h, -h, 0), at(h, h, 0), at(h, h, HILL_HEIGHT), hillColor);
      }
    }
  }

  // Track elements.
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const info = decodeTile(track.elements[x]![z]!);
      if (info.kind === 'blank' || info.kind === 'filler' || info.kind === 'unknown') continue;
      const fp = footprint(info);
      // Centre of the footprint (it extends east and south from the anchor tile).
      const c: [number, number] = [(x + fp.w / 2) * TILE, (z + 1 - fp.h / 2) * TILE];
      switch (info.kind) {
        case 'road':
          paintRoad(mb, straightPath(c, info.axis === 'NS' ? 'N' : 'E'), info.surface);
          break;
        case 'start': {
          paintRoad(mb, straightPath(c, info.dir), info.surface);
          startGantry(mb, c, info.dir);
          break;
        }
        case 'elevatedRoad': {
          const p = straightPath(c, info.axis === 'NS' ? 'N' : 'E', HILL_HEIGHT);
          paintRoad(mb, p, 'paved');
          skirt(mb, p, ROAD_HALF_WIDTH, CONCRETE, false);
          pillar(mb, c[0], c[1], HILL_HEIGHT);
          break;
        }
        case 'ramp': {
          const p = straightPath(c, info.dir, 0, HILL_HEIGHT, 10);
          paintRoad(mb, p, 'paved');
          skirt(mb, p, ROAD_HALF_WIDTH, CONCRETE, info.style === 'solid');
          if (info.style === 'elevated') {
            const fr = FRAME[info.dir];
            pillar(mb, c[0] + fr.f[0] * TILE * 0.3, c[1] + fr.f[1] * TILE * 0.3, HILL_HEIGHT * 0.9);
          }
          break;
        }
        case 'loop':
          paintRoad(mb, loopPath(c, info.axis === 'NS' ? 'N' : 'E'), 'paved');
          break;
        case 'corner':
          paintRoad(mb, cornerPath([x, z], info), info.surface);
          break;
        case 'scenery':
          addScenery(mb, c[0], c[1], info.type);
          break;
      }
    }
  }

  const group = new THREE.Group();
  group.add(mb.build());
  return group;
}
