import materials from '../../tools/stunts/materials.json';
import { UNIT } from '../track/constants';
import { parseResources, parseShape, unpack } from './formats';

/*
 * Original car models and names, read at runtime from Stunts files. Looked up in:
 *  1. original_game/STUNTS11/ — the developer's own copy (git-ignored, served only by the dev server)
 *  2. public/original/       — files the project owner chose to ship with the site (CAR*.RES and
 *                              ST*.P3S). This bundles original artwork; revisit before any
 *                              commercial use (see docs/ROADMAP.md).
 * When neither has them, the game falls back to our own car model.
 */

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

/** Car id (as in CARS) → file suffix of CAR*.RES / ST*.P3S. */
const FILES: Record<string, string> = {
  nsx: 'ANSX',
  audi: 'AUDI',
  coun: 'COUN',
  gto: 'FGTO',
  jag: 'JAGU',
  lanc: 'LANC',
  l002: 'LM02',
  962: 'P962',
  pc4: 'PC04',
  indy: 'PMIN',
  zr1: 'VETT',
};

// The detailed model ("car0") is drawn 20x larger than the in-world model (800 vs 40 units wide).
const SCALE = UNIT / 20;
const COLORS: string[] = (materials as { colors: string[] }).colors;

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // Vite answers unknown paths with index.html; real game files never start with "<".
    return buf.length > 0 && buf[0] !== 0x3c ? buf : null;
  } catch {
    return null;
  }
}

function carName(res: Map<string, Uint8Array>): string | null {
  const b = res.get('gnam');
  return b ? String.fromCharCode(...b).replace(/\0.*$/s, '') : null;
}

const SOURCES = ['/original_game/STUNTS11/', `${import.meta.env.BASE_URL}original/`];

async function fetchFirst(name: string): Promise<Uint8Array | null> {
  for (const base of SOURCES) {
    const b = await fetchBytes(base + name);
    if (b) return b;
  }
  return null;
}

/** Load whatever original cars are available; missing files are skipped. */
export async function loadOriginalCarModels(): Promise<Record<string, CarModel>> {
  const out: Record<string, CarModel> = {};
  await Promise.all(
    Object.entries(FILES).map(async ([id, suffix]) => {
      const [res, p3s] = await Promise.all([fetchFirst(`CAR${suffix}.RES`), fetchFirst(`ST${suffix}.P3S`)]);
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
