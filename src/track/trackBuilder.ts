import * as THREE from 'three';
import { HILL_HEIGHT, RAIL_HEIGHT, ROAD_HALF_WIDTH, SLAB, TILE, UNIT } from './constants';
import { CollisionWorld, SURFACE } from '../physics/collision';
import { MeshBuilder, type V3 } from './meshBuilder';
import materials from '../../tools/stunts/materials.json';
import { materialPattern } from './patterns';
import { ELEMENT_SHAPES } from '../original/elementTable.generated';
import type { Shape } from '../original/formats';
import { decodeTerrain, decodeTile, footprint, type Building, type Dir, type Surface, type TileInfo } from './tiles';
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
  guided = false,
): void {
  const edge = (i: number, o: number): V3 => {
    const p = path.pts[i]!;
    const l = lateralAt(path, i);
    return [p[0] + l[0] * o, p[1] + l[1] * o, p[2] + lift];
  };
  for (let i = 0; i < path.pts.length - 1; i++) {
    let guide: V3 | undefined;
    if (guided) {
      const a = path.pts[i]!;
      const b = path.pts[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      guide = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
    }
    mb.quad(
      edge(i, offset - halfW),
      edge(i, offset + halfW),
      edge(i + 1, offset + halfW),
      edge(i + 1, offset - halfW),
      color,
      solid,
      guide,
    );
  }
}

/** Side walls standing on the road edges (elevated roads and ramps have them in the original). */
function rails(mb: MeshBuilder, path: Path, color: number): void {
  for (const side of [-1, 1]) {
    for (let i = 0; i < path.pts.length - 1; i++) {
      const at = (k: number, up: number): V3 => {
        const p = path.pts[k]!;
        const l = lateralAt(path, k);
        return [p[0] + l[0] * ROAD_HALF_WIDTH * side, p[1] + l[1] * ROAD_HALF_WIDTH * side, p[2] + ROAD_LIFT + up];
      };
      mb.quad(at(i, 0), at(i + 1, 0), at(i + 1, RAIL_HEIGHT), at(i, RAIL_HEIGHT), color);
    }
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
function dashedLine(mb: MeshBuilder, path: Path, halfW: number, color: number, dash = 85 * UNIT, period = 170 * UNIT): void {
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
      // Always advance by a sensible amount: float rounding can leave a remainder of ~1e-15.
      const step = on ? dash - phase : period - phase;
      const next = Math.min(len, s + Math.max(step, 0.01));
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

function paintRoad(mb: MeshBuilder, path: Path, surface: Surface, guided = false): void {
  ribbon(mb, path, 0, ROAD_HALF_WIDTH, ROAD_LIFT, ROAD_COLOR[surface], SURFACE_ID[surface], guided);
  const line = CENTRE_LINE[surface];
  if (line !== null) dashedLine(mb, path, 2 * UNIT, line);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Straight piece; heights change linearly, like the original's ramps (one constant 24° slope). */
function straightPath(c: [number, number], dir: Dir, h0 = 0, h1 = h0): Path {
  return framePath(c, dir, [
    [0, -TILE / 2, h0],
    [0, TILE / 2, h1],
  ]);
}

function pillar(mb: MeshBuilder, e: number, n: number, height: number): void {
  const w = 1.8;
  mb.box(e - w, n - w, 0, e + w, n + w, Math.max(height - SLAB, 0.1), CONCRETE);
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
  // Original banner: 264 units wide, 121 units tall.
  const side = 132 * UNIT;
  const top = 121 * UNIT;
  mb.walls(() => {
    boxAt(-side - 0.8, -0.8, -side + 0.8, 0.8, 0, top, GANTRY_PILLAR);
    boxAt(side - 0.8, -0.8, side + 0.8, 0.8, 0, top, GANTRY_PILLAR);
  });
  boxAt(-side + 0.8, -0.4, side - 0.8, 0.4, top - 2.6, top, GANTRY_BANNER);
  // White pixel lettering on both faces, readable from either direction.
  for (const face of [-1, 1]) {
    pixelText(mb, 'START', 0.3, (r, h, w, hh) => {
      const rr = face < 0 ? r : -r - w;
      const f = face * 0.42;
      mb.quad(at(rr, f, h), at(rr + w, f, h), at(rr + w, f, h + hh), at(rr, f, h + hh), 0xffffff);
    }, top - 1.3);
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
  info: { size: 'sharp' | 'large'; edges: [Dir, Dir] },
  h = 0,
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
    pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), h]);
  }
  return { pts };
}

/**
 * Loop centre line in the piece's local frame, measured from the original shape (GAME1 "loop"):
 * an upright ring 898 units long and 975 tall, standing in the middle of its two tiles. The road
 * shifts sideways by 202 units on the way in and 202 the other way inside the ring, so the two
 * passes run side by side instead of through each other; S-bends lead in and out on the centre line.
 * Returns [right, forward, height] samples.
 */
const LOOP_BEND_SEGS = 16;

export function loopSamples(ringSegs = 64, bendSegs = LOOP_BEND_SEGS): Sample[] {
  const R = 449 * UNIT;
  const H = 487.5 * UNIT;
  const D = 202 * UNIT;
  const out: Sample[] = [];
  for (let i = 0; i <= bendSegs; i++) {
    const t = i / bendSegs;
    out.push([-D * smooth(t), -TILE + TILE * t, 0]);
  }
  for (let i = 1; i <= ringSegs; i++) {
    const th = (i / ringSegs) * 2 * Math.PI;
    out.push([D * (th / Math.PI - 1), R * Math.sin(th), H * (1 - Math.cos(th))]);
  }
  for (let i = 1; i <= bendSegs; i++) {
    const t = i / bendSegs;
    out.push([D * (1 - smooth(t)), TILE * t, 0]);
  }
  return out;
}

/**
 * Simple block stand-ins for the original's buildings, at their measured footprints and heights
 * (GAME2: gass, barn, offi, wind, boat, rest, tenn), until proper models are built.
 */
function addBuilding(mb: MeshBuilder, e: number, n: number, type: Building, facing: Dir): void {
  const u = UNIT;
  const rot = (w: number, d: number): [number, number] => (facing === 'E' || facing === 'W' ? [d, w] : [w, d]);
  const block = (w: number, d: number, h0: number, h1: number, color: number): void => {
    const [hw, hd] = rot(w / 2, d / 2);
    mb.box(e - hw, n - hd, h0, e + hw, n + hd, h1, color);
  };
  switch (type) {
    case 'tennis':
      block(300 * u, 500 * u, 0, 0.3, 0x2c8c3c);
      block(300 * u, 4 * u, 0.3, 1.2, 0xfcfcfc);
      break;
    case 'gas':
      block(240 * u, 200 * u, 0, 160 * u, 0xfcfcfc);
      block(250 * u, 210 * u, 150 * u, 175 * u, 0xd81c1c);
      block(80 * u, 40 * u, 0, 120 * u, 0x9c9c9c);
      break;
    case 'barn':
      block(300 * u, 300 * u, 0, 260 * u, 0xa81c1c);
      block(320 * u, 200 * u, 260 * u, 425 * u, 0x6c1c1c);
      break;
    case 'office':
      block(400 * u, 400 * u, 0, 550 * u, 0x5c7ca8);
      block(380 * u, 380 * u, 550 * u, 570 * u, 0x9c9c9c);
      break;
    case 'windmill':
      block(140 * u, 140 * u, 0, 380 * u, 0xece8dc);
      block(150 * u, 150 * u, 380 * u, 460 * u, 0xa81c1c);
      block(260 * u, 20 * u, 400 * u, 420 * u, 0x6c4c2c);
      block(20 * u, 20 * u, 300 * u, 495 * u, 0x6c4c2c);
      break;
    case 'ship':
      block(220 * u, 520 * u, 0, 120 * u, 0x2c2c4c);
      block(160 * u, 200 * u, 120 * u, 260 * u, 0xfcfcfc);
      block(40 * u, 40 * u, 260 * u, 440 * u, 0xd8a01c);
      break;
    case 'diner':
      block(400 * u, 300 * u, 0, 180 * u, 0xd8c8a0);
      block(420 * u, 320 * u, 180 * u, 200 * u, 0x2c9c9c);
      block(160 * u, 20 * u, 200 * u, 292 * u, 0xd81c1c);
      break;
  }
}

/** Scenery at the original's sizes (palm 211, cactus 290, tree 300 units tall). */
function addScenery(mb: MeshBuilder, e: number, n: number, type: 'palm' | 'cactus' | 'pine'): void {
  if (type === 'palm') {
    mb.box(e - 0.8, n - 0.8, 0, e + 0.8, n + 0.8, 11, 0x7a5230);
    mb.box(e - 5, n - 5, 11, e + 5, n + 5, 12.9, 0x2f8a2f);
  } else if (type === 'cactus') {
    mb.box(e - 1.2, n - 1.2, 0, e + 1.2, n + 1.2, 17.7, 0x3c8c3c);
    mb.box(e - 5, n - 0.8, 7, e - 1.2, n + 0.8, 8.6, 0x3c8c3c);
    mb.box(e - 5, n - 0.8, 7, e - 3.4, n + 0.8, 12, 0x3c8c3c);
    mb.box(e + 1.2, n - 0.8, 9, e + 4.4, n + 0.8, 10.6, 0x3c8c3c);
    mb.box(e + 2.8, n - 0.8, 9, e + 4.4, n + 0.8, 14, 0x3c8c3c);
  } else {
    const apex: V3 = [e, n, 18.3];
    const r = 3.6;
    const base: V3[] = [
      [e - r, n - r, 3],
      [e + r, n - r, 3],
      [e + r, n + r, 3],
      [e - r, n + r, 3],
    ];
    for (let i = 0; i < 4; i++) mb.tri(base[i]!, base[(i + 1) % 4]!, apex, 0x1f5f2a);
    mb.box(e - 0.7, n - 0.7, 0, e + 0.7, n + 0.7, 3, 0x5a3a20);
  }
}

/**
 * Build render meshes for a track. Everything is one flat-shaded mesh in world space
 * (Three.js: x = east, y = up, z = -north).
 */
/** One road element of the track, for working out the route (see race/route.ts). */
export interface TrackPiece {
  /** Anchor tile (where the code sits). */
  anchor: [number, number];
  /** Every tile the element covers: touching any of them counts as driving it (original rule). */
  cells: [number, number][];
  /** Where the road leaves the element at either end, (east, north) in metres. */
  ends: [[number, number], [number, number]];
  /** Centre line from ends[0] to ends[1] (east, north, up). */
  path: [number, number, number][];
  kind: TileInfo['kind'];
}

export interface BuiltTrack {
  group: THREE.Group;
  world: CollisionWorld;
  pieces: TrackPiece[];
}

/**
 * Build a track. Pass the original track shapes (src/original/trackShapes.ts) to draw and drive the
 * original pieces; without them our own geometry is used.
 */
export function buildTrack(track: Track, shapes?: Map<string, Shape> | null): BuiltTrack {
  const main = new MeshBuilder();
  const mb = main;
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
        // Everything on a hill tile sits on top of it, tunnels too (JOES: roads climb slopes to
        // the tunnels on its hill).
        mb.walls(() => mb.box(e, n, 0, e + TILE, n + TILE, HILL_HEIGHT, hillColor, SURFACE.Grass));
      } else if (t.kind === 'slope') {
        const fr = FRAME[t.ascent];
        const at = (r: number, f: number, h: number): V3 => [
          c[0] + r * fr.r[0] + f * fr.f[0],
          c[1] + r * fr.r[1] + f * fr.f[1],
          h,
        ];
        const h = TILE / 2;
        mb.quad(at(-h, -h, 0), at(h, -h, 0), at(h, h, HILL_HEIGHT), at(-h, h, HILL_HEIGHT), hillColor, SURFACE.Grass);
        mb.walls(() => {
          mb.tri(at(-h, -h, 0), at(-h, h, 0), at(-h, h, HILL_HEIGHT), hillColor);
          mb.tri(at(h, -h, 0), at(h, h, 0), at(h, h, HILL_HEIGHT), hillColor);
        });
      } else if (t.kind === 'corner') {
        // Hill corner: tile corners at ground or hill height, split along the diagonal that keeps
        // the raised (or lowered) corner on its own triangle.
        const [sw, se, ne, nw] = t.heights.map((k) => k * HILL_HEIGHT) as [number, number, number, number];
        const pSW: V3 = [e, n, sw];
        const pSE: V3 = [e + TILE, n, se];
        const pNE: V3 = [e + TILE, n + TILE, ne];
        const pNW: V3 = [e, n + TILE, nw];
        if (sw !== ne || t.heights[0] === t.heights[2]) {
          mb.tri(pSW, pSE, pNW, hillColor, SURFACE.Grass);
          mb.tri(pSE, pNE, pNW, hillColor, SURFACE.Grass);
        } else {
          mb.tri(pSW, pSE, pNE, hillColor, SURFACE.Grass);
          mb.tri(pSW, pNE, pNW, hillColor, SURFACE.Grass);
        }
      } else if (t.kind === 'coast') {
        // Diagonal coast: water triangle at the named corner.
        const corners: Record<'SW' | 'SE' | 'NE' | 'NW', V3> = {
          SW: [e, n, 0.06],
          SE: [e + TILE, n, 0.06],
          NE: [e + TILE, n + TILE, 0.06],
          NW: [e, n + TILE, 0.06],
        };
        const order: ('SW' | 'SE' | 'NE' | 'NW')[] = ['SW', 'SE', 'NE', 'NW'];
        const i = order.indexOf(t.water);
        mb.tri(corners[order[(i + 3) % 4]!], corners[t.water], corners[order[(i + 1) % 4]!], WATER_COLOR);
      }
    }
  }

  /** Ground height under a tile: hills (terrain 06) raise everything on them to hill level. */
  const baseHeight = (x: number, z: number): number =>
    decodeTerrain(track.terrain[x]?.[z] ?? 0).kind === 'hill' ? HILL_HEIGHT : 0;
  /** Heights at the two ends of a straight on a tile, following a hill slope along its axis. */
  const slopeEnds = (x: number, z: number, dir: Dir): [number, number] => {
    const t = decodeTerrain(track.terrain[x]?.[z] ?? 0);
    const b = baseHeight(x, z);
    if (t.kind !== 'slope') return [b, b];
    if (t.ascent === dir) return [0, HILL_HEIGHT];
    const opposite: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
    if (t.ascent === opposite[dir]) return [HILL_HEIGHT, 0];
    return [b, b];
  };

  /**
   * Ground height function for the element anchored on tile (x, z): constant on flat ground and
   * hills; on a slope tile the original shears the element along the slope (a road follows it, and
   * a ramp built against the slope becomes a level road at hill height).
   */
  const groundAt = (x: number, z: number): ((e: number, n: number) => number) => {
    const t = decodeTerrain(track.terrain[x]?.[z] ?? 0);
    if (t.kind !== 'slope') {
      const b = baseHeight(x, z);
      return () => b;
    }
    const e0 = x * TILE;
    const n0 = z * TILE;
    const clamp = (v: number): number => Math.min(1, Math.max(0, v));
    const frac: Record<Dir, (e: number, n: number) => number> = {
      N: (_e, n) => (n - n0) / TILE,
      S: (_e, n) => (n0 + TILE - n) / TILE,
      E: (e) => (e - e0) / TILE,
      W: (e) => (e0 + TILE - e) / TILE,
    };
    const f = frac[t.ascent];
    return (e, n) => HILL_HEIGHT * clamp(f(e, n));
  };

  // Track elements. With the original shapes, each element is drawn from its original 3D shape
  // and cars drive on its road polygons and bump into its walls; our own geometry is then built
  // off-screen only for the route (and for the loop's guided surface). Without them, our own
  // geometry is drawn and used for everything.
  const omb = new MeshBuilder(false); // original shapes (pre-shaded, so no extra shading)
  const keep = new MeshBuilder(); // off-screen; its driveable triangles are kept
  const scrap = new MeshBuilder(); // off-screen; thrown away
  const pieces: TrackPiece[] = [];
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const code = track.elements[x]![z]!;
      const info = decodeTile(code);
      if (info.kind === 'blank' || info.kind === 'filler' || info.kind === 'unknown') continue;
      const fp = footprint(info);
      // Centre of the footprint (it extends east and south from the anchor tile).
      const c: [number, number] = [(x + fp.w / 2) * TILE, (z + 1 - fp.h / 2) * TILE];
      const dashes = shapes ? drawOriginalElement(omb, shapes, code, c, groundAt(x, z)) : null;
      const original = dashes !== null;
      const firstPiece = pieces.length;
      const mb = original ? (info.kind === 'loop' ? keep : scrap) : main;
      const road = (path: Path, surface: Surface, guided = false, paint = true): Path => {
        if (paint) paintRoad(mb, path, surface, guided);
        const a = path.pts[0]!;
        const b = path.pts[path.pts.length - 1]!;
        const cells: [number, number][] = [];
        for (let i = 0; i < fp.w; i++) for (let j = 0; j < fp.h; j++) cells.push([x + i, z - j]);
        pieces.push({
          anchor: [x, z],
          cells,
          ends: [[a[0], a[1]], [b[0], b[1]]],
          path: path.pts.map((q): [number, number, number] => [q[0], q[1], q[2]]),
          kind: info.kind,
        });
        return path;
      };
      const h = baseHeight(x, z);
      const along = (axis: 'NS' | 'EW'): Dir => (axis === 'NS' ? 'N' : 'E');
      const straight = (dir: Dir): Path => {
        const [h0, h1] = slopeEnds(x, z, dir);
        return straightPath(c, dir, h0, h1);
      };
      switch (info.kind) {
        // Banked roads, tunnels, pipes, highways and slalom are plain-road stand-ins for now.
        case 'road':
          road(straight(along(info.axis)), info.surface);
          break;
        case 'longRoad':
          road(framePath(c, along(info.axis), [[0, -TILE, h], [0, TILE, h]]), 'paved');
          break;
        case 'crossroad':
          road(straight('N'), info.surface);
          road(straight('E'), info.surface);
          break;
        case 'chicane': {
          // S-bend from one column (or row) of the 2x2 block to the other.
          const s0 = (info.axis === 'NS') === (info.from === 'W') ? -TILE / 2 : TILE / 2;
          const samples: Sample[] = [];
          for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            samples.push([s0 + (-2 * s0) * smooth(t), -TILE + 2 * TILE * t, h]);
          }
          road(framePath(c, along(info.axis), samples), 'paved');
          break;
        }
        case 'start': {
          road(straight(info.dir), info.surface);
          startGantry(mb, c, info.dir);
          break;
        }
        case 'elevatedRoad': {
          const p = road(straightPath(c, along(info.axis), HILL_HEIGHT), 'paved');
          mb.walls(() => {
            skirt(mb, p, ROAD_HALF_WIDTH, CONCRETE, info.solid === true);
            rails(mb, p, CONCRETE);
            if (!info.span) pillar(mb, c[0], c[1], HILL_HEIGHT);
          });
          // "Span over road": a ground road crosses underneath.
          if (info.span === 'overRoad') road(straight(info.axis === 'NS' ? 'E' : 'N'), 'paved');
          break;
        }
        case 'elevatedCorner': {
          const p = road(cornerPath([x, z], { size: 'large', edges: info.edges }, HILL_HEIGHT), 'paved');
          mb.walls(() => {
            skirt(mb, p, ROAD_HALF_WIDTH, CONCRETE, false);
            rails(mb, p, CONCRETE);
            const mid = p.pts[Math.floor(p.pts.length / 2)]!;
            pillar(mb, mid[0], mid[1], HILL_HEIGHT);
          });
          break;
        }
        case 'ramp': {
          const p = road(straightPath(c, info.dir, h, HILL_HEIGHT + h), 'paved');
          mb.walls(() => {
            skirt(mb, p, ROAD_HALF_WIDTH, CONCRETE, info.style === 'solid');
            rails(mb, p, CONCRETE);
            if (info.style !== 'solid') {
              const fr = FRAME[info.dir];
              pillar(mb, c[0] + fr.f[0] * TILE * 0.25, c[1] + fr.f[1] * TILE * 0.25, HILL_HEIGHT * 0.75);
            }
          });
          break;
        }
        case 'loop': {
          // Only the ring guides the car, as you can't steer in the original's loop. The bends into
          // and out of it (the exit is beside the entrance) are ordinary road you steer along, like
          // the original's approach: guided, they pulled the car sideways on the flat.
          const dir = along(info.axis);
          const samples = loopSamples();
          const bend = LOOP_BEND_SEGS + 1;
          paintRoad(mb, framePath(c, dir, samples.slice(0, bend), true), 'paved', false);
          paintRoad(mb, framePath(c, dir, samples.slice(bend - 1, samples.length - bend + 1), true), 'paved', true);
          paintRoad(mb, framePath(c, dir, samples.slice(samples.length - bend), true), 'paved', false);
          road(framePath(c, dir, samples, true), 'paved', true, false);
          break;
        }
        case 'corner':
          road(cornerPath([x, z], info, h), info.surface);
          break;
        case 'split': {
          // Fork: the corner plus a straight continuing from the same entry edge.
          const bend = road(cornerPath([x, z], info, h), info.surface);
          const span = info.size === 'large' ? 2 : 1;
          const entry = bend.pts.find((q) =>
            info.axis === 'NS'
              ? Math.abs(q[1] - (z + 1) * TILE) < 1 || Math.abs(q[1] - (z - span + 1) * TILE) < 1
              : Math.abs(q[0] - x * TILE) < 1 || Math.abs(q[0] - (x + span) * TILE) < 1,
          )!;
          const lineC: [number, number] = info.axis === 'NS' ? [entry[0], c[1]] : [c[0], entry[1]];
          const half = (span * TILE) / 2;
          road(framePath(lineC, along(info.axis), [[0, -half, h], [0, half, h]]), info.surface);
          break;
        }
        case 'scenery':
          mb.walls(() => addScenery(mb, c[0], c[1], info.type));
          break;
        case 'building':
          mb.walls(() => addBuilding(mb, c[0], c[1], info.type, info.facing));
          break;
      }
      // Original pieces: follow the original road, using its centre-line dashes (our own path can
      // be off, e.g. on banks). The end points stay ours so the route still connects.
      if (dashes && info.kind !== 'loop') followDashes(pieces.slice(firstPiece), dashes);
      const el = ELEMENT_SHAPES[code];
      if (original && el?.shape === 'hpip') {
        for (const piece of pieces.slice(firstPiece)) piece.path = aroundPipeBlock(piece.path);
      }
      if (original && el?.shape === 'barr') {
        for (const piece of pieces.slice(firstPiece)) piece.path = throughSlalom(piece.path, c, el.rot);
      }
      if (original && (el?.shape === 'gwro' || el?.shape === 'wroa')) {
        for (const piece of pieces.slice(firstPiece)) piece.path = ontoCarriageway(piece.path, c, el.rot, el.shape === 'gwro');
      }
    }
  }

  // The field is fenced in, as in the original: you can't drive off the 30x30 grid.
  for (let i = 0; i < GRID; i++) {
    const sides: [number, number, number][] = [
      [i, GRID - 1, 0], // north edge
      [GRID - 1, i, 1], // east edge
      [i, 0, 2], // south edge
      [0, i, 3], // west edge
    ];
    for (const [x, z, rot] of sides) {
      const c: [number, number] = [(x + 0.5) * TILE, (z + 0.5) * TILE];
      if (shapes && drawShape(omb, shapes, 'fenc', 0, rot, c, groundAt(x, z), true)) continue;
      const fr = FRAME[(['N', 'E', 'S', 'W'] as const)[rot]!];
      const at = (r: number, f: number, up: number): V3 => [c[0] + r * fr.r[0] + f * fr.f[0], c[1] + r * fr.r[1] + f * fr.f[1], up];
      const h = TILE / 2;
      main.walls(() => main.quad(at(-h, h, 0), at(h, h, 0), at(h, h, 2.5), at(-h, h, 2.5), 0x9c9c9c));
    }
  }

  const group = new THREE.Group();
  const groundMesh = gmb.build();
  const gm = groundMesh.material as THREE.MeshLambertMaterial;
  gm.polygonOffset = true;
  gm.polygonOffsetFactor = 2;
  gm.polygonOffsetUnits = 4;
  group.add(groundMesh, main.build());
  if (shapes) {
    // Track pieces sit 5 cm above the terrain they lie on (hill tops, ground); pull them towards
    // the camera in the depth test so they always win, whatever the depth buffer's precision.
    const originals = omb.build();
    const om = originals.material as THREE.MeshBasicMaterial;
    om.polygonOffset = true;
    om.polygonOffsetFactor = -1;
    om.polygonOffsetUnits = -4;
    group.add(originals);
  }
  const world = new CollisionWorld(
    [...main.solidPositions, ...keep.solidPositions, ...omb.solidPositions],
    [...main.solidSurfaces, ...keep.solidSurfaces, ...omb.solidSurfaces],
    [...main.solidGuides, ...keep.solidGuides, ...omb.solidGuides],
    [...main.wallPositions, ...keep.wallPositions, ...omb.wallPositions],
    [...main.wallTags, ...keep.wallTags, ...omb.wallTags],
  );
  void scrap;
  for (const [x, z] of waterTiles) world.addWater(x, z, TILE);
  return { group, world, pieces };
}

