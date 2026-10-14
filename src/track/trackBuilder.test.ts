import { describe, expect, it } from 'vitest';
import { loopProfile } from './trackBuilder';
import { buildSampleTrack } from './sampleTrack';
import { buildTrack } from './trackBuilder';
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
        expect(pos.count).toBeGreaterThan(100);
        for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      }
    }
  });
});

describe('loopProfile', () => {
  it('fits two tiles, closes at ground level, and tops out around 20 m', () => {
    const p = loopProfile();
    const last = p[p.length - 1]!;
    expect(last.f).toBeGreaterThan(20);
    expect(last.f).toBeLessThan(40);
    expect(Math.abs(last.h)).toBeLessThan(0.01);
    const top = Math.max(...p.map((q) => q.h));
    expect(top).toBeGreaterThan(18);
    expect(top).toBeLessThan(26);
  });
});
