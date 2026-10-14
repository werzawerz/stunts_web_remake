import * as THREE from 'three';
import { DEFAULT_CAR, type CarSpec } from '../physics/car';
import { MeshBuilder } from '../track/meshBuilder';
import type { Quat, Vec3 } from '../physics/vec';

/**
 * Placeholder low-poly car in body space (x right, y forward, z up, origin at the centre of mass).
 * MeshBuilder converts (east, north, up) → Three.js, so the mesh is authored directly in sim axes.
 */
export function createCarMesh(spec: CarSpec = DEFAULT_CAR, body = 0xd02020): THREE.Group {
  const mb = new MeshBuilder();
  const hw = spec.halfTrack + 0.1;
  const ride = 0.6; // centre of mass height above ground at rest
  const bottom = -ride + 0.28;
  mb.box(-hw, -2.1, bottom, hw, 2.1, bottom + 0.5, body); // lower body
  mb.box(-hw + 0.15, -0.5, bottom + 0.5, hw - 0.15, 1.5, bottom + 0.95, 0xe8e8f0); // cabin glass
  mb.box(-hw + 0.1, -0.2, bottom + 0.95, hw - 0.1, 1.2, bottom + 1.02, body); // roof
  mb.box(-hw, 1.85, bottom + 0.5, hw, 2.1, bottom + 0.62, 0x222222); // nose strip
  mb.box(-hw, -2.1, bottom + 0.5, hw, -1.9, bottom + 0.75, 0x222222); // spoiler lip
  const wr = spec.wheelRadius;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * spec.halfTrack;
      const y = sy * spec.halfWheelbase;
      const z = -ride + wr;
      mb.box(x - 0.16 + sx * 0.1, y - wr, z - wr, x + 0.16 + sx * 0.1, y + wr, z + wr, 0x111111);
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
