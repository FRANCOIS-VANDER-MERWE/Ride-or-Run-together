// src/music/types.ts
// Core Data Model, Wire Protocol Events, and MusicProvider Interface
// Specification: Group Music Sync Architecture (Sections 4, 5, 6, 8, 9, 11)

export type ProviderId = 'spotify' | 'apple' | 'local';

export type ISRC = string; // e.g. "USRC17607839". The canonical recording identity.

export type BpmSource = 'reccobeats' | 'getsongbpm' | 'curated' | 'local';

/** A recording, independent of any one service. This is what the queue stores. (Section 4) */
export interface CanonicalTrack {
  isrc: ISRC;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  durationMs: number;
  /** Native tempo, if known. Null means "not yet looked up", never a guess. */
  bpm: number | null;
  bpmSource?: BpmSource;
  explicit?: boolean;
  /** Per-service IDs, filled in by the resolver. A member only uses their own. */
  providerIds: Partial<Record<ProviderId, string>>;
}

export type ProviderResolutionStatus = 'resolved' | 'unavailable' | 'pending';

export interface QueueItem {
  queueItemId: string; // UUID, stable for the life of the session
  track: CanonicalTrack;
  addedByUserId: string;
  /** Resolution state per provider present in this session. */
  resolution: Partial<Record<ProviderId, ProviderResolutionStatus>>;
  /** Optional notes per provider (e.g., "clean version substituted", "+1.4s duration delta") */
  resolutionNotes?: Partial<Record<ProviderId, string>>;
}

export type MemberPlaybackStatus =
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ready'
  | 'unavailable' // this track does not exist on their service
  | 'not_premium' // Spotify free tier, cannot be controlled
  | 'disconnected';

export interface MemberState {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  color?: string;
  isSelf?: boolean;
  provider: ProviderId;
  status: MemberPlaybackStatus;
  /** Last reported position, and the server time at which it was true. */
  lastPositionMs: number | null;
  lastPositionAtServerMs: number | null;
  clockOffsetMs: number; // member clock minus server clock, from Section 7.3
  rttMs: number;
  lastDriftMs: number;
  playbackRate: number;
  statusNote?: string;
}

export type IntensityBucket = 'warmup' | 'cruise' | 'tempo' | 'push';

export interface SessionState {
  sessionId: string;
  joinCode: string;
  leaderUserId: string;
  queue: QueueItem[];
  currentQueueItemId: string | null;
  /** Server timestamp (ms) at which the current track's position 0 occurs.
      Null while paused. This one field is the whole sync model: any member
      can compute the correct position at any moment from it. */
  trackStartedAtServerMs: number | null;
  pausedAtPositionMs: number | null;
  isPlaying: boolean;
  /** Monotonic event counter. Every playback event increments it. */
  sequence: number;
  intensityMode: 'manual' | 'auto_bpm';
  targetBpm: number | null;
  currentBucket: IntensityBucket;
}

// ============================================================================
// Section 5: Playback Events (Wire Protocol)
// ============================================================================

export interface ClientToServerEvents {
  'session:join': {
    sessionId: string;
    userId: string;
    provider: ProviderId;
    displayName: string;
  };
  'clock:ping': {
    clientSentAtMs: number;
  };
  'leader:enqueue': {
    track: CanonicalTrack;
  };
  'leader:play': {
    queueItemId: string;
    positionMs: number;
  };
  'leader:pause': Record<string, never>;
  'leader:seek': {
    positionMs: number;
  };
  'leader:skip': {
    queueItemId?: string;
  };
  'member:state': {
    userId: string;
    status: MemberPlaybackStatus;
    positionMs: number;
    queueItemId: string | null;
  };
  'member:intensity': {
    userId: string;
    cadence?: number;
    paceSecPerKm?: number;
    speedMps?: number;
    heartRate?: number;
    atMs: number;
  };
  'member:ended': {
    userId: string;
    queueItemId: string;
  };
}

export interface PlayEventPayload {
  sequence: number;
  queueItemId: string;
  positionMs: number;
  playAtServerMs: number;
  perProviderTrackId: string | null;
  /** Map of resolved IDs per provider for multi-member simulation inspection */
  resolvedProviderIds?: Partial<Record<ProviderId, string>>;
}

