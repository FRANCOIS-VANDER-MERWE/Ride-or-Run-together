// src/music/providers/LocalFileProvider.ts
// Section 6.4 & 9.4: Local files implementation (`LocalFileProvider` — djay pitch-preserving time-stretch demo)
// - Plays royalty-free audio loops we own through our pitch-locked DSP engine (`localPitchStretchAudioEngine`)
// - Capabilities: `canSetRate: true` (full range, pitch preserved), `requiresPremium: false`, `canCrossfade: true`
// - Demonstrates genuine pitch-preserving tempo stretch (`rate = targetBpm / nativeBpm`) side-by-side with catalog track selection

import { localPitchStretchAudioEngine } from '../localAudioEngine';
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

export class LocalFileProvider implements MusicProvider {
  public readonly id: ProviderId = 'local';
  public readonly capabilities: ProviderCapabilities = {
    canPlay: true,
    canSeek: true,
    canSetRate: true, // Full pitch-preserving time-stretch via SoundTouch/RubberBand DSP
    canCrossfade: true,
    requiresPremium: false,
    requiresExternalApp: false,
  };

  private authState: AuthState = {
    isConnected: true,
    isPremiumOrSubscribed: true,
    userDisplayName: 'Local DSP Engine (SoundTouch Pitch-Lock)',
    expiresAtMs: null,
  };

  private currentTrackId: string | null = 'local:asset:hyperdrive_cadence_170.wav';
  private isPlaying = true;
  private basePositionMs = 84000;
  private baseTimestampMs = Date.now();
  private durationMs: number | null = 214000;
  private rate = 1.0;

  private stateListeners = new Set<(snap: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();

  public async connect(): Promise<AuthState> {
    return this.authState;
  }

  public async disconnect(): Promise<void> {
    this.isPlaying = false;
    localPitchStretchAudioEngine.setPlaying(false);
  }

  public async getAuthState(): Promise<AuthState> {
    return this.authState;
  }

  public async prepare(): Promise<void> {
    if (this.currentTrackId) {
      localPitchStretchAudioEngine.setTrack(this.currentTrackId);
    }
    localPitchStretchAudioEngine.setRate(this.rate);
    localPitchStretchAudioEngine.setPlaying(this.isPlaying);
  }

  public async search(query: string, limit = 10): Promise<CanonicalTrack[]> {
    const all = trackResolver.getAllCatalogTracks();
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, limit);
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
    const res = await trackResolver.resolveTrackForProviders(track, ['local']);
    return res.resolvedTrack;
  }

  public async play(providerTrackId: string, positionMs: number): Promise<void> {
    if (!providerTrackId) {
      throw new ProviderError('track_unavailable', 'Local demo file not bundled');
    }
    this.currentTrackId = providerTrackId;
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    this.isPlaying = true;

    localPitchStretchAudioEngine.setTrack(providerTrackId);
    localPitchStretchAudioEngine.setPlaying(true);

    this.emitStateChange();
  }

  public async pause(): Promise<void> {
    if (this.isPlaying) {
      this.basePositionMs = this.computePositionMs();
      this.baseTimestampMs = Date.now();
      this.isPlaying = false;
      localPitchStretchAudioEngine.setPlaying(false);
      this.emitStateChange();
    }
  }

  public async resume(): Promise<void> {
    if (!this.isPlaying) {
      this.baseTimestampMs = Date.now();
      this.isPlaying = true;
      localPitchStretchAudioEngine.setPlaying(true);
      this.emitStateChange();
    }
  }

  public async seek(positionMs: number): Promise<void> {
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    this.emitStateChange();
  }

  /**
   * Section 6.4 & 9.4: Set pitch-preserved time-stretch rate (`targetBpm / nativeBpm`).
   */
  public async setRate(rate: number): Promise<void> {
    const clamped = Math.max(0.75, Math.min(1.35, rate));
    this.basePositionMs = this.computePositionMs();
    this.baseTimestampMs = Date.now();
    this.rate = Number(clamped.toFixed(3));
    localPitchStretchAudioEngine.setRate(this.rate);
    this.emitStateChange();
  }

  /**
   * Section 14.4: Duck audio volume when Walkie-Talkie PTT is open.
   */
  public async setVolume(volumeRatio: number): Promise<void> {
    localPitchStretchAudioEngine.setVolumeRatio(volumeRatio);
  }

  private computePositionMs(): number {
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
