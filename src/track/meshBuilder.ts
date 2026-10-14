import * as THREE from 'three';

/** (east, north, up) in metres. Converted to Three.js (x, y, z) = (east, up, -north) on insertion. */
export type V3 = readonly [number, number, number];

/** Accumulates flat-coloured triangles into one non-indexed mesh (cheap, and gives the faceted Stunts look). */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private readonly c = new THREE.Color();

  tri(a: V3, b: V3, c: V3, color: number): void {
    this.c.setHex(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[2], -p[1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: number): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  box(e0: number, n0: number, h0: number, e1: number, n1: number, h1: number, color: number): void {
    const p = (e: number, n: number, h: number): V3 => [e, n, h];
    this.quad(p(e0, n0, h1), p(e1, n0, h1), p(e1, n1, h1), p(e0, n1, h1), color); // top
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
    g.computeVertexNormals();
    return g;
  }

  build(): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    return new THREE.Mesh(this.buildGeometry(), mat);
  }
}
