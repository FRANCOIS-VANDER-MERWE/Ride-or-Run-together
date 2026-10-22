import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Users,
  CheckCircle2,
} from 'lucide-react';
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
  const [activeView, setActiveView] = useState<'cockpit' | 'architecture'>('cockpit');
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [effortLevel, setEffortLevel] = useState<'recovery' | 'tempo' | 'surge'>('tempo');
  const [showIosWidgetPreview, setShowIosWidgetPreview] = useState(false);

  // Athletes State
  const [athletes, setAthletes] = useState<Athlete[]>(INITIAL_ATHLETES);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>('athlete-you');

  // Road Conditions / Hazard Pins State
  const [hazardPins, setHazardPins] = useState<RoadHazardPin[]>(INITIAL_HAZARD_PINS);

  // Walkie-Talkie Push-To-Talk (LiveKit Cloud) State
  const [isPttActive, setIsPttActive] = useState(false);
  const [isPttLatched, setIsPttLatched] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [voiceFeed, setVoiceFeed] = useState<VoiceTransmission[]>(INITIAL_VOICE_CALLOUTS);
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

  // Helper to emit a Custom Broadcast API -> Client Spotify API translation event
  const emitCustomSpotifyBroadcast = useCallback(
    (
      action: BroadcastSignalEvent['action'],
      trackIdx: number,
      posSec: number,
      initiator = 'Alex Rivera (Host)'
    ) => {
      const track = SPOTIFY_PLAYLIST[trackIdx] || SPOTIFY_PLAYLIST[0];
      const posMs = Math.round(posSec * 1000);
      const rttCompMs = 11 + Math.floor(Math.random() * 5);
      const newEvent: BroadcastSignalEvent = {
        id: `sig-${Date.now()}`,
        timestamp: formatNowTimestamp(),
        initiator,
        action,
        customEndpoint: 'POST https://api.pacelock.run/v1/session/sf-884/broadcast',
        customPayload: {
          session_id: 'sf-884-pack-tempo',
          broadcast_type: 'SPOTIFY_SYNC_SIGNAL',
          spotify_track_uri: track.uri,
          position_ms: posMs,
          server_epoch_ms: Date.now(),
        },
        clientSpotifyEndpoint: 'PUT https://api.spotify.com/v1/me/player/play',
        clientSpotifyBody: {
          uris: [track.uri],
          position_ms: posMs + rttCompMs,
          device_compensation_ms: rttCompMs,
        },
        peersTranslated: athletes.length,
        avgDriftMs: Number((3.8 + Math.random() * 2.8).toFixed(1)),
      };
      setBroadcastLogs((prev) => [newEvent, ...prev.slice(0, 9)]);
    },
    [athletes.length]
  );

  // Switch between Run Together and Ride Together
  const handleSwitchMode = (newMode: ActivityMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    const speedMultiplier = newMode === 'ride' ? 2.72 : 1 / 2.72;
    setAthletes((prev) =>
      prev.map((a) => ({
        ...a,
        speedMph: Number((a.speedMph * speedMultiplier).toFixed(1)),
        cadence: newMode === 'ride' ? Math.round(a.cadence * 0.55) : Math.round(a.cadence / 0.55),
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

  // Real-time 250ms Telemetry Simulation Loop (updates everyone's progress on the line, speed, and road segment effects)
  useEffect(() => {
    if (!isSimRunning) return;
    const interval = setInterval(() => {
      setAthletes((prev) =>
        prev.map((ath, idx) => {
          // Find road segment impact factor for this athlete's position
          const seg =
            currentRoute.segments.find(
              (s) => ath.progress >= s.startPct && ath.progress <= s.endPct
            ) || currentRoute.segments[0];

          const baseModeSpeed =
            mode === 'run'
              ? 8.5 - idx * 0.14
              : 23.6 - idx * 0.42;

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
              (baseModeSpeed * seg.speedImpactFactor * effortBoost + microWave).toFixed(1)
            )
          );

          // Advance progress along the linear route
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

      // Advance Spotify track timer
      if (isSpotifyPlaying) {
        setTrackProgressSec((prevSec) => {
          const activeTrack = SPOTIFY_PLAYLIST[currentTrackIndex] || SPOTIFY_PLAYLIST[0];
          if (prevSec + 0.25 >= activeTrack.durationSec) {
            return 0;
          }
          return prevSec + 0.25;
        });
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isSimRunning, mode, effortLevel, currentRoute.segments, isSpotifyPlaying, currentTrackIndex]);

  // Walkie-Talkie PTT Start / Stop Handlers
  const handleStartPtt = useCallback(() => {
    if (isPttActive) return;
    setIsPttActive(true);
    setActiveSpeakerId('athlete-you');
    playPttOpenChirp(soundEffectsEnabled);
  }, [isPttActive, soundEffectsEnabled]);

  const handleStopPtt = useCallback(() => {
    if (!isPttActive) return;
    setIsPttActive(false);
    setIsPttLatched(false);
    setActiveSpeakerId(null);
    playPttCloseSquelch(soundEffectsEnabled);

    // Append user voice transmission to live feed
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

  // Global Spacebar Hold-To-Talk Listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleStartPtt();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!isPttLatched) {
          handleStopPtt();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleStartPtt, handleStopPtt, isPttLatched]);

  // Send a Quick Preset Voice Callout
  const handleSendQuickCallout = (text: string) => {
    playPttOpenChirp(soundEffectsEnabled);
    setActiveSpeakerId('athlete-you');
    setIsPttActive(true);

    setTimeout(() => {
      setIsPttActive(false);
      setActiveSpeakerId(null);
      playPttCloseSquelch(soundEffectsEnabled);
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

  return (
    <div className="min-h-screen bg-[#080B10] text-slate-100 flex flex-col">
      {/* TOP COMMAND HEADER */}
      <header className="sticky top-0 z-50 bg-[#080B10]/90 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-3">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#D4FF00] text-[#080B10] flex items-center justify-center font-display font-bold text-lg shadow-[0_0_20px_rgba(212,255,0,0.4)]">
              <Activity className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-bold text-base sm:text-lg tracking-tight text-white">
                  PACELOCK
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-mono-tech uppercase text-[#D4FF00] font-semibold">
                  EXPO + SUPABASE + LIVEKIT + SPOTIFY
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Ride Together or Run Together · Live Pack Telemetry &amp; Voice/Music Sync
              </p>
            </div>
          </div>

          {/* Center Mode Switcher: RUN TOGETHER vs RIDE TOGETHER */}
          <div className="flex items-center bg-[#111726] p-1 rounded-2xl border border-white/15">
            <button
              onClick={() => handleSwitchMode('run')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all cursor-pointer ${
                mode === 'run'
                  ? 'bg-[#D4FF00] text-[#080B10] shadow-[0_0_15px_rgba(212,255,0,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Footprints className="w-4 h-4" />
              <span>Run Together</span>
            </button>
            <button
              onClick={() => handleSwitchMode('ride')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all cursor-pointer ${
                mode === 'ride'
                  ? 'bg-[#00F0FF] text-[#080B10] shadow-[0_0_15px_rgba(0,240,255,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bike className="w-4 h-4" />
              <span>Ride Together</span>
            </button>
          </div>

          {/* Right Controls: Simulation Play/Pause + View Toggle (Live Cockpit vs Architecture Spec) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSimRunning((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/15 text-xs font-mono-tech text-slate-200 flex items-center gap-1.5 cursor-pointer"
              title="Pause or resume real-time GPS simulation"
            >
              {isSimRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-[#D4FF00]" />
                  <span className="hidden md:inline">Sim Live</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden md:inline">Paused</span>
                </>
              )}
            </button>

            <button
              onClick={() => setAthletes(INITIAL_ATHLETES)}
              className="p-2 rounded-xl bg-white/8 hover:bg-white/15 border border-white/15 text-slate-300 cursor-pointer"
              title="Reset pack route progress"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center bg-[#111726] p-1 rounded-xl border border-white/15">
              <button
                onClick={() => setActiveView('cockpit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono-tech uppercase font-bold transition-all cursor-pointer ${
                  activeView === 'cockpit'
                    ? 'bg-white text-[#080B10]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Live App
              </button>
              <button
                onClick={() => setActiveView('architecture')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono-tech uppercase font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeView === 'architecture'
                    ? 'bg-[#D4FF00] text-[#080B10]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Stack &amp; Spec</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {activeView === 'architecture' ? (
          <ArchitectureBlueprintView />
        ) : (
          <>
            {/* 1. TOP DOCK: LIVE ACTIVITIES LINEAR PROGRESS BAR WITH EVERYONE'S PFP ON A LINE */}
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
              onToggleIosWidgetPreview={() => setShowIosWidgetPreview((v) => !v)}
              effortLevel={effortLevel}
              onChangeEffort={setEffortLevel}
            />

            {/* 2. PRIMARY TELEMETRY STATS STRIP (Current Speed, % Done, Expected Time, Road Conditions) */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Stat 1: Current Speed & Pace */}
              <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech uppercase tracking-wider text-slate-400">
                    CURRENT SPEED / PACE
                  </span>
                  <Gauge className="w-4 h-4 text-[#D4FF00]" />
                </div>
                <div className="my-2 flex items-baseline gap-2">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-white tabular-nums-strict">
                    {selfAthlete.speedMph.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono-tech text-[#D4FF00] font-bold">
                    MPH
                  </span>
                  <span className="text-xs font-mono-tech text-slate-400 ml-auto">
                    {mode === 'run'
                      ? `${formatPaceMinPerMile(selfAthlete.speedMph)} /mi`
                      : `${selfAthlete.powerWatts}W Power`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono-tech text-slate-400 pt-2 border-t border-white/10">
                  <span className="flex items-center gap-1 text-rose-400">
                    <Heart className="w-3.5 h-3.5" /> {selfAthlete.heartRate} bpm
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Zap className="w-3.5 h-3.5" /> {selfAthlete.cadence}{' '}
                    {mode === 'run' ? 'spm' : 'rpm'}
                  </span>
                </div>
              </div>

              {/* Stat 2: Route % Done & Distance */}
              <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech uppercase tracking-wider text-slate-400">
                    COMPLETION (% DONE)
                  </span>
                  <Percent className="w-4 h-4 text-[#00F0FF]" />
                </div>
                <div className="my-2 flex items-baseline gap-2">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-white tabular-nums-strict">
                    {selfAthlete.progress.toFixed(1)}%
                  </span>
                  <span className="text-xs font-mono-tech text-[#00F0FF]">
                    DONE
                  </span>
                  <span className="text-xs font-mono-tech text-slate-400 ml-auto">
                    {completedMiles} / {currentRoute.totalDistanceMiles} mi
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden mt-1">
                  <div
                    style={{ width: `${selfAthlete.progress}%` }}
                    className="h-full bg-gradient-to-r from-[#00F0FF] to-[#D4FF00]"
                  />
                </div>
              </div>

              {/* Stat 3: Expected Time (ETA) */}
              <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech uppercase tracking-wider text-slate-400">
                    EXPECTED TIME (ETA)
                  </span>
                  <Clock className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="my-2 flex items-baseline gap-2">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-white tabular-nums-strict">
                    {etaFormatted}
                  </span>
                  <span className="text-xs font-mono-tech text-emerald-400">
                    REMAINING
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono-tech text-slate-400 pt-2 border-t border-white/10">
                  <span>Finish Arrival:</span>
                  <span className="text-white font-bold">{arrivalClock}</span>
                </div>
              </div>

              {/* Stat 4: Live Google Maps Road Conditions */}
              <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech uppercase tracking-wider text-slate-400">
                    ROAD CONDITIONS (LIVE)
                  </span>
                  <ShieldAlert
                    style={{
                      color: CONDITION_COLORS[currentRoadSegment.condition].hex,
                    }}
                    className="w-4 h-4"
                  />
                </div>
                <div className="my-1.5">
                  <div
                    style={{
                      color: CONDITION_COLORS[currentRoadSegment.condition].hex,
                    }}
                    className="font-display font-bold text-sm sm:text-base uppercase truncate"
                  >
                    {currentRoadSegment.conditionLabel}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {currentRoadSegment.name}
                  </p>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono-tech text-slate-300 pt-2 border-t border-white/10">
                  <span>Grade: {currentRoadSegment.gradePct}%</span>
                  <span>Grip: {currentRoadSegment.gripPct}%</span>
                  <span>Wind: {currentRoadSegment.windSpeedMph}mph</span>
                </div>
              </div>
            </section>

            {/* 3. MAIN SPLIT COCKPIT: TACTICAL ROUTE MAP (LEFT) + WALKIE-TALKIE & SPOTIFY SYNC (RIGHT) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
              {/* Left 7 Cols: Interactive Tactical Route Map & Road Conditions */}
              <div className="xl:col-span-7 flex flex-col">
                <TacticalRouteMap
                  route={currentRoute}
                  athletes={athletes}
                  selectedAthleteId={selectedAthleteId}
                  onSelectAthlete={setSelectedAthleteId}
                  activeSpeakerId={activeSpeakerId}
                  hazardPins={hazardPins}
                  onAddHazardPin={handleAddHazardPin}
                />
              </div>

              {/* Right 5 Cols: Walkie-Talkie PTT System + Synchronized Spotify Broadcast Deck */}
              <div className="xl:col-span-5 flex flex-col gap-5">
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
                    const nextIdx = (currentTrackIndex + 1) % SPOTIFY_PLAYLIST.length;
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
              </div>
            </div>
          </>
        )}
      </main>

      {/* COMPACT FOOTER STATUS BAR */}
      <footer className="border-t border-white/10 bg-[#080B10] px-4 sm:px-6 py-3 mt-auto">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tech text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Supabase Auth &amp; Postgres Connected (`users`, `playlists`, `friends`)
            </span>
            <span className="flex items-center gap-1.5 text-[#FF4D2A]">
              <Radio className="w-3.5 h-3.5" />
              LiveKit Cloud PTT Ready (Hold Spacebar or Button)
            </span>
            <span className="flex items-center gap-1.5 text-[#1DB954]">
              <Music2 className="w-3.5 h-3.5" />
              Custom Broadcast -&gt; Spotify API Translator Active
            </span>
          </div>
          <button
            onClick={() =>
              setActiveView((v) => (v === 'cockpit' ? 'architecture' : 'cockpit'))
            }
            className="text-[#D4FF00] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              {activeView === 'cockpit'
                ? 'Inspect Expo + Supabase + FastAPI Architecture Spec ->'
                : '<- Back to Live Run/Ride Cockpit'}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}
