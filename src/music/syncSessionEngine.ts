// src/music/syncSessionEngine.ts
// Authoritative Sync Session State Machine + Client Coordinator
// Implements Sections 4, 5, 6.1, 7 (7.1-7.7), 8, 9, 11, 12, and 14 of the Group Music Sync spec.

import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { ClockSync } from './clockSync';
import {
  classifyBpmBucket,
  IntensityEngine,
  MemberIntensitySample,
} from './intensityEngine';
import { localPitchStretchAudioEngine } from './localAudioEngine';
import { AppleMusicProvider } from './providers/AppleMusicProvider';
import { FakeProvider } from './providers/FakeProvider';
import { LocalFileProvider } from './providers/LocalFileProvider';
import { SpotifyProvider } from './providers/SpotifyProvider';
import { syncTransport } from './syncServerTransport';
import { CURATED_ISRC_CATALOG, trackResolver } from './trackResolver';
import {
  CanonicalTrack,
  MemberPlaybackStatus,
  MemberState,
  MusicProvider,
  PlaybackSnapshot,
  PlayEventPayload,
  ProviderId,
  QueueItem,
  SessionState,
  WireProtocolLogEntry,
} from './types';

function formatProtocolTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export class GroupMusicSyncCoordinator {
  public readonly clock = new ClockSync();
  public readonly intensity = new IntensityEngine();

  private providers: Record<ProviderId, MusicProvider> = {
    spotify: new SpotifyProvider(),
    apple: new AppleMusicProvider(),
    local: new LocalFileProvider(),
  };
  public readonly fakeProvider = new FakeProvider('spotify');

  private activeProviderId: ProviderId = 'spotify';
  private lastAppliedSequence = 0;

  private state: SessionState;
  private members: MemberState[];
  private wireLogs: WireProtocolLogEntry[] = [];
  private scheduledPlayTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledPlayTargetServerMs: number | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    const initialQueue: QueueItem[] = CURATED_ISRC_CATALOG.map((item, idx) => {
      const resolution: QueueItem['resolution'] = {
        spotify: item.providerIds.spotify ? 'resolved' : 'unavailable',
        apple: item.providerIds.apple ? 'resolved' : 'unavailable',
        local: item.providerIds.local ? 'resolved' : 'unavailable',
      };
      return {
        queueItemId: `q-${idx + 1}-${item.isrc.toLowerCase()}`,
        addedByUserId: idx === 0 ? 'athlete-you' : 'athlete-maya',
        track: {
          isrc: item.isrc,
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverUrl: item.coverUrl,
          durationMs: item.durationMs,
          bpm: item.bpm,
          bpmSource: item.bpmSource,
          explicit: item.explicit,
          providerIds: { ...item.providerIds },
        },
        resolution,
        resolutionNotes: item.providerNotes ? { ...item.providerNotes } : undefined,
      };
    });

    const initialStartedAt = Date.now() - 84_000;

    this.state = {
      sessionId: 'sf-884-pack-tempo',
      joinCode: 'PACE-884',
      leaderUserId: 'athlete-you',
      queue: initialQueue,
      currentQueueItemId: initialQueue[0].queueItemId,
      trackStartedAtServerMs: initialStartedAt,
      pausedAtPositionMs: null,
      isPlaying: true,
      sequence: 42,
      intensityMode: 'auto_bpm',
      targetBpm: 170,
      currentBucket: 'push',
    };

    this.lastAppliedSequence = 42;

    this.members = [
      {
        userId: 'athlete-you',
        displayName: 'Alex Rivera (You)',
        isSelf: true,
        provider: 'spotify',
        status: 'playing',
        lastPositionMs: 84_000,
        lastPositionAtServerMs: Date.now(),
        clockOffsetMs: 0,
        rttMs: 14,
        lastDriftMs: 0,
        playbackRate: 1.0,
        statusNote: 'Session Leader · Spotify App Remote',
      },
      {
        userId: 'athlete-maya',
        displayName: 'Maya Lin',
        provider: 'apple',
        status: 'playing',
        lastPositionMs: 84_012,
        lastPositionAtServerMs: Date.now(),
        clockOffsetMs: -4,
        rttMs: 19,
        lastDriftMs: 12,
        playbackRate: 1.0,
        statusNote: 'Apple MusicKit (iOS) · ISRC Matched',
      },
      {
        userId: 'athlete-marcus',
        displayName: 'Marcus Vance',
        provider: 'spotify',
        status: 'playing',
        lastPositionMs: 83_991,
        lastPositionAtServerMs: Date.now(),
        clockOffsetMs: 6,
        rttMs: 24,
        lastDriftMs: -9,
        playbackRate: 1.0,
        statusNote: 'Spotify Premium · App Remote',
      },
      {
        userId: 'athlete-elena',
        displayName: 'Elena Rostova',
        provider: 'apple',
        status: 'playing',
        lastPositionMs: 84_018,
        lastPositionAtServerMs: Date.now(),
        clockOffsetMs: -3,
        rttMs: 27,
        lastDriftMs: 18,
        playbackRate: 1.0,
        statusNote: 'Apple MusicKit (iOS) · ISRC Matched',
      },
      {
        userId: 'athlete-devon',
        displayName: 'Devon Brooks',
        provider: 'local',
        status: 'playing',
        lastPositionMs: 84_004,
        lastPositionAtServerMs: Date.now(),
        clockOffsetMs: 2,
        rttMs: 16,
        lastDriftMs: 4,
        playbackRate: 1.0,
        statusNote: 'Local DSP (SoundTouch Pitch-Lock)',
      },
    ];

    this.appendLog(
      'S->all',
      'session:snapshot',
      this.state.sequence,
      'Initial cross-provider session snapshot (Spotify + Apple Music + Local DSP)',
      JSON.stringify({
        sessionId: this.state.sessionId,
        sequence: this.state.sequence,
        trackStartedAtServerMs: this.state.trackStartedAtServerMs,
        queueCount: this.state.queue.length,
      })
    );

    this.runClockPing();
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  private appendLog(
    direction: WireProtocolLogEntry['direction'],
    eventName: WireProtocolLogEntry['eventName'],
    sequence: number | null,
    summary: string,
    payloadPreview: string
  ): void {
    this.wireLogs.unshift({
      id: `wire-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: formatProtocolTime(),
      direction,
      eventName,
      sequence,
      summary,
      payloadPreview,
    });
    if (this.wireLogs.length > 25) {
      this.wireLogs.pop();
    }
  }

  // ==========================================================================
  // Getters for UI & Session Layer
  // ==========================================================================

  public getSessionState(): SessionState {
    return this.state;
  }

  public getMembers(): MemberState[] {
    return this.members;
  }

  public getWireLogs(): WireProtocolLogEntry[] {
    return this.wireLogs;
  }

  public getActiveProvider(): MusicProvider {
    return this.providers[this.activeProviderId];
  }

  public getActiveProviderId(): ProviderId {
    return this.activeProviderId;
  }

  public getCurrentQueueItem(): QueueItem {
    return (
      this.state.queue.find(
        (q) => q.queueItemId === this.state.currentQueueItemId
      ) || this.state.queue[0]
    );
  }

  public getScheduledPlayCountdownMs(): number {
    if (!this.scheduledPlayTargetServerMs) return 0;
    return Math.max(
      0,
      this.scheduledPlayTargetServerMs - this.clock.serverNow()
    );
  }

  /**
   * Section 4: Position is NEVER broadcast continuously.
   * Position is derived: `expectedPositionMs = serverNow() - trackStartedAtServerMs`
   */
  public getDerivedPositionMs(): number {
    const currentItem = this.getCurrentQueueItem();
    const durationMs = currentItem?.track.durationMs || 214_000;

    if (!this.state.isPlaying || this.state.trackStartedAtServerMs === null) {
      return Math.min(durationMs, Math.max(0, this.state.pausedAtPositionMs || 0));
    }
    const elapsed = this.clock.serverNow() - this.state.trackStartedAtServerMs;
    return Math.min(durationMs, Math.max(0, Math.round(elapsed)));
  }

  // ==========================================================================
  // Section 7.3: Clock Sync Exchange (`clock:ping` -> `clock:pong`)
  // ==========================================================================

  public runClockPing(simulatedRttMs?: number): {
    rttMs: number;
    appliedOffsetMs: number;
  } {
    const ping = this.clock.createPing();
    const rtt = simulatedRttMs ?? 14 + Math.floor(Math.random() * 12);
    const serverReceivedAtMs = ping.clientSentAtMs + Math.round(rtt / 2);
    const serverSentAtMs = serverReceivedAtMs + 1;
    const clientReceivedAtMs = ping.clientSentAtMs + rtt;

    const result = this.clock.handlePong(
      {
        clientSentAtMs: ping.clientSentAtMs,
        serverReceivedAtMs,
        serverSentAtMs,
      },
      clientReceivedAtMs
    );

    this.members = this.members.map((m) =>
      m.isSelf
        ? {
            ...m,
            clockOffsetMs: result.appliedOffsetMs,
            rttMs: result.rttMs,
          }
        : m
    );

    this.appendLog(
      'S->member',
      'clock:pong',
      null,
      `NTP clock sync: RTT ${result.rttMs}ms, appliedOffset ${result.appliedOffsetMs >= 0 ? '+' : ''}${result.appliedOffsetMs}ms`,
      JSON.stringify({
        clientSentAtMs: ping.clientSentAtMs,
        serverReceivedAtMs,
        rttMs: result.rttMs,
        appliedOffsetMs: result.appliedOffsetMs,
      })
    );

    this.notify();
    return result;
  }

  // ==========================================================================
  // Provider Switching (Spotify <-> Apple Music <-> Local DJ Stretch)
  // ==========================================================================

  public async switchSelfProvider(newProviderId: ProviderId): Promise<void> {
    if (newProviderId === this.activeProviderId) return;
    await this.providers[this.activeProviderId].pause();
    this.activeProviderId = newProviderId;
    const provider = this.providers[newProviderId];
    await provider.prepare();

    const posMs = this.getDerivedPositionMs();
    const currentItem = this.getCurrentQueueItem();
    const myTrackId = currentItem.track.providerIds[newProviderId] || null;

    this.members = this.members.map((m) => {
      if (!m.isSelf) return m;
      if (!myTrackId) {
        return {
          ...m,
          provider: newProviderId,
          status: 'unavailable',
          playbackRate: 1.0,
          statusNote: 'Not on your service, back at the next song',
        };
      }
      return {
        ...m,
        provider: newProviderId,
        status: this.state.isPlaying ? 'playing' : 'paused',
        lastPositionMs: posMs,
        lastPositionAtServerMs: this.clock.serverNow(),
        playbackRate: this.computeMemberPlaybackRate(newProviderId, currentItem),
        statusNote:
          newProviderId === 'local'
            ? 'Local DSP (Pitch-Preserving Time-Stretch)'
            : newProviderId === 'apple'
            ? 'Apple MusicKit (ApplicationMusicPlayer)'
            : 'Spotify App Remote + PKCE',
      };
    });

    if (myTrackId && this.state.isPlaying) {
      await provider.play(myTrackId, posMs);
      const recRate = this.computeMemberPlaybackRate(newProviderId, currentItem);
      if (provider.capabilities.canSetRate) {
        await provider.setRate(recRate);
      }
      const localTrackId =
        currentItem.track.providerIds.local ||
        'local:asset:hyperdrive_cadence_170.wav';
      localPitchStretchAudioEngine.setTrack(localTrackId);
      localPitchStretchAudioEngine.setRate(
        provider.capabilities.canSetRate ? recRate : 1.0
      );
      localPitchStretchAudioEngine.setPlaying(true);
    } else if (!myTrackId) {
      localPitchStretchAudioEngine.setPlaying(false);
    }

    this.appendLog(
      'C->S',
      'session:join',
      this.state.sequence,
      `Switched active MusicProvider to "${newProviderId.toUpperCase()}" at ${Math.round(posMs / 1000)}s`,
      JSON.stringify({
        sessionId: this.state.sessionId,
        provider: newProviderId,
        perProviderTrackId: myTrackId,
      })
    );

    this.notify();
  }

  private computeMemberPlaybackRate(
    providerId: ProviderId,
    item: QueueItem
  ): number {
    const provider = this.providers[providerId];
    const { rate } = this.intensity.computeRecommendedRate(
      providerId,
      provider.capabilities,
      item.track.bpm,
      this.state.targetBpm
    );
    return rate;
  }

  // ==========================================================================
  // Section 6.1 & 7.1: Leader Play / Scheduled Future Start
  // ==========================================================================

  /**
   * Section 6.1 caller pattern:
   * Checks sequence idempotency, looks up perProviderTrackId, waits until `playAtServerMs`,
   * then calls `provider.play(myTrackId, evt.positionMs)`.
   */
  public async handlePlayEventOnClient(evt: PlayEventPayload): Promise<void> {
    if (evt.sequence <= this.lastAppliedSequence) {
      return; // Duplicate or stale sequence number — safely ignored (Section 5.3)
    }
    this.lastAppliedSequence = evt.sequence;

    const provider = this.getActiveProvider();
    const myTrackId = evt.perProviderTrackId;
    if (!myTrackId) {
      // Section 3 & 14: Fail per-member, not per-group
      this.members = this.members.map((m) =>
        m.isSelf
          ? {
              ...m,
              status: 'unavailable',
              statusNote: 'Not on your service, back at the next song',
            }
          : m
      );
      this.notify();
      return;
    }

    const delayMs = this.clock.toLocalTime(evt.playAtServerMs) - Date.now();
    this.scheduledPlayTargetServerMs = evt.playAtServerMs;
    this.notify();

    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
    }

    const waitMs = Math.max(0, Math.min(2500, delayMs));
    this.scheduledPlayTimer = setTimeout(async () => {
      this.scheduledPlayTargetServerMs = null;
      try {
        await provider.play(myTrackId, evt.positionMs);
        const currentItem = this.getCurrentQueueItem();
        const recRate = this.computeMemberPlaybackRate(
          provider.id,
          currentItem
        );
        if (provider.capabilities.canSetRate) {
          await provider.setRate(recRate);
        }
        const localTrackId =
          currentItem.track.providerIds.local ||
          'local:asset:hyperdrive_cadence_170.wav';
        localPitchStretchAudioEngine.setTrack(localTrackId);
        localPitchStretchAudioEngine.setRate(
          provider.capabilities.canSetRate ? recRate : 1.0
        );
        localPitchStretchAudioEngine.setPlaying(true);
      } catch {
        // Handled via member status
      }
      this.notify();
    }, waitMs);
  }

  /**
   * Section 5.1 & 7.1: `leader:play` -> Server schedules `playback:play` in the future
   * (`serverNow + 1500` by default, `+ 2000` if any member's RTT > 500 ms).
   */
  public async leaderPlay(
    queueItemId?: string,
    positionMs?: number,
    reason = 'leader:play'
  ): Promise<PlayEventPayload> {
    const targetItemId =
      queueItemId ||
      this.state.currentQueueItemId ||
      this.state.queue[0].queueItemId;
    const item =
      this.state.queue.find((q) => q.queueItemId === targetItemId) ||
      this.state.queue[0];

    const startPosMs =
      typeof positionMs === 'number'
        ? Math.max(0, Math.round(positionMs))
        : this.state.pausedAtPositionMs ?? 0;

    const maxMemberRtt = Math.max(...this.members.map((m) => m.rttMs), 20);
    // Section 5.3: playAtServerMs is serverNow + 1500 by default, + 2000 if any member RTT > 500 ms
    const leadWindowMs = maxMemberRtt > 500 ? 2000 : 1500;
    const serverNow = this.clock.serverNow();
    const playAtServerMs = serverNow + leadWindowMs;

    const nextSeq = this.state.sequence + 1;

    // Server updates authoritative state (Section 7.1 step 2)
    this.state = {
      ...this.state,
      currentQueueItemId: item.queueItemId,
      trackStartedAtServerMs: playAtServerMs - startPosMs,
      pausedAtPositionMs: null,
      isPlaying: true,
      sequence: nextSeq,
      targetBpm:
        this.state.intensityMode === 'manual'
          ? item.track.bpm
          : this.state.targetBpm || item.track.bpm,
      currentBucket: classifyBpmBucket(
        (this.state.intensityMode === 'manual'
          ? item.track.bpm
          : this.state.targetBpm) ||
          item.track.bpm ||
          160
      ),
    };

    // Update each member's status per their service's resolution (Section 8 & 14)
    this.members = this.members.map((m) => {
      if (m.status === 'not_premium' || m.status === 'disconnected') {
        return m;
      }
      const resolvedId = item.track.providerIds[m.provider];
      if (!resolvedId) {
        return {
          ...m,
          status: 'unavailable',
          playbackRate: 1.0,
          statusNote: 'Not on your service, back at the next song',
        };
      }
      const rate = this.computeMemberPlaybackRate(m.provider, item);
      return {
        ...m,
        status: 'playing',
        lastPositionMs: startPosMs,
        lastPositionAtServerMs: playAtServerMs,
        lastDriftMs: m.isSelf ? 0 : Math.round((Math.random() - 0.5) * 24),
        playbackRate: rate,
        statusNote:
          item.resolutionNotes?.[m.provider] ||
          (m.provider === 'local'
            ? `Local DSP (${rate.toFixed(2)}x pitch-locked)`
            : m.provider === 'apple'
            ? `Apple MusicKit (${rate.toFixed(2)}x)`
            : 'Spotify App Remote (1.00x)'),
      };
    });

    const selfTrackId = item.track.providerIds[this.activeProviderId] || null;
    const playPayload: PlayEventPayload = {
      sequence: nextSeq,
      queueItemId: item.queueItemId,
      positionMs: startPosMs,
      playAtServerMs,
      perProviderTrackId: selfTrackId,
      resolvedProviderIds: item.track.providerIds,
    };

    this.appendLog(
      'C->S',
      'leader:play',
      nextSeq,
      `${reason} (${item.track.title}, pos=${startPosMs}ms)`,
      JSON.stringify({ queueItemId: item.queueItemId, positionMs: startPosMs })
    );

    this.appendLog(
      'S->all',
      'playback:play',
      nextSeq,
      `Scheduled +${leadWindowMs}ms in future (playAt=${playAtServerMs}, ISRC=${item.track.isrc})`,
      JSON.stringify(playPayload)
    );

    // Broadcast over Supabase Realtime if configured
    if (supabase && isSupabaseConfigured) {
      try {
        const channel = supabase.channel(`pack-session:${this.state.sessionId}`);
        await channel.send({
          type: 'broadcast',
          event: 'playback:play',
          payload: playPayload,
        });
      } catch {
        // Fallback to local engine
      }
    }

    await this.handlePlayEventOnClient(playPayload);
    this.notify();
    return playPayload;
  }

  // ==========================================================================
  // Section 7.4: Pause, Resume, Seek, Skip
  // ==========================================================================

  public async leaderPause(): Promise<void> {
    const posMs = this.getDerivedPositionMs();
    const nextSeq = this.state.sequence + 1;

    this.state = {
      ...this.state,
      pausedAtPositionMs: posMs,
      trackStartedAtServerMs: null,
      isPlaying: false,
      sequence: nextSeq,
    };

    this.lastAppliedSequence = nextSeq;
    await this.getActiveProvider().pause();
    localPitchStretchAudioEngine.setPlaying(false);

    this.members = this.members.map((m) =>
      m.status === 'playing' || m.status === 'buffering'
        ? {
            ...m,
            status: 'paused',
            lastPositionMs: posMs,
            lastPositionAtServerMs: this.clock.serverNow(),
          }
        : m
    );

    this.appendLog(
      'S->all',
      'playback:pause',
      nextSeq,
      `Paused pack at ${Math.round(posMs)}ms (trackStartedAtServerMs=null)`,
      JSON.stringify({ sequence: nextSeq, positionMs: posMs })
    );

    this.notify();
  }

  public async leaderSeek(positionMs: number): Promise<void> {
    const clampedMs = Math.max(0, Math.round(positionMs));
    const maxMemberRtt = Math.max(...this.members.map((m) => m.rttMs), 20);
    const leadWindowMs = maxMemberRtt > 500 ? 2000 : 1500;
    const playAtServerMs = this.clock.serverNow() + leadWindowMs;
    const nextSeq = this.state.sequence + 1;

    this.state = {
      ...this.state,
      trackStartedAtServerMs: this.state.isPlaying
        ? playAtServerMs - clampedMs
        : null,
      pausedAtPositionMs: this.state.isPlaying ? null : clampedMs,
      sequence: nextSeq,
    };

    this.lastAppliedSequence = nextSeq;
    await this.getActiveProvider().seek(clampedMs);

    this.members = this.members.map((m) =>
      m.status === 'playing' || m.status === 'paused'
        ? {
            ...m,
            lastPositionMs: clampedMs,
            lastPositionAtServerMs: playAtServerMs,
            lastDriftMs: m.isSelf ? 0 : Math.round((Math.random() - 0.5) * 18),
          }
        : m
    );

    this.appendLog(
      'S->all',
      'playback:seek',
      nextSeq,
      `Scheduled group seek to ${clampedMs}ms (playAtServerMs=${playAtServerMs})`,
      JSON.stringify({
        sequence: nextSeq,
        positionMs: clampedMs,
        playAtServerMs,
      })
    );

    this.notify();
  }

  public async leaderSkip(targetQueueItemId?: string): Promise<void> {
    const queue = this.state.queue;
    if (queue.length === 0) return;

    let nextItem: QueueItem | null = null;

    if (targetQueueItemId) {
      nextItem =
        queue.find((q) => q.queueItemId === targetQueueItemId) || queue[0];
    } else if (
      this.state.intensityMode === 'auto_bpm' &&
      this.state.targetBpm !== null
    ) {
      // Section 7.5 & 9.4: In auto_bpm mode, select best BPM match in queue
      nextItem = this.intensity.selectBestQueueItemForBpm(
        queue,
        this.state.targetBpm,
        this.state.currentQueueItemId
      );
    }

    if (!nextItem) {
      const idx = queue.findIndex(
        (q) => q.queueItemId === this.state.currentQueueItemId
      );
      nextItem = queue[(idx + 1) % queue.length];
    }

    await this.leaderPlay(nextItem.queueItemId, 0, 'leader:skip');
  }

  // ==========================================================================
  // Section 7.2: Drift Check (`driftCheck`)
  // ==========================================================================

  /**
   * Section 7.2:
   * - If |driftMs| > 400 ms: hard resync via `provider.seek(expectedMs)`
   * - Between 150 and 400 ms: do nothing on Spotify or Apple; Local provider nudges rate by +/- 2% for 1s
   */
  public async runDriftCheck(
    simulatedDriftOverrideMs?: number
  ): Promise<{ driftMs: number; actionTaken: 'none' | 'hard_seek' | 'rate_nudge' }> {
    if (!this.state.isPlaying || this.state.trackStartedAtServerMs == null) {
      return { driftMs: 0, actionTaken: 'none' };
    }

    const provider = this.getActiveProvider();
    const snap: PlaybackSnapshot = await provider.getSnapshot();
    const expectedMs =
      this.clock.serverNow() - this.state.trackStartedAtServerMs;
    const actualMs =
      typeof simulatedDriftOverrideMs === 'number'
        ? expectedMs + simulatedDriftOverrideMs
        : snap.positionMs + (Date.now() - snap.snapshotAtLocalMs);

    const driftMs = Math.round(actualMs - expectedMs);
    let actionTaken: 'none' | 'hard_seek' | 'rate_nudge' = 'none';

    if (Math.abs(driftMs) > 400) {
      await provider.seek(expectedMs);
      actionTaken = 'hard_seek';
      this.appendLog(
        'SYNC',
        'drift:check',
        this.state.sequence,
        `Drift ${driftMs >= 0 ? '+' : ''}${driftMs}ms > 400ms threshold -> Hard resync provider.seek(${Math.round(expectedMs)}ms)`,
        JSON.stringify({ expectedMs: Math.round(expectedMs), actualMs: Math.round(actualMs), driftMs, action: 'seek' })
      );
    } else if (Math.abs(driftMs) >= 150 && provider.id === 'local') {
      // Section 7.2: Local provider may nudge rate by +/-2% for one second instead of seeking
      const nudge = driftMs > 0 ? 0.98 : 1.02;
      await provider.setRate(nudge);
      actionTaken = 'rate_nudge';
      setTimeout(() => {
        const currentItem = this.getCurrentQueueItem();
        const normalRate = this.computeMemberPlaybackRate('local', currentItem);
        provider.setRate(normalRate).catch(() => {});
      }, 1000);
      this.appendLog(
        'SYNC',
        'drift:check',
        this.state.sequence,
        `Drift ${driftMs >= 0 ? '+' : ''}${driftMs}ms (150-400ms window) -> Local DSP rate nudged ${nudge}x for 1s`,
        JSON.stringify({ expectedMs: Math.round(expectedMs), driftMs, action: 'local_rate_nudge' })
      );
    } else {
      this.appendLog(
        'SYNC',
        'drift:check',
        this.state.sequence,
        `Drift ${driftMs >= 0 ? '+' : ''}${driftMs}ms within tolerance (<400ms) -> No disruptive seek`,
        JSON.stringify({ expectedMs: Math.round(expectedMs), driftMs, action: 'none' })
      );
    }

    this.members = this.members.map((m) =>
      m.isSelf
        ? {
            ...m,
            lastDriftMs: actionTaken === 'hard_seek' ? 0 : driftMs,
            lastPositionMs: Math.round(expectedMs),
            lastPositionAtServerMs: this.clock.serverNow(),
          }
        : m
    );

    this.notify();
    return { driftMs, actionTaken };
  }

  // ==========================================================================
  // Section 8: Enqueue & Pre-Resolve by ISRC
  // ==========================================================================

  public async enqueueAndResolveTrack(track: CanonicalTrack): Promise<QueueItem> {
    const activeProviders: ProviderId[] = ['spotify', 'apple', 'local'];
    const { resolvedTrack, resolution, resolutionNotes } =
      await trackResolver.resolveTrackForProviders(track, activeProviders);

    const newItem: QueueItem = {
      queueItemId: `q-${Date.now().toString(36)}-${resolvedTrack.isrc.toLowerCase()}`,
      track: resolvedTrack,
      addedByUserId: this.state.leaderUserId,
      resolution,
      resolutionNotes,
    };

    const nextSeq = this.state.sequence + 1;
    const nextQueue = [...this.state.queue, newItem];
    const warning = trackResolver.checkQueueAvailabilityWarning(
      nextQueue,
      activeProviders
    );

    this.state = {
      ...this.state,
      queue: nextQueue,
      sequence: nextSeq,
    };

    this.appendLog(
      'S->all',
      'queue:updated',
      nextSeq,
      `Resolved ISRC ${resolvedTrack.isrc} (${resolvedTrack.bpm} BPM) across Spotify/Apple/Local`,
      JSON.stringify({
        isrc: resolvedTrack.isrc,
        resolution,
        unavailabilityWarning: warning,
      })
    );

    this.notify();
    return newItem;
  }

  // ==========================================================================
  // Section 9: Intensity Engine Integration (`member:intensity` -> `intensity:target`)
  // ==========================================================================

  public setIntensityMode(mode: 'manual' | 'auto_bpm'): void {
    this.state = {
      ...this.state,
      intensityMode: mode,
    };
    this.notify();
  }

  public async ingestWorkoutIntensity(
    samples: MemberIntensitySample[],
    opts?: { bypassHysteresis?: boolean; reason?: string }
  ): Promise<void> {
    const result = this.intensity.ingestBatch(
      samples,
      this.clock.serverNow(),
      opts?.bypassHysteresis ?? false
    );

    const prevBucket = this.state.currentBucket;
    this.state = {
      ...this.state,
      targetBpm: result.targetBpm,
      currentBucket: result.bucket,
    };

    // Update Local DSP or Apple iOS rate nudges if active
    const currentItem = this.getCurrentQueueItem();
    this.members = this.members.map((m) => {
      if (m.status !== 'playing') return m;
      const newRate = this.computeMemberPlaybackRate(m.provider, currentItem);
      return {
        ...m,
        playbackRate: newRate,
      };
    });

    const activeProv = this.getActiveProvider();
    if (activeProv.capabilities.canSetRate) {
      const selfRate = this.computeMemberPlaybackRate(
        activeProv.id,
        currentItem
      );
      await activeProv.setRate(selfRate);
    }

    if (result.bucketChanged || opts?.bypassHysteresis) {
      const targetEvt = this.intensity.buildIntensityTargetEvent(
        this.state.queue,
        this.state.currentQueueItemId,
        opts?.reason ||
          `Group median ${result.rawMedianBpm} BPM -> ${result.bucket.toUpperCase()} bucket (${result.targetBpm} BPM)`
      );

      this.appendLog(
        'S->all',
        'intensity:target',
        this.state.sequence,
        `${targetEvt.reason}`,
        JSON.stringify(targetEvt)
      );

      // Section 9.4: In auto_bpm mode, when entering a new bucket, transition to best BPM match in queue
      if (
        this.state.intensityMode === 'auto_bpm' &&
        targetEvt.recommendedQueueItemId &&
        targetEvt.recommendedQueueItemId !== this.state.currentQueueItemId &&
        (prevBucket !== result.bucket || opts?.bypassHysteresis)
      ) {
        await this.leaderPlay(
          targetEvt.recommendedQueueItemId,
          0,
          `auto_bpm:${result.bucket}`
        );
      }
    }

    this.notify();
  }

  // ==========================================================================
  // Section 12 & 14: Interactive Test Scenarios (Late Join, Leader Loss, Error Matrix)
  // ==========================================================================

  /** Section 7.6 & 12: Late join a member mid-track at derived `serverNow() - trackStartedAtServerMs` */
  public simulateLateJoin(userId = 'athlete-marcus'): void {
    const derivedPosMs = this.getDerivedPositionMs();
    const currentItem = this.getCurrentQueueItem();

    this.members = this.members.map((m) => {
      if (m.userId !== userId) return m;
      const trackId = currentItem.track.providerIds[m.provider];
      const status: MemberPlaybackStatus = trackId ? 'playing' : 'unavailable';
      return {
        ...m,
        status,
        lastPositionMs: derivedPosMs,
        lastPositionAtServerMs: this.clock.serverNow(),
        lastDriftMs: 6,
        statusNote: trackId
          ? `Late joined mid-track at ${(derivedPosMs / 1000).toFixed(1)}s (<250ms offset)`
          : 'Not on your service, back at the next song',
      };
    });

    this.appendLog(
      'S->member',
      'session:snapshot',
      this.state.sequence,
      `Late-join resync for ${userId}: landed at ${(derivedPosMs / 1000).toFixed(1)}s via trackStartedAtServerMs`,
      JSON.stringify({
        userId,
        derivedPositionMs: derivedPosMs,
        trackStartedAtServerMs: this.state.trackStartedAtServerMs,
      })
    );

    this.notify();
  }

  /** Section 7.7 & 14: Leader disconnect > 20s -> promotes earliest-joined remaining member without stopping audio */
  public simulateLeaderPromotion(): void {
    const currentLeader = this.state.leaderUserId;
    const candidates = this.members.filter(
      (m) => m.userId !== currentLeader && m.status !== 'disconnected'
    );
    if (candidates.length === 0) return;
    const nextLeader = candidates[0];

    this.state = {
      ...this.state,
      leaderUserId: nextLeader.userId,
    };

    this.members = this.members.map((m) => {
      if (m.userId === nextLeader.userId) {
        return {
          ...m,
          statusNote: 'Promoted to Session Leader (7.7) — Audio Uninterrupted',
        };
      }
      return m;
    });

    this.appendLog(
      'S->all',
      'leader:promote',
      this.state.sequence,
      `Leader socket dropped >20s -> Promoted ${nextLeader.displayName} to leaderUserId (playback uninterrupted)`,
      JSON.stringify({
        previousLeader: currentLeader,
        newLeaderUserId: nextLeader.userId,
      })
    );

    this.notify();
  }

  /** Section 14 Error Matrix: Toggle a specific member state (e.g. not_premium, unavailable, disconnected) */
  public setMemberSimulatedStatus(
    userId: string,
    status: MemberPlaybackStatus
  ): void {
    const statusNotes: Record<MemberPlaybackStatus, string> = {
      playing: 'Synced (<250ms offset)',
      paused: 'Paused at shared position',
      buffering: 'Buffering next scheduled track...',
      ready: 'Ready for scheduled playAtServerMs',
      unavailable: 'Not on your service, back at the next song',
      not_premium: 'Playback sync needs Spotify Premium (listener only)',
      disconnected: 'Reconnecting... auto-rejoin on network restore',
    };

    this.members = this.members.map((m) =>
      m.userId === userId
        ? {
            ...m,
            status,
            statusNote: statusNotes[status],
          }
        : m
    );

    this.appendLog(
      'C->S',
      'member:state',
      this.state.sequence,
      `Member ${userId} reported status="${status}" (${statusNotes[status]})`,
      JSON.stringify({
        userId,
        status,
        positionMs: this.getDerivedPositionMs(),
      })
    );

    this.notify();
  }

  /**
   * Section 6 & 9.4: Manually test `provider.setRate(rate)` from the UI.
   * - Throws ProviderError('unknown') on Spotify (`capabilities.canSetRate === false`)
   * - Clamps to +/-8% on Apple Music iOS
   * - Performs full pitch-preserving time-stretch on LocalFileProvider
   */
  public async setManualPlaybackRate(rate: number): Promise<{
    appliedRate: number;
    effectiveBpm: number;
    message: string;
  }> {
    const provider = this.getActiveProvider();
    const currentItem = this.getCurrentQueueItem();
    const nativeBpm = currentItem.track.bpm || 170;

    if (!provider.capabilities.canSetRate) {
      this.appendLog(
        'SYNC',
        'member:state',
        this.state.sequence,
        `Rejected setRate(${rate.toFixed(2)}x) on ${provider.id.toUpperCase()}: capabilities.canSetRate = false (DRM / ToS limit)`,
        JSON.stringify({ provider: provider.id, canSetRate: false })
      );
      this.notify();
      return {
        appliedRate: 1.0,
        effectiveBpm: nativeBpm,
        message: `Blocked on ${provider.id.toUpperCase()}: capabilities.canSetRate is false. Switch to LOCAL DSP for pitch-locked time-stretch!`,
      };
    }

    await provider.setRate(rate);
    const snap = await provider.getSnapshot();
    const appliedRate = snap.rate;
    const effectiveBpm = Math.round(nativeBpm * appliedRate);

    localPitchStretchAudioEngine.setRate(appliedRate);

    this.members = this.members.map((m) =>
      m.isSelf
        ? {
            ...m,
            playbackRate: appliedRate,
            statusNote:
              provider.id === 'local'
                ? `Local DSP Pitch-Lock: ${appliedRate.toFixed(2)}x (${nativeBpm} -> ${effectiveBpm} BPM)`
                : `Apple MusicKit Rate Nudge: ${appliedRate.toFixed(2)}x (${nativeBpm} -> ${effectiveBpm} BPM)`,
          }
        : m
    );

    this.appendLog(
      'SYNC',
      'member:state',
      this.state.sequence,
      `Applied pitch-preserved rate ${appliedRate.toFixed(2)}x on ${provider.id.toUpperCase()} (${nativeBpm} -> ${effectiveBpm} BPM)`,
      JSON.stringify({ provider: provider.id, appliedRate, nativeBpm, effectiveBpm })
    );

    this.notify();
    return {
      appliedRate,
      effectiveBpm,
      message: `${provider.id.toUpperCase()} rate set to ${appliedRate.toFixed(2)}x (${nativeBpm} -> ${effectiveBpm} BPM, pitch preserved)`,
    };
  }

  /**
   * Section 14.4: Duck music volume to 25% when a teammate speaks on Walkie-Talkie PTT.
   */
  public async setVoiceDucking(isDucked: boolean): Promise<void> {
    const ratio = isDucked ? 0.25 : 1.0;
    const provider = this.getActiveProvider();
    if (provider.setVolume) {
      await provider.setVolume(ratio);
    }
    localPitchStretchAudioEngine.setVolumeRatio(ratio);
  }

  public getTransportMode(): string {
    return syncTransport.mode;
  }

  public getAppleMusicProvider(): AppleMusicProvider {
    return this.providers.apple as AppleMusicProvider;
  }

  public async searchAppleCatalog(
    query: string,
    limit = 6
  ): Promise<CanonicalTrack[]> {
    return this.getAppleMusicProvider().search(query, limit);
  }

  public async playPickedTrackNow(track: CanonicalTrack): Promise<QueueItem> {
    const appleProv = this.getAppleMusicProvider();
    localPitchStretchAudioEngine.setAudioMonitorActive(false);
    appleProv.enableLiveStreamFlag(true);

    // 1. Start audio synchronously on the first line (inside the user's click gesture!)
    const immediateAppleId = track.providerIds.apple;
    if (immediateAppleId) {
      appleProv.play(immediateAppleId, 0).catch(() => {});
    }

    if (this.activeProviderId !== 'apple') {
      this.activeProviderId = 'apple';
      this.members = this.members.map((m) =>
        m.isSelf ? { ...m, provider: 'apple' } : m
      );
    }

    // 2. Check if track is already in the queue or add it
    let item = this.state.queue.find(
      (q) =>
        q.track.isrc === track.isrc ||
        (track.providerIds.apple &&
          q.track.providerIds.apple === track.providerIds.apple)
    );
    if (!item) {
      item = await this.enqueueAndResolveTrack(track);
    }

    await this.leaderPlay(item.queueItemId, 0, 'leader:play');

    // Clear the 1500ms lead-time timer since we already started playback immediately
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
      this.scheduledPlayTargetServerMs = null;
    }

    // If the track was from the static preset queue (not pre-cached by search), ensure play() finishes
    const resolvedAppleId = item.track.providerIds.apple;
    if (resolvedAppleId && resolvedAppleId !== immediateAppleId) {
      await appleProv.play(resolvedAppleId, 0).catch(() => {});
    }

    this.notify();
    return item;
  }

  public async toggleAppleLiveStream(): Promise<{
    enabled: boolean;
    streamSummary: string;
  }> {
    const appleProv = this.getAppleMusicProvider();
    const nextState = !appleProv.isLiveStreamEnabled();

    if (nextState) {
      // Mute synth monitor so you only hear the real Apple Music CDN .m4a stream
      localPitchStretchAudioEngine.setAudioMonitorActive(false);
      if (this.activeProviderId !== 'apple') {
        await this.switchSelfProvider('apple');
      }
      const info = await appleProv.setLiveStreamEnabled(true);
      this.appendLog(
        'SYNC',
        'member:state',
        this.state.sequence,
        info
          ? `Streaming real Apple Music CDN AAC (.m4a): "${info.trackName}" by ${info.artistName}`
          : 'Enabled Apple Music live CDN catalog preview stream',
        JSON.stringify(
          info || { provider: 'apple', mode: 'itunes-cdn-preview-stream' }
        )
      );
      this.notify();
      return {
        enabled: true,
        streamSummary: info
          ? `Apple Music CDN Stream: "${info.trackName}" — ${info.artistName} (audio-ssl.itunes.apple.com)`
          : 'Apple Music CDN Stream Enabled',
      };
    } else {
      await appleProv.setLiveStreamEnabled(false);
      this.notify();
      return {
        enabled: false,
        streamSummary: 'Apple Music live CDN stream paused',
      };
    }
  }
}

export const groupMusicSyncCoordinator = new GroupMusicSyncCoordinator();

