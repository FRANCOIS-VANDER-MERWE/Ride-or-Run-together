import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
  TextInput,
} from 'react-native';
import {
  Music2,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RefreshCw,
  Code2,
  CheckCircle2,
  Volume2,
  VolumeX,
  Activity,
  Cpu,
  Clock,
  Zap,
  ShieldAlert,
  AlertTriangle,
  Users,
} from './Icons';
import {
  ActivityMode,
  Athlete,
  BroadcastSignalEvent,
  SpotifyTrack,
} from '../data/sessionData';
import { localPitchStretchAudioEngine } from '../music/localAudioEngine';
import { groupMusicSyncCoordinator } from '../music/syncSessionEngine';
import {
  INTENSITY_BUCKETS,
  getBucketMeta,
} from '../music/intensityEngine';
import {
  CanonicalTrack,
  IntensityBucket,
  MemberPlaybackStatus,
  ProviderId,
} from '../music/types';

interface SpotifySyncDeckProps {
  mode?: ActivityMode;
  tracks: SpotifyTrack[];
  currentTrackIndex: number;
  isPlaying: boolean;
  progressSec: number;
  isVoiceDucked: boolean;
  athletes: Athlete[];
  broadcastLogs: BroadcastSignalEvent[];
  onTogglePlay: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSeekTrack: (newSec: number) => void;
  onForceResyncBroadcast: () => void;
  onSelectTrackIndex: (index: number) => void;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

function formatTrackTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const PROVIDER_META: Record<
  ProviderId,
  { label: string; short: string; color: string; bg: string; border: string }
> = {
  spotify: {
    label: 'Spotify (App Remote + PKCE)',
    short: 'SPOTIFY',
    color: '#1DB954',
    bg: 'rgba(29, 185, 84, 0.16)',
    border: 'rgba(29, 185, 84, 0.45)',
  },
  apple: {
    label: 'Apple Music (MusicKit iOS)',
    short: 'APPLE',
    color: '#FA243C',
    bg: 'rgba(250, 36, 60, 0.16)',
    border: 'rgba(250, 36, 60, 0.45)',
  },
  local: {
    label: 'Local Files (DJ Pitch-Stretch)',
    short: 'LOCAL DSP',
    color: '#00F0FF',
    bg: 'rgba(0, 240, 255, 0.16)',
    border: 'rgba(0, 240, 255, 0.45)',
  },
};

const STATUS_COLORS: Record<MemberPlaybackStatus, string> = {
  playing: '#34D399',
  paused: '#FBBF24',
  buffering: '#38BDF8',
  ready: '#A78BFA',
  unavailable: '#F97316',
  not_premium: '#FB7185',
  disconnected: '#EF4444',
};

export default function SpotifySyncDeck({
  mode = 'run',
  tracks,
  currentTrackIndex,
  isPlaying,
  progressSec,
  isVoiceDucked,
  athletes,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onSeekTrack,
  onForceResyncBroadcast,
  onSelectTrackIndex,
}: SpotifySyncDeckProps) {
  const [, setTick] = useState(0);
  const [showWireInspector, setShowWireInspector] = useState(true);
  const [barWidth, setBarWidth] = useState(260);
  const [lastTestBanner, setLastTestBanner] = useState<string | null>(null);
  const [songSearchQuery, setSongSearchQuery] = useState('');
  const [songSearchResults, setSongSearchResults] = useState<CanonicalTrack[]>(
    []
  );
  const [isSearchingSongs, setIsSearchingSongs] = useState(false);

  const handleSearchSongs = async (rawQuery?: string) => {
    const q = (rawQuery ?? songSearchQuery).trim();
    if (!q) {
      setSongSearchResults([]);
      return;
    }
    setIsSearchingSongs(true);
    try {
      const results = await groupMusicSyncCoordinator.searchAppleCatalog(q, 6);
      setSongSearchResults(results);
    } finally {
      setIsSearchingSongs(false);
    }
  };

  const handlePlayPickedSongNow = async (track: CanonicalTrack) => {
    const item = await groupMusicSyncCoordinator.playPickedTrackNow(track);
    const idx = groupMusicSyncCoordinator
      .getSessionState()
      .queue.findIndex((q) => q.queueItemId === item.queueItemId);
    if (idx >= 0 && idx < tracks.length) {
      onSelectTrackIndex(idx);
    }
    onSeekTrack(0);
    setLastTestBanner(
      `Now Playing: "${track.title}" — ${track.artist} (ISRC: ${track.isrc})`
    );
    setTick((t) => t + 1);
  };

  const handleEnqueuePickedSong = async (track: CanonicalTrack) => {
    await groupMusicSyncCoordinator.enqueueAndResolveTrack(track);
    setLastTestBanner(
      `Added to Pack Queue: "${track.title}" — ${track.artist} (ISRC: ${track.isrc})`
    );
    setTick((t) => t + 1);
  };

  useEffect(() => {
    const unsub = groupMusicSyncCoordinator.subscribe(() => {
      setTick((t) => t + 1);
    });
    const unsubAudio = localPitchStretchAudioEngine.subscribe(() => {
      setTick((t) => t + 1);
    });
    const appleProvider = groupMusicSyncCoordinator.getAppleMusicProvider();
    const unsubApple = appleProvider.onStateChange(() => {
      setTick((t) => t + 1);
    });
    if (!appleProvider.getMusicKitDiagnostic().isConfigured) {
      appleProvider.ensureMusicKitInstance().catch(() => null);
    }
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 250);
    return () => {
      unsub();
      unsubAudio();
      unsubApple();
      clearInterval(timer);
    };
  }, []);

  // Section 14.4: Duck music volume to 25% when someone speaks on Walkie-Talkie PTT
  useEffect(() => {
    groupMusicSyncCoordinator.setVoiceDucking(isVoiceDucked);
  }, [isVoiceDucked]);

  // Feed athlete telemetry into the IntensityEngine periodically when playing
  useEffect(() => {
    const samples = athletes.map((a) => ({
      userId: a.id,
      mode,
      cadence: a.cadence,
      speedMps: a.speedMph * 0.44704,
      heartRate: a.heartRate,
      atMs: Date.now(),
    }));
    groupMusicSyncCoordinator.intensity.ingestBatch(samples, Date.now(), false);
  }, [athletes, mode]);

