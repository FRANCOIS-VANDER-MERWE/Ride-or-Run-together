// src/music/audioEngine.ts
// The one in-app audio player, built on expo-audio (part of the Expo SDK,
// so it works in Expo Go and dev builds on iOS, Android, and web).
//
// It plays direct audio URLs: in practice those are official preview
// streams. Full-length catalog playback cannot happen inside this app for
// either streaming service (Spotify gives third-party apps no audio, and
// Apple Music full playback needs a native MusicKit module), which is why
// providers pair this engine with their remote / MusicKit paths and fall
// back to it for sound.

import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

import { PlaybackSnapshot } from './types';

class AudioEngine {
  private player: AudioPlayer | null = null;
  private audioModeReady = false;
  private currentUrl: string | null = null;
  private currentKey: string | null = null;
  private stateListeners = new Set<() => void>();
  private endedListeners = new Set<() => void>();

  private ensurePlayer(): AudioPlayer {
    if (this.player) return this.player;
    const player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.didJustFinish) {
        this.endedListeners.forEach((cb) => cb());
      }
      this.stateListeners.forEach((cb) => cb());
    });
    this.player = player;
    return player;
  }

  private async ensureAudioMode(): Promise<void> {
    if (this.audioModeReady) return;
    this.audioModeReady = true;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch {
      // If the platform rejects a mode field, playback still works with
      // defaults; do not block playing on this.
    }
  }

  public async playUrl(
    url: string,
    trackKey: string,
    positionMs = 0
  ): Promise<void> {
    await this.ensureAudioMode();
    const player = this.ensurePlayer();
    this.currentUrl = url;
    this.currentKey = trackKey;
    player.replace(url);
    if (positionMs > 0) {
      // The source needs a moment to load before a seek lands; previews are
      // ~30s, so positions are clamped by callers.
      setTimeout(() => {
        player.seekTo(positionMs / 1000).catch(() => {});
      }, 400);
    }
    player.play();
    this.stateListeners.forEach((cb) => cb());
  }

  public pause(): void {
    this.player?.pause();
  }

  public resume(): void {
    this.player?.play();
  }

  public async seek(positionMs: number): Promise<void> {
    if (!this.player) return;
    await this.player.seekTo(positionMs / 1000);
  }

  public setVolume(ratio: number): void {
    if (this.player) {
      this.player.volume = Math.max(0, Math.min(1, ratio));
    }
  }

  public getCurrentKey(): string | null {
    return this.currentKey;
  }

  public snapshot(): PlaybackSnapshot {
    const p = this.player;
    if (!p || !this.currentKey) {
      return {
        trackKey: null,
        isPlaying: false,
        isBuffering: false,
        positionMs: 0,
        durationMs: null,
        kind: null,
      };
    }
    return {
      trackKey: this.currentKey,
      isPlaying: p.playing,
      isBuffering: p.isBuffering,
      positionMs: Math.round(p.currentTime * 1000),
      durationMs: p.duration > 0 ? Math.round(p.duration * 1000) : null,
      kind: 'preview',
    };
  }

  public onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  public onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => {
      this.endedListeners.delete(cb);
    };
  }
}

export const audioEngine = new AudioEngine();
