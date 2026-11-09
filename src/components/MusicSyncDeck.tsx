// src/components/MusicSyncDeck.tsx
// Music tab: connect Apple Music, search the catalog, and play. Plays
// publish into the active pack session's shared queue, and when
// someone else in the session is DJ this tab follows their playback.
//
// Apple Music is the only provider. Search is the live catalog on
// every platform; on native the in-app player plays the official 30s
// preview, and full playback works on web through MusicKit when a
// developer token is configured. The Spotify integration lives on the
// app-remote-spike branch if it is ever revived.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
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
} from 'lucide-react-native';
import { useAuth } from '../auth/AuthProvider';
import { useActiveSession } from '../session/ActiveSessionContext';
import {
  fetchPlaybackState,
  fetchSessionQueueWithTracks,
  publishNowPlaying,
  updatePlaybackState,
} from '../services/musicDataService';
import {
  subscribeToTableChanges,
  supabase,
} from '../services/supabaseClient';
import type { SessionPlaybackStateRow } from '../services/database.types';
import { appleMusicProvider } from '../music/providers/AppleMusicProvider';
import {
  AuthState,
  CanonicalTrack,
  PlaybackKind,
  PlaybackSnapshot,
  ProviderError,
  ProviderId,
} from '../music/types';


function formatTime(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const KIND_LABELS: Record<PlaybackKind, string> = {
  remote: 'Full track · Apple Music',
  preview: 'Preview · 30s, playing in this app',
  musickit: 'Full track · Apple Music (web)',
};

const ACCENT = '#FA243C';

export default function MusicSyncDeck() {

  // Apple Music only (Nov 9, 2026). providerId stays as a constant so
  // the render code below keeps its shape for an easy Spotify revival.
  const providerId: ProviderId = 'apple';

  // Pack publishing: plays in this tab also queue into the active
  // session's shared queue, so the rest of the pack sees the song.
  const auth = useAuth();
  const { activeSession } = useActiveSession();
  const lastPublishedRef = useRef<string | null>(null);
  const suppressPublishRef = useRef(false);
  const followedItemRef = useRef<string | null>(null);
  const followBusyRef = useRef(false);
  const [packSyncError, setPackSyncError] = useState<string | null>(null);
  const [lastPublishedTitle, setLastPublishedTitle] = useState<string | null>(
    null
  );
  const [packLinkStatus, setPackLinkStatus] = useState('not connected');
  const [lastPackEventAt, setLastPackEventAt] = useState<string | null>(null);
  const [followNotice, setFollowNotice] = useState<string | null>(null);
  const publishToPack = (track: CanonicalTrack) => {
    const sessionId = activeSession?.session_id;
    const userId = auth.user?.id;
    if (!sessionId || !userId) return;
    const key = `${sessionId}:${track.providerIds.apple ?? track.isrc ?? track.title}`;
    if (lastPublishedRef.current === key) return;
    lastPublishedRef.current = key;
    void publishNowPlaying(sessionId, userId, {
      provider: 'apple_music',
      providerTrackId:
        track.providerIds.apple ??
        (track.isrc ? `isrc:${track.isrc}` : `manual-${Date.now()}`),
      title: track.title,
      artist: track.artist,
      album: track.album ?? undefined,
      durationMs: track.durationMs ?? undefined,
      artworkUrl: track.artworkUrl ?? undefined,
    })
      .then(() => {
        setPackSyncError(null);
        setLastPublishedTitle(track.title);
      })
      .catch((err: unknown) => {
        lastPublishedRef.current = null;
        setPackSyncError(
          err instanceof Error
            ? err.message.replace('[Supabase] ', '')
            : 'Pack sync failed.'
        );
      });
  };
  const provider = appleMusicProvider;
  const accent = ACCENT;

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
      if (suppressPublishRef.current) {
        suppressPublishRef.current = false;
      } else {
        publishToPack(track);
      }
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

  const playTrackRef = useRef(playTrack);
  useEffect(() => {
    playTrackRef.current = playTrack;
  });

  // --- follower playback: when someone else is the DJ, this device
  // plays what the shared playback state points at ---
  const activeSessionId = activeSession?.session_id ?? null;
  const myUserId = auth.user?.id ?? null;
  const appleConnected = !!activeAuth?.isConnected;
  useEffect(() => {
    if (!activeSessionId || !myUserId) return;
    let live = true;
    const handleState = async (
      row: SessionPlaybackStateRow | null,
      fromInitialFetch: boolean
    ) => {
      if (!live || !row) return;
      if (row.dj_user_id === myUserId) return;
      if (!row.current_item_id) return;
      if (
        fromInitialFetch &&
        row.position_updated_at &&
        Date.now() - new Date(row.position_updated_at).getTime() > 10 * 60 * 1000
      ) {
        return; // stale state from an earlier ride; do not autoplay it
      }
      if (row.current_item_id !== followedItemRef.current) {
        if (!appleConnected) {
          followedItemRef.current = row.current_item_id;
          setFollowNotice(
            'The pack started a new track. Connect Apple Music above to hear it here.'
          );
          return;
        }
        if (followBusyRef.current) return;
        followBusyRef.current = true;
        try {
          const entries = await fetchSessionQueueWithTracks(activeSessionId);
          const entry = entries.find(
            (e) => e.item.queue_item_id === row.current_item_id
          );
          const track = entry?.track ?? null;
          if (!track || track.provider !== 'apple_music') return;
          const pid = track.provider_track_id;
          if (pid.startsWith('isrc:') || pid.startsWith('manual-')) {
            followedItemRef.current = row.current_item_id;
            setPackSyncError(
              `The pack is playing ${track.title}, but this device cannot resolve it to an Apple Music track.`
            );
            return;
          }
          const canonical: CanonicalTrack = {
            isrc: '',
            title: track.title,
            artist: track.artist,
            album: track.album ?? undefined,
            artworkUrl: track.artwork_url ?? undefined,
            durationMs: track.duration_ms ?? 0,
            bpm: null,
            providerIds: { apple: pid },
          };
          followedItemRef.current = row.current_item_id;
          suppressPublishRef.current = true;
          await playTrackRef.current(canonical, -1);
          if (!row.is_playing) {
            await provider.pause().catch(() => {});
            setSnapshot(await provider.getSnapshot().catch(() => null));
          }
        } catch (err) {
          setPackSyncError(
            err instanceof Error ? err.message : 'Pack playback failed.'
          );
        } finally {
          followBusyRef.current = false;
        }
      } else {
        try {
          const snap = await provider.getSnapshot();
          if (row.is_playing && snap && !snap.isPlaying) {
            await provider.resume();
            setSnapshot(await provider.getSnapshot());
          } else if (!row.is_playing && snap?.isPlaying) {
            await provider.pause();
            setSnapshot(await provider.getSnapshot());
          }
        } catch {
          // Snapshot races while following are harmless.
        }
      }
    };
    void fetchPlaybackState(activeSessionId)
      .then((row) => handleState(row, true))
      .catch(() => {});
    const channel = subscribeToTableChanges('session_playback_state', {
      sessionId: activeSessionId,
      onStatus: (status) => {
        setPackLinkStatus(
          status === 'SUBSCRIBED'
            ? 'live'
            : status.toLowerCase().replace(/_/g, ' ')
        );
      },
      onChange: (payload) => {
        setLastPackEventAt(new Date().toLocaleTimeString());
        void handleState(
          payload.new as unknown as SessionPlaybackStateRow,
          false
        );
      },
    });
    return () => {
      live = false;
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [activeSessionId, myUserId, appleConnected]);

  const handleToggle = async () => {
    if (!current) return;
    try {
      const pausing = !!snapshot?.isPlaying;
      if (pausing) {
        await provider.pause();
      } else {
        await provider.resume();
      }
      setSnapshot(await provider.getSnapshot());
      if (activeSession && auth.user) {
        void updatePlaybackState(activeSession.session_id, {
          is_playing: !pausing,
          dj_user_id: auth.user.id,
        }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playback control failed.');
    }
  };

  const handleSkip = async (delta: number) => {
    const next = currentResultIndex + delta;
    if (next < 0 || next >= results.length) return;
    await playTrack(results[next], next);
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
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-3 px-5 py-5"
    >
      <View className="flex-row items-center gap-2">
        <Music2 size={16} color={accent} />
        <Text className="font-mono text-[12px] tracking-[1.5px] text-[#FA243C]">
          MUSIC · APPLE MUSIC
        </Text>
      </View>
      {activeSession ? (
        <Text className="mt-1.5 font-mono text-[11px] leading-[15px] text-accent">
          Pack session: {activeSession.title}. Songs you play here queue
          for the whole pack.
        </Text>
      ) : (
        <Text className="mt-1.5 font-mono text-[11px] leading-[15px] text-muted">
          No active pack session. Set one in the Pack tab and songs you
          play here will queue for the group.
        </Text>
      )}
      {packSyncError ? (
        <Text className="mt-1 font-mono text-[11px] leading-[15px] text-danger">
          Pack sync: {packSyncError}
        </Text>
      ) : lastPublishedTitle && activeSession ? (
        <Text className="mt-1.5 font-mono text-[11px] leading-[15px] text-muted">
          Queued for the pack: {lastPublishedTitle}
        </Text>
      ) : null}
      {followNotice && !packSyncError ? (
        <Text className="mt-1.5 font-mono text-[11px] leading-[15px] text-muted">
          {followNotice}
        </Text>
      ) : null}
      {activeSession ? (
        <Text className="mt-1.5 font-mono text-[11px] leading-[15px] text-muted">
          Pack link: {packLinkStatus} · last update{' '}
          {lastPackEventAt ?? 'none yet'}
        </Text>
      ) : null}
      <View className="gap-2.5 rounded-[14px] border border-line bg-panel p-3.5">
        {activeAuth?.isConnected ? (
          <>
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={16} color="#34D399" />
              <Text className="flex-1 text-[14px] font-semibold text-fog">
                {activeAuth.userDisplayName ?? 'Connected'}
              </Text>
            </View>
            <Pressable onPress={handleDisconnect} className="self-start">
              <Text className="text-[12px] text-muted underline">Disconnect</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={handleConnect}
            className="items-center rounded-[10px] bg-[#FA243C] py-3"
          >
            <Text className="text-[14px] font-bold text-ink">
              {appleMusicProvider.canUseMusicKit()
                ? 'Connect Apple Music account'
                : 'Use Apple Music catalog'}
            </Text>
          </Pressable>
        )}
        <Text className="text-[12px] leading-[17px] text-muted">
          {provider.capabilities.playbackNote}
        </Text>
      </View>
      <View className="gap-2.5 rounded-[14px] border border-line bg-panel p-3.5">
        <View className="flex-row gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            placeholder="Search Apple Music (song or artist)..."
            placeholderTextColor="#6B7280"
            className="flex-1 rounded-[10px] border border-line bg-panel2 px-3 py-2.5 text-[14px] text-fog"
            returnKeyType="search"
          />
          <Pressable
            onPress={handleSearch}
            className="items-center justify-center rounded-[10px] bg-[#FA243C] px-4"
          >
            <Text className="text-[13px] font-bold text-ink">
              {searching ? '...' : 'Search'}
            </Text>
          </Pressable>
        </View>
        {error && (
          <View className="flex-row items-start gap-2">
            <AlertTriangle size={14} color="#FBBF24" />
            <Text className="flex-1 text-[12px] leading-[17px] text-warn">
              {error}
            </Text>
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
              className={`flex-row items-center gap-2.5 border-t border-line py-2 ${isCurrent ? 'bg-panel2' : ''}`}
            >
              {item.artworkUrl ? (
                <Image
                  source={{ uri: item.artworkUrl }}
                  className="h-11 w-11 rounded-lg"
                />
              ) : (
                <View className="h-11 w-11 items-center justify-center rounded-lg bg-panel2">
                  <Music2 size={16} color="#9CA3AF" />
                </View>
              )}
              <View className="flex-1 gap-0.5">
                <Text className="text-[14px] font-semibold text-fog" numberOfLines={1}>
                  {item.title}
                  {item.explicit ? '  (E)' : ''}
                </Text>
                <Text className="text-[12px] text-muted" numberOfLines={1}>
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
      {current && (
        <View className="gap-2.5 rounded-[14px] border border-line bg-panel p-3.5">
          <View className="flex-row items-center gap-3">
            {current.artworkUrl ? (
              <Image
                source={{ uri: current.artworkUrl }}
                className="h-14 w-14 rounded-[10px]"
              />
            ) : (
              <View className="h-14 w-14 items-center justify-center rounded-[10px] bg-panel2">
                <Music2 size={20} color="#9CA3AF" />
              </View>
            )}
            <View className="flex-1 gap-0.5">
              <Text className="text-[15px] font-bold text-fog" numberOfLines={1}>
                {current.title}
              </Text>
              <Text className="text-[12px] text-muted" numberOfLines={1}>
                {current.artist}
              </Text>
              <Text className="font-mono text-[10px] text-muted">
                {snapshot?.kind
                  ? KIND_LABELS[snapshot.kind]
                  : busy
                    ? 'Loading...'
                    : 'Ready'}
              </Text>
            </View>
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
            }}
            className="h-[10px] justify-center overflow-hidden rounded-[5px] bg-panel2"
          >
            <View
              className="h-1 rounded-full bg-[#FA243C]"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </Pressable>
          <View className="flex-row justify-between">
            <Text className="font-mono text-[11px] text-muted">
              {formatTime(positionMs)}
            </Text>
            <Text className="font-mono text-[11px] text-muted">
              {formatTime(durationMs)}
            </Text>
          </View>
          <View className="flex-row items-center justify-center gap-[22px]">
            <Pressable
              onPress={() => handleSkip(-1)}
              disabled={currentResultIndex <= 0}
              className="p-1.5"
            >
              <SkipBack
                size={22}
                color={currentResultIndex <= 0 ? '#4B5563' : '#E5E7EB'}
              />
            </Pressable>
            <Pressable
              onPress={handleToggle}
              className="h-14 w-14 items-center justify-center rounded-full bg-[#D4FF00]"
            >
              {snapshot?.isPlaying ? (
                <Pause size={26} color="#080B10" />
              ) : (
                <Play size={26} color="#080B10" />
              )}
            </Pressable>
            <Pressable
              onPress={() => handleSkip(1)}
              disabled={currentResultIndex >= results.length - 1}
              className="p-1.5"
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
              className="p-1.5"
            >
              <RefreshCw size={18} color="#9CA3AF" />
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
