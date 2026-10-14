import * as THREE from 'three';
import { HILL_HEIGHT, ROAD_HALF_WIDTH, SLAB, TILE } from './constants';
import { CollisionWorld, SURFACE } from '../physics/collision';
import { MeshBuilder, type V3 } from './meshBuilder';
import { decodeTerrain, decodeTile, footprint, type Dir, type Surface, type TileInfo } from './tiles';
import { GRID, Horizon, type Track } from './trkFormat';

// Palette picked from screenshots of the original: flat grass, grey asphalt, yellow centre dashes.
export const GROUND_COLOR: Record<Horizon, number> = {
  [Horizon.Desert]: 0xc8a464,
  [Horizon.Tropical]: 0x34a02c,
  [Horizon.Alpine]: 0x48a040,
  [Horizon.City]: 0x6c8c58,
  [Horizon.Country]: 0x3caa30,
  [Horizon.Chaotic]: 0xc8a464,
};

const ROAD_COLOR: Record<Surface, number> = { paved: 0x4c4c4c, dirt: 0x8c6238, ice: 0xd4e8f0 };
const CENTRE_LINE: Record<Surface, number | null> = { paved: 0xfce020, dirt: null, ice: 0xffffff };
const WATER_COLOR = 0x2050c8;
const CONCRETE = 0x9c9c9c;
const GANTRY_PILLAR = 0xe4b08c;
const GANTRY_BANNER = 0xd01818;

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

function ribbon(
  mb: MeshBuilder,
  path: Path,
  offset: number,
  halfW: number,
  lift: number,
  color: number,
  solid?: number,
): void {
  const edge = (i: number, o: number): V3 => {
    const p = path.pts[i]!;
    const l = lateralAt(path, i);
    return [p[0] + l[0] * o, p[1] + l[1] * o, p[2] + lift];
  };
  for (let i = 0; i < path.pts.length - 1; i++) {
    mb.quad(
      edge(i, offset - halfW),
      edge(i, offset + halfW),
      edge(i + 1, offset + halfW),
      edge(i + 1, offset - halfW),
      color,
      solid,
    );
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

const SURFACE_ID: Record<Surface, number> = { paved: SURFACE.Paved, dirt: SURFACE.Dirt, ice: SURFACE.Ice };

/** Dashed stripe along the path centre: dashes of `dash` metres every `period` metres. */
function dashedLine(mb: MeshBuilder, path: Path, halfW: number, color: number, dash = 3, period = 7): void {
  const pts = path.pts;
  let dist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const la = lateralAt(path, i);
    const lb = lateralAt(path, i + 1);
    // Walk the dash pattern across this segment.
    let s = 0;
    while (s < len) {
      const phase = (dist + s) % period;
      const on = phase < dash;
      const next = Math.min(len, s + (on ? dash - phase : period - phase));
      if (on && next - s > 0.05) {
        const at = (u: number, side: number): V3 => {
          const t = u / len;
          const l0 = la[0] + (lb[0] - la[0]) * t;
          const l1 = la[1] + (lb[1] - la[1]) * t;
          const ll = Math.hypot(l0, l1) || 1;
          return [
            a[0] + (b[0] - a[0]) * t + (l0 / ll) * halfW * side,
            a[1] + (b[1] - a[1]) * t + (l1 / ll) * halfW * side,
            a[2] + (b[2] - a[2]) * t + LINE_LIFT,
          ];
        };
        mb.quad(at(s, -1), at(s, 1), at(next, 1), at(next, -1), color);
      }
      s = next;
    }
    dist += len;
  }
}

function paintRoad(mb: MeshBuilder, path: Path, surface: Surface): void {
  ribbon(mb, path, 0, ROAD_HALF_WIDTH, ROAD_LIFT, ROAD_COLOR[surface], SURFACE_ID[surface]);
  const line = CENTRE_LINE[surface];
  if (line !== null) dashedLine(mb, path, 0.22, line);
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
  // Gantry like the original's: two tall pillars carrying a red banner. Pieces are axis-aligned,
  // so boxes are built from the min/max of their rotated corners.
  const boxAt = (r0: number, f0: number, r1: number, f1: number, h0: number, h1: number, color: number): void => {
    const p = at(r0, f0, 0);
    const q = at(r1, f1, 0);
    mb.box(Math.min(p[0], q[0]), Math.min(p[1], q[1]), h0, Math.max(p[0], q[0]), Math.max(p[1], q[1]), h1, color);
  };
  const side = ROAD_HALF_WIDTH + 1.6;
  boxAt(-side - 0.9, -0.9, -side + 0.9, 0.9, 0, 10, GANTRY_PILLAR);
  boxAt(side - 0.9, -0.9, side + 0.9, 0.9, 0, 10, GANTRY_PILLAR);
  boxAt(-side + 0.9, -0.4, side - 0.9, 0.4, 7, 9.6, GANTRY_BANNER);
  // White pixel lettering on both faces, readable from either direction.
  for (const face of [-1, 1]) {
    pixelText(mb, 'START', 0.36, (r, h, w, hh) => {
      const rr = face < 0 ? r : -r - w;
      const f = face * 0.42;
      mb.quad(at(rr, f, h), at(rr + w, f, h), at(rr + w, f, h + hh), at(rr, f, h + hh), 0xffffff);
    }, 8.3);
  }
}

const FONT: Record<string, string[]> = {
  S: [' ### ', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
};

/** Lay out a 5x7 pixel font centred on r = 0; `px(r, h, w, h)` draws one pixel block. */
function pixelText(
  _mb: MeshBuilder,
  text: string,
  size: number,
  px: (r: number, h: number, w: number, hh: number) => void,
  centreH: number,
): void {
  const width = (text.length * 6 - 1) * size;
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]!];
    if (!glyph) continue;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row]![col] !== '#') continue;
        px(-width / 2 + (i * 6 + col) * size, centreH + (3.5 - row - 1) * size, size, size);
      }
    }
  }
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

