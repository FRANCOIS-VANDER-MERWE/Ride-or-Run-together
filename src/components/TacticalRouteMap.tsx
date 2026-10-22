import React, { useState } from 'react';
import {
  MapPin,
  Wind,
  Thermometer,
  Compass,
  Layers,
  PlusCircle,
  AlertTriangle,
  CheckCircle2,
  Navigation2,
  Mountain,
  ShieldAlert,
  Eye,
} from 'lucide-react';
import {
  Athlete,
  RoadConditionType,
  RoadHazardPin,
  RouteConfig,
} from '../data/sessionData';
import { CONDITION_COLORS } from './LiveActivityProgressDock';

interface TacticalRouteMapProps {
  route: RouteConfig;
  athletes: Athlete[];
  selectedAthleteId: string;
  onSelectAthlete: (id: string) => void;
  activeSpeakerId: string | null;
  hazardPins: RoadHazardPin[];
  onAddHazardPin: (type: RoadConditionType, title: string, description: string) => void;
}

// Deterministic piecewise route polyline (viewBox 0 0 800 420)
const ROUTE_WAYPOINTS: { pct: number; x: number; y: number }[] = [
  { pct: 0, x: 68, y: 342 },
  { pct: 12, x: 145, y: 318 },
  { pct: 25, x: 230, y: 274 },
  { pct: 35, x: 305, y: 256 },
  { pct: 48, x: 392, y: 222 },
  { pct: 62, x: 488, y: 196 },
  { pct: 72, x: 560, y: 138 },
  { pct: 82, x: 632, y: 108 },
  { pct: 92, x: 702, y: 92 },
  { pct: 100, x: 748, y: 74 },
];

function getPointAtProgress(pct: number): { x: number; y: number; angleDeg: number } {
  const clamped = Math.max(0, Math.min(100, pct));
  for (let i = 0; i < ROUTE_WAYPOINTS.length - 1; i++) {
    const p0 = ROUTE_WAYPOINTS[i];
    const p1 = ROUTE_WAYPOINTS[i + 1];
    if (clamped >= p0.pct && clamped <= p1.pct) {
      const span = p1.pct - p0.pct || 1;
      const t = (clamped - p0.pct) / span;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const angleDeg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      return { x, y, angleDeg };
    }
  }
  const last = ROUTE_WAYPOINTS[ROUTE_WAYPOINTS.length - 1];
  return { x: last.x, y: last.y, angleDeg: -15 };
}

