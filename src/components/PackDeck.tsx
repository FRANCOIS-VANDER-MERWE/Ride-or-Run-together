/**
 * PackDeck: the live-backend tab. Everything here runs against the
 * real Supabase schema through src/services (sessionsService,
 * friendsService, profilesService):
 *
 * - My sessions, with participants and host lifecycle controls
 * - Create a session (title plus visibility)
 * - Discover public and friends sessions and join them
 * - Session invites inbox (accept joins the session)
 * - Friends: list, incoming requests, and username search
 *
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { searchAppleCatalog } from '../music/appleMusicApi';
import type { CanonicalTrack } from '../music/types';
import { useActiveSession } from '../session/ActiveSessionContext';
import type {
  ProfileRow,
  RideSessionRow,
  SessionInviteRow,
  SessionParticipantRow,
  SessionVisibility,
} from '../services/database.types';
import {
  createSession,
  fetchDiscoverableSessions,
  fetchMyInvites,
  fetchMySessions,
  fetchParticipants,
  fetchSession,
  joinSession,
  respondToInvite,
  setMyParticipantStatus,
  setSessionStatus,
  sendInvite,
} from '../services/sessionsService';
import {
  fetchFriends,
  fetchIncomingRequests,
  respondToFriendRequest,
  sendFriendRequest,
  type FriendWithProfile,
} from '../services/friendsService';
import {
  fetchProfile,
  searchProfilesByUsername,
} from '../services/profilesService';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { fetchLatestPings } from '../services/rideDataService';
import {
  enqueueTrack,
  fetchPlaybackState,
  fetchSessionQueueWithTracks,
  setQueueItemStatus,
  updatePlaybackState,
  type QueueEntry,
} from '../services/musicDataService';
import {
  subscribeToTableChanges,
  unsubscribeChannel,
} from '../services/supabaseClient';
import type {
  MusicProviderId,
  SessionPlaybackStateRow,
} from '../services/database.types';
import {
  startLocationSharing,
  subscribeToLocationFixes,
  type LiveFix,
  type LocationSharingHandle,
} from '../services/liveLocationService';
import { releaseLocationChannel } from '../services/liveLocationService';

const ACCENT = '#34D399';
const MUTED = '#94A3B8';

const VISIBILITIES: SessionVisibility[] = ['private', 'friends', 'public'];

export default function PackDeck() {
  const auth = useAuth();
  const { activeSession, setActiveSession } = useActiveSession();
  const myId = auth.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [mySessions, setMySessions] = useState<RideSessionRow[]>([]);
  const [discover, setDiscover] = useState<RideSessionRow[]>([]);
  const [invites, setInvites] = useState<SessionInviteRow[]>([]);
  const [inviteSessions, setInviteSessions] = useState<
    Record<string, RideSessionRow | null>
  >({});
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [requests, setRequests] = useState<FriendWithProfile[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<SessionParticipantRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const [sharing, setSharing] = useState(false);
  const sharingHandleRef = useRef<LocationSharingHandle | null>(null);
  const fixesUnsubRef = useRef<(() => void) | null>(null);
  const liveSessionRef = useRef<string | null>(null);
  const [liveFixes, setLiveFixes] = useState<Record<string, LiveFix>>({});

  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [playback, setPlayback] = useState<SessionPlaybackStateRow | null>(null);
  const queueChannelsRef = useRef<RealtimeChannel[]>([]);
  const [trackTitle, setTrackTitle] = useState('');
  const [songQuery, setSongQuery] = useState('');
  const [songResults, setSongResults] = useState<CanonicalTrack[]>([]);
  const [songSearching, setSongSearching] = useState(false);
  const [songError, setSongError] = useState<string | null>(null);
  const [queueLive, setQueueLive] = useState('connecting');
  const [trackArtist, setTrackArtist] = useState('');
  const [trackProvider, setTrackProvider] =
    useState<MusicProviderId>('apple_music');
  const [trackProviderId, setTrackProviderId] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] =
    useState<SessionVisibility>('friends');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);

  const refresh = useCallback(async () => {
    if (!myId) return;
    try {
      const [mine, disc, inv, fr, req] = await Promise.all([
        fetchMySessions(myId),
        fetchDiscoverableSessions(),
        fetchMyInvites(myId),
        fetchFriends(myId),
        fetchIncomingRequests(myId),
      ]);
      setMySessions(mine);
      const myIds = new Set(mine.map((s) => s.session_id));
      setDiscover(disc.filter((s) => !myIds.has(s.session_id)));
      setInvites(inv);
      setFriends(fr);
      setRequests(req);
      const sessionMap: Record<string, RideSessionRow | null> = {};
      for (const invite of inv) {
        sessionMap[invite.session_id] = await fetchSession(invite.session_id);
      }
      setInviteSessions(sessionMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (done) setInfo(done);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopLive = useCallback(async () => {
    if (sharingHandleRef.current) {
      await sharingHandleRef.current.stop();
      sharingHandleRef.current = null;
    }
    setSharing(false);
    if (fixesUnsubRef.current) {
      fixesUnsubRef.current();
      fixesUnsubRef.current = null;
    }
    if (liveSessionRef.current) {
      await releaseLocationChannel(liveSessionRef.current);
      liveSessionRef.current = null;
    }
    setLiveFixes({});
  }, []);


  const startLiveView = useCallback(
    async (session: RideSessionRow) => {
      if (session.status !== 'active') return;
      try {
        const latest = await fetchLatestPings(session.session_id);
        const initial: Record<string, LiveFix> = {};
        for (const [userId, ping] of latest) {
          initial[userId] = {
            userId,
            lat: ping.location.coordinates[1],
            lng: ping.location.coordinates[0],
            speedMps: ping.speed_mps,
            headingDeg: ping.heading_deg,
            recordedAt: ping.recorded_at,
          };
        }
        setLiveFixes(initial);
      } catch {
        // Catch-up is best effort; live fixes still arrive.
      }
      liveSessionRef.current = session.session_id;
      fixesUnsubRef.current = subscribeToLocationFixes(
        session.session_id,
        (fix) => {
          setLiveFixes((prev) => ({ ...prev, [fix.userId]: fix }));
        }
      );
    },
    []
  );

  const toggleSharing = async (session: RideSessionRow) => {
    if (!myId) return;
    if (sharing) {
      await stopLive();
      // Keep viewing fixes after stopping our own broadcast.
      void startLiveView(session);
      return;
    }
    const handle = await startLocationSharing(session.session_id, myId, (reason) =>
      setError(reason)
    );
    if (handle) {
      sharingHandleRef.current = handle;
      setSharing(true);
      void setMyParticipantStatus(session.session_id, myId, 'riding').catch(
        () => undefined
      );
    }
  };

  const loadQueue = useCallback(async (sessionId: string) => {
    try {
      const [entries, state] = await Promise.all([
        fetchSessionQueueWithTracks(sessionId),
        fetchPlaybackState(sessionId),
      ]);
      setQueueEntries(entries);
      setPlayback(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue.');
    }
  }, []);

  const stopQueueView = useCallback(async () => {
    for (const ch of queueChannelsRef.current) {
      await unsubscribeChannel(ch);
    }
    queueChannelsRef.current = [];
    setQueueEntries([]);
    setPlayback(null);
  }, []);

  const startQueueView = useCallback(
    (session: RideSessionRow) => {
      void loadQueue(session.session_id);
      const onChange = () => void loadQueue(session.session_id);
      const onStatus = (status: string) => {
        setQueueLive(
          status === 'SUBSCRIBED'
            ? 'live'
            : status.toLowerCase().replace(/_/g, ' ')
        );
      };
      const q = subscribeToTableChanges('session_queue', {
        sessionId: session.session_id,
        onChange,
        onStatus,
      });
      const p = subscribeToTableChanges('session_playback_state', {
        sessionId: session.session_id,
        onChange,
        onStatus,
      });
      queueChannelsRef.current = [q, p].filter(
        (c): c is RealtimeChannel => Boolean(c)
      );
    },
    [loadQueue]
  );

  useEffect(() => {
    return () => {
      void stopLive();
      void stopQueueView();
    };
  }, [stopLive, stopQueueView]);

  const toggleExpand = async (session: RideSessionRow) => {
    if (expandedId === session.session_id) {
      await stopLive();
      await stopQueueView();
      setExpandedId(null);
      return;
    }
    await stopLive();
    await stopQueueView();
    setExpandedId(session.session_id);
    setParticipants([]);
    try {
      const rows = await fetchParticipants(session.session_id);
      setParticipants(rows);
      const map: Record<string, string> = { ...names };
      for (const row of rows) {
        if (!map[row.user_id]) {
          const profile = await fetchProfile(row.user_id);
          map[row.user_id] = profile?.username ?? row.user_id.slice(0, 8);
        }
      }
      setNames(map);
      void startLiveView(session);
      startQueueView(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load riders.');
    }
  };

  const handleCreate = () =>
    run(async () => {
      if (!myId) throw new Error('Not signed in.');
      if (newTitle.trim().length < 3) {
        throw new Error('Give the session a title of 3+ characters.');
      }
      const created = await createSession(myId, {
        title: newTitle.trim(),
        visibility: newVisibility,
      });
      setActiveSession(created);
      setNewTitle('');
    }, 'Session created. It starts in the lobby.');

  const handleJoin = (session: RideSessionRow) =>
    run(async () => {
      if (!myId) throw new Error('Not signed in.');
      await joinSession(session.session_id, myId);
      setActiveSession(session);
    }, `Joined ${session.title}. It is now your active session.`);

  const handleLeave = (session: RideSessionRow) =>
    run(async () => {
      if (!myId) throw new Error('Not signed in.');
      await setMyParticipantStatus(session.session_id, myId, 'left');
      if (activeSession?.session_id === session.session_id) {
        setActiveSession(null);
      }
    }, `Left ${session.title}.`);

  const handleInviteFriend = (session: RideSessionRow, friendId: string) =>
    run(async () => {
      if (!myId) throw new Error('Not signed in.');
      await sendInvite(session.session_id, myId, friendId);
    }, 'Invite sent.');

  const friendIds = useMemo(
    () =>
      new Set(
        friends
          .map((f) => f.friend?.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    [friends]
  );

  const handleSearch = () =>
    run(async () => {
      if (search.trim().length < 2) {
        throw new Error('Type at least 2 characters to search.');
      }
      const results = await searchProfilesByUsername(search.trim());
      setSearchResults(results.filter((p) => p.user_id !== myId));
    });

  if (!auth.configured) {
    return (
      <View className="m-5 gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">PACK · BACKEND OFFLINE</Text>
        <Text className="text-[14px] text-fog">
          The backend is not configured, so live sessions and friends
          are unavailable. Set the backend URL and anon key in .env and
          restart.
        </Text>
      </View>
    );
  }

  if (!myId) {
    return (
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">PACK</Text>
        <Text className="text-[14px] text-fog">Sign in to see your pack.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-3.5 px-5 py-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-extrabold tracking-[1.5px] text-fog">PACK · LIVE BACKEND</Text>
        <Pressable
          onPress={() => void refresh()}
          className="rounded-full border border-line px-2.5 py-[5px]"
          disabled={busy}
        >
          <Text className="text-[12px] font-bold text-accent">Refresh</Text>
        </Pressable>
      </View>
      <Text className="text-[12px] text-muted">
        Signed in as @{auth.profile?.username ?? '...'}
      </Text>

      {error && <Text className="text-[13px] text-danger">{error}</Text>}
      {info && <Text className="text-[13px] text-accent">{info}</Text>}
      {loading && <ActivityIndicator color={ACCENT} />}

      {/* CREATE SESSION */}
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">CREATE SESSION</Text>
        <TextInput
          className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder="Saturday ridge loop"
          placeholderTextColor={MUTED}
        />
        <View className="flex-row gap-2">
          {VISIBILITIES.map((v) => (
            <Pressable
              key={v}
              onPress={() => setNewVisibility(v)}
              className={`rounded-full border border-line px-3 py-1.5 ${newVisibility === v ? 'border-accent bg-accent' : ''}`}
            >
              <Text
                className={`text-[12px] font-bold text-muted ${newVisibility === v ? 'text-ink' : ''}`}
              >
                {v}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          className={`items-center rounded-[10px] bg-accent py-[11px] ${busy ? 'opacity-60' : ''}`}
          onPress={handleCreate}
          disabled={busy}
        >
          <Text className="text-[14px] font-extrabold text-ink">Create Session</Text>
        </Pressable>
      </View>

      {/* MY SESSIONS */}
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">MY SESSIONS</Text>
        {mySessions.length === 0 && (
          <Text className="text-[14px] text-fog">
            No sessions yet. Create one above or join from Discover.
          </Text>
        )}
        {mySessions.map((session) => {
          const isHost = session.host_id === myId;
          const expanded = expandedId === session.session_id;
          return (
            <View key={session.session_id} className="gap-1.5 rounded-[10px] border border-line p-2.5">
              <Pressable onPress={() => void toggleExpand(session)}>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="shrink text-[14px] font-bold text-fog">{session.title}</Text>
                  <Text className="text-[11px] font-bold uppercase text-accent">{session.status}</Text>
                </View>
                <Text className="text-[12px] text-muted">
                  {session.visibility}
                  {isHost ? ' · you host' : ' · guest'}
                  {activeSession?.session_id === session.session_id
                    ? ' · ACTIVE'
                    : ''}
                  {' · tap for riders'}
                </Text>
              </Pressable>
              {expanded && (
                <View className="gap-1 pt-1">
                  {participants.length === 0 && (
                    <Text className="text-[14px] text-fog">Loading riders...</Text>
                  )}
                  {participants.map((p) => (
                    <Text key={p.user_id} className="text-[14px] text-fog">
                      @{names[p.user_id] ?? p.user_id.slice(0, 8)} · {p.role}
                      {' · '}
                      {p.status}
                    </Text>
                  ))}
                  {session.status === 'active' ? (
                    <View className="gap-1.5 pt-1.5">
                      <Pressable
                        className="rounded-full border border-line px-2.5 py-[5px]"
                        onPress={() => void toggleSharing(session)}
                      >
                        <Text className="text-[12px] font-bold text-accent">
                          {sharing
                            ? 'Stop sharing my location'
                            : 'Share my location live'}
                        </Text>
                      </Pressable>
                      {participants.map((p) => {
                        const fix = liveFixes[p.user_id];
                        return (
                          <Text key={`fix-${p.user_id}`} className="text-[14px] text-fog">
                            @{names[p.user_id] ?? p.user_id.slice(0, 8)}
                            {fix
                              ? ` · ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${
                                  fix.speedMps != null
                                    ? ` · ${fix.speedMps.toFixed(1)} m/s`
                                    : ''
                                } · ${Math.max(
                                  0,
                                  Math.round(
                                    (Date.now() - Date.parse(fix.recordedAt)) /
                                      1000
                                  )
                                )}s ago`
                              : ' · no fix yet'}
                          </Text>
                        );
                      })}
                    </View>
                  ) : (
                    <Text className="text-[12px] text-muted">
                      Live location starts when the host starts the session.
                    </Text>
                  )}
                  <View className="gap-1.5 pt-1.5">
                    <Text className="text-[12px] text-muted">
                      SHARED QUEUE · {queueLive}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Pressable
                        className="rounded-full border border-line px-2.5 py-[5px]"
                        disabled={busy}
                        onPress={() => void loadQueue(session.session_id)}
                      >
                        <Text className="text-[12px] font-bold text-accent">Refresh</Text>
                      </Pressable>
                    </View>
                    {(() => {
                      const current = queueEntries.find(
                        (e) => e.item.queue_item_id === playback?.current_item_id
                      );
                      return (
                        <Text className="text-[14px] text-fog">
                          {current
                            ? `Now: ${current.track?.title ?? 'Track'} · ${
                                playback?.is_playing ? 'playing' : 'paused'
                              }`
                            : 'Nothing playing yet. Queue a track below.'}
                        </Text>
                      );
                    })()}
                    <TextInput
                      className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
                      value={songQuery}
                      onChangeText={setSongQuery}
                      placeholder="Search Apple Music"
                      placeholderTextColor={MUTED}
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => {
                        if (!songQuery.trim() || songSearching) return;
                        setSongSearching(true);
                        setSongError(null);
                        searchAppleCatalog(songQuery.trim(), 10)
                          .then(setSongResults)
                          .catch((err: unknown) =>
                            setSongError(
                              err instanceof Error
                                ? err.message
                                : 'Search failed.'
                            )
                          )
                          .finally(() => setSongSearching(false));
                      }}
                    />
                    <View className="flex-row flex-wrap gap-2">
                      <Pressable
                        className="rounded-full border border-line px-2.5 py-[5px]"
                        disabled={songSearching || !songQuery.trim()}
                        onPress={() => {
                          if (!songQuery.trim()) return;
                          setSongSearching(true);
                          setSongError(null);
                          searchAppleCatalog(songQuery.trim(), 10)
                            .then(setSongResults)
                            .catch((err: unknown) =>
                              setSongError(
                                err instanceof Error
                                  ? err.message
                                  : 'Search failed.'
                              )
                            )
                            .finally(() => setSongSearching(false));
                        }}
                      >
                        <Text className="text-[12px] font-bold text-accent">
                          {songSearching ? 'Searching...' : 'Search'}
                        </Text>
                      </Pressable>
                    </View>
                    {songError ? (
                      <Text className="text-[14px] text-fog">Search: {songError}</Text>
                    ) : null}
                    {songResults.map((t) => (
                      <View
                        key={t.providerIds.apple ?? t.title}
                        className="flex-row flex-wrap gap-2"
                      >
                        <Text className="text-[14px] text-fog">
                          {t.title} · {t.artist}
                        </Text>
                        <Pressable
                          className="rounded-full border border-line px-2.5 py-[5px]"
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              if (!myId) throw new Error('Not signed in.');
                              const appleId = t.providerIds.apple;
                              if (!appleId) {
                                throw new Error(
                                  'That result has no Apple Music ID.'
                                );
                              }
                              await enqueueTrack(session.session_id, myId, {
                                provider: 'apple_music',
                                providerTrackId: appleId,
                                title: t.title,
                                artist: t.artist,
                                album: t.album,
                                durationMs: t.durationMs,
                                artworkUrl: t.artworkUrl,
                              });
                              await loadQueue(session.session_id);
                            }, `Added ${t.title} to the queue.`)
                          }
                        >
                          <Text className="text-[12px] font-bold text-accent">Add</Text>
                        </Pressable>
                      </View>
                    ))}
                    {playback?.current_item_id && (
                      <View className="flex-row flex-wrap gap-2">
                        <Pressable
                          className="rounded-full border border-line px-2.5 py-[5px]"
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              await updatePlaybackState(session.session_id, {
                                is_playing: !playback.is_playing,
                              });
                              await loadQueue(session.session_id);
                            })
                          }
                        >
                          <Text className="text-[12px] font-bold text-accent">
                            {playback.is_playing ? 'Pause' : 'Play'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                    {queueEntries.length === 0 && (
                      <Text className="text-[14px] text-fog">Queue is empty.</Text>
                    )}
                    {queueEntries.map((entry) => (
                      <View
                        key={entry.item.queue_item_id}
                        className="flex-row flex-wrap gap-2"
                      >
                        <Text className="text-[14px] text-fog">
                          {entry.item.position}.{' '}
                          {entry.track?.title ?? 'Unknown track'}
                          {entry.track ? ` · ${entry.track.artist}` : ''}
                          {' · '}
                          {entry.item.status}
                        </Text>
                        {entry.item.status === 'queued' && (
                          <Pressable
                            className="rounded-full border border-line px-2.5 py-[5px]"
                            disabled={busy}
                            onPress={() =>
                              void run(async () => {
                                const prev = queueEntries.find(
                                  (e) => e.item.status === 'playing'
                                );
                                if (
                                  prev &&
                                  prev.item.queue_item_id !==
                                    entry.item.queue_item_id
                                ) {
                                  await setQueueItemStatus(
                                    prev.item.queue_item_id,
                                    'played'
                                  );
                                }
                                await setQueueItemStatus(
                                  entry.item.queue_item_id,
                                  'playing'
                                );
                                await updatePlaybackState(session.session_id, {
                                  current_item_id: entry.item.queue_item_id,
                                  is_playing: true,
                                  position_ms: 0,
                                  dj_user_id: myId,
                                });
                                await loadQueue(session.session_id);
                              })
                            }
                          >
                            <Text className="text-[12px] font-bold text-accent">Play</Text>
                          </Pressable>
                        )}
                        {(entry.item.status === 'queued' ||
                          entry.item.status === 'playing') && (
                          <Pressable
                            className="rounded-full border border-line px-2.5 py-[5px]"
                            disabled={busy}
                            onPress={() =>
                              void run(async () => {
                                await setQueueItemStatus(
                                  entry.item.queue_item_id,
                                  entry.item.status === 'playing'
                                    ? 'skipped'
                                    : 'removed'
                                );
                                if (
                                  playback?.current_item_id ===
                                  entry.item.queue_item_id
                                ) {
                                  await updatePlaybackState(
                                    session.session_id,
                                    {
                                      current_item_id: null,
                                      is_playing: false,
                                      position_ms: 0,
                                    }
                                  );
                                }
                                await loadQueue(session.session_id);
                              })
                            }
                          >
                            <Text className="text-[12px] font-bold text-accent">
                              {entry.item.status === 'playing'
                                ? 'Skip'
                                : 'Remove'}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                    <TextInput
                      className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
                      value={trackTitle}
                      onChangeText={setTrackTitle}
                      placeholder="Track title"
                      placeholderTextColor={MUTED}
                    />
                    <TextInput
                      className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
                      value={trackArtist}
                      onChangeText={setTrackArtist}
                      placeholder="Artist"
                      placeholderTextColor={MUTED}
                    />
                    <View className="flex-row gap-2">
                      {(['apple_music', 'spotify'] as MusicProviderId[]).map(
                        (p) => (
                          <Pressable
                            key={p}
                            onPress={() => setTrackProvider(p)}
                            className={`rounded-full border border-line px-3 py-1.5 ${trackProvider === p ? 'border-accent bg-accent' : ''}`}
                          >
                            <Text
                              className={`text-[12px] font-bold text-muted ${trackProvider === p ? 'text-ink' : ''}`}
                            >
                              {p === 'apple_music' ? 'Apple Music' : 'Spotify'}
                            </Text>
                          </Pressable>
                        )
                      )}
                    </View>
                    <TextInput
                      className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
                      value={trackProviderId}
                      onChangeText={setTrackProviderId}
                      placeholder="Provider track ID (optional)"
                      placeholderTextColor={MUTED}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable
                      className={`items-center rounded-[10px] bg-accent py-[11px] ${busy ? 'opacity-60' : ''}`}
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          if (!myId) throw new Error('Not signed in.');
                          if (!trackTitle.trim() || !trackArtist.trim()) {
                            throw new Error('Enter a title and artist.');
                          }
                          await enqueueTrack(session.session_id, myId, {
                            provider: trackProvider,
                            providerTrackId:
                              trackProviderId.trim() ||
                              `manual-${myId.slice(0, 6)}-${Date.now()}`,
                            title: trackTitle.trim(),
                            artist: trackArtist.trim(),
                          });
                          setTrackTitle('');
                          setTrackArtist('');
                          setTrackProviderId('');
                          await loadQueue(session.session_id);
                        }, 'Track added to the shared queue.')
                      }
                    >
                      <Text className="text-[14px] font-extrabold text-ink">Add to Queue</Text>
                    </Pressable>
                  </View>
                  {isHost && friends.length > 0 && (
                    <View className="gap-1.5 pt-1.5">
                      <Text className="text-[12px] text-muted">Invite a friend:</Text>
                      {friends.map((f) =>
                        f.friend ? (
                          <Pressable
                            key={f.friend.user_id}
                            className="rounded-full border border-line px-2.5 py-[5px]"
                            disabled={busy}
                            onPress={() =>
                              handleInviteFriend(session, f.friend!.user_id)
                            }
                          >
                            <Text className="text-[12px] font-bold text-accent">
                              Invite @{f.friend.username}
                            </Text>
                          </Pressable>
                        ) : null
                      )}
                    </View>
                  )}
                </View>
              )}
              <View className="flex-row flex-wrap gap-2">
                {activeSession?.session_id !== session.session_id &&
                  session.status !== 'completed' &&
                  session.status !== 'cancelled' && (
                    <Pressable
                      className="rounded-full border border-line px-2.5 py-[5px]"
                      disabled={busy}
                      onPress={() => setActiveSession(session)}
                    >
                      <Text className="text-[12px] font-bold text-accent">Make Active</Text>
                    </Pressable>
                  )}
                {isHost && session.status === 'lobby' && (
                  <Pressable
                    className="rounded-full border border-line px-2.5 py-[5px]"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await setSessionStatus(session.session_id, 'active');
                        setActiveSession({ ...session, status: 'active' });
                      }, 'Session is live.')
                    }
                  >
                    <Text className="text-[12px] font-bold text-accent">Start</Text>
                  </Pressable>
                )}
                {isHost &&
                  (session.status === 'active' ||
                    session.status === 'lobby') && (
                    <Pressable
                      className="rounded-full border border-line px-2.5 py-[5px]"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await setSessionStatus(
                            session.session_id,
                            'completed'
                          );
                          if (
                            activeSession?.session_id === session.session_id
                          ) {
                            setActiveSession(null);
                          }
                        }, 'Session completed.')
                      }
                    >
                      <Text className="text-[12px] font-bold text-accent">Complete</Text>
                    </Pressable>
                  )}
                {!isHost && (
                  <Pressable
                    className="rounded-full border border-line px-2.5 py-[5px]"
                    disabled={busy}
                    onPress={() => handleLeave(session)}
                  >
                    <Text className="text-[12px] font-bold text-accent">Leave</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* DISCOVER */}
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">DISCOVER</Text>
        {discover.length === 0 && (
          <Text className="text-[14px] text-fog">
            No public or friends sessions open right now.
          </Text>
        )}
        {discover.map((session) => (
          <View key={session.session_id} className="gap-1.5 rounded-[10px] border border-line p-2.5">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="shrink text-[14px] font-bold text-fog">{session.title}</Text>
              <Text className="text-[11px] font-bold uppercase text-accent">{session.status}</Text>
            </View>
            <Text className="text-[12px] text-muted">{session.visibility} session</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy}
                onPress={() => handleJoin(session)}
              >
                <Text className="text-[12px] font-bold text-accent">Join</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* INVITES */}
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">INVITES</Text>
        {invites.length === 0 && (
          <Text className="text-[14px] text-fog">No pending invites.</Text>
        )}
        {invites.map((invite) => (
          <View key={invite.invite_id} className="gap-1.5 rounded-[10px] border border-line p-2.5">
            <Text className="shrink text-[14px] font-bold text-fog">
              {inviteSessions[invite.session_id]?.title ?? 'Session invite'}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await respondToInvite(invite, 'accepted');
                    const joined = inviteSessions[invite.session_id];
                    if (joined) setActiveSession(joined);
                  }, 'Invite accepted. You are in, and this is your active session.')
                }
              >
                <Text className="text-[12px] font-bold text-accent">Accept</Text>
              </Pressable>
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await respondToInvite(invite, 'declined');
                  }, 'Invite declined.')
                }
              >
                <Text className="text-[12px] font-bold text-accent">Decline</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* FRIENDS */}
      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">FRIENDS</Text>
        {requests.map((r) =>
          r.friend ? (
            <View key={r.friend.user_id} className="gap-1.5 rounded-[10px] border border-line p-2.5">
              <Text className="shrink text-[14px] font-bold text-fog">
                @{r.friend.username} wants to ride
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  className="rounded-full border border-line px-2.5 py-[5px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await respondToFriendRequest(
                        myId,
                        r.friend!.user_id,
                        true
                      );
                    }, 'Friend added.')
                  }
                >
                  <Text className="text-[12px] font-bold text-accent">Accept</Text>
                </Pressable>
                <Pressable
                  className="rounded-full border border-line px-2.5 py-[5px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await respondToFriendRequest(
                        myId,
                        r.friend!.user_id,
                        false
                      );
                    }, 'Request declined.')
                  }
                >
                  <Text className="text-[12px] font-bold text-accent">Decline</Text>
                </Pressable>
              </View>
            </View>
          ) : null
        )}
        {friends.length === 0 && requests.length === 0 && (
          <Text className="text-[14px] text-fog">
            No friends yet. Search below to find your pack.
          </Text>
        )}
        {friends.map((f) =>
          f.friend ? (
            <Text key={f.friend.user_id} className="text-[14px] text-fog">
              @{f.friend.username}
            </Text>
          ) : null
        )}
        <TextInput
          className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
          value={search}
          onChangeText={setSearch}
          placeholder="Search usernames"
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          className={`items-center rounded-[10px] bg-accent py-[11px] ${busy ? 'opacity-60' : ''}`}
          onPress={handleSearch}
          disabled={busy}
        >
          <Text className="text-[14px] font-extrabold text-ink">Search</Text>
        </Pressable>
        {searchResults.map((p) => (
          <View key={p.user_id} className="gap-1.5 rounded-[10px] border border-line p-2.5">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="shrink text-[14px] font-bold text-fog">@{p.username}</Text>
              {friendIds.has(p.user_id) ? (
                <Text className="text-[11px] font-bold uppercase text-accent">friends</Text>
              ) : (
                <Pressable
                  className="rounded-full border border-line px-2.5 py-[5px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await sendFriendRequest(myId, p.user_id);
                    }, `Request sent to @${p.username}.`)
                  }
                >
                  <Text className="text-[12px] font-bold text-accent">Add</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

