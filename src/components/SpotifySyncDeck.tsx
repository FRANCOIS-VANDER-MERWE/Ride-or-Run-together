// src/components/SpotifySyncDeck.tsx
// Music tab: link an Apple Music account, search, and play.
//
// SPOTIFY REMOVED (Nov 9, 2026, Tillman's call, time constraints):
// Apple Music is the only provider in the app for now. The Spotify
// provider (src/music/providers/SpotifyProvider.ts) is still in the
// repo but nothing imports it; the full Spotify integration,
// including the App Remote spike, lives on the app-remote-spike
// branch. To revive Spotify, restore the provider switcher and the
// PKCE sign-in block from git history (last present in d1c4ee5).
//
// This component is intentionally just a player UI. It talks to the two
// MusicProvider implementations in src/music/providers and renders their
// real state. It used to route through a 1,200-line "sync coordinator"
// with simulated members, fake timestamps, and a Web Audio synthesizer;
// all of that was removed (Nov 2, 2026) because none of it produced real
// playback on a phone. Group sync, when it is built, belongs behind the
// same provider interface, not inside this component.
//
// What the labels mean (also shown in the UI):
// - Apple Music search is the live catalog on every platform; on native
//   the in-app player plays the official 30s preview. Full Apple playback
//   works on web through MusicKit when a developer token is configured.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Platform,
  TextInput,
} from 'react-native';

