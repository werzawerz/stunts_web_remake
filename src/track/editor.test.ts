import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  elementName,
  FILLER_NE,
  FILLER_SE,
  FILLER_SW,
  footprintOf,
  MESSAGES,
  PALETTE_EAST,
  PALETTE_PAGES,
  PALETTE_SOUTH,
  placeAt,
  placementError,
  removeAt,
  startCount,
  terrainFromPreset,
  tileName,
} from './editor';
import { createEmptyTrack, parseTrk, serializeTrk } from './trkFormat';
import { decodeTile } from './tiles';

describe('track editor', () => {
  it("lays bigger pieces out on the original's palette pages the way the map would", () => {
    expect(PALETTE_PAGES).toHaveLength(10);
    for (const page of PALETTE_PAGES) {
      expect(page).toHaveLength(36);
      page.forEach((code, i) => {
        if (code === 0 || code === PALETTE_EAST || code === PALETTE_SOUTH) return;
        expect(decodeTile(code).kind, `code ${code.toString(16)}`).not.toBe('unknown');
        const { w, h } = footprintOf(code);
        const [r, c] = [Math.floor(i / 6), i % 6];
        if (w > 1) expect(page[i + 1]).toBe(PALETTE_EAST);
        if (h > 1) expect(page[(r + 1) * 6 + c]).toBe(PALETTE_SOUTH);
      });
    }
  });

  it('names pieces like the original', () => {
    expect(elementName(0x04)).toBe('paved road');
    expect(elementName(0x65)).toBe('elevated span over road');
    expect(elementName(0x00)).toBe('');
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
    expect(tileName(t, 6, 9)).toBe('paved corner');
    removeAt(t, 6, 9);
    for (const [x, z] of [[5, 10], [5, 9], [6, 9], [6, 10]]) expect(t.elements[x!]![z!]).toBe(0);
  });

  it('overwrites the pieces a new piece overlaps, whole; the blank square erases', () => {
    const t = createEmptyTrack();
    placeAt(t, 5, 10, 0x0a); // 2x2 at 5..6 x 9..10
    placeAt(t, 6, 9, 0x04); // a road on its SE filler
    expect(t.elements[5]![10]).toBe(0);
    expect(t.elements[6]![9]).toBe(0x04);
    placeAt(t, 6, 9, 0);
    expect(t.elements[6]![9]).toBe(0);
  });

  it("refuses pieces that don't fit on the grid", () => {
    const t = createEmptyTrack();
    expect(placeAt(t, 29, 5, 0x0a)).toBe(false);
    expect(placeAt(t, 3, 0, 0x40)).toBe(false); // a N-S loop needs the tile south of its anchor
  });

  it("follows the original's rules for water, hill corners and slopes", () => {
    const t = createEmptyTrack();
    t.terrain[3]![3] = 0x01; // water
    t.terrain[4]![4] = 0x0b; // angled hill corner
    t.terrain[5]![5] = 0x07; // slope rising to the north
    expect(placementError(t, 3, 3, 0x04)).toBe(MESSAGES.water);
    expect(placementError(t, 3, 3, 0x22)).toBeNull(); // elevated road on stilts
    expect(placementError(t, 4, 4, 0x99)).toBe(MESSAGES.angled);
    expect(placementError(t, 5, 5, 0x04)).toBeNull(); // straight up the slope
    expect(placementError(t, 5, 5, 0x05)).toBe(MESSAGES.slope); // across it
    expect(placementError(t, 5, 5, 0x27)).toBeNull(); // elevated ramp
    expect(placementError(t, 4, 5, 0x0a)).toBe(MESSAGES.angled); // a 2x2 reaching onto the corner
    expect(placementError(t, 5, 5, 0)).toBeNull(); // erasing is always fine
  });

  it('reads terrain backgrounds north row first', () => {
    const bytes = new Uint8Array(900);
    bytes[0] = 0x01; // north-west corner
    bytes[899] = 0x06; // south-east corner
    const grid = terrainFromPreset(bytes);
    expect(grid[0]![29]).toBe(0x01);
    expect(grid[29]![0]).toBe(0x06);
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
