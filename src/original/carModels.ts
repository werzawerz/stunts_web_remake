import materials from '../../tools/stunts/materials.json';
import { UNIT } from '../track/constants';
import { CAR_FILES, fetchOriginal } from './files';
import { parseResources, parseShape, unpack } from './formats';

/* Original car models and names, read at runtime from the Stunts files (see ./files.ts). */

export interface CarModelPrim {
  /** 3..10 polygon with that many corners, 11 sphere, 12 wheel. */
  type: number;
  /** One colour per paint job. */
  colors: string[];
  idx: number[];
}

export interface CarModel {
  name: string;
  paints: number;
  /** [x, y, z] in body space (x right, y forward, z up), metres, z = 0 on the road. */
  verts: [number, number, number][];
  prims: CarModelPrim[];
}

// The detailed model ("car0") is drawn 20x larger than the in-world model (800 vs 40 units wide).
const SCALE = UNIT / 20;
const COLORS: string[] = (materials as { colors: string[] }).colors;

function carName(res: Map<string, Uint8Array>): string | null {
  const b = res.get('gnam');
  return b ? String.fromCharCode(...b).replace(/\0.*$/s, '') : null;
}

/** Load whatever original cars are available; missing files are skipped. */
export async function loadOriginalCarModels(): Promise<Record<string, CarModel>> {
  const out: Record<string, CarModel> = {};
  await Promise.all(
    Object.entries(CAR_FILES).map(async ([id, suffix]) => {
      const [res, p3s] = await Promise.all([fetchOriginal(`CAR${suffix}.RES`), fetchOriginal(`ST${suffix}.P3S`)]);
      if (!res || !p3s) return;
      try {
        const shape = parseShape(parseResources(unpack(p3s)).get('car0')!);
        out[id] = {
          name: carName(parseResources(res)) ?? id,
          paints: shape.paints,
          // Shape axes x right, y up, z forward → body axes x right, y forward, z up.
          verts: shape.verts.map(([x, y, z]) => [x * SCALE, z * SCALE, y * SCALE]),
          prims: shape.prims
            .filter((p) => p.type >= 3)
            .map((p) => ({ type: p.type, colors: p.materials.map((m) => COLORS[m] ?? '#ff00ff'), idx: p.idx })),
        };
      } catch (err) {
        console.warn(`[stunts] could not read original car ${id}`, err);
      }
    }),
  );
  return out;
}
