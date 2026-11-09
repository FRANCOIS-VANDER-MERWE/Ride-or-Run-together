/**
 * PACELOCK shell. Three tabs, all backed by real data:
 * Ride (active session dashboard), Pack (sessions, friends, live
 * location, shared queue), Music (Apple Music player that publishes
 * to the pack). Auth wraps everything; without a session the gate
 * shows the sign-in screen.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Flag, Music2, Users } from 'lucide-react-native';
import { AuthProvider } from './auth/AuthProvider';
import AuthGate from './auth/AuthGate';
import AccountButton from './auth/AccountButton';
import { ActiveSessionProvider } from './session/ActiveSessionContext';
import PackDeck from './components/PackDeck';
import RideDeck, { type ShellTab } from './components/RideDeck';
import MusicSyncDeck from './components/MusicSyncDeck';

const TABS: { id: ShellTab; label: string; Icon: typeof Flag }[] = [
  { id: 'ride', label: 'Ride', Icon: Flag },
  { id: 'pack', label: 'Pack', Icon: Users },
  { id: 'music', label: 'Music', Icon: Music2 },
];

function Shell() {
  const [activeTab, setActiveTab] = useState<ShellTab>('ride');
  return (
    <SafeAreaView className="flex-1 bg-ink">
      <StatusBar style="light" />
      <View className="flex-row items-center justify-between border-b border-line px-5 py-3.5">
        <Text className="text-[17px] font-bold tracking-[3px] text-fog">
          PACELOCK
        </Text>
        <AccountButton />
      </View>
      <View className="flex-1">
        {activeTab === 'ride' && <RideDeck onNavigate={setActiveTab} />}
        {activeTab === 'pack' && <PackDeck />}
        {activeTab === 'music' && <MusicSyncDeck />}
      </View>
      <View className="flex-row border-t border-line bg-panel">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <Pressable
              key={id}
              className="flex-1 items-center py-3"
              onPress={() => setActiveTab(id)}
            >
              <Icon size={20} color={active ? '#34D399' : '#8A93A6'} />
              <Text
                className={`mt-1 font-mono text-[11px] ${active ? 'text-accent' : 'text-muted'}`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ActiveSessionProvider>
          <AuthGate>
            <Shell />
          </AuthGate>
        </ActiveSessionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