// ---- original shapes -------------------------------------------------------------------------

const COLORS: string[] = (materials as { colors: string[] }).colors;
/** Materials of road surfaces and their markings (asphalt greys, yellow and white lines). */
const ROAD_MATERIALS = new Set([18, 19, 20, 21, 22, 23, 24]);
/** Shapes whose steep road surfaces are still driven on (pipes, corkscrews). */
const CURVED = new Set(['pipe', 'pip2', 'hpip', 'spip', 'vcor', 'lco0', 'lco1', 'rco0', 'rco1']);
/** Pieces the car rides around: their other polygons are the road's own underside, not walls. */
const NO_WALLS = new Set(['pipe', 'pip2', 'spip', 'vcor', 'lco0', 'lco1', 'rco0', 'rco1']);
/** Shapes driven on our own guided surface instead of their polygons. */
const OWN_PHYSICS = new Set(['loop', 'loo1']);
const PAINT_SURFACE = [SURFACE.Paved, SURFACE.Dirt, SURFACE.Ice];

/**
 * Draw one original shape centred on `c` (east, north) at ground height `h`, rotated by `rot`
 * clockwise quarter turns, and add its road polygons and walls to the collision geometry.
 * Returns false when the shape isn't available.
 */
function drawShape(
  mb: MeshBuilder,
  shapes: Map<string, Shape>,
  name: string,
  paint: number,
  rot: number,
  c: [number, number],
  ground: (e: number, n: number) => number,
  physics: boolean,
  dashes?: V3[],
): boolean {
  const s = shapes.get(name);
  if (!s) return false;
  mb.wallTag = `${name}@${Math.floor(c[0] / TILE)},${Math.floor(c[1] / TILE)}`;
  // Clockwise quarter turns seen from above: (east, north) -> (e cos + n sin, -e sin + n cos).
  const cos = [1, 0, -1, 0][rot & 3]!;
  const sin = [0, 1, 0, -1][rot & 3]!;
  const tr = (i: number, lift: number): V3 => {
    const [x, y, z] = s.verts[i]!;
    const e = x * UNIT;
    const n = z * UNIT;
    const we = c[0] + e * cos + n * sin;
    const wn = c[1] - e * sin + n * cos;
    // Lift slightly off the ground plane so roads never z-fight with it or let it win ray ties.
    return [we, wn, ground(we, wn) + y * UNIT + 0.05 + lift];
  };
  for (const prim of s.prims) {
    const color = parseInt((COLORS[prim.materials[paint] ?? prim.materials[0]!] ?? '#ff00ff').slice(1), 16);
    if (prim.type >= 3 && prim.type <= 10) {
      // Markings carry the z-bias flag in the original; lift them a touch above the road.
      const pts = prim.idx.map((i) => tr(i, prim.flags & 2 ? 0.04 : 0));
      mb.pattern = materialPattern(prim.materials[paint] ?? prim.materials[0]!);
      mb.poly(pts, color);
      mb.pattern = 0;
      // Yellow centre-line dashes mark the middle of the original road.
      if (dashes && (prim.materials[0] === 21 || prim.materials[0] === 24)) {
        const k = 1 / pts.length;
        dashes.push([
          pts.reduce((a, q) => a + q[0], 0) * k,
          pts.reduce((a, q) => a + q[1], 0) * k,
          pts.reduce((a, q) => a + q[2], 0) * k,
        ]);
      }
      // Markings (z-biased in the original) are paint, not part of the driving surface: as solid
      // polygons 4 cm proud of the asphalt they made the car hop over every dash.
      if (!physics || OWN_PHYSICS.has(name) || prim.flags & 2) continue;
      const [a, b, d] = [pts[0]!, pts[1]!, pts[2]!];
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const nx = u[1] * v[2] - u[2] * v[1];
      const ny = u[2] * v[0] - u[0] * v[2];
      const nz = u[0] * v[1] - u[1] * v[0];
      const up = Math.abs(nz) / (Math.hypot(nx, ny, nz) || 1);
      const roadMaterial = ROAD_MATERIALS.has(prim.materials[0]!);
      for (let k = 1; k < pts.length - 1; k++) {
        if (roadMaterial && (up >= 0.5 || CURVED.has(name))) {
          mb.solidPositions.push(...pts[0]!, ...pts[k]!, ...pts[k + 1]!);
          mb.solidSurfaces.push(PAINT_SURFACE[paint] ?? SURFACE.Paved);
          mb.solidGuides.push(0, 0, 0);
        } else if (up < 0.6 && !NO_WALLS.has(name)) {
          mb.wallTri(pts[0]!, pts[k]!, pts[k + 1]!);
        }
      }
    } else if (prim.type === 11) {
      // Sphere (tree tops and similar): a small faceted ball.
      const cen = tr(prim.idx[0]!, 0);
      const edge = tr(prim.idx[1]!, 0);
      const r = Math.hypot(edge[0] - cen[0], edge[1] - cen[1], edge[2] - cen[2]) * (2 / 3);
      const p = (dx: number, dy: number, dz: number): V3 => [cen[0] + dx * r, cen[1] + dy * r, cen[2] + dz * r];
      const ring = [p(1, 0, 0), p(0, 1, 0), p(-1, 0, 0), p(0, -1, 0)];
      for (let k = 0; k < 4; k++) {
        mb.tri(ring[k]!, ring[(k + 1) % 4]!, p(0, 0, 1), color);
        mb.tri(ring[(k + 1) % 4]!, ring[k]!, p(0, 0, -1), color);
      }
    }
  }
  return true;
}

