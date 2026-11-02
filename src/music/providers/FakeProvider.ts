// src/music/providers/FakeProvider.ts
// Section 13 Task 1: Deterministic FakeProvider for testing Session UI, Clock Sync, and Intensity Engine
// Plays nothing, logs calls, and accurately simulates playback position & error conditions.

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

export class FakeProvider implements MusicProvider {
  public readonly id: ProviderId;
  public readonly capabilities: ProviderCapabilities;

  private authState: AuthState = {
    isConnected: true,
    isPremiumOrSubscribed: true,
    userDisplayName: 'Alex Rivera (Test Runner)',
    expiresAtMs: Date.now() + 3600_000,
  };

  private currentTrackId: string | null = null;
  private isPlaying = false;
  private basePositionMs = 0;
  private baseTimestampMs = Date.now();
  private durationMs: number | null = 214000;
  private rate = 1.0;
  private volume = 1.0;

  private stateListeners = new Set<(snap: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();
  public callLog: string[] = [];

  constructor(
    id: ProviderId = 'spotify',
    capabilitiesOverride?: Partial<ProviderCapabilities>
  ) {
    this.id = id;
    this.capabilities = {
      canPlay: true,
      canSeek: true,
      canSetRate: id === 'local',
      canCrossfade: id === 'local',
      requiresPremium: id !== 'local',
      requiresExternalApp: id === 'spotify',
      ...capabilitiesOverride,
    };
  }

  private logCall(entry: string) {
    this.callLog.unshift(`${new Date().toISOString().slice(11, 23)} [${this.id}] ${entry}`);
    if (this.callLog.length > 30) this.callLog.pop();
  }

  public async connect(): Promise<AuthState> {
    this.logCall('connect()');
    this.authState = {
      ...this.authState,
      isConnected: true,
    };
    return this.authState;
  }

  public async disconnect(): Promise<void> {
    this.logCall('disconnect()');
    this.isPlaying = false;
    this.authState = {
      ...this.authState,
      isConnected: false,
    };
  }

  public async getAuthState(): Promise<AuthState> {
    return this.authState;
  }

  public async prepare(): Promise<void> {
    this.logCall('prepare()');
  }

  public async search(query: string, limit = 10): Promise<CanonicalTrack[]> {
    this.logCall(`search("${query}", ${limit})`);
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
    this.logCall(`resolve(${track.isrc})`);
    const res = await trackResolver.resolveTrackForProviders(track, [this.id]);
    return res.resolvedTrack;
  }

  public async play(providerTrackId: string, positionMs: number): Promise<void> {
    if (!this.authState.isConnected) {
      throw new ProviderError('not_connected', `${this.id} provider is not connected`);
    }
    if (this.capabilities.requiresPremium && this.authState.isPremiumOrSubscribed === false) {
      throw new ProviderError('not_premium', `${this.id} playback control requires Premium`);
    }

    this.logCall(`play("${providerTrackId}", ${Math.round(positionMs)}ms)`);
    this.currentTrackId = providerTrackId;
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    this.isPlaying = true;
    this.emitStateChange();
  }

  public async pause(): Promise<void> {
    this.logCall('pause()');
    if (this.isPlaying) {
      this.basePositionMs = this.computeCurrentPositionMs();
      this.baseTimestampMs = Date.now();
      this.isPlaying = false;
      this.emitStateChange();
    }
  }

  public async resume(): Promise<void> {
    this.logCall('resume()');
    if (!this.isPlaying) {
      this.baseTimestampMs = Date.now();
      this.isPlaying = true;
      this.emitStateChange();
    }
  }

  public async seek(positionMs: number): Promise<void> {
    this.logCall(`seek(${Math.round(positionMs)}ms)`);
    this.basePositionMs = Math.max(0, Math.round(positionMs));
    this.baseTimestampMs = Date.now();
    this.emitStateChange();
  }

  public async setRate(rate: number): Promise<void> {
    if (!this.capabilities.canSetRate) {
      throw new ProviderError(
        'unknown',
        `Provider "${this.id}" does not support playback rate changes (capabilities.canSetRate = false)`
      );
    }
    this.logCall(`setRate(${rate.toFixed(3)}x)`);
    this.basePositionMs = this.computeCurrentPositionMs();
    this.baseTimestampMs = Date.now();
    this.rate = rate;
    this.emitStateChange();
  }

  public async setVolume(volumeRatio: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volumeRatio));
    this.logCall(`setVolume(${Math.round(this.volume * 100)}%)`);
  }

  private computeCurrentPositionMs(): number {
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
      positionMs: this.computeCurrentPositionMs(),
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

  public triggerTrackEnded(): void {
    this.isPlaying = false;
    this.endedListeners.forEach((cb) => cb());
  }

  private emitStateChange(): void {
    const snap: PlaybackSnapshot = {
      providerTrackId: this.currentTrackId,
      isPlaying: this.isPlaying,
      positionMs: this.computeCurrentPositionMs(),
      snapshotAtLocalMs: Date.now(),
      durationMs: this.durationMs,
      rate: this.rate,
    };
    this.stateListeners.forEach((cb) => cb(snap));
  }
}

