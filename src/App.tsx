import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  Activity,
  Bike,
  Footprints,
  Gauge,
  Clock,
  Percent,
  Radio,
  Music2,
  Layers,
  Play,
  Pause,
  RotateCcw,
  ShieldAlert,
  Heart,
  Zap,
  Map,
  Mic,
  Waves,
  Navigation,
  ChevronRight,
} from './components/Icons';
import {
  ActivityMode,
  Athlete,
  BroadcastSignalEvent,
  INITIAL_ATHLETES,
  INITIAL_BROADCAST_LOGS,
  INITIAL_HAZARD_PINS,
  INITIAL_VOICE_CALLOUTS,
  RoadConditionType,
  RoadHazardPin,
  ROUTE_CONFIGS,
  SPOTIFY_PLAYLIST,
  TEAMMATE_CALLOUT_SAMPLES,
  VoiceTransmission,
} from './data/sessionData';
import LiveActivityProgressDock, {
  CONDITION_COLORS,
} from './components/LiveActivityProgressDock';
import TacticalRouteMap from './components/TacticalRouteMap';
import WalkieTalkiePTTDeck from './components/WalkieTalkiePTTDeck';
import SpotifySyncDeck from './components/SpotifySyncDeck';
import ArchitectureBlueprintView from './components/ArchitectureBlueprintModal';
import {
  playPttCloseSquelch,
  playPttOpenChirp,
  playSyncBroadcastPulse,
} from './utils/soundEffects';
import {
  broadcastMusicSyncSignal,
  translateBroadcastToSpotifyPlayer,
} from './services/spotifySyncService';
import { walkieTalkieController } from './services/liveKitVoiceService';
import { startDeviceGpsTracking } from './services/locationTelemetryService';

export type BottomTabId = 'cockpit' | 'map' | 'ptt' | 'spotify' | 'architecture';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

