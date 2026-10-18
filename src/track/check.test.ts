import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTrackPath } from './check';
import { placeAt } from './editor';
import { createEmptyTrack, parseTrk, type Track } from './trkFormat';

const DIR = 'original_game/STUNTS11';
const ORIGINALS = ['DEFAULT', 'BERNIES', 'CHERRIS', 'HELENS', 'JOES', 'SKIDS'];

/** A 3x3 ring of paved road with the start/finish line on its west side, driving north. */
function ring(): Track {
  const t = createEmptyTrack();
  placeAt(t, 3, 5, 0x06); // corner S-E (top left)
  placeAt(t, 4, 5, 0x05);
  placeAt(t, 5, 5, 0x07); // corner W-S (top right)
  placeAt(t, 5, 4, 0x04);
  placeAt(t, 5, 3, 0x09); // corner W-N (bottom right)
  placeAt(t, 4, 3, 0x05);
  placeAt(t, 3, 3, 0x08); // corner N-E (bottom left)
  placeAt(t, 3, 4, 0x01); // start/finish, north
  return t;
}

describe("the original's track check", () => {
  it.skipIf(!existsSync(`${DIR}/DEFAULT.TRK`))('passes all six original tracks', () => {
    for (const name of ORIGINALS) {
      const t = parseTrk(new Uint8Array(readFileSync(`${DIR}/${name}.TRK`)));
      expect(checkTrackPath(t).error, name).toBeNull();
    }
  });

  it('passes a closed ring', () => {
    expect(checkTrackPath(ring()).error).toBeNull();
  });

  it('needs exactly one start/finish line', () => {
    const t = ring();
    placeAt(t, 3, 4, 0x04);
    expect(checkTrackPath(t).error).toBe('noStart');
    placeAt(t, 3, 4, 0x01);
    placeAt(t, 10, 10, 0x01);
    expect(checkTrackPath(t).error).toBe('manyStarts');
  });

  it("finds that the road doesn't come back to the start", () => {
    const t = ring();
    placeAt(t, 4, 3, 0); // a hole in the bottom straight
    expect(checkTrackPath(t).error).toBe('noPath');
    // Just a start line and a straight going nowhere.
    const u = createEmptyTrack();
    placeAt(u, 5, 5, 0x01);
    placeAt(u, 5, 6, 0x04);
    expect(checkTrackPath(u).error).toBe('noPath');
  });

  it('allows dead ends and forks as long as one way gets round', () => {
    const t = ring();
    placeAt(t, 4, 5, 0x4a); // crossroad on the top straight
    placeAt(t, 4, 6, 0x04); // a spur going north, ending nowhere
    expect(checkTrackPath(t).error).toBeNull();
  });

  it('refuses a track that can be driven both ways', () => {
    // The ring runs clockwise. A fork off the top straight turns south through the middle, then
    // east into the bottom-right corner, which the ring drives out of westwards: against it.
    const t = ring();
    placeAt(t, 4, 5, 0x52); // top straight + a corner from the west turning south
    placeAt(t, 4, 4, 0x04);
    placeAt(t, 4, 3, 0x50); // bottom straight + a corner from the north turning east
    expect(checkTrackPath(t).error).toBe('wrongWay');
  });

  it('refuses joining an elevated road straight onto a ground road', () => {
    const t = ring();
    placeAt(t, 4, 3, 0x23); // elevated road east-west in the bottom straight
    expect(checkTrackPath(t).error).toBe('joinMismatch');
  });

  it('refuses a pipe without its start and end pieces', () => {
    const t = ring();
    placeAt(t, 5, 4, 0x44); // pipe north-south in the east straight
    expect(checkTrackPath(t).error).toBe('joinMismatch');
  });

  it('jumps one empty tile between ramps, no more, and only after a run-up', () => {
    // North from the start line: road, road, ramp up, gap, ramp down, road.
    const jump = (gapTiles: number): Track => {
      const t = createEmptyTrack();
      placeAt(t, 5, 2, 0x01);
      placeAt(t, 5, 3, 0x04);
      placeAt(t, 5, 4, 0x04);
      placeAt(t, 5, 5, 0x26); // elevated ramp climbing north
      placeAt(t, 5, 6 + gapTiles, 0x27); // and one coming down (climbing south)
      placeAt(t, 5, 7 + gapTiles, 0x04);
      return t;
    };
    // The road then just ends: fine as far as the jump goes (the lap isn't closed).
    expect(checkTrackPath(jump(1)).error).toBe('noPath');
    expect(checkTrackPath(jump(2)).error).toBe('longJump');
    // A corner right before the ramp: no straight to take off from.
    const t = createEmptyTrack();
    placeAt(t, 5, 2, 0x01);
    placeAt(t, 5, 3, 0x06); // corner from the south turning east
    placeAt(t, 6, 3, 0x24); // elevated ramp climbing east
    placeAt(t, 8, 3, 0x25); // coming down
    expect(checkTrackPath(t).error).toBe('noRunway');
  });

  it('needs matching terrain edges', () => {
    const t = ring();
    t.terrain[10]![10] = 0x06; // a lone hill tile: its edges are at hill level, the ground's not
    expect(checkTrackPath(t).error).toBe('terrainEdge');
  });
});
