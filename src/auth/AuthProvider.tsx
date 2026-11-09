/**
 * Authentication state for the whole app, backed by Supabase Auth.
 *
 * Flows covered:
 * - Email and password sign-up (username stored in user metadata and
 *   copied into public.profiles by ensureProfile on first session).
 * - Email and password sign-in, with session persistence and token
 *   auto-refresh handled by the client in supabaseClient.ts.
 * - Sign-out.
 * - Password reset: sendPasswordReset emails a link that deep-links
 *   back into the app at pacelock://auth-callback. The provider
 *   listens for that URL, restores the recovery session, and flips
 *   needsNewPassword so the gate shows the set-new-password form.
 * - Email confirmation links use the same deep link and session
 *   restore path.
 *
 * When Supabase env vars are missing (isSupabaseConfigured is false),
 * the provider reports configured=false and the gate lets the app run
 * unauthenticated, which keeps Expo demos working without a backend.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { ensureProfile, fetchProfile } from '../services/profilesService';
import type { ProfileRow } from '../services/database.types';

export const AUTH_REDIRECT_URL = 'pacelock://auth-callback';

interface SignUpResult {
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  needsNewPassword: boolean;
  signUp: (
    email: string,
    password: string,
    username: string
  ) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function usernameSeedFor(user: User): string {
  const fromMeta = (user.user_metadata as { username?: string } | null)
    ?.username;
  if (fromMeta && fromMeta.trim()) return fromMeta.trim();
  const emailPrefix = user.email?.split('@')[0] ?? 'rider';
  return emailPrefix.replace(/[^a-zA-Z0-9_.-]/g, '') || 'rider';
}

/** Parses the fragment and query of a deep link into a param map. */
function parseLinkParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const collect = (part: string) => {
    for (const pair of part.split('&')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(
          pair.slice(idx + 1)
        );
      }
    }
  };
  const hashIdx = url.indexOf('#');
  if (hashIdx >= 0) collect(url.slice(hashIdx + 1));
  const qIdx = url.indexOf('?');
  if (qIdx >= 0 && (hashIdx < 0 || qIdx < hashIdx)) {
    collect(url.slice(qIdx + 1, hashIdx >= 0 ? hashIdx : undefined));
  }
  return params;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const ensuredForRef = useRef<string | null>(null);

  const syncProfile = useCallback(async (user: User | null) => {
    if (!user || !supabase) {
      setProfile(null);
      ensuredForRef.current = null;
      return;
    }
    try {
      if (ensuredForRef.current === user.id) {
        const existing = await fetchProfile(user.id);
        setProfile(existing);
        return;
      }
      const ensured = await ensureProfile(user.id, usernameSeedFor(user));
      ensuredForRef.current = user.id;
      setProfile(ensured);
    } catch (err) {
      console.warn('[Auth] profile sync failed:', err);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        await syncProfile(data.session?.user ?? null);
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        setSession(nextSession);
        if (event === 'PASSWORD_RECOVERY') setNeedsNewPassword(true);
        if (event === 'SIGNED_OUT') {
          setProfile(null);
          ensuredForRef.current = null;
          setNeedsNewPassword(false);
        }
        void syncProfile(nextSession?.user ?? null);
      }
    );
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [syncProfile]);

  // Deep links: email confirmation and password recovery land here.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const handleUrl = async (url: string | null) => {
      if (!url || !url.includes('auth-callback')) return;
      const params = parseLinkParams(url);
      const accessToken = params['access_token'];
      const refreshToken = params['refresh_token'];
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error && params['type'] === 'recovery') {
          setNeedsNewPassword(true);
        }
      }
    };
    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', (e) => void handleUrl(e.url));
    return () => sub.remove();
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      username: string
    ): Promise<SignUpResult> => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { username: username.trim() },
          emailRedirectTo: AUTH_REDIRECT_URL,
        },
      });
      if (error) throw new Error(error.message);
      // No session means the project requires email confirmation.
      return { needsEmailConfirmation: !data.session };
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: AUTH_REDIRECT_URL,
    });
    if (error) throw new Error(error.message);
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    setNeedsNewPassword(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    await syncProfile(session?.user ?? null);
  }, [session, syncProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      profile,
      needsNewPassword,
      signUp,
      signIn,
      signOut,
      sendPasswordReset,
      setNewPassword,
      refreshProfile,
    }),
    [
      loading,
      session,
      profile,
      needsNewPassword,
      signUp,
      signIn,
      signOut,
      sendPasswordReset,
      setNewPassword,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
