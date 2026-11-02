// src/music/providers/AppleMusicProvider.ts
// Apple Music integration, split honestly by platform:
//
// - Search (all platforms): the public iTunes Search API. No account or
//   token needed, and it returns each song's official preview stream URL.
// - Playback on iOS / Android: the preview stream, played in-app through
//   expo-audio. That is real sound from the real recording. Full-length
//   Apple Music playback on native requires Apple's MusicKit native
//   framework through a custom native module and a paid Apple Developer
//   account; an Expo Go / managed app cannot do it, and this provider
//   does not pretend otherwise.
// - Playback on web: when EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN is
//   set, MusicKit JS is loaded, the user can authorize their real Apple
//   Music account, and full tracks play through MusicKit. Without a
//   token, web also uses previews.
//
// scripts/mint-apple-token.mjs mints the developer token from the team's
// MusicKit key (.p8). The key itself must never be in the app or repo.

import { Platform } from 'react-native';

import { audioEngine } from '../audioEngine';
import { findPreviewUrl, searchItunes } from '../itunes';
import {
  AuthState,
  CanonicalTrack,
  MusicProvider,
  PlaybackKind,
  PlaybackSnapshot,
  ProviderCapabilities,
  ProviderError,
} from '../types';

interface MusicKitInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  isAuthorized: boolean;
  canPlayCatalogContent?: boolean;
  setQueue(options: {
    song?: string;
    songs?: string[];
    url?: string;
    startPlaying?: boolean;
  }): Promise<{ items?: unknown[] } | unknown>;
  play(): Promise<void>;
  pause(): void;
  seekToTime(seconds: number): Promise<void>;
  currentPlaybackTime?: number;
  currentPlaybackDuration?: number;
  isPlaying?: boolean;
  playbackState?: number;
  queue?: { items?: unknown[] };
  nowPlayingItem?: unknown;
  storefrontId?: string;
  api?: {
    music(href: string): Promise<unknown>;
  };
  addEventListener?: (name: string, cb: (event: unknown) => void) => void;
  removeEventListener?: (name: string, cb: (event: unknown) => void) => void;
}

function describeKitEvent(event: unknown): string {
  if (!event || typeof event !== 'object') return String(event);
  const e = event as {
    error?: { message?: string; description?: string };
    message?: string;
    description?: string;
    detail?: { message?: string };
  };
  return (
    e.error?.description ||
    e.error?.message ||
    e.detail?.message ||
    e.message ||
    e.description ||
    'unknown MusicKit playback error'
  );
}

declare global {
  interface Window {
    MusicKit?: {
      configure(config: {
        developerToken: string;
        app: { name: string; build: string };
      }): Promise<unknown>;
      getInstance(): MusicKitInstance;
    };
  }
}

/**
 * Expo/Metro define a `process` global in the browser but usually leave
 * `process.versions` undefined. MusicKit JS checks `null !== process.versions`
 * (true when it is undefined) and then reads `process.versions.node`, which
 * throws during library initialization and leaves window.MusicKit present
 * but half-built, with no configure() function. Forcing versions to null
 * makes the library take its browser path. (Pattern from the expo-apple-music
 * project's web loader, which fixed MusicKit JS in Expo web the same way.)
 */
function patchProcessForMusicKit(): void {
  try {
    if (typeof process !== 'undefined' && process.versions == null) {
      Object.assign(process, { versions: null });
    }
  } catch {
    // Not fatal; the loader still reports a precise error if init fails.
  }
}

function getDeveloperToken(): string {
  return process.env.EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN ?? '';
}

/**
 * Decode (not verify) a JWT's claims, to catch the common token problems
 * client-side: not a JWT at all, missing team ID, or expired. Returns a
 * user-readable problem string, or null when the token looks usable.
 */
function developerTokenProblem(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return 'the configured developer token is not a JWT (it should have 3 dot-separated parts). Re-mint it with: npm run mint:apple-token';
  }
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload)) as {
      iss?: string;
      exp?: number;
    };
    if (!claims.iss) {
      return 'the developer token has no iss (team ID) claim. Re-mint it with your Apple Developer Team ID.';
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      return `the developer token expired on ${new Date(claims.exp * 1000).toISOString()}. Re-mint it with: npm run mint:apple-token`;
    }
    return null;
  } catch {
    return 'the developer token payload could not be decoded. Re-mint it with: npm run mint:apple-token';
  }
}

