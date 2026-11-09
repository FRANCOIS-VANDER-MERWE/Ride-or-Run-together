/**
 * Profiles, lifetime stats, bikes, and linked music accounts.
 *
 * Identity model: Supabase Auth owns the account (auth.users). The
 * public.profiles row is keyed by the same uuid (profiles.user_id has
 * a foreign key to auth.users) and holds the app-facing identity:
 * username and the live-location sharing toggle. The schema has no
 * trigger that creates the profile row on sign-up, so the client
 * creates it: see ensureProfile, called by the auth flow right after
 * sign-up and on every sign-in.
 */
import { requireSupabase } from './supabaseClient';
import type {
  ProfileRow,
  UserBikeRow,
  UserMusicAccountRow,
  UserStatsRow,
} from './database.types';

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`[Supabase] fetchProfile: ${error.message}`);
  return data;
}

export async function searchProfilesByUsername(
  query: string,
  limit = 20
): Promise<ProfileRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .ilike('username', `%${query}%`)
    .is('deleted_at', null)
    .order('username', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`[Supabase] searchProfiles: ${error.message}`);
  return data ?? [];
}

/**
 * Creates the profiles row (and the zeroed user_stats row) for a newly
 * authenticated user if they do not exist yet. Idempotent, so calling
 * it on every sign-in is safe. Username comes from the sign-up metadata
 * when available; a taken username falls back to a suffixed variant
 * because profiles.username is citext (case-insensitive unique).
 */
export async function ensureProfile(
  userId: string,
  preferredUsername: string
): Promise<ProfileRow> {
  const existing = await fetchProfile(userId);
  if (existing) {
    void touchLastActive(userId);
    return existing;
  }
  const db = requireSupabase();
  const base = preferredUsername.trim() || 'rider';
  const candidates = [
    base,
    `${base}-${userId.slice(0, 4)}`,
    `${base}-${userId.slice(0, 8)}`,
  ];
  let lastError: Error | null = null;
  for (const username of candidates) {
    const { data, error } = await db
      .from('profiles')
      .insert({ user_id: userId, username })
      .select('*')
      .single();
    if (!error && data) {
      await db
        .from('user_stats')
        .upsert({ user_id: userId }, { onConflict: 'user_id' });
      return data;
    }
    lastError = new Error(`[Supabase] ensureProfile: ${error?.message}`);
    // 23505 is a unique violation: try the next candidate username.
    if (error && error.code !== '23505') break;
  }
  throw lastError ?? new Error('[Supabase] ensureProfile failed');
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<ProfileRow, 'username' | 'share_live_location'>>
): Promise<ProfileRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] updateProfile: ${error.message}`);
  return data;
}

async function touchLastActive(userId: string): Promise<void> {
  try {
    const db = requireSupabase();
    await db
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {
    // Best effort only.
  }
}

export async function fetchMyStats(userId: string): Promise<UserStatsRow | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`[Supabase] fetchMyStats: ${error.message}`);
  return data;
}

export async function fetchMyBikes(userId: string): Promise<UserBikeRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('user_bikes')
    .select('*')
    .eq('user_id', userId)
    .is('retired_at', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[Supabase] fetchMyBikes: ${error.message}`);
  return data ?? [];
}

export async function addBike(
  userId: string,
  input: { name: string; bikeType?: string; isDefault?: boolean }
): Promise<UserBikeRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('user_bikes')
    .insert({
      user_id: userId,
      name: input.name,
      bike_type: input.bikeType ?? null,
      is_default: input.isDefault ?? false,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] addBike: ${error.message}`);
  return data;
}

export async function retireBike(bikeId: string): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('user_bikes')
    .update({ retired_at: new Date().toISOString() })
    .eq('bike_id', bikeId);
  if (error) throw new Error(`[Supabase] retireBike: ${error.message}`);
}

/**
 * Linked music accounts. Token columns are bytea and hold encrypted
 * blobs written by a trusted backend, never raw tokens from the
 * client. This helper only reads the link metadata (which provider is
 * linked, and whether the link is expired).
 */
export async function fetchMusicAccountLinks(
  userId: string
): Promise<
  Pick<UserMusicAccountRow, 'provider' | 'provider_user_id' | 'expires_at'>[]
> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('user_music_accounts')
    .select('provider, provider_user_id, expires_at')
    .eq('user_id', userId);
  if (error) {
    throw new Error(`[Supabase] fetchMusicAccountLinks: ${error.message}`);
  }
  return data ?? [];
}
