import { CAR_FILES, fetchOriginal } from './files';
import { parseResources, unpack } from './formats';

/*
 * The showroom description of an original car ("edes" in CAR*.RES: lines separated by "]"), read
 * at runtime from the player's own Stunts files.
 */

const cache = new Map<string, Promise<string[] | null>>();

export function loadCarDescription(carId: string): Promise<string[] | null> {
  let p = cache.get(carId);
  if (!p) {
    p = (async () => {
      const suffix = CAR_FILES[carId];
      const buf = suffix ? await fetchOriginal(`CAR${suffix}.RES`) : null;
      const edes = buf ? parseResources(unpack(buf)).get('edes') : undefined;
      if (!edes) return null;
      let text = '';
      for (const b of edes) {
        if (b === 0) break;
        text += String.fromCharCode(b);
      }
      const lines = text.split(']');
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      return lines;
    })().catch(() => null);
    cache.set(carId, p);
  }
  return p;
}