export class AppleMusicProvider implements MusicProvider {
  public readonly id = 'apple' as const;
  public readonly capabilities: ProviderCapabilities = {
    canPlay: true,
    canSeek: true,
    requiresPremium: false,
    requiresExternalApp: false,
    playbackNote:
      Platform.OS === 'web'
        ? 'Full songs play through MusicKit when an Apple developer token is configured; otherwise 30s previews play here.'
        : 'Search is the live Apple catalog and 30s previews play in-app. Full-length Apple playback needs a native MusicKit build (not possible in Expo Go).',
  };

  private authState: AuthState = {
    isConnected: false,
    isPremiumOrSubscribed: null,
    userDisplayName: null,
    expiresAtMs: null,
  };

  private kit: MusicKitInstance | null = null;
  private kitLoadPromise: Promise<MusicKitInstance | null> | null = null;
  private kitError: string | null = null;

  private currentTrack: CanonicalTrack | null = null;
  private kind: PlaybackKind | null = null;
  private lastKitPlaybackError: string | null = null;

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

  public canUseMusicKit(): boolean {
    return Platform.OS === 'web' && getDeveloperToken().length > 0;
  }

  // --- MusicKit JS (web only) ---

  private ensureKit(): Promise<MusicKitInstance | null> {
    if (!this.canUseMusicKit()) return Promise.resolve(null);
    if (this.kit) return Promise.resolve(this.kit);
    if (!this.kitLoadPromise) {
      this.kitLoadPromise = (async () => {
        const kit = await this.loadKitOnce();
        if (!kit) {
          // Let a later Connect tap retry instead of caching the failure
          // for the whole page session.
          this.kitLoadPromise = null;
        }
        return kit;
      })();
    }
    return this.kitLoadPromise;
  }

