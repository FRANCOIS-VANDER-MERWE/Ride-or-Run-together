import React from 'react';
import {
  Navigation,
  Radio,
  Smartphone,
  AlertTriangle,
  CheckCircle2,
  Wind,
  Clock,
  Gauge,
  Sparkles,
  Flag,
} from 'lucide-react';
import {
  Athlete,
  RoadHazardPin,
  RouteConfig,
  RoadConditionType,
} from '../data/sessionData';

interface LiveActivityProgressDockProps {
  route: RouteConfig;
  athletes: Athlete[];
  selectedAthleteId: string;
  onSelectAthlete: (id: string) => void;
  activeSpeakerId: string | null;
  hazardPins: RoadHazardPin[];
  etaFormatted: string;
  arrivalClock: string;
  showIosWidgetPreview: boolean;
  onToggleIosWidgetPreview: () => void;
  effortLevel: 'recovery' | 'tempo' | 'surge';
  onChangeEffort: (effort: 'recovery' | 'tempo' | 'surge') => void;
}

export const CONDITION_COLORS: Record<
  RoadConditionType,
  { bg: string; border: string; text: string; hex: string; label: string }
> = {
  optimal: {
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-400/50',
    text: 'text-emerald-300',
    hex: '#10B981',
    label: 'Optimal Surface',
  },
  caution: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-400/50',
    text: 'text-amber-300',
    hex: '#F59E0B',
    label: 'Caution / Wind',
  },
  hazard: {
    bg: 'bg-red-500/25',
    border: 'border-red-400/60',
    text: 'text-red-300',
    hex: '#EF4444',
    label: 'Steep / Hazard',
  },
};

