import React from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
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
} from './Icons';
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
  {
    bgHex: string;
    borderHex: string;
    textHex: string;
    hex: string;
    label: string;
  }
> = {
  optimal: {
    bgHex: 'rgba(16, 185, 129, 0.18)',
    borderHex: 'rgba(52, 211, 153, 0.5)',
    textHex: '#6EE7B7',
    hex: '#10B981',
    label: 'Optimal Surface',
  },
  caution: {
    bgHex: 'rgba(245, 158, 11, 0.18)',
    borderHex: 'rgba(251, 191, 36, 0.5)',
    textHex: '#FCD34D',
    hex: '#F59E0B',
    label: 'Caution / Wind',
  },
  hazard: {
    bgHex: 'rgba(239, 68, 68, 0.22)',
    borderHex: 'rgba(248, 113, 113, 0.6)',
    textHex: '#FCA5A5',
    hex: '#EF4444',
    label: 'Steep / Hazard',
  },
};

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

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
      if (Math.abs(ath.progress - prev.progress) < 6.5) {
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

  const condStyle = CONDITION_COLORS[currentSegment.condition];

  return (
    <View style={styles.card}>
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <View style={styles.navIconBox}>
            <Navigation size={16} color="#D4FF00" />
            <View style={styles.liveDot} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>
                  LIVE ACTIVITY · PACK LINE
                </Text>
              </View>
              <Text style={styles.gpsLockText}>
                {athletes.length} IN PACK · 5Hz GPS
              </Text>
            </View>
            <Text style={styles.routeTitle} numberOfLines={1}>
              {route.title}
            </Text>
          </View>
        </View>

        {/* Road Condition Pill + Effort Throttle + iOS Lock Screen Preview Toggle */}
        <View style={styles.controlsWrap}>
          <View
            style={[
              styles.conditionPill,
              {
                backgroundColor: condStyle.bgHex,
                borderColor: condStyle.borderHex,
              },
            ]}
          >
            {currentSegment.condition === 'optimal' ? (
              <CheckCircle2 size={13} color={condStyle.textHex} />
            ) : (
              <AlertTriangle size={13} color={condStyle.textHex} />
            )}
            <Text
              style={[styles.conditionPillText, { color: condStyle.textHex }]}
              numberOfLines={1}
            >
              ROAD: {currentSegment.conditionLabel}
            </Text>
          </View>

          <View style={styles.effortGroup}>
            {(['recovery', 'tempo', 'surge'] as const).map((lvl) => {
              const active = effortLevel === lvl;
              const isSurge = lvl === 'surge';
              return (
                <Pressable
                  key={lvl}
                  onPress={() => onChangeEffort(lvl)}
                  style={[
                    styles.effortBtn,
                    active &&
                      (isSurge ? styles.effortBtnSurge : styles.effortBtnActive),
                  ]}
                >
                  <Text
                    style={[
                      styles.effortBtnText,
                      active &&
                        (isSurge
                          ? styles.effortBtnTextSurge
                          : styles.effortBtnTextActive),
                    ]}
                  >
                    {lvl === 'recovery'
                      ? 'Easy'
                      : lvl === 'tempo'
                      ? 'Tempo'
                      : 'Surge +25%'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onToggleIosWidgetPreview}
            style={[
              styles.iosBtn,
              showIosWidgetPreview && styles.iosBtnActive,
            ]}
          >
            <Smartphone
              size={13}
              color={showIosWidgetPreview ? '#00F0FF' : '#CBD5E1'}
            />
            <Text
              style={[
                styles.iosBtnText,
                showIosWidgetPreview && { color: '#00F0FF' },
              ]}
            >
              iOS Lock Screen
            </Text>
          </Pressable>
        </View>
      </View>

      {/* THE LINEAR PROGRESS TRACK WITH PFP AVATARS & GOOGLE MAPS ROAD CONDITIONS */}
      <View style={styles.trackBox}>
        {/* Distance Scale Header */}
        <View style={styles.scaleHeader}>
          <View style={styles.scaleItem}>
            <View
              style={[styles.scaleDot, { backgroundColor: '#10B981' }]}
            />
            <Text style={styles.scaleText}>START · 0.0 MI</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendSwatch, { backgroundColor: '#10B981' }]}
              />
              <Text style={styles.legendText}>Clear</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendSwatch, { backgroundColor: '#F59E0B' }]}
              />
              <Text style={styles.legendText}>Caution</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendSwatch, { backgroundColor: '#EF4444' }]}
              />
              <Text style={styles.legendText}>Steep/Hazard</Text>
            </View>
          </View>
          <View style={styles.scaleItem}>
            <Flag size={11} color="#D4FF00" />
            <Text style={[styles.scaleText, { color: '#D4FF00' }]}>
              FINISH · {route.totalDistanceMiles.toFixed(1)} MI
            </Text>
          </View>
        </View>

        {/* Linear Track Container */}
        <View style={styles.linearBarOuter}>
          {/* Road Condition Segments */}
          <View style={styles.segmentsLayer}>
            {route.segments.map((seg) => {
              const widthPct = seg.endPct - seg.startPct;
              const colorHex = CONDITION_COLORS[seg.condition].hex;
              return (
                <View
                  key={seg.id}
                  style={{
                    width: `${widthPct}%`,
                    height: '100%',
                    backgroundColor: colorHex,
                    opacity: 0.38,
                    borderRightWidth: 1,
                    borderRightColor: 'rgba(0,0,0,0.5)',
                  }}
                />
              );
            })}
          </View>

          {/* Active Progress Fill for YOU (Volt High-Contrast Line) */}
          <View
            style={[
              styles.selfProgressFill,
              {
                width: `${Math.min(100, Math.max(0, selfAthlete.progress))}%`,
              },
            ]}
          />

          {/* Checkpoint Tick Marks */}
          {route.checkpoints.map((cp) => (
            <View
              key={cp.label}
              style={[styles.checkpointTickWrap, { left: `${cp.pct}%` }]}
            >
              <View style={styles.checkpointTick} />
            </View>
          ))}

          {/* Hazard Pins on the linear track */}
          {hazardPins.map((pin) => {
            const pinColor = CONDITION_COLORS[pin.type].hex;
            return (
              <View
                key={pin.id}
                style={[
                  styles.hazardPinMarker,
                  {
                    left: `${pin.progressPct}%`,
                    borderColor: pinColor,
                  },
                ]}
              >
                <View
                  style={[styles.hazardPinInner, { backgroundColor: pinColor }]}
                />
              </View>
            );
          })}

          {/* EVERYONE'S PFP AVATARS POSITIONED LIVE ON THE LINE */}
          {athletes.map((athlete) => {
            const rankIndex =
              rankedAthletes.findIndex((r) => r.id === athlete.id) + 1;
            const isSelected = athlete.id === selectedAthleteId;
            const isSpeaking = athlete.id === activeSpeakerId;
            const staggerTier = tierByAthleteId[athlete.id] || 0;
            const topOffset = staggerTier === 1 ? -58 : -46;
            const stemHeight = staggerTier === 1 ? 18 : 8;
            const ringColor = isSpeaking ? '#FF4D2A' : athlete.color;

            return (
              <Pressable
                key={athlete.id}
                onPress={() => onSelectAthlete(athlete.id)}
                style={[
                  styles.pfpMarkerWrap,
                  {
                    left: `${Math.min(96, Math.max(4, athlete.progress))}%`,
                    top: topOffset,
                    zIndex: isSpeaking
                      ? 40
                      : athlete.isSelf
                      ? 35
                      : isSelected
                      ? 30
                      : 20,
                  },
                ]}
              >
                {isSpeaking && (
                  <View style={styles.pttVoiceTag}>
                    <Text style={styles.pttVoiceTagText}>PTT</Text>
                  </View>
                )}

                <View style={styles.avatarContainer}>
                  <Image
                    source={{ uri: athlete.avatar }}
                    style={[
                      styles.pfpAvatar,
                      {
                        borderColor: ringColor,
                        transform: [
                          {
                            scale: isSelected || athlete.isSelf ? 1.08 : 1,
                          },
                        ],
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.rankMiniBadge,
                      {
                        backgroundColor: isSpeaking
                          ? '#FF4D2A'
                          : athlete.isSelf
                          ? '#D4FF00'
                          : '#0E131D',
                        borderColor: ringColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rankMiniBadgeText,
                        {
                          color:
                            athlete.isSelf && !isSpeaking
                              ? '#080B10'
                              : '#FFFFFF',
                        },
                      ]}
                    >
                      {athlete.isSelf ? 'YOU' : `#${rankIndex}`}
                    </Text>
                  </View>
                </View>

                {/* Stem line connecting PFP to exact spot on the linear bar */}
                <View
                  style={{
                    width: 2,
                    height: stemHeight,
                    backgroundColor: ringColor,
                  }}
                />

                {/* Node dot on linear track */}
                <View
                  style={[
                    styles.trackNodeDot,
                    { backgroundColor: ringColor },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Bottom Telemetry Strip: Scrollable PFP Roster Chips + Selected Athlete Summary */}
      <View style={styles.bottomSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rosterScroll}
        >
          {rankedAthletes.map((ath, idx) => {
            const isSelected = ath.id === selectedAthleteId;
            const isSpeaking = ath.id === activeSpeakerId;
            const distMi = (
              (ath.progress / 100) *
              route.totalDistanceMiles
            ).toFixed(2);
            return (
              <Pressable
                key={ath.id}
                onPress={() => onSelectAthlete(ath.id)}
                style={[
                  styles.rosterChip,
                  isSelected && styles.rosterChipSelected,
                ]}
              >
                <Image
                  source={{ uri: ath.avatar }}
                  style={[
                    styles.rosterChipAvatar,
                    { borderColor: isSpeaking ? '#FF4D2A' : ath.color },
                  ]}
                />
                <View>
                  <View style={styles.rosterNameRow}>
                    <Text style={styles.rosterName}>
                      {ath.isSelf ? 'You (Alex)' : ath.name.split(' ')[0]}
                    </Text>
                    <Text
                      style={[styles.rosterPct, { color: ath.color }]}
                    >
                      {ath.progress.toFixed(1)}%
                    </Text>
                  </View>
                  <Text style={styles.rosterMeta}>
                    #{idx + 1} · {ath.speedMph.toFixed(1)} mph · {distMi} mi
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Selected Athlete Speed, ETA & Gap Summary */}
        <View style={styles.summaryBar}>
          <View style={styles.summaryItem}>
            <Gauge size={15} color="#D4FF00" />
            <View>
              <Text style={styles.summaryLabel}>
                {selectedAthlete.isSelf
                  ? 'YOUR SPEED'
                  : `${selectedAthlete.name.split(' ')[0].toUpperCase()} SPEED`}
              </Text>
              <Text style={styles.summaryValue}>
                {selectedAthlete.speedMph.toFixed(1)} MPH{' '}
                <Text style={styles.summaryMuted}>
                  ({selectedAthlete.progress.toFixed(1)}%)
                </Text>
              </Text>
            </View>
          </View>

          <View style={styles.summaryItem}>
            <Clock size={15} color="#00F0FF" />
            <View>
              <Text style={styles.summaryLabel}>EXPECTED ETA</Text>
              <Text style={[styles.summaryValue, { color: '#00F0FF' }]}>
                {etaFormatted}{' '}
                <Text style={styles.summaryMuted}>({arrivalClock})</Text>
              </Text>
            </View>
          </View>

          {!selectedAthlete.isSelf && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.summaryLabel}>GAP TO YOU</Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: deltaMeters >= 0 ? '#FCD34D' : '#6EE7B7' },
                ]}
              >
                {deltaMeters >= 0
                  ? `+${deltaMeters}m ahead`
                  : `${deltaMeters}m behind`}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* OPTIONAL iOS 18 LOCK SCREEN LIVE ACTIVITY & DYNAMIC ISLAND WIDGET OVERLAY */}
      {showIosWidgetPreview && (
        <View style={styles.iosPreviewContainer}>
          <View style={styles.iosPreviewHeader}>
            <View style={styles.iosPreviewTitleRow}>
              <View style={styles.iosPulseDot} />
              <Text style={styles.iosPreviewBadgeText}>
                iOS 18 Live Activity · Lock Screen Widget (Expo ActivityKit)
              </Text>
            </View>
            <Text style={styles.iosUpdatedText}>Updated Live</Text>
          </View>

          <View style={styles.iosWidgetCard}>
            <View style={styles.iosWidgetTopRow}>
              <View style={styles.iosWidgetBrand}>
                <Sparkles size={13} color="#D4FF00" />
                <Text style={styles.iosWidgetTitle}>
                  {route.mode === 'run'
                    ? 'Pack Run · Crissy Field'
                    : 'Peloton Ride · Marin Loop'}
                </Text>
              </View>
              <Text style={styles.iosWidgetEta}>
                ETA {etaFormatted} · {selfAthlete.speedMph.toFixed(1)} mph
              </Text>
            </View>

            {/* Mini Linear Progress with PFPs on Lock Screen */}
            <View style={styles.iosMiniBar}>
              <View style={styles.segmentsLayer}>
                {route.segments.map((seg) => (
                  <View
                    key={seg.id}
                    style={{
                      width: `${seg.endPct - seg.startPct}%`,
                      height: '100%',
                      backgroundColor: CONDITION_COLORS[seg.condition].hex,
                      opacity: 0.5,
                    }}
                  />
                ))}
              </View>
              <View
                style={[
                  styles.iosMiniFill,
                  { width: `${selfAthlete.progress}%` },
                ]}
              />
              {athletes.map((ath) => (
                <Image
                  key={ath.id}
                  source={{ uri: ath.avatar }}
                  style={[
                    styles.iosMiniAvatar,
                    {
                      left: `${Math.min(96, Math.max(4, ath.progress))}%`,
                      borderColor: ath.color,
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.iosWidgetBottomRow}>
              <View style={styles.iosBottomItem}>
                <Wind size={12} color="#F59E0B" />
                <Text style={styles.iosBottomText} numberOfLines={1}>
                  {currentSegment.conditionLabel}
                </Text>
              </View>
              <View style={styles.iosBottomItem}>
                <Radio size={12} color="#FF4D2A" />
                <Text style={[styles.iosBottomText, { color: '#FF4D2A' }]}>
                  LiveKit PTT Ready
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
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
  },
  headerRow: {
    gap: 10,
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(212, 255, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#D4FF00',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  liveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(212, 255, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.3)',
  },
  liveBadgeText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
    letterSpacing: 0.6,
  },
  gpsLockText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  routeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  controlsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  conditionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  conditionPillText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
  },
  effortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#080B10',
    padding: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  effortBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  effortBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  effortBtnSurge: {
    backgroundColor: '#D4FF00',
  },
  effortBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  effortBtnTextActive: {
    color: '#FFFFFF',
  },
  effortBtnTextSurge: {
    color: '#080B10',
  },
  iosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  iosBtnActive: {
    backgroundColor: 'rgba(0, 240, 255, 0.16)',
    borderColor: 'rgba(0, 240, 255, 0.55)',
  },
  iosBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#CBD5E1',
    textTransform: 'uppercase',
  },
  trackBox: {
    backgroundColor: '#080B10',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 14,
  },
  scaleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 56,
  },
  scaleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  scaleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  scaleText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 8,
    height: 5,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  linearBarOuter: {
    position: 'relative',
    height: 14,
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'visible',
  },
  segmentsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  selfProgressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#D4FF00',
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
    opacity: 0.85,
  },
  checkpointTickWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  checkpointTick: {
    width: 2,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  hazardPinMarker: {
    position: 'absolute',
    bottom: -16,
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    backgroundColor: '#080B10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hazardPinInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  pfpMarkerWrap: {
    position: 'absolute',
    marginLeft: -18,
    alignItems: 'center',
  },
  pttVoiceTag: {
    position: 'absolute',
    top: -15,
    backgroundColor: '#FF4D2A',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pttVoiceTagText: {
    fontSize: 8,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  avatarContainer: {
    position: 'relative',
  },
  pfpAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    backgroundColor: '#1E293B',
  },
  rankMiniBadge: {
    position: 'absolute',
    bottom: -3,
    right: -4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  rankMiniBadgeText: {
    fontSize: 8,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  trackNodeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#080B10',
  },
  bottomSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  rosterScroll: {
    gap: 8,
    paddingRight: 4,
  },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rosterChipSelected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  rosterChipAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
  },
  rosterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rosterName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  rosterPct: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
  },
  rosterMeta: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    marginTop: 1,
  },
  summaryBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#080B10',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  summaryLabel: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 12,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryMuted: {
    fontWeight: '400',
    color: '#94A3B8',
  },
  iosPreviewContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#131824',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  iosPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iosPreviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iosPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#D4FF00',
  },
  iosPreviewBadgeText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
  },
  iosUpdatedText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  iosWidgetCard: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  iosWidgetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  iosWidgetBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iosWidgetTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  iosWidgetEta: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#00F0FF',
  },
  iosMiniBar: {
    position: 'relative',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#1E293B',
    marginVertical: 14,
  },
  iosMiniFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#D4FF00',
  },
  iosMiniAvatar: {
    position: 'absolute',
    top: -7,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
  iosWidgetBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  iosBottomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iosBottomText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
});