function buildSegmentSvgPoints(startPct: number, endPct: number): string {
  const pts: string[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const pct = startPct + ((endPct - startPct) * i) / steps;
    const { x, y } = getPointAtProgress(pct);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

export default function TacticalRouteMap({
  route,
  athletes,
  selectedAthleteId,
  onSelectAthlete,
  activeSpeakerId,
  hazardPins,
  onAddHazardPin,
}: TacticalRouteMapProps) {
  const [showRoadConditions, setShowRoadConditions] = useState(true);
  const [showWindOverlay, setShowWindOverlay] = useState(true);
  const [showPackTethers, setShowPackTethers] = useState(true);
  const [activeHazardId, setActiveHazardId] = useState<string | null>(null);
  const [showReportDrawer, setShowReportDrawer] = useState(false);

  const selfAthlete = athletes.find((a) => a.isSelf) || athletes[0];
  const leaderAthlete = [...athletes].sort((a, b) => b.progress - a.progress)[0];
  const selectedAthlete =
    athletes.find((a) => a.id === selectedAthleteId) || selfAthlete;

  const selfPoint = getPointAtProgress(selfAthlete.progress);
  const leaderPoint = getPointAtProgress(leaderAthlete.progress);

  const activeHazard =
    hazardPins.find((h) => h.id === activeHazardId) || hazardPins[1] || hazardPins[0];

  const quickHazardPresets: {
    type: RoadConditionType;
    title: string;
    description: string;
  }[] = [
    {
      type: 'caution',
      title: 'Wet Surface / Standing Water',
      description: 'Slick asphalt patch reported by pack — reduce cornering lean.',
    },
    {
      type: 'hazard',
      title: 'Pothole / Lane Obstruction',
      description: 'Single-file right shoulder obstruction ahead — call out to pack.',
    },
    {
      type: 'caution',
      title: '18mph Crosswind Gust Zone',
      description: 'Strong coastal crosswind gusting across exposed causeway.',
    },
    {
      type: 'optimal',
      title: 'All Clear · Green Sprint Corridor',
      description: 'Road wide open and dry — safe for high-tempo surge.',
    },
  ];

  return (
    <div className="relative bg-[#0B0F18] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between min-h-[430px]">
      {/* TOP FLOATING HUD BAR: GOOGLE MAPS ROAD CONDITIONS & WEATHER TELEMETRY */}
      <div className="relative z-20 p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-[#080B10]/95 via-[#080B10]/70 to-transparent">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#111726]/90 border border-white/15 backdrop-blur-md">
            <Compass className="w-4 h-4 text-[#D4FF00]" />
            <span className="text-xs font-mono-tech font-semibold text-white">
              {route.locationLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#111726]/90 border border-white/15 backdrop-blur-md text-xs font-mono-tech text-slate-300">
            <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
            <span>{route.weatherTempF}°F</span>
            <span className="text-slate-600">|</span>
            <Wind className="w-3.5 h-3.5 text-amber-400" />
            <span>
              {route.headwindMph} mph {route.headwindDir}
            </span>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <Mountain className="w-3.5 h-3.5 text-emerald-400 hidden sm:inline" />
            <span className="hidden sm:inline">+{route.elevationGainFt} ft</span>
          </div>
        </div>

        {/* Layer Toggle Pills + Report Road Hazard Button */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowRoadConditions((v) => !v)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono-tech uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
              showRoadConditions
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                : 'bg-[#111726]/80 border-white/10 text-slate-400'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Road Conditions</span>
          </button>

          <button
            onClick={() => setShowPackTethers((v) => !v)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono-tech uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
              showPackTethers
                ? 'bg-[#00F0FF]/15 border-[#00F0FF]/50 text-[#00F0FF]'
                : 'bg-[#111726]/80 border-white/10 text-slate-400'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Draft Tethers</span>
          </button>

          <button
            onClick={() => setShowReportDrawer((v) => !v)}
            className="px-3 py-1.5 rounded-xl bg-[#D4FF00] text-[#080B10] font-mono-tech font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 hover:bg-[#e1ff38] transition-all shadow-[0_0_15px_rgba(212,255,0,0.3)] cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Pin Condition</span>
          </button>
        </div>
      </div>

      {/* OPTIONAL DRAWER TO DROP A LIVE GOOGLE MAPS / PACK ROAD CONDITION PIN */}
      {showReportDrawer && (
        <div className="relative z-30 mx-4 mb-2 p-3.5 rounded-xl bg-[#111726]/95 border border-[#D4FF00]/40 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono-tech uppercase tracking-wider text-[#D4FF00] font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" />
              Broadcast Road Condition Pin at Your GPS Position ({selfAthlete.progress.toFixed(1)}%)
            </span>
            <button
              onClick={() => setShowReportDrawer(false)}
              className="text-xs font-mono-tech text-slate-400 hover:text-white cursor-pointer"
            >
              [CLOSE]
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {quickHazardPresets.map((preset) => (
              <button
                key={preset.title}
                onClick={() => {
                  onAddHazardPin(preset.type, preset.title, preset.description);
                  setShowReportDrawer(false);
                }}
                className={`p-2.5 rounded-xl border text-left transition-all hover:scale-[1.01] cursor-pointer ${
                  CONDITION_COLORS[preset.type].bg
                } ${CONDITION_COLORS[preset.type].border}`}
              >
                <div
                  className={`text-xs font-bold ${
                    CONDITION_COLORS[preset.type].text
                  }`}
                >
                  {preset.title}
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* VECTOR GPS MAP CANVAS */}
      <div className="relative flex-1 w-full min-h-[280px] sm:min-h-[320px] flex items-center justify-center">
        <svg
          viewBox="0 0 800 420"
          className="w-full h-full object-cover select-none"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="mapGlow" cx="55%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#162238" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#080B10" stopOpacity="0.95" />
            </radialGradient>
            <pattern
              id="tacticalGrid"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 48 0 L 0 0 0 48"
                fill="none"
                stroke="rgba(148, 163, 184, 0.07)"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          {/* Base Dark Asphalt & Bay Water Geometry */}
          <rect width="800" height="420" fill="url(#mapGlow)" />
          <rect width="800" height="420" fill="url(#tacticalGrid)" />

          {/* Stylized Bay Coastline & Topographic Elevation Contours */}
          <path
            d="M 0,240 Q 180,210 330,145 T 620,40 L 0,0 Z"
            fill="rgba(14, 116, 144, 0.09)"
            stroke="rgba(56, 189, 248, 0.16)"
            strokeWidth="1.5"
          />
          <path
            d="M 450,390 Q 560,260 790,190"
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
            strokeDasharray="6 6"
          />
          <path
            d="M 110,395 Q 320,310 560,250 T 790,130"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1.2"
          />
          <ellipse
            cx="650"
            cy="115"
            rx="115"
            ry="62"
            fill="none"
            stroke="rgba(239, 68, 68, 0.12)"
            strokeDasharray="4 4"
          />
          <ellipse
            cx="650"
            cy="115"
            rx="72"
            ry="38"
            fill="none"
            stroke="rgba(239, 68, 68, 0.18)"
            strokeDasharray="3 3"
          />

          {/* Wind Vector Arrows when Wind Overlay is active */}
          {showWindOverlay && (
            <g opacity="0.45">
              {[
                { x: 210, y: 155 },
                { x: 375, y: 135 },
                { x: 510, y: 95 },
              ].map((w, idx) => (
                <g key={idx} transform={`translate(${w.x}, ${w.y}) rotate(22)`}>
                  <line
                    x1="0"
                    y1="0"
                    x2="38"
                    y2="0"
                    stroke="#38BDF8"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <polygon points="38,-3 45,0 38,3" fill="#38BDF8" />
                  <text
                    x="4"
                    y="-6"
                    fill="#38BDF8"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    WIND {route.headwindMph}MPH
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Base Route Track Casing */}
          <polyline
            points={buildSegmentSvgPoints(0, 100)}
            fill="none"
            stroke="rgba(15, 23, 42, 0.95)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={buildSegmentSvgPoints(0, 100)}
            fill="none"
            stroke="rgba(255, 255, 255, 0.14)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* GOOGLE MAPS-STYLE COLOR-CODED ROAD CONDITION SEGMENTS */}
          {showRoadConditions &&
            route.segments.map((seg) => {
              const pts = buildSegmentSvgPoints(seg.startPct, seg.endPct);
              const strokeHex = CONDITION_COLORS[seg.condition].hex;
              const midPt = getPointAtProgress((seg.startPct + seg.endPct) / 2);
              return (
                <g key={seg.id}>
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={strokeHex}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.82"
                  />
                  {/* Animated directional flow dashes along the road segment */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    strokeDasharray="6 18"
                    className="animate-route-flow"
                    opacity="0.55"
                  />
                  {/* Segment Label Pill on Map */}
                  <g transform={`translate(${midPt.x}, ${midPt.y + 24})`}>
                    <rect
                      x="-64"
                      y="-10"
                      width="128"
                      height="18"
                      rx="5"
                      fill="rgba(8, 11, 16, 0.88)"
                      stroke={strokeHex}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="2"
                      textAnchor="middle"
                      fill={strokeHex}
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="600"
                    >
                      {seg.gradePct > 4
                        ? `GRADE +${seg.gradePct}% · CAUTION`
                        : seg.conditionLabel.slice(0, 20)}
                    </text>
                  </g>
                </g>
              );
            })}

          {/* Draft / Distance Tether Line between YOU and Pack Leader */}
          {showPackTethers && leaderAthlete.id !== selfAthlete.id && (
            <g>
              <line
                x1={selfPoint.x}
                y1={selfPoint.y}
                x2={leaderPoint.x}
                y2={leaderPoint.y}
                stroke="#00F0FF"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <g
                transform={`translate(${(selfPoint.x + leaderPoint.x) / 2}, ${
                  (selfPoint.y + leaderPoint.y) / 2 - 14
                })`}
              >
                <rect
                  x="-42"
                  y="-9"
                  width="84"
                  height="16"
                  rx="4"
                  fill="#080B10"
                  stroke="#00F0FF"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="2"
                  textAnchor="middle"
                  fill="#00F0FF"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  GAP{' '}
                  {Math.round(
                    ((leaderAthlete.progress - selfAthlete.progress) / 100) *
                      route.totalDistanceMiles *
                      1609.34
                  )}
                  m
                </text>
              </g>
            </g>
          )}

          {/* Checkpoint Nodes */}
          {route.checkpoints.map((cp) => {
            const pt = getPointAtProgress(cp.pct);
            return (
              <g key={cp.label} transform={`translate(${pt.x}, ${pt.y})`}>
                <circle
                  r="5"
                  fill="#080B10"
                  stroke="#94A3B8"
                  strokeWidth="2"
                />
                <text
                  x="0"
                  y="-11"
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {cp.label}
                </text>
              </g>
            );
          })}

          {/* Hazard Pins on the GPS Route */}
          {hazardPins.map((pin) => {
            const pt = getPointAtProgress(pin.progressPct);
            const colorHex = CONDITION_COLORS[pin.type].hex;
            const isActive = activeHazard?.id === pin.id;
            return (
              <g
                key={pin.id}
                transform={`translate(${pt.x}, ${pt.y - 22})`}
                onClick={() => setActiveHazardId(pin.id)}
                className="cursor-pointer"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="0"
                  y2="22"
                  stroke={colorHex}
                  strokeWidth="2"
                />
                <circle
                  r={isActive ? 11 : 8}
                  fill="#080B10"
                  stroke={colorHex}
                  strokeWidth="2.5"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill={colorHex}
                  fontSize="10"
                  fontWeight="800"
                  fontFamily="JetBrains Mono, monospace"
                >
                  !
                </text>
              </g>
            );
          })}

          {/* LIVE MOVING ATHLETE MARKERS ON THE GPS ROUTE */}
          {athletes.map((athlete) => {
            const pt = getPointAtProgress(athlete.progress);
            const isSelected = athlete.id === selectedAthleteId;
            const isSpeaking = athlete.id === activeSpeakerId;
            const ringColor = isSpeaking ? '#FF4D2A' : athlete.color;

            return (
              <g
                key={athlete.id}
                transform={`translate(${pt.x}, ${pt.y})`}
                onClick={() => onSelectAthlete(athlete.id)}
                className="cursor-pointer"
              >
                {/* Outer Pulse Halo if speaking on Walkie-Talkie or if Self */}
                {(isSpeaking || athlete.isSelf || isSelected) && (
                  <circle
                    r={isSpeaking ? 24 : 19}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={isSpeaking ? 2.5 : 1.5}
                    opacity={isSpeaking ? 0.85 : 0.45}
                  />
                )}

                {/* Marker Dot & Speed Callout Tag */}
                <circle
                  r="12"
                  fill="#0B0F18"
                  stroke={ringColor}
                  strokeWidth="3"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="8.5"
                  fontWeight="700"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  {athlete.isSelf
                    ? 'YOU'
                    : athlete.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                </text>

                {/* Floating Telemetry Callout Pill above Selected or Self Athlete */}
                {(isSelected || athlete.isSelf || isSpeaking) && (
                  <g transform="translate(0, -24)">
                    <rect
                      x="-48"
                      y="-14"
                      width="96"
                      height="18"
                      rx="5"
                      fill={isSpeaking ? '#FF4D2A' : '#080B10'}
                      stroke={ringColor}
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="700"
                    >
                      {isSpeaking
                        ? `${athlete.name.split(' ')[0]} · MIC OPEN`
                        : `${athlete.name.split(' ')[0]} · ${athlete.speedMph.toFixed(1)}mph`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* BOTTOM TELEMETRY & ROAD CONDITION DETAIL STRIP */}
      <div className="relative z-20 p-3.5 sm:p-4 bg-[#080B10]/95 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Selected Athlete Telemetry Focus */}
        <div className="flex items-center gap-3 bg-[#111726]/80 p-2.5 rounded-xl border border-white/10">
          <img
            src={selectedAthlete.avatar}
            alt={selectedAthlete.name}
            style={{ borderColor: selectedAthlete.color }}
            className="w-10 h-10 rounded-full object-cover border-2 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white truncate">
                {selectedAthlete.name}
              </span>
              <span className="text-[10px] font-mono-tech px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                {selectedAthlete.role}
              </span>
            </div>
            <div className="text-[11px] font-mono-tech text-slate-400 mt-0.5">
              {selectedAthlete.speedMph.toFixed(1)} mph · {selectedAthlete.heartRate} bpm ·{' '}
              {selectedAthlete.cadence} {route.mode === 'run' ? 'spm' : 'rpm'}
            </div>
          </div>
        </div>

        {/* Active Road Condition / Hazard Inspector */}
        <div className="flex items-center gap-3 bg-[#111726]/80 p-2.5 rounded-xl border border-white/10 md:col-span-2 justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${
                CONDITION_COLORS[activeHazard.type].bg
              } ${CONDITION_COLORS[activeHazard.type].border} ${
                CONDITION_COLORS[activeHazard.type].text
              }`}
            >
              {activeHazard.type === 'optimal' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate">
                  {activeHazard.title}
                </span>
                <span className="text-[10px] font-mono-tech text-slate-400">
                  @ {activeHazard.progressPct.toFixed(0)}% route · via {activeHazard.reportedBy}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {activeHazard.description}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {hazardPins.map((pin) => (
              <button
                key={pin.id}
                onClick={() => setActiveHazardId(pin.id)}
                className={`w-6 h-6 rounded-lg font-mono-tech text-[10px] font-bold border transition-all cursor-pointer ${
                  activeHazard.id === pin.id
                    ? 'bg-white text-black border-white'
                    : 'bg-black/50 text-slate-400 border-white/15 hover:text-white'
                }`}
                title={pin.title}
              >
                !
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
