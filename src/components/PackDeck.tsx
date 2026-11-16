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
  RouteRow,
} from '../services/database.types';
import {
  MEMBERSHIP_CONFLICT_MESSAGE,
  createSession,
  fetchDiscoverableSessions,
  fetchMyInvites,
  fetchMySessions,
  fetchParticipants,
  fetchSession,
  joinSession,
  respondToInvite,
  setMyParticipantStatus,
  setSessionRoute,
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
import {
  createRoute,
  fetchLatestPings,
  fetchRoutes,
} from '../services/rideDataService';
import RoutePlanner, { type PlannedRoute } from './RoutePlanner';
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
  const { activeSession, setActiveSession, refreshActiveSession, membershipLoading, membershipError, participationKey } = useActiveSession();
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
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [newRouteId, setNewRouteId] = useState<string | null>(null);
  const [planningRoute, setPlanningRoute] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createPlanning, setCreatePlanning] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<PlannedRoute | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchRoutes()
      .then((rows) => {
        if (live) setRoutes(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);

  const accountRef = useRef({ id: myId, live: true });
  if (accountRef.current.id !== myId) accountRef.current = { id: myId, live: true };
  const account = accountRef.current;
  useEffect(() => { account.live = true; return () => { account.live = false; }; }, [account]);
  const actionBusyRef = useRef(false);
  const refreshGeneration = useRef(0);
  const roomRef = useRef({ id: null as string | null, generation: 0 });
  const liveGeneration = useRef(0);
  const activityRef = useRef({ userId: myId, key: participationKey, id: activeSession?.session_id });
  if (activityRef.current.userId !== myId || activityRef.current.key !== participationKey) {
    roomRef.current = { id: null, generation: roomRef.current.generation + 1 };
    ++liveGeneration.current;
  }
  activityRef.current = { userId: myId, key: participationKey, id: activeSession?.session_id };

  const refresh = useCallback(async () => {
    if (!myId) return;
    const request = ++refreshGeneration.current;
    const valid = () => (accountRef.current === account && account.live) && refreshGeneration.current === request;
    try {
      const [mine, disc, inv, fr, req] = await Promise.all([
        fetchMySessions(myId),
        fetchDiscoverableSessions(),
        fetchMyInvites(myId),
        fetchFriends(myId),
        fetchIncomingRequests(myId),
      ]);
      if (!valid()) return;
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
      if (!valid()) return;
      setInviteSessions(sessionMap);
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      if (valid()) setLoading(false);
    }
  }, [myId, account]);

  useEffect(() => {
    void refresh();
  }, [refresh, participationKey]);

  const run = async (fn: (valid: () => boolean) => Promise<void>, done?: string) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    const key = activityRef.current.key;
    const room = roomRef.current.generation;
    const sameAccount = () => (accountRef.current === account && account.live);
    const valid = () => sameAccount() && key === activityRef.current.key && room === roomRef.current.generation;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn(valid);
      if (!valid()) return;
      await refreshActiveSession();
      if (!valid()) return;
      if (done) setInfo(done);
      await refresh();
    } catch (err) {
      if (!valid()) return;
      await refreshActiveSession();
      if (valid()) setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      if (sameAccount()) { actionBusyRef.current = false; setBusy(false); }
    }
  };

  const stopLive = useCallback(async () => {
    ++liveGeneration.current;
    const handle = sharingHandleRef.current;
    sharingHandleRef.current = null;
    fixesUnsubRef.current?.();
    fixesUnsubRef.current = null;
    liveSessionRef.current = null;
    setSharing(false);
    setLiveFixes({});
    await handle?.stop();
  }, []);

  const startLiveView = useCallback(async (session: RideSessionRow) => {
    if (session.status !== 'active' || activityRef.current.id !== session.session_id) return;
    const generation = liveGeneration.current;
    const room = roomRef.current.generation;
    const valid = () => liveGeneration.current === generation && roomRef.current.generation === room && activityRef.current.id === session.session_id;
    try {
      const latest = await fetchLatestPings(session.session_id);
      if (!valid()) return;
      const initial: Record<string, LiveFix> = {};
      for (const [userId, ping] of latest) initial[userId] = {
        userId, lat: ping.location.coordinates[1], lng: ping.location.coordinates[0],
        speedMps: ping.speed_mps, headingDeg: ping.heading_deg, recordedAt: ping.recorded_at,
      };
      setLiveFixes(initial);
    } catch {
      // Catch-up is best effort; live fixes still arrive.
    }
    if (!valid()) return;
    liveSessionRef.current = session.session_id;
    fixesUnsubRef.current = subscribeToLocationFixes(session.session_id, fix => {
      if (valid()) setLiveFixes(prev => ({ ...prev, [fix.userId]: fix }));
    });
  }, []);

  const toggleSharing = async (session: RideSessionRow) => {
    if (!myId || activityRef.current.id !== session.session_id) return;
    if (sharing) {
      await stopLive();
      // Keep viewing fixes after stopping our own broadcast.
      void startLiveView(session);
      return;
    }
    const generation = liveGeneration.current;
    const userId = myId;
    const key = activityRef.current.key;
    const valid = () => generation === liveGeneration.current && activityRef.current.userId === userId && activityRef.current.key === key && roomRef.current.id === session.session_id;
    const handle = await startLocationSharing(session.session_id, userId, reason => { if (valid()) setError(reason); }, valid);
    if (!valid()) { await handle?.stop(); return; }
    if (handle) {
      sharingHandleRef.current = handle;
      setSharing(true);
      void setMyParticipantStatus(session.session_id, userId, 'riding').catch(async err => {
        if (!valid()) return;
        setError(err instanceof Error ? err.message : 'Could not start sharing.');
        await stopLive();
        await refreshActiveSession();
      });
    }
  };

  const loadQueue = useCallback(async (sessionId: string) => {
    const room = roomRef.current.generation;
    const key = activityRef.current.key;
    const valid = () => roomRef.current.id === sessionId && roomRef.current.generation === room && activityRef.current.key === key;
    if (!valid()) return;
    try {
      const [entries, state] = await Promise.all([
        fetchSessionQueueWithTracks(sessionId),
        fetchPlaybackState(sessionId),
      ]);
      if (!valid()) return;
      setQueueEntries(entries);
      setPlayback(state);
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Failed to load queue.');
    }
  }, []);

  const stopQueueView = useCallback(async () => {
    const channels = queueChannelsRef.current;
    queueChannelsRef.current = [];
    setQueueEntries([]);
    setPlayback(null);
    await Promise.all(channels.map(unsubscribeChannel));
  }, []);

  const startQueueView = useCallback(
    (session: RideSessionRow) => {
      if (roomRef.current.id !== session.session_id || activityRef.current.id !== session.session_id) return;
      const generation = roomRef.current.generation;
      const valid = () => roomRef.current.generation === generation && roomRef.current.id === session.session_id && activityRef.current.id === session.session_id;
      void loadQueue(session.session_id);
      const onChange = () => { if (valid()) void loadQueue(session.session_id); };
      const onStatus = (status: string) => {
        if (!valid()) return;
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
      ++roomRef.current.generation;
      roomRef.current.id = null;
      void stopLive();
      void stopQueueView();
    };
  }, [stopLive, stopQueueView]);

  useEffect(() => {
    ++roomRef.current.generation;
    roomRef.current.id = null;
    setExpandedId(null);
    setParticipants([]);
    setNames({});
    setSongResults([]);
    setSongError(null);
    void stopLive();
    void stopQueueView();
  }, [myId, participationKey, stopLive, stopQueueView]);

  useEffect(() => {
    actionBusyRef.current = false;
    setBusy(false); setMySessions([]); setDiscover([]); setInvites([]); setInfo(null); setError(null);
  }, [myId, account]);

  const toggleExpand = async (session: RideSessionRow) => {
    const closing = roomRef.current.id === session.session_id;
    const generation = ++roomRef.current.generation;
    roomRef.current.id = closing ? null : session.session_id;
    setExpandedId(closing ? null : session.session_id);
    setParticipants([]);
    setNames({});
    setPlanningRoute(false);
    setSongResults([]);
    const valid = () => roomRef.current.generation === generation && (accountRef.current === account && account.live);
    await Promise.all([stopLive(), stopQueueView()]);
    if (closing || !valid()) return;
    try {
      const rows = await fetchParticipants(session.session_id);
      if (!valid()) return;
      setParticipants(rows);
      const map: Record<string, string> = {};
      for (const row of rows) {
        const profile = await fetchProfile(row.user_id);
        if (!valid()) return;
        map[row.user_id] = profile?.username ?? row.user_id.slice(0, 8);
      }
      setNames(map);
      if (activityRef.current.id === session.session_id) startQueueView(session);
      else void loadQueue(session.session_id);
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Failed to load riders.');
    }
  };

  useEffect(() => {
    const generation = roomRef.current.generation;
    void stopLive().then(() => {
      if (roomRef.current.generation === generation && expandedId === activeSession?.session_id && activeSession) void startLiveView(activeSession);
    });
    return () => { void stopLive(); };
  }, [expandedId, activeSession?.session_id, activeSession?.status, participationKey, startLiveView, stopLive]);

  const handleCreate = () =>
    run(async valid => {
      if (activeSession) throw new Error(MEMBERSHIP_CONFLICT_MESSAGE);
      if (!myId) throw new Error('Not signed in.');
      if (newTitle.trim().length < 3) {
        throw new Error('Give the session a title of 3+ characters.');
      }
      const created = await createSession(myId, {
        title: newTitle.trim(),
        visibility: newVisibility,
        routeId: newRouteId ?? undefined,
      });
      if (!valid()) return;
      if (pendingRoute) {
        const route = await createRoute(myId, pendingRoute);
        if (!valid()) return;
        await setSessionRoute(created.session_id, route.route_id);
        setRoutes((prev) => [route, ...prev]);
      }
      if (!valid()) return;
      await refreshActiveSession();
      if (accountRef.current !== account || !account.live) return;
      setNewTitle('');
      setNewRouteId(null);
      setPendingRoute(null);
      setCreatePlanning(false);
    }, 'Session created. It starts in the lobby.');

  const syncSessionRoute = (session: RideSessionRow, routeId: string | null) => {
    const updated = { ...session, route_id: routeId };
    setMySessions((prev) =>
      prev.map((s) => (s.session_id === session.session_id ? updated : s))
    );
    if (activeSession?.session_id === session.session_id) {
      void refreshActiveSession();
    }
  };

  const handleAttachRoute = (session: RideSessionRow, routeId: string | null) =>
    run(async valid => {
      await setSessionRoute(session.session_id, routeId);
      if (!valid()) return;
      syncSessionRoute(session, routeId);
    }, routeId ? 'Route attached.' : 'Route removed.');

  const handlePlanSave =
    (session: RideSessionRow) => async (planned: PlannedRoute) => {
      if (!myId) throw new Error('Not signed in.');
      const accountAtStart = account;
      const room = roomRef.current.generation;
      const valid = () => accountRef.current === accountAtStart && accountAtStart.live && roomRef.current.generation === room;
      const route = await createRoute(myId, planned);
      if (!valid()) return;
      setRoutes((prev) => [route, ...prev]);
      await setSessionRoute(session.session_id, route.route_id);
      if (!valid()) return;
      syncSessionRoute(session, route.route_id);
      setPlanningRoute(false);
      setInfo('Route saved and attached.');
    };

  const handleJoin = (session: RideSessionRow) =>
    run(async valid => {
      if (!myId) throw new Error('Not signed in.');
      if (activeSession && activeSession.session_id !== session.session_id) throw new Error(MEMBERSHIP_CONFLICT_MESSAGE);
      await joinSession(session.session_id, myId);
      if (valid()) await refreshActiveSession();
    }, `Joined ${session.title}. It is now your active session.`);

  const handleLeave = (session: RideSessionRow) =>
    run(async valid => {
      if (!myId) throw new Error('Not signed in.');
      await setMyParticipantStatus(session.session_id, myId, 'left');
      if (!valid()) return;
      ++roomRef.current.generation; roomRef.current.id = null;
      setExpandedId(null);
      void stopLive(); void stopQueueView();
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

  const openSession = activeSession?.session_id === expandedId ? activeSession : mySessions.find(s => s.session_id === expandedId) ?? null;

  // ---------- SESSION ROOM (full screen) ----------
  if (openSession) {
    const session = openSession;
    const isHost = session.host_id === myId;
    const attachedRoute = routes.find((r) => r.route_id === session.route_id);
    const isActiveSession = activeSession?.session_id === session.session_id;
    const currentEntry = queueEntries.find(
      (e) => e.item.queue_item_id === playback?.current_item_id
    );
    return (
      <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-3.5 px-5 py-5">
        <View className="flex-row items-center justify-between">
          <Pressable
            className="rounded-full border border-line px-3 py-1.5"
            onPress={() => void toggleExpand(session)}
          >
            <Text className="text-[13px] font-bold text-fog">‹ Sessions</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void refreshActiveSession();
              void refresh();
              void loadQueue(session.session_id);
            }}
            className="rounded-full border border-line px-3 py-1.5"
            disabled={busy}
          >
            <Text className="text-[13px] font-bold text-accent">Refresh</Text>
          </Pressable>
        </View>

        {membershipError && <Text className="text-[13px] text-danger">{membershipError}</Text>}
        {error && <Text className="text-[13px] text-danger">{error}</Text>}
        {info && <Text className="text-[13px] text-accent">{info}</Text>}

        <View className="gap-1.5">
          <Text className="text-[22px] font-extrabold text-fog">{session.title}</Text>
          <Text className="text-[12px] font-bold uppercase text-accent">
            {session.status} · {session.visibility} · {isHost ? 'you host' : 'guest'}
          </Text>
          {!isActiveSession && <Text className="text-[13px] text-muted">Session history. Live activity and membership controls are off.</Text>}
          {isActiveSession && <Text className="text-[13px] text-muted">This is your active session. It is the one on your Ride tab.</Text>}
          {isHost && isActiveSession && <Text className="text-[13px] text-muted">End or cancel this session before joining or hosting another.</Text>}
        </View>

        {isHost && isActiveSession && session.status === 'lobby' && (
          <Pressable
            className={`items-center rounded-[12px] bg-accent py-3.5 ${busy ? 'opacity-60' : ''}`}
            disabled={busy || !isActiveSession}
            onPress={() =>
              void run(async valid => {
                await setSessionStatus(session.session_id, 'active');
                if (!valid()) return;
                const updated: RideSessionRow = {
                  ...session,
                  status: 'active',
                  started_at: new Date().toISOString(),
                };
                setMySessions((prev) =>
                  prev.map((s) =>
                    s.session_id === session.session_id ? updated : s
                  )
                );
                await refreshActiveSession();
              }, 'Session is live. It is on your Ride tab now.')
            }
          >
            <Text className="text-[15px] font-extrabold text-ink">Start the ride</Text>
          </Pressable>
        )}
        {isHost && isActiveSession && !['completed', 'cancelled'].includes(session.status) && (
          <Pressable
            className="items-center rounded-[12px] border border-line py-3"
            disabled={busy || !isActiveSession}
            onPress={() =>
              void run(async valid => {
                await setSessionStatus(session.session_id, 'completed');
                if (!valid()) return;
                const updated: RideSessionRow = {
                  ...session,
                  status: 'completed',
                  ended_at: new Date().toISOString(),
                };
                setMySessions((prev) =>
                  prev.map((s) =>
                    s.session_id === session.session_id ? updated : s
                  )
                );
                if (isActiveSession) setActiveSession(null);
              }, 'Session completed.')
            }
          >
            <Text className="text-[14px] font-bold text-danger">End session</Text>
          </Pressable>
        )}
        {!isHost && isActiveSession && session.status !== 'completed' && session.status !== 'cancelled' && (
          <Pressable
            className="items-center rounded-[12px] border border-line py-3"
            disabled={busy || !isActiveSession}
            onPress={() => void handleLeave(session)}
          >
            <Text className="text-[14px] font-bold text-danger">Leave session</Text>
          </Pressable>
        )}

        {/* RIDERS */}
        <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
          <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">
            RIDERS · {participants.filter((p) => ['joined', 'riding', 'paused'].includes(p.status)).length}
          </Text>
          {participants.length === 0 && (
            <Text className="text-[14px] text-fog">Loading riders...</Text>
          )}
          {participants.map((p) => {
            const fix = liveFixes[p.user_id];
            return (
              <View key={p.user_id} className="gap-0.5">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="shrink text-[14px] font-semibold text-fog">
                    @{names[p.user_id] ?? p.user_id.slice(0, 8)}
                  </Text>
                  <Text className="text-[12px] text-muted">
                    {p.role} · {p.status}
                  </Text>
                </View>
                {isActiveSession && session.status === 'active' && (
                  <Text className="text-[12px] text-muted">
                    {fix
                      ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${
                          fix.speedMps != null
                            ? ` · ${(fix.speedMps * 2.23694).toFixed(1)} mph`
                            : ''
                        } · ${Math.max(
                          0,
                          Math.round(
                            (Date.now() - Date.parse(fix.recordedAt)) / 1000
                          )
                        )}s ago`
                      : 'no fix yet'}
                  </Text>
                )}
              </View>
            );
          })}
          {isActiveSession && session.status === 'active' ? (
            <Pressable
              className="mt-1 items-center rounded-[10px] border border-line py-[10px]"
              onPress={() => void toggleSharing(session)}
            >
              <Text className="text-[13px] font-bold text-accent">
                {sharing ? 'Stop sharing my location' : 'Share my location live'}
              </Text>
            </Pressable>
          ) : (
            <Text className="text-[12px] text-muted">
              Live location starts when the host starts the session.
            </Text>
          )}
        </View>

        {/* ROUTE */}
        <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
          <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">ROUTE</Text>
          {attachedRoute ? (
            <Text className="text-[15px] font-semibold text-fog">
              {attachedRoute.name} · {(attachedRoute.distance_m / 1609.34).toFixed(1)} mi
              {attachedRoute.is_loop ? ' · loop' : ''}
            </Text>
          ) : (
            <Text className="text-[14px] leading-5 text-muted">
              No route yet. Riders still see each other on the map; a route
              draws the planned line on everyone's Ride screen.
            </Text>
          )}
          {!isHost && (
            <Text className="text-[12px] text-muted">
              Only the host can plan or change the route.
            </Text>
          )}
          {(session.status === 'completed' || session.status === 'cancelled') && (
            <Text className="text-[12px] text-muted">
              This session has ended, so its route can no longer change.
            </Text>
          )}
          {isHost && isActiveSession &&
            (session.status === 'lobby' || session.status === 'active') && (
            <View className="gap-2 pt-1">
              <Pressable
                className="items-center rounded-[10px] bg-accent py-[11px]"
                onPress={() => setPlanningRoute((v) => !v)}
              >
                <Text className="text-[14px] font-extrabold text-ink">
                  {planningRoute ? 'Close the planner' : attachedRoute ? 'Plan a different route' : 'Plan a route'}
                </Text>
              </Pressable>
              {planningRoute && (
                <RoutePlanner
                  onSave={handlePlanSave(session)}
                  onCancel={() => setPlanningRoute(false)}
                />
              )}
              {routes.some((r) => r.route_id !== session.route_id) && (
                <>
                  <Text className="text-[12px] text-muted">Or attach a saved route:</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {routes
                      .filter((r) => r.route_id !== session.route_id)
                      .map((r) => (
                        <Pressable
                          key={r.route_id}
                          className="rounded-full border border-line px-3 py-1.5"
                          disabled={busy || !isActiveSession}
                          onPress={() => void handleAttachRoute(session, r.route_id)}
                        >
                          <Text className="text-[12px] font-bold text-fog">
                            {r.name} · {(r.distance_m / 1609.34).toFixed(1)} mi
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                </>
              )}
              {session.route_id ? (
                <Pressable
                  className="items-center rounded-[10px] border border-line py-[9px]"
                  disabled={busy || !isActiveSession}
                  onPress={() => void handleAttachRoute(session, null)}
                >
                  <Text className="text-[13px] font-bold text-danger">Remove route</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {/* SHARED MUSIC QUEUE */}
        <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-[12px] font-bold tracking-[1.5px] text-accent">
              SHARED MUSIC
            </Text>
            <View className="flex-row items-center gap-2">
              <Text className="font-mono text-[11px] text-muted">{queueLive}</Text>
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy || !isActiveSession}
                onPress={() => void loadQueue(session.session_id)}
              >
                <Text className="text-[12px] font-bold text-accent">Refresh</Text>
              </Pressable>
            </View>
          </View>
          <Text className="text-[14px] text-fog">
            {currentEntry
              ? `Now: ${currentEntry.track?.title ?? 'Track'} · ${playback?.is_playing ? 'playing' : 'paused'}`
              : 'Nothing playing yet. Search below to queue the first track.'}
          </Text>
          {playback?.current_item_id && (
            <Pressable
              className="items-center rounded-[10px] border border-line py-[10px]"
              disabled={busy || !isActiveSession}
              onPress={() =>
                void run(async valid => {
                  await updatePlaybackState(session.session_id, {
                    is_playing: !playback.is_playing,
                  });
                  await loadQueue(session.session_id);
                })
              }
            >
              <Text className="text-[13px] font-bold text-accent">
                {playback.is_playing ? 'Pause for everyone' : 'Play for everyone'}
              </Text>
            </Pressable>
          )}
          {queueEntries.length === 0 && (
            <Text className="text-[14px] text-muted">Queue is empty.</Text>
          )}
          {queueEntries.map((entry) => (
            <View key={entry.item.queue_item_id} className="gap-1 rounded-[10px] border border-line p-2.5">
              <Text className="text-[14px] text-fog">
                {entry.item.position}. {entry.track?.title ?? 'Unknown track'}
                {entry.track ? ` · ${entry.track.artist}` : ''}
                {' · '}
                {entry.item.status}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {entry.item.status === 'queued' && (
                  <Pressable
                    className="rounded-full border border-line px-2.5 py-[5px]"
                    disabled={busy || !isActiveSession}
                    onPress={() =>
                      void run(async valid => {
                        const prev = queueEntries.find(
                          (e) => e.item.status === 'playing'
                        );
                        if (prev && prev.item.queue_item_id !== entry.item.queue_item_id) {
                          await setQueueItemStatus(prev.item.queue_item_id, 'played');
                          if (!valid()) return;
                        }
                        await setQueueItemStatus(entry.item.queue_item_id, 'playing');
                        if (!valid()) return;
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
                {(entry.item.status === 'queued' || entry.item.status === 'playing') && (
                  <Pressable
                    className="rounded-full border border-line px-2.5 py-[5px]"
                    disabled={busy || !isActiveSession}
                    onPress={() =>
                      void run(async valid => {
                        await setQueueItemStatus(
                          entry.item.queue_item_id,
                          entry.item.status === 'playing' ? 'skipped' : 'removed'
                        );
                        if (!valid()) return;
                        if (playback?.current_item_id === entry.item.queue_item_id) {
                          await updatePlaybackState(session.session_id, {
                            current_item_id: null,
                            is_playing: false,
                            position_ms: 0,
                          });
                        }
                        await loadQueue(session.session_id);
                      })
                    }
                  >
                    <Text className="text-[12px] font-bold text-accent">
                      {entry.item.status === 'playing' ? 'Skip' : 'Remove'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
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
                  setSongError(err instanceof Error ? err.message : 'Search failed.')
                )
                .finally(() => setSongSearching(false));
            }}
          />
          <Pressable
            className="items-center rounded-[10px] border border-line py-[10px]"
            disabled={songSearching || !songQuery.trim()}
            onPress={() => {
              if (!songQuery.trim()) return;
              setSongSearching(true);
              setSongError(null);
              searchAppleCatalog(songQuery.trim(), 10)
                .then(setSongResults)
                .catch((err: unknown) =>
                  setSongError(err instanceof Error ? err.message : 'Search failed.')
                )
                .finally(() => setSongSearching(false));
            }}
          >
            <Text className="text-[13px] font-bold text-accent">
              {songSearching ? 'Searching...' : 'Search'}
            </Text>
          </Pressable>
          {songError ? (
            <Text className="text-[14px] text-fog">Search: {songError}</Text>
          ) : null}
          {songResults.map((t) => (
            <View key={t.providerIds.apple ?? t.title} className="flex-row items-center justify-between gap-2 rounded-[10px] border border-line p-2.5">
              <Text className="shrink text-[14px] text-fog">
                {t.title} · {t.artist}
              </Text>
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy || !isActiveSession}
                onPress={() =>
                  void run(async valid => {
                    if (!myId) throw new Error('Not signed in.');
                    const appleId = t.providerIds.apple;
                    if (!appleId) throw new Error('That result has no Apple Music ID.');
                    await enqueueTrack(session.session_id, myId, {
                      provider: 'apple_music',
                      providerTrackId: appleId,
                      title: t.title,
                      artist: t.artist,
                      album: t.album,
                      durationMs: t.durationMs,
                      artworkUrl: t.artworkUrl,
                    }, undefined, valid);
                    await loadQueue(session.session_id);
                  }, `Added ${t.title} to the queue.`)
                }
              >
                <Text className="text-[12px] font-bold text-accent">Add</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => setShowManualAdd((v) => !v)}>
            <Text className="text-[12px] font-bold text-muted">
              {showManualAdd ? 'Hide manual add' : 'Add a track manually instead'}
            </Text>
          </Pressable>
          {showManualAdd && (
            <View className="gap-2">
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
                {(['apple_music', 'spotify'] as MusicProviderId[]).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setTrackProvider(p)}
                    className={`rounded-full border border-line px-3 py-1.5 ${trackProvider === p ? 'border-accent bg-accent' : ''}`}
                  >
                    <Text className={`text-[12px] font-bold text-muted ${trackProvider === p ? 'text-ink' : ''}`}>
                      {p === 'apple_music' ? 'Apple Music' : 'Spotify'}
                    </Text>
                  </Pressable>
                ))}
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
                disabled={busy || !isActiveSession}
                onPress={() =>
                  void run(async valid => {
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
                    }, undefined, valid);
                    if (!valid()) return;
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
          )}
        </View>

        {/* INVITE FRIENDS */}
        {isHost && isActiveSession && friends.length > 0 && (
          <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
            <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">
              INVITE FRIENDS
            </Text>
            {friends.map((f) =>
              f.friend ? (
                <Pressable
                  key={f.friend.user_id}
                  className="flex-row items-center justify-between rounded-[10px] border border-line p-2.5"
                  disabled={busy || !isActiveSession}
                  onPress={() => handleInviteFriend(session, f.friend!.user_id)}
                >
                  <Text className="text-[14px] text-fog">@{f.friend.username}</Text>
                  <Text className="text-[12px] font-bold text-accent">Invite</Text>
                </Pressable>
              ) : null
            )}
          </View>
        )}
      </ScrollView>
    );
  }

  // ---------- SESSIONS HOME ----------
  const activeRow = activeSession;
  return (
    <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-3.5 px-5 py-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-extrabold tracking-[1.5px] text-fog">PACK</Text>
        <Pressable
          onPress={() => { void refreshActiveSession(); void refresh(); }}
          className="rounded-full border border-line px-3 py-1.5"
          disabled={busy}
        >
          <Text className="text-[13px] font-bold text-accent">Refresh</Text>
        </Pressable>
      </View>
      <Text className="text-[12px] text-muted">
        Signed in as @{auth.profile?.username ?? '...'}
      </Text>
      {membershipError && <Text className="text-[13px] text-danger">{membershipError}</Text>}
      {error && <Text className="text-[13px] text-danger">{error}</Text>}
      {info && <Text className="text-[13px] text-accent">{info}</Text>}
      {loading && <ActivityIndicator color={ACCENT} />}

      {activeSession && <Text className="text-[13px] text-muted">{MEMBERSHIP_CONFLICT_MESSAGE}{activeSession.host_id === myId ? ' Hosts must end or cancel their session first.' : ''}</Text>}
      {membershipLoading && <Text className="text-[13px] text-muted">Checking current session…</Text>}
      {activeRow && (
        <Pressable
          className="gap-1 rounded-[14px] border border-accent bg-panel p-3.5"
          onPress={() => void toggleExpand(activeRow)}
        >
          <Text className="text-[11px] font-bold tracking-[1.5px] text-accent">
            YOUR ACTIVE SESSION
          </Text>
          <Text className="text-[16px] font-bold text-fog">{activeRow.title}</Text>
          <Text className="text-[12px] text-muted">
            {activeRow.status}
            {activeRow.route_id
              ? ` · ${routes.find((r) => r.route_id === activeRow.route_id)?.name ?? 'route attached'}`
              : ' · no route'}
            {' · tap to open'}
          </Text>
        </Pressable>
      )}

      <Pressable
        className="items-center rounded-[12px] bg-accent py-3"
        disabled={busy || membershipLoading || !!membershipError || !!activeSession}
        onPress={() => setShowCreate((v) => !v)}
      >
        <Text className="text-[15px] font-extrabold text-ink">
          {showCreate ? 'Close' : '+ New session'}
        </Text>
      </Pressable>
      {showCreate && (
        <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
          <TextInput
            className="rounded-[10px] border border-line bg-ink px-3 py-2.5 text-[14px] text-fog"
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Session name, e.g. Saturday ridge loop"
            placeholderTextColor={MUTED}
          />
          <View className="flex-row gap-2">
            {VISIBILITIES.map((v) => (
              <Pressable
                key={v}
                onPress={() => setNewVisibility(v)}
                className={`rounded-full border border-line px-3 py-1.5 ${newVisibility === v ? 'border-accent bg-accent' : ''}`}
              >
                <Text className={`text-[12px] font-bold text-muted ${newVisibility === v ? 'text-ink' : ''}`}>
                  {v}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-[12px] text-muted">ROUTE (OPTIONAL)</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => {
                setNewRouteId(null);
                setPendingRoute(null);
              }}
              className={`rounded-full border border-line px-3 py-1.5 ${newRouteId === null ? 'border-accent bg-accent' : ''}`}
            >
              <Text className={`text-[12px] font-bold text-muted ${newRouteId === null ? 'text-ink' : ''}`}>
                No route
              </Text>
            </Pressable>
            {routes.map((r) => (
              <Pressable
                key={r.route_id}
                onPress={() => {
                  setNewRouteId(r.route_id);
                  setPendingRoute(null);
                }}
                className={`rounded-full border border-line px-3 py-1.5 ${newRouteId === r.route_id ? 'border-accent bg-accent' : ''}`}
              >
                <Text className={`text-[12px] font-bold text-muted ${newRouteId === r.route_id ? 'text-ink' : ''}`}>
                  {r.name} · {(r.distance_m / 1609.34).toFixed(1)} mi
                </Text>
              </Pressable>
            ))}
          </View>
          {pendingRoute ? (
            <View className="gap-1.5 rounded-[10px] border border-accent p-2.5">
              <Text className="text-[13px] font-semibold text-fog">
                New route: {pendingRoute.name} ·{' '}
                {(pendingRoute.distanceM / 1609.34).toFixed(1)} mi
                {pendingRoute.estDurationS
                  ? ` · about ${Math.round(pendingRoute.estDurationS / 60)} min`
                  : ''}
              </Text>
              <Text className="text-[12px] text-muted">
                It attaches automatically when you create the session.
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  className="rounded-full border border-line px-2.5 py-[5px]"
                  onPress={() => setCreatePlanning(true)}
                >
                  <Text className="text-[12px] font-bold text-accent">Edit</Text>
                </Pressable>
                <Pressable
                  className="rounded-full border border-line px-2.5 py-[5px]"
                  onPress={() => setPendingRoute(null)}
                >
                  <Text className="text-[12px] font-bold text-danger">Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              className="items-center rounded-[10px] border border-accent py-[10px]"
              onPress={() => setCreatePlanning((v) => !v)}
            >
              <Text className="text-[13px] font-extrabold text-accent">
                {createPlanning ? 'Close the planner' : 'Plan a new route'}
              </Text>
            </Pressable>
          )}
          {createPlanning && (
            <RoutePlanner
              onSave={async (planned) => {
                setPendingRoute(planned);
                setNewRouteId(null);
                setCreatePlanning(false);
              }}
              onCancel={() => setCreatePlanning(false)}
            />
          )}
          <Pressable
            className={`items-center rounded-[10px] bg-accent py-[11px] ${busy ? 'opacity-60' : ''}`}
            onPress={handleCreate}
            disabled={busy || membershipLoading || !!membershipError || !!activeSession}
          >
            <Text className="text-[14px] font-extrabold text-ink">Create session</Text>
          </Pressable>
        </View>
      )}

      <View className="gap-2">
        <Text className="text-[12px] font-bold tracking-[1.5px] text-muted">MY SESSIONS</Text>
        {mySessions.length === 0 && (
          <Text className="text-[14px] leading-5 text-fog">
            No sessions yet. Start one with New session above, or join one
            from Discover below.
          </Text>
        )}
        {mySessions.map((session) => {
          const isHost = session.host_id === myId;
          const route = routes.find((r) => r.route_id === session.route_id);
          return (
            <Pressable
              key={session.session_id}
              className="flex-row items-center justify-between gap-2 rounded-[14px] border border-line bg-panel p-3.5"
              onPress={() => void toggleExpand(session)}
            >
              <View className="shrink gap-0.5">
                <Text className="text-[15px] font-bold text-fog">{session.title}</Text>
                <Text className="text-[12px] text-muted">
                  {session.visibility} · {isHost ? 'you host' : 'guest'} ·{' '}
                  {route ? route.name : 'no route'}
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-[11px] font-bold uppercase text-accent">
                  {session.status}
                </Text>
                <Text className="text-[16px] text-muted">›</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {invites.length > 0 && (
        <View className="gap-2">
          <Text className="text-[12px] font-bold tracking-[1.5px] text-muted">INVITES</Text>
          {invites.map((invite) => (
            <View key={invite.invite_id} className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
              <Text className="text-[15px] font-bold text-fog">
                {inviteSessions[invite.session_id]?.title ?? 'Session invite'}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  className="flex-1 items-center rounded-[10px] bg-accent py-[9px]"
                  disabled={busy || membershipLoading || !!membershipError || (!!activeSession && activeSession.session_id !== invite.session_id)}
                  onPress={() =>
                    void run(async valid => {
                      if (activeSession && activeSession.session_id !== invite.session_id) throw new Error(MEMBERSHIP_CONFLICT_MESSAGE);
                      await respondToInvite(invite, 'accepted');
                      if (valid()) await refreshActiveSession();
                    }, 'Invite accepted. You are in, and this is your active session.')
                  }
                >
                  <Text className="text-[13px] font-extrabold text-ink">Accept</Text>
                </Pressable>
                <Pressable
                  className="flex-1 items-center rounded-[10px] border border-line py-[9px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async valid => {
                      await respondToInvite(invite, 'declined');
                    }, 'Invite declined.')
                  }
                >
                  <Text className="text-[13px] font-bold text-fog">Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <View className="gap-2">
        <Text className="text-[12px] font-bold tracking-[1.5px] text-muted">DISCOVER</Text>
        {discover.length === 0 && (
          <Text className="text-[14px] text-fog">
            No public or friends sessions open right now.
          </Text>
        )}
        {discover.map((session) => (
          <View key={session.session_id} className="flex-row items-center justify-between gap-2 rounded-[14px] border border-line bg-panel p-3.5">
            <View className="shrink gap-0.5">
              <Text className="text-[15px] font-bold text-fog">{session.title}</Text>
              <Text className="text-[12px] text-muted">
                {session.visibility} · {session.status}
              </Text>
            </View>
            <Pressable
              className="rounded-full bg-accent px-3.5 py-1.5"
              disabled={busy || membershipLoading || !!membershipError || (!!activeSession && activeSession.session_id !== session.session_id)}
              onPress={() => handleJoin(session)}
            >
              <Text className="text-[12px] font-extrabold text-ink">Join</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View className="gap-2 rounded-[14px] border border-line bg-panel p-3.5">
        <Text className="mb-1 text-[12px] font-bold tracking-[1.5px] text-accent">FRIENDS</Text>
        {requests.map((r) =>
          r.friend ? (
            <View key={r.friend.user_id} className="gap-2 rounded-[10px] border border-line p-2.5">
              <Text className="text-[14px] font-bold text-fog">
                @{r.friend.username} wants to ride
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  className="flex-1 items-center rounded-[10px] bg-accent py-[8px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async valid => {
                      await respondToFriendRequest(myId, r.friend!.user_id, true);
                    }, 'Friend added.')
                  }
                >
                  <Text className="text-[13px] font-extrabold text-ink">Accept</Text>
                </Pressable>
                <Pressable
                  className="flex-1 items-center rounded-[10px] border border-line py-[8px]"
                  disabled={busy}
                  onPress={() =>
                    void run(async valid => {
                      await respondToFriendRequest(myId, r.friend!.user_id, false);
                    }, 'Request declined.')
                  }
                >
                  <Text className="text-[13px] font-bold text-fog">Decline</Text>
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
          <View key={p.user_id} className="flex-row items-center justify-between gap-2 rounded-[10px] border border-line p-2.5">
            <Text className="shrink text-[14px] font-bold text-fog">@{p.username}</Text>
            {friendIds.has(p.user_id) ? (
              <Text className="text-[11px] font-bold uppercase text-accent">friends</Text>
            ) : (
              <Pressable
                className="rounded-full border border-line px-2.5 py-[5px]"
                disabled={busy}
                onPress={() =>
                  void run(async valid => {
                    await sendFriendRequest(myId, p.user_id);
                  }, `Request sent to @${p.username}.`)
                }
              >
                <Text className="text-[12px] font-bold text-accent">Add</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
