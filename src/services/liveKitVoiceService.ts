import { PermissionsAndroid, Platform } from 'react-native';
import type { Participant, Room } from 'livekit-client';
import { loadLiveKit, LiveKitModules } from './liveKitNative';
import { setSpotifyVolumeDucking } from './spotifySyncService';

const DEFAULT_ROOM = 'sf-884-pack-tempo';
const CALLOUT_TOPIC = 'pacelock.callout';
const MAX_CALLOUT_LENGTH = 280;
const DUCKED_VOLUME_PCT = 25;

export type VoiceMode = 'live' | 'simulated';
export type VoiceConnection =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface VoicePeer {
  identity: string;
  name: string;
}

export interface WalkieSnapshot {
  mode: VoiceMode;
  /** Why voice is simulated. Null in live mode. */
  simulatedReason: 'needs-dev-build' | 'needs-token-url' | null;
  connection: VoiceConnection;
  roomName: string;
  callsign: string;
  peers: VoicePeer[];
  /** Remote participants whose microphone is open right now. */
  transmitters: VoicePeer[];
  isMicLive: boolean;
  error: string | null;
}

export type WalkieEvent =
  | { type: 'remote-transmit-start'; peer: VoicePeer }
  | { type: 'remote-transmit-end'; peer: VoicePeer; durationSec: number }
  | { type: 'remote-callout'; peer: VoicePeer; text: string }
  | { type: 'mic-failed' };

function peerFrom(participant: Participant): VoicePeer {
  return {
    identity: participant.identity,
    name: participant.name || participant.identity,
  };
}

function createCallsign(): string {
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `Runner ${suffix}`;
}

/**
 * Push-to-talk voice channel on a shared LiveKit room.
 *
 * Everyone joins the room with their mic off, so they can hear the pack from any
 * tab. Holding the paddle opens the mic, and a remote participant counts as
 * transmitting while their mic track is published and unmuted. That follows the
 * button rather than voice detection, so the UI changes the moment someone presses.
 *
 * Without the native SDK (Expo Go, web) or a token endpoint, it stays in simulated
 * mode and the rest of the app keeps working.
 */
export class PackWalkieTalkieController {
  private liveKit: LiveKitModules | null;
  private tokenUrl = process.env.EXPO_PUBLIC_LIVEKIT_TOKEN_URL || '';
  private room: Room | null = null;
  // Bumped on every connect/disconnect so a superseded connect attempt can stop.
  private connectAttempt = 0;
  private spotifyAccessToken: string | null = null;
  private isDucked = false;

  private wantMic = false;
  private appliedMic = false;
  private isSyncingMic = false;
  private transmitStartedAt = new Map<string, number>();

  private snapshot: WalkieSnapshot;
  private stateListeners = new Set<() => void>();
  private eventListeners = new Set<(event: WalkieEvent) => void>();

  constructor(roomName = DEFAULT_ROOM) {
    this.liveKit = loadLiveKit();
    const simulatedReason = !this.liveKit
      ? 'needs-dev-build'
      : !this.tokenUrl
      ? 'needs-token-url'
      : null;
    this.snapshot = {
      mode: simulatedReason ? 'simulated' : 'live',
      simulatedReason,
      connection: 'disconnected',
      roomName,
      callsign: createCallsign(),
      peers: [],
      transmitters: [],
      isMicLive: false,
      error: null,
    };
  }

  setSpotifyToken(token: string | null) {
    this.spotifyAccessToken = token;
  }

  // Arrow properties keep `this` bound for useSyncExternalStore.
  subscribe = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  onEvent(listener: (event: WalkieEvent) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** Joins the pack room. Does nothing in simulated mode or if already joined. */
  async connect(): Promise<void> {
    const liveKit = this.liveKit;
    if (!liveKit || this.room) return;

    const attempt = ++this.connectAttempt;
    const { Room, RoomEvent, AudioPresets } = liveKit.client;
    this.update({ connection: 'connecting', error: null });

    const room = new Room({
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true },
    });
    this.room = room;

    const refresh = () => {
      if (this.room === room) this.refreshParticipants(room);
    };
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.Reconnecting, () => this.update({ connection: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => {
        this.update({ connection: 'connected' });
        refresh();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room === room) {
          this.teardown('Voice channel disconnected.');
        }
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic === CALLOUT_TOPIC && participant) {
          this.handleCallout(payload, participant);
        }
      });

