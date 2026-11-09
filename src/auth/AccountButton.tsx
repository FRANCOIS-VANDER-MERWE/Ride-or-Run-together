/**
 * Compact account control for the app header: shows the signed-in
 * username and signs out after a confirmation. Renders nothing when
 * Supabase is not configured or there is no session.
 */
import React from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { useAuth } from './AuthProvider';

export default function AccountButton() {
  const auth = useAuth();
  if (!auth.configured || !auth.session) return null;
  const label = auth.profile?.username ?? auth.user?.email ?? 'Account';

  const confirmSignOut = () => {
    Alert.alert('Sign out', `Signed in as ${label}. Sign out?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => void auth.signOut(),
      },
    ]);
  };

  return (
    <Pressable onPress={confirmSignOut} className="max-w-[140px] rounded-full border border-line px-2.5 py-[5px]">
      <Text className="text-[12px] font-bold text-[#D4FF00]" numberOfLines={1}>
        @{label.replace(/^@/, '')}
      </Text>
    </Pressable>
  );
}

