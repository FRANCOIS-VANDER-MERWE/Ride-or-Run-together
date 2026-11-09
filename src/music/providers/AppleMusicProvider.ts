// src/music/providers/AppleMusicProvider.ts
// Apple Music integration, split honestly by platform:
//
// - Search (all platforms): the dedicated Apple Music API
//   (api.music.apple.com catalog search) with the MusicKit developer
//   token. Tracks are real catalog resources: the IDs used for queueing
//   are the catalog playParams IDs, and preview URLs come from the
//   resource itself.
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
import {
  findApplePreviewUrl,
  getAppleDeveloperToken as getDeveloperToken,
  searchAppleCatalog,
} from '../appleMusicApi';
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
  setQueue(options: {
    song?: string;
    songs?: string[];
    url?: string;
    startPlaying?: boolean;
    startTime?: number;
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
        sourceType?: number;
      }): Promise<unknown>;
      getInstance(): MusicKitInstance;
    };
  }
}

/**
 * MusicKit JS environment handling under Expo web.
 *
 * Expo/Metro define a `process` global in the browser. MusicKit JS was
 * built for plain web pages, which have no `process` at all. With the
 * Expo global present, MusicKit loads (after the versions workaround),
 * authorizes, and serves API reads, but its playback path silently
 * never queues anything: empty queue, no error event, for catalog and
 * library songs alike. A clean-room page at the same origin with the
 * same token and no `process` global plays both immediately (verified
 * in the field, Nov 2 2026). Hiding the global only around setQueue()
 * does NOT help, so the environment is captured while the library
 * loads, configures, or authorizes.
 *
 * Strategy: remove `process` from the global scope before the MusicKit
 * script is injected, keep it hidden through configure() and the first
 * authorize(), then restore it so the rest of the app keeps its env.
 */
let savedProcess: unknown;
let processHidden = false;

function hideProcessGlobal(): void {
  try {
    const g = globalThis as { process?: unknown };
    if (!processHidden && typeof g.process !== 'undefined') {
      savedProcess = g.process;
      g.process = undefined;
      processHidden = true;
    }
  } catch {
    // Not fatal; loadKit still reports precise errors.
  }
}

function restoreProcessGlobal(): void {
  try {
    if (processHidden) {
      (globalThis as { process?: unknown }).process = savedProcess;
      processHidden = false;
    }
  } catch {
    // Ignore: worst case the page keeps running without the shim.
  }
}

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
    hideProcessGlobal();
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
          restoreProcessGlobal();
          return null;
        }
      }
      try {
        const configured = await window.MusicKit.configure({
          developerToken: getDeveloperToken(),
          app: { name: 'PACELOCK', build: '1.0.0' },
          // 8 = WEBPLAYER. The working v3 web players set this; without it
          // the instance is not identified as a playback client.
          sourceType: 8,
        });
        const fromConfigure = configured as MusicKitInstance | null;
        this.kit =
          fromConfigure && typeof fromConfigure.setQueue === 'function'
            ? fromConfigure
            : window.MusicKit.getInstance();
      } catch (err) {
        this.kitError = `MusicKit.configure() failed: ${
          err instanceof Error ? err.message : String(err)
        }. If the token itself is being rejected, the usual causes are a signing key without MusicKit enabled, a wrong team ID, or an expired token.`;
        restoreProcessGlobal();
        return null;
      }
      if (!this.kit) {
        this.kitError =
          'MusicKit.configure() completed but getInstance() returned nothing.';
        restoreProcessGlobal();
        return null;
      }
      return this.kit;
    } catch (err) {
      this.kitError = err instanceof Error ? err.message : String(err);
      restoreProcessGlobal();
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
      // Load, configure, and authorize all happened with no `process`
      // global in scope (see hideProcessGlobal). Restore it now so the
      // rest of the app gets its Expo env back.
      restoreProcessGlobal();
      // Note: MusicKit JS exposes no canPlayCatalogContent (that is an
      // iOS MusicSubscription concept; the property is undefined here,
      // verified in the field). Web playback entitlement is inferred
      // from authorization plus a working library probe instead.
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
      return await searchAppleCatalog(
        q,
        limit,
        this.kit?.storefrontId ?? 'us'
      );
    } catch (err) {
      if (err instanceof ProviderError) throw err;
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
          await kit.setQueue({
            ...descriptor,
            startPlaying: true,
            startTime: positionMs / 1000,
          });
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
              // MusicKit JS v3 wraps responses: {request, response, data}
              // where data is the response BODY, so resources live at
              // body.data. (Field-verified; earlier probes misread this.)
              const res = (await kit.api.music(
                `/v1/catalog/${kit.storefrontId ?? 'us'}/songs/${appleId}`
              )) as { data?: { data?: unknown[] } };
              const count = Array.isArray(res?.data?.data)
                ? `${res.data.data.length} item`
                : res?.data
                  ? 'resource present'
                  : 'no data';
              parts.push(`catalog fetch OK (${count})`);
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
    restoreProcessGlobal();
    const previewUrl = await findApplePreviewUrl(track);
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
