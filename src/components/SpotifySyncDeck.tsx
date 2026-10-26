import React, { useState } from 'react';
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
  Music2,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RefreshCw,
  Code2,
  CheckCircle2,
  Volume2,
  ArrowRight,
  Activity,
  Cpu,
} from './Icons';
import {
  Athlete,
  BroadcastSignalEvent,
  SpotifyTrack,
} from '../data/sessionData';

interface SpotifySyncDeckProps {
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

export default function SpotifySyncDeck({
  tracks,
  currentTrackIndex,
  isPlaying,
  progressSec,
  isVoiceDucked,
  athletes,
  broadcastLogs,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onSeekTrack,
  onForceResyncBroadcast,
  onSelectTrackIndex,
}: SpotifySyncDeckProps) {
  const [showApiTranslator, setShowApiTranslator] = useState(true);
  const [barWidth, setBarWidth] = useState(260);

  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const latestSignal = broadcastLogs[0];

  const pctPlayed = Math.min(
    100,
    Math.max(0, (progressSec / currentTrack.durationSec) * 100)
  );

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <View style={styles.musicIconBox}>
            <Music2 size={16} color="#1DB954" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Text style={styles.spotifyLabel}>
                SPOTIFY PACK SYNC · BROADCAST API
              </Text>
              <View style={styles.bpmBadge}>
                <Text style={styles.bpmBadgeText}>
                  {currentTrack.bpm} BPM LOCKED
                </Text>
              </View>
            </View>
            <Text style={styles.deckTitle}>
              Synchronized Cadence Music Stream
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={onForceResyncBroadcast}
            style={styles.resyncBtn}
          >
            <RefreshCw size={13} color="#1DB954" />
            <Text style={styles.resyncBtnText}>Broadcast Sync</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowApiTranslator((v) => !v)}
            style={[
              styles.translatorToggleBtn,
              showApiTranslator && styles.translatorToggleBtnActive,
            ]}
          >
            <Code2
              size={13}
              color={showApiTranslator ? '#D4FF00' : '#94A3B8'}
            />
            <Text
              style={[
                styles.translatorToggleText,
                showApiTranslator && { color: '#D4FF00' },
              ]}
            >
              API Translator
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Now Playing Card + Controls */}
      <View style={styles.nowPlayingBox}>
        <View style={styles.trackMainRow}>
          <View style={styles.coverWrap}>
            <Image
              source={{ uri: currentTrack.coverUrl }}
              style={styles.coverImg}
            />
            <View style={styles.coverBpmTag}>
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
              {currentTrack.artist} ·{' '}
              <Text style={{ color: '#64748B' }}>{currentTrack.album}</Text>
            </Text>

            {/* Interactive Scrubber Bar */}
            <Pressable
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0) setBarWidth(w);
              }}
              onPress={(e) => {
                const x = e.nativeEvent.locationX;
                if (typeof x === 'number' && barWidth > 0) {
                  const ratio = Math.max(0, Math.min(1, x / barWidth));
                  onSeekTrack(Math.round(ratio * currentTrack.durationSec));
                }
              }}
              style={styles.scrubberOuter}
            >
              <View
                style={[
                  styles.scrubberFill,
                  { width: `${pctPlayed}%` },
                ]}
              />
            </Pressable>

            <View style={styles.scrubberMetaRow}>
              <Text style={styles.scrubberTime}>
                {formatTrackTime(progressSec)}
              </Text>
              <Text style={styles.scrubberUri} numberOfLines={1}>
                {currentTrack.uri}
              </Text>
              <Text style={styles.scrubberTime}>
                {formatTrackTime(currentTrack.durationSec)}
              </Text>
            </View>
          </View>
        </View>

        {/* Playback Controls + Track Queue Selector */}
        <View style={styles.controlsBar}>
          <View style={styles.transportRow}>
            <Pressable onPress={onPrevTrack} style={styles.skipBtn}>
              <SkipBack size={15} color="#FFFFFF" />
            </Pressable>

            <Pressable onPress={onTogglePlay} style={styles.playPauseBtn}>
              {isPlaying ? (
                <>
                  <Pause size={15} color="#080B10" />
                  <Text style={styles.playPauseText}>Pause Pack</Text>
                </>
              ) : (
                <>
                  <Play size={15} color="#080B10" />
                  <Text style={styles.playPauseText}>Sync Play</Text>
                </>
              )}
            </Pressable>

            <Pressable onPress={onNextTrack} style={styles.skipBtn}>
              <SkipForward size={15} color="#FFFFFF" />
            </Pressable>

            <Pressable
              onPress={() =>
                onSeekTrack(
                  Math.min(currentTrack.durationSec - 5, progressSec + 30)
                )
              }
              style={styles.seekJumpBtn}
            >
              <Text style={styles.seekJumpText}>+30s Seek</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bpmPillsRow}
          >
            {tracks.map((t, idx) => {
              const active = idx === currentTrackIndex;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onSelectTrackIndex(idx)}
                  style={[
                    styles.bpmTrackPill,
                    active && styles.bpmTrackPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.bpmTrackPillText,
                      active && styles.bpmTrackPillTextActive,
                    ]}
                  >
                    {t.bpm} BPM · {t.title.split(' ')[0]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Per-User Drift Status Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.driftScroll}
      >
        {athletes.map((ath) => (
          <View key={ath.id} style={styles.driftChip}>
            <View style={styles.driftDot} />
            <Text style={styles.driftName}>
              {ath.isSelf ? 'You' : ath.name.split(' ')[0]}
            </Text>
            <Text style={styles.driftMs}>
              {ath.isSelf ? 'HOST' : `+${ath.spotifyDriftMs}ms`}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* CUSTOM API BROADCAST -> CLIENT SPOTIFY API TRANSLATOR INSPECTOR */}
      {showApiTranslator && latestSignal && (
        <View style={styles.translatorBox}>
          <View style={styles.translatorHeader}>
            <View style={styles.translatorTitleWrap}>
              <Cpu size={13} color="#D4FF00" />
              <Text style={styles.translatorTitle}>
                Custom Broadcast -&gt; Client Spotify API Translator
              </Text>
            </View>
            <View style={styles.peersBadge}>
              <CheckCircle2 size={12} color="#34D399" />
              <Text style={styles.peersBadgeText}>
                {latestSignal.peersTranslated}/5 Peers ({latestSignal.avgDriftMs}
                ms)
              </Text>
            </View>
          </View>

          {/* 3-Step Visual Pipeline */}
          <View style={styles.pipelineGrid}>
            <View style={styles.pipelineCard}>
              <Text style={[styles.pipelineStepTitle, { color: '#D4FF00' }]}>
                1. CUSTOM APP BROADCAST
              </Text>
              <Text style={styles.pipelineEndpoint} numberOfLines={1}>
                {latestSignal.customEndpoint}
              </Text>
              <Text style={styles.pipelineMeta}>
                action:{' '}
                <Text style={{ color: '#FFFFFF' }}>{latestSignal.action}</Text>
              </Text>
              <Text style={styles.pipelineMeta}>
                pos_ms:{' '}
                <Text style={{ color: '#FFFFFF' }}>
                  {latestSignal.customPayload.position_ms}
                </Text>
              </Text>
            </View>

            <View style={styles.pipelineCard}>
              <View style={styles.pipelineStepRow}>
                <Text style={[styles.pipelineStepTitle, { color: '#00F0FF' }]}>
                  2. SUPABASE REALTIME
                </Text>
                <ArrowRight size={12} color="#00F0FF" />
              </View>
              <Text style={styles.pipelineEndpoint}>
                Channel: <Text style={{ color: '#FFFFFF' }}>session:sf-884</Text>
              </Text>
              <Text style={styles.pipelineMeta}>
                Each phone receives broadcast &amp; adds RTT offset (+
                {latestSignal.clientSpotifyBody.device_compensation_ms}ms)
              </Text>
            </View>

            <View
              style={[
                styles.pipelineCard,
                { borderColor: 'rgba(29, 185, 84, 0.45)' },
              ]}
            >
              <Text style={[styles.pipelineStepTitle, { color: '#1DB954' }]}>
                3. PEER SPOTIFY API CALL
              </Text>
              <Text style={styles.pipelineEndpoint} numberOfLines={1}>
                {latestSignal.clientSpotifyEndpoint}
              </Text>
              <Text style={styles.pipelineMeta} numberOfLines={1}>
                uri:{' '}
                <Text style={{ color: '#FFFFFF' }}>
                  {latestSignal.clientSpotifyBody.uris[0]}
                </Text>
              </Text>
              <Text style={styles.pipelineMeta}>
                seek_ms:{' '}
                <Text style={{ color: '#1DB954', fontWeight: '700' }}>
                  {latestSignal.clientSpotifyBody.position_ms}
                </Text>
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Footer status */}
      <View style={styles.footerRow}>
        <View style={styles.footerItem}>
          <Activity size={13} color="#1DB954" />
          <Text style={styles.footerText}>
            Spotify OAuth Tokens via Supabase `users` table
          </Text>
        </View>
        <Text style={styles.footerText}>
          Last: {latestSignal?.timestamp}
        </Text>
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
    backgroundColor: 'rgba(29, 185, 84, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.35)',
  },
  bpmBadgeText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#1DB954',
  },
  deckTitle: {
    fontSize: 15,
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
  nowPlayingBox: {
    backgroundColor: '#080B10',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 12,
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
    width: 62,
    height: 62,
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
  bpmTrackPillActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
    borderColor: '#1DB954',
  },
  bpmTrackPillText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  bpmTrackPillTextActive: {
    color: '#1DB954',
    fontWeight: '700',
  },
  driftScroll: {
    gap: 6,
  },
  driftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  driftDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },
  driftName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  driftMs: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#1DB954',
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
  },
  pipelineStepTitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  pipelineEndpoint: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  pipelineMeta: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
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
