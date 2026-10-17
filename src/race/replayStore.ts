/*
 * Saved replays, kept in this browser (the original saved .RPL files next to the game). A replay is
 * the track, the car and its setup, and the input bitmask of every tick: the simulation is
 * deterministic, so that is all it takes to play it back.
 */

export interface SavedReplay {
  name: string;
  trackId: string;
  carId: string;
  paint: number;
  manual: boolean;
  /** One input bitmask per tick. */
  inputs: number[];
  savedAt: string;
}

interface Stored extends Omit<SavedReplay, 'inputs'> {
  v: 1;
  /** Inputs as base64, one byte per tick. */
  data: string;
}

const KEY = 'stunts.replays';

/** Inputs (each below 256) → base64. */
export function encodeInputs(inputs: readonly number[]): string {
  let s = '';
  for (const b of inputs) s += String.fromCharCode(b & 255);
  return btoa(s);
}

export function decodeInputs(data: string): number[] {
  const s = atob(data);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

function readAll(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Stored[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.v === 1) : [];
  } catch {
    return [];
  }
}

/** Saved replays, newest first. */
export function listReplays(): SavedReplay[] {
  return readAll().map(({ v: _v, data, ...rest }) => ({ ...rest, inputs: decodeInputs(data) }));
}

/** Save (replacing one with the same name). Returns false when the browser won't store it. */
export function saveReplay(r: Omit<SavedReplay, 'savedAt'>): boolean {
  const { inputs, ...rest } = r;
  const entry: Stored = { v: 1, ...rest, data: encodeInputs(inputs), savedAt: new Date().toISOString() };
  const list = [entry, ...readAll().filter((x) => x.name !== r.name)];
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
