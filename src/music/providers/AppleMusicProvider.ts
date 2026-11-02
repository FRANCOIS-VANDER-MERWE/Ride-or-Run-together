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
            await new Promise<void>((resolve, reject) => {
              const script = document.createElement('script');
              script.src =
                'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
              script.async = true;
              script.onload = () => resolve();
              script.onerror = () =>
                reject(new Error('MusicKit JS failed to load'));
              document.head.appendChild(script);
            });
            // MusicKit v3 configures from a DOMContentLoaded listener when
            // loaded late; dispatching it after a dynamic load is the
            // documented workaround.
            document.dispatchEvent(new Event('DOMContentLoaded'));
          }
          const deadline = Date.now() + 10_000;
          while (!window.MusicKit && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!window.MusicKit) return null;
          this.kit = await window.MusicKit.configure({
            developerToken: getDeveloperToken(),
            app: { name: 'PACELOCK', build: '1.0.0' },
          });
          return this.kit;
        } catch {
          return null;
        }
      })();
    }
    return this.kitLoadPromise;
  }

  // --- auth ---

  public async connect(): Promise<AuthState> {
    if (this.canUseMusicKit()) {
      const kit = await this.ensureKit();
      if (!kit) {
        throw new ProviderError(
          'unknown',
          'MusicKit could not load. Check the developer token and try again.'
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
