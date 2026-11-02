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
  setQueue(options: { song?: string; startPlaying?: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seekToTime(seconds: number): Promise<void>;
  currentPlaybackTime?: number;
  currentPlaybackDuration?: number;
  isPlaying?: boolean;
}

declare global {
  interface Window {
    MusicKit?: {
      configure(config: {
        developerToken: string;
        app: { name: string; build: string };
      }): Promise<MusicKitInstance>;
      getInstance(): MusicKitInstance;
    };
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
        try {
          if (!window.MusicKit) {
            const loaded = new Promise<boolean>((resolve) => {
              // Documented v3 signal that the library has initialized.
              document.addEventListener(
                'musickitloaded',
                () => resolve(true),
                { once: true }
              );
              const script = document.createElement('script');
              script.src =
                'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
              script.async = true;
              script.onload = () => resolve(!!window.MusicKit);
              script.onerror = () => resolve(false);
              document.head.appendChild(script);
              // If the page had already finished loading when the script
              // was injected, MusicKit v3 may sit waiting for this event.
              setTimeout(() => {
                if (!window.MusicKit) {
                  document.dispatchEvent(new Event('DOMContentLoaded'));
                }
              }, 300);
            });
            const ok = await loaded;
            const deadline = Date.now() + 10_000;
            while (!window.MusicKit && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 100));
            }
            if (!window.MusicKit) {
              this.kitError = ok
                ? 'the MusicKit library loaded but never initialized (window.MusicKit stayed undefined). This can happen when the page is not served from localhost or HTTPS.'
                : 'the MusicKit script failed to load from js-cdn.music.apple.com (network or blocker).';
              return null;
            }
          }
          try {
            this.kit = await window.MusicKit.configure({
              developerToken: getDeveloperToken(),
              app: { name: 'PACELOCK', build: '1.0.0' },
            });
          } catch (err) {
            this.kitError = `MusicKit.configure() rejected the developer token: ${
              err instanceof Error ? err.message : String(err)
            }. The usual causes are a token signed with a key that does not have MusicKit enabled, a wrong team ID, or an expired token.`;
            return null;
          }
          return this.kit;
        } catch (err) {
          this.kitError =
            err instanceof Error ? err.message : String(err);
          return null;
        }
      })();
    }
    return this.kitLoadPromise;
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
        try {
          await kit.setQueue({ song: appleId, startPlaying: false });
          if (positionMs > 0) {
            await kit.seekToTime(positionMs / 1000);
          }
          await kit.play();
          this.kind = 'musickit';
          this.emit();
          return 'musickit';
        } catch (err) {
          if (__DEV__) {
            console.log('[Apple] MusicKit play failed, trying preview:', err);
          }
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
        isPlaying: !!this.kit.isPlaying,
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
