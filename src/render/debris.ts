import * as THREE from 'three';
import type { Vec3 } from '../physics/vec';

/*
 * Pieces flying off an exploding car (outside views), in the car's main body colour like the
 * original. Cosmetic only: not part of the simulation.
 */

/** The most common vertex colour of a car mesh: its paint. */
export function bodyColour(obj: THREE.Object3D): THREE.Color {
  const counts = new Map<number, number>();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const attr = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (attr) {
      for (let i = 0; i < attr.count; i++) {
        const key = (Math.round(attr.getX(i) * 255) << 16) | (Math.round(attr.getY(i) * 255) << 8) | Math.round(attr.getZ(i) * 255);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    } else {
      const m = o.material as THREE.MeshBasicMaterial;
      if (m.color) counts.set(m.color.getHex(), (counts.get(m.color.getHex()) ?? 0) + 100);
    }
  });
  let best = 0x808080;
  let n = 0;
  for (const [k, c] of counts) {
    // Skip near-black and near-grey (tyres, windows, trim).
    const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (Math.max(r, g, b) < 40 || sat < 24) continue;
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return new THREE.Color().setRGB(((best >> 16) & 255) / 255, ((best >> 8) & 255) / 255, (best & 255) / 255);
}

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  floor: number;
}

export class Debris {
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];

  /** pos in sim space (east, north, up); vel the car's velocity at the crash. */
  constructor(colour: THREE.Color, pos: Vec3, vel: Vec3, seed: number) {
    let s = seed >>> 0 || 1;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const mat = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const size = 0.3 + rand() * 0.5;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, size, rand() * size * 0.5, 0, rand() * size * 0.6, size, rand() * 0.3], 3),
      );
      const mesh = new THREE.Mesh(g, mat);
      // Render space: (east, up, -north).
      mesh.position.set(pos[0] + (rand() - 0.5) * 2, pos[2] + 0.5 + rand(), -(pos[1] + (rand() - 0.5) * 2));
      const a = rand() * Math.PI * 2;
      const out = 1.5 + rand() * 3.5;
      this.pieces.push({
        mesh,
        vel: new THREE.Vector3(vel[0] * 0.15 + Math.cos(a) * out, 2.5 + rand() * 4.5, -(vel[1] * 0.15 + Math.sin(a) * out)),
        spin: new THREE.Vector3(rand() * 12 - 6, rand() * 12 - 6, rand() * 12 - 6),
        floor: pos[2] - 0.5,
      });
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    for (const p of this.pieces) {
      if (p.mesh.position.y <= p.floor && p.vel.y <= 0) continue; // landed
      p.vel.y -= 9.81 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.mesh.position.y < p.floor) p.mesh.position.y = p.floor;
    }
  }

  dispose(): void {
    for (const p of this.pieces) p.mesh.geometry.dispose();
    (this.pieces[0]?.mesh.material as THREE.Material | undefined)?.dispose();
  }
}
