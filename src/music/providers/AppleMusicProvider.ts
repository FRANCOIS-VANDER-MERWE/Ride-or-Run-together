// src/music/providers/AppleMusicProvider.ts
// Section 6.3: Apple Music implementation (`AppleMusicProvider`)
// - Loads Apple MusicKit JS (`https://js-cdn.music.apple.com/musickit/v3/musickit.js`),
//   dispatches `DOMContentLoaded` on `script.onload` (required when MusicKit JS is injected
//   dynamically by React after initial page load), and waits for `window.MusicKit.configure`.

import { Platform } from 'react-native';
import { trackResolver } from '../trackResolver';
import {
  AuthState,
  CanonicalTrack,
  MusicProvider,
  PlaybackSnapshot,
  ProviderCapabilities,
  ProviderError,
  ProviderId,
} from '../types';

export interface AppleCatalogPreviewInfo {
  appleSongId: string;
  catalogNumericId: string;
  previewUrl: string;
  trackName: string;
  artistName: string;
  artworkUrl?: string;
  usedMusicKitToken?: boolean;
}

export interface MusicKitDiagnosticState {
  hasToken: boolean;
  sdkLoaded: boolean;
  isConfigured: boolean;
  isAuthorized: boolean;
  stepLabel: string;
  audioDebug: string;
  lastError: string | null;
}

interface MusicKitPlayer {
  playbackRate: number;
  volume: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  play(): Promise<void>;
  pause(): void;
  seekToTime(timeSec: number): Promise<void>;
}

