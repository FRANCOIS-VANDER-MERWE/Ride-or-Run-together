/**
 * Sign in, sign up, forgot password, and set-new-password screens.
 * One component, four modes, styled to match the PACELOCK shell
 * (near-black background, volt accent, mono micro-labels).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './AuthProvider';

export type AuthScreenMode = 'signin' | 'signup' | 'forgot' | 'newPassword';

const ACCENT = '#D4FF00';
const BG = '#080B10';
const CARD = '#0D1420';
const BORDER = '#1E293B';
const TEXT = '#E2E8F0';
const MUTED = '#94A3B8';
const DANGER = '#F87171';

export default function AuthScreen({
  initialMode = 'signin',
}: {
  initialMode?: AuthScreenMode;
}) {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthScreenMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (next: AuthScreenMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = () =>
    run(async () => {
      if (!email.trim() || !password) {
        throw new Error('Enter your email and password.');
      }
      await auth.signIn(email, password);
    });

  const handleSignUp = () =>
    run(async () => {
      if (username.trim().length < 3) {
        throw new Error('Pick a username of at least 3 characters.');
      }
      if (!email.trim() || password.length < 6) {
        throw new Error('Enter an email and a password of 6+ characters.');
      }
      const result = await auth.signUp(email, password, username);
      if (result.needsEmailConfirmation) {
        setInfo(
          'Account created. Check your email to confirm it, then sign in.'
        );
        setMode('signin');
      }
    });

  const handleForgot = () =>
    run(async () => {
      if (!email.trim()) throw new Error('Enter your account email.');
      await auth.sendPasswordReset(email);
      setInfo(
        'Password reset email sent. Open the link on this device to set a new password.'
      );
    });

  const handleNewPassword = () =>
    run(async () => {
      if (password.length < 6) {
        throw new Error('New password needs at least 6 characters.');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      await auth.setNewPassword(password);
    });

  const titles: Record<AuthScreenMode, string> = {
    signin: 'SIGN IN',
    signup: 'CREATE ACCOUNT',
    forgot: 'RESET PASSWORD',
    newPassword: 'SET NEW PASSWORD',
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandBlock}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoGlyph}>P</Text>
            </View>
            <Text style={styles.brandTitle}>PACELOCK</Text>
            <Text style={styles.brandSubtitle}>
              Ride or Run Together
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{titles[mode]}</Text>

            {mode === 'signup' && (
              <>
                <Text style={styles.label}>USERNAME</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="e.g. tillman"
                  placeholderTextColor={MUTED}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

            {mode !== 'newPassword' && (
              <>
                <Text style={styles.label}>EMAIL</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={MUTED}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </>
            )}

            {mode !== 'forgot' && (
              <>
                <Text style={styles.label}>
                  {mode === 'newPassword' ? 'NEW PASSWORD' : 'PASSWORD'}
                </Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={MUTED}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {mode === 'newPassword' && (
              <>
                <Text style={styles.label}>CONFIRM NEW PASSWORD</Text>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Repeat new password"
                  placeholderTextColor={MUTED}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}
            {info && <Text style={styles.infoText}>{info}</Text>}

            <Pressable
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={
                mode === 'signin'
                  ? handleSignIn
                  : mode === 'signup'
                    ? handleSignUp
                    : mode === 'forgot'
                      ? handleForgot
                      : handleNewPassword
              }
            >
              {busy ? (
                <ActivityIndicator color="#080B10" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === 'signin'
                    ? 'Sign In'
                    : mode === 'signup'
                      ? 'Create Account'
                      : mode === 'forgot'
                        ? 'Send Reset Email'
                        : 'Save New Password'}
                </Text>
              )}
            </Pressable>

            {mode === 'signin' && (
              <>
                <Pressable onPress={() => switchMode('forgot')}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </Pressable>
                <Pressable onPress={() => switchMode('signup')}>
                  <Text style={styles.linkText}>
                    New to PACELOCK? Create an account
                  </Text>
                </Pressable>
              </>
            )}
            {mode === 'signup' && (
              <Pressable onPress={() => switchMode('signin')}>
                <Text style={styles.linkText}>
                  Already have an account? Sign in
                </Text>
              </Pressable>
            )}
            {mode === 'forgot' && (
              <Pressable onPress={() => switchMode('signin')}>
                <Text style={styles.linkText}>Back to sign in</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 24,
  },
  brandBlock: { alignItems: 'center', gap: 6 },
  logoBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  logoGlyph: { fontSize: 26, fontWeight: '800', color: BG },
  brandTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2,
    color: TEXT,
  },
  brandSubtitle: { fontSize: 13, color: MUTED },
  card: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: ACCENT,
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: MUTED,
    marginTop: 8,
  },
  input: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: TEXT,
    fontSize: 15,
  },
  errorText: { color: DANGER, fontSize: 13, marginTop: 8 },
  infoText: { color: ACCENT, fontSize: 13, marginTop: 8 },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: BG, fontSize: 15, fontWeight: '800' },
  linkText: {
    color: MUTED,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    textDecorationLine: 'underline',
  },
});
