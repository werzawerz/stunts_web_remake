import { beforeEach, describe, expect, it } from 'vitest';
import { decodeInputs, encodeInputs, listReplays, saveReplay } from './replayStore';

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

describe('saved replays', () => {
  beforeEach(() => mem.clear());

  it('encodes inputs losslessly, one byte per tick', () => {
    const inputs = [0, 1, 5, 9, 17, 33, 1, 0, 127];
    expect(decodeInputs(encodeInputs(inputs))).toEqual(inputs);
  });

  it('saves and lists replays, newest first, replacing same names', () => {
    const base = { trackId: 'orig-default', carId: 'indy', paint: 0, manual: false };
    expect(saveReplay({ ...base, name: 'first', inputs: [1, 1, 0] })).toBe(true);
    saveReplay({ ...base, name: 'second', inputs: [5, 9] });
    saveReplay({ ...base, name: 'first', inputs: [2] });
    const list = listReplays();
    expect(list.map((r) => r.name)).toEqual(['first', 'second']);
    expect(list[0]!.inputs).toEqual([2]);
    expect(list[1]).toMatchObject({ trackId: 'orig-default', carId: 'indy', inputs: [5, 9] });
  });
});
