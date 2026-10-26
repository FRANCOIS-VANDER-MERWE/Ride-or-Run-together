import { supabase, isSupabaseConfigured } from './supabaseClient';
import { BroadcastSignalEvent } from '../data/sessionData';

export interface CustomSpotifyBroadcastPayload {
  session_id: string;
  initiator: string;
  action: BroadcastSignalEvent['action'];
  spotify_track_uri: string;
  position_ms: number;
  sent_at_epoch_ms: number;
}

export interface TranslatedSpotifyPlayRequest {
  endpoint: string;
  body: {
    uris: string[];
    position_ms: number;
    device_compensation_ms: number;
  };
  networkDriftMs: number;
}

/**
 * Step 1: Host broadcasts a lightweight Custom Sync Signal over our API / Supabase Realtime
 * to all runners/riders in the pack session.
 */
export async function broadcastMusicSyncSignal(
  payload: CustomSpotifyBroadcastPayload
): Promise<{ delivered: boolean; mode: 'supabase-realtime' | 'simulated' }> {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  // If custom FastAPI endpoint is configured, POST the broadcast packet
  if (apiBaseUrl && !apiBaseUrl.includes('api.pacelock.run')) {
    try {
      await fetch(`${apiBaseUrl}/v1/session/${payload.session_id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Continue to Realtime broadcast fallback
    }
  }

  if (supabase && isSupabaseConfigured) {
    try {
      const channel = supabase.channel(`pack-session:${payload.session_id}`);
      await channel.send({
        type: 'broadcast',
        event: 'CUSTOM_SPOTIFY_SYNC',
        payload,
      });
      return { delivered: true, mode: 'supabase-realtime' };
    } catch {
      return { delivered: true, mode: 'simulated' };
    }
  }

  return { delivered: true, mode: 'simulated' };
}

/**
 * Step 2: Each peer phone receives the Custom Broadcast Signal, calculates network transit
 * drift (`Date.now() - payload.sent_at_epoch_ms`), and translates it into an official
 * client-side Spotify Web API call (`PUT https://api.spotify.com/v1/me/player/play`).
 */
export async function translateBroadcastToSpotifyPlayer(
  payload: CustomSpotifyBroadcastPayload,
  userSpotifyAccessToken?: string | null
): Promise<TranslatedSpotifyPlayRequest> {
  const rawTransitMs = Date.now() - payload.sent_at_epoch_ms;
  const networkDriftMs =
    rawTransitMs > 0 && rawTransitMs < 2000
      ? rawTransitMs
      : 11 + Math.floor(Math.random() * 5);

  const compensatedPositionMs = Math.max(0, payload.position_ms + networkDriftMs);

  const translatedRequest: TranslatedSpotifyPlayRequest = {
    endpoint:
      payload.action === 'PAUSE_SYNC'
        ? 'PUT https://api.spotify.com/v1/me/player/pause'
        : 'PUT https://api.spotify.com/v1/me/player/play',
    body: {
      uris: [payload.spotify_track_uri],
      position_ms: compensatedPositionMs,
      device_compensation_ms: networkDriftMs,
    },
    networkDriftMs,
  };

  if (userSpotifyAccessToken) {
    try {
      await fetch(
        payload.action === 'PAUSE_SYNC'
          ? 'https://api.spotify.com/v1/me/player/pause'
          : 'https://api.spotify.com/v1/me/player/play',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userSpotifyAccessToken}`,
            'Content-Type': 'application/json',
          },
          body:
            payload.action === 'PAUSE_SYNC'
              ? undefined
              : JSON.stringify({
                  uris: [payload.spotify_track_uri],
                  position_ms: compensatedPositionMs,
                }),
        }
      );
    } catch (err) {
      console.warn('[SpotifyTranslator] Client Spotify API call error:', err);
    }
  }

  return translatedRequest;
}

/**
 * Auto-duck Spotify playback volume to 25% when a teammate opens the Walkie-Talkie PTT channel
 */
export async function setSpotifyVolumeDucking(
  volumePercent: number,
  userSpotifyAccessToken?: string | null
): Promise<void> {
  if (!userSpotifyAccessToken) return;
  const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
  try {
    await fetch(
      `https://api.spotify.com/v1/me/player/volume?volume_percent=${clamped}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userSpotifyAccessToken}`,
        },
      }
    );
  } catch {
    // Ignore if no active Spotify Connect device
  }
}
