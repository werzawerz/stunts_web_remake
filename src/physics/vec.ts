// Tiny vector/quaternion kit for the deterministic simulation.
// Only + - * / and sqrt are used (no trig): those are exactly specified by IEEE-754, so every
// JS engine produces bit-identical results. Sim space is (east, north, up); body space is
// x = right, y = forward, z = up.

export type Vec3 = [number, number, number];
/** Quaternion as [w, x, y, z]. */
export type Quat = [number, number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + (y * cz - z * cy)),
    v[1] + 2 * (w * cy + (z * cx - x * cz)),
    v[2] + 2 * (w * cz + (x * cy - y * cx)),
  ];
}

export const quatConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];

export function quatNormalize(q: Quat): Quat {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Advance orientation by world-space angular velocity w over dt (first-order, renormalised). */
export function quatIntegrate(q: Quat, w: Vec3, dt: number): Quat {
  const h = 0.5 * dt;
  const [qw, qx, qy, qz] = q;
  return quatNormalize([
    qw + h * (-w[0] * qx - w[1] * qy - w[2] * qz),
    qx + h * (w[0] * qw + w[1] * qz - w[2] * qy),
    qy + h * (w[1] * qw + w[2] * qx - w[0] * qz),
    qz + h * (w[2] * qw + w[0] * qy - w[1] * qx),
  ]);
}

/** Orientation whose body axes (x, y, z) map to the given orthonormal world vectors. */
export function quatFromBasis(r: Vec3, f: Vec3, u: Vec3): Quat {
  // Rotation matrix columns are r, f, u.
  const m00 = r[0], m01 = f[0], m02 = u[0];
  const m10 = r[1], m11 = f[1], m12 = u[1];
  const m20 = r[2], m21 = f[2], m22 = u[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  return quatNormalize(q);
}
