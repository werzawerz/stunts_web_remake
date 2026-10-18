import { palette } from './cockpit';
import { decodeEga } from './egaSprite';
import { fetchOriginal } from './files';
import { parseResources, unpack } from './formats';

/*
 * The original track editor's graphics, read at runtime from the player's own files: the piece
 * icons, terrain tiles and cursors of SDTEDIT.PES (EGA bitmaps), packed into one atlas canvas,
 * and the five terrain backgrounds New offers (TEDIT.PRE "ter0".."ter4", 30x30, north row first).
 */

export interface EditorIcon {
  sx: number;
  sy: number;
  w: number;
  h: number;
}

export interface EditorGraphics {
  /** All icons in one canvas. */
  atlas: HTMLCanvasElement;
  /** Where an icon (by its name in SDTEDIT.PES, see ELEMENT_ICONS) is in the atlas. */
  icons: Map<string, EditorIcon>;
  /** The terrain backgrounds (raw bytes, rows north first). */
  terrains: Uint8Array[];
}

let pending: Promise<EditorGraphics | null> | null = null;

export function loadEditorGraphics(): Promise<EditorGraphics | null> {
  pending ??= (async () => {
    const [pal, pes, pre] = await Promise.all([palette(), fetchOriginal('SDTEDIT.PES'), fetchOriginal('TEDIT.PRE')]);
    if (!pal || !pes) return null;
    // Shelf-pack every bitmap into a 512-wide atlas.
    const bitmaps = [...parseResources(unpack(pes))]
      .filter(([n]) => !n.startsWith('!'))
      .map(([n, b]) => [n, decodeEga(b)] as const)
      .filter((e): e is readonly [string, NonNullable<ReturnType<typeof decodeEga>>] => e[1] !== null);
    const W = 512;
    const icons = new Map<string, EditorIcon>();
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const [name, b] of bitmaps) {
      if (x + b.width > W) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      icons.set(name, { sx: x, sy: y, w: b.width, h: b.height });
      x += b.width;
      shelf = Math.max(shelf, b.height);
    }
    const atlas = document.createElement('canvas');
    atlas.width = W;
    atlas.height = y + shelf;
    const ctx = atlas.getContext('2d')!;
    const img = ctx.createImageData(atlas.width, atlas.height);
    for (const [name, b] of bitmaps) {
      const at = icons.get(name)!;
      b.pixels.forEach((v, i) => {
        if (v === 0) return; // see-through
        const o = ((at.sy + Math.floor(i / b.width)) * W + at.sx + (i % b.width)) * 4;
        const [r, g, bl] = pal[v] ?? [255, 0, 255];
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = bl;
        img.data[o + 3] = 255;
      });
    }
    ctx.putImageData(img, 0, 0);

    const tables = pre ? parseResources(unpack(pre)) : new Map<string, Uint8Array>();
    const terrains: Uint8Array[] = [];
    for (let i = 0; i < 5; i++) {
      const t = tables.get(`ter${i}`);
      if (t) terrains.push(t);
    }
    return { atlas, icons, terrains };
  })().catch(() => null);
  return pending;
}

/** The terrain tile icon for a terrain code (flat, water, coasts, hill, slopes, hill corners). */
export function terrainIcon(code: number): string {
  if (code === 0x01) return 'lake';
  if (code >= 0x02 && code <= 0x05) return `lak${code - 1}`;
  if (code === 0x06) return 'high';
  if (code >= 0x07 && code <= 0x0a) return ['goun', 'gouw', 'gous', 'goue'][code - 0x07]!;
  if (code >= 0x0b && code <= 0x12) return `gou${code - 0x0a}`;
  return 'flat';
}
