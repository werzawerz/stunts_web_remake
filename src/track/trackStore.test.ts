import { beforeEach, describe, expect, it } from 'vitest';
import { listTracks, saveTrack } from './trackStore';
import { createEmptyTrack, Horizon } from './trkFormat';

// Minimal localStorage for the node test environment.
const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe('saved tracks', () => {
  beforeEach(() => mem.clear());

  it('saves tracks as TRK bytes and lists them in order, replacing same names', () => {
    const a = createEmptyTrack(Horizon.Alpine);
    a.elements[3]![4] = 0x01;
    a.terrain[7]![8] = 0x06;
    expect(saveTrack('mine', a)).toBe(true);
    saveTrack('other', createEmptyTrack());
    a.elements[3]![5] = 0x04;
    saveTrack('mine', a);
    const list = listTracks();
    expect(list.map((t) => t.name)).toEqual(['mine', 'other']);
    expect(list[0]!.track.elements).toEqual(a.elements);
    expect(list[0]!.track.terrain).toEqual(a.terrain);
    expect(list[0]!.track.horizon).toBe(Horizon.Alpine);
  });
});
