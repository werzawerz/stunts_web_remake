import { palette, sprite, type Sprite } from './cockpit';
import { fetchOriginal } from './files';
import { parseResources, unpack } from './formats';

/*
 * Full-screen pictures and sprites of the original menus, read at runtime from the player's own
 * Stunts files like the cockpits: SDMSEL.PVS "scrn" is the main menu (road, bridge and the five
 * signs), SDGAME2.PVS "ex01".."ex03" the explosion.
 */

const cache = new Map<string, Promise<Map<string, Sprite> | null>>();

/** All bitmaps of an original .PVS file, or null when it isn't available. */
export function loadPictures(file: string): Promise<Map<string, Sprite> | null> {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      const [pal, buf] = await Promise.all([palette(), fetchOriginal(file)]);
      if (!pal || !buf) return null;
      const out = new Map<string, Sprite>();
      for (const [name, bytes] of parseResources(unpack(buf))) {
        if (name.startsWith('!')) continue;
        const s = sprite(bytes, pal);
        if (s) out.set(name, s);
      }
      return out;
    })().catch(() => null);
    cache.set(file, p);
  }
  return p;
}
