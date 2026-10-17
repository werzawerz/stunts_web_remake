import { describe, expect, it } from 'vitest';
import { anchorOf, CATALOG, FILLER_NE, FILLER_SE, FILLER_SW, footprintOf, placeAt, removeAt, startCount, tileName } from './editor';
import { createEmptyTrack, parseTrk, serializeTrk } from './trkFormat';
import { decodeTile } from './tiles';

describe('track editor', () => {
  it('knows every catalogue code', () => {
    for (const c of CATALOG) for (const p of c.pieces) if (!p.terrain) for (const code of p.codes) expect(decodeTile(code).kind, p.name).not.toBe('unknown');
  });

  it('places a large corner with its three fillers, and removes it from any of its tiles', () => {
    const t = createEmptyTrack();
    expect(footprintOf(0x0a)).toEqual({ w: 2, h: 2 });
    expect(placeAt(t, 5, 10, 0x0a)).toBe(true);
    expect(t.elements[5]![10]).toBe(0x0a);
    expect(t.elements[5]![9]).toBe(FILLER_SW);
    expect(t.elements[6]![9]).toBe(FILLER_SE);
    expect(t.elements[6]![10]).toBe(FILLER_NE);
    expect(anchorOf(t, 6, 9)).toEqual([5, 10]);
    expect(tileName(t, 6, 9)).toBe('large corner');
    removeAt(t, 6, 9);
    for (const [x, z] of [[5, 10], [5, 9], [6, 9], [6, 10]]) expect(t.elements[x!]![z!]).toBe(0);
  });

  it('overwrites the pieces a new piece overlaps, whole', () => {
    const t = createEmptyTrack();
    placeAt(t, 5, 10, 0x0a); // 2x2 at 5..6 x 9..10
    placeAt(t, 6, 9, 0x04); // a road on its SE filler
    expect(t.elements[5]![10]).toBe(0);
    expect(t.elements[6]![9]).toBe(0x04);
  });

  it("refuses pieces that don't fit on the grid", () => {
    const t = createEmptyTrack();
    expect(placeAt(t, 29, 5, 0x0a)).toBe(false);
    expect(placeAt(t, 3, 0, 0x40)).toBe(false); // a N-S loop needs the tile south of its anchor
  });

  it('round-trips an edited track through the TRK format', () => {
    const t = createEmptyTrack();
    placeAt(t, 3, 3, 0x01);
    placeAt(t, 3, 5, 0x40);
    t.terrain[10]![10] = 0x06;
    const back = parseTrk(serializeTrk(t));
    expect(back.elements).toEqual(t.elements);
    expect(back.terrain).toEqual(t.terrain);
    expect(startCount(back)).toBe(1);
  });
});
