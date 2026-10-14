import * as THREE from 'three';
import { DEFAULT_CAR, type CarSpec } from '../physics/car';
import { MeshBuilder, type V3 } from '../track/meshBuilder';
import type { Quat, Vec3 } from '../physics/vec';
import type { CarModel } from '../original/carModels';

/*
 * Our own late-80s wedge sports car, built like the original's cars: a few dozen flat polygons.
 * Body space: x right, y forward, z up, origin at the car's physics origin (rideHeight above road).
 * MeshBuilder maps (east, north, up) → Three.js, so the mesh is authored directly in body axes.
 */

type Profile = [y: number, z: number][];

/** Extrude a convex side profile across the car (x from -w to +w). */
function extrude(
  mb: MeshBuilder,
  profile: Profile,
  w: number,
  sideColor: number,
  edgeColor: (i: number) => number,
): void {
  const at = (x: number, i: number): V3 => [x, profile[i]![0], profile[i]![1]];
  for (const x of [-w, w]) mb.poly(profile.map((_, i) => at(x, i)), sideColor);
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    mb.quad(at(-w, i), at(-w, j), at(w, j), at(w, i), edgeColor(i));
  }
}

function wheel(mb: MeshBuilder, x: number, y: number, z: number, r: number, width: number, outward: number): void {
  const ring: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    ring.push([y + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  for (let k = 0; k < 8; k++) {
    const [ay, az] = ring[k]!;
    const [by, bz] = ring[(k + 1) % 8]!;
    mb.quad([x0, ay, az], [x0, by, bz], [x1, by, bz], [x1, ay, az], 0x1c1c1c);
  }
  const xo = outward > 0 ? x1 : x0;
  mb.poly(ring.map(([py, pz]): V3 => [xo, py, pz]), 0x1c1c1c);
  mb.poly(ring.map(([py, pz]): V3 => [xo + outward * 0.01, y + (py - y) * 0.55, z + (pz - z) * 0.55]), 0x9c9c9c);
}

export function createCarMesh(spec: CarSpec = DEFAULT_CAR, body = 0xd81c1c): THREE.Group {
  const mb = new MeshBuilder();
  // Authored at real-car size, then scaled up: the original's cars are about 1/6 of a road wide.
  const S = 1.25;
  const g = -spec.rideHeight / S; // road level in body space
  const glass = 0x1c3048;
  const dark = 0x242424;

  // Lower body: low nose, long flat hood, short rear deck.
  const lower: Profile = [
    [-2.15, g + 0.2],
    [2.05, g + 0.2],
    [2.17, g + 0.38],
    [1.95, g + 0.52],
    [0.7, g + 0.68],
    [-1.6, g + 0.72],
    [-2.15, g + 0.7],
  ];
  extrude(mb, lower, 0.93, body, (i) => (i === 0 ? dark : i === 6 ? dark : body));

  // Cabin: raked windscreen, short roof, sloping rear window; narrower than the body.
  const cabin: Profile = [
    [0.7, g + 0.68],
    [-0.3, g + 1.12],
    [-1.05, g + 1.12],
    [-1.62, g + 0.72],
  ];
  extrude(mb, cabin, 0.74, glass, (i) => (i === 1 ? body : glass));

  // Rear spoiler and lights.
  mb.box(-0.9, -2.2, g + 0.78, 0.9, -1.9, g + 0.84, dark);
  for (const sx of [-1, 1]) {
    mb.box(sx * 0.62 - 0.22, -2.17, g + 0.48, sx * 0.62 + 0.22, -2.14, g + 0.62, 0xfc3030); // tail light
    mb.box(sx * 0.6 - 0.2, 2.0, g + 0.4, sx * 0.6 + 0.2, 2.1, g + 0.48, 0xfcfcb0); // headlight
  }

  // Wheels.
  const wr = 0.33;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      wheel(mb, sx * (spec.halfTrack / S + 0.01), (sy * spec.wheelbase) / 2 / S, g + wr, wr, 0.26, sx);
    }
  }

  const group = new THREE.Group();
  const mesh = mb.build();
  mesh.scale.setScalar(S);
  group.add(mesh);
  return group;
}

/**
 * Mesh from an original car model (see src/original/carModels.ts). The original colours each
 * polygon with its own palette shade, so no extra shading is applied.
 */
export function createCarMeshFromModel(model: CarModel, spec: CarSpec, paint = 0): THREE.Group {
  const mb = new MeshBuilder(false);
  const p = Math.min(paint, model.paints - 1);
  const v = (i: number): V3 => {
    const [x, y, z] = model.verts[i]!;
    return [x, y, z - spec.rideHeight];
  };
  const hex = (c: string): number => parseInt(c.slice(1), 16);
  for (const prim of model.prims) {
    const color = hex(prim.colors[p] ?? prim.colors[0]!);
    if (prim.type <= 10) {
      mb.poly(prim.idx.map(v), color);
    } else if (prim.type === 11) {
      // Sphere: small faceted ball at idx[0], radius 2/3 of the distance to idx[1].
      const c = v(prim.idx[0]!);
      const e = v(prim.idx[1]!);
      const r = Math.hypot(e[0] - c[0], e[1] - c[1], e[2] - c[2]) * (2 / 3);
      const ax: V3[] = [
        [r, 0, 0],
        [-r, 0, 0],
        [0, r, 0],
        [0, -r, 0],
        [0, 0, r],
        [0, 0, -r],
      ];
      const pt = (k: number): V3 => [c[0] + ax[k]![0], c[1] + ax[k]![1], c[2] + ax[k]![2]];
      for (const [a, b] of [
        [0, 2],
        [2, 1],
        [1, 3],
        [3, 0],
      ] as const) {
        mb.tri(pt(a), pt(b), pt(4), color);
        mb.tri(pt(b), pt(a), pt(5), color);
      }
    } else if (prim.type === 12) {
      // Wheel: idx 0 and 3 are the centres of the two sides; radius from idx 1 (vertical).
      const a = v(prim.idx[0]!);
      const b = v(prim.idx[3]!);
      const top = v(prim.idx[1]!);
      const r = Math.hypot(top[0] - a[0], top[1] - a[1], top[2] - a[2]);
      const ring = (c: V3, k: number, scale: number): V3 => {
        const ang = ((k + 0.5) / 10) * Math.PI * 2;
        return [c[0], c[1] + Math.cos(ang) * r * scale, c[2] + Math.sin(ang) * r * scale];
      };
      for (let k = 0; k < 10; k++) mb.quad(ring(a, k, 1), ring(a, k + 1, 1), ring(b, k + 1, 1), ring(b, k, 1), color);
      for (const c of [a, b]) {
        const outer = Array.from({ length: 10 }, (_, k) => ring(c, k, 1));
        mb.poly(outer, color);
        const side = c[0] < 0 ? -0.005 : 0.005;
        mb.poly(
          Array.from({ length: 10 }, (_, k) => {
            const q = ring(c, k, 3 / 5); // rim at 3/5 of the tyre radius, as in the original
            return [q[0] + side, q[1], q[2]] as V3;
          }),
          0x9c9c9c,
        );
      }
    }
  }
  const group = new THREE.Group();
  group.add(mb.build());
  return group;
}

/** Sim quaternion (east, north, up) → Three.js quaternion (east, up, -north). Proper rotation, no mirroring. */
export function setObjectPose(obj: THREE.Object3D, pos: Vec3, q: Quat): void {
  obj.position.set(pos[0], pos[2], -pos[1]);
  obj.quaternion.set(q[1], q[3], -q[2], q[0]);
}
