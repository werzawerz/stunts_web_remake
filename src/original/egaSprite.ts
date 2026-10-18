import type { Sprite } from './cockpit';

/*
 * The original's EGA bitmaps (.PES/.ESH icons, e.g. the track editor's in SDTEDIT.PES), per
 * wiki.stunts.hu "Resource file format": a 16-byte header (uint16 width in bytes, height, centre
 * x/y, position x/y, then planar[4]) and up to four 1-bit planes stacked one after the other.
 * Each plane ORs the low nibble of its planar[] value into the pixel's EGA colour (the third
 * entry's high nibble marks the planes stored column by column). 0 is see-through.
 */

export interface EgaBitmap {
  width: number;
  height: number;
  /** Palette index per pixel, row by row (0 = see-through). */
  pixels: Uint8Array;
}

export function decodeEga(bytes: Uint8Array): EgaBitmap | null {
  if (bytes.length < 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wb = dv.getUint16(0, true);
  const h = dv.getUint16(2, true);
  const w = wb * 8;
  if (!w || !h) return null;
  // The low nibbles are EGA colour bits (the first 16 palette entries are the EGA colours).
  const planar = [bytes[12]! & 0x0f, bytes[13]! & 0x0f, bytes[14]! & 0x0f, bytes[15]! & 0x0f];
  const transposed = bytes[14]! >> 4;
  const plane = wb * h;
  const pixels = new Uint8Array(w * h);
  for (let ch = 0; ch < 4; ch++) {
    const value = planar[ch]!;
    if (!value) continue;
    const base = 16 + ch * plane;
    if (base + plane > bytes.length) break;
    const cols = (transposed >> ch) & 1;
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < wb; bx++) {
        const byte = bytes[base + (cols ? bx * h + y : y * wb + bx)]!;
        for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) pixels[y * w + bx * 8 + bit]! |= value;
      }
    }
  }
  return { width: w, height: h, pixels };
}

/** As a canvas sprite with the given palette (index 0 see-through). */
export function egaSprite(bytes: Uint8Array, pal: [number, number, number][]): Sprite | undefined {
  const b = decodeEga(bytes);
  if (!b) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = b.width;
  canvas.height = b.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(b.width, b.height);
  b.pixels.forEach((v, i) => {
    const [r, g, bl] = pal[v] ?? [255, 0, 255];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = bl;
    img.data[i * 4 + 3] = v === 0 ? 0 : 255;
  });
  ctx.putImageData(img, 0, 0);
  return { image: canvas, x: 0, y: 0 };
}
