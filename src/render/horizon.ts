import * as THREE from 'three';
import { vgaQuantize } from '../track/meshBuilder';
import { Horizon } from '../track/trkFormat';

/*
 * Backdrop in the original's style: a flat sky colour, a far layer (hills / mesas / mountains /
 * skyline), a darker near band (tree line) right at the horizon, and a few flat white clouds.
 * Everything is unlit, palette-quantised, and follows the camera so it never gets closer.
 */

type Style = 'hills' | 'mesa' | 'peaks' | 'skyline';

interface Look {
  sky: number;
  far: number;
  farAlt: number;
  near: number;
  style: Style;
  maxHeight: number;
  snow?: number;
}

const LOOKS: Record<Horizon, Look> = {
  [Horizon.Desert]: { sky: 0x6cc8f8, far: 0xb47848, farAlt: 0x9c6438, near: 0x8c5c30, style: 'mesa', maxHeight: 150 },
  [Horizon.Tropical]: { sky: 0x50d4fc, far: 0x2c8c40, farAlt: 0x247834, near: 0x145c20, style: 'hills', maxHeight: 130 },
  [Horizon.Alpine]: { sky: 0x58b0f0, far: 0x8088a0, farAlt: 0x6c7490, near: 0x1c5c24, style: 'peaks', maxHeight: 420, snow: 0xfcfcfc },
  [Horizon.City]: { sky: 0x78b8e8, far: 0x646878, farAlt: 0x808494, near: 0x2c4c2c, style: 'skyline', maxHeight: 260 },
  [Horizon.Country]: { sky: 0x5cd4fc, far: 0x4c9c3c, farAlt: 0x449034, near: 0x1c5c1c, style: 'hills', maxHeight: 110 },
  [Horizon.Chaotic]: { sky: 0xa06cd8, far: 0xc87838, farAlt: 0x5c9c3c, near: 0x3c3c3c, style: 'peaks', maxHeight: 300 },
};

/** Deterministic pseudo-random so the skyline is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HorizonView {
  group: THREE.Group;
  /** Sky colour, also used as the clear colour. */
  fogColor: THREE.Color;
  /** Keep the backdrop centred on the camera so it has no parallax. */
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

const RADIUS = 2600;

class Tris {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();
  tri(a: number[], b: number[], c: number[], hex: number): void {
    this.c.setRGB(
      vgaQuantize(((hex >> 16) & 255) / 255),
      vgaQuantize(((hex >> 8) & 255) / 255),
      vgaQuantize((hex & 255) / 255),
      THREE.SRGBColorSpace,
    );
    for (const p of [a, b, c]) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], hex: number): void {
    this.tri(a, b, c, hex);
    this.tri(a, c, d, hex);
  }
  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -1;
    return mesh;
  }
}

const ring = (a: number, r: number, y: number): number[] => [Math.cos(a) * r, y, Math.sin(a) * r];

/**
 * The original's panorama (1024 pixels round, see original/screens.ts) on a cylinder around the
 * camera: north first, then clockwise. Each pixel spans 360/1024 degrees, as on the original screen.
 */
function panoramaBand(pano: HTMLCanvasElement): THREE.Mesh {
  const tex = new THREE.CanvasTexture(pano);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  const segs = 128;
  const top = RADIUS * Math.tan((pano.height * 2 * Math.PI) / pano.width);
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const p = (a: number, y: number): number[] => [Math.sin(a) * RADIUS, y, -Math.cos(a) * RADIUS];
    const [u0, u1] = [i / segs, (i + 1) / segs];
    const quad = [p(a0, -2), p(a1, -2), p(a1, top), p(a0, -2), p(a1, top), p(a0, top)];
    const quv = [u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1];
    for (const q of quad) pos.push(q[0]!, q[1]!, q[2]!);
    uv.push(...quv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -1;
  return mesh;
}

/** Sky colour of a panorama: the commonest colour along the top of each strip (all share it). */
function panoramaSky(pano: HTMLCanvasElement): number | null {
  const w = pano.width;
  const d = pano.getContext('2d')!.getImageData(0, 0, w, pano.height).data;
  const counts = new Map<number, number>();
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < pano.height; y++) {
      const i = (y * w + x) * 4;
      if (d[i + 3]! === 0) continue;
      const c = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      break;
    }
  }
  let best: number | null = null;
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

