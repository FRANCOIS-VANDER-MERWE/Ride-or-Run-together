/**
 * Decides what the user sees based on auth state:
 * - Supabase not configured: the app, unauthenticated (dev and demo).
 * - Restoring a session: a short splash.
 * - Password recovery in progress: the set-new-password form.
 * - No session: the sign-in screen.
 * - Session: the app.
 */
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from './AuthProvider';
import AuthScreen from './AuthScreen';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (!auth.configured) return <>{children}</>;

  if (auth.loading) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-ink">
        <Text className="text-[22px] font-extrabold tracking-[2px] text-fog">PACELOCK</Text>
        <ActivityIndicator color="#D4FF00" />
      </View>
    );
  }

  if (auth.needsNewPassword) return <AuthScreen initialMode="newPassword" />;

  if (!auth.session) return <AuthScreen />;

  return <>{children}</>;
}

