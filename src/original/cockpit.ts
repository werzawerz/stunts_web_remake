import { CAR_FILES, fetchOriginal } from './files';
import { parseResources, unpack } from './formats';

/*
 * The original in-car view of each car, read at runtime from the Stunts files (see ./files.ts):
 * STDA*.PVS holds the dashboard bitmaps (dash, roof, instrument face "ins2", steering wheel "whl2",
 * gear box "gbox"), STDB*.PVS the moving parts (steering dot, gear knob), and the car's simd block
 * the needle and dot positions (wiki.stunts.hu/wiki/Car_parameters). Coordinates are 320x200 screen
 * pixels, like the original.
 */

export interface Sprite {
  image: HTMLCanvasElement;
  x: number;
  y: number;
}

interface Needle {
  cx: number;
  cy: number;
  tips: [number, number][];
}

export interface Cockpit {
  roof?: Sprite;
  dash?: Sprite;
  instruments?: Sprite;
  wheel?: Sprite;
  gearbox?: Sprite;
  dot?: Sprite;
  knob?: Sprite;
  /** Screen positions of the steering dot: [0] centred, [1..30] increasingly to the right. */
  dotPath: [number, number][];
  /** Needles in instrument-face coordinates; speed steps are 2.5 mph, rev steps 128 rpm. */
  speedo?: Needle;
  revs?: Needle;
  /** Gear-knob positions in gear-box coordinates, one per forward gear. */
  knobs: [number, number][];
}

let palettePromise: Promise<[number, number, number][] | null> | null = null;

/** The game's 256 colours (SDMAIN.PVS "!pal": 16-byte header, then 6-bit RGB triples). */
function palette(): Promise<[number, number, number][] | null> {
  palettePromise ??= fetchOriginal('SDMAIN.PVS').then((buf) => {
    const pal = buf ? parseResources(unpack(buf)).get('!pal') : undefined;
    if (!pal) return null;
    return Array.from({ length: 256 }, (_, i): [number, number, number] => [
      Math.round((pal[16 + i * 3]! * 255) / 63),
      Math.round((pal[17 + i * 3]! * 255) / 63),
      Math.round((pal[18 + i * 3]! * 255) / 63),
    ]);
  });
  return palettePromise;
}

/** Bitmap resource → canvas sprite. Palette index 255 is transparent. */
function sprite(bytes: Uint8Array | undefined, pal: [number, number, number][]): Sprite | undefined {
  if (!bytes || bytes.length < 16) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint16(0, true);
  const h = dv.getUint16(2, true);
  const flags = bytes[14]!;
  const data = bytes.subarray(16);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let i: number;
      if (flags & 0x10) i = x * h + y; // stored column by column
      else if (flags & 0x20) i = (y % 2 === 0 ? 0 : h / 2) + x * h + (y >> 1); // interlaced columns
      else i = y * w + x;
      const idx = data[i] ?? 255;
      const [r, g, b] = pal[idx]!;
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = idx === 255 ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { image: canvas, x: dv.getUint16(8, true), y: dv.getUint16(10, true) };
}

function needle(simd: Uint8Array, at: number, maxSteps: number): Needle | undefined {
  const dv = new DataView(simd.buffer, simd.byteOffset, simd.byteLength);
  const cx = dv.getInt16(at, true);
  const cy = dv.getInt16(at + 2, true);
  const count = Math.min(simd[at + 4]!, maxSteps);
  if (count === 0 || cx < 0) return undefined;
  const tips: [number, number][] = [];
  for (let i = 0; i < count; i++) tips.push([simd[at + 6 + i * 2]!, simd[at + 7 + i * 2]!]);
  return { cx, cy, tips };
}

const cache = new Map<string, Promise<Cockpit | null>>();

/** The original cockpit for a car, or null when the files aren't available. */
export function loadCockpit(carId: string): Promise<Cockpit | null> {
  let p = cache.get(carId);
  if (!p) {
    p = (async () => {
      const suffix = CAR_FILES[carId];
      if (!suffix) return null;
      const [pal, a, b, res] = await Promise.all([
        palette(),
        fetchOriginal(`STDA${suffix}.PVS`),
        fetchOriginal(`STDB${suffix}.PVS`),
        fetchOriginal(`CAR${suffix}.RES`),
      ]);
      if (!pal || !a || !res) return null;
      const da = parseResources(unpack(a));
      const db = b ? parseResources(unpack(b)) : new Map<string, Uint8Array>();
      const simd = parseResources(res).get('simd');
      if (!simd) return null;
      const dv = new DataView(simd.buffer, simd.byteOffset, simd.byteLength);
      const dotPath: [number, number][] = [];
      for (let i = 0; i < 31; i++) dotPath.push([simd[0xea + i * 2]!, simd[0xeb + i * 2]!]);
      const knobs: [number, number][] = [];
      for (let i = 0; i < 6; i++) knobs.push([dv.getInt16(0x20 + i * 4, true), dv.getInt16(0x22 + i * 4, true)]);
      return {
        roof: sprite(da.get('roof'), pal),
        dash: sprite(da.get('dash'), pal),
        instruments: sprite(da.get('ins2'), pal),
        wheel: sprite(da.get('whl2'), pal),
        gearbox: sprite(da.get('gbox'), pal),
        dot: sprite(db.get('dot'), pal),
        knob: sprite(db.get('gnob'), pal),
        dotPath,
        speedo: needle(simd, 0x128, 104),
        revs: needle(simd, 0x1fe, 128),
        knobs,
      };
    })().catch((err: unknown) => {
      console.warn(`[stunts] could not read the original cockpit of ${carId}`, err);
      return null;
    });
    cache.set(carId, p);
  }
  return p;
}