  const sessionState = groupMusicSyncCoordinator.getSessionState();
  const members = groupMusicSyncCoordinator.getMembers();
  const wireLogs = groupMusicSyncCoordinator.getWireLogs();
  const activeProvider = groupMusicSyncCoordinator.getActiveProvider();
  const activeProviderId = groupMusicSyncCoordinator.getActiveProviderId();
  const providerStyle = PROVIDER_META[activeProviderId];
  const scheduledCountdownMs =
    groupMusicSyncCoordinator.getScheduledPlayCountdownMs();

  const fallbackTrack = tracks[currentTrackIndex] || tracks[0];
  const currentQueueItem =
    groupMusicSyncCoordinator.getCurrentQueueItem() ||
    sessionState.queue[currentTrackIndex];

  const currentTrack: SpotifyTrack = currentQueueItem
    ? {
        id: currentQueueItem.queueItemId,
        title: currentQueueItem.track.title,
        artist: currentQueueItem.track.artist,
        album: currentQueueItem.track.album || fallbackTrack.album,
        bpm: currentQueueItem.track.bpm ?? fallbackTrack.bpm,
        durationSec: Math.max(
          30,
          Math.round(currentQueueItem.track.durationMs / 1000)
        ),
        coverUrl: currentQueueItem.track.coverUrl || fallbackTrack.coverUrl,
        isrc: currentQueueItem.track.isrc,
        uri:
          currentQueueItem.track.providerIds.apple ||
          currentQueueItem.track.providerIds.spotify ||
          fallbackTrack.uri,
        targetMode: fallbackTrack.targetMode,
      }
    : fallbackTrack;

  const resolvedTrackIdForSelf =
    currentQueueItem?.track.providerIds[activeProviderId] ?? null;

  const rateRecommendation =
    groupMusicSyncCoordinator.intensity.computeRecommendedRate(
      activeProviderId,
      activeProvider.capabilities,
      currentQueueItem?.track.bpm ?? currentTrack.bpm,
      sessionState.targetBpm ?? currentTrack.bpm
    );

  const activeBucketMeta = getBucketMeta(sessionState.currentBucket);
  const intensityState = groupMusicSyncCoordinator.intensity.getState();

  const pctPlayed = Math.min(
    100,
    Math.max(0, (progressSec / currentTrack.durationSec) * 100)
  );

  const handleSelectTrack = async (idx: number) => {
    if (idx < tracks.length) {
      onSelectTrackIndex(idx);
    }
    const qItem = sessionState.queue[idx];
    if (qItem) {
      await groupMusicSyncCoordinator.playPickedTrackNow(qItem.track);
    }
  };

  const handleTogglePlayPause = async () => {
    onTogglePlay();
    if (isPlaying) {
      await groupMusicSyncCoordinator.leaderPause();
    } else {
      await groupMusicSyncCoordinator.leaderPlay(
        currentQueueItem?.queueItemId,
        progressSec * 1000,
        'leader:play (resume)'
      );
    }
  };

  const handleTriggerIntensityBucket = async (bucket: IntensityBucket) => {
    const targetBpmByBucket: Record<IntensityBucket, number> = {
      warmup: 122,
      cruise: 134,
      tempo: 158,
      push: 172,
    };
    const targetCadence = targetBpmByBucket[bucket];
    const samples = athletes.map((a, idx) => ({
      userId: a.id,
      mode: 'run' as ActivityMode,
      // Give one rider an outlier (e.g., stopped at a crosswalk at 95 spm) to prove Median robustness (Section 9.1)
      cadence: idx === 4 ? 95 : targetCadence + (idx - 1),
      heartRate: 145 + idx * 4,
      atMs: Date.now(),
    }));

    await groupMusicSyncCoordinator.ingestWorkoutIntensity(samples, {
      bypassHysteresis: true,
      reason: `Cadence ramp -> Median ${targetCadence} BPM (${bucket.toUpperCase()} bucket)`,
    });

    // Sync parent App.tsx track index with the newly selected queue item
    const updatedState = groupMusicSyncCoordinator.getSessionState();
    const newIdx = updatedState.queue.findIndex(
      (q) => q.queueItemId === updatedState.currentQueueItemId
    );
    if (newIdx !== -1 && newIdx !== currentTrackIndex) {
      onSelectTrackIndex(newIdx);
    }
    setLastTestBanner(
      `Intensity Engine -> ${bucket.toUpperCase()} (${targetCadence} BPM median; outlier 95 spm ignored by median)`
    );
  };