/** @param pano the original's horizon panorama, when the player's files have it */
export function createHorizon(h: Horizon, pano: HTMLCanvasElement | null = null): HorizonView {
  const look = { ...LOOKS[h] };
  if (pano) look.sky = panoramaSky(pano) ?? look.sky;
  const rand = mulberry32(1000 + h);
  const t = new Tris();

  // Far layer (our own drawing, when the original panorama isn't available).
  const segs = pano ? 0 : 72;
  const heights: number[] = [];
  for (let i = 0; i < segs; i++) {
    const r = rand();
    switch (look.style) {
      case 'mesa':
        heights.push(i % 7 < 3 ? look.maxHeight * (0.45 + 0.55 * rand()) : 0);
        break;
      case 'peaks':
        heights.push(look.maxHeight * (0.35 + 0.65 * r));
        break;
      case 'skyline':
        heights.push(i % 9 < 5 ? 40 + look.maxHeight * r * r : 0);
        break;
      default:
        heights.push(look.maxHeight * (0.35 + 0.65 * Math.sin(i * 0.45 + r) ** 2));
    }
  }
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const hh = heights[i]!;
    const col = i % 2 === 0 ? look.far : look.farAlt;
    if (look.style === 'peaks') {
      // Triangular mountain per segment, with a snow cap.
      const apex = ring(am, RADIUS, hh);
      const cut = 0.62;
      const l = ring(a0 - 0.02, RADIUS, -20);
      const rr = ring(a1 + 0.02, RADIUS, -20);
      const lc = ring(a0 - 0.02 + (am - a0 + 0.02) * cut, RADIUS, -20 + (hh + 20) * cut);
      const rc = ring(a1 + 0.02 + (am - a1 - 0.02) * cut, RADIUS, -20 + (hh + 20) * cut);
      t.quad(l, rr, rc, lc, col);
      t.tri(lc, rc, apex, look.snow ?? col);
    } else if (look.style === 'hills') {
      const hn = heights[(i + 1) % segs]!;
      t.quad(ring(a0, RADIUS, -20), ring(a1, RADIUS, -20), ring(a1, RADIUS, hn), ring(a0, RADIUS, hh), col);
    } else if (hh > 0) {
      t.quad(ring(a0, RADIUS, -20), ring(a1, RADIUS, -20), ring(a1, RADIUS, hh), ring(a0, RADIUS, hh), col);
    }
  }

  // Near band: a low, dark, ragged tree line slightly in front of the far layer.
  const nearSegs = pano ? 0 : 180;
  for (let i = 0; i < nearSegs; i++) {
    const a0 = (i / nearSegs) * Math.PI * 2;
    const a1 = ((i + 1) / nearSegs) * Math.PI * 2;
    const hh = 18 + 22 * rand();
    t.quad(ring(a0, RADIUS - 60, -20), ring(a1, RADIUS - 60, -20), ring(a1, RADIUS - 60, hh * 0.8), ring(a0, RADIUS - 60, hh), look.near);
  }

  // Clouds: flat white octagons high in the sky, facing the centre.
  for (let k = 0; k < 7; k++) {
    const a = rand() * Math.PI * 2;
    const y = 320 + rand() * 380;
    const w = 140 + rand() * 160;
    const hgt = w * 0.32;
    const c = ring(a, RADIUS - 200, y);
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    const pts: number[][] = [];
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2;
      const ox = Math.cos(ang) * w;
      const oy = Math.sin(ang) * hgt;
      pts.push([c[0]! + tx * ox, c[1]! + oy, c[2]! + tz * ox]);
    }
    for (let j = 1; j < 7; j++) t.tri(pts[0]!, pts[j]!, pts[j + 1]!, 0xfcfcfc);
  }

  const mesh = t.mesh();
  const group = new THREE.Group();
  group.add(mesh);
  const band = pano ? panoramaBand(pano) : null;
  if (band) group.add(band);
  const sky = new THREE.Color();
  sky.setRGB(
    vgaQuantize(((look.sky >> 16) & 255) / 255),
    vgaQuantize(((look.sky >> 8) & 255) / 255),
    vgaQuantize((look.sky & 255) / 255),
    THREE.SRGBColorSpace,
  );

  return {
    group,
    fogColor: sky,
    follow(camera) {
      group.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      if (band) {
        band.geometry.dispose();
        const m = band.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}
