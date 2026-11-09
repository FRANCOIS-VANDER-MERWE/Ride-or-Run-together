/**
 * Decides what the user sees based on auth state:
 * - Supabase not configured: the app, unauthenticated (dev and demo).
 * - Restoring a session: a short splash.
 * - Password recovery in progress: the set-new-password form.
 * - No session: the sign-in screen.
 * - Session: the app.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from './AuthProvider';
import AuthScreen from './AuthScreen';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (!auth.configured) return <>{children}</>;

  if (auth.loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>PACELOCK</Text>
        <ActivityIndicator color="#D4FF00" />
      </View>
    );
  }

  if (auth.needsNewPassword) return <AuthScreen initialMode="newPassword" />;

  if (!auth.session) return <AuthScreen />;

  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#080B10',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  splashTitle: {
    color: '#E2E8F0',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
  },
});
