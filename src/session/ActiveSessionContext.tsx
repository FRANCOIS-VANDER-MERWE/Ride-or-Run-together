/**
 * The pack's active session: the one session the rest of the app
 * treats as "the ride we are on". The Pack tab sets it (on create,
 * join, or start, or via Make Active); the Music Sync tab reads it to
 * publish queued songs to that session's shared queue.
 *
 * Only the session id is persisted (localStorage), and the row is
 * re-fetched on launch, so a stale or completed session never
 * survives silently: completed and cancelled sessions clear it.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { fetchSession } from '../services/sessionsService';
import type { RideSessionRow } from '../services/database.types';

const STORAGE_KEY = 'pacelock.activeSessionId.v1';

interface ActiveSessionValue {
  activeSession: RideSessionRow | null;
  setActiveSession: (session: RideSessionRow | null) => void;
  refreshActiveSession: () => Promise<void>;
}

const ActiveSessionContext = createContext<ActiveSessionValue | null>(null);

export function ActiveSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeSession, setActiveSessionState] =
    useState<RideSessionRow | null>(null);

  const setActiveSession = useCallback((session: RideSessionRow | null) => {
    setActiveSessionState(session);
    try {
      if (session) {
        globalThis.localStorage?.setItem(STORAGE_KEY, session.session_id);
      } else {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
      }
    } catch {
      // Persistence is best effort.
    }
  }, []);

  const refreshActiveSession = useCallback(async () => {
    const current = activeSession;
    if (!current || !isSupabaseConfigured) return;
    const fresh = await fetchSession(current.session_id);
    if (!fresh || fresh.status === 'completed' || fresh.status === 'cancelled') {
      setActiveSession(null);
    } else {
      setActiveSessionState(fresh);
    }
  }, [activeSession, setActiveSession]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      let storedId: string | null = null;
      try {
        storedId = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
      } catch {
        storedId = null;
      }
      if (!storedId) return;
      const row = await fetchSession(storedId);
      if (cancelled) return;
      if (!row || row.status === 'completed' || row.status === 'cancelled') {
        setActiveSession(null);
      } else {
        setActiveSessionState(row);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setActiveSession]);

  const value = useMemo<ActiveSessionValue>(
    () => ({ activeSession, setActiveSession, refreshActiveSession }),
    [activeSession, setActiveSession, refreshActiveSession]
  );

  return (
    <ActiveSessionContext.Provider value={value}>
      {children}
    </ActiveSessionContext.Provider>
  );
}

export function useActiveSession(): ActiveSessionValue {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) {
    throw new Error('useActiveSession must be used inside ActiveSessionProvider');
  }
  return ctx;
}