  private async loadKitOnce(): Promise<MusicKitInstance | null> {
    patchProcessForMusicKit();
    try {
      if (!window.MusicKit?.configure) {
        const scriptReady = new Promise<boolean>((resolve) => {
          const onLoaded = () => {
            cleanup();
            resolve(true);
          };
          const onError = () => {
            cleanup();
            resolve(false);
          };
          const cleanup = () => {
            document.removeEventListener('musickitloaded', onLoaded);
            document.removeEventListener('musickiterror', onError);
          };
          document.addEventListener('musickitloaded', onLoaded);
          document.addEventListener('musickiterror', onError);
          // The event may already have fired before we subscribed.
          if (window.MusicKit?.configure) {
            cleanup();
            resolve(true);
            return;
          }
          const existing = document.querySelector(
            'script[src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"]'
          );
          if (!existing) {
            const script = document.createElement('script');
            script.src =
              'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
            script.async = true;
            script.onerror = onError;
            document.head.appendChild(script);
          }
          setTimeout(() => {
            cleanup();
            resolve(!!window.MusicKit?.configure);
          }, 15_000);
        });
        const ready = await scriptReady;
        // Readiness means the full API is attached, not just the global.
        const deadline = Date.now() + 5_000;
        while (!window.MusicKit?.configure && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!window.MusicKit?.configure) {
          this.kitError = ready
            ? 'the MusicKit library signaled loaded but its configure() function never appeared. This is the known Expo web initialization failure mode; a full page reload usually clears it.'
            : 'the MusicKit script failed to load or initialize (musickiterror, a blocked CDN request, or a non-secure page origin). MusicKit requires localhost or HTTPS.';
          return null;
        }
      }
      try {
        await window.MusicKit.configure({
          developerToken: getDeveloperToken(),
          app: { name: 'PACELOCK', build: '1.0.0' },
        });
        this.kit = window.MusicKit.getInstance();
      } catch (err) {
        this.kitError = `MusicKit.configure() failed: ${
          err instanceof Error ? err.message : String(err)
        }. If the token itself is being rejected, the usual causes are a signing key without MusicKit enabled, a wrong team ID, or an expired token.`;
        return null;
      }
      if (!this.kit) {
        this.kitError =
          'MusicKit.configure() completed but getInstance() returned nothing.';
        return null;
      }
      return this.kit;
    } catch (err) {
      this.kitError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  // --- auth ---

  public async connect(): Promise<AuthState> {
    if (this.canUseMusicKit()) {
      const problem = developerTokenProblem(getDeveloperToken());
      if (problem) {
        throw new ProviderError('not_configured', `Apple Music: ${problem}`);
      }
      const kit = await this.ensureKit();
      if (!kit) {
        throw new ProviderError(
          'unknown',
          `MusicKit could not load. ${this.kitError ?? 'No detail was reported by the library.'}`
        );
      }
      await kit.authorize();
      if (kit.canPlayCatalogContent === false) {
        throw new ProviderError(
          'not_premium',
          'This Apple Music account is authorized but cannot play catalog songs. That usually means there is no active Apple Music subscription on the account.'
        );
      }
      this.authState = {
        isConnected: true,
        isPremiumOrSubscribed: true,
        userDisplayName: 'Apple Music account',
        expiresAtMs: null,
      };
      this.emit();
      return this.authState;
    }
    // Native (and token-less web): catalog mode. Search and previews need
    // no account, so "connecting" simply enables them, and the UI says so.
    this.authState = {
      isConnected: true,
      isPremiumOrSubscribed: null,
      userDisplayName: 'Apple Music catalog',
      expiresAtMs: null,
    };
    this.emit();
    return this.authState;
  }

  public async disconnect(): Promise<void> {
    await this.pause().catch(() => {});
    if (this.kit?.isAuthorized) {
      await this.kit.unauthorize().catch(() => {});
    }
    this.authState = {
      isConnected: false,
      isPremiumOrSubscribed: null,
      userDisplayName: null,
      expiresAtMs: null,
    };
    this.emit();
  }

  public async getAuthState(): Promise<AuthState> {
    if (this.kit) {
      this.authState = {
        ...this.authState,
        isConnected: this.kit.isAuthorized || this.authState.isConnected,
      };
    }
    return this.authState;
  }

  // --- catalog ---

  public async search(
    query: string,
    limit = 15
  ): Promise<CanonicalTrack[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      return await searchItunes(q, limit);
    } catch (err) {
      throw new ProviderError(
        'network',
        err instanceof Error ? err.message : 'Apple catalog search failed.'
      );
    }
  }

  // --- playback ---

  public async playTrack(
    track: CanonicalTrack,
    positionMs = 0
  ): Promise<PlaybackKind> {
    this.currentTrack = track;
    const appleId = track.providerIds.apple;

    // Full-length path: MusicKit JS on web, when authorized.
    if (this.canUseMusicKit() && appleId) {
      const kit = await this.ensureKit();
      if (kit?.isAuthorized) {
        this.lastKitPlaybackError = null;
        const onPlaybackError = (event: unknown) => {
          this.lastKitPlaybackError = describeKitEvent(event);
        };
        kit.addEventListener?.('mediaPlaybackError', onPlaybackError);

        const waitForStart = async (
          ms: number
        ): Promise<'playing' | 'queued' | 'empty' | 'error'> => {
          const deadline = Date.now() + ms;
          while (Date.now() < deadline) {
            if (this.lastKitPlaybackError) return 'error';
            if (kit.isPlaying || kit.playbackState === 2) return 'playing';
            await new Promise((r) => setTimeout(r, 150));
          }
          if (this.lastKitPlaybackError) return 'error';
          if (kit.isPlaying || kit.playbackState === 2) return 'playing';
          const items =
            kit.queue?.items?.length ?? (kit.nowPlayingItem ? 1 : 0);
          return items > 0 ? 'queued' : 'empty';
        };

        const attempt = async (
          descriptor:
            | { song: string }
            | { songs: string[] }
            | { url: string }
        ): Promise<'playing' | 'queued' | 'empty' | 'error'> => {
          this.lastKitPlaybackError = null;
          await kit.setQueue({ ...descriptor, startPlaying: true });
          return waitForStart(3_500);
        };

        // Session diagnostics through MusicKit's own API: can this session
        // even see the song in the catalog, and can it read the user
        // library (a working proxy for a playback-capable user token)?
        // The summary rides along in any failure message below.
        let diag = 'session check unavailable';
        try {
          const parts: string[] = [
            `storefront=${kit.storefrontId ?? 'unknown'}`,
          ];
          if (kit.api?.music) {
            try {
              const res = (await kit.api.music(
                `/v1/catalog/${kit.storefrontId ?? 'us'}/songs/${appleId}`
              )) as { data?: unknown[] };
              parts.push(
                `catalog fetch OK (${res?.data?.length ?? '?'} item)`
              );
            } catch (e) {
              parts.push(
                `catalog fetch FAILED: ${e instanceof Error ? e.message : String(e)}`
              );
            }
            try {
              await kit.api.music('/v1/me/library/songs?limit=1');
              parts.push('library fetch OK (user token works)');
            } catch (e) {
              parts.push(
                `library fetch FAILED: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          } else {
            parts.push('instance exposes no api.music');
          }
          diag = parts.join(' · ');
        } catch {
          // Diagnostics must never block the playback attempt itself.
        }

        try {
          let outcome = await attempt({ song: appleId });
          if (outcome === 'empty') {
            // Same call, alternate documented descriptor shape. If this
            // one queues, the singular form was the problem; if it is
            // also empty, the problem is in the session, not the call.
            outcome = await attempt({ songs: [appleId] });
          }
          if (outcome === 'empty' && track.appleMusicUrl) {
            // Third form: queue by the song's canonical web URL.
            outcome = await attempt({ url: track.appleMusicUrl });
          }
          if (outcome === 'error') {
            throw new ProviderError(
              'unknown',
              `Apple Music playback error: ${this.lastKitPlaybackError}`
            );
          }
          if (outcome === 'empty') {
            throw new ProviderError(
              'track_unavailable',
              `MusicKit produced an empty queue for song ID ${appleId} with every queue descriptor form and reported no playback error. Session check: ${diag}.`
            );
          }
          if (outcome === 'queued') {
            await kit.play();
            const second = await waitForStart(2_000);
            if (second === 'error') {
              throw new ProviderError(
                'unknown',
                `Apple Music playback error: ${this.lastKitPlaybackError}`
              );
            }
            if (second !== 'playing') {
              throw new ProviderError(
                'unknown',
                `MusicKit queued the song but playback never started (playbackState=${kit.playbackState ?? 'unknown'}, isPlaying=false, queue items=${kit.queue?.items?.length ?? 'unknown'}, no error event).`
              );
            }
          }
          if (positionMs > 0) {
            await kit.seekToTime(positionMs / 1000);
          }
          this.kind = 'musickit';
          this.emit();
          return 'musickit';
        } catch (err) {
          if (err instanceof ProviderError) throw err;
          throw new ProviderError(
            'unknown',
            `MusicKit playback failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        } finally {
          kit.removeEventListener?.('mediaPlaybackError', onPlaybackError);
        }
      }
    }

    // Everywhere else: the official preview stream, in-app.
    const previewUrl = await findPreviewUrl(track);
    if (!previewUrl) {
      throw new ProviderError(
        'track_unavailable',
        'No preview stream is available for this track.'
      );
    }
    await audioEngine.playUrl(
      previewUrl,
      appleId ?? track.title,
      Math.min(positionMs, 25_000)
    );
    this.kind = 'preview';
    this.emit();
    return 'preview';
  }

  public async pause(): Promise<void> {
    if (this.kind === 'musickit') {
      this.kit?.pause();
    } else if (this.kind === 'preview') {
      audioEngine.pause();
    }
    this.emit();
  }

  public async resume(): Promise<void> {
    if (this.kind === 'musickit') {
      await this.kit?.play();
    } else if (this.kind === 'preview') {
      audioEngine.resume();
    }
    this.emit();
  }

  public async seek(positionMs: number): Promise<void> {
    if (this.kind === 'musickit' && this.kit) {
      await this.kit.seekToTime(positionMs / 1000);
    } else if (this.kind === 'preview') {
      await audioEngine.seek(Math.min(positionMs, 29_000));
    }
    this.emit();
  }

  public async getSnapshot(): Promise<PlaybackSnapshot> {
    if (this.kind === 'musickit' && this.kit) {
      return {
        trackKey: this.currentTrack?.providerIds.apple ?? null,
        isPlaying: !!this.kit.isPlaying || this.kit.playbackState === 2,
        isBuffering: false,
        positionMs: Math.round((this.kit.currentPlaybackTime ?? 0) * 1000),
        durationMs: this.kit.currentPlaybackDuration
          ? Math.round(this.kit.currentPlaybackDuration * 1000)
          : (this.currentTrack?.durationMs ?? null),
        kind: 'musickit',
      };
    }
    if (this.kind === 'preview') {
      const snap = audioEngine.snapshot();
      return { ...snap, kind: 'preview' };
    }
    return {
      trackKey: this.currentTrack?.providerIds.apple ?? null,
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

export const appleMusicProvider = new AppleMusicProvider();
