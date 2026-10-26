import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
import {
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
  Waves,
  Sparkles,
  Send,
  ShieldCheck,
  Users,
} from './Icons';
import { Athlete, VoiceTransmission } from '../data/sessionData';

interface WalkieTalkiePTTDeckProps {
  isPttActive: boolean;
  isLatched: boolean;
  onStartPtt: () => void;
  onStopPtt: () => void;
  onToggleLatch: () => void;
  activeSpeakerId: string | null;
  athletes: Athlete[];
  voiceFeed: VoiceTransmission[];
  onSendQuickCallout: (text: string) => void;
  onTriggerTeammateCallout: () => void;
  soundEffectsEnabled: boolean;
  onToggleSoundEffects: () => void;
}

const QUICK_VOICE_CALLOUTS = [
  'Pushing pace +0.5 mph for the next half mile — lock in!',
  'Caution ahead: wet patch on the right shoulder, stay left!',
  'Single file on the climb — car passing on the left!',
  'How is everyone feeling on this 170 BPM Spotify sync?',
];

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export default function WalkieTalkiePTTDeck({
  isPttActive,
  isLatched,
  onStartPtt,
  onStopPtt,
  onToggleLatch,
  activeSpeakerId,
  athletes,
  voiceFeed,
  onSendQuickCallout,
  onTriggerTeammateCallout,
  soundEffectsEnabled,
  onToggleSoundEffects,
}: WalkieTalkiePTTDeckProps) {
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

  const activeSpeaker = athletes.find((a) => a.id === activeSpeakerId) || null;
  const isChannelOpen = Boolean(activeSpeakerId);

  return (
    <View
      style={[
        styles.card,
        isChannelOpen && styles.cardChannelOpen,
      ]}
    >
      {/* Header: LiveKit Cloud Call-to-Call Mesh Status */}
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <View
            style={[
              styles.radioIconBox,
              isChannelOpen && styles.radioIconBoxActive,
            ]}
          >
            <Radio
              size={16}
              color={isChannelOpen ? '#FFFFFF' : '#FF4D2A'}
            />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Text style={styles.livekitLabel}>
                WALKIE-TALKIE · LIVEKIT CLOUD
              </Text>
              <View style={styles.meshBadge}>
                <Text style={styles.meshBadgeText}>5/5 WEBRTC MESH</Text>
              </View>
            </View>
            <Text style={styles.deckTitle}>
              Call-to-Call Pack Voice Channel
            </Text>
          </View>
        </View>

        <View style={styles.headerControls}>
          <Pressable
            onPress={onToggleSoundEffects}
            style={[
              styles.soundBtn,
              soundEffectsEnabled && styles.soundBtnActive,
            ]}
          >
            {soundEffectsEnabled ? (
              <Volume2 size={15} color="#D4FF00" />
            ) : (
              <VolumeX size={15} color="#64748B" />
            )}
          </Pressable>

          <Pressable
            onPress={onTriggerTeammateCallout}
            style={styles.demoPeerBtn}
          >
            <Sparkles size={13} color="#00F0FF" />
            <Text style={styles.demoPeerBtnText}>Demo Peer Call</Text>
          </Pressable>
        </View>
      </View>

      {/* Live Channel Status Banner + Audio Waveform Visualizer */}
      <View style={styles.visualizerBox}>
        <View style={styles.statusHeaderRow}>
          <View style={styles.statusIndicatorRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isChannelOpen ? '#FF4D2A' : '#10B981',
                },
              ]}
            />
            <Text style={styles.statusText} numberOfLines={1}>
              {isPttActive
                ? 'TRANSMITTING TO ALL 5 PHONES...'
                : activeSpeaker
                ? `RECEIVING: ${activeSpeaker.name.toUpperCase()}`
                : 'CHANNEL STANDBY · READY TO TALK'}
            </Text>
          </View>
          <Text style={styles.codecText}>
            {isChannelOpen ? 'SPOTIFY AUTO-DUCKED 25%' : 'OPUS 48KHZ · 18MS'}
          </Text>
        </View>

        {/* 20-Bar Real-Time Voice Spectrum Visualizer */}
        <View style={styles.spectrumRow}>
          {Array.from({ length: 20 }).map((_, idx) => {
            const activeHeight = isChannelOpen
              ? 28 + ((idx * 17) % 70)
              : 16 + ((idx * 7) % 14);
            return (
              <View
                key={idx}
                style={[
                  styles.spectrumBar,
                  {
                    height: `${activeHeight}%`,
                    backgroundColor: isPttActive
                      ? '#FF4D2A'
                      : activeSpeaker
                      ? '#00F0FF'
                      : '#334155',
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* TACTILE HARDWARE PUSH-TO-TALK (PTT) PADDLE BUTTON + HANDS-FREE LATCH */}
      <View style={styles.pttRow}>
        <Pressable
          onPressIn={onStartPtt}
          onPressOut={() => {
            if (!isLatched) onStopPtt();
          }}
          style={[
            styles.pttPaddleBtn,
            isPttActive && styles.pttPaddleBtnActive,
          ]}
        >
          {isPttActive ? (
            <>
              <Waves size={20} color="#FFFFFF" />
              <Text style={styles.pttPaddleText}>
                VOICE OPEN · RELEASE TO END
              </Text>
            </>
          ) : (
            <>
              <Mic size={20} color="#FFFFFF" />
              <Text style={styles.pttPaddleText}>
                HOLD TO TALK TO PACK
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={onToggleLatch}
          style={[
            styles.latchBtn,
            isLatched && styles.latchBtnActive,
          ]}
        >
          {isLatched ? (
            <Mic size={16} color="#080B10" />
          ) : (
            <MicOff size={16} color="#94A3B8" />
          )}
          <Text
            style={[
              styles.latchBtnText,
              isLatched && styles.latchBtnTextActive,
            ]}
          >
            {isLatched ? 'LATCHED' : 'HANDS-FREE'}
          </Text>
        </Pressable>
      </View>

      {/* Quick 1-Tap Voice Callout Preset Bar */}
      <View style={styles.presetSection}>
        <View style={styles.presetHeaderRow}>
          <Text style={styles.presetLabel}>
            QUICK VOICE CALLOUT PRESETS:
          </Text>
          <Text style={styles.presetApiLabel}>LIVEKIT API CHANNEL</Text>
        </View>

        <View style={styles.presetChipsWrap}>
          {QUICK_VOICE_CALLOUTS.map((msg, i) => {
            const selected = i === selectedPresetIdx;
            return (
              <Pressable
                key={i}
                onPress={() => setSelectedPresetIdx(i)}
                style={[
                  styles.presetChip,
                  selected && styles.presetChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    selected && styles.presetChipTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  "{msg}"
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() =>
            onSendQuickCallout(QUICK_VOICE_CALLOUTS[selectedPresetIdx])
          }
          style={styles.transmitBtn}
        >
          <Send size={14} color="#FF4D2A" />
          <Text style={styles.transmitBtnText}>
            Transmit Selected Callout to Pack
          </Text>
        </Pressable>
      </View>

      {/* Recent Pack Voice Callouts Feed */}
      <View style={styles.feedList}>
        {voiceFeed.slice(0, 4).map((vc) => (
          <View key={vc.id} style={styles.feedItem}>
            <Image
              source={{ uri: vc.speakerAvatar }}
              style={[
                styles.feedAvatar,
                { borderColor: vc.speakerColor },
              ]}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.feedHeaderRow}>
                <Text
                  style={[styles.feedSpeaker, { color: vc.speakerColor }]}
                  numberOfLines={1}
                >
                  {vc.speakerName}
                </Text>
                <Text style={styles.feedTimestamp}>
                  @{vc.progressAtCallPct.toFixed(0)}% · {vc.timestamp}
                </Text>
              </View>
              <Text style={styles.feedTranscript}>"{vc.transcript}"</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Footer LiveKit Cloud API Pill */}
      <View style={styles.footerRow}>
        <View style={styles.footerItem}>
          <ShieldCheck size={13} color="#10B981" />
          <Text style={styles.footerText}>
            LiveKit Cloud SF-West · Call-to-Call Active
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Users size={13} color="#00F0FF" />
          <Text style={[styles.footerText, { color: '#CBD5E1' }]}>
            5 Phones
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
  cardChannelOpen: {
    backgroundColor: '#191014',
    borderColor: 'rgba(255, 77, 42, 0.7)',
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
  radioIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 77, 42, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 42, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioIconBoxActive: {
    backgroundColor: '#FF4D2A',
    borderColor: '#FF4D2A',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  livekitLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#FF4D2A',
    letterSpacing: 0.5,
  },
  meshBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  meshBadgeText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#6EE7B7',
  },
  deckTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  soundBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  demoPeerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  demoPeerBtnText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  visualizerBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 10,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  statusIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  codecText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  spectrumRow: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  spectrumBar: {
    flex: 1,
    borderRadius: 999,
  },
  pttRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  pttPaddleBtn: {
    flex: 3,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#FF4D2A',
    borderWidth: 2,
    borderColor: 'rgba(255, 107, 42, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pttPaddleBtnActive: {
    backgroundColor: '#FF3311',
    borderColor: '#FFFFFF',
    transform: [{ scale: 0.99 }],
  },
  pttPaddleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  latchBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  latchBtnActive: {
    backgroundColor: '#D4FF00',
    borderColor: '#D4FF00',
  },
  latchBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  latchBtnTextActive: {
    color: '#080B10',
  },
  presetSection: {
    gap: 6,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  presetLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  presetApiLabel: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
  },
  presetChipsWrap: {
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetChipSelected: {
    borderColor: '#D4FF00',
    backgroundColor: 'rgba(212, 255, 0, 0.09)',
  },
  presetChipText: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  presetChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  transmitBtn: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  transmitBtnText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  feedList: {
    gap: 8,
  },
  feedItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  feedAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    marginTop: 2,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  feedSpeaker: {
    fontSize: 12,
    fontWeight: '700',
  },
  feedTimestamp: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  feedTranscript: {
    fontSize: 12,
    color: '#E2E8F0',
    marginTop: 2,
    lineHeight: 17,
  },
  footerRow: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  footerText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
});
