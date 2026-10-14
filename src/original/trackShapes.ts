import { fetchOriginal } from './files';
import { parseResources, parseShape, unpack, type Shape } from './formats';

/*
 * The original track element shapes (GAME1.P3S and GAME2.P3S), read at runtime from the player's
 * own Stunts files (see ./files.ts). Without them the track builder uses our own geometry.
 */

let promise: Promise<Map<string, Shape> | null> | null = null;

export function loadTrackShapes(): Promise<Map<string, Shape> | null> {
  promise ??= (async () => {
    const [g1, g2] = await Promise.all([fetchOriginal('GAME1.P3S'), fetchOriginal('GAME2.P3S')]);
    if (!g1 || !g2) return null;
    const shapes = new Map<string, Shape>();
    for (const file of [g1, g2]) {
      for (const [name, bytes] of parseResources(unpack(file))) {
        try {
          shapes.set(name, parseShape(bytes));
        } catch {
          // Not a shape resource; ignore.
        }
      }
    }
    return shapes;
  })().catch((err: unknown) => {
    console.warn('[stunts] could not read the original track shapes', err);
    return null;
  });
  return promise;
}