/**
 * Loop profile in the (forward, height) plane: nearly round like the original's (radius 16 m at the
 * bottom, 8 m at the top, ~22 m tall). The slightly tighter top makes it drift forward by ~12 m
 * per turn, so entry and exit run a road-width apart instead of on top of each other.
 * Returns samples as [forward, height, arcLength] with forward measured from the loop's start.
 */
export function loopProfile(n = 72): { f: number; h: number; s: number }[] {
  const kBottom = 1 / 16;
  const kTop = 1 / 8;
  const out = [{ f: 0, h: 0, s: 0 }];
  let f = 0;
  let h = 0;
  let s = 0;
  const dphi = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const phi = (i + 0.5) * dphi;
    const k = kBottom + ((kTop - kBottom) * (1 - Math.cos(phi))) / 2;
    const ds = dphi / k;
    f += Math.cos(phi) * ds;
    h += Math.sin(phi) * ds;
    s += ds;
    out.push({ f, h, s });
  }
  return out;
}

/**
 * Loop piece: the teardrop profile on the centre line. The rising and falling passes deliberately
 * cross each other (as a loop must); cars are ray-based and only ever see the surface under them,
 * so crossing is harmless and nobody has to steer inside the loop.
 */
function loopPath(c: [number, number], dir: Dir): Path {
  const prof = loopProfile();
  const span = prof[prof.length - 1]!.f;
  const f0 = -span / 2;
  const samples: Sample[] = [[0, -TILE, 0], [0, f0 - 6, 0]];
  for (const p of prof) samples.push([0, f0 + p.f, p.h]);
  samples.push([0, f0 + span + 6, 0], [0, TILE, 0]);
  return framePath(c, dir, samples, true);
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
export interface BuiltTrack {
  group: THREE.Group;
  world: CollisionWorld;
}

export function buildTrack(track: Track): BuiltTrack {
  const mb = new MeshBuilder();
  const ground = GROUND_COLOR[track.horizon];
  const hillColor = new THREE.Color(ground).multiplyScalar(0.92).getHex();
  const size = GRID * TILE;

  // Ground: one plain, unshaded quad (no seams to crack open at 320x200), in its own mesh pushed
  // back with polygonOffset so water and roads just above it never z-fight.
  const gmb = new MeshBuilder(false);
  const big = 6000;
  gmb.quad([-big, -big, 0], [size + big, -big, 0], [size + big, size + big, 0], [-big, size + big, 0], ground);

  // Terrain.
  const waterTiles: [number, number][] = [];
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const t = decodeTerrain(track.terrain[x]![z]!);
      const e = x * TILE;
      const n = z * TILE;
      const c: [number, number] = [e + TILE / 2, n + TILE / 2];
      if (t.kind === 'water') {
        waterTiles.push([x, z]);
        mb.quad([e, n, 0.06], [e + TILE, n, 0.06], [e + TILE, n + TILE, 0.06], [e, n + TILE, 0.06], WATER_COLOR);
      } else if (t.kind === 'hill') {
        mb.box(e, n, 0, e + TILE, n + TILE, HILL_HEIGHT, hillColor, SURFACE.Grass);
      } else if (t.kind === 'slope') {
        const fr = FRAME[t.ascent];
        const at = (r: number, f: number, h: number): V3 => [
          c[0] + r * fr.r[0] + f * fr.f[0],
          c[1] + r * fr.r[1] + f * fr.f[1],
          h,
        ];
        const h = TILE / 2;
        mb.quad(at(-h, -h, 0), at(h, -h, 0), at(h, h, HILL_HEIGHT), at(-h, h, HILL_HEIGHT), hillColor, SURFACE.Grass);
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
  const groundMesh = gmb.build();
  const gm = groundMesh.material as THREE.MeshLambertMaterial;
  gm.polygonOffset = true;
  gm.polygonOffsetFactor = 2;
  gm.polygonOffsetUnits = 4;
  group.add(groundMesh, mb.build());
  const world = new CollisionWorld(mb.solidPositions, mb.solidSurfaces);
  for (const [x, z] of waterTiles) world.addWater(x, z);
  return { group, world };
}
