/*
 * Tracks made in the track editor, kept in this browser (the original saved .TRK files next to the
 * game). Each is stored as its TRK bytes, so it round-trips exactly like an original track.
 */

import { parseTrk, serializeTrk, type Track } from './trkFormat';

export interface SavedTrack {
  name: string;
  track: Track;
  savedAt: string;
}

interface Stored {
  v: 1;
  name: string;
  /** The 1802 TRK bytes as base64. */
  trk: string;
  savedAt: string;
}

const KEY = 'stunts.tracks';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function readAll(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Stored[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.v === 1 && typeof r.name === 'string') : [];
  } catch {
    return [];
  }
}

/** Saved tracks, oldest first (new ones go to the end of the track list). */
export function listTracks(): SavedTrack[] {
  return readAll().map((r) => ({ name: r.name, track: parseTrk(fromBase64(r.trk)), savedAt: r.savedAt }));
}

/** Save (replacing one with the same name). Returns false when the browser won't store it. */
export function saveTrack(name: string, track: Track): boolean {
  const entry: Stored = { v: 1, name, trk: toBase64(serializeTrk(track)), savedAt: new Date().toISOString() };
  const list = readAll();
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
