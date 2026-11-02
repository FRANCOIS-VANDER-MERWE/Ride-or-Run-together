// src/music/providers/SpotifyProvider.ts
// Real Spotify integration, using only what Spotify actually offers a
// third-party mobile app:
//
// - Linking: OAuth 2.0 Authorization Code + PKCE (no client secret in the
//   app). The sign-in UI hook lives in SpotifySyncDeck; this class owns the
//   config, the code exchange, token storage, and refresh.
// - Search: the Web API, with the signed-in user's own access token.
// - Full playback: the Web API remote-controls the user's active Spotify
//   device (their Spotify app). Spotify gives third-party apps no audio
//   stream of its own, so full tracks can never play "inside" this app.
// - Sound fallback: when there is no active Spotify device, playTrack()
//   falls back to the track's official preview (Spotify preview_url when
//   present, otherwise the same recording's iTunes preview, matched by
//   ISRC) through the in-app audio engine, so tapping a song always makes
//   sound. The UI labels which mode is in use; nothing pretends.
//
// Requires EXPO_PUBLIC_SPOTIFY_CLIENT_ID and the redirect URI below
// registered in the Spotify Developer Dashboard.

import * as AuthSession from 'expo-auth-session';

import { audioEngine } from '../audioEngine';
import { findPreviewUrl } from '../itunes';
import { storageDelete, storageGet, storageSet } from '../storage';
import {
  AuthState,
  CanonicalTrack,
  MusicProvider,
  PlaybackKind,
  PlaybackSnapshot,
  ProviderCapabilities,
  ProviderError,
} from '../types';

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
];

export function getSpotifyClientId(): string {
  return process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
}

export function getSpotifyRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'pacelock',
    path: 'spotify-auth-callback',
  });
}

/** Config for expo-auth-session's useAuthRequest in the UI layer. */
export function buildSpotifyAuthRequestConfig(): AuthSession.AuthRequestConfig {
  return {
    clientId: getSpotifyClientId(),
    scopes: SPOTIFY_SCOPES,
    redirectUri: getSpotifyRedirectUri(),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  };
}

const TOKEN_KEY = 'pacelock.spotify.tokens.v1';

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number;
}

interface SpotifyTrackItem {
  uri: string;
  name: string;
  duration_ms: number;
  explicit?: boolean;
  preview_url?: string | null;
  external_ids?: { isrc?: string };
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string }[] };
}

interface SpotifyDevice {
  id: string;
  is_active: boolean;
  name: string;
}

export class SpotifyProvider implements MusicProvider {
  public readonly id = 'spotify' as const;
  public readonly capabilities: ProviderCapabilities = {
    canPlay: true,
    canSeek: true,
    requiresPremium: true,
    requiresExternalApp: true,
    playbackNote:
      'Full songs play on your Spotify app (Premium). With no Spotify device active, a 30s preview plays here instead.',
  };

  private tokens: StoredTokens | null = null;
  private restorePromise: Promise<void> | null = null;
  private authState: AuthState = {
    isConnected: false,
    isPremiumOrSubscribed: null,
    userDisplayName: null,
    expiresAtMs: null,
  };

  private currentTrack: CanonicalTrack | null = null;
  private kind: PlaybackKind | null = null;
  private remoteSnapshot: PlaybackSnapshot | null = null;
  private remoteSnapshotAtMs = 0;