  return (
    <View style={styles.card}>
      {/* 1. HEADER & PROVIDER INTERFACE SWITCHER (Section 1 & 6) */}
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <View
            style={[
              styles.musicIconBox,
              {
                backgroundColor: providerStyle.bg,
                borderColor: providerStyle.border,
              },
            ]}
          >
            <Music2 size={16} color={providerStyle.color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Text
                style={[styles.spotifyLabel, { color: providerStyle.color }]}
              >
                GROUP MUSIC SYNC · {providerStyle.short} PROVIDER
              </Text>
              <View style={styles.bpmBadge}>
                <Text style={styles.bpmBadgeText}>
                  SEQ #{sessionState.sequence} · ISRC LOCKED
                </Text>
              </View>
            </View>
            <Text style={styles.deckTitle}>
              Synced Local Playback · Cross-Service ISRC &amp; BPM Engine
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              // MUST call authorizeFromUserGesture() synchronously on the first line of onPress
              // so browser popup blockers do not block the Apple ID sign-in window!
              const appleProv =
                groupMusicSyncCoordinator.getAppleMusicProvider();
              appleProv.authorizeFromUserGesture().then(async (res) => {
                await groupMusicSyncCoordinator.switchSelfProvider('apple');
                setLastTestBanner(res.message);
              });
            }}
            style={[
              styles.translatorToggleBtn,
              {
                backgroundColor: 'rgba(250, 36, 60, 0.22)',
                borderColor: '#FA243C',
              },
            ]}
          >
            <Music2 size={13} color="#FA243C" />
            <Text style={[styles.translatorToggleText, { color: '#FFFFFF' }]}>
              {groupMusicSyncCoordinator
                .getAppleMusicProvider()
                .getMusicKitDiagnostic().isAuthorized
                ? 'Apple Music: Signed In'
                : 'Sign In Apple Music'}
            </Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              const res =
                await groupMusicSyncCoordinator.toggleAppleLiveStream();
              setLastTestBanner(res.streamSummary);
            }}
            style={[
              styles.translatorToggleBtn,
              groupMusicSyncCoordinator
                .getAppleMusicProvider()
                .isLiveStreamEnabled() && {
                backgroundColor: 'rgba(250, 36, 60, 0.2)',
                borderColor: '#FA243C',
              },
            ]}
          >
            <Music2
              size={13}
              color={
                groupMusicSyncCoordinator
                  .getAppleMusicProvider()
                  .isLiveStreamEnabled()
                  ? '#FA243C'
                  : '#94A3B8'
              }
            />
            <Text
              style={[
                styles.translatorToggleText,
                groupMusicSyncCoordinator
                  .getAppleMusicProvider()
                  .isLiveStreamEnabled() && { color: '#FA243C' },
              ]}
            >
              {groupMusicSyncCoordinator
                .getAppleMusicProvider()
                .isLiveStreamEnabled()
                ? 'Apple CDN: LIVE'
                : 'Stream Apple CDN'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              const nextAudio =
                !localPitchStretchAudioEngine.isAudioMonitorActive();
              if (nextAudio) {
                groupMusicSyncCoordinator
                  .getAppleMusicProvider()
                  .setLiveStreamEnabled(false);
              }
              const localTrackId =
                currentQueueItem?.track.providerIds.local ||
                'local:asset:hyperdrive_cadence_170.wav';
              localPitchStretchAudioEngine.setTrack(localTrackId);
              localPitchStretchAudioEngine.setPlaying(isPlaying);
              localPitchStretchAudioEngine.setAudioMonitorActive(nextAudio);
              setLastTestBanner(
                nextAudio
                  ? `Live Audio Synth Monitor ON (${localPitchStretchAudioEngine.getEffectiveBpm()} BPM pitch-locked loop)`
                  : 'Live Audio Synth Monitor muted'
              );
            }}
            style={[
              styles.translatorToggleBtn,
              localPitchStretchAudioEngine.isAudioMonitorActive() && {
                backgroundColor: 'rgba(0, 240, 255, 0.18)',
                borderColor: '#00F0FF',
              },
            ]}
          >
            {localPitchStretchAudioEngine.isAudioMonitorActive() ? (
              <Volume2 size={13} color="#00F0FF" />
            ) : (
              <VolumeX size={13} color="#94A3B8" />
            )}
            <Text
              style={[
                styles.translatorToggleText,
                localPitchStretchAudioEngine.isAudioMonitorActive() && {
                  color: '#00F0FF',
                },
              ]}
            >
              {localPitchStretchAudioEngine.isAudioMonitorActive()
                ? `Audio ON (${localPitchStretchAudioEngine.getEffectiveBpm()} BPM)`
                : 'Audio Synth'}
            </Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              onForceResyncBroadcast();
              const qItem = sessionState.queue[currentTrackIndex];
              await groupMusicSyncCoordinator.leaderPlay(
                qItem?.queueItemId,
                progressSec * 1000,
                'leader:play (resync)'
              );
              setLastTestBanner(
                'Scheduled playback:play at serverNow + 1500ms across all providers'
              );
            }}
            style={styles.resyncBtn}
          >
            <RefreshCw size={13} color="#1DB954" />
            <Text style={styles.resyncBtnText}>Schedule +1.5s Play</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowWireInspector((v) => !v)}
            style={[
              styles.translatorToggleBtn,
              showWireInspector && styles.translatorToggleBtnActive,
            ]}
          >
            <Code2
              size={13}
              color={showWireInspector ? '#D4FF00' : '#94A3B8'}
            />
            <Text
              style={[
                styles.translatorToggleText,
                showWireInspector && { color: '#D4FF00' },
              ]}
            >
              Wire Protocol
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 2. MUSIC PROVIDER SELECTOR (`MusicProvider` Interface — Section 6) */}
      <View style={styles.providerSelectorBox}>
        <View style={styles.sectionSubHeader}>
          <Text style={styles.sectionSubTitle}>
            ACTIVE LOCAL `MusicProvider` IMPLEMENTATION (SECTION 6)
          </Text>
          <Text style={styles.sectionSubMeta}>
            rate: {rateRecommendation.rate.toFixed(2)}x
          </Text>
        </View>

        <View style={styles.providerPillsRow}>
          {(['spotify', 'apple', 'local'] as ProviderId[]).map((pid) => {
            const active = activeProviderId === pid;
            const pMeta = PROVIDER_META[pid];
            return (
              <Pressable
                key={pid}
                onPress={async () => {
                  await groupMusicSyncCoordinator.switchSelfProvider(pid);
                  setLastTestBanner(
                    `Switched local phone to ${pMeta.label}`
                  );
                }}
                style={[
                  styles.providerTabBtn,
                  active && {
                    backgroundColor: pMeta.bg,
                    borderColor: pMeta.color,
                  },
                ]}
              >
                <View
                  style={[
                    styles.providerDot,
                    { backgroundColor: active ? pMeta.color : '#64748B' },
                  ]}
                />
                <Text
                  style={[
                    styles.providerTabText,
                    active && { color: '#FFFFFF', fontWeight: '800' },
                  ]}
                >
                  {pMeta.short}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Provider Capabilities Matrix (`provider.capabilities`) */}
        <View style={styles.capabilitiesWrap}>
          {[
            {
              key: 'canSetRate',
              val: activeProvider.capabilities.canSetRate,
              note:
                activeProviderId === 'local'
                  ? 'Pitch-Lock DSP'
                  : activeProviderId === 'apple'
                  ? 'iOS ±8% only'
                  : 'Forbidden by DRM',
            },
            {
              key: 'canCrossfade',
              val: activeProvider.capabilities.canCrossfade,
            },
            {
              key: 'requiresPremium',
              val: activeProvider.capabilities.requiresPremium,
            },
            {
              key: 'requiresExternalApp',
              val: activeProvider.capabilities.requiresExternalApp,
            },
          ].map((cap) => (
            <View key={cap.key} style={styles.capChip}>
              <Text style={styles.capKeyText}>{cap.key}:</Text>
              <Text
                style={[
                  styles.capValText,
                  { color: cap.val ? '#D4FF00' : '#94A3B8' },
                ]}
              >
                {String(cap.val)}
                {cap.note ? ` (${cap.note})` : ''}
              </Text>
            </View>
          ))}
        </View>

        {/* Live Apple MusicKit JS v3 & .p8 Token Diagnostic Bar */}
        {(() => {
          const diag = groupMusicSyncCoordinator
            .getAppleMusicProvider()
            .getMusicKitDiagnostic();
          return (
            <View style={styles.capabilitiesWrap}>
              <View style={styles.capChip}>
                <Text style={styles.capKeyText}>.p8 Token:</Text>
                <Text
                  style={[
                    styles.capValText,
                    { color: diag.hasToken ? '#34D399' : '#FB7185' },
                  ]}
                >
                  {diag.hasToken ? 'LOADED' : 'RESTART EXPO (-c)'}
                </Text>
              </View>
              <Pressable
                style={styles.capChip}
                onPress={() => {
                  groupMusicSyncCoordinator
                    .getAppleMusicProvider()
                    .ensureMusicKitInstance()
                    .then(() => setTick((t) => t + 1));
                }}
              >
                <Text style={styles.capKeyText}>MusicKit JS:</Text>
                <Text
                  style={[
                    styles.capValText,
                    { color: diag.isConfigured ? '#34D399' : '#FBBF24' },
                  ]}
                >
                  {diag.isConfigured ? 'CONFIGURED' : diag.stepLabel}
                </Text>
              </Pressable>
              <View style={styles.capChip}>
                <Text style={styles.capKeyText}>Apple Auth:</Text>
                <Text
                  style={[
                    styles.capValText,
                    { color: diag.isAuthorized ? '#34D399' : '#94A3B8' },
                  ]}
                >
                  {diag.isAuthorized ? 'AUTHORIZED' : 'CLICK SIGN IN'}
                </Text>
              </View>
              <View style={styles.capChip}>
                <Text style={styles.capKeyText}>Audio Engine:</Text>
                <Text
                  style={[
                    styles.capValText,
                    {
                      color: diag.audioDebug.includes('PLAYING')
                        ? '#D4FF00'
                        : '#94A3B8',
                    },
                  ]}
                >
                  {diag.audioDebug}
                </Text>
              </View>
              {diag.lastError && (
                <View
                  style={[
                    styles.capChip,
                    { borderColor: 'rgba(251, 113, 133, 0.45)' },
                  ]}
                >
                  <Text style={[styles.capValText, { color: '#FB7185' }]}>
                    {diag.lastError}
                  </Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Section 6.4 & 9.4: DJ Pitch-Preserving Time-Stretch Rate Controls */}
        <View style={styles.rateStretchBar}>
          <Text style={styles.rateStretchLabel}>
            DJ TIME-STRETCH (`provider.setRate`):
          </Text>
          <View style={styles.rateButtonsWrap}>
            {[0.85, 0.92, 1.0, 1.08, 1.15, 1.22].map((r) => {
              const selfMember = members.find((m) => m.isSelf);
              const isCurrentRate =
                Math.abs((selfMember?.playbackRate || 1.0) - r) < 0.02;
              return (
                <Pressable
                  key={r}
                  onPress={async () => {
                    const res =
                      await groupMusicSyncCoordinator.setManualPlaybackRate(r);
                    setLastTestBanner(res.message);
                  }}
                  style={[
                    styles.ratePillBtn,
                    isCurrentRate && {
                      backgroundColor: providerStyle.bg,
                      borderColor: providerStyle.color,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.ratePillText,
                      isCurrentRate && {
                        color: providerStyle.color,
                        fontWeight: '800',
                      },
                    ]}
                  >
                    {r.toFixed(2)}x
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* 3. AUTHORITATIVE SESSION CLOCK & DERIVED POSITION BAR (Section 4 & 7) */}
      <View style={styles.clockBanner}>
        <View style={styles.clockItem}>
          <Clock size={12} color="#00F0FF" />
          <Text style={styles.clockLabel}>trackStartedAtServerMs:</Text>
          <Text style={styles.clockValue}>
            {sessionState.trackStartedAtServerMs
              ? `${sessionState.trackStartedAtServerMs}`
              : `null (paused @ ${Math.round(progressSec * 1000)}ms)`}
          </Text>
        </View>

        <View style={styles.clockItem}>
          <Text style={styles.clockLabel}>NTP Offset / RTT:</Text>
          <Text style={[styles.clockValue, { color: '#34D399' }]}>
            {groupMusicSyncCoordinator.clock.getAppliedOffsetMs() >= 0
              ? '+'
              : ''}
            {groupMusicSyncCoordinator.clock.getAppliedOffsetMs()}ms /{' '}
            {groupMusicSyncCoordinator.clock.getLastRttMs()}ms
          </Text>
          {scheduledCountdownMs > 0 && (
            <View style={styles.scheduledPill}>
              <Text style={styles.scheduledPillText}>
                PLAY IN +{scheduledCountdownMs}ms
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* 4. NOW PLAYING CARD + CANONICAL TRACK / ISRC RESOLUTION */}
      <View style={styles.nowPlayingBox}>
        {resolvedTrackIdForSelf === null && (
          <View style={styles.unavailableAlert}>
            <AlertTriangle size={14} color="#F97316" />
            <Text style={styles.unavailableAlertText}>
              Not on your service ({activeProviderId.toUpperCase()}), back at the
              next song (Section 14 per-member graceful degradation)
            </Text>
          </View>
        )}

        <View style={styles.trackMainRow}>
          <View style={styles.coverWrap}>
            <Image
              source={{ uri: currentTrack.coverUrl }}
              style={styles.coverImg}
            />
            <View
              style={[
                styles.coverBpmTag,
                { backgroundColor: providerStyle.color },
              ]}
            >
              <Text style={styles.coverBpmTagText}>
                {currentTrack.bpm} BPM
              </Text>
            </View>
          </View>

          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.trackTitleRow}>
              <Text style={styles.trackTitle} numberOfLines={1}>
                {currentTrack.title}
              </Text>
              <View
                style={[
                  styles.volTag,
                  isVoiceDucked && styles.volTagDucked,
                ]}
              >
                <Volume2
                  size={11}
                  color={isVoiceDucked ? '#FF4D2A' : '#CBD5E1'}
                />
                <Text
                  style={[
                    styles.volTagText,
                    isVoiceDucked && { color: '#FF4D2A' },
                  ]}
                >
                  {isVoiceDucked ? 'DUCKED 25%' : 'VOL 100%'}
                </Text>
              </View>
            </View>

            <Text style={styles.trackArtist} numberOfLines={1}>
              {currentTrack.artist} · ISRC:{' '}
              <Text style={{ color: '#D4FF00', fontFamily: MONO_FONT }}>
                {currentQueueItem?.track.isrc || currentTrack.isrc || 'USRC17607839'}
              </Text>
            </Text>

            <Text style={styles.rateExplainText} numberOfLines={1}>
              {rateRecommendation.explanation}
            </Text>

            {/* Interactive Scrubber Bar */}
            <Pressable
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0) setBarWidth(w);
              }}
              onPress={async (e) => {
                const x = e.nativeEvent.locationX;
                if (typeof x === 'number' && barWidth > 0) {
                  const ratio = Math.max(0, Math.min(1, x / barWidth));
                  const nextSec = Math.round(ratio * currentTrack.durationSec);
                  onSeekTrack(nextSec);
                  await groupMusicSyncCoordinator.leaderSeek(nextSec * 1000);
                }
              }}
              style={styles.scrubberOuter}
            >
              <View
                style={[
                  styles.scrubberFill,
                  {
                    width: `${pctPlayed}%`,
                    backgroundColor: providerStyle.color,
                  },
                ]}
              />
            </Pressable>

            <View style={styles.scrubberMetaRow}>
              <Text style={styles.scrubberTime}>
                {formatTrackTime(progressSec)}
              </Text>
              <Text
                style={[styles.scrubberUri, { color: providerStyle.color }]}
                numberOfLines={1}
              >
                {resolvedTrackIdForSelf || 'UNAVAILABLE ON THIS SERVICE'}
              </Text>
              <Text style={styles.scrubberTime}>
                {formatTrackTime(currentTrack.durationSec)}
              </Text>
            </View>
          </View>
        </View>

        {/* Playback Controls + Pre-Resolved ISRC Queue Selector */}
        <View style={styles.controlsBar}>
          <View style={styles.transportRow}>
            <Pressable
              onPress={async () => {
                onPrevTrack();
                const prevIdx =
                  (currentTrackIndex - 1 + tracks.length) % tracks.length;
                const qItem = sessionState.queue[prevIdx];
                if (qItem) {
                  await groupMusicSyncCoordinator.leaderPlay(
                    qItem.queueItemId,
                    0,
                    'leader:skip (prev)'
                  );
                }
              }}
              style={styles.skipBtn}
            >
              <SkipBack size={15} color="#FFFFFF" />
            </Pressable>

            <Pressable
              onPress={handleTogglePlayPause}
              style={[
                styles.playPauseBtn,
                { backgroundColor: providerStyle.color },
              ]}
            >
              {isPlaying ? (
                <>
                  <Pause size={15} color="#080B10" />
                  <Text style={styles.playPauseText}>Pause Pack</Text>
                </>
              ) : (
                <>
                  <Play size={15} color="#080B10" />
                  <Text style={styles.playPauseText}>Schedule Play</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={async () => {
                onNextTrack();
                await groupMusicSyncCoordinator.leaderSkip();
              }}
              style={styles.skipBtn}
            >
              <SkipForward size={15} color="#FFFFFF" />
            </Pressable>

            <Pressable
              onPress={async () => {
                const nextSec = Math.min(
                  currentTrack.durationSec - 5,
                  progressSec + 30
                );
                onSeekTrack(nextSec);
                await groupMusicSyncCoordinator.leaderSeek(nextSec * 1000);
              }}
              style={styles.seekJumpBtn}
            >
              <Text style={styles.seekJumpText}>+30s Scheduled Seek</Text>
            </Pressable>
          </View>

          {/* Pre-Resolved Canonical Queue Items with Cross-Service ISRC Status */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bpmPillsRow}
          >
            {sessionState.queue.map((qItem, idx) => {
              const active =
                qItem.queueItemId === sessionState.currentQueueItemId;
              const isUnavailableOnActive =
                qItem.resolution[activeProviderId] === 'unavailable';
              return (
                <Pressable
                  key={qItem.queueItemId}
                  onPress={() => handleSelectTrack(idx)}
                  style={[
                    styles.bpmTrackPill,
                    active && {
                      backgroundColor: providerStyle.bg,
                      borderColor: providerStyle.color,
                    },
                    isUnavailableOnActive && styles.bpmTrackPillUnavailable,
                  ]}
                >
                  <Text
                    style={[
                      styles.bpmTrackPillText,
                      active && {
                        color: providerStyle.color,
                        fontWeight: '800',
                      },
                      isUnavailableOnActive && { color: '#F97316' },
                    ]}
                  >
                    {qItem.track.bpm ?? 140} BPM ·{' '}
                    {qItem.track.title.split(' ')[0]}
                    {isUnavailableOnActive ? ' (UNAVAIL)' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Live Apple Music Song Search & Instant Picker */}
          <View style={styles.songPickerBox}>
            <View style={styles.songPickerHeaderRow}>
              <Text style={styles.songPickerTitle}>
                PICK ANY SONG · LIVE APPLE MUSIC CATALOG SEARCH
              </Text>
              {songSearchResults.length > 0 && (
                <Pressable
                  onPress={() => {
                    setSongSearchResults([]);
                    setSongSearchQuery('');
                  }}
                >
                  <Text style={styles.songPickerClearText}>Clear</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.songSearchInputRow}>
              <TextInput
                value={songSearchQuery}
                onChangeText={setSongSearchQuery}
                onSubmitEditing={() => handleSearchSongs()}
                placeholder="Search any song or artist (e.g. The Weeknd, Fred again, Daft Punk)..."
                placeholderTextColor="#64748B"
                style={styles.songSearchInput}
              />
              <Pressable
                onPress={() => handleSearchSongs()}
                style={styles.songSearchSubmitBtn}
              >
                <Text style={styles.songSearchSubmitText}>
                  {isSearchingSongs ? 'Searching...' : 'Search'}
                </Text>
              </Pressable>
            </View>

            {/* Quick One-Tap Search Suggestions */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickQueriesRow}
            >
              {[
                'The Weeknd Blinding Lights',
                'Fred again Delilah',
                'Daft Punk One More Time',
                'Kendrick Lamar Not Like Us',
                'RÜFÜS DU SOL Innerbloom',
                'Calvin Harris Miracle',
              ].map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => {
                    setSongSearchQuery(preset);
                    handleSearchSongs(preset);
                  }}
                  style={styles.quickQueryChip}
                >
                  <Text style={styles.quickQueryChipText}>{preset}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Search Results List */}
            {songSearchResults.length > 0 && (
              <View style={styles.songResultsList}>
                {songSearchResults.map((item) => (
                  <View
                    key={`${item.isrc}-${item.providerIds.apple}`}
                    style={styles.songResultCard}
                  >
                    <Image
                      source={{ uri: item.coverUrl }}
                      style={styles.songResultArt}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.songResultTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.songResultSub} numberOfLines={1}>
                        {item.artist} · {item.album}
                      </Text>
                      <Text style={styles.songResultIsrc}>
                        ISRC: {item.isrc} · {item.bpm ?? 140} BPM
                      </Text>
                    </View>
                    <View style={styles.songResultBtnsCol}>
                      <Pressable
                        onPress={() => handlePlayPickedSongNow(item)}
                        style={styles.playPickedNowBtn}
                      >
                        <Play size={11} color="#080B10" />
                        <Text style={styles.playPickedNowBtnText}>
                          Play Now
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleEnqueuePickedSong(item)}
                        style={styles.enqueuePickedBtn}
                      >
                        <Text style={styles.enqueuePickedBtnText}>+ Queue</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 5. INTENSITY-TO-BPM ENGINE & TRANSITION POLICY (Section 9) */}
      <View style={styles.intensityBox}>
        <View style={styles.intensityHeaderRow}>
          <View style={styles.translatorTitleWrap}>
            <Zap size={14} color={activeBucketMeta.color} />
            <Text style={styles.intensityTitle}>
              INTENSITY -&gt; BPM ENGINE (MEDIAN + 30s EWMA + 15s HYSTERESIS)
            </Text>
          </View>

          <View style={styles.modeToggleRow}>
            {(['manual', 'auto_bpm'] as const).map((m) => {
              const active = sessionState.intensityMode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => groupMusicSyncCoordinator.setIntensityMode(m)}
                  style={[
                    styles.miniModePill,
                    active && styles.miniModePillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.miniModePillText,
                      active && styles.miniModePillTextActive,
                    ]}
                  >
                    {m === 'auto_bpm' ? 'AUTO BPM' : 'MANUAL'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.intensityStatsRow}>
          <View style={styles.intensityMetricCard}>
            <Text style={styles.intensityMetricLabel}>GROUP MEDIAN</Text>
            <Text style={styles.intensityMetricValue}>
              {intensityState.rawMedianBpm} BPM
            </Text>
            <Text style={styles.intensityMetricSub}>
              Outlier-proof (Sec 9.1)
            </Text>
          </View>

          <View style={styles.intensityMetricCard}>
            <Text style={styles.intensityMetricLabel}>SMOOTHED TARGET</Text>
            <Text
              style={[
                styles.intensityMetricValue,
                { color: activeBucketMeta.color },
              ]}
            >
              {sessionState.targetBpm ?? currentTrack.bpm} BPM
            </Text>
            <Text style={styles.intensityMetricSub}>30s EWMA + 15s Hold</Text>
          </View>

          <View style={styles.intensityMetricCard}>
            <Text style={styles.intensityMetricLabel}>ACTIVE BUCKET</Text>
            <Text
              style={[
                styles.intensityMetricValue,
                { color: activeBucketMeta.color },
              ]}
            >
              {activeBucketMeta.label.toUpperCase()}
            </Text>
            <Text style={styles.intensityMetricSub}>
              {activeBucketMeta.minBpm}–{activeBucketMeta.maxBpm} BPM
            </Text>
          </View>
        </View>

        {/* Bucket Ramp Simulation Buttons (Section 9.2 & 12 Intensity Transition Test) */}
        <View style={styles.bucketButtonsRow}>
          {INTENSITY_BUCKETS.map((b) => {
            const isCurrent = sessionState.currentBucket === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => handleTriggerIntensityBucket(b.id)}
                style={[
                  styles.bucketBtn,
                  isCurrent && {
                    borderColor: b.color,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.bucketBtnTitle,
                    { color: isCurrent ? b.color : '#E2E8F0' },
                  ]}
                >
                  {b.label}
                </Text>
                <Text style={styles.bucketBtnRange}>
                  {b.minBpm}–{b.maxBpm}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 6. PER-MEMBER MULTI-PROVIDER STATES & ERROR MATRIX TEST BENCH (Section 12 & 14) */}
      <View style={styles.membersBox}>
        <View style={styles.sectionSubHeader}>
          <View style={styles.translatorTitleWrap}>
            <Users size={13} color="#00F0FF" />
            <Text style={styles.sectionSubTitle}>
              PACK MEMBERS · MIXED PROVIDERS &amp; DRIFT TELEMETRY
            </Text>
          </View>
          <Text style={styles.sectionSubMeta}>Target &lt; 500ms</Text>
        </View>

        {members.map((m) => {
          const pMeta = PROVIDER_META[m.provider];
          const statusColor = STATUS_COLORS[m.status];
          const isLeader = sessionState.leaderUserId === m.userId;
          return (
            <View key={m.userId} style={styles.memberRow}>
              <View style={styles.memberLeft}>
                <View
                  style={[
                    styles.driftDot,
                    { backgroundColor: statusColor },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.memberNameLine}>
                    <Text style={styles.memberNameText}>
                      {m.displayName}
                    </Text>
                    {isLeader && (
                      <View style={styles.leaderTag}>
                        <Text style={styles.leaderTagText}>LEADER</Text>
                      </View>
                    )}
                    <View
                      style={[
                        styles.memberProviderPill,
                        {
                          backgroundColor: pMeta.bg,
                          borderColor: pMeta.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.memberProviderText,
                          { color: pMeta.color },
                        ]}
                      >
                        {pMeta.short}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.memberNoteText} numberOfLines={1}>
                    {m.statusNote || m.status}
                  </Text>
                </View>
              </View>

              <View style={styles.memberRight}>
                <Text style={[styles.memberStatusBadge, { color: statusColor }]}>
                  {m.status.toUpperCase()}
                </Text>
                <Text style={styles.memberDriftText}>
                  {m.lastDriftMs >= 0 ? `+${m.lastDriftMs}ms` : `${m.lastDriftMs}ms`} ·{' '}
                  {m.playbackRate.toFixed(2)}x
                </Text>
              </View>
            </View>
          );
        })}

        {/* Section 12 & 14 Interactive Verification Buttons */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.testActionsRow}
        >
          <Pressable
            onPress={() => {
              const res = groupMusicSyncCoordinator.runClockPing();
              setLastTestBanner(
                `Clock Ping -> RTT ${res.rttMs}ms, smoothed offset ${res.appliedOffsetMs}ms`
              );
            }}
            style={styles.testActionChip}
          >
            <Text style={styles.testActionText}>7.3 Clock Ping</Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              const res = await groupMusicSyncCoordinator.runDriftCheck(465);
              setLastTestBanner(
                `7.2 Drift Check (+465ms > 400ms bar) -> Triggered ${res.actionTaken} resync`
              );
            }}
            style={styles.testActionChip}
          >
            <Text style={styles.testActionText}>7.2 Drift &gt;400ms Resync</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              groupMusicSyncCoordinator.simulateLateJoin('athlete-marcus');
              setLastTestBanner(
                '7.6 Late Join -> Marcus derived position from trackStartedAtServerMs (<250ms)'
              );
            }}
            style={styles.testActionChip}
          >
            <Text style={styles.testActionText}>7.6 Late Join Mid-Track</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              groupMusicSyncCoordinator.simulateLeaderPromotion();
              setLastTestBanner(
                '7.7 Leader Disconnect >20s -> Promoted next member without stopping playback'
              );
            }}
            style={styles.testActionChip}
          >
            <Text style={styles.testActionText}>7.7 Leader Failover</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              const marcus = members.find((m) => m.userId === 'athlete-marcus');
              const nextStatus: MemberPlaybackStatus =
                marcus?.status === 'not_premium' ? 'playing' : 'not_premium';
              groupMusicSyncCoordinator.setMemberSimulatedStatus(
                'athlete-marcus',
                nextStatus
              );
              setLastTestBanner(
                `14 Error Matrix -> Marcus set to "${nextStatus}" (Free tier listener-only mode)`
              );
            }}
            style={styles.testActionChip}
          >
            <Text style={styles.testActionText}>14 Free-Tier State</Text>
          </Pressable>
        </ScrollView>

        {lastTestBanner && (
          <View style={styles.testResultBanner}>
            <CheckCircle2 size={12} color="#D4FF00" />
            <Text style={styles.testResultText}>{lastTestBanner}</Text>
          </View>
        )}
      </View>

      {/* 7. SEQUENCED WIRE PROTOCOL & ISRC RESOLVER INSPECTOR (Section 5 & 8) */}
      {showWireInspector && (
        <View style={styles.translatorBox}>
          <View style={styles.translatorHeader}>
            <View style={styles.translatorTitleWrap}>
              <Cpu size={13} color="#D4FF00" />
              <Text style={styles.translatorTitle}>
                Sequenced Wire Protocol &amp; Cross-Service ISRC Resolver
              </Text>
            </View>
            <View style={styles.peersBadge}>
              <CheckCircle2 size={12} color="#34D399" />
              <Text style={styles.peersBadgeText}>
                seq #{sessionState.sequence} · &lt;250ms sync
              </Text>
            </View>
          </View>

          {/* Current Track Cross-Service ISRC Resolution Map */}
          {currentQueueItem && (
            <View style={styles.isrcResolutionCard}>
              <Text style={styles.isrcHeaderTitle}>
                CANONICAL TRACK ISRC: {currentQueueItem.track.isrc} · BPM SOURCE:{' '}
                {(currentQueueItem.track.bpmSource || 'curated').toUpperCase()}
              </Text>
              <View style={styles.isrcProvidersGrid}>
                {(['spotify', 'apple', 'local'] as ProviderId[]).map((pid) => {
                  const status = currentQueueItem.resolution[pid] || 'pending';
                  const resolvedId = currentQueueItem.track.providerIds[pid];
                  const note = currentQueueItem.resolutionNotes?.[pid];
                  return (
                    <View key={pid} style={styles.isrcProviderLine}>
                      <Text
                        style={[
                          styles.isrcProviderName,
                          { color: PROVIDER_META[pid].color },
                        ]}
                      >
                        {pid.toUpperCase()}:
                      </Text>
                      <Text style={styles.isrcProviderId} numberOfLines={1}>
                        {resolvedId || 'UNAVAILABLE'}
                        {note ? ` (${note})` : ''}
                      </Text>
                      <Text
                        style={[
                          styles.isrcStatusTag,
                          {
                            color:
                              status === 'resolved' ? '#34D399' : '#F97316',
                          },
                        ]}
                      >
                        {status.toUpperCase()}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Recent Wire Protocol Events */}
          <View style={styles.pipelineGrid}>
            {wireLogs.slice(0, 4).map((entry) => (
              <View key={entry.id} style={styles.pipelineCard}>
                <View style={styles.pipelineStepRow}>
                  <Text style={[styles.pipelineStepTitle, { color: '#D4FF00' }]}>
                    [{entry.direction}] {entry.eventName}
                    {entry.sequence !== null ? ` (seq #${entry.sequence})` : ''}
                  </Text>
                  <Text style={styles.pipelineTimestamp}>{entry.timestamp}</Text>
                </View>
                <Text style={styles.pipelineEndpoint}>{entry.summary}</Text>
                <Text style={styles.pipelineMeta} numberOfLines={1}>
                  {entry.payloadPreview}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Footer status */}
      <View style={styles.footerRow}>
        <View style={styles.footerItem}>
          <Activity size={13} color="#1DB954" />
          <Text style={styles.footerText}>
            No Spotify Jam / No SharePlay · Synced Local Playback via ISRC
          </Text>
        </View>
        <View style={styles.footerItem}>
          <ShieldAlert size={12} color="#94A3B8" />
          <Text style={styles.footerText}>
            BPM via ReccoBeats/Curated (No 403 audio-features)
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0E131D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  musicIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(29, 185, 84, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  spotifyLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#1DB954',
    letterSpacing: 0.5,
  },
  bpmBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(212, 255, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.35)',
  },
  bpmBadgeText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
  },
  deckTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.5)',
  },
  resyncBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#1DB954',
  },
  translatorToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  translatorToggleBtnActive: {
    backgroundColor: 'rgba(212, 255, 0, 0.15)',
    borderColor: 'rgba(212, 255, 0, 0.5)',
  },
  translatorToggleText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
  },
  providerSelectorBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    gap: 8,
  },
  sectionSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  sectionSubTitle: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#CBD5E1',
    letterSpacing: 0.4,
  },
  sectionSubMeta: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#00F0FF',
  },
  providerPillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  providerTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  providerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  providerTabText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
  },
  capabilitiesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  capChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  capKeyText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#64748B',
  },
  capValText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
  },
  rateStretchBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  rateStretchLabel: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
  },
  rateButtonsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  ratePillBtn: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  ratePillText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  clockBanner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#111726',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.25)',
  },
  clockItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  clockLabel: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  clockValue: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scheduledPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#D4FF00',
  },
  scheduledPillText: {
    fontSize: 8.5,
    fontFamily: MONO_FONT,
    fontWeight: '900',
    color: '#080B10',
  },
  nowPlayingBox: {
    backgroundColor: '#080B10',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 12,
  },
  unavailableAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  unavailableAlertText: {
    flex: 1,
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#FDBA74',
    fontWeight: '700',
  },
  trackMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coverWrap: {
    position: 'relative',
  },
  coverImg: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  coverBpmTag: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1DB954',
  },
  coverBpmTagText: {
    fontSize: 8,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#080B10',
  },
  trackTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  trackTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
  },
  volTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  volTagDucked: {
    backgroundColor: 'rgba(255, 77, 42, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 42, 0.45)',
  },
  volTagText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  trackArtist: {
    fontSize: 11,
    color: '#94A3B8',
  },
  rateExplainText: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#00F0FF',
  },
  scrubberOuter: {
    height: 8,
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 4,
  },
  scrubberFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1DB954',
  },
  scrubberMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  scrubberTime: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  scrubberUri: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#1DB954',
    flex: 1,
    textAlign: 'center',
  },
  controlsBar: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skipBtn: {
    padding: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playPauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: '#1DB954',
  },
  playPauseText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#080B10',
    textTransform: 'uppercase',
  },
  seekJumpBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  seekJumpText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  bpmPillsRow: {
    gap: 6,
  },
  bpmTrackPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bpmTrackPillUnavailable: {
    borderColor: 'rgba(249, 115, 22, 0.45)',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  bpmTrackPillText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  intensityBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 10,
  },
  intensityHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  intensityTitle: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#E2E8F0',
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  miniModePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  miniModePillActive: {
    backgroundColor: 'rgba(212, 255, 0, 0.18)',
    borderColor: '#D4FF00',
  },
  miniModePillText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
  },
  miniModePillTextActive: {
    color: '#D4FF00',
  },
  intensityStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  intensityMetricCard: {
    flex: 1,
    backgroundColor: '#111726',
    borderRadius: 9,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 2,
  },
  intensityMetricLabel: {
    fontSize: 8.5,
    fontFamily: MONO_FONT,
    color: '#64748B',
    fontWeight: '700',
  },
  intensityMetricValue: {
    fontSize: 13,
    fontFamily: MONO_FONT,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  intensityMetricSub: {
    fontSize: 8.5,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  bucketButtonsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  bucketBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bucketBtnTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  bucketBtnRange: {
    fontSize: 8.5,
    fontFamily: MONO_FONT,
    color: '#64748B',
  },
  membersBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  memberNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  memberNameText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  leaderTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(212, 255, 0, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.45)',
  },
  leaderTagText: {
    fontSize: 8,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#D4FF00',
  },
  memberProviderPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  memberProviderText: {
    fontSize: 8,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  memberNoteText: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    marginTop: 1,
  },
  memberRight: {
    alignItems: 'flex-end',
  },
  memberStatusBadge: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  memberDriftText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  driftDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  testActionsRow: {
    gap: 6,
    paddingTop: 4,
  },
  testActionChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.3)',
  },
  testActionText: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#00F0FF',
  },
  testResultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(212, 255, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.35)',
  },
  testResultText: {
    flex: 1,
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#D4FF00',
  },
  translatorBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.32)',
    gap: 10,
  },
  translatorHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  translatorTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  translatorTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
    textTransform: 'uppercase',
  },
  peersBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  peersBadgeText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#34D399',
  },
  isrcResolutionCard: {
    padding: 9,
    borderRadius: 9,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 5,
  },
  isrcHeaderTitle: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#D4FF00',
  },
  isrcProvidersGrid: {
    gap: 3,
  },
  isrcProviderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  isrcProviderName: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    width: 62,
  },
  isrcProviderId: {
    flex: 1,
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  isrcStatusTag: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  pipelineGrid: {
    gap: 8,
  },
  pipelineCard: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 3,
  },
  pipelineStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  pipelineStepTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  pipelineTimestamp: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#64748B',
  },
  pipelineEndpoint: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  pipelineMeta: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  footerRow: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  songPickerBox: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  songPickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  songPickerTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#FA243C',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  songPickerClearText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    fontWeight: '700',
  },
  songSearchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  songSearchInput: {
    flex: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    color: '#F8FAFC',
    fontSize: 11.5,
  },
  songSearchSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FA243C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  songSearchSubmitText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  quickQueriesRow: {
    gap: 6,
  },
  quickQueryChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(250, 36, 60, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(250, 36, 60, 0.32)',
  },
  quickQueryChipText: {
    fontSize: 10,
    color: '#FDA4AF',
    fontWeight: '700',
  },
  songResultsList: {
    gap: 6,
    marginTop: 2,
  },
  songResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  songResultArt: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  songResultTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  songResultSub: {
    fontSize: 10.5,
    color: '#94A3B8',
  },
  songResultIsrc: {
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    color: '#D4FF00',
  },
  songResultBtnsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playPickedNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#D4FF00',
  },
  playPickedNowBtnText: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#080B10',
  },
  enqueuePickedBtn: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  enqueuePickedBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E2E8F0',
  },
});
