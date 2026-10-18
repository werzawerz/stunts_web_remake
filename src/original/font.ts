import { fetchOriginal } from './files';

/*
 * The original's bitmap fonts (FONTDEF.FNT, FONTN.FNT, FONTLED.FNT), per wiki.stunts.hu "Font
 * file": a 22-byte header (word 14 = height, word 20 = variable width), a table of 256 glyph
 * offsets, and per glyph an optional width byte and its rows, top to bottom, ceil(width / 8)
 * bytes each, left to right with the leftmost pixel in the top bit (as checked against the files;
 * the wiki calls the rows little-endian, which they aren't).
 */

export interface BitmapFont {
  height: number;
  /** Per code point: width, row bits (bit `top` is the leftmost pixel) and that top bit. */
  glyphs: ({ width: number; rows: number[]; top: number } | undefined)[];
}

export function parseFont(bytes: Uint8Array): BitmapFont | null {
  if (bytes.length < 534 || bytes[0] !== 3) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const height = dv.getUint16(14, true);
  const fixedWidth = dv.getUint16(16, true);
  const variable = dv.getUint16(20, true) === 1;
  const glyphs: BitmapFont['glyphs'] = [];
  for (let c = 0; c < 256; c++) {
    let o = dv.getUint16(22 + c * 2, true);
    if (!o || o >= bytes.length) continue;
    const width = variable ? bytes[o++]! : fixedWidth;
    const nb = Math.ceil(width / 8);
    const rows: number[] = [];
    for (let y = 0; y < height; y++) {
      let v = 0;
      for (let k = 0; k < nb; k++) v = (v << 8) | (bytes[o + y * nb + k] ?? 0);
      rows.push(v);
    }
    glyphs[c] = { width, rows, top: nb * 8 - 1 };
  }
  return { height, glyphs };
}

const cache = new Map<string, Promise<BitmapFont | null>>();

/** An original font, or null without the player's Stunts files. */
export function loadFont(file = 'FONTDEF.FNT'): Promise<BitmapFont | null> {
  let p = cache.get(file);
  if (!p) {
    p = fetchOriginal(file)
      .then((b) => (b ? parseFont(b) : null))
      .catch(() => null);
    cache.set(file, p);
  }
  return p;
}

export function textWidth(font: BitmapFont, text: string): number {
  let w = 0;
  for (const ch of text) w += font.glyphs[ch.charCodeAt(0)]?.width ?? 0;
  return w;
}

/** All glyphs of a font in one colour, side by side (x offset per code point). */
interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  x: number[];
}
const atlases = new WeakMap<BitmapFont, Map<string, GlyphAtlas>>();

function atlasFor(font: BitmapFont, colour: string): GlyphAtlas {
  let byColour = atlases.get(font);
  if (!byColour) atlases.set(font, (byColour = new Map()));
  let a = byColour.get(colour);
  if (a) return a;
  const x: number[] = [];
  let w = 0;
  font.glyphs.forEach((g, c) => {
    x[c] = w;
    w += g?.width ?? 0;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = font.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colour;
  font.glyphs.forEach((g, c) => {
    if (!g) return;
    g.rows.forEach((bits, row) => {
      for (let i = 0; i < g.width; i++) if (bits & (1 << (g.top - i))) ctx.fillRect(x[c]! + i, row, 1, 1);
    });
  });
  a = { canvas, x };
  byColour.set(colour, a);
  return a;
}

/** Draw text with its top-left corner at (x, y). */
export function drawText(c: CanvasRenderingContext2D, font: BitmapFont, text: string, x: number, y: number, colour: string): void {
  const a = atlasFor(font, colour);
  let cx = Math.round(x);
  const top = Math.round(y);
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const g = font.glyphs[code];
    if (!g) continue;
    c.drawImage(a.canvas, a.x[code]!, 0, g.width, font.height, cx, top, g.width, font.height);
    cx += g.width;
  }
}
