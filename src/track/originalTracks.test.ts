import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoute } from '../race/route';
import { findStart } from './start';
import { decodeTile } from './tiles';
import { buildTrack } from './trackBuilder';
import { GRID, parseTrk } from './trkFormat';

// Uses the developer's own Stunts copy when present (git-ignored); skipped elsewhere.
const DIR = 'original_game/STUNTS11';
const TRACKS = ['DEFAULT', 'BERNIES', 'CHERRIS', 'HELENS', 'JOES', 'SKIDS'];
const available = existsSync(`${DIR}/DEFAULT.TRK`);

describe.skipIf(!available)('original tracks', () => {
  for (const name of TRACKS) {
    it(`${name}: every element is understood and the route closes`, () => {
      const track = parseTrk(new Uint8Array(readFileSync(`${DIR}/${name}.TRK`)));
      const unknown: string[] = [];
      for (let x = 0; x < GRID; x++)
        for (let z = 0; z < GRID; z++) {
          const t = decodeTile(track.elements[x]![z]!);
          if (t.kind === 'unknown') unknown.push(`${x},${z}:${t.code.toString(16)}`);
        }
      expect(unknown).toEqual([]);
      const start = findStart(track)!;
      expect(start).not.toBeNull();
      const route = buildRoute(buildTrack(track).pieces, start.dir)!;
      expect(route.closed, `route stopped after ${route.pieces.length} elements`).toBe(true);
      expect(route.pieces.length).toBeGreaterThan(20);
    });
  }
});
