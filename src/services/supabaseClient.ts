import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';
import {
  createClient,
  SupabaseClient,
  RealtimeChannel,
} from '@supabase/supabase-js';
import type { Database } from './database.types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('your-project-id')
);

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * The single typed Supabase client for the whole app.
 *
 * Auth sessions persist through the expo-sqlite backed localStorage
 * polyfill (the pattern this project already uses), so a signed-in
 * user survives app restarts on native and web.
 *
 * The schema this client is typed against lives in schema.sql at the
 * repo root. IMPORTANT: schema.sql enables Row Level Security on every
 * table but ships zero policies, which means the API denies everything
 * until supabase/rls_policies.sql has also been run. See the README's
 * Supabase setup section.
 */
export const supabase: TypedSupabaseClient | null = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: globalThis.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Returns the client or throws a clear setup error. */
export function requireSupabase(): TypedSupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY in .env (see .env.example).'
    );
  }
  return supabase;
}

/**
 * Create or join a Supabase Realtime Broadcast channel for pack
 * telemetry and music sync signals inside one ride session.
 */
export function joinPackRealtimeSession(sessionId: string): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase.channel(`pack-session:${sessionId}`, {
    config: {
      broadcast: { self: false, ack: true },
    },
  });
}

export type TableChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

/**
 * Subscribe to Postgres changes (inserts, updates, deletes) on one
 * table, optionally narrowed to a single session. Requires the table
 * to be in the supabase_realtime publication, which
 * supabase/rls_policies.sql sets up for the session tables.
 */
export function subscribeToTableChanges(
  table: keyof Database['public']['Tables'],
  options: {
    sessionId?: string;
    event?: TableChangeEvent;
    onChange: (payload: {
      eventType: string;
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => void;
  }
): RealtimeChannel | null {
  if (!supabase) return null;
  const filter = options.sessionId
    ? `session_id=eq.${options.sessionId}`
    : undefined;
  const channel = supabase
    .channel(
      `db-${String(table)}${options.sessionId ? `-${options.sessionId}` : ''}`
    )
    .on(
      'postgres_changes' as never,
      {
        event: options.event ?? '*',
        schema: 'public',
        table: String(table),
        ...(filter ? { filter } : {}),
      } as never,
      (payload: unknown) => {
        const p = payload as {
          eventType: string;
          new: Record<string, unknown>;
          old: Record<string, unknown>;
        };
        options.onChange(p);
      }
    )
    .subscribe();
  return channel;
}

export async function unsubscribeChannel(
  channel: RealtimeChannel | null
): Promise<void> {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
