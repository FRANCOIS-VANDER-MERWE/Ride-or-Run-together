import 'expo-sqlite/localStorage/install';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { ActivityMode } from '../data/sessionData';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('your-project-id')
);

/**
 * Database row types matching our Supabase PostgreSQL schema:
 * - public.users
 * - public.playlists
 * - public.friends
 */
export interface DbUserRow {
  id: string;
  username: string;
  password_hash?: string;
  avatar_url: string | null;
  spotify_credentials: {
    access_token: string | null;
    refresh_token: string | null;
    expires_at: number | null;
  };
  friend_list: string[];
  preferred_mode: ActivityMode;
  created_at: string;
}

export interface DbPlaylistRow {
  id: string;
  owner_id: string;
  title: string;
  spotify_playlist_uri: string;
  target_bpm: number;
  activity_mode: ActivityMode | 'both';
  tracks: {
    uri: string;
    title: string;
    artist: string;
    bpm: number;
    duration_sec: number;
  }[];
  created_at: string;
}

export interface DbFriendRow {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  active_session_id?: string | null;
  created_at: string;
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: globalThis.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Fetch user's profile and stored Spotify OAuth credentials from `public.users`
 */
export async function fetchUserProfile(userId: string): Promise<DbUserRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.warn('[Supabase] fetchUserProfile error:', error.message);
    return null;
  }
  return data as DbUserRow;
}

/**
 * Fetch BPM-locked playlists from `public.playlists`
 */
export async function fetchPackPlaylists(mode: ActivityMode): Promise<DbPlaylistRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .in('activity_mode', [mode, 'both'])
    .order('target_bpm', { ascending: false });
  if (error || !data) return [];
  return data as DbPlaylistRow[];
}

/**
 * Fetch accepted friends from `public.friends`
 */
export async function fetchAcceptedFriends(userId: string): Promise<DbFriendRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('friends')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  if (error || !data) return [];
  return data as DbFriendRow[];
}

/**
 * Create or join a Supabase Realtime Channel for 5Hz pack telemetry & music sync
 */
export function joinPackRealtimeSession(sessionId: string): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase.channel(`pack-session:${sessionId}`, {
    config: {
      broadcast: { self: false, ack: true },
    },
  });
}
