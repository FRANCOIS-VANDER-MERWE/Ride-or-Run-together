// src/music/types.ts
// Shared types for the music feature.
//
// Scope (decided Nov 2, 2026): solo playback only. Users link a streaming
// account, search that service's catalog, and play music. Group sync is a
// future feature and is NOT part of this layer; there is deliberately no
// session, queue-sync, or wire-protocol type here anymore.

export type ProviderId = 'spotify' | 'apple';

/**
 * How a track is actually being heard:
 * - 'remote':   full track, played by the user's own Spotify app/device
 *               through the Spotify Web API (Spotify provider only).
 * - 'preview':  official 30 second preview stream, played in-app through
 *               expo-audio. This is the fallback that always produces sound.
 * - 'musickit': full track through MusicKit JS (Apple provider, web only).
 */
export type PlaybackKind = 'remote' | 'preview' | 'musickit';

/** A recording, independent of any one service. */
export interface CanonicalTrack {
  /** ISRC of the recording, or '' when the source did not provide one. */
  isrc: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationMs: number;
  /** Always null for now: no live BPM source is wired up. Never guess. */
  bpm: number | null;
  explicit?: boolean;
  /** Direct preview stream URL (Apple Music catalog), when known. */
  previewUrl?: string | null;
  /** Canonical Apple Music web URL for the track, when known. */
  appleMusicUrl?: string;
  /** False when the source says the track cannot be streamed (purchase only). */
  streamable?: boolean;
  /** Per-service IDs: spotify = track URI, apple = catalog song ID. */
  providerIds: Partial<Record<ProviderId, string>>;
}

export interface AuthState {
  isConnected: boolean;
  /** null = this provider cannot tell (e.g. Apple catalog mode). */
  isPremiumOrSubscribed: boolean | null;
  userDisplayName: string | null;
  expiresAtMs: number | null;
}

export interface PlaybackSnapshot {
  /** providerIds value of the current track, or null when idle. */
  trackKey: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  positionMs: number;
  durationMs: number | null;
  kind: PlaybackKind | null;
}

export interface ProviderCapabilities {
  canPlay: boolean;
  canSeek: boolean;
  requiresPremium: boolean;
  requiresExternalApp: boolean;
  /** One plain sentence, shown in the UI, about how playback works. */
  playbackNote: string;
}

export type ProviderErrorCode =
  | 'not_connected'
  | 'not_configured'
  | 'not_premium'
  | 'no_active_device'
  | 'track_unavailable'
  | 'network'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface MusicProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  connect(): Promise<AuthState>;
  disconnect(): Promise<void>;
  getAuthState(): Promise<AuthState>;

  search(query: string, limit?: number): Promise<CanonicalTrack[]>;

  /**
   * Play a track from positionMs. Resolves with how it is being heard.
   * Throws ProviderError with a user-readable message when nothing can play.
   */
  playTrack(track: CanonicalTrack, positionMs?: number): Promise<PlaybackKind>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getSnapshot(): Promise<PlaybackSnapshot>;

  onStateChange(cb: (snap: PlaybackSnapshot) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
}
