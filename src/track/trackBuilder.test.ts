import { describe, expect, it } from 'vitest';
import { buildSampleTrack } from './sampleTrack';
import { buildTrack, loopSamples } from './trackBuilder';
import { TILE } from './constants';
import { decodeTile } from './tiles';
import { GRID, Horizon, parseTrk, serializeTrk } from './trkFormat';

describe('sample track', () => {
  it('has exactly one start line and only known tiles', () => {
    const t = buildSampleTrack();
    let starts = 0;
    for (let x = 0; x < GRID; x++) {
      for (let z = 0; z < GRID; z++) {
        const info = decodeTile(t.elements[x]![z]!);
        expect(info.kind).not.toBe('unknown');
        if (info.kind === 'start') starts++;
      }
    }
    expect(starts).toBe(1);
  });

  it('survives a TRK round-trip', () => {
    const t = buildSampleTrack(Horizon.Alpine);
    expect(parseTrk(serializeTrk(t))).toEqual(t);
  });
});

describe('buildTrack', () => {
  it('produces finite geometry for every horizon', () => {
    for (const h of [Horizon.Desert, Horizon.Tropical, Horizon.Alpine, Horizon.City, Horizon.Country]) {
      const { group } = buildTrack(buildSampleTrack(h));
      for (const child of group.children) {
        const pos = (child as import('three').Mesh).geometry.getAttribute('position');
        expect(pos.count).toBeGreaterThanOrEqual(6);
        for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      }
    }
  });
});

describe('loopSamples', () => {
  it('matches the original loop: ~59 m tall ring, centred, entry/exit on the centre line', () => {
    const p = loopSamples();
    const first = p[0]!;
    const last = p[p.length - 1]!;
    expect(first[0]).toBeCloseTo(0, 6);
    expect(first[1]).toBeCloseTo(-TILE, 6);
    expect(first[2]).toBe(0);
    expect(last[0]).toBeCloseTo(0, 6);
    expect(last[1]).toBeCloseTo(TILE, 6);
    const top = Math.max(...p.map((q) => q[2]));
    expect(top).toBeGreaterThan(58);
    expect(top).toBeLessThan(61);
    // The passes are a road width apart sideways where they meet at the bottom of the ring.
    const bottoms = p.filter((q) => q[2] === 0 && Math.abs(q[1]) < 1);
    const spread = Math.max(...bottoms.map((q) => q[0])) - Math.min(...bottoms.map((q) => q[0]));
    expect(spread).toBeGreaterThan(20);
  });
});
