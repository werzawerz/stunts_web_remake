/*
 * Tracks made in the track editor, kept in this browser (the original saved .TRK files next to the
 * game). Each is stored as its TRK bytes, so it round-trips exactly like an original track. Tracks
 * that pass the track check are also shared online (net/supabase.ts shareTrack); the local copy
 * then remembers its online id, and the online one is what the track lists show.
 */

import { parseTrk, serializeTrk, type Track } from './trkFormat';

export interface SavedTrack {
  name: string;
  track: Track;
  savedAt: string;
  /** The id it was shared under, once it was. */
  onlineId?: string;
}

interface Stored {
  v: 1;
  name: string;
  /** The 1802 TRK bytes as base64. */
  trk: string;
  savedAt: string;
  onlineId?: string;
}

const KEY = 'stunts.tracks';

/** A track as base64 TRK bytes (how it's stored, here and online). */
export function trackToBase64(track: Track): string {
  let s = '';
  for (const b of serializeTrk(track)) s += String.fromCharCode(b);
  return btoa(s);
}

export function trackFromBase64(data: string): Track {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return parseTrk(out);
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

function writeAll(list: Stored[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Saved tracks, oldest first (new ones go to the end of the track list). */
export function listTracks(): SavedTrack[] {
  return readAll().map((r) => ({ name: r.name, track: trackFromBase64(r.trk), savedAt: r.savedAt, onlineId: r.onlineId }));
}

/** Save (replacing one with the same name, which then isn't the shared one any more). Returns false when the browser won't store it. */
export function saveTrack(name: string, track: Track): boolean {
  const entry: Stored = { v: 1, name, trk: trackToBase64(track), savedAt: new Date().toISOString() };
  const list = readAll();
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  return writeAll(list);
}

/** Remember that the saved track `name` was shared under `id`. */
export function setOnlineId(name: string, id: string): void {
  const list = readAll();
  const r = list.find((x) => x.name === name);
  if (!r) return;
  r.onlineId = id;
  writeAll(list);
}
