import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
import Svg, {
  Defs,
  RadialGradient,
  Stop,
  Rect,
  Path,
  Ellipse,
  G,
  Line,
  Polygon,
  Polyline,
  Circle,
  Text as SvgText,
} from 'react-native-svg';
import {
  Wind,
  Thermometer,
  Compass,
  Layers,
  PlusCircle,
  AlertTriangle,
  CheckCircle2,
  Mountain,
  ShieldAlert,
  Eye,
} from './Icons';
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
  onAddHazardPin: (
    type: RoadConditionType,
    title: string,
    description: string
  ) => void;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

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

function getPointAtProgress(pct: number): {
  x: number;
  y: number;
  angleDeg: number;
} {
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
    hazardPins.find((h) => h.id === activeHazardId) ||
    hazardPins[1] ||
    hazardPins[0];

  const quickHazardPresets: {
    type: RoadConditionType;
    title: string;
    description: string;
  }[] = [
    {
      type: 'caution',
      title: 'Wet Surface / Standing Water',
      description:
        'Slick asphalt patch reported by pack — reduce cornering lean.',
    },
    {
      type: 'hazard',
      title: 'Pothole / Lane Obstruction',
      description:
        'Single-file right shoulder obstruction ahead — call out to pack.',
    },
    {
      type: 'caution',
      title: '18mph Crosswind Gust Zone',
      description:
        'Strong coastal crosswind gusting across exposed causeway.',
    },
    {
      type: 'optimal',
      title: 'All Clear · Green Sprint Corridor',
      description: 'Road wide open and dry — safe for high-tempo surge.',
    },
  ];

  const activeHazardStyle = CONDITION_COLORS[activeHazard.type];

  return (
    <View style={styles.container}>
      {/* TOP HUD BAR: GOOGLE MAPS ROAD CONDITIONS & WEATHER TELEMETRY */}
      <View style={styles.topHud}>
        <View style={styles.hudRow}>
          <View style={styles.locationPill}>
            <Compass size={14} color="#D4FF00" />
            <Text style={styles.locationText} numberOfLines={1}>
              {route.locationLabel}
            </Text>
          </View>

          <View style={styles.weatherPill}>
            <Thermometer size={13} color="#22D3EE" />
            <Text style={styles.weatherText}>{route.weatherTempF}°F</Text>
            <Text style={styles.weatherDivider}>|</Text>
            <Wind size={13} color="#FBBF24" />
            <Text style={styles.weatherText}>
              {route.headwindMph} mph {route.headwindDir}
            </Text>
            <Text style={styles.weatherDivider}>|</Text>
            <Mountain size={13} color="#34D399" />
            <Text style={styles.weatherText}>+{route.elevationGainFt} ft</Text>
          </View>
        </View>

        {/* Layer Toggles + Report Road Hazard Button */}
        <View style={styles.layerControlsRow}>
          <Pressable
            onPress={() => setShowRoadConditions((v) => !v)}
            style={[
              styles.layerBtn,
              showRoadConditions && styles.layerBtnEmerald,
            ]}
          >
            <Layers
              size={13}
              color={showRoadConditions ? '#6EE7B7' : '#94A3B8'}
            />
            <Text
              style={[
                styles.layerBtnText,
                showRoadConditions && { color: '#6EE7B7' },
              ]}
            >
              Road Conditions
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setShowPackTethers((v) => !v)}
            style={[styles.layerBtn, showPackTethers && styles.layerBtnCyan]}
          >
            <Eye size={13} color={showPackTethers ? '#00F0FF' : '#94A3B8'} />
            <Text
              style={[
                styles.layerBtnText,
                showPackTethers && { color: '#00F0FF' },
              ]}
            >
              Draft Tethers
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setShowWindOverlay((v) => !v)}
            style={[styles.layerBtn, showWindOverlay && styles.layerBtnSky]}
          >
            <Wind size={13} color={showWindOverlay ? '#38BDF8' : '#94A3B8'} />
            <Text
              style={[
                styles.layerBtnText,
                showWindOverlay && { color: '#38BDF8' },
              ]}
            >
              Wind
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setShowReportDrawer((v) => !v)}
            style={styles.pinActionBtn}
          >
            <PlusCircle size={13} color="#080B10" />
            <Text style={styles.pinActionBtnText}>Pin Condition</Text>
          </Pressable>
        </View>
      </View>

      {/* OPTIONAL DRAWER TO DROP A LIVE GOOGLE MAPS / PACK ROAD CONDITION PIN */}
      {showReportDrawer && (
        <View style={styles.reportDrawer}>
          <View style={styles.reportDrawerHeader}>
            <View style={styles.reportDrawerTitleRow}>
              <ShieldAlert size={14} color="#D4FF00" />
              <Text style={styles.reportDrawerTitle}>
                Broadcast Road Pin at GPS {selfAthlete.progress.toFixed(1)}%
              </Text>
            </View>
            <Pressable onPress={() => setShowReportDrawer(false)}>
              <Text style={styles.closeDrawerText}>[CLOSE]</Text>
            </Pressable>
          </View>

          <View style={styles.presetsGrid}>
            {quickHazardPresets.map((preset) => {
              const pColor = CONDITION_COLORS[preset.type];
              return (
                <Pressable
                  key={preset.title}
                  onPress={() => {
                    onAddHazardPin(
                      preset.type,
                      preset.title,
                      preset.description
                    );
                    setShowReportDrawer(false);
                  }}
                  style={[
                    styles.presetCard,
                    {
                      backgroundColor: pColor.bgHex,
                      borderColor: pColor.borderHex,
                    },
                  ]}
                >
                  <Text
                    style={[styles.presetTitle, { color: pColor.textHex }]}
                  >
                    {preset.title}
                  </Text>
                  <Text style={styles.presetDesc} numberOfLines={2}>
                    {preset.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* VECTOR GPS MAP CANVAS (react-native-svg) */}
      <View style={styles.mapCanvasWrap}>
        <Svg
          viewBox="0 0 800 420"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
        >
          <Defs>
            <RadialGradient id="mapGlow" cx="55%" cy="45%" r="55%">
              <Stop offset="0%" stopColor="#162238" stopOpacity="0.7" />
              <Stop offset="100%" stopColor="#080B10" stopOpacity="0.98" />
            </RadialGradient>
          </Defs>

          {/* Base Dark Asphalt & Bay Water Geometry */}
          <Rect width="800" height="420" fill="url(#mapGlow)" />

          {/* Subtle Grid Lines */}
          {[80, 160, 240, 320, 400, 480, 560, 640, 720].map((gx) => (
            <Line
              key={`gx-${gx}`}
              x1={gx}
              y1={0}
              x2={gx}
              y2={420}
              stroke="rgba(148, 163, 184, 0.06)"
              strokeWidth="1"
            />
          ))}
          {[70, 140, 210, 280, 350].map((gy) => (
            <Line
              key={`gy-${gy}`}
              x1={0}
              y1={gy}
              x2={800}
              y2={gy}
              stroke="rgba(148, 163, 184, 0.06)"
              strokeWidth="1"
            />
          ))}

          {/* Stylized Bay Coastline & Topographic Elevation Contours */}
          <Path
            d="M 0,240 Q 180,210 330,145 T 620,40 L 0,0 Z"
            fill="rgba(14, 116, 144, 0.12)"
            stroke="rgba(56, 189, 248, 0.2)"
            strokeWidth="1.5"
          />
          <Path
            d="M 450,390 Q 560,260 790,190"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            strokeDasharray="6,6"
          />
          <Path
            d="M 110,395 Q 320,310 560,250 T 790,130"
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1.2"
          />
          <Ellipse
            cx="650"
            cy="115"
            rx="115"
            ry="62"
            fill="none"
            stroke="rgba(239, 68, 68, 0.14)"
            strokeDasharray="4,4"
          />
          <Ellipse
            cx="650"
            cy="115"
            rx="72"
            ry="38"
            fill="none"
            stroke="rgba(239, 68, 68, 0.2)"
            strokeDasharray="3,3"
          />

          {/* Wind Vector Arrows */}
          {showWindOverlay && (
            <G opacity="0.55">
              {[
                { x: 210, y: 155 },
                { x: 375, y: 135 },
                { x: 510, y: 95 },
              ].map((w, idx) => (
                <G
                  key={idx}
                  transform={`translate(${w.x}, ${w.y}) rotate(22)`}
                >
                  <Line
                    x1="0"
                    y1="0"
                    x2="38"
                    y2="0"
                    stroke="#38BDF8"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                  />
                  <Polygon points="38,-3 45,0 38,3" fill="#38BDF8" />
                  <SvgText
                    x="4"
                    y="-6"
                    fill="#38BDF8"
                    fontSize="9"
                    fontWeight="600"
                  >
                    WIND {route.headwindMph}MPH
                  </SvgText>
                </G>
              ))}
            </G>
          )}

          {/* Base Route Track Casing */}
          <Polyline
            points={buildSegmentSvgPoints(0, 100)}
            fill="none"
            stroke="rgba(15, 23, 42, 0.95)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points={buildSegmentSvgPoints(0, 100)}
            fill="none"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* GOOGLE MAPS-STYLE COLOR-CODED ROAD CONDITION SEGMENTS */}
          {showRoadConditions &&
            route.segments.map((seg) => {
              const pts = buildSegmentSvgPoints(seg.startPct, seg.endPct);
              const strokeHex = CONDITION_COLORS[seg.condition].hex;
              const midPt = getPointAtProgress(
                (seg.startPct + seg.endPct) / 2
              );
              return (
                <G key={seg.id}>
                  <Polyline
                    points={pts}
                    fill="none"
                    stroke={strokeHex}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.85"
                  />
                  <Polyline
                    points={pts}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    strokeDasharray="6,18"
                    opacity="0.55"
                  />
                  <G transform={`translate(${midPt.x}, ${midPt.y + 24})`}>
                    <Rect
                      x="-68"
                      y="-10"
                      width="136"
                      height="18"
                      rx="5"
                      fill="rgba(8, 11, 16, 0.9)"
                      stroke={strokeHex}
                      strokeWidth="1"
                    />
                    <SvgText
                      x="0"
                      y="2.5"
                      textAnchor="middle"
                      fill={strokeHex}
                      fontSize="8.5"
                      fontWeight="700"
                    >
                      {seg.gradePct > 4
                        ? `GRADE +${seg.gradePct}% · CAUTION`
                        : seg.conditionLabel.slice(0, 20)}
                    </SvgText>
                  </G>
                </G>
              );
            })}

          {/* Draft / Distance Tether Line between YOU and Pack Leader */}
          {showPackTethers && leaderAthlete.id !== selfAthlete.id && (
            <G>
              <Line
                x1={selfPoint.x}
                y1={selfPoint.y}
                x2={leaderPoint.x}
                y2={leaderPoint.y}
                stroke="#00F0FF"
                strokeWidth="2"
                strokeDasharray="4,4"
              />
              <G
                transform={`translate(${(selfPoint.x + leaderPoint.x) / 2}, ${
                  (selfPoint.y + leaderPoint.y) / 2 - 14
                })`}
              >
                <Rect
                  x="-42"
                  y="-9"
                  width="84"
                  height="16"
                  rx="4"
                  fill="#080B10"
                  stroke="#00F0FF"
                  strokeWidth="1"
                />
                <SvgText
                  x="0"
                  y="2.5"
                  textAnchor="middle"
                  fill="#00F0FF"
                  fontSize="8.5"
                  fontWeight="700"
                >
                  GAP{' '}
                  {Math.round(
                    ((leaderAthlete.progress - selfAthlete.progress) / 100) *
                      route.totalDistanceMiles *
                      1609.34
                  )}
                  m
                </SvgText>
              </G>
            </G>
          )}

          {/* Checkpoint Nodes */}
          {route.checkpoints.map((cp) => {
            const pt = getPointAtProgress(cp.pct);
            return (
              <G key={cp.label} transform={`translate(${pt.x}, ${pt.y})`}>
                <Circle
                  r="5"
                  fill="#080B10"
                  stroke="#94A3B8"
                  strokeWidth="2"
                />
                <SvgText
                  x="0"
                  y="-11"
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="9"
                >
                  {cp.label}
                </SvgText>
              </G>
            );
          })}

          {/* Hazard Pins on the GPS Route */}
          {hazardPins.map((pin) => {
            const pt = getPointAtProgress(pin.progressPct);
            const colorHex = CONDITION_COLORS[pin.type].hex;
            const isActive = activeHazard?.id === pin.id;
            return (
              <G
                key={pin.id}
                transform={`translate(${pt.x}, ${pt.y - 22})`}
                onPress={() => setActiveHazardId(pin.id)}
              >
                <Line
                  x1="0"
                  y1="8"
                  x2="0"
                  y2="22"
                  stroke={colorHex}
                  strokeWidth="2"
                />
                <Circle
                  r={isActive ? 11 : 8}
                  fill="#080B10"
                  stroke={colorHex}
                  strokeWidth="2.5"
                />
                <SvgText
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill={colorHex}
                  fontSize="10"
                  fontWeight="800"
                >
                  !
                </SvgText>
              </G>
            );
          })}

          {/* LIVE MOVING ATHLETE MARKERS ON THE GPS ROUTE */}
          {athletes.map((athlete) => {
            const pt = getPointAtProgress(athlete.progress);
            const isSelected = athlete.id === selectedAthleteId;
            const isSpeaking = athlete.id === activeSpeakerId;
            const ringColor = isSpeaking ? '#FF4D2A' : athlete.color;

            return (
              <G
                key={athlete.id}
                transform={`translate(${pt.x}, ${pt.y})`}
                onPress={() => onSelectAthlete(athlete.id)}
              >
                {(isSpeaking || athlete.isSelf || isSelected) && (
                  <Circle
                    r={isSpeaking ? 24 : 19}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={isSpeaking ? 2.5 : 1.5}
                    opacity={isSpeaking ? 0.85 : 0.45}
                  />
                )}

                <Circle
                  r="12"
                  fill="#0B0F18"
                  stroke={ringColor}
                  strokeWidth="3"
                />
                <SvgText
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="8.5"
                  fontWeight="700"
                >
                  {athlete.isSelf
                    ? 'YOU'
                    : athlete.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                </SvgText>

                {(isSelected || athlete.isSelf || isSpeaking) && (
                  <G transform="translate(0, -24)">
                    <Rect
                      x="-50"
                      y="-14"
                      width="100"
                      height="18"
                      rx="5"
                      fill={isSpeaking ? '#FF4D2A' : '#080B10'}
                      stroke={ringColor}
                      strokeWidth="1.2"
                    />
                    <SvgText
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="8.5"
                      fontWeight="700"
                    >
                      {isSpeaking
                        ? `${athlete.name.split(' ')[0]} · MIC OPEN`
                        : `${athlete.name.split(' ')[0]} · ${athlete.speedMph.toFixed(1)}mph`}
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })}
        </Svg>
      </View>

      {/* BOTTOM TELEMETRY & ROAD CONDITION DETAIL STRIP */}
      <View style={styles.bottomBar}>
        {/* Selected Athlete Telemetry Focus */}
        <View style={styles.athleteFocusCard}>
          <Image
            source={{ uri: selectedAthlete.avatar }}
            style={[
              styles.focusAvatar,
              { borderColor: selectedAthlete.color },
            ]}
          />
          <View style={{ flex: 1 }}>
            <View style={styles.focusNameRow}>
              <Text style={styles.focusName} numberOfLines={1}>
                {selectedAthlete.name}
              </Text>
              <View style={styles.roleTag}>
                <Text style={styles.roleTagText}>{selectedAthlete.role}</Text>
              </View>
            </View>
            <Text style={styles.focusStats}>
              {selectedAthlete.speedMph.toFixed(1)} mph ·{' '}
              {selectedAthlete.heartRate} bpm · {selectedAthlete.cadence}{' '}
              {route.mode === 'run' ? 'spm' : 'rpm'}
            </Text>
          </View>
        </View>

        {/* Active Road Condition / Hazard Inspector */}
        <View style={styles.hazardInspectorCard}>
          <View style={styles.hazardInspectorMain}>
            <View
              style={[
                styles.hazardIconBox,
                {
                  backgroundColor: activeHazardStyle.bgHex,
                  borderColor: activeHazardStyle.borderHex,
                },
              ]}
            >
              {activeHazard.type === 'optimal' ? (
                <CheckCircle2 size={16} color={activeHazardStyle.textHex} />
              ) : (
                <AlertTriangle size={16} color={activeHazardStyle.textHex} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.hazardHeaderRow}>
                <Text style={styles.hazardTitle} numberOfLines={1}>
                  {activeHazard.title}
                </Text>
                <Text style={styles.hazardMeta}>
                  @{activeHazard.progressPct.toFixed(0)}% ·{' '}
                  {activeHazard.reportedBy}
                </Text>
              </View>
              <Text style={styles.hazardDesc} numberOfLines={2}>
                {activeHazard.description}
              </Text>
            </View>
          </View>

          <View style={styles.pinSelectorRow}>
            {hazardPins.map((pin, idx) => {
              const active = activeHazard.id === pin.id;
              return (
                <Pressable
                  key={pin.id}
                  onPress={() => setActiveHazardId(pin.id)}
                  style={[
                    styles.pinSwitchBtn,
                    active && styles.pinSwitchBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.pinSwitchBtnText,
                      active && styles.pinSwitchBtnTextActive,
                    ]}
                  >
                    #{idx + 1}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0B0F18',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  topHud: {
    padding: 12,
    gap: 8,
    backgroundColor: '#080B10',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  hudRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  locationText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  weatherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  weatherText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  weatherDivider: {
    fontSize: 11,
    color: '#475569',
  },
  layerControlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  layerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  layerBtnEmerald: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: 'rgba(52, 211, 153, 0.5)',
  },
  layerBtnCyan: {
    backgroundColor: 'rgba(0, 240, 255, 0.15)',
    borderColor: 'rgba(0, 240, 255, 0.5)',
  },
  layerBtnSky: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  layerBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  pinActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#D4FF00',
    marginLeft: 'auto',
  },
  pinActionBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#080B10',
    textTransform: 'uppercase',
  },
  reportDrawer: {
    margin: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#111726',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.45)',
    gap: 8,
  },
  reportDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportDrawerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  reportDrawerTitle: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
    textTransform: 'uppercase',
  },
  closeDrawerText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    fontWeight: '700',
  },
  presetsGrid: {
    gap: 8,
  },
  presetCard: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  presetTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  presetDesc: {
    fontSize: 11,
    color: '#CBD5E1',
    marginTop: 2,
  },
  mapCanvasWrap: {
    width: '100%',
    height: 270,
    backgroundColor: '#080B10',
  },
  bottomBar: {
    padding: 12,
    backgroundColor: '#080B10',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  athleteFocusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111726',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  focusAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
  },
  focusNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  focusName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roleTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  roleTagText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  focusStats: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    marginTop: 2,
  },
  hazardInspectorCard: {
    backgroundColor: '#111726',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 8,
  },
  hazardInspectorMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hazardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hazardHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  hazardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  hazardMeta: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  hazardDesc: {
    fontSize: 11,
    color: '#CBD5E1',
    marginTop: 2,
  },
  pinSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  pinSwitchBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pinSwitchBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  pinSwitchBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
  },
  pinSwitchBtnTextActive: {
    color: '#080B10',
  },
});