  private stateListeners = new Set<(snap: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();

  constructor() {
    audioEngine.onEnded(() => {
      if (this.kind === 'preview') {
        this.endedListeners.forEach((cb) => cb());
        this.emit();
      }
    });
    audioEngine.onStateChange(() => {
      if (this.kind === 'preview') this.emit();
    });
  }

  // --- auth ---

  private restore(): Promise<void> {
    if (!this.restorePromise) {
      this.restorePromise = (async () => {
        const raw = await storageGet(TOKEN_KEY);
        if (!raw) return;
        try {
          this.tokens = JSON.parse(raw) as StoredTokens;
          await this.fetchProfile();
        } catch {
          this.tokens = null;
        }
      })();
    }
    return this.restorePromise;
  }

  private async saveTokens(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
    await storageSet(TOKEN_KEY, JSON.stringify(tokens));
  }

  private async fetchProfile(): Promise<void> {
    const me = await this.api('/me');
    this.authState = {
      isConnected: true,
      isPremiumOrSubscribed: me?.product ? me.product === 'premium' : null,
      userDisplayName: me?.display_name ?? 'Spotify user',
      expiresAtMs: this.tokens?.expiresAtMs ?? null,
    };
  }

  /**
   * Complete the PKCE flow. Called by the UI after useAuthRequest returns a
   * successful response containing an authorization code.
   */
  public async connectWithCode(
    code: string,
    codeVerifier: string | undefined,
    redirectUri: string
  ): Promise<AuthState> {
    const clientId = getSpotifyClientId();
    if (!clientId) {
      throw new ProviderError(
        'not_configured',
        'Set EXPO_PUBLIC_SPOTIFY_CLIENT_ID in .env and restart the app.'
      );
    }
    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code,
        redirectUri,
        extraParams: codeVerifier ? { code_verifier: codeVerifier } : {},
      },
      SPOTIFY_DISCOVERY
    );
    await this.saveTokens({
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? null,
      expiresAtMs:
        Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000,
    });
    await this.fetchProfile();
    this.emit();
    return this.authState;
  }

  /**
   * Spotify sign-in is driven by the UI's auth hook, so connect() cannot run
   * it from here. It reports the restored session state instead; the Deck's
   * Connect button performs the actual flow.
   */
  public async connect(): Promise<AuthState> {
    await this.restore();
    return this.authState;
  }

  public async disconnect(): Promise<void> {
    await this.pause().catch(() => {});
    this.tokens = null;
    this.authState = {
      isConnected: false,
      isPremiumOrSubscribed: null,
      userDisplayName: null,
      expiresAtMs: null,
    };
    await storageDelete(TOKEN_KEY);
    this.emit();
  }

  public async getAuthState(): Promise<AuthState> {
    await this.restore();
    return this.authState;
  }

  public isConfigured(): boolean {
    return getSpotifyClientId().length > 0;
  }

  // --- Web API plumbing ---

  private async ensureAccessToken(): Promise<string> {
    await this.restore();
    if (!this.tokens) {
      throw new ProviderError(
        'not_connected',
        'Connect your Spotify account first.'
      );
    }
    if (
      this.tokens.expiresAtMs - Date.now() < 60_000 &&
      this.tokens.refreshToken
    ) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: getSpotifyClientId(),
      });
      const res = await fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        throw new ProviderError(
          'not_connected',
          'Spotify session expired. Connect Spotify again.'
        );
      }
      const json = await res.json();
      await this.saveTokens({
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? this.tokens.refreshToken,
        expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
      });
    }
    return this.tokens.accessToken;
  }

  private async api(
    path: string,
    init?: RequestInit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const token = await this.ensureAccessToken();
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      let message = `Spotify request failed (${res.status})`;
      try {
        const json = await res.json();
        if (json?.error?.message) message = json.error.message;
      } catch {
        // keep the status-based message
      }
      throw new ProviderError(
        res.status === 403 ? 'not_premium' : 'network',
        message
      );
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // --- catalog ---

  public async search(
    query: string,
    limit = 15
  ): Promise<CanonicalTrack[]> {
    const q = query.trim();
    if (!q) return [];
    const data = await this.api(
      `/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`
    );
    const items = (data?.tracks?.items ?? []) as SpotifyTrackItem[];
    return items.map((t) => ({
      isrc: t.external_ids?.isrc ?? '',
      title: t.name,
      artist: (t.artists ?? []).map((a) => a.name).join(', '),
      album: t.album?.name,
      artworkUrl: t.album?.images?.[0]?.url,
      durationMs: t.duration_ms,
      bpm: null,
      explicit: t.explicit,
      previewUrl: t.preview_url ?? null,
      providerIds: { spotify: t.uri },
    }));
  }

  // --- playback ---

  public async playTrack(
    track: CanonicalTrack,
    positionMs = 0
  ): Promise<PlaybackKind> {
    const uri = track.providerIds.spotify;
    if (!uri) {
      throw new ProviderError(
        'track_unavailable',
        'This track has no Spotify ID.'
      );
    }
    this.currentTrack = track;

    // Preferred: full track on the user's active Spotify device.
    if (this.tokens || (await this.restore(), this.tokens)) {
      try {
        const devicesData = await this.api('/me/player/devices');
        const devices = (devicesData?.devices ?? []) as SpotifyDevice[];
        const device = devices.find((d) => d.is_active) ?? devices[0];
        if (!device) {
          throw new ProviderError(
            'no_active_device',
            'No Spotify device is active.'
          );
        }
        await this.api(
          `/me/player/play?device_id=${encodeURIComponent(device.id)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
          }
        );
        this.kind = 'remote';
        this.remoteSnapshot = null;
        this.emit();
        return 'remote';
      } catch (err) {
        // Fall through to the preview when remote control is not possible
        // (no device, free tier restrictions, or the API refused). The
        // preview attempt below surfaces its own clear error if it also
        // cannot play, and says why remote failed.
        if (__DEV__) {
          console.log('[Spotify] remote play failed, trying preview:', err);
        }
      }
    }

    // Fallback: in-app preview so the tap produces real sound.
    const previewUrl = await findPreviewUrl(track);
    if (!previewUrl) {
      throw new ProviderError(
        'no_active_device',
        'No Spotify device is active and no preview exists for this track. Open the Spotify app once so it becomes an active device, then try again.'
      );
    }
    await audioEngine.playUrl(
      previewUrl,
      uri,
      Math.min(positionMs, 25_000)
    );
    this.kind = 'preview';
    this.emit();
    return 'preview';
  }

  public async pause(): Promise<void> {
    if (this.kind === 'preview') {
      audioEngine.pause();
    } else if (this.kind === 'remote') {
      await this.api('/me/player/pause', { method: 'PUT' }).catch(() => {});
      this.remoteSnapshot = null;
    }
    this.emit();
  }

  public async resume(): Promise<void> {
    if (this.kind === 'preview') {
      audioEngine.resume();
    } else if (this.kind === 'remote') {
      await this.api('/me/player/play', { method: 'PUT' });
      this.remoteSnapshot = null;
    }
    this.emit();
  }

  public async seek(positionMs: number): Promise<void> {
    if (this.kind === 'preview') {
      await audioEngine.seek(Math.min(positionMs, 29_000));
    } else if (this.kind === 'remote') {
      await this.api(
        `/me/player/seek?position_ms=${Math.round(positionMs)}`,
        { method: 'PUT' }
      );
      this.remoteSnapshot = null;
    }
    this.emit();
  }

  public async getSnapshot(): Promise<PlaybackSnapshot> {
    if (this.kind === 'preview') {
      const snap = audioEngine.snapshot();
      return { ...snap, kind: 'preview' };
    }
    if (this.kind === 'remote' && this.currentTrack) {
      const now = Date.now();
      if (this.remoteSnapshot && now - this.remoteSnapshotAtMs < 1000) {
        const base = this.remoteSnapshot;
        return {
          ...base,
          positionMs: base.isPlaying
            ? base.positionMs + (now - this.remoteSnapshotAtMs)
            : base.positionMs,
        };
      }
      try {
        const state = await this.api('/me/player');
        if (state?.item) {
          this.remoteSnapshot = {
            trackKey: state.item.uri ?? this.currentTrack.providerIds.spotify ?? null,
            isPlaying: !!state.is_playing,
            isBuffering: false,
            positionMs: state.progress_ms ?? 0,
            durationMs: state.item.duration_ms ?? this.currentTrack.durationMs,
            kind: 'remote',
          };
          this.remoteSnapshotAtMs = now;
          return this.remoteSnapshot;
        }
      } catch {
        // Keep the last known snapshot rather than failing the UI poll.
      }
      if (this.remoteSnapshot) return this.remoteSnapshot;
    }
    return {
      trackKey: this.currentTrack?.providerIds.spotify ?? null,
      isPlaying: false,
      isBuffering: false,
      positionMs: 0,
      durationMs: this.currentTrack?.durationMs ?? null,
      kind: this.kind,
    };
  }

  public getCurrentTrack(): CanonicalTrack | null {
    return this.currentTrack;
  }

  public getKind(): PlaybackKind | null {
    return this.kind;
  }

  // --- events ---

  private emit(): void {
    this.getSnapshot()
      .then((snap) => this.stateListeners.forEach((cb) => cb(snap)))
      .catch(() => {});
  }

  public onStateChange(
    cb: (snap: PlaybackSnapshot) => void
  ): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  public onTrackEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => {
      this.endedListeners.delete(cb);
    };
  }
}

export const spotifyProvider = new SpotifyProvider();