export interface PauseEventPayload {
  sequence: number;
  positionMs: number;
}

export interface SeekEventPayload {
  sequence: number;
  positionMs: number;
  playAtServerMs: number;
}

export interface StopEventPayload {
  sequence: number;
}

export interface QueueUpdatedEventPayload {
  sequence: number;
  queue: QueueItem[];
  unavailabilityWarning?: string | null;
}

export interface IntensityTargetEventPayload {
  targetBpm: number;
  rawMedianBpm: number;
  bucket: IntensityBucket;
  reason: string;
  recommendedQueueItemId: string | null;
}

export interface ClockPongEventPayload {
  clientSentAtMs: number;
  serverReceivedAtMs: number;
  serverSentAtMs: number;
}

export interface ServerToClientEvents {
  'session:snapshot': {
    state: SessionState;
    members: MemberState[];
    serverNowMs: number;
  };
  'playback:play': PlayEventPayload;
  'playback:pause': PauseEventPayload;
  'playback:seek': SeekEventPayload;
  'playback:stop': StopEventPayload;
  'queue:updated': QueueUpdatedEventPayload;
  'intensity:target': IntensityTargetEventPayload;
  'clock:pong': ClockPongEventPayload;
}

export type WireProtocolLogEntry = {
  id: string;
  timestamp: string;
  direction: 'C->S' | 'S->all' | 'S->member' | 'SYNC';
  eventName:
    | keyof ClientToServerEvents
    | keyof ServerToClientEvents
    | 'drift:check'
    | 'leader:promote';
  sequence: number | null;
  summary: string;
  payloadPreview: string;
};

// ============================================================================
// Section 6: The Provider Interface
// ============================================================================

export interface ProviderCapabilities {
  canPlay: boolean; // can start catalog playback at all
  canSeek: boolean;
  canSetRate: boolean; // true ONLY for: local files (full), apple on iOS (crude, see 9.4)
  canCrossfade: boolean;
  requiresPremium: boolean; // spotify: true. apple: subscription required. local: false
  requiresExternalApp: boolean; // spotify: true (Spotify app must be installed). others: false
}

export interface AuthState {
  isConnected: boolean;
  isPremiumOrSubscribed: boolean | null; // null = provider cannot tell us
  userDisplayName: string | null;
  expiresAtMs: number | null;
}

export interface PlaybackSnapshot {
  providerTrackId: string | null;
  isPlaying: boolean;
  positionMs: number; // position at the moment the snapshot was taken
  snapshotAtLocalMs: number; // local clock when taken, so callers can extrapolate
  durationMs: number | null;
  rate: number; // 1.0 = normal. Only meaningful if canSetRate
}

export type ProviderErrorCode =
  | 'not_connected'
  | 'not_premium'
  | 'track_unavailable'
  | 'external_app_missing'
  | 'network'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface MusicProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  // --- Auth / lifecycle ---
  connect(): Promise<AuthState>; // runs the service's OAuth or MusicKit auth flow
  disconnect(): Promise<void>;
  getAuthState(): Promise<AuthState>;
  /** Call once when the session screen mounts. Spotify: connects App Remote.
      Apple: configures MusicKit. Local: no-op. */
  prepare(): Promise<void>;

  // --- Catalog ---
  search(query: string, limit?: number): Promise<CanonicalTrack[]>;
  /** Fill in providerIds and bpm for a track we only know from another service. */
  resolve(track: CanonicalTrack): Promise<CanonicalTrack>;

  // --- Playback (providerTrackId is THIS provider's ID, from CanonicalTrack.providerIds) ---
  play(providerTrackId: string, positionMs: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  /** Rate 1.0 = normal. Implementations must throw ProviderError('unknown')
      if capabilities.canSetRate is false. Callers must check capabilities first. */
  setRate(rate: number): Promise<void>;
  /** Optional audio ducking for group voice chat interaction (Section 14.4) */
  setVolume?(volumeRatio: number): Promise<void>;
  getSnapshot(): Promise<PlaybackSnapshot>;

  // --- Events ---
  /** Subscribe to native state changes (track ended, externally paused, etc).
      Returns an unsubscribe function. */
  onStateChange(cb: (snap: PlaybackSnapshot) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
}