/** Shortest 2D distance from p to a polyline, and the arc length where it is closest. */
function nearestOnPath(path: [number, number, number][], p: V3): { dist: number; at: number } {
  let best = { dist: Infinity, at: 0 };
  let run = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    if (d < best.dist) best = { dist: d, at: run + Math.sqrt(len2) * t };
    run += Math.sqrt(len2);
  }
  return best;
}

/**
 * The pipe obstacle (hpip) fills the pipe's floor 2.1 m high for 9 m around the tile centre;
 * cars get past on the steep upper wall. Swerve the route up there (6.1 m out, 3.8 m up).
 */
function aroundPipeBlock(path: [number, number, number][]): [number, number, number][] {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const f: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const r: [number, number] = [f[1], -f[0]];
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const s = t * len - len / 2; // metres from the tile centre
    const k = 1 - smooth(Math.min(1, Math.max(0, (Math.abs(s) - 14) / (len / 2 - 14))));
    out.push([
      a[0] + (b[0] - a[0]) * t + r[0] * 6.1 * k,
      a[1] + (b[1] - a[1]) * t + r[1] * 6.1 * k,
      a[2] + (b[2] - a[2]) * t + 3.8 * k,
    ]);
  }
  return out;
}

/**
 * Highways (wroa) have two carriageways either side of a median; the entry piece (gwro) widens the
 * road from its narrow end (shape z = -514) and the median starts in the middle of it. Move the
 * route onto one carriageway (240 units out; always the east or north one, so both ends of a
 * highway agree), drifting over gradually along the entry piece.
 */