function formatPaceMinPerMile(speedMph: number): string {
  if (speedMph <= 0.5) return '--:--';
  const totalMinutes = 60 / speedMph;
  const mins = Math.floor(totalMinutes);
  const secs = Math.round((totalMinutes - mins) * 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatEtaRemaining(
  progressPct: number,
  totalMiles: number,
  speedMph: number
): { countdown: string; arrivalClock: string } {
  const remainingMiles = Math.max(0, ((100 - progressPct) / 100) * totalMiles);
  const safeSpeed = Math.max(2, speedMph);
  const remainingHours = remainingMiles / safeSpeed;
  const totalSecs = Math.max(0, Math.round(remainingHours * 3600));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  const arrivalDate = new Date(Date.now() + totalSecs * 1000);
  const arrivalClock = arrivalDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return {
    countdown: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
    arrivalClock,
  };
}

function formatNowTimestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function App() {
  // Core Mode: 'run' ("Run Together") vs 'ride' ("Ride Together")
  const [mode, setMode] = useState<ActivityMode>('run');
  const [activeTab, setActiveTab] = useState<BottomTabId>('cockpit');
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [useRealDeviceGps, setUseRealDeviceGps] = useState(false);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [effortLevel, setEffortLevel] = useState<
    'recovery' | 'tempo' | 'surge'
  >('tempo');
  const [showIosWidgetPreview, setShowIosWidgetPreview] = useState(false);

  // Athletes State
  const [athletes, setAthletes] = useState<Athlete[]>(INITIAL_ATHLETES);
  const [selectedAthleteId, setSelectedAthleteId] =
    useState<string>('athlete-you');

  // Road Conditions / Hazard Pins State
  const [hazardPins, setHazardPins] =
    useState<RoadHazardPin[]>(INITIAL_HAZARD_PINS);

  // Walkie-Talkie Push-To-Talk (LiveKit Cloud) State
  const [isPttActive, setIsPttActive] = useState(false);
  const [isPttLatched, setIsPttLatched] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [voiceFeed, setVoiceFeed] = useState<VoiceTransmission[]>(
    INITIAL_VOICE_CALLOUTS
  );
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);
  const teammateCallCursor = useRef(0);

  // Synchronized Spotify Broadcast State
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isSpotifyPlaying, setIsSpotifyPlaying] = useState(true);
  const [trackProgressSec, setTrackProgressSec] = useState(84);
  const [broadcastLogs, setBroadcastLogs] = useState<BroadcastSignalEvent[]>(
    INITIAL_BROADCAST_LOGS
  );

  const currentRoute = ROUTE_CONFIGS[mode];
  const selfAthlete = athletes.find((a) => a.isSelf) || athletes[1];
  const currentTrack =
    SPOTIFY_PLAYLIST[currentTrackIndex] || SPOTIFY_PLAYLIST[0];

  // Helper to emit a Custom Broadcast API -> Client Spotify API translation event
  const emitCustomSpotifyBroadcast = useCallback(
    async (
      action: BroadcastSignalEvent['action'],
      trackIdx: number,
      posSec: number,
      initiator = 'Alex Rivera (Host)'
    ) => {
      const track = SPOTIFY_PLAYLIST[trackIdx] || SPOTIFY_PLAYLIST[0];
      const posMs = Math.round(posSec * 1000);
      const sentEpoch = Date.now();

      const customPayload = {
        session_id: 'sf-884-pack-tempo',
        initiator,
        action,
        spotify_track_uri: track.uri,
        position_ms: posMs,
        sent_at_epoch_ms: sentEpoch,
      };

      await broadcastMusicSyncSignal(customPayload);
      const translated = await translateBroadcastToSpotifyPlayer(customPayload);

      const newEvent: BroadcastSignalEvent = {
        id: `sig-${Date.now()}`,
        timestamp: formatNowTimestamp(),
        initiator,
        action,
        customEndpoint:
          'POST https://api.pacelock.run/v1/session/sf-884/broadcast',
        customPayload: {
          session_id: 'sf-884-pack-tempo',
          broadcast_type: 'SPOTIFY_SYNC_SIGNAL',
          spotify_track_uri: track.uri,
          position_ms: posMs,
          server_epoch_ms: sentEpoch,
        },
        clientSpotifyEndpoint: translated.endpoint,
        clientSpotifyBody: translated.body,
        peersTranslated: athletes.length,
        avgDriftMs: Number((3.8 + Math.random() * 2.8).toFixed(1)),
      };
      setBroadcastLogs((prev) => [newEvent, ...prev.slice(0, 9)]);
    },
    [athletes.length]
  );

  // Optional Real Device GPS Tracking via `expo-location`
  useEffect(() => {
    if (!useRealDeviceGps) {
      setGpsNotice(null);
      return;
    }

    let sub: { remove: () => void } | null = null;
    startDeviceGpsTracking(
      (sample) => {
        if (sample.speedMph > 0.2) {
          setAthletes((prev) =>
            prev.map((a) =>
              a.isSelf ? { ...a, speedMph: sample.speedMph } : a
            )
          );
        }
      },
      (errReason) => {
        setGpsNotice(errReason);
      }
    ).then((s) => {
      sub = s;
    });

    return () => {
      sub?.remove();
    };
  }, [useRealDeviceGps]);

  // Switch between Run Together and Ride Together
  const handleSwitchMode = (newMode: ActivityMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    const speedMultiplier = newMode === 'ride' ? 2.72 : 1 / 2.72;
    setAthletes((prev) =>
      prev.map((a) => ({
        ...a,
        speedMph: Number((a.speedMph * speedMultiplier).toFixed(1)),
        cadence:
          newMode === 'ride'
            ? Math.round(a.cadence * 0.55)
            : Math.round(a.cadence / 0.55),
      }))
    );
    const matchingTrackIdx = SPOTIFY_PLAYLIST.findIndex(
      (t) => t.targetMode === newMode
    );
    if (matchingTrackIdx !== -1) {
      setCurrentTrackIndex(matchingTrackIdx);
      setTrackProgressSec(12);
      emitCustomSpotifyBroadcast(
        'BPM_LOCK_RESYNC',
        matchingTrackIdx,
        12,
        `Mode Switch (${newMode.toUpperCase()})`
      );
    }
  };

  // Real-time 250ms Telemetry Simulation Loop
  useEffect(() => {
    if (!isSimRunning) return;
    const interval = setInterval(() => {
      setAthletes((prev) =>
        prev.map((ath, idx) => {
          const seg =
            currentRoute.segments.find(
              (s) => ath.progress >= s.startPct && ath.progress <= s.endPct
            ) || currentRoute.segments[0];

          const baseModeSpeed =
            mode === 'run' ? 8.5 - idx * 0.14 : 23.6 - idx * 0.42;

          const effortBoost = ath.isSelf
            ? effortLevel === 'surge'
              ? 1.26
              : effortLevel === 'recovery'
              ? 0.84
              : 1.03
            : 1.0;

          const microWave = Math.sin(Date.now() / 1800 + idx * 1.4) * 0.15;
          const liveSpeed = Math.max(
            mode === 'run' ? 5.2 : 12.5,
            Number(
              (
                baseModeSpeed * seg.speedImpactFactor * effortBoost +
                microWave
              ).toFixed(1)
            )
          );

          const deltaPct =
            (liveSpeed / (mode === 'run' ? 145 : 380)) *
            (ath.isSelf && effortLevel === 'surge' ? 1.35 : 1);

          const nextProgress =
            ath.progress + deltaPct >= 99.2
              ? 14 + idx * 2.5
              : Number((ath.progress + deltaPct).toFixed(2));

          const targetHr =
            156 +
            (ath.isSelf && effortLevel === 'surge' ? 18 : idx * 2) +
            (seg.condition === 'hazard' ? 7 : 0);

          return {
            ...ath,
            progress: nextProgress,
            speedMph: liveSpeed,
            heartRate: Math.min(192, Math.round(targetHr)),
          };
        })
      );

      if (isSpotifyPlaying) {
        setTrackProgressSec((prevSec) => {
          const activeTrack =
            SPOTIFY_PLAYLIST[currentTrackIndex] || SPOTIFY_PLAYLIST[0];
          if (prevSec + 0.25 >= activeTrack.durationSec) {
            return 0;
          }
          return prevSec + 0.25;
        });
      }
    }, 250);

    return () => clearInterval(interval);
  }, [
    isSimRunning,
    mode,
    effortLevel,
    currentRoute.segments,
    isSpotifyPlaying,
    currentTrackIndex,
  ]);

  // Walkie-Talkie PTT Start / Stop Handlers
  const handleStartPtt = useCallback(() => {
    if (isPttActive) return;
    setIsPttActive(true);
    setActiveSpeakerId('athlete-you');
    playPttOpenChirp(soundEffectsEnabled);
    walkieTalkieController.pushToTalkOpen();
  }, [isPttActive, soundEffectsEnabled]);

  const handleStopPtt = useCallback(() => {
    if (!isPttActive) return;
    setIsPttActive(false);
    setIsPttLatched(false);
    setActiveSpeakerId(null);
    playPttCloseSquelch(soundEffectsEnabled);
    walkieTalkieController.pushToTalkRelease();

    const currentSeg =
      currentRoute.segments.find(
        (s) =>
          selfAthlete.progress >= s.startPct && selfAthlete.progress <= s.endPct
      ) || currentRoute.segments[0];

    const newCall: VoiceTransmission = {
      id: `vc-${Date.now()}`,
      speakerId: selfAthlete.id,
      speakerName: 'Alex Rivera (You)',
      speakerColor: selfAthlete.color,
      speakerAvatar: selfAthlete.avatar,
      transcript:
        effortLevel === 'surge'
          ? `Surging up to ${selfAthlete.speedMph.toFixed(1)} mph on ${currentSeg.name} — jump on my pace!`
          : `Checking in at ${selfAthlete.progress.toFixed(1)}% (${currentSeg.conditionLabel}) — holding ${selfAthlete.speedMph.toFixed(1)} mph.`,
      timestamp: 'Just now',
      durationSec: 2.8,
      progressAtCallPct: selfAthlete.progress,
    };
    setVoiceFeed((prev) => [newCall, ...prev.slice(0, 8)]);
  }, [
    isPttActive,
    soundEffectsEnabled,
    currentRoute.segments,
    selfAthlete,
    effortLevel,
  ]);

  const handleToggleLatch = () => {
    if (isPttLatched) {
      handleStopPtt();
    } else {
      setIsPttLatched(true);
      handleStartPtt();
    }
  };

  // Send a Quick Preset Voice Callout
  const handleSendQuickCallout = (text: string) => {
    playPttOpenChirp(soundEffectsEnabled);
    setActiveSpeakerId('athlete-you');
    setIsPttActive(true);
    walkieTalkieController.pushToTalkOpen();

    setTimeout(() => {
      setIsPttActive(false);
      setActiveSpeakerId(null);
      playPttCloseSquelch(soundEffectsEnabled);
      walkieTalkieController.pushToTalkRelease();
      const newCall: VoiceTransmission = {
        id: `vc-${Date.now()}`,
        speakerId: selfAthlete.id,
        speakerName: 'Alex Rivera (You)',
        speakerColor: selfAthlete.color,
        speakerAvatar: selfAthlete.avatar,
        transcript: text,
        timestamp: 'Just now',
        durationSec: 3.1,
        progressAtCallPct: selfAthlete.progress,
      };
      setVoiceFeed((prev) => [newCall, ...prev.slice(0, 8)]);
    }, 1100);
  };

  // Simulate an Incoming Teammate Callout over LiveKit Cloud
  const handleTriggerTeammateCallout = () => {
    const sample =
      TEAMMATE_CALLOUT_SAMPLES[
        teammateCallCursor.current % TEAMMATE_CALLOUT_SAMPLES.length
      ];
    teammateCallCursor.current += 1;

    const speaker =
      athletes.find((a) => a.id === sample.athleteId) || athletes[0];

    playPttOpenChirp(soundEffectsEnabled);
    setActiveSpeakerId(speaker.id);

    setTimeout(() => {
      setActiveSpeakerId(null);
      playPttCloseSquelch(soundEffectsEnabled);
      const newCall: VoiceTransmission = {
        id: `vc-${Date.now()}`,
        speakerId: speaker.id,
        speakerName: speaker.name,
        speakerColor: speaker.color,
        speakerAvatar: speaker.avatar,
        transcript: mode === 'run' ? sample.runText : sample.rideText,
        timestamp: 'Just now',
        durationSec: 3.4,
        progressAtCallPct: speaker.progress,
      };
      setVoiceFeed((prev) => [newCall, ...prev.slice(0, 8)]);
    }, 1800);
  };

  // Drop a Live Road Condition Pin on the Route
  const handleAddHazardPin = (
    type: RoadConditionType,
    title: string,
    description: string
  ) => {
    playSyncBroadcastPulse(soundEffectsEnabled);
    const newPin: RoadHazardPin = {
      id: `haz-${Date.now()}`,
      progressPct: Number(selfAthlete.progress.toFixed(1)),
      type,
      title,
      reportedBy: 'Alex Rivera (You)',
      timestamp: 'Just now',
      description,
    };
    setHazardPins((prev) => [newPin, ...prev]);
  };

  // Computed Telemetry Values
  const { countdown: etaFormatted, arrivalClock } = formatEtaRemaining(
    selfAthlete.progress,
    currentRoute.totalDistanceMiles,
    selfAthlete.speedMph
  );

  const currentRoadSegment =
    currentRoute.segments.find(
      (s) =>
        selfAthlete.progress >= s.startPct && selfAthlete.progress <= s.endPct
    ) || currentRoute.segments[0];

  const completedMiles = (
    (selfAthlete.progress / 100) *
    currentRoute.totalDistanceMiles
  ).toFixed(2);

  const roadColorHex = CONDITION_COLORS[currentRoadSegment.condition].hex;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar style="light" />

        {/* TOP COMMAND HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            {/* Brand Identity */}
            <View style={styles.brandGroup}>
              <View style={styles.logoBadge}>
                <Activity size={20} color="#080B10" strokeWidth={2.5} />
              </View>
              <View>
                <View style={styles.titleLine}>
                  <Text style={styles.brandTitle}>PACELOCK</Text>
                  <View style={styles.stackTag}>
                    <Text style={styles.stackTagText}>
                      EXPO · SUPABASE · LIVEKIT · SPOTIFY
                    </Text>
                  </View>
                </View>
                <Text style={styles.brandSubtitle}>
                  Ride or Run Together · Live Pack Telemetry &amp; Sync
                </Text>
              </View>
            </View>

            {/* Right Controls: Sim Play/Pause, Device GPS toggle, Reset */}
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setIsSimRunning((v) => !v)}
                style={styles.iconPillBtn}
              >
                {isSimRunning ? (
                  <Pause size={13} color="#D4FF00" />
                ) : (
                  <Play size={13} color="#34D399" />
                )}
                <Text style={styles.iconPillBtnText}>
                  {isSimRunning ? 'Sim Live' : 'Paused'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setUseRealDeviceGps((v) => !v)}
                style={[
                  styles.iconPillBtn,
                  useRealDeviceGps && styles.iconPillBtnGpsActive,
                ]}
              >
                <Navigation
                  size={12}
                  color={useRealDeviceGps ? '#00F0FF' : '#94A3B8'}
                />
                <Text
                  style={[
                    styles.iconPillBtnText,
                    useRealDeviceGps && { color: '#00F0FF' },
                  ]}
                >
                  GPS
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setAthletes(INITIAL_ATHLETES)}
                style={styles.resetBtn}
              >
                <RotateCcw size={14} color="#CBD5E1" />
              </Pressable>
            </View>
          </View>

          {/* Mode Switcher: RUN TOGETHER vs RIDE TOGETHER */}
          <View style={styles.modeSwitchContainer}>
            <Pressable
              onPress={() => handleSwitchMode('run')}
              style={[
                styles.modeBtn,
                mode === 'run' && styles.modeBtnRunActive,
              ]}
            >
              <Footprints
                size={15}
                color={mode === 'run' ? '#080B10' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.modeBtnText,
                  mode === 'run' && styles.modeBtnTextActive,
                ]}
              >
                Run Together
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSwitchMode('ride')}
              style={[
                styles.modeBtn,
                mode === 'ride' && styles.modeBtnRideActive,
              ]}
            >
              <Bike
                size={15}
                color={mode === 'ride' ? '#080B10' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.modeBtnText,
                  mode === 'ride' && styles.modeBtnTextActive,
                ]}
              >
                Ride Together
              </Text>
            </Pressable>
          </View>

          {gpsNotice && (
            <Text style={styles.gpsNoticeText}>{gpsNotice}</Text>
          )}
        </View>

        {/* MAIN SCROLLABLE VIEWPORT */}
        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* TAB 1: COCKPIT */}
          {activeTab === 'cockpit' && (
            <View style={styles.tabSection}>
              {/* 1. LIVE ACTIVITIES LINEAR PROGRESS BAR WITH EVERYONE'S PFP ON A LINE */}
              <LiveActivityProgressDock
                route={currentRoute}
                athletes={athletes}
                selectedAthleteId={selectedAthleteId}
                onSelectAthlete={setSelectedAthleteId}
                activeSpeakerId={activeSpeakerId}
                hazardPins={hazardPins}
                etaFormatted={etaFormatted}
                arrivalClock={arrivalClock}
                showIosWidgetPreview={showIosWidgetPreview}
                onToggleIosWidgetPreview={() =>
                  setShowIosWidgetPreview((v) => !v)
                }
                effortLevel={effortLevel}
                onChangeEffort={setEffortLevel}
              />

              {/* 2. PRIMARY 2x2 TELEMETRY STATS GRID */}
              <View style={styles.statsGrid}>
                {/* Stat 1: Current Speed & Pace */}
                <View style={styles.statCard}>
                  <View style={styles.statHeaderRow}>
                    <Text style={styles.statLabel}>SPEED / PACE</Text>
                    <Gauge size={15} color="#D4FF00" />
                  </View>
                  <View style={styles.statValueRow}>
                    <Text style={styles.statBigNumber}>
                      {selfAthlete.speedMph.toFixed(1)}
                    </Text>
                    <Text style={[styles.statUnit, { color: '#D4FF00' }]}>
                      MPH
                    </Text>
                  </View>
                  <Text style={styles.statSubValue}>
                    {mode === 'run'
                      ? `${formatPaceMinPerMile(selfAthlete.speedMph)} /mi pace`
                      : `${selfAthlete.powerWatts}W Power`}
                  </Text>
                  <View style={styles.statFooterRow}>
                    <View style={styles.statMiniMetric}>
                      <Heart size={12} color="#FB7185" />
                      <Text style={[styles.statMiniText, { color: '#FB7185' }]}>
                        {selfAthlete.heartRate} bpm
                      </Text>
                    </View>
                    <View style={styles.statMiniMetric}>
                      <Zap size={12} color="#34D399" />
                      <Text style={[styles.statMiniText, { color: '#34D399' }]}>
                        {selfAthlete.cadence} {mode === 'run' ? 'spm' : 'rpm'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Stat 2: Route % Done & Distance */}
                <View style={styles.statCard}>
                  <View style={styles.statHeaderRow}>
                    <Text style={styles.statLabel}>COMPLETION</Text>
                    <Percent size={15} color="#00F0FF" />
                  </View>
                  <View style={styles.statValueRow}>
                    <Text style={styles.statBigNumber}>
                      {selfAthlete.progress.toFixed(1)}%
                    </Text>
                    <Text style={[styles.statUnit, { color: '#00F0FF' }]}>
                      DONE
                    </Text>
                  </View>
                  <Text style={styles.statSubValue}>
                    {completedMiles} / {currentRoute.totalDistanceMiles} mi
                  </Text>
                  <View style={styles.miniProgressTrack}>
                    <View
                      style={[
                        styles.miniProgressFill,
                        { width: `${selfAthlete.progress}%` },
                      ]}
                    />
                  </View>
                </View>

                {/* Stat 3: Expected Time (ETA) */}
                <View style={styles.statCard}>
                  <View style={styles.statHeaderRow}>
                    <Text style={styles.statLabel}>EXPECTED ETA</Text>
                    <Clock size={15} color="#34D399" />
                  </View>
                  <View style={styles.statValueRow}>
                    <Text style={styles.statBigNumber}>{etaFormatted}</Text>
                    <Text style={[styles.statUnit, { color: '#34D399' }]}>
                      LEFT
                    </Text>
                  </View>
                  <Text style={styles.statSubValue}>
                    Target {currentRoute.targetSpeedMph} mph
                  </Text>
                  <View style={styles.statFooterRow}>
                    <Text style={styles.statFooterMuted}>Finish Arrival:</Text>
                    <Text style={styles.statFooterWhite}>{arrivalClock}</Text>
                  </View>
                </View>

                {/* Stat 4: Live Google Maps Road Conditions */}
                <View style={styles.statCard}>
                  <View style={styles.statHeaderRow}>
                    <Text style={styles.statLabel}>ROAD SURFACE</Text>
                    <ShieldAlert size={15} color={roadColorHex} />
                  </View>
                  <Text
                    style={[
                      styles.roadConditionHeadline,
                      { color: roadColorHex },
                    ]}
                    numberOfLines={1}
                  >
                    {currentRoadSegment.conditionLabel}
                  </Text>
                  <Text style={styles.statSubValue} numberOfLines={1}>
                    {currentRoadSegment.name}
                  </Text>
                  <View style={styles.statFooterRow}>
                    <Text style={styles.statFooterMuted}>
                      Grade {currentRoadSegment.gradePct}%
                    </Text>
                    <Text style={styles.statFooterMuted}>
                      Grip {currentRoadSegment.gripPct}%
                    </Text>
                    <Text style={styles.statFooterMuted}>
                      {currentRoadSegment.windSpeedMph}mph
                    </Text>
                  </View>
                </View>
              </View>

              {/* 3. QUICK WALKIE-TALKIE PTT BAR IN COCKPIT */}
              <View style={styles.quickDeckCard}>
                <View style={styles.quickDeckHeader}>
                  <View style={styles.quickDeckTitleRow}>
                    <Radio size={15} color="#FF4D2A" />
                    <Text style={styles.quickDeckTitle}>
                      LIVEKIT WALKIE-TALKIE PTT
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setActiveTab('ptt')}
                    style={styles.jumpTabLink}
                  >
                    <Text style={styles.jumpTabLinkText}>Full Voice Deck</Text>
                    <ChevronRight size={13} color="#FF4D2A" />
                  </Pressable>
                </View>

                <View style={styles.quickPttRow}>
                  <Pressable
                    onPressIn={handleStartPtt}
                    onPressOut={() => {
                      if (!isPttLatched) handleStopPtt();
                    }}
                    style={[
                      styles.quickPttButton,
                      isPttActive && styles.quickPttButtonActive,
                    ]}
                  >
                    {isPttActive ? (
                      <>
                        <Waves size={18} color="#FFFFFF" />
                        <Text style={styles.quickPttButtonText}>
                          TRANSMITTING TO PACK · RELEASE TO END
                        </Text>
                      </>
                    ) : (
                      <>
                        <Mic size={18} color="#FFFFFF" />
                        <Text style={styles.quickPttButtonText}>
                          HOLD TO TALK TO ALL 5 PHONES
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
                {voiceFeed[0] && (
                  <Text style={styles.latestVoiceSnippet} numberOfLines={1}>
                    Latest ({voiceFeed[0].speakerName.split(' ')[0]}): "
                    {voiceFeed[0].transcript}"
                  </Text>
                )}
              </View>

              {/* 4. QUICK SPOTIFY SYNC BAR IN COCKPIT */}
              <View style={styles.quickDeckCard}>
                <View style={styles.quickDeckHeader}>
                  <View style={styles.quickDeckTitleRow}>
                    <Music2 size={15} color="#1DB954" />
                    <Text
                      style={[styles.quickDeckTitle, { color: '#1DB954' }]}
                    >
                      SPOTIFY PACK SYNC · {currentTrack.bpm} BPM LOCKED
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setActiveTab('spotify')}
                    style={styles.jumpTabLink}
                  >
                    <Text
                      style={[styles.jumpTabLinkText, { color: '#1DB954' }]}
                    >
                      API Translator
                    </Text>
                    <ChevronRight size={13} color="#1DB954" />
                  </Pressable>
                </View>

                <View style={styles.quickSpotifyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quickTrackTitle} numberOfLines={1}>
                      {currentTrack.title}
                    </Text>
                    <Text style={styles.quickTrackArtist} numberOfLines={1}>
                      {currentTrack.artist} ·{' '}
                      {activeSpeakerId
                        ? 'Auto-Ducked 25% (PTT Open)'
                        : '5/5 Phones Synced'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      const nextState = !isSpotifyPlaying;
                      setIsSpotifyPlaying(nextState);
                      emitCustomSpotifyBroadcast(
                        nextState ? 'PLAY_TRACK' : 'PAUSE_SYNC',
                        currentTrackIndex,
                        trackProgressSec
                      );
                    }}
                    style={styles.quickSpotifyPlayBtn}
                  >
                    {isSpotifyPlaying ? (
                      <Pause size={15} color="#080B10" />
                    ) : (
                      <Play size={15} color="#080B10" />
                    )}
                    <Text style={styles.quickSpotifyPlayText}>
                      {isSpotifyPlaying ? 'Pause' : 'Play'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {/* TAB 2: TACTICAL ROUTE MAP */}
          {activeTab === 'map' && (
            <View style={styles.tabSection}>
              <TacticalRouteMap
                route={currentRoute}
                athletes={athletes}
                selectedAthleteId={selectedAthleteId}
                onSelectAthlete={setSelectedAthleteId}
                activeSpeakerId={activeSpeakerId}
                hazardPins={hazardPins}
                onAddHazardPin={handleAddHazardPin}
              />
              <LiveActivityProgressDock
                route={currentRoute}
                athletes={athletes}
                selectedAthleteId={selectedAthleteId}
                onSelectAthlete={setSelectedAthleteId}
                activeSpeakerId={activeSpeakerId}
                hazardPins={hazardPins}
                etaFormatted={etaFormatted}
                arrivalClock={arrivalClock}
                showIosWidgetPreview={showIosWidgetPreview}
                onToggleIosWidgetPreview={() =>
                  setShowIosWidgetPreview((v) => !v)
                }
                effortLevel={effortLevel}
                onChangeEffort={setEffortLevel}
              />
            </View>
          )}

          {/* TAB 3: WALKIE-TALKIE PTT DECK */}
          {activeTab === 'ptt' && (
            <View style={styles.tabSection}>
              <WalkieTalkiePTTDeck
                isPttActive={isPttActive}
                isLatched={isPttLatched}
                onStartPtt={handleStartPtt}
                onStopPtt={handleStopPtt}
                onToggleLatch={handleToggleLatch}
                activeSpeakerId={activeSpeakerId}
                athletes={athletes}
                voiceFeed={voiceFeed}
                onSendQuickCallout={handleSendQuickCallout}
                onTriggerTeammateCallout={handleTriggerTeammateCallout}
                soundEffectsEnabled={soundEffectsEnabled}
                onToggleSoundEffects={() => setSoundEffectsEnabled((v) => !v)}
              />
            </View>
          )}

          {/* TAB 4: SPOTIFY PACK SYNC & CUSTOM BROADCAST TRANSLATOR */}
          {activeTab === 'spotify' && (
            <View style={styles.tabSection}>
              <SpotifySyncDeck
                tracks={SPOTIFY_PLAYLIST}
                currentTrackIndex={currentTrackIndex}
                isPlaying={isSpotifyPlaying}
                progressSec={trackProgressSec}
                isVoiceDucked={Boolean(activeSpeakerId)}
                athletes={athletes}
                broadcastLogs={broadcastLogs}
                onTogglePlay={() => {
                  const nextState = !isSpotifyPlaying;
                  setIsSpotifyPlaying(nextState);
                  emitCustomSpotifyBroadcast(
                    nextState ? 'PLAY_TRACK' : 'PAUSE_SYNC',
                    currentTrackIndex,
                    trackProgressSec
                  );
                }}
                onNextTrack={() => {
                  const nextIdx =
                    (currentTrackIndex + 1) % SPOTIFY_PLAYLIST.length;
                  setCurrentTrackIndex(nextIdx);
                  setTrackProgressSec(0);
                  playSyncBroadcastPulse(soundEffectsEnabled);
                  emitCustomSpotifyBroadcast('PLAY_TRACK', nextIdx, 0);
                }}
                onPrevTrack={() => {
                  const prevIdx =
                    (currentTrackIndex - 1 + SPOTIFY_PLAYLIST.length) %
                    SPOTIFY_PLAYLIST.length;
                  setCurrentTrackIndex(prevIdx);
                  setTrackProgressSec(0);
                  playSyncBroadcastPulse(soundEffectsEnabled);
                  emitCustomSpotifyBroadcast('PLAY_TRACK', prevIdx, 0);
                }}
                onSeekTrack={(newSec) => {
                  setTrackProgressSec(newSec);
                  playSyncBroadcastPulse(soundEffectsEnabled);
                  emitCustomSpotifyBroadcast(
                    'SEEK_POSITION',
                    currentTrackIndex,
                    newSec
                  );
                }}
                onForceResyncBroadcast={() => {
                  playSyncBroadcastPulse(soundEffectsEnabled);
                  emitCustomSpotifyBroadcast(
                    'BPM_LOCK_RESYNC',
                    currentTrackIndex,
                    trackProgressSec
                  );
                }}
                onSelectTrackIndex={(idx) => {
                  setCurrentTrackIndex(idx);
                  setTrackProgressSec(0);
                  playSyncBroadcastPulse(soundEffectsEnabled);
                  emitCustomSpotifyBroadcast('PLAY_TRACK', idx, 0);
                }}
              />
            </View>
          )}

          {/* TAB 5: SYSTEM ARCHITECTURE & SUPABASE / LIVEKIT / SPOTIFY SPEC */}
          {activeTab === 'architecture' && (
            <View style={styles.tabSection}>
              <ArchitectureBlueprintView />
            </View>
          )}
        </ScrollView>

        {/* BOTTOM MOBILE TAB NAVIGATION BAR */}
        <View style={styles.bottomTabBar}>
          {(
            [
              {
                id: 'cockpit',
                label: 'Cockpit',
                icon: Gauge,
                activeColor: '#D4FF00',
              },
              {
                id: 'map',
                label: 'Route Map',
                icon: Map,
                activeColor: '#00F0FF',
              },
              {
                id: 'ptt',
                label: 'PTT Voice',
                icon: Radio,
                activeColor: '#FF4D2A',
              },
              {
                id: 'spotify',
                label: 'Spotify Sync',
                icon: Music2,
                activeColor: '#1DB954',
              },
              {
                id: 'architecture',
                label: 'Stack Spec',
                icon: Layers,
                activeColor: '#D4FF00',
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[
                  styles.bottomTabItem,
                  isActive && styles.bottomTabItemActive,
                ]}
              >
                <Icon
                  size={18}
                  color={isActive ? tab.activeColor : '#64748B'}
                />
                <Text
                  style={[
                    styles.bottomTabLabel,
                    isActive && { color: tab.activeColor, fontWeight: '800' },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#080B10',
  },
  header: {
    backgroundColor: '#080B10',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#D4FF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  stackTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stackTagText: {
    fontSize: 8.5,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
  },
  brandSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  iconPillBtnGpsActive: {
    backgroundColor: 'rgba(0, 240, 255, 0.16)',
    borderColor: 'rgba(0, 240, 255, 0.5)',
  },
  iconPillBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  resetBtn: {
    padding: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  modeSwitchContainer: {
    flexDirection: 'row',
    backgroundColor: '#111726',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modeBtnRunActive: {
    backgroundColor: '#D4FF00',
  },
  modeBtnRideActive: {
    backgroundColor: '#00F0FF',
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modeBtnTextActive: {
    color: '#080B10',
  },
  gpsNoticeText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#FBBF24',
  },
  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    padding: 14,
    paddingBottom: 28,
  },
  tabSection: {
    gap: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 155,
    backgroundColor: '#0E131D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    justifyContent: 'space-between',
    gap: 6,
  },
  statHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    fontWeight: '700',
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  statBigNumber: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  statUnit: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  statSubValue: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  statFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  statMiniMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statMiniText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '600',
  },
  miniProgressTrack: {
    height: 6,
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 4,
  },
  miniProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#00F0FF',
  },
  statFooterMuted: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  statFooterWhite: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roadConditionHeadline: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  quickDeckCard: {
    backgroundColor: '#0E131D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    gap: 8,
  },
  quickDeckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickDeckTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickDeckTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#FF4D2A',
  },
  jumpTabLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  jumpTabLinkText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FF4D2A',
  },
  quickPttRow: {
    flexDirection: 'row',
  },
  quickPttButton: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: '#FF4D2A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickPttButtonActive: {
    backgroundColor: '#FF2E00',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  quickPttButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  latestVoiceSnippet: {
    fontSize: 11,
    color: '#CBD5E1',
    fontStyle: 'italic',
  },
  quickSpotifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#080B10',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickTrackTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  quickTrackArtist: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    marginTop: 2,
  },
  quickSpotifyPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1DB954',
  },
  quickSpotifyPlayText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#080B10',
    textTransform: 'uppercase',
  },
  bottomTabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#0B0F18',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  bottomTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
    gap: 3,
  },
  bottomTabItemActive: {
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  bottomTabLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#64748B',
    fontWeight: '600',
  },
});