import {
  AlertTriangle,
  CheckCircle2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
} from './Icons';
import {
  ActivityMode,
  Athlete,
  BroadcastSignalEvent,
  SpotifyTrack,
} from '../data/sessionData';
import { audioEngine } from '../music/audioEngine';
import { appleMusicProvider } from '../music/providers/AppleMusicProvider';
import {
  AuthState,
  CanonicalTrack,
  PlaybackKind,
  PlaybackSnapshot,
  ProviderError,
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

function formatTime(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const KIND_LABELS: Record<PlaybackKind, string> = {
  remote: 'Full track · playing on your Spotify device',
  preview: 'Preview · 30s, playing in this app',
  musickit: 'Full track · Apple Music (web)',
};

const PROVIDER_COLORS: Record<ProviderId, string> = {
  spotify: '#1DB954',
  apple: '#FA243C',
};

export default function SpotifySyncDeck(props: SpotifySyncDeckProps) {
  const { isVoiceDucked, isPlaying: appIsPlaying, onTogglePlay } = props;

  // Apple Music only (Nov 9, 2026). providerId stays as a constant so
  // the render code below keeps its shape for an easy Spotify revival.
  const providerId: ProviderId = 'apple';
  const provider = appleMusicProvider;
  const accent = PROVIDER_COLORS[providerId];

  const [appleAuth, setAppleAuth] = useState<AuthState | null>(null);
  const activeAuth = appleAuth;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CanonicalTrack[]>([]);
  const [searching, setSearching] = useState(false);

  const [current, setCurrent] = useState<CanonicalTrack | null>(null);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barWidth, setBarWidth] = useState(260);

  // --- initial auth state ---
  useEffect(() => {
    appleMusicProvider.getAuthState().then(setAppleAuth).catch(() => {});
  }, []);

  // --- keep the rest of the app informed of real play state ---
  const lastReportedPlaying = useRef<boolean | null>(null);
  useEffect(() => {
    const playing = snapshot?.isPlaying ?? null;
    if (playing === null || !current) return;
    if (lastReportedPlaying.current === playing) return;
    lastReportedPlaying.current = playing;
    if (playing !== appIsPlaying) {
      onTogglePlay();
    }
  }, [snapshot?.isPlaying, current, appIsPlaying, onTogglePlay]);

  // --- voice ducking affects the in-app preview player ---
  useEffect(() => {
    audioEngine.setVolume(isVoiceDucked ? 0.25 : 1);
  }, [isVoiceDucked]);

  // --- snapshot polling for the active provider while something is loaded ---
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await provider.getSnapshot();
        if (!cancelled) setSnapshot(snap);
      } catch {
        // A failed poll is not fatal; the next one retries.
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [current, provider]);

  // --- auto-advance within the current result list ---
  useEffect(() => {
    const unsub = provider.onTrackEnded(() => {
      if (currentResultIndex >= 0 && currentResultIndex < results.length - 1) {
        void playTrack(results[currentResultIndex + 1], currentResultIndex + 1);
      }
    });
    return unsub;
    // playTrack is stable enough for this subscription's lifetime per provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, results, currentResultIndex]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const found = await provider.search(q, 15);
      setResults(found);
      if (found.length === 0) {
        setError('No songs found for that search.');
      }
    } catch (err) {
      setResults([]);
      setError(
        err instanceof ProviderError || err instanceof Error
          ? err.message
          : 'Search failed.'
      );
    } finally {
      setSearching(false);
    }
  };

  const playTrack = async (track: CanonicalTrack, index: number) => {
    setBusy(true);
    setError(null);
    try {
      await provider.playTrack(track, 0);
      setCurrent(track);
      setCurrentResultIndex(index);
      const snap = await provider.getSnapshot();
      setSnapshot(snap);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'That track could not be played.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    if (!current) return;
    try {
      if (snapshot?.isPlaying) {
        await provider.pause();
      } else {
        await provider.resume();
      }
      setSnapshot(await provider.getSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playback control failed.');
    }
  };

  const handleSkip = async (delta: number) => {
    const next = currentResultIndex + delta;
    if (next < 0 || next >= results.length) return;
    await playTrack(results[next], next);
    if (delta > 0) props.onNextTrack();
    else props.onPrevTrack();
  };

  const handleConnect = async () => {
    setError(null);
    try {
      const state = await appleMusicProvider.connect();
      setAppleAuth(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apple Music connect failed.');
    }
  };

  const handleDisconnect = async () => {
    try {
      await provider.disconnect();
      const state = await provider.getAuthState();
      setAppleAuth(state);
      if (current && snapshot?.trackKey) {
        setCurrent(null);
        setSnapshot(null);
      }
    } catch {
      // Disconnect is best-effort; local state was already cleared.
    }
  };

  const positionMs = snapshot?.positionMs ?? 0;
  const durationMs =
    snapshot?.durationMs ?? current?.durationMs ?? 0;
  const progressRatio =
    durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View style={styles.root}>
      {/* header + provider switch */}
      <View style={styles.headerRow}>
        <Music2 size={16} color={accent} />
        <Text style={[styles.headerLabel, { color: accent }]}>
          MUSIC · APPLE MUSIC
        </Text>
      </View>
      {/* connection card */}
      <View style={styles.card}>
        {activeAuth?.isConnected ? (
          <>
            <View style={styles.connectRow}>
              <CheckCircle2 size={16} color='#34D399' />
              <Text style={styles.connectTitle}>
                {activeAuth.userDisplayName ?? 'Connected'}
              </Text>
            </View>
            <Pressable onPress={handleDisconnect} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>Disconnect</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={handleConnect}
            style={[styles.connectBtn, { backgroundColor: accent }]}
          >
            <Text style={styles.connectBtnText}>
              {appleMusicProvider.canUseMusicKit()
                ? 'Connect Apple Music account'
                : 'Use Apple Music catalog'}
            </Text>
          </Pressable>
        )}
        <Text style={styles.noteText}>{provider.capabilities.playbackNote}</Text>
      </View>

      {/* search */}
      <View style={styles.card}>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            placeholder={
              'Search Apple Music (song or artist)...'
            }
            placeholderTextColor='#6B7280'
            style={styles.searchInput}
            returnKeyType='search'
          />
          <Pressable
            onPress={handleSearch}
            style={[styles.searchBtn, { backgroundColor: accent }]}
          >
            <Text style={styles.searchBtnText}>
              {searching ? '...' : 'Search'}
            </Text>
          </Pressable>
        </View>
        {error && (
          <View style={styles.errorRow}>
            <AlertTriangle size={14} color='#FBBF24' />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {results.map((item, index) => {
          const key =
            item.providerIds[providerId] ?? `${item.title}-${index}`;
          const isCurrent =
            current?.providerIds[providerId] !== undefined &&
            current.providerIds[providerId] === item.providerIds[providerId];
          return (
            <Pressable
              key={key}
              onPress={() => playTrack(item, index)}
              style={[styles.resultRow, isCurrent && styles.resultRowActive]}
            >
              {item.artworkUrl ? (
                <Image source={{ uri: item.artworkUrl }} style={styles.artwork} />
              ) : (
                <View style={[styles.artwork, styles.artworkPlaceholder]}>
                  <Music2 size={16} color='#9CA3AF' />
                </View>
              )}
              <View style={styles.resultMeta}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                  {item.explicit ? '  (E)' : ''}
                </Text>
                <Text style={styles.resultArtist} numberOfLines={1}>
                  {item.artist} · {formatTime(item.durationMs)}
                </Text>
              </View>
              {isCurrent && snapshot?.isPlaying ? (
                <Pause size={18} color={accent} />
              ) : (
                <Play size={18} color={isCurrent ? accent : '#9CA3AF'} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* now playing */}
      {current && (
        <View style={styles.card}>
          <View style={styles.nowRow}>
            {current.artworkUrl ? (
              <Image
                source={{ uri: current.artworkUrl }}
                style={styles.nowArtwork}
              />
            ) : (
              <View style={[styles.nowArtwork, styles.artworkPlaceholder]}>
                <Music2 size={20} color='#9CA3AF' />
              </View>
            )}
            <View style={styles.resultMeta}>
              <Text style={styles.nowTitle} numberOfLines={1}>
                {current.title}
              </Text>
              <Text style={styles.resultArtist} numberOfLines={1}>
                {current.artist}
              </Text>
              <Text style={styles.kindLabel}>
                {snapshot?.kind
                  ? KIND_LABELS[snapshot.kind]
                  : busy
                    ? 'Loading...'
                    : 'Ready'}
              </Text>
            </View>
            {isVoiceDucked && snapshot?.kind === 'preview' && (
              <Volume2 size={16} color='#FBBF24' />
            )}
          </View>
          <Pressable
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            onPress={(e) => {
              if (durationMs <= 0 || barWidth <= 0) return;
              const ratio = Math.max(
                0,
                Math.min(1, e.nativeEvent.locationX / barWidth)
              );
              void provider.seek(ratio * durationMs);
              props.onSeekTrack((ratio * durationMs) / 1000);
            }}
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${progressRatio * 100}%`, backgroundColor: accent },
              ]}
            />
          </Pressable>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
            <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
          </View>
          <View style={styles.controlsRow}>
            <Pressable
              onPress={() => handleSkip(-1)}
              disabled={currentResultIndex <= 0}
              style={styles.controlBtn}
            >
              <SkipBack
                size={22}
                color={currentResultIndex <= 0 ? '#4B5563' : '#E5E7EB'}
              />
            </Pressable>
            <Pressable onPress={handleToggle} style={styles.playBtn}>
              {snapshot?.isPlaying ? (
                <Pause size={26} color='#080B10' />
              ) : (
                <Play size={26} color='#080B10' />
              )}
            </Pressable>
            <Pressable
              onPress={() => handleSkip(1)}
              disabled={currentResultIndex >= results.length - 1}
              style={styles.controlBtn}
            >
              <SkipForward
                size={22}
                color={
                  currentResultIndex >= results.length - 1
                    ? '#4B5563'
                    : '#E5E7EB'
                }
              />
            </Pressable>
            <Pressable
              onPress={() => {
                if (current) void playTrack(current, currentResultIndex);
              }}
              style={styles.controlBtn}
            >
              <RefreshCw size={18} color='#9CA3AF' />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { fontFamily: MONO_FONT, fontSize: 12, letterSpacing: 1.5 },
  pillsRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  connectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectTitle: { color: '#E5E7EB', fontSize: 14, fontWeight: '600', flex: 1 },
  badge: {
    color: '#34D399',
    fontFamily: MONO_FONT,
    fontSize: 10,
    letterSpacing: 1,
  },
  badgeWarn: { color: '#FBBF24' },
  linkBtn: { alignSelf: 'flex-start' },
  linkBtnText: { color: '#9CA3AF', fontSize: 12, textDecorationLine: 'underline' },
  connectBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  connectBtnText: { color: '#080B10', fontSize: 14, fontWeight: '700' },
  noteText: { color: '#9CA3AF', fontSize: 12, lineHeight: 17 },
  warnText: { color: '#FBBF24' },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    color: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { color: '#080B10', fontSize: 13, fontWeight: '700' },
  errorRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  errorText: { color: '#FCD34D', fontSize: 12, lineHeight: 17, flex: 1 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  resultRowActive: { backgroundColor: 'rgba(255,255,255,0.04)' },
  artwork: { width: 44, height: 44, borderRadius: 8 },
  artworkPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultMeta: { flex: 1, gap: 2 },
  resultTitle: { color: '#F3F4F6', fontSize: 14, fontWeight: '600' },
  resultArtist: { color: '#9CA3AF', fontSize: 12 },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nowArtwork: { width: 56, height: 56, borderRadius: 10 },
  nowTitle: { color: '#F3F4F6', fontSize: 15, fontWeight: '700' },
  kindLabel: { color: '#9CA3AF', fontFamily: MONO_FONT, fontSize: 10 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: { height: 4, borderRadius: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: '#6B7280', fontFamily: MONO_FONT, fontSize: 11 },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  controlBtn: { padding: 6 },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#D4FF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
