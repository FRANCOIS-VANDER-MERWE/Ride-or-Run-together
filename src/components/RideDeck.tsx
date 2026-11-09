/**
 * Ride: the home tab. A quiet dashboard built only from real data:
 * the active pack session, its riders, and what the pack is playing.
 * No simulated telemetry anywhere; if there is no active session the
 * tab says so and points at the Pack tab.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Music2, Users } from 'lucide-react-native';
import { useActiveSession } from '../session/ActiveSessionContext';
import { fetchParticipants } from '../services/sessionsService';
import {
  fetchPlaybackState,
  fetchSessionQueueWithTracks,
  type QueueEntry,
} from '../services/musicDataService';
import {
  subscribeToTableChanges,
  supabase,
} from '../services/supabaseClient';
import type { SessionPlaybackStateRow } from '../services/database.types';

export type ShellTab = 'ride' | 'pack' | 'music';

export default function RideDeck({
  onNavigate,
}: {
  onNavigate: (tab: ShellTab) => void;
}) {
  const { activeSession } = useActiveSession();
  const sessionId = activeSession?.session_id ?? null;
  const [riderCount, setRiderCount] = useState<number | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [nowPlaying, setNowPlaying] = useState<QueueEntry | null>(null);
  const [playback, setPlayback] =
    useState<SessionPlaybackStateRow | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [riders, entries, state] = await Promise.all([
        fetchParticipants(sessionId),
        fetchSessionQueueWithTracks(sessionId),
        fetchPlaybackState(sessionId),
      ]);
      setRiderCount(riders.filter((r) => r.status !== 'left').length);
      setQueueCount(entries.filter((e) => e.item.status === 'queued').length);
      setPlayback(state);
      setNowPlaying(
        entries.find((e) => e.item.queue_item_id === state?.current_item_id) ??
          null
      );
    } catch {
      // The dashboard is best effort; Pack holds the detailed errors.
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    if (!sessionId) return;
    const ch = subscribeToTableChanges('session_playback_state', {
      sessionId,
      onChange: () => void refresh(),
    });
    return () => {
      if (ch && supabase) void supabase.removeChannel(ch);
    };
  }, [sessionId, refresh]);

  return (
    <ScrollView className="flex-1 bg-ink px-5 pt-6">
      <Text className="font-mono text-[11px] tracking-[2px] text-muted">
        TODAY
      </Text>
      {activeSession ? (
        <>
          <View className="mt-3 rounded-2xl border border-line bg-panel p-5">
            <Text className="text-[22px] font-semibold text-fog">
              {activeSession.title}
            </Text>
            <Text className="mt-1 font-mono text-[12px] text-muted">
              {activeSession.status} · {activeSession.visibility}
              {riderCount !== null ? ` · ${riderCount} riders` : ''}
              {queueCount !== null ? ` · ${queueCount} queued` : ''}
            </Text>
            <View className="mt-4 flex-row gap-3">
              <Pressable
                className="flex-row items-center gap-2 rounded-xl bg-panel2 px-4 py-2.5"
                onPress={() => onNavigate('pack')}
              >
                <Users size={15} color="#34D399" />
                <Text className="text-[13px] font-medium text-fog">Pack</Text>
              </Pressable>
              <Pressable
                className="flex-row items-center gap-2 rounded-xl bg-panel2 px-4 py-2.5"
                onPress={() => onNavigate('music')}
              >
                <Music2 size={15} color="#34D399" />
                <Text className="text-[13px] font-medium text-fog">Music</Text>
              </Pressable>
            </View>
          </View>
          <View className="mt-4 rounded-2xl border border-line bg-panel p-5">
            <Text className="font-mono text-[11px] tracking-[2px] text-muted">
              NOW PLAYING
            </Text>
            <Text className="mt-2 text-[16px] text-fog">
              {nowPlaying
                ? `${nowPlaying.track?.title ?? 'Track'} · ${nowPlaying.track?.artist ?? ''}`
                : 'Nothing playing yet'}
            </Text>
            <Text className="mt-1 font-mono text-[12px] text-muted">
              {nowPlaying
                ? playback?.is_playing
                  ? 'playing for the pack'
                  : 'paused'
                : 'Queue a song in Music or Pack and it lands here.'}
            </Text>
          </View>
          <Text className="mt-4 px-1 font-mono text-[11px] leading-4 text-muted">
            Live location sharing lives in the Pack tab, inside your session.
          </Text>
        </>
      ) : (
        <View className="mt-3 rounded-2xl border border-line bg-panel p-5">
          <Text className="text-[18px] font-semibold text-fog">
            No active session
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-muted">
            Create a session or join one in the Pack tab. Once a session is
            active, its riders and music show up here.
          </Text>
          <Pressable
            className="mt-4 self-start rounded-xl bg-accent px-4 py-2.5"
            onPress={() => onNavigate('pack')}
          >
            <Text className="text-[13px] font-semibold text-ink">
              Open Pack
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
