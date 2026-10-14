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

export async function getLeaderboard(trackId: string, limit = 10): Promise<LapTime[]> {
  const db = getClient();
  if (!db) return [];
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
  if (!db) return;
  const { error } = await db.from('lap_times').insert({
    track_id: lap.trackId,
    player_name: lap.playerName,
    car: lap.car,
    time_ms: Math.round(lap.timeMs),
    input_log_base64: lap.inputLogBase64 ?? null,
  });
  if (error) throw error;
}
