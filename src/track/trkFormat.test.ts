import { describe, expect, it } from 'vitest';
import { createEmptyTrack, GRID, Horizon, parseTrk, serializeTrk, TRK_SIZE } from './trkFormat';
import { decodeTile, encodeTile, footprint } from './tiles';

describe('trkFormat', () => {
  it('serializes to exactly 1802 bytes and round-trips', () => {
    const t = createEmptyTrack(Horizon.Alpine);
    t.elements[3]![5] = 0x01;
    t.elements[29]![29] = 0x40;
    t.terrain[0]![0] = 0x06;
    t.terrain[12]![27] = 0x01;
    const bytes = serializeTrk(t);
    expect(bytes.length).toBe(TRK_SIZE);
    expect(parseTrk(bytes)).toEqual(t);
  });

  it('stores element rows south→north and terrain rows north→south', () => {
    const t = createEmptyTrack();
    t.elements[2]![0] = 0xaa; // south-west area
    t.terrain[2]![0] = 0x06;
    const bytes = serializeTrk(t);
    expect(bytes[2]).toBe(0xaa);
    expect(bytes[0x385 + (GRID - 1) * GRID + 2]).toBe(0x06);
    expect(bytes[0x384]).toBe(Horizon.Desert);
  });

  it('preserves overlay bytes and accepts short files', () => {
    const t = createEmptyTrack();
    t.overlay = new Uint8Array([0x73, 0x6d, 0x64, 0x66]);
    expect(parseTrk(serializeTrk(t)).overlay).toEqual(t.overlay);
    const short = parseTrk(new Uint8Array([0x04]));
    expect(short.elements[0]![0]).toBe(0x04);
    expect(short.horizon).toBe(Horizon.Desert);
  });
});

describe('tiles', () => {
  it('decodes MVP pieces', () => {
    expect(decodeTile(0x01)).toEqual({ kind: 'start', surface: 'paved', dir: 'N' });
    expect(decodeTile(0x05)).toEqual({ kind: 'road', surface: 'paved', axis: 'EW' });
    expect(decodeTile(0x0b)).toEqual({ kind: 'corner', surface: 'paved', size: 'large', edges: ['W', 'S'] });
    expect(decodeTile(0x5f)).toEqual({ kind: 'ramp', style: 'solid', dir: 'E' });
    expect(decodeTile(0xfe)).toEqual({ kind: 'filler' });
    expect(decodeTile(0x9b)).toEqual({ kind: 'building', type: 'gas', facing: 'S' });
    expect(decodeTile(0xc6)).toEqual({ kind: 'unknown', code: 0xc6 });
  });

  it('encodes back to the same code', () => {
    for (const code of [0x01, 0xb4, 0x04, 0x19, 0x09, 0x21, 0x40, 0x26, 0x62]) {
      expect(encodeTile(decodeTile(code))).toBe(code);
    }
  });

  it('knows multi-tile footprints', () => {
    expect(footprint(decodeTile(0x0a))).toEqual({ w: 2, h: 2 });
    expect(footprint(decodeTile(0x40))).toEqual({ w: 1, h: 2 });
    expect(footprint(decodeTile(0x41))).toEqual({ w: 2, h: 1 });
  });
});
