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
 * It renders inside the app shell's ScrollView, so it owns no scroll
 * container of its own.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthProvider';
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
const BG = '#080B10';
const CARD = '#0D1420';
const BORDER = '#1E293B';
const TEXT = '#E2E8F0';
const MUTED = '#94A3B8';
const DANGER = '#F87171';

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
      const q = subscribeToTableChanges('session_queue', {
        sessionId: session.session_id,
        onChange,
      });
      const p = subscribeToTableChanges('session_playback_state', {
        sessionId: session.session_id,
        onChange,
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
      <View style={styles.card}>
        <Text style={styles.cardTitle}>PACK · BACKEND OFFLINE</Text>
        <Text style={styles.body}>
          Supabase env vars are not set, so live sessions and friends are
          unavailable. Add EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY to .env and restart.
        </Text>
      </View>
    );
  }

  if (!myId) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>PACK</Text>
        <Text style={styles.body}>Sign in to see your pack.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>PACK · LIVE BACKEND</Text>
        <Pressable
          onPress={() => void refresh()}
          style={styles.smallBtn}
          disabled={busy}
        >
          <Text style={styles.smallBtnText}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={styles.subtle}>
        Signed in as @{auth.profile?.username ?? '...'}
      </Text>

      {error && <Text style={styles.errorText}>{error}</Text>}
      {info && <Text style={styles.infoText}>{info}</Text>}
      {loading && <ActivityIndicator color={ACCENT} />}

      {/* CREATE SESSION */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>CREATE SESSION</Text>
        <TextInput
          style={styles.input}
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder="Saturday ridge loop"
          placeholderTextColor={MUTED}
        />
        <View style={styles.segmentRow}>
          {VISIBILITIES.map((v) => (
            <Pressable
              key={v}
              onPress={() => setNewVisibility(v)}
              style={[
                styles.segment,
                newVisibility === v && styles.segmentActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  newVisibility === v && styles.segmentTextActive,
                ]}
              >
                {v}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.primaryBtn, busy && styles.disabled]}
          onPress={handleCreate}
          disabled={busy}
        >
          <Text style={styles.primaryBtnText}>Create Session</Text>
        </Pressable>
      </View>

      {/* MY SESSIONS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>MY SESSIONS</Text>
        {mySessions.length === 0 && (
          <Text style={styles.body}>
            No sessions yet. Create one above or join from Discover.
          </Text>
        )}
        {mySessions.map((session) => {
          const isHost = session.host_id === myId;
          const expanded = expandedId === session.session_id;
          return (
            <View key={session.session_id} style={styles.rowCard}>
              <Pressable onPress={() => void toggleExpand(session)}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>{session.title}</Text>
                  <Text style={styles.chip}>{session.status}</Text>
                </View>
                <Text style={styles.subtle}>
                  {session.visibility}
                  {isHost ? ' · you host' : ' · guest'}
                  {activeSession?.session_id === session.session_id
                    ? ' · ACTIVE'
                    : ''}
                  {' · tap for riders'}
                </Text>
              </Pressable>
              {expanded && (
                <View style={styles.detailBlock}>
                  {participants.length === 0 && (
                    <Text style={styles.body}>Loading riders...</Text>
                  )}
                  {participants.map((p) => (
                    <Text key={p.user_id} style={styles.body}>
                      @{names[p.user_id] ?? p.user_id.slice(0, 8)} · {p.role}
                      {' · '}
                      {p.status}
                    </Text>
                  ))}
                  {session.status === 'active' ? (
                    <View style={styles.inviteBlock}>
                      <Pressable
                        style={styles.smallBtn}
                        onPress={() => void toggleSharing(session)}
                      >
                        <Text style={styles.smallBtnText}>
                          {sharing
                            ? 'Stop sharing my location'
                            : 'Share my location live'}
                        </Text>
                      </Pressable>
                      {participants.map((p) => {
                        const fix = liveFixes[p.user_id];
                        return (
                          <Text key={`fix-${p.user_id}`} style={styles.body}>
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
                    <Text style={styles.subtle}>
                      Live location starts when the host starts the session.
                    </Text>
                  )}
                  <View style={styles.inviteBlock}>
                    <Text style={styles.subtle}>SHARED QUEUE</Text>
                    {(() => {
                      const current = queueEntries.find(
                        (e) => e.item.queue_item_id === playback?.current_item_id
                      );
                      return (
                        <Text style={styles.body}>
                          {current
                            ? `Now: ${current.track?.title ?? 'Track'} · ${
                                playback?.is_playing ? 'playing' : 'paused'
                              }`
                            : 'Nothing playing yet. Queue a track below.'}
                        </Text>
                      );
                    })()}
                    {playback?.current_item_id && (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.smallBtn}
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
                          <Text style={styles.smallBtnText}>
                            {playback.is_playing ? 'Pause' : 'Play'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                    {queueEntries.length === 0 && (
                      <Text style={styles.body}>Queue is empty.</Text>
                    )}
                    {queueEntries.map((entry) => (
                      <View
                        key={entry.item.queue_item_id}
                        style={styles.actionRow}
                      >
                        <Text style={styles.body}>
                          {entry.item.position}.{' '}
                          {entry.track?.title ?? 'Unknown track'}
                          {entry.track ? ` · ${entry.track.artist}` : ''}
                          {' · '}
                          {entry.item.status}
                        </Text>
                        {entry.item.status === 'queued' && (
                          <Pressable
                            style={styles.smallBtn}
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
                            <Text style={styles.smallBtnText}>Play</Text>
                          </Pressable>
                        )}
                        {(entry.item.status === 'queued' ||
                          entry.item.status === 'playing') && (
                          <Pressable
                            style={styles.smallBtn}
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
                            <Text style={styles.smallBtnText}>
                              {entry.item.status === 'playing'
                                ? 'Skip'
                                : 'Remove'}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                    <TextInput
                      style={styles.input}
                      value={trackTitle}
                      onChangeText={setTrackTitle}
                      placeholder="Track title"
                      placeholderTextColor={MUTED}
                    />
                    <TextInput
                      style={styles.input}
                      value={trackArtist}
                      onChangeText={setTrackArtist}
                      placeholder="Artist"
                      placeholderTextColor={MUTED}
                    />
                    <View style={styles.segmentRow}>
                      {(['apple_music', 'spotify'] as MusicProviderId[]).map(
                        (p) => (
                          <Pressable
                            key={p}
                            onPress={() => setTrackProvider(p)}
                            style={[
                              styles.segment,
                              trackProvider === p && styles.segmentActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.segmentText,
                                trackProvider === p &&
                                  styles.segmentTextActive,
                              ]}
                            >
                              {p === 'apple_music' ? 'Apple Music' : 'Spotify'}
                            </Text>
                          </Pressable>
                        )
                      )}
                    </View>
                    <TextInput
                      style={styles.input}
                      value={trackProviderId}
                      onChangeText={setTrackProviderId}
                      placeholder="Provider track ID (optional)"
                      placeholderTextColor={MUTED}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable
                      style={[styles.primaryBtn, busy && styles.disabled]}
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
                      <Text style={styles.primaryBtnText}>Add to Queue</Text>
                    </Pressable>
                  </View>
                  {isHost && friends.length > 0 && (
                    <View style={styles.inviteBlock}>
                      <Text style={styles.subtle}>Invite a friend:</Text>
                      {friends.map((f) =>
                        f.friend ? (
                          <Pressable
                            key={f.friend.user_id}
                            style={styles.smallBtn}
                            disabled={busy}
                            onPress={() =>
                              handleInviteFriend(session, f.friend!.user_id)
                            }
                          >
                            <Text style={styles.smallBtnText}>
                              Invite @{f.friend.username}
                            </Text>
                          </Pressable>
                        ) : null
                      )}
                    </View>
                  )}
                </View>
              )}
              <View style={styles.actionRow}>
                {activeSession?.session_id !== session.session_id &&
                  session.status !== 'completed' &&
                  session.status !== 'cancelled' && (
                    <Pressable
                      style={styles.smallBtn}
                      disabled={busy}
                      onPress={() => setActiveSession(session)}
                    >
                      <Text style={styles.smallBtnText}>Make Active</Text>
                    </Pressable>
                  )}
                {isHost && session.status === 'lobby' && (
                  <Pressable
                    style={styles.smallBtn}
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await setSessionStatus(session.session_id, 'active');
                      }, 'Session is live.')
                    }
                  >
                    <Text style={styles.smallBtnText}>Start</Text>
                  </Pressable>
                )}
                {isHost &&
                  (session.status === 'active' ||
                    session.status === 'lobby') && (
                    <Pressable
                      style={styles.smallBtn}
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
                      <Text style={styles.smallBtnText}>Complete</Text>
                    </Pressable>
                  )}
                {!isHost && (
                  <Pressable
                    style={styles.smallBtn}
                    disabled={busy}
                    onPress={() => handleLeave(session)}
                  >
                    <Text style={styles.smallBtnText}>Leave</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* DISCOVER */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>DISCOVER</Text>
        {discover.length === 0 && (
          <Text style={styles.body}>
            No public or friends sessions open right now.
          </Text>
        )}
        {discover.map((session) => (
          <View key={session.session_id} style={styles.rowCard}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>{session.title}</Text>
              <Text style={styles.chip}>{session.status}</Text>
            </View>
            <Text style={styles.subtle}>{session.visibility} session</Text>
            <View style={styles.actionRow}>
              <Pressable
                style={styles.smallBtn}
                disabled={busy}
                onPress={() => handleJoin(session)}
              >
                <Text style={styles.smallBtnText}>Join</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* INVITES */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>INVITES</Text>
        {invites.length === 0 && (
          <Text style={styles.body}>No pending invites.</Text>
        )}
        {invites.map((invite) => (
          <View key={invite.invite_id} style={styles.rowCard}>
            <Text style={styles.rowTitle}>
              {inviteSessions[invite.session_id]?.title ?? 'Session invite'}
            </Text>
            <View style={styles.actionRow}>
              <Pressable
                style={styles.smallBtn}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await respondToInvite(invite, 'accepted');
                  }, 'Invite accepted. You are in.')
                }
              >
                <Text style={styles.smallBtnText}>Accept</Text>
              </Pressable>
              <Pressable
                style={styles.smallBtn}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await respondToInvite(invite, 'declined');
                  }, 'Invite declined.')
                }
              >
                <Text style={styles.smallBtnText}>Decline</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* FRIENDS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>FRIENDS</Text>
        {requests.map((r) =>
          r.friend ? (
            <View key={r.friend.user_id} style={styles.rowCard}>
              <Text style={styles.rowTitle}>
                @{r.friend.username} wants to ride
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.smallBtn}
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
                  <Text style={styles.smallBtnText}>Accept</Text>
                </Pressable>
                <Pressable
                  style={styles.smallBtn}
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
                  <Text style={styles.smallBtnText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          ) : null
        )}
        {friends.length === 0 && requests.length === 0 && (
          <Text style={styles.body}>
            No friends yet. Search below to find your pack.
          </Text>
        )}
        {friends.map((f) =>
          f.friend ? (
            <Text key={f.friend.user_id} style={styles.body}>
              @{f.friend.username}
            </Text>
          ) : null
        )}
        <TextInput
          style={styles.input}
          value={search}
          onChangeText={setSearch}
          placeholder="Search usernames"
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.primaryBtn, busy && styles.disabled]}
          onPress={handleSearch}
          disabled={busy}
        >
          <Text style={styles.primaryBtnText}>Search</Text>
        </Pressable>
        {searchResults.map((p) => (
          <View key={p.user_id} style={styles.rowCard}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>@{p.username}</Text>
              {friendIds.has(p.user_id) ? (
                <Text style={styles.chip}>friends</Text>
              ) : (
                <Pressable
                  style={styles.smallBtn}
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await sendFriendRequest(myId, p.user_id);
                    }, `Request sent to @${p.username}.`)
                  }
                >
                  <Text style={styles.smallBtnText}>Add</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  card: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  body: { color: TEXT, fontSize: 14 },
  subtle: { color: MUTED, fontSize: 12 },
  errorText: { color: DANGER, fontSize: 13 },
  infoText: { color: ACCENT, fontSize: 13 },
  input: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXT,
    fontSize: 14,
  },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  segmentActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  segmentText: { color: MUTED, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: BG },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: BG, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  rowCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: { color: TEXT, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  chip: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  smallBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  smallBtnText: { color: ACCENT, fontSize: 12, fontWeight: '700' },
  detailBlock: { gap: 4, paddingTop: 4 },
  inviteBlock: { gap: 6, paddingTop: 6 },
});