function ontoCarriageway(
  path: [number, number, number][],
  c: [number, number],
  rot: number,
  entry: boolean,
): [number, number, number][] {
  const zDir: [number, number] = [[0, 1, 0, -1][rot & 3]!, [1, 0, -1, 0][rot & 3]!];
  const side: [number, number] = Math.abs(zDir[0]) > 0.5 ? [0, 1] : [1, 0];
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const zl = ((p[0] - c[0]) * zDir[0] + (p[1] - c[1]) * zDir[1]) / UNIT;
    const k = entry ? smooth(Math.min(1, Math.max(0, (zl + 514) / 764))) : 1;
    out.push([p[0] + side[0] * 240 * UNIT * k, p[1] + side[1] * 240 * UNIT * k, p[2]]);
  }
  return out;
}

/**
 * Slalom (barr): one barrier blocks shape x 23..97 at z -271..-241, the other x -97..-23 at
 * z 241..271. Weave the route past each on its open side (60 units out).
 */
function throughSlalom(path: [number, number, number][], c: [number, number], rot: number): [number, number, number][] {
  const sin = [0, 1, 0, -1][rot & 3]!;
  const cos = [1, 0, -1, 0][rot & 3]!;
  const zDir: [number, number] = [sin, cos];
  const xDir: [number, number] = [cos, -sin];
  const bump = (d: number): number => 1 - smooth(Math.min(1, Math.max(0, (Math.abs(d) - 40) / 160)));
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const zl = ((p[0] - c[0]) * zDir[0] + (p[1] - c[1]) * zDir[1]) / UNIT;
    const xl = (-60 * bump(zl + 256) + 60 * bump(zl - 256)) * UNIT;
    out.push([p[0] + xDir[0] * xl, p[1] + xDir[1] * xl, p[2]]);
  }
  return out;
}

