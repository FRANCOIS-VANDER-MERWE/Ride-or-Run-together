/**
 * Shared music data on the backend: the track catalog, user playlists,
 * and the per-session queue plus playback state that keep every
 * rider's player in step. Tables: tracks, playlists, playlist_tracks,
 * session_queue, session_playback_state.
 *
 * Playback itself still happens on each device through the provider
 * integrations; these rows are the shared source of truth for WHAT is
 * playing. Pair reads with subscribeToTableChanges on session_queue
 * and session_playback_state for live updates.
 */
import { requireSupabase } from './supabaseClient';
import type {
  MusicProviderId,
  PlaylistRow,
  SessionPlaybackStateRow,
  SessionQueueRow,
  TrackRow,
} from './database.types';

export interface ProviderTrackInput {
  provider: MusicProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  artworkUrl?: string;
}

/** Finds or creates the catalog row for a provider track. */
export async function upsertTrack(
  input: ProviderTrackInput
): Promise<TrackRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('tracks')
    .upsert(
      {
        provider: input.provider,
        provider_track_id: input.providerTrackId,
        title: input.title,
        artist: input.artist,
        album: input.album ?? null,
        duration_ms: input.durationMs ?? null,
        artwork_url: input.artworkUrl ?? null,
      },
      { onConflict: 'provider,provider_track_id' }
    )
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] upsertTrack: ${error.message}`);
  return data;
}

export async function createPlaylist(
  ownerId: string,
  input: {
    name: string;
    provider?: MusicProviderId;
    providerPlaylistId?: string;
  }
): Promise<PlaylistRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('playlists')
    .insert({
      owner_id: ownerId,
      name: input.name,
      provider: input.provider ?? null,
      provider_playlist_id: input.providerPlaylistId ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] createPlaylist: ${error.message}`);
  return data;
}

export async function fetchMyPlaylists(
  ownerId: string
): Promise<PlaylistRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('playlists')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`[Supabase] fetchMyPlaylists: ${error.message}`);
  return data ?? [];
}

export async function fetchPlaylistTracks(
  playlistId: string
): Promise<TrackRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('playlist_tracks')
    .select('position, track:tracks(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });
  if (error) {
    throw new Error(`[Supabase] fetchPlaylistTracks: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => (r as { track: TrackRow | null }).track)
    .filter((t): t is TrackRow => Boolean(t));
}

export async function addTrackToPlaylist(
  playlistId: string,
  track: ProviderTrackInput
): Promise<void> {
  const db = requireSupabase();
  const trackRow = await upsertTrack(track);
  const { data: existing } = await db
    .from('playlist_tracks')
    .select('position')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1;
  const { error } = await db.from('playlist_tracks').insert({
    playlist_id: playlistId,
    track_id: trackRow.track_id,
    position: nextPosition,
  });
  if (error) {
    throw new Error(`[Supabase] addTrackToPlaylist: ${error.message}`);
  }
}

export async function fetchSessionQueue(
  sessionId: string
): Promise<SessionQueueRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_queue')
    .select('*')
    .eq('session_id', sessionId)
    .neq('status', 'removed')
    .order('position', { ascending: true });
  if (error) throw new Error(`[Supabase] fetchSessionQueue: ${error.message}`);
  return data ?? [];
}

export async function enqueueTrack(
  sessionId: string,
  userId: string,
  track: ProviderTrackInput,
  sourcePlaylistId?: string
): Promise<SessionQueueRow> {
  const db = requireSupabase();
  const trackRow = await upsertTrack(track);
  const queue = await fetchSessionQueue(sessionId);
  const nextPosition =
    queue.reduce((max, item) => Math.max(max, item.position), 0) + 1;
  const { data, error } = await db
    .from('session_queue')
    .insert({
      session_id: sessionId,
      track_id: trackRow.track_id,
      added_by: userId,
      source_playlist_id: sourcePlaylistId ?? null,
      position: nextPosition,
      status: 'queued',
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] enqueueTrack: ${error.message}`);
  return data;
}

export async function setQueueItemStatus(
  queueItemId: string,
  status: SessionQueueRow['status']
): Promise<void> {
  const db = requireSupabase();
  const patch: Partial<SessionQueueRow> = { status };
  if (status === 'playing' || status === 'played') {
    patch.played_at = new Date().toISOString();
  }
  const { error } = await db
    .from('session_queue')
    .update(patch)
    .eq('queue_item_id', queueItemId);
  if (error) {
    throw new Error(`[Supabase] setQueueItemStatus: ${error.message}`);
  }
}

export async function fetchPlaybackState(
  sessionId: string
): Promise<SessionPlaybackStateRow | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_playback_state')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(`[Supabase] fetchPlaybackState: ${error.message}`);
  }
  return data;
}

export async function updatePlaybackState(
  sessionId: string,
  patch: Partial<
    Pick<
      SessionPlaybackStateRow,
      'current_item_id' | 'is_playing' | 'position_ms' | 'dj_user_id' | 'duck_for_voice'
    >
  >
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('session_playback_state')
    .update({ ...patch, position_updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);
  if (error) {
    throw new Error(`[Supabase] updatePlaybackState: ${error.message}`);
  }
}

export interface QueueEntry {
  item: SessionQueueRow;
  track: TrackRow | null;
}

/** Queue rows for a session with their catalog tracks joined in. */
export async function fetchSessionQueueWithTracks(
  sessionId: string
): Promise<QueueEntry[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_queue')
    .select('*, track:tracks(*)')
    .eq('session_id', sessionId)
    .neq('status', 'removed')
    .order('position', { ascending: true });
  if (error) {
    throw new Error(`[Supabase] fetchSessionQueueWithTracks: ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const { track, ...item } = row as SessionQueueRow & {
      track: TrackRow | null;
    };
    return { item: item as SessionQueueRow, track: track ?? null };
  });
}

/**
 * Publishes a now-playing track from a device player (the Music Sync
 * tab) into a session's shared queue: finds or creates the queue item
 * for the track, marks the previously playing item played, marks this
 * one playing, and points the shared playback state at it. This is
 * how a song queued on one rider's phone becomes the pack's song.
 */
export async function publishNowPlaying(
  sessionId: string,
  userId: string,
  input: ProviderTrackInput
): Promise<void> {
  const trackRow = await upsertTrack(input);
  const queue = await fetchSessionQueue(sessionId);
  let item = queue.find(
    (q) =>
      q.track_id === trackRow.track_id &&
      (q.status === 'queued' || q.status === 'playing')
  );
  if (!item) {
    item = await enqueueTrack(sessionId, userId, input);
  }
  const previous = queue.find(
    (q) => q.status === 'playing' && q.queue_item_id !== item.queue_item_id
  );
  if (previous) {
    await setQueueItemStatus(previous.queue_item_id, 'played');
  }
  if (item.status !== 'playing') {
    await setQueueItemStatus(item.queue_item_id, 'playing');
  }
  await updatePlaybackState(sessionId, {
    current_item_id: item.queue_item_id,
    is_playing: true,
    position_ms: 0,
    dj_user_id: userId,
  });
}
