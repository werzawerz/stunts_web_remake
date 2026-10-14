import * as THREE from 'three';

/** (east, north, up) in metres. Converted to Three.js (x, y, z) = (east, up, -north) on insertion. */
export type V3 = readonly [number, number, number];

/** VGA DACs had 6 bits per channel; snapping to those steps gives the 1990 palette feel. */
export function vgaQuantize(v: number): number {
  return Math.round(Math.min(Math.max(v, 0), 1) * 63) / 63;
}

/**
 * Fixed per-face shading like the original: no dynamic lights, each polygon gets one palette
 * shade from its orientation (tops brightest, east/west walls a bit lighter than north/south).
 * Faces are double-sided, so only the magnitude of each normal component is used.
 */
function faceShade(a: V3, b: V3, c: V3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  const s = 0.64 + 0.36 * Math.abs(nz / len) + 0.1 * Math.abs(nx / len);
  return Math.min(1, Math.round(s * 6) / 6); // a handful of discrete shades
}

/** Accumulates flat-coloured triangles into one non-indexed mesh (cheap, and gives the faceted Stunts look). */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private readonly c = new THREE.Color();
  /** Driveable triangles in sim space (9 numbers each) and their surface ids, for CollisionWorld. */
  readonly solidPositions: number[] = [];
  readonly solidSurfaces: number[] = [];

  /** @param shaded false for surfaces that should keep their exact colour (ground, sky, markings). */
  constructor(private readonly shaded = true) {}

  /** `solid`: surface id (see physics/collision SURFACE) if cars may drive on this triangle. */
  tri(a: V3, b: V3, c: V3, color: number, solid?: number): void {
    const k = this.shaded ? faceShade(a, b, c) : 1;
    const r = vgaQuantize((((color >> 16) & 255) / 255) * k);
    const g = vgaQuantize((((color >> 8) & 255) / 255) * k);
    const bl = vgaQuantize(((color & 255) / 255) * k);
    this.c.setRGB(r, g, bl, THREE.SRGBColorSpace);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[2], -p[1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    if (solid !== undefined) {
      this.solidPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      this.solidSurfaces.push(solid);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: number, solid?: number): void {
    this.tri(a, b, c, color, solid);
    this.tri(a, c, d, color, solid);
  }

  /** Convex polygon (fan triangulated). */
  poly(pts: V3[], color: number): void {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0]!, pts[i]!, pts[i + 1]!, color);
  }

  box(
    e0: number,
    n0: number,
    h0: number,
    e1: number,
    n1: number,
    h1: number,
    color: number,
    solidTop?: number,
  ): void {
    const p = (e: number, n: number, h: number): V3 => [e, n, h];
    this.quad(p(e0, n0, h1), p(e1, n0, h1), p(e1, n1, h1), p(e0, n1, h1), color, solidTop); // top
    this.quad(p(e0, n0, h0), p(e0, n1, h0), p(e1, n1, h0), p(e1, n0, h0), color); // bottom
    this.quad(p(e0, n0, h0), p(e1, n0, h0), p(e1, n0, h1), p(e0, n0, h1), color); // south
    this.quad(p(e0, n1, h0), p(e0, n1, h1), p(e1, n1, h1), p(e1, n1, h0), color); // north
    this.quad(p(e0, n0, h0), p(e0, n0, h1), p(e0, n1, h1), p(e0, n1, h0), color); // west
    this.quad(p(e1, n0, h0), p(e1, n1, h0), p(e1, n1, h1), p(e1, n0, h1), color); // east
  }

  buildGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }

  /** Unlit material: all shading is baked into the vertex colours. */
  build(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    return new THREE.Mesh(this.buildGeometry(), mat);
  }
}