/** Re-route the pieces of one element through the original centre-line dashes nearest to each. */
function followDashes(elementPieces: TrackPiece[], dashes: V3[]): void {
  const assigned = new Map<TrackPiece, { at: number; p: V3 }[]>();
  for (const d of dashes) {
    let best: { piece: TrackPiece; dist: number; at: number } | null = null;
    for (const piece of elementPieces) {
      const near = nearestOnPath(piece.path, d);
      if (!best || near.dist < best.dist) best = { piece, ...near };
    }
    if (best && best.dist < 12) {
      const list = assigned.get(best.piece) ?? [];
      list.push({ at: best.at, p: d });
      assigned.set(best.piece, list);
    }
  }
  for (const [piece, list] of assigned) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at - b.at);
    const first = piece.path[0]!;
    const last = piece.path[piece.path.length - 1]!;
    piece.path = [first, ...list.map((q): [number, number, number] => [q.p[0], q.p[1], q.p[2]]), last];
  }
}

/**
 * Draw a track element (and its overlay element) from the original shapes. Returns the centres of
 * its yellow centre-line dashes (empty if it has none), or null when the shape isn't available.
 */
function drawOriginalElement(
  mb: MeshBuilder,
  shapes: Map<string, Shape>,
  code: number,
  c: [number, number],
  ground: (e: number, n: number) => number,
): V3[] | null {
  const el = ELEMENT_SHAPES[code];
  if (!el?.shape || !shapes.has(el.shape)) return null;
  const dashes: V3[] = [];
  drawShape(mb, shapes, el.shape, el.paint, el.rot, c, ground, true, dashes);
  const over = el.overlay ? ELEMENT_SHAPES[el.overlay] : undefined;
  if (over?.shape && el.overlay !== code) drawShape(mb, shapes, over.shape, over.paint, over.rot, c, ground, true, dashes);
  return dashes;
}