export default function LiveActivityProgressDock({
  route,
  athletes,
  selectedAthleteId,
  onSelectAthlete,
  activeSpeakerId,
  hazardPins,
  etaFormatted,
  arrivalClock,
  showIosWidgetPreview,
  onToggleIosWidgetPreview,
  effortLevel,
  onChangeEffort,
}: LiveActivityProgressDockProps) {
  const selfAthlete = athletes.find((a) => a.isSelf) || athletes[0];
  const selectedAthlete =
    athletes.find((a) => a.id === selectedAthleteId) || selfAthlete;

  // Sort athletes by progress descending to compute live pack rank (1st, 2nd, etc.)
  const rankedAthletes = [...athletes].sort((a, b) => b.progress - a.progress);

  // Compute vertical stagger tier so close PFPs on the linear bar never occlude each other
  const tierByAthleteId: Record<string, number> = {};
  const sortedAsc = [...athletes].sort((a, b) => a.progress - b.progress);
  sortedAsc.forEach((ath, idx) => {
    if (idx === 0) {
      tierByAthleteId[ath.id] = 0;
    } else {
      const prev = sortedAsc[idx - 1];
      const prevTier = tierByAthleteId[prev.id] ?? 0;
      if (Math.abs(ath.progress - prev.progress) < 5.2) {
        tierByAthleteId[ath.id] = prevTier === 0 ? 1 : 0;
      } else {
        tierByAthleteId[ath.id] = 0;
      }
    }
  });

  // Find which road segment the user is currently traversing
  const currentSegment =
    route.segments.find(
      (s) =>
        selfAthlete.progress >= s.startPct && selfAthlete.progress <= s.endPct
    ) || route.segments[0];

  // Distance gap between selected athlete and self
  const deltaPct = selectedAthlete.progress - selfAthlete.progress;
  const deltaMiles = (deltaPct / 100) * route.totalDistanceMiles;
  const deltaMeters = Math.round(deltaMiles * 1609.34);

  return (
    <section className="relative bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 sm:p-5 shadow-2xl backdrop-blur-xl">
      {/* Top header row of the Live Activity Dock */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-[#D4FF00]/15 border border-[#D4FF00]/40 text-[#D4FF00]">
            <Navigation className="w-4 h-4 rotate-45" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#D4FF00] animate-ping" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#D4FF00]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono-tech uppercase tracking-widest px-2 py-0.5 rounded bg-[#D4FF00]/15 text-[#D4FF00] font-semibold border border-[#D4FF00]/30">
                LIVE ACTIVITY · PACK LINE
              </span>
              <span className="text-xs text-slate-400 font-mono-tech hidden sm:inline">
                {athletes.length} ACTIVE IN SESSION · GPS 5Hz LOCK
              </span>
            </div>
            <h2 className="font-display font-bold text-sm sm:text-base text-white tracking-tight mt-0.5">
              {route.title}
            </h2>
          </div>
        </div>

        {/* Live Road Condition Banner + Quick Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Google Maps style Live Road Condition badge for current segment */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
              CONDITION_COLORS[currentSegment.condition].bg
            } ${CONDITION_COLORS[currentSegment.condition].border} ${
              CONDITION_COLORS[currentSegment.condition].text
            }`}
          >
            {currentSegment.condition === 'optimal' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="font-mono-tech uppercase tracking-wider text-[11px]">
              ROAD: {currentSegment.conditionLabel}
            </span>
          </div>

          {/* Effort / Pace Throttle so user can test overtaking friends on the line */}
          <div className="flex items-center bg-[#080B10] p-1 rounded-xl border border-white/10">
            <span className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400 px-2 hidden md:inline">
              YOUR PACE:
            </span>
            {(['recovery', 'tempo', 'surge'] as const).map((lvl) => {
              const active = effortLevel === lvl;
              return (
                <button
                  key={lvl}
                  onClick={() => onChangeEffort(lvl)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono-tech uppercase font-semibold transition-all cursor-pointer ${
                    active
                      ? lvl === 'surge'
                        ? 'bg-[#D4FF00] text-[#080B10] shadow-[0_0_12px_rgba(212,255,0,0.45)]'
                        : 'bg-white/15 text-white border border-white/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lvl === 'recovery'
                    ? 'Easy'
                    : lvl === 'tempo'
                    ? 'Pack Tempo'
                    : 'Surge +25%'}
                </button>
              );
            })}
          </div>

          {/* Toggle iOS Lock Screen Live Activity Widget Preview */}
          <button
            onClick={onToggleIosWidgetPreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono-tech uppercase tracking-wider transition-all cursor-pointer ${
              showIosWidgetPreview
                ? 'bg-[#00F0FF]/20 border-[#00F0FF]/60 text-[#00F0FF]'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
            }`}
            title="Preview how this Live Activity looks on the iOS Lock Screen & Dynamic Island"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>iOS Lock Screen</span>
          </button>
        </div>
      </div>

      {/* THE LINEAR PROGRESS TRACK WITH PFP AVATARS & GOOGLE MAPS ROAD CONDITIONS */}
      <div className="relative pt-14 pb-8 px-3 sm:px-6 bg-[#080B10]/90 rounded-xl border border-white/10 overflow-visible">
        {/* Subtle Distance Scale Header inside the track box */}
        <div className="absolute top-2.5 left-4 right-4 flex items-center justify-between text-[11px] font-mono-tech text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            START · 0.0 MI
          </span>
          <span className="hidden sm:flex items-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-1.5 rounded-sm bg-[#10B981]" /> Clear Road
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-1.5 rounded-sm bg-[#F59E0B]" /> Wet / Wind Caution
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-1.5 rounded-sm bg-[#EF4444]" /> Steep / Construction
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[#D4FF00]">
            <Flag className="w-3 h-3" />
            FINISH · {route.totalDistanceMiles.toFixed(1)} MI
          </span>
        </div>

        {/* Main Linear Track Container */}
        <div className="relative h-4 w-full rounded-full bg-slate-900/90 border border-white/15 shadow-inner mt-3">
          {/* Road Condition Segments (Google Maps Traffic/Condition Bar style) */}
          <div className="absolute inset-0 rounded-full overflow-hidden flex">
            {route.segments.map((seg) => {
              const widthPct = seg.endPct - seg.startPct;
              const colorHex = CONDITION_COLORS[seg.condition].hex;
              return (
                <div
                  key={seg.id}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: colorHex,
                  }}
                  className="h-full opacity-35 hover:opacity-65 transition-opacity relative group border-r border-black/40 last:border-r-0"
                  title={`${seg.name}: ${seg.conditionLabel} (${seg.gradePct}% grade)`}
                />
              );
            })}
          </div>

          {/* Active Progress Fill for YOU (Volt High-Contrast Line) */}
          <div
            style={{ width: `${Math.min(100, Math.max(0, selfAthlete.progress))}%` }}
            className="absolute top-0 left-0 h-full rounded-l-full bg-gradient-to-r from-[#D4FF00]/30 via-[#D4FF00]/70 to-[#D4FF00] shadow-[0_0_15px_rgba(212,255,0,0.45)] pointer-events-none transition-all duration-300"
          />

          {/* Checkpoint Tick Marks along the line */}
          {route.checkpoints.map((cp) => (
            <div
              key={cp.label}
              style={{ left: `${cp.pct}%` }}
              className="absolute top-0 -translate-x-1/2 h-full flex flex-col items-center pointer-events-none"
            >
              <div className="w-0.5 h-4 bg-white/40" />
              <span className="mt-5 text-[10px] font-mono-tech text-slate-400 whitespace-nowrap hidden md:inline">
                {cp.label} ({cp.pct}%)
              </span>
            </div>
          ))}

          {/* Hazard Pins on the linear track */}
          {hazardPins.map((pin) => {
            const pinColor = CONDITION_COLORS[pin.type].hex;
            return (
              <div
                key={pin.id}
                style={{ left: `${pin.progressPct}%` }}
                className="absolute -bottom-5 -translate-x-1/2 z-10 group cursor-pointer"
                title={`${pin.title}: ${pin.description}`}
              >
                <div
                  style={{ borderColor: pinColor, backgroundColor: '#080B10' }}
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center shadow-md"
                >
                  <span
                    style={{ backgroundColor: pinColor }}
                    className="w-1.5 h-1.5 rounded-full"
                  />
                </div>
              </div>
            );
          })}

          {/* EVERYONE'S PFP AVATARS POSITIONED LIVE ON THE LINE */}
          {athletes.map((athlete) => {
            const rankIndex =
              rankedAthletes.findIndex((r) => r.id === athlete.id) + 1;
            const isSelected = athlete.id === selectedAthleteId;
            const isSpeaking = athlete.id === activeSpeakerId;
            const staggerTier = tierByAthleteId[athlete.id] || 0;
            const verticalOffsetClass =
              staggerTier === 1 ? '-top-14' : '-top-11';

            return (
              <button
                key={athlete.id}
                type="button"
                onClick={() => onSelectAthlete(athlete.id)}
                style={{
                  left: `${Math.min(98.5, Math.max(1.5, athlete.progress))}%`,
                  zIndex: isSpeaking ? 40 : athlete.isSelf ? 35 : isSelected ? 30 : 20,
                }}
                className={`absolute ${verticalOffsetClass} -translate-x-1/2 group flex flex-col items-center focus:outline-none transition-all duration-300 cursor-pointer`}
              >
                {/* Live Speaking Ripple or Self Label */}
                {isSpeaking && (
                  <span className=" -top-5 px-1.5 py-0.5 rounded bg-[#FF4D2A] text-[9px] font-mono-tech font-bold text-white uppercase tracking-wider shadow-lg animate-bounce whitespace-nowrap">
                    PTT VOICE
                  </span>
                )}

                {/* Avatar Circle with Colored Ring */}
                <div className="relative">
                  {isSpeaking && (
                    <span className="absolute -inset-1.5 rounded-full bg-[#FF4D2A]/60 animate-ptt-ring" />
                  )}
                  {athlete.isSelf && !isSpeaking && (
                    <span className="absolute -inset-1 rounded-full bg-[#D4FF00]/35 blur-[2px]" />
                  )}
                  <img
                    src={athlete.avatar}
                    alt={athlete.name}
                    style={{
                      borderColor: isSpeaking ? '#FF4D2A' : athlete.color,
                    }}
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover border-2 shadow-xl transition-transform ${
                      isSelected || athlete.isSelf
                        ? 'scale-110 ring-2 ring-white/40'
                        : 'group-hover:scale-110'
                    }`}
                  />

                  {/* Rank or YOU mini badge */}
                  <span
                    style={{
                      backgroundColor: isSpeaking
                        ? '#FF4D2A'
                        : athlete.isSelf
                        ? '#D4FF00'
                        : '#0E131D',
                      color:
                        athlete.isSelf && !isSpeaking ? '#080B10' : '#FFFFFF',
                      borderColor: athlete.color,
                    }}
                    className="absolute -bottom-1 -right-1 px-1 rounded text-[9px] font-mono-tech font-bold border leading-tight shadow"
                  >
                    {athlete.isSelf ? 'YOU' : `#${rankIndex}`}
                  </span>
                </div>

                {/* Stem line connecting PFP directly to exact spot on the linear bar */}
                <div
                  style={{
                    backgroundColor: isSpeaking ? '#FF4D2A' : athlete.color,
                  }}
                  className={`w-0.5 ${
                    staggerTier === 1 ? 'h-5' : 'h-2.5'
                  } opacity-90`}
                />

                {/* Exact Node Dot on the Linear Progress Track */}
                <div
                  style={{
                    backgroundColor: isSpeaking ? '#FF4D2A' : athlete.color,
                  }}
                  className="w-2.5 h-2.5 rounded-full border border-[#080B10] shadow"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Telemetry Strip of the Live Activity Dock: Everyone's PFP Pills + Selected Athlete Road/Speed Summary */}
      <div className="mt-3.5 pt-3 border-t border-white/10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Clickable PFP Roster Chips with Individual % Progress and Speed */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {rankedAthletes.map((ath, idx) => {
            const isSelected = ath.id === selectedAthleteId;
            const isSpeaking = ath.id === activeSpeakerId;
            const distMi = ((ath.progress / 100) * route.totalDistanceMiles).toFixed(2);
            return (
              <button
                key={ath.id}
                onClick={() => onSelectAthlete(ath.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-white/12 border-white/30 shadow-md'
                    : 'bg-[#080B10]/70 border-white/10 hover:bg-white/5'
                }`}
              >
                <div className="relative">
                  <img
                    src={ath.avatar}
                    alt={ath.name}
                    style={{ borderColor: isSpeaking ? '#FF4D2A' : ath.color }}
                    className="w-7 h-7 rounded-full object-cover border-2"
                  />
                  {isSpeaking && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#FF4D2A] animate-ping" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white">
                      {ath.isSelf ? 'You (Alex)' : ath.name.split(' ')[0]}
                    </span>
                    <span
                      style={{ color: ath.color }}
                      className="text-[11px] font-mono-tech font-bold"
                    >
                      {ath.progress.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[10px] font-mono-tech text-slate-400 flex items-center gap-1.5">
                    <span>#{idx + 1}</span>
                    <span>·</span>
                    <span>{ath.speedMph.toFixed(1)} mph</span>
                    <span>·</span>
                    <span>{distMi} mi</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Live Expected Time, Current Speed & Gap Summary */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 bg-[#080B10]/80 px-3.5 py-2 rounded-xl border border-white/10">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#D4FF00]" />
            <div>
              <div className="text-[10px] font-mono-tech uppercase text-slate-400">
                {selectedAthlete.isSelf ? 'YOUR SPEED' : `${selectedAthlete.name.split(' ')[0]}'S SPEED`}
              </div>
              <div className="text-xs sm:text-sm font-mono-tech font-bold text-white">
                {selectedAthlete.speedMph.toFixed(1)} MPH{' '}
                <span className="text-slate-400 font-normal">
                  ({selectedAthlete.progress.toFixed(1)}% done)
                </span>
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-white/10 hidden sm:block" />

          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#00F0FF]" />
            <div>
              <div className="text-[10px] font-mono-tech uppercase text-slate-400">
                EXPECTED TIME (ETA)
              </div>
              <div className="text-xs sm:text-sm font-mono-tech font-bold text-[#00F0FF]">
                {etaFormatted} <span className="text-slate-400 font-normal">({arrivalClock})</span>
              </div>
            </div>
          </div>

          {!selectedAthlete.isSelf && (
            <>
              <div className="h-6 w-px bg-white/10 hidden sm:block" />
              <div className="text-right">
                <div className="text-[10px] font-mono-tech uppercase text-slate-400">
                  GAP TO YOU
                </div>
                <div
                  className={`text-xs font-mono-tech font-bold ${
                    deltaMeters >= 0 ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  {deltaMeters >= 0
                    ? `+${deltaMeters}m ahead`
                    : `${deltaMeters}m behind`}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* OPTIONAL iOS 18 LOCK SCREEN LIVE ACTIVITY & DYNAMIC ISLAND WIDGET OVERLAY */}
      {showIosWidgetPreview && (
        <div className="mt-4 pt-4 border-t border-white/15 animate-fadeIn">
          <div className="max-w-xl mx-auto bg-gradient-to-b from-[#171C28] to-[#0B0E17] border border-white/20 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#D4FF00] animate-pulse" />
                <span className="text-[11px] font-mono-tech uppercase tracking-wider text-[#D4FF00] font-semibold">
                  iOS 18 Live Activity · Lock Screen Widget (Expo ActivityKit)
                </span>
              </div>
              <span className="text-[11px] font-mono-tech text-slate-400">
                Updated Live
              </span>
            </div>

            {/* Compact Lock Screen Card */}
            <div className="bg-black/60 rounded-2xl p-3.5 border border-white/10">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-display font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#D4FF00]" />
                  {route.mode === 'run' ? 'Pack Run · Crissy Field' : 'Peloton Ride · Marin Loop'}
                </span>
                <span className="font-mono-tech text-[#00F0FF] font-semibold">
                  ETA {etaFormatted} · {selfAthlete.speedMph.toFixed(1)} mph
                </span>
              </div>

              {/* Mini Linear Progress with PFPs on Lock Screen */}
              <div className="relative h-2.5 rounded-full bg-slate-800 my-6">
                <div className="absolute inset-0 rounded-full overflow-hidden flex">
                  {route.segments.map((seg) => (
                    <div
                      key={seg.id}
                      style={{
                        width: `${seg.endPct - seg.startPct}%`,
                        backgroundColor: CONDITION_COLORS[seg.condition].hex,
                      }}
                      className="h-full opacity-50"
                    />
                  ))}
                </div>
                <div
                  style={{ width: `${selfAthlete.progress}%` }}
                  className="absolute left-0 top-0 h-full rounded-l-full bg-[#D4FF00]"
                />
                {athletes.map((ath) => (
                  <img
                    key={ath.id}
                    src={ath.avatar}
                    alt={ath.name}
                    style={{
                      left: `${ath.progress}%`,
                      borderColor: ath.color,
                    }}
                    className="w-6 h-6 rounded-full object-cover border-2 absolute -top-2 -translate-x-1/2 shadow-md"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono-tech text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-amber-400" />
                  {currentSegment.conditionLabel}
                </span>
                <span className="flex items-center gap-1.5 text-[#FF4D2A]">
                  <Radio className="w-3.5 h-3.5" />
                  LiveKit PTT Ready
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