    try {
      // Only applies on Android, where the default takes full audio focus and
      // pauses Spotify for as long as the session is running.
      await liveKit.AudioSession.configureAudio({
        android: {
          audioTypeOptions: {
            ...liveKit.AndroidAudioTypePresets.communication,
            manageAudioFocus: false,
          },
        },
      });
      await liveKit.AudioSession.startAudioSession();

      const { token, serverUrl } = await this.fetchToken();
      if (attempt !== this.connectAttempt) return;

      await room.connect(serverUrl, token);
      if (attempt !== this.connectAttempt) {
        await room.disconnect();
        return;
      }
      this.update({ connection: 'connected' });
      this.refreshParticipants(room);
    } catch (error) {
      console.warn('[LiveKit] Connect failed:', error);
      if (attempt === this.connectAttempt) {
        this.teardown(
          error instanceof Error ? error.message : 'Could not join the voice channel.'
        );
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connectAttempt += 1;
    this.teardown(null);
  }

  /** Opens the mic. In simulated mode this only ducks the music. */
  async pushToTalkOpen(): Promise<void> {
    this.wantMic = true;
    this.updateDucking();
    await this.syncMic();
  }

  /** Closes the mic so wind and breathing noise never reach the pack. */
  async pushToTalkRelease(): Promise<void> {
    this.wantMic = false;
    this.updateDucking();
    await this.syncMic();
  }

  /** Sends a text callout to the pack. Returns false if it could not be sent. */
  async sendCallout(text: string): Promise<boolean> {
    if (!this.room || this.snapshot.connection !== 'connected') return false;
    try {
      const payload = new TextEncoder().encode(JSON.stringify({ text }));
      await this.room.localParticipant.publishData(payload, {
        reliable: true,
        topic: CALLOUT_TOPIC,
      });
      return true;
    } catch (error) {
      console.warn('[LiveKit] Callout failed:', error);
      this.update({ error: 'Could not send that callout.' });
      return false;
    }
  }

  /**
   * Brings the mic in line with `wantMic`. Enabling the mic can take a moment and
   * the paddle may be released during that time, so this loops until they match.
   * Otherwise a quick tap could leave the mic open.
   */
  private async syncMic(): Promise<void> {
    if (this.isSyncingMic) return;
    this.isSyncingMic = true;
    try {
      while (this.room && this.appliedMic !== this.wantMic) {
        const room: Room = this.room;
        const target = this.wantMic;
        if (target && !(await this.ensureMicPermission())) {
          this.handleMicFailure('Microphone permission is needed to talk to the pack.');
          break;
        }
        // The paddle may have been released during the permission prompt.
        if (target !== this.wantMic) continue;

        await room.localParticipant.setMicrophoneEnabled(target);
        // Teardown has already reset the mic state if the room went away meanwhile.
        if (this.room !== room) break;
        this.appliedMic = target;
        this.update({ isMicLive: target });
      }
    } catch (error) {
      console.warn('[LiveKit] Could not change the microphone:', error);
      this.handleMicFailure('Could not change the microphone state.');
    } finally {
      this.isSyncingMic = false;
    }
  }

  private handleMicFailure(message: string) {
    this.wantMic = false;
    this.updateDucking();
    this.update({ error: message });
    this.emit({ type: 'mic-failed' });
  }

  private async ensureMicPermission(): Promise<boolean> {
    // On iOS, WebRTC shows the system prompt when capture starts.
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  private async fetchToken(): Promise<{ token: string; serverUrl: string }> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_name: this.snapshot.roomName,
        participant_identity: this.snapshot.callsign,
        participant_name: this.snapshot.callsign,
      }),
    });
    if (!response.ok) {
      throw new Error(`Token server responded with ${response.status}.`);
    }
    const body = await response.json();
    const serverUrl = body.server_url || process.env.EXPO_PUBLIC_LIVEKIT_URL;
    if (!body.participant_token || !serverUrl) {
      throw new Error('Token server response is missing the token or server URL.');
    }
    return { token: body.participant_token, serverUrl };
  }

  private refreshParticipants(room: Room) {
    const microphone = this.liveKit!.client.Track.Source.Microphone;
    const remotes = Array.from(room.remoteParticipants.values());
    const transmitting = remotes.filter((participant) => {
      const publication = participant.getTrackPublication(microphone);
      return Boolean(publication && !publication.isMuted);
    });
    const peers = remotes.map(peerFrom);
    const transmitters = transmitting.map(peerFrom);

    const now = Date.now();
    const previous = this.snapshot.transmitters;
    const events: WalkieEvent[] = [];
    for (const peer of transmitters) {
      if (!this.transmitStartedAt.has(peer.identity)) {
        this.transmitStartedAt.set(peer.identity, now);
        events.push({ type: 'remote-transmit-start', peer });
      }
    }
    for (const peer of previous) {
      if (!transmitters.some((t) => t.identity === peer.identity)) {
        const startedAt = this.transmitStartedAt.get(peer.identity) ?? now;
        this.transmitStartedAt.delete(peer.identity);
        events.push({
          type: 'remote-transmit-end',
          peer,
          durationSec: (now - startedAt) / 1000,
        });
      }
    }

    this.update({ peers, transmitters });
    this.updateDucking();
    events.forEach((event) => this.emit(event));
  }

  private handleCallout(payload: Uint8Array, participant: Participant) {
    try {
      const { text } = JSON.parse(new TextDecoder().decode(payload));
      if (typeof text === 'string' && text.trim()) {
        this.emit({
          type: 'remote-callout',
          peer: peerFrom(participant),
          text: text.slice(0, MAX_CALLOUT_LENGTH),
        });
      }
    } catch {
      // Ignore malformed messages from other clients.
    }
  }

  private teardown(error: string | null) {
    const room = this.room;
    const hadOpenMic = this.wantMic;
    this.room = null;
    this.wantMic = false;
    this.appliedMic = false;
    this.transmitStartedAt.clear();

    if (room) {
      room.removeAllListeners();
      room.disconnect().catch(() => {});
      this.liveKit?.AudioSession.stopAudioSession().catch(() => {});
    }
    this.update({
      connection: 'disconnected',
      peers: [],
      transmitters: [],
      isMicLive: false,
      error,
    });
    this.updateDucking();
    if (hadOpenMic) this.emit({ type: 'mic-failed' });
  }

  /** Keeps Spotify ducked while anyone in the pack is talking. */
  private updateDucking() {
    const shouldDuck = this.wantMic || this.snapshot.transmitters.length > 0;
    if (shouldDuck === this.isDucked) return;
    this.isDucked = shouldDuck;
    void setSpotifyVolumeDucking(
      shouldDuck ? DUCKED_VOLUME_PCT : 100,
      this.spotifyAccessToken
    );
  }

  private update(patch: Partial<WalkieSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.stateListeners.forEach((listener) => listener());
  }

  private emit(event: WalkieEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export const walkieTalkieController = new PackWalkieTalkieController();
