import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LapTime {
  player_name: string;
  car: string;
  time_ms: number;
  created_at: string;
}

let client: SupabaseClient | null = null;

// Returns null when env vars are missing so the game stays playable offline.
function getClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Tracks made in the track editor live only in this browser: they have no online times. */
export const isOnlineTrack = (trackId: string): boolean => !trackId.startsWith('custom-');

export async function getLeaderboard(trackId: string, limit = 10): Promise<LapTime[]> {
  const db = getClient();
  if (!db || !isOnlineTrack(trackId)) return [];
  const { data, error } = await db
    .from('lap_times')
    .select('player_name, car, time_ms, created_at')
    .eq('track_id', trackId)
    .order('time_ms', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function submitLapTime(lap: {
  trackId: string;
  playerName: string;
  car: string;
  timeMs: number;
  inputLogBase64?: string;
}): Promise<void> {
  const db = getClient();
  if (!db || !isOnlineTrack(lap.trackId)) return;
  const { error } = await db.from('lap_times').insert({
    track_id: lap.trackId,
    player_name: lap.playerName,
    car: lap.car,
    time_ms: Math.round(lap.timeMs),
    input_log_base64: lap.inputLogBase64 ?? null,
  });
  if (error) throw error;
}

/** The fastest lap on a track that has its inputs stored (for the ghost car), or null. */
export async function getGhost(trackId: string): Promise<(LapTime & { inputs: number[] }) | null> {
  const db = getClient();
  if (!db || !isOnlineTrack(trackId)) return null;
  const { data, error } = await db
    .from('lap_times')
    .select('player_name, car, time_ms, created_at, input_log_base64')
    .eq('track_id', trackId)
    .not('input_log_base64', 'is', null)
    .order('time_ms', { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as (LapTime & { input_log_base64: string }) | undefined;
  if (!row) return null;
  const s = atob(row.input_log_base64);
  const inputs: number[] = [];
  for (let i = 0; i < s.length; i++) inputs.push(s.charCodeAt(i));
  return { player_name: row.player_name, car: row.car, time_ms: row.time_ms, created_at: row.created_at, inputs };
}
