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
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './AuthProvider';

export type AuthScreenMode = 'signin' | 'signup' | 'forgot' | 'newPassword';

const MUTED = '#94A3B8';

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
    <SafeAreaView className="flex-1 bg-ink" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="grow justify-center gap-6 p-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center gap-1.5">
            <View className="mb-1.5 h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[#D4FF00]">
              <Text className="text-[26px] font-extrabold text-ink">P</Text>
            </View>
            <Text className="text-[26px] font-extrabold tracking-[2px] text-fog">PACELOCK</Text>
            <Text className="text-[13px] text-muted">
              Ride or Run Together
            </Text>
          </View>

          <View className="gap-2 rounded-2xl border border-line bg-panel p-5">
            <Text className="mb-2 text-[13px] font-bold tracking-[1.5px] text-[#D4FF00]">{titles[mode]}</Text>

            {mode === 'signup' && (
              <>
                <Text className="mt-2 text-[11px] font-bold tracking-[1px] text-muted">USERNAME</Text>
                <TextInput
                  className="rounded-[10px] border border-line bg-ink px-3 py-[11px] text-[15px] text-fog"
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
                <Text className="mt-2 text-[11px] font-bold tracking-[1px] text-muted">EMAIL</Text>
                <TextInput
                  className="rounded-[10px] border border-line bg-ink px-3 py-[11px] text-[15px] text-fog"
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
                <Text className="mt-2 text-[11px] font-bold tracking-[1px] text-muted">
                  {mode === 'newPassword' ? 'NEW PASSWORD' : 'PASSWORD'}
                </Text>
                <TextInput
                  className="rounded-[10px] border border-line bg-ink px-3 py-[11px] text-[15px] text-fog"
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
                <Text className="mt-2 text-[11px] font-bold tracking-[1px] text-muted">CONFIRM NEW PASSWORD</Text>
                <TextInput
                  className="rounded-[10px] border border-line bg-ink px-3 py-[11px] text-[15px] text-fog"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Repeat new password"
                  placeholderTextColor={MUTED}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {error && <Text className="mt-2 text-[13px] text-danger">{error}</Text>}
            {info && <Text className="mt-2 text-[13px] text-[#D4FF00]">{info}</Text>}

            <Pressable
              className={`mt-4 items-center rounded-[10px] bg-[#D4FF00] py-[13px] ${busy ? 'opacity-60' : ''}`}
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
                <Text className="text-[15px] font-extrabold text-ink">
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
                  <Text className="mt-3 text-center text-[13px] text-muted underline">Forgot password?</Text>
                </Pressable>
                <Pressable onPress={() => switchMode('signup')}>
                  <Text className="mt-3 text-center text-[13px] text-muted underline">
                    New to PACELOCK? Create an account
                  </Text>
                </Pressable>
              </>
            )}
            {mode === 'signup' && (
              <Pressable onPress={() => switchMode('signin')}>
                <Text className="mt-3 text-center text-[13px] text-muted underline">
                  Already have an account? Sign in
                </Text>
              </Pressable>
            )}
            {mode === 'forgot' && (
              <Pressable onPress={() => switchMode('signin')}>
                <Text className="mt-3 text-center text-[13px] text-muted underline">Back to sign in</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

