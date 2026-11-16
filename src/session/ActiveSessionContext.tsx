/**
 * Active identity comes from current committed participation, never room selection.
 * The database restores membership across launches. Local cached IDs are ignored.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { isSupabaseConfigured, supabase, subscribeToTableChanges, unsubscribeChannel } from '../services/supabaseClient';
import { fetchCurrentSession, type CurrentSession } from '../services/sessionsService';
import type { RideSessionRow } from '../services/database.types';

interface ActiveSessionValue {
  activeSession: RideSessionRow | null;
  setActiveSession: (session: RideSessionRow | null) => void;
  refreshActiveSession: () => Promise<void>;
  membershipError: string | null;
  membershipLoading: boolean;
  participationKey: string | null;
}
const ActiveSessionContext = createContext<ActiveSessionValue | null>(null);

export function ActiveSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const scope = useRef({ userId, generation: 0 });
  if (scope.current.userId !== userId) {
    scope.current = { userId, generation: scope.current.generation + 1 };
  }
  const accountScope = scope.current;
  const [state, setState] = useState<{ owner: typeof accountScope | null; session: CurrentSession | null; error: string | null; loaded: boolean }>({ owner: null, session: null, error: null, loaded: false });
  const refreshActiveSession = useCallback(async () => {
    if (scope.current !== accountScope) return;
    const generation = ++accountScope.generation;
    const valid = () => scope.current === accountScope && accountScope.generation === generation;
    if (!userId || !isSupabaseConfigured) {
      if (valid()) setState({ owner: accountScope, session: null, error: null, loaded: true });
      return;
    }
    try {
      const session = await fetchCurrentSession(userId);
      if (valid()) setState({ owner: accountScope, session, error: null, loaded: true });
    } catch (err) {
      // Fail closed: unresolved membership must not keep publishing location/audio.
      if (valid()) setState({ owner: accountScope, session: null, error: err instanceof Error ? err.message : 'Could not verify session membership.', loaded: true });
    }
  }, [userId, accountScope]);
  const setActiveSession = useCallback((session: RideSessionRow | null) => {
    if (scope.current !== accountScope) return;
    ++accountScope.generation;
    if (session === null) setState({ owner: accountScope, session: null, error: null, loaded: true });
    else void refreshActiveSession();
  }, [userId, accountScope, refreshActiveSession]);

  useEffect(() => {
    void refreshActiveSession();
    if (!userId || !isSupabaseConfigured) return;
    // No active-ID persistence: Supabase is the only restoration source.
    try { globalThis.localStorage?.removeItem('pacelock.activeSessionId.v1'); } catch { /* Best effort legacy hint cleanup. */ }
    const channel = supabase?.channel(`current-membership:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_participants', filter: `user_id=eq.${userId}` }, () => void refreshActiveSession())
      .subscribe();
    const timer = setInterval(() => void refreshActiveSession(), 15000);
    const appState = AppState.addEventListener('change', next => { if (next === 'active') void refreshActiveSession(); });
    return () => {
      ++accountScope.generation;
      clearInterval(timer);
      appState.remove();
      if (channel) void unsubscribeChannel(channel);
    };
  }, [userId, accountScope, refreshActiveSession]);
  const activeSession = state.owner === accountScope ? state.session : null;
  const activeId = activeSession?.session_id;
  useEffect(() => {
    if (!activeId) return;
    const channel = subscribeToTableChanges('ride_sessions', { sessionId: activeId, onChange: () => void refreshActiveSession() });
    return () => { void unsubscribeChannel(channel); };
  }, [activeId, refreshActiveSession]);

  const value = useMemo<ActiveSessionValue>(() => ({
    activeSession, setActiveSession, refreshActiveSession,
    membershipError: state.owner === accountScope ? state.error : null,
    membershipLoading: !!userId && (state.owner !== accountScope || !state.loaded),
    participationKey: activeSession && userId ? `${userId}:${activeSession.session_id}:${activeSession.participationJoinedAt ?? ''}` : null,
  }), [activeSession, setActiveSession, refreshActiveSession, state, userId, accountScope]);
  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}
export function useActiveSession(): ActiveSessionValue {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) throw new Error('useActiveSession must be used inside ActiveSessionProvider');
  return ctx;
}
