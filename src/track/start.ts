import type { Dir } from './tiles';
import { decodeTile } from './tiles';
import { GRID, type Track } from './trkFormat';
import { TILE } from './constants';

export interface StartInfo {
  /** Centre of the start/finish tile (east, north) in metres. */
  centre: [number, number];
  dir: Dir;
}

/** First start/finish line found on the track, or null. */
export function findStart(track: Track): StartInfo | null {
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const info = decodeTile(track.elements[x]![z]!);
      if (info.kind === 'start') return { centre: [(x + 0.5) * TILE, (z + 0.5) * TILE], dir: info.dir };
    }
  }
  return null;
}