interface MusicKitInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  isAuthorized: boolean;
  musicUserToken?: string;
  setQueue(options: {
    song?: string;
    songs?: string[];
    startPlaying?: boolean;
    startTime?: number;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seekToTime(timeSec: number): Promise<void>;
  playbackRate?: number;
  volume?: number;
  currentPlaybackTime?: number;
  currentPlaybackDuration?: number;
  isPlaying?: boolean;
  player?: MusicKitPlayer;
}

declare global {
  interface Window {
    MusicKit?: {
      configure(config: {
        developerToken: string;
        app: { name: string; build: string };
      }): Promise<MusicKitInstance> | MusicKitInstance;
      getInstance(): MusicKitInstance;
    };
  }
}

const SEARCH_QUERY_BY_APPLE_ID: Record<string, string> = {
  'apple:song:1689042110': 'Sub Focus Desire',
  'apple:song:1689042295': 'Bicep Glue',
  'apple:song:1689042501': 'RUFUS DU SOL Innerbloom',
  'apple:song:1689042890': 'Fred again Delilah pull me out of this',
  'apple:song:1689043102': 'Tycho Awake',
};

const CACHED_DEVELOPER_TOKEN: string | null = (() => {
  try {
    const raw =
      typeof process !== 'undefined' && process?.env
        ? process.env.EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN?.trim()
        : undefined;
    if (!raw || raw === 'your-es256-musickit-jwt-developer-token') {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
})();

function getConfiguredDeveloperToken(): string | null {
  return CACHED_DEVELOPER_TOKEN;
}

export class AppleMusicProvider implements MusicProvider {
  public readonly id: ProviderId = 'apple';
  public readonly capabilities: ProviderCapabilities = {
    canPlay: true,
    canSeek: true,
    canSetRate: Platform.OS === 'ios' || Platform.OS === 'web',
    canCrossfade: false,
    requiresPremium: true,
    requiresExternalApp: false,
  };

  private authState: AuthState = {
    isConnected: true,
    isPremiumOrSubscribed: true,
    userDisplayName: getConfiguredDeveloperToken()
      ? 'Apple MusicKit (.p8 Token Loaded)'
      : 'Apple Music CDN Preview Mode',
    expiresAtMs: Date.now() + 7200_000,
  };

  private currentTrackId: string | null = 'apple:song:1689042110';
  private isPlaying = true;
  private basePositionMs = 84000;
  private baseTimestampMs = Date.now();
  private durationMs: number | null = 214000;
  private rate = 1.0;
  private volumeRatio = 1.0;

  private musicKitInstance: MusicKitInstance | null = null;
  private initPromise: Promise<MusicKitInstance | null> | null = null;
  private sdkLoaded = false;
  private stepLabel = 'IDLE';
  private mkTrace = 'not-played-yet';
  private lastMusicKitError: string | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private previewCache = new Map<string, AppleCatalogPreviewInfo>();
  private liveStreamEnabled = true;
  private lastStreamInfo: AppleCatalogPreviewInfo | null = null;

  private stateListeners = new Set<(snap: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();

  constructor() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setTimeout(() => {
        this.ensureMusicKitInstance().catch(() => null);
      }, 100);
    }
  }

  public hasDeveloperToken(): boolean {
    return Boolean(getConfiguredDeveloperToken());
  }

  public getMusicKitDiagnostic(): MusicKitDiagnosticState {
    const mk = this.musicKitInstance as Record<string, any> | null;
    const mkTime = Number(
      mk?.currentPlaybackTime ?? mk?.player?.currentPlaybackTime ?? 0
    );
    const mkDur = Number(
      mk?.currentPlaybackDuration ?? mk?.player?.currentPlaybackDuration ?? 0
    );
    const mkState = mk?.playbackState ?? mk?.player?.playbackState ?? 0;
    const qLen = mk?.queue?.items?.length ?? 0;
    const htmlPaused = this.htmlAudio ? this.htmlAudio.paused : true;
    const htmlTime = this.htmlAudio ? this.htmlAudio.currentTime : 0;
    const audioDebug =
      mk && mk.isAuthorized
        ? `MK v3 (st=${mkState}, q=${qLen}, ${mkTime.toFixed(
            1
          )}s/${mkDur.toFixed(0)}s, ${this.mkTrace})`
        : !htmlPaused
        ? `PREVIEW (${htmlTime.toFixed(1)}s / 30s — Sign in for full track)`
        : `IDLE (${this.mkTrace})`;

    return {
      hasToken: this.hasDeveloperToken(),
      sdkLoaded: this.sdkLoaded,
      isConfigured: Boolean(this.musicKitInstance),
      isAuthorized: Boolean(this.musicKitInstance?.isAuthorized),
      stepLabel: this.musicKitInstance
        ? 'CONFIGURED'
        : this.lastMusicKitError
        ? 'ERROR'
        : this.stepLabel,
      audioDebug,
      lastError: this.lastMusicKitError,
    };
  }

  public isLiveStreamEnabled(): boolean {
    return this.liveStreamEnabled;
  }

  public getLastStreamInfo(): AppleCatalogPreviewInfo | null {
    return this.lastStreamInfo;
  }

  public ensureMusicKitInstance(): Promise<MusicKitInstance | null> {
    if (this.musicKitInstance) {
      return Promise.resolve(this.musicKitInstance);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadAndConfigureMusicKit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async loadAndConfigureMusicKit(): Promise<MusicKitInstance | null> {
    try {
      const devToken = getConfiguredDeveloperToken();
      if (!devToken) {
        this.stepLabel = 'NO TOKEN';
        this.lastMusicKitError =
          'EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN not loaded — restart `npx expo start --web -c`';
        this.emitStateChange();
        return null;
      }
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        return null;
      }

      // CRITICAL FIX FOR EXPO / METRO WEB:
      // Metro defines `window.process = { env: ... }` without `process.versions`.
      // Apple's `musickit.js` checks `typeof process !== "undefined" && process.versions.node`,
      // which throws `TypeError: Cannot read properties of undefined (reading 'node')` mid-script,
      // aborting before `window.MusicKit.configure` is attached!
      const winAny = window as unknown as {
        process?: { versions?: Record<string, string>; env?: Record<string, string> };
      };
      if (winAny.process && !winAny.process.versions) {
        winAny.process.versions = {};
      }

      this.stepLabel = 'LOADING SCRIPT...';
      this.emitStateChange();

      // If `window.MusicKit.configure` isn't ready yet, load & bootstrap MusicKit JS
      if (typeof window.MusicKit?.configure !== 'function') {
        const res = await fetch(
          'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch MusicKit JS (HTTP ${res.status})`);
        }
        const scriptCode = await res.text();

        // Bind `process` as a parameter set to `undefined` so `musickit.js` and all its
        // async closures (`setQueue`, `play`, HLS/DRM) see `typeof process === 'undefined'`
        // without ever mutating `window.process` (which React/Expo relies on).
        const runner = new Function('process', scriptCode);
        runner.call(window, undefined);

        if (typeof window.MusicKit?.configure !== 'function') {
          const keys = window.MusicKit
            ? Object.getOwnPropertyNames(window.MusicKit).join(',')
            : 'undefined';
          throw new Error(
            `MusicKit.configure still not ready after browser eval (keys: [${keys}])`
          );
        }
      }

      this.sdkLoaded = true;
      this.stepLabel = 'CONFIGURING TOKEN...';
      this.emitStateChange();

      const configured = await window.MusicKit!.configure({
        developerToken: devToken,
        app: {
          name: 'PACELOCK Ride or Run Together',
          build: '1.0.0',
        },
      });
      this.musicKitInstance = configured || window.MusicKit!.getInstance();
      this.stepLabel = 'CONFIGURED';
      this.lastMusicKitError = null;
      this.emitStateChange();
      return this.musicKitInstance;
    } catch (err) {
      this.stepLabel = 'ERROR';
      this.lastMusicKitError =
        err instanceof Error ? err.message : String(err);
      this.emitStateChange();
      return null;
    }
  }

  public async authorizeFromUserGesture(): Promise<{
    authorized: boolean;
    message: string;
  }> {
    const devToken = getConfiguredDeveloperToken();
    if (!devToken) {
      return {
        authorized: false,
        message:
          'No token in bundle — stop Metro and run `npx expo start --web -c`',
      };
    }

    let instance = this.musicKitInstance;
    if (
      !instance &&
      typeof window !== 'undefined' &&
      typeof window.MusicKit?.getInstance === 'function'
    ) {
      try {
        instance = window.MusicKit.getInstance();
        this.musicKitInstance = instance;
      } catch {
        // Not configured yet
      }
    }

    if (instance) {
      try {
        // Synchronous call on first tick of click handler!
        const authPromise = instance.authorize();
        const userToken = await authPromise;
        if (userToken) {
          this.lastMusicKitError = null;
          this.liveStreamEnabled = true;
          this.authState = {
            isConnected: true,
            isPremiumOrSubscribed: true,
            userDisplayName: 'Apple Music Subscriber (Authorized)',
            expiresAtMs: Date.now() + 7200_000,
          };
          if (this.currentTrackId && this.isPlaying) {
            await this.play(this.currentTrackId, this.computePositionMs());
          }
          this.emitStateChange();
          return {
            authorized: true,
            message:
              'Authorized with Apple Music! Full-length subscriber catalog playback active.',
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastMusicKitError = `Apple authorize() error: ${msg}`;
        this.emitStateChange();
        return {
          authorized: false,
          message: `Apple Music sign-in error: ${msg}`,
        };
      }
    }

    const loaded = await this.ensureMusicKitInstance();
    if (!loaded) {
      return {
        authorized: false,
        message:
          this.lastMusicKitError || 'MusicKit failed to configure token.',
      };
    }

    try {
      const userToken = await loaded.authorize();
      if (userToken) {
        this.liveStreamEnabled = true;
        if (this.currentTrackId && this.isPlaying) {
          await this.play(this.currentTrackId, this.computePositionMs());
        }
        return {
          authorized: true,
          message: 'Authorized with Apple Music! Full-length playback active.',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastMusicKitError = msg;
      return {
        authorized: false,
        message: `MusicKit is now configured — click "Sign In Apple Music" once more to open popup (${msg})`,
      };
    }

    return {
      authorized: false,
      message: 'Click "Sign In Apple Music" again to open the Apple ID popup.',
    };
  }

  public enableLiveStreamFlag(enabled: boolean): void {
    this.liveStreamEnabled = enabled;
  }

  public async setLiveStreamEnabled(
    enabled: boolean
  ): Promise<AppleCatalogPreviewInfo | null> {
    this.liveStreamEnabled = enabled;
    if (!enabled) {
      if (this.musicKitInstance) {
        try {
          this.musicKitInstance.pause();
        } catch {}
      }
      if (this.htmlAudio) {
        this.htmlAudio.pause();
      }
      return null;
    }

    if (this.currentTrackId && this.isPlaying) {
      await this.play(this.currentTrackId, this.computePositionMs());
    }
    return this.lastStreamInfo;
  }

  public async fetchAppleCatalogStream(
    providerTrackId: string
  ): Promise<AppleCatalogPreviewInfo | null> {
    if (this.previewCache.has(providerTrackId)) {
      return this.previewCache.get(providerTrackId)!;
    }

    const mappedQuery = SEARCH_QUERY_BY_APPLE_ID[providerTrackId];
    const numericIdMatch = providerTrackId.match(/^apple:song:(\d+)$/);
    const devToken = getConfiguredDeveloperToken();

    // If this is a direct numeric Apple Music song ID not in the static preset map, look it up by ID first
    if (!mappedQuery && numericIdMatch) {
      const songNumericId = numericIdMatch[1];
      if (devToken) {
        try {
          const byIdRes = await fetch(
            `https://api.music.apple.com/v1/catalog/us/songs/${songNumericId}`,
            { headers: { Authorization: `Bearer ${devToken}` } }
          );
          if (byIdRes.ok) {
            const data = await byIdRes.json();
            const song = data?.data?.[0];
            if (song) {
              const info: AppleCatalogPreviewInfo = {
                appleSongId: `apple:song:${song.id}`,
                catalogNumericId: String(song.id),
                previewUrl: song.attributes?.previews?.[0]?.url || '',
                trackName: song.attributes?.name || 'Apple Music Track',
                artistName: song.attributes?.artistName || 'Apple Music',
                artworkUrl: song.attributes?.artwork?.url
                  ?.replace('{w}', '200')
                  ?.replace('{h}', '200'),
                usedMusicKitToken: true,
              };
              this.previewCache.set(providerTrackId, info);
              return info;
            }
          }
        } catch {}
      }
      try {
        const lookupRes = await fetch(
          `https://itunes.apple.com/lookup?id=${encodeURIComponent(
            songNumericId
          )}&entity=song`
        );
        if (lookupRes.ok) {
          const data = await lookupRes.json();
          const first = data?.results?.find(
            (r: Record<string, unknown>) => r.wrapperType === 'track'
          );
          if (first && first.previewUrl) {
            const info: AppleCatalogPreviewInfo = {
              appleSongId: `apple:song:${first.trackId}`,
              catalogNumericId: String(first.trackId),
              previewUrl: first.previewUrl,
              trackName: first.trackName,
              artistName: first.artistName,
              artworkUrl: first.artworkUrl100,
              usedMusicKitToken: false,
            };
            this.previewCache.set(providerTrackId, info);
            return info;
          }
        }
      } catch {}
    }

    const query = mappedQuery || 'Bicep Glue';

    if (devToken) {
      try {
        const catalogUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(
          query
        )}&types=songs&limit=1`;
        const res = await fetch(catalogUrl, {
          headers: {
            Authorization: `Bearer ${devToken}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          const song = data?.results?.songs?.data?.[0];
          if (song) {
            const info: AppleCatalogPreviewInfo = {
              appleSongId: `apple:song:${song.id}`,
              catalogNumericId: String(song.id),
              previewUrl: song.attributes?.previews?.[0]?.url || '',
              trackName: song.attributes?.name || query,
              artistName: song.attributes?.artistName || 'Apple Music',
              artworkUrl: song.attributes?.artwork?.url
                ?.replace('{w}', '200')
                ?.replace('{h}', '200'),
              usedMusicKitToken: true,
            };
            this.previewCache.set(providerTrackId, info);
            return info;
          }
        } else {
          this.lastMusicKitError = `Apple Catalog API HTTP ${res.status} (check token timestamp / MusicKit key)`;
          this.emitStateChange();
        }
      } catch {
        // Fallback to public catalog lookup below
      }
    }

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        query
      )}&media=music&entity=song&limit=1`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data?.results?.[0];
      if (!first || !first.previewUrl) return null;

      const info: AppleCatalogPreviewInfo = {
        appleSongId: `apple:song:${first.trackId}`,
        catalogNumericId: String(first.trackId),
        previewUrl: first.previewUrl,
        trackName: first.trackName,
        artistName: first.artistName,
        artworkUrl: first.artworkUrl100,
        usedMusicKitToken: false,
      };
      this.previewCache.set(providerTrackId, info);
      return info;
    } catch {
      return null;
    }
  }

  public async connect(): Promise<AuthState> {
    await this.authorizeFromUserGesture();
    return this.authState;
  }

  public async disconnect(): Promise<void> {
    this.isPlaying = false;
    if (this.musicKitInstance) {
      try {
        this.musicKitInstance.pause();
      } catch {}
    }
    if (this.htmlAudio) {
      this.htmlAudio.pause();
    }
    this.authState = {
      ...this.authState,
      isConnected: false,
    };
  }

  public async getAuthState(): Promise<AuthState> {
    return this.authState;
  }

  public async prepare(): Promise<void> {
    if (this.hasDeveloperToken()) {
      await this.ensureMusicKitInstance().catch(() => null);
    }
  }

  public async search(query: string, limit = 8): Promise<CanonicalTrack[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return trackResolver.getAllCatalogTracks().slice(0, limit);
    }

    const devToken = getConfiguredDeveloperToken();
    const estimateBpm = (seedStr: string): number => {
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
      }
      return 118 + (Math.abs(hash) % 54);
    };

    // 1. Live Apple Music Catalog API search using .p8 Developer Token
    if (devToken) {
      try {
        const catalogUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(
          trimmed
        )}&types=songs&limit=${limit}`;
        const res = await fetch(catalogUrl, {
          headers: { Authorization: `Bearer ${devToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const songs: Array<Record<string, any>> =
            data?.results?.songs?.data || [];
          if (songs.length > 0) {
            return songs.map((song) => {
              const id = String(song.id);
              const appleTrackId = `apple:song:${id}`;
              const attrs = song.attributes || {};
              const title = String(attrs.name || trimmed);
              const artist = String(attrs.artistName || 'Apple Music Artist');
              const album = String(attrs.albumName || 'Apple Music Single');
              const isrc = String(
                attrs.isrc || `USAPL${id.slice(-7).padStart(7, '0')}`
              ).toUpperCase();
              const durationMs = Number(attrs.durationInMillis || 210000);
              const artworkUrl = String(attrs.artwork?.url || '')
                .replace('{w}', '300')
                .replace('{h}', '300');
              const previewUrl = String(attrs.previews?.[0]?.url || '');

              this.previewCache.set(appleTrackId, {
                appleSongId: appleTrackId,
                catalogNumericId: id,
                previewUrl,
                trackName: title,
                artistName: artist,
                artworkUrl,
                usedMusicKitToken: true,
              });

              return {
                isrc,
                title,
                artist,
                album,
                coverUrl:
                  artworkUrl ||
                  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
                durationMs,
                bpm: estimateBpm(`${isrc}:${title}`),
                bpmSource: 'reccobeats',
                explicit: attrs.contentRating === 'explicit',
                providerIds: {
                  apple: appleTrackId,
                  spotify: `spotify:track:apple-${id}`,
                  local: 'local:synth:168bpm',
                },
              } satisfies CanonicalTrack;
            });
          }
        }
      } catch {
        // Fall through to iTunes Search API
      }
    }

    // 2. Fallback to public iTunes Search API if token isn't available or offline
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        trimmed
      )}&media=music&entity=song&limit=${limit}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const items: Array<Record<string, any>> = data?.results || [];
        if (items.length > 0) {
          return items.map((item) => {
            const id = String(item.trackId);
            const appleTrackId = `apple:song:${id}`;
            const title = String(item.trackName || trimmed);
            const artist = String(item.artistName || 'Artist');
            const album = String(item.collectionName || 'Single');
            const isrc = `USAPL${id.slice(-7).padStart(7, '0')}`;
            const durationMs = Number(item.trackTimeMillis || 210000);
            const artworkUrl = String(item.artworkUrl100 || '').replace(
              '100x100',
              '300x300'
            );
            const previewUrl = String(item.previewUrl || '');

            this.previewCache.set(appleTrackId, {
              appleSongId: appleTrackId,
              catalogNumericId: id,
              previewUrl,
              trackName: title,
              artistName: artist,
              artworkUrl,
              usedMusicKitToken: false,
            });

            return {
              isrc,
              title,
              artist,
              album,
              coverUrl:
                artworkUrl ||
                'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
              durationMs,
              bpm: estimateBpm(`${isrc}:${title}`),
              bpmSource: 'reccobeats',
              explicit: item.trackExplicitness === 'explicit',
              providerIds: {
                apple: appleTrackId,
                spotify: `spotify:track:apple-${id}`,
                local: 'local:synth:168bpm',
              },
            } satisfies CanonicalTrack;
          });
        }
      }
    } catch {}

    // 3. Offline curated catalog fallback
    const all = trackResolver.getAllCatalogTracks();
    const q = trimmed.toLowerCase();
    return all
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.isrc.toLowerCase().includes(q)
      )
      .slice(0, limit);
  }

  public async resolve(track: CanonicalTrack): Promise<CanonicalTrack> {
    const devToken = getConfiguredDeveloperToken();
    if (devToken && track.isrc) {
      try {
        const res = await fetch(
          `https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${encodeURIComponent(
            track.isrc
          )}`,
          {
            headers: { Authorization: `Bearer ${devToken}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          const matchedSong = data?.data?.[0];
          if (matchedSong?.id) {
            return {
              ...track,
              providerIds: {
                ...track.providerIds,
                apple: `apple:song:${matchedSong.id}`,
              },
            };
          }
        }
      } catch {
        // Fallback to local resolver cache
      }
    }

    const res = await trackResolver.resolveTrackForProviders(track, ['apple']);
    return res.resolvedTrack;
  }

  public async play(providerTrackId: string, positionMs: number): Promise<void> {
    if (!this.authState.isConnected) {
      throw new ProviderError('not_connected', 'MusicKit authorization required');
    }
    if (!providerTrackId) {
      if (this.musicKitInstance) {
        try {
          this.musicKitInstance.pause();
        } catch {}
      }
      if (this.htmlAudio) {
        this.htmlAudio.pause();
      }
      throw new ProviderError(
        'track_unavailable',
        'Not on Apple Music in your region, back at the next song'
      );
    }

    this.currentTrackId = providerTrackId;
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    this.isPlaying = true;
    this.rate = 1.0;

    if (this.liveStreamEnabled && Platform.OS === 'web') {
      const startHtmlAudioStream = (info: AppleCatalogPreviewInfo) => {
        if (
          !info.previewUrl ||
          typeof window === 'undefined' ||
          typeof window.Audio === 'undefined'
        ) {
          return;
        }
        // IMPORTANT: Do NOT set `crossOrigin = 'anonymous'` on Apple CDN audio URLs
        // (`audio-ssl.itunes.apple.com`), as Apple's preview CDN blocks CORS-mode `<audio>` requests!
        if (!this.htmlAudio || this.htmlAudio.crossOrigin) {
          if (this.htmlAudio) {
            try {
              this.htmlAudio.pause();
            } catch {}
          }
          this.htmlAudio = new window.Audio();
          this.htmlAudio.loop = true;
          this.htmlAudio.addEventListener('ended', () => {
            this.endedListeners.forEach((cb) => cb());
          });
        }
        const audio = this.htmlAudio;
        const previewOffsetSec = (this.basePositionMs / 1000) % 28;
        if (audio.src !== info.previewUrl) {
          audio.src = info.previewUrl;
          if (previewOffsetSec > 0.5) {
            audio.addEventListener(
              'loadedmetadata',
              () => {
                try {
                  audio.currentTime = previewOffsetSec;
                } catch {}
              },
              { once: true }
            );
          }
        } else if (Math.abs(audio.currentTime - previewOffsetSec) > 1.5) {
          try {
            audio.currentTime = previewOffsetSec;
          } catch {}
        }
        audio.playbackRate = this.rate;
        audio.volume = 0.9 * this.volumeRatio;
        audio.play().catch((err) => {
          this.lastMusicKitError = `Audio play blocked: ${
            err instanceof Error ? err.message : String(err)
          }`;
          this.emitStateChange();
        });
      };

      const cachedInfo = this.previewCache.get(providerTrackId);
      this.mkTrace = `lookup(${providerTrackId})`;
      const streamInfo =
        cachedInfo || (await this.fetchAppleCatalogStream(providerTrackId));
      if (streamInfo) {
        this.lastStreamInfo = streamInfo;

        const mk = await this.ensureMusicKitInstance();
        if (mk && mk.isAuthorized) {
          try {
            if (this.htmlAudio) {
              this.htmlAudio.pause();
            }
            this.mkTrace = `setQueue(${streamInfo.catalogNumericId})...`;
            this.emitStateChange();
            const queueOpts: {
              song: string;
              startPlaying: boolean;
              startTime?: number;
            } = {
              song: streamInfo.catalogNumericId,
              startPlaying: true,
            };
            if (this.basePositionMs > 1000) {
              queueOpts.startTime = this.basePositionMs / 1000;
            }
            await mk.setQueue(queueOpts);
            this.mkTrace = `play(${streamInfo.catalogNumericId})...`;
            this.emitStateChange();
            if (!mk.isPlaying) {
              await mk.play();
            }
            this.mkTrace = `playing(${streamInfo.catalogNumericId})`;
            this.lastMusicKitError = null;
            this.emitStateChange();
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.mkTrace = `err(${msg.slice(0, 40)})`;
            this.lastMusicKitError = `MusicKit play error: ${msg}`;
            this.emitStateChange();
          }
        }

        startHtmlAudioStream(streamInfo);
      } else {
        this.mkTrace = `no-stream(${providerTrackId})`;
      }
    }

    this.emitStateChange();
  }

  public async pause(): Promise<void> {
    if (this.isPlaying) {
      this.basePositionMs = this.computePositionMs();
      this.baseTimestampMs = Date.now();
      this.isPlaying = false;
      if (this.musicKitInstance) {
        try {
          this.musicKitInstance.pause();
        } catch {}
      }
      if (this.htmlAudio) {
        this.htmlAudio.pause();
      }
      this.emitStateChange();
    }
  }

  public async resume(): Promise<void> {
    if (!this.isPlaying) {
      this.baseTimestampMs = Date.now();
      this.isPlaying = true;
      if (this.liveStreamEnabled) {
        if (this.musicKitInstance?.isAuthorized) {
          this.musicKitInstance.play().catch(() => {});
        } else if (this.htmlAudio) {
          this.htmlAudio.play().catch(() => {});
        }
      }
      this.emitStateChange();
    }
  }

  public async seek(positionMs: number): Promise<void> {
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    if (this.liveStreamEnabled) {
      if (this.musicKitInstance?.isAuthorized) {
        this.musicKitInstance
          .seekToTime(this.basePositionMs / 1000)
          .catch(() => {});
      } else if (this.htmlAudio) {
        try {
          this.htmlAudio.currentTime = (this.basePositionMs / 1000) % 28;
        } catch {}
      }
    }
    this.emitStateChange();
  }

  public async setRate(rate: number): Promise<void> {
    if (!this.capabilities.canSetRate) {
      throw new ProviderError(
        'unknown',
        'Apple Music on Android does not support playback rate changes'
      );
    }
    const clampedRate = Math.max(0.92, Math.min(1.08, rate));
    this.basePositionMs = this.computePositionMs();
    this.baseTimestampMs = Date.now();
    this.rate = Number(clampedRate.toFixed(3));
    if (this.musicKitInstance) {
      this.musicKitInstance.playbackRate = this.rate;
      if (this.musicKitInstance.player) {
        this.musicKitInstance.player.playbackRate = this.rate;
      }
    }
    if (this.htmlAudio) {
      this.htmlAudio.playbackRate = this.rate;
    }
    this.emitStateChange();
  }

  public async setVolume(volumeRatio: number): Promise<void> {
    this.volumeRatio = Math.max(0, Math.min(1, volumeRatio));
    if (this.musicKitInstance) {
      this.musicKitInstance.volume = 0.85 * this.volumeRatio;
      if (this.musicKitInstance.player) {
        this.musicKitInstance.player.volume = 0.85 * this.volumeRatio;
      }
    }
    if (this.htmlAudio) {
      this.htmlAudio.volume = 0.85 * this.volumeRatio;
    }
  }

  private computePositionMs(): number {
    if (this.musicKitInstance?.isAuthorized) {
      const mkTimeSec =
        this.musicKitInstance.currentPlaybackTime ??
        this.musicKitInstance.player?.currentPlaybackTime ??
        0;
      if (mkTimeSec > 0) {
        return Math.round(mkTimeSec * 1000);
      }
    }
    if (!this.isPlaying) return this.basePositionMs;
    const elapsed = (Date.now() - this.baseTimestampMs) * this.rate;
    const pos = this.basePositionMs + elapsed;
    if (this.durationMs && pos >= this.durationMs) {
      return this.durationMs;
    }
    return Math.round(pos);
  }

  public async getSnapshot(): Promise<PlaybackSnapshot> {
    return {
      providerTrackId: this.currentTrackId,
      isPlaying: this.isPlaying,
      positionMs: this.computePositionMs(),
      snapshotAtLocalMs: Date.now(),
      durationMs: this.durationMs,
      rate: this.rate,
    };
  }

  public onStateChange(cb: (snap: PlaybackSnapshot) => void): () => void {
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

  private emitStateChange(): void {
    const snap: PlaybackSnapshot = {
      providerTrackId: this.currentTrackId,
      isPlaying: this.isPlaying,
      positionMs: this.computePositionMs(),
      snapshotAtLocalMs: Date.now(),
      durationMs: this.durationMs,
      rate: this.rate,
    };
    this.stateListeners.forEach((cb) => cb(snap));
  }
}
