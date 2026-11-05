// src/music/spotifyAppRemote.ts
// Native-only transport for Spotify App Remote, via the community Expo
// module @wwdrew/expo-spotify-sdk, which wraps Spotify's official iOS
// and Android App Remote libraries.
//
// What this is: an IPC remote control for the Spotify app installed on
// the SAME phone. The Spotify app does the playing; this module sends
// commands and reads player state. No audio ever enters PACELOCK, and
// there is no music tempo control (podcast speed only, not exposed).
//
// Why it exists: the Web API playback path dead ends whenever the user
// has no active Spotify Connect device. App Remote talks to the Spotify
// app on this device directly, can wake it (authorizeAndPlay), plays
// downloaded tracks, and pushes real-time player state.
//
// The SDK is loaded lazily and defensively: on web, in Expo Go, or in
// any build without the native module, loadSdk() returns null and the
// Spotify provider falls back to its Web API and preview paths.

import { Platform } from 'react-native';

declare function require(moduleName: string): unknown;

export interface AppRemotePlayerState {
  trackUri: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number | null;
}

interface SdkPlayerState {
  track?: { uri?: string; duration?: number } | null;
  playbackPosition?: number;
  isPaused?: boolean;
}

let sdkCache: unknown;

function loadSdk(): any | null {
  if (Platform.OS === 'web') return null;
  if (sdkCache !== undefined) return sdkCache as any | null;
  try {
    sdkCache = require('@wwdrew/expo-spotify-sdk');
  } catch {
    sdkCache = null;
  }
  return sdkCache as any | null;
}

export function isAppRemoteAvailable(): boolean {
  return loadSdk() != null;
}

function isConnectionFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? '';
  const message = (e?.message ?? '').toLowerCase();
  return (
    code === 'CONNECTION_FAILED' ||
    message.includes('connection refused') ||
    message.includes('not connected') ||
    message.includes('could not connect')
  );
}

function normalize(state: SdkPlayerState | null | undefined): AppRemotePlayerState | null {
  if (!state) return null;
  return {
    trackUri: state.track?.uri ?? null,
    isPlaying: !state.isPaused,
    positionMs: state.playbackPosition ?? 0,
    durationMs: state.track?.duration ?? null,
  };
}

class SpotifyAppRemoteTransport {
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private subscription: { remove(): void } | null = null;

  private sdk(): any {
    const sdk = loadSdk();
    if (!sdk) {
      throw new Error(
        'App Remote is not available in this build (native module missing).'
      );
    }
    return sdk;
  }

  async connect(accessToken: string): Promise<void> {
    const sdk = this.sdk();
    if (this.connected || sdk.AppRemote.isConnected()) {
      this.connected = true;
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        await sdk.AppRemote.connect(accessToken);
        this.connected = true;
      })().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }

  /**
   * Play a track URI on the Spotify app on this phone. When Spotify is
   * suspended and the plain connection fails, fall back to
   * authorizeAndPlay, which wakes Spotify (brief app switch), starts
   * the track, and connects.
   */
  async play(accessToken: string, uri: string): Promise<void> {
    const sdk = this.sdk();
    const branded = sdk.SpotifyURI.from(uri);
    try {
      await this.connect(accessToken);
      await sdk.Player.play(branded);
    } catch (err) {
      if (!isConnectionFailure(err)) throw err;
      this.connected = false;
      await sdk.AppRemote.authorizeAndPlay(accessToken, branded);
      this.connected = true;
    }
  }

  async pause(): Promise<void> {
    await this.sdk().Player.pause();
  }

  async resume(): Promise<void> {
    await this.sdk().Player.resume();
  }

  async seek(positionMs: number): Promise<void> {
    await this.sdk().Player.seekTo(Math.round(positionMs));
  }

  async queue(uri: string): Promise<void> {
    const sdk = this.sdk();
    await sdk.Player.queue(sdk.SpotifyURI.from(uri));
  }

  async getState(): Promise<AppRemotePlayerState | null> {
    try {
      const state = (await this.sdk().Player.getPlayerState()) as SdkPlayerState;
      return normalize(state);
    } catch {
      return null;
    }
  }

  /** Subscribe to pushed player state. Returns an unsubscribe function. */
  onState(cb: (state: AppRemotePlayerState) => void): () => void {
    const sdk = loadSdk();
    if (!sdk) return () => {};
    if (this.subscription) {
      // One shared subscription; the provider is the only consumer.
      this.stateCallback = cb;
      return () => {};
    }
    this.stateCallback = cb;
    this.subscription = sdk.Player.addListener(
      'playerStateChange',
      (state: SdkPlayerState) => {
        const normalized = normalize(state);
        if (normalized && this.stateCallback) this.stateCallback(normalized);
      }
    );
    return () => {
      this.subscription?.remove();
      this.subscription = null;
      this.stateCallback = null;
    };
  }

  private stateCallback: ((state: AppRemotePlayerState) => void) | null = null;

  async disconnect(): Promise<void> {
    const sdk = loadSdk();
    this.subscription?.remove();
    this.subscription = null;
    this.stateCallback = null;
    this.connected = false;
    if (sdk) {
      try {
        await sdk.AppRemote.disconnect();
      } catch {
        // Already gone; nothing to clean up.
      }
    }
  }
}

export const spotifyAppRemote = new SpotifyAppRemoteTransport();
