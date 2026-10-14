import * as THREE from 'three';
import { Horizon } from '../track/trkFormat';

interface Look {
  skyTop: number;
  skyLow: number;
  silhouette: number;
  style: 'mesa' | 'peaks' | 'skyline' | 'hills';
  maxHeight: number;
}

const LOOKS: Record<Horizon, Look> = {
  [Horizon.Desert]: { skyTop: 0x3f7fd8, skyLow: 0xf2dcae, silhouette: 0xb98a58, style: 'mesa', maxHeight: 140 },
  [Horizon.Tropical]: { skyTop: 0x2f8fe0, skyLow: 0xcdeef5, silhouette: 0x2d7a5a, style: 'hills', maxHeight: 120 },
  [Horizon.Alpine]: { skyTop: 0x2a62b8, skyLow: 0xdfe9f5, silhouette: 0x8fa3bd, style: 'peaks', maxHeight: 340 },
  [Horizon.City]: { skyTop: 0x4a6aa0, skyLow: 0xd8d4cc, silhouette: 0x575a66, style: 'skyline', maxHeight: 220 },
  [Horizon.Country]: { skyTop: 0x3c8ae0, skyLow: 0xdcefd0, silhouette: 0x4d8c3c, style: 'hills', maxHeight: 90 },
  [Horizon.Chaotic]: { skyTop: 0x7a2fb0, skyLow: 0xf0a060, silhouette: 0x30a060, style: 'peaks', maxHeight: 260 },
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
  /** Colour to use for scene fog and clear colour so the ground fades into the sky. */
  fogColor: THREE.Color;
  /** Keep the backdrop centred on the camera so it has no parallax. */
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

const RADIUS = 2600;

export function createHorizon(h: Horizon): HorizonView {
  const look = LOOKS[h];
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  // Sky dome with a vertical colour gradient.
  const sky = new THREE.SphereGeometry(RADIUS * 1.2, 24, 12);
  const pos = sky.getAttribute('position');
  const colors: number[] = [];
  const low = new THREE.Color(look.skyLow);
  const top = new THREE.Color(look.skyTop);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(Math.max(pos.getY(i) / (RADIUS * 1.2), 0), 1);
    c.copy(low).lerp(top, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const skyMesh = new THREE.Mesh(sky, skyMat);
  skyMesh.renderOrder = -2;
  group.add(skyMesh);
  disposables.push(sky, skyMat);

  // Silhouette wall around the horizon.
  const rand = mulberry32(1000 + h);
  const segs = 96;
  const heights: number[] = [];
  for (let i = 0; i < segs; i++) {
    const r = rand();
    switch (look.style) {
      case 'mesa':
        heights.push(i % 6 < 3 ? look.maxHeight * (0.25 + 0.75 * rand()) : 20 + 20 * r);
        break;
      case 'peaks':
        heights.push(look.maxHeight * (0.2 + 0.8 * Math.abs(Math.sin(i * 0.37) * 0.6 + r * 0.4)));
        break;
      case 'skyline':
        heights.push(i % 2 === 0 ? 30 + look.maxHeight * r * r : 30 + 60 * r);
        break;
      default:
        heights.push(look.maxHeight * (0.3 + 0.5 * Math.sin(i * 0.5) ** 2) * (0.7 + 0.3 * r));
    }
  }
  const wallPos: number[] = [];
  const wallCol: number[] = [];
  const base = new THREE.Color(look.silhouette);
  const shade = new THREE.Color(look.silhouette).multiplyScalar(0.8);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const hh = heights[i]!;
    const hn = look.style === 'peaks' ? heights[(i + 1) % segs]! : hh; // peaks slope into the next segment
    const x0 = Math.cos(a0) * RADIUS;
    const z0 = Math.sin(a0) * RADIUS;
    const x1 = Math.cos(a1) * RADIUS;
    const z1 = Math.sin(a1) * RADIUS;
    const col = i % 2 === 0 ? base : shade;
    const v = [
      [x0, -40, z0],
      [x1, -40, z1],
      [x1, hn, z1],
      [x0, -40, z0],
      [x1, hn, z1],
      [x0, hh, z0],
    ];
    for (const p of v) {
      wallPos.push(p[0]!, p[1]!, p[2]!);
      wallCol.push(col.r, col.g, col.b);
    }
  }
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wall.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
  const wallMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
  group.add(new THREE.Mesh(wall, wallMat));
  disposables.push(wall, wallMat);

  return {
    group,
    fogColor: low.clone(),
    follow(camera) {
      group.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
