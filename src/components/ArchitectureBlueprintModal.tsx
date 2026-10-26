import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Database,
  Server,
  Smartphone,
  KeyRound,
  Code2,
  Layers,
  GitBranch,
  Radio,
  Music,
  MapPin,
  Copy,
  Check,
  CheckCircle2,
} from './Icons';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { walkieTalkieController } from '../services/liveKitVoiceService';

type BlueprintTab = 'overview' | 'database' | 'apis' | 'code';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export default function ArchitectureBlueprintView() {
  const [activeTab, setActiveTab] = useState<BlueprintTab>('overview');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard errors
    }
  };

  const liveKitStatus = walkieTalkieController.getStatus();

  const supabaseSchemaSql = `-- SUPABASE POSTGRES SCHEMA FOR PACELOCK (RUN & RIDE TOGETHER)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- Managed via Supabase Auth bcrypt
  avatar_url TEXT,
  spotify_credentials JSONB DEFAULT '{"access_token": null, "refresh_token": null, "expires_at": null}'::jsonb,
  friend_list UUID[] DEFAULT '{}',
  preferred_mode TEXT DEFAULT 'run' CHECK (preferred_mode IN ('run', 'ride')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  spotify_playlist_uri TEXT NOT NULL,
  target_bpm INT NOT NULL,
  activity_mode TEXT CHECK (activity_mode IN ('run', 'ride', 'both')),
  tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);`;

  const customBroadcastTranslatorCode = `// CUSTOM BROADCAST API -> CLIENT SPOTIFY API TRANSLATION (Expo + TypeScript + Supabase)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!);

// 1. Host broadcasts custom music sync packet to everyone in the active session
export async function broadcastMusicSyncSignal(sessionId: string, trackUri: string, positionMs: number) {
  const channel = supabase.channel(\`pack-session:\${sessionId}\`);
  await channel.send({
    type: 'broadcast',
    event: 'CUSTOM_SPOTIFY_SYNC',
    payload: {
      session_id: sessionId,
      spotify_track_uri: trackUri,
      position_ms: positionMs,
      sent_at_epoch_ms: Date.now(),
    },
  });
}

// 2. Each peer receives the custom broadcast signal and translates it into a local Spotify API call
export function subscribeAndTranslateToSpotify(sessionId: string, userSpotifyAccessToken: string) {
  return supabase
    .channel(\`pack-session:\${sessionId}\`)
    .on('broadcast', { event: 'CUSTOM_SPOTIFY_SYNC' }, async ({ payload }) => {
      const networkDriftMs = Math.max(0, Date.now() - payload.sent_at_epoch_ms);
      const compensatedPositionMs = payload.position_ms + networkDriftMs;

      await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT',
        headers: {
          Authorization: \`Bearer \${userSpotifyAccessToken}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [payload.spotify_track_uri],
          position_ms: compensatedPositionMs,
        }),
      });
    })
    .subscribe();
}`;

  const liveKitPttCode = `// LIVEKIT CLOUD WALKIE-TALKIE PUSH-TO-TALK (Expo React Native + LiveKit SDK)
import { Room } from 'livekit-client';

export class PackWalkieTalkieController {
  private room = new Room({ adaptiveStream: true, dynacast: true });

  async connectToPackRoom(livekitUrl: string, tokenFromFastApi: string) {
    await this.room.connect(livekitUrl, tokenFromFastApi);
    await this.room.localParticipant.setMicrophoneEnabled(false);
  }

  // Called onPressIn of the Walkie-Talkie Button
  async pushToTalkOpen(duckSpotifyVolume: (volPct: number) => Promise<void>) {
    await duckSpotifyVolume(25); // Duck music to 25% so voice cuts through clearly
    await this.room.localParticipant.setMicrophoneEnabled(true);
  }

  // Called onPressOut of the Walkie-Talkie Button
  async pushToTalkRelease(restoreSpotifyVolume: (volPct: number) => Promise<void>) {
    await this.room.localParticipant.setMicrophoneEnabled(false);
    await restoreSpotifyVolume(100);
  }
}`;

  return (
    <View style={styles.container}>
      {/* Top Sub-Navigation Banner */}
      <View style={styles.bannerCard}>
        <View style={styles.bannerTitleBlock}>
          <View style={styles.bannerBadgeRow}>
            <View style={styles.specBadge}>
              <Text style={styles.specBadgeText}>
                SYSTEM ARCHITECTURE &amp; TEAM SPEC
              </Text>
            </View>
            <Text style={styles.stackSubtitle}>
              Expo React Native · TypeScript · Supabase · FastAPI · LiveKit · Spotify
            </Text>
          </View>
          <Text style={styles.bannerTitle}>
            Run &amp; Ride Together — Complete Technical Blueprint
          </Text>
        </View>

        {/* Live Environment / Service SDK Readiness Strip */}
        <View style={styles.envStrip}>
          <View style={styles.envPill}>
            <CheckCircle2
              size={12}
              color={isSupabaseConfigured ? '#10B981' : '#D4FF00'}
            />
            <Text style={styles.envPillText}>
              Supabase SDK:{' '}
              {isSupabaseConfigured ? 'Connected' : 'Ready (.env fallback active)'}
            </Text>
          </View>
          <View style={styles.envPill}>
            <CheckCircle2 size={12} color="#FF4D2A" />
            <Text style={styles.envPillText}>
              LiveKit PTT: {liveKitStatus.serverRegion}
            </Text>
          </View>
        </View>

        {/* Sub-Tabs */}
        <View style={styles.tabsRow}>
          {(
            [
              { id: 'overview', label: 'Roles & Stack', icon: Layers },
              { id: 'database', label: 'Supabase Tables', icon: Database },
              { id: 'apis', label: 'API Mesh & Flows', icon: Server },
              { id: 'code', label: 'Code Snippets', icon: Code2 },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setActiveTab(t.id)}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
              >
                <Icon size={13} color={active ? '#080B10' : '#94A3B8'} />
                <Text
                  style={[
                    styles.tabBtnText,
                    active && styles.tabBtnTextActive,
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* TAB 1: ROLES, LANGUAGES, TOOLS & FEATURES BREAKDOWN */}
      {activeTab === 'overview' && (
        <View style={styles.sectionGrid}>
          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <GitBranch size={18} color="#D4FF00" />
              <Text style={styles.cardTitle}>
                Languages, Tools &amp; Software Stack
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#D4FF00' }]}>
                LANGUAGES &amp; CORE FRAMEWORKS
              </Text>
              <Text style={styles.subBoxBody}>
                • Expo + React Native (TypeScript) for cross-platform iOS, Android &amp; Web + iOS ActivityKit Live Activities{'\n'}
                • SQL / PostgreSQL in Supabase with Row Level Security (RLS){'\n'}
                • Python (FastAPI / RESTful API) for LiveKit token minting, Spotify OAuth refresh &amp; custom broadcast validation
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#00F0FF' }]}>
                DEVELOPER TOOLS &amp; WORKFLOW
              </Text>
              <Text style={styles.subBoxBody}>
                • Claude &amp; ChatGPT: AI pair-programming, API schema generation &amp; edge-case debugging{'\n'}
                • GitHub &amp; SourceTree: Git branch management, PR reviews, visual commit graph{'\n'}
                • RESTful API / FastAPI + Postman: Endpoint testing for custom Spotify broadcast signals
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#10B981' }]}>
                AUTHENTICATION (SUPABASE AUTH)
              </Text>
              <Text style={styles.subBoxBody}>
                • Email/Password + Spotify OAuth2 PKCE handshake stored securely in public.users.spotify_credentials with JWT session persistence via expo-sqlite/localStorage/install.
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <Smartphone size={18} color="#00F0FF" />
              <Text style={styles.cardTitle}>
                Role: Frontend Engineering (Expo + TS)
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#FFFFFF' }]}>
                1. APPLICATION SCREENS &amp; BOTTOM TABS
              </Text>
              <Text style={styles.subBoxBody}>
                • Cockpit Tab: Live Activity PFP Line + 2x2 Telemetry Stats + Quick PTT/Spotify Docks{'\n'}
                • Tactical Map Tab: Interactive SVG Route Map + Road Conditions + Hazard Pin Drawer{'\n'}
                • Walkie-Talkie PTT Tab: Tactile Hold-to-Talk Paddle + Hands-Free Latch + LiveKit Feed{'\n'}
                • Spotify Sync Tab: Synchronized Cadence Player + Custom Broadcast API Translator
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#FFFFFF' }]}>
                2. CONNECTING FRONT &amp; BACK END
              </Text>
              <Text style={styles.subBoxBody}>
                • Supabase Realtime Channels: Subscribes to 5Hz GPS coordinates &amp; custom music broadcast events{'\n'}
                • RESTful FastAPI Client: Requests short-lived LiveKit room tokens &amp; refreshes Spotify bearer tokens{'\n'}
                • Client-Side Spotify Translator: Listens for custom broadcast packets and calls PUT /v1/me/player/play
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <Database size={18} color="#1DB954" />
              <Text style={styles.cardTitle}>
                Role: Backend, Database &amp; 5 Core Features
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#1DB954' }]}>
                BUILDING DATABASE (SUPABASE)
              </Text>
              <Text style={styles.subBoxBody}>
                • Users Table: username, password, spotify_credentials, friend_list{'\n'}
                • Playlists Table: BPM-tagged run/ride playlists &amp; track URIs{'\n'}
                • Friends Table: Bidirectional friend graph &amp; online pack status
              </Text>
            </View>

            <View style={styles.subBox}>
              <Text style={[styles.subBoxHeading, { color: '#FF4D2A' }]}>
                5 CORE FEATURE MODULES
              </Text>
              <Text style={styles.subBoxBody}>
                • Map: expo-location 5Hz GPS + Google Maps road condition polyline &amp; draft tethers{'\n'}
                • Music: Custom Broadcast API -&gt; per-phone Spotify API translator{'\n'}
                • Walkie-Talkie: LiveKit Cloud push-to-talk call-to-call voice mesh{'\n'}
                • Conditions: Live road surface, grade %, wind &amp; traffic hazard pins{'\n'}
                • Stats: Real-time Speed (MPH/Pace), % Done, ETA &amp; Pack Gap
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* TAB 2: SUPABASE DATABASE TABLES EXPLORER */}
      {activeTab === 'database' && (
        <View style={styles.sectionGrid}>
          {[
            {
              title: 'TABLE 1 · public.users',
              tag: 'RLS ENABLED',
              color: '#D4FF00',
              cols: [
                ['id', 'UUID (PK · auth.users)', '#22D3EE'],
                ['username', 'TEXT UNIQUE NOT NULL', '#34D399'],
                ['password', 'TEXT (bcrypt hash)', '#FBBF24'],
                ['spotify_credentials', 'JSONB (OAuth tokens)', '#1DB954'],
                ['friend_list', 'UUID[] (Array of IDs)', '#C084FC'],
              ],
            },
            {
              title: 'TABLE 2 · public.playlists',
              tag: 'SPOTIFY URI SYNC',
              color: '#1DB954',
              cols: [
                ['id', 'UUID (PK)', '#22D3EE'],
                ['owner_id', 'UUID FK -> users.id', '#94A3B8'],
                ['spotify_playlist_uri', 'TEXT (spotify:playlist:...)', '#1DB954'],
                ['target_bpm', 'INT4 (e.g. 170 BPM)', '#D4FF00'],
                ['tracks', 'JSONB (Track Queue)', '#C084FC'],
              ],
            },
            {
              title: 'TABLE 3 · public.friends',
              tag: 'SOCIAL GRAPH',
              color: '#00F0FF',
              cols: [
                ['id', 'UUID (PK)', '#22D3EE'],
                ['user_id', 'UUID FK -> users.id', '#94A3B8'],
                ['friend_id', 'UUID FK -> users.id', '#94A3B8'],
                ['status', "'pending' | 'accepted'", '#34D399'],
                ['active_session_id', 'TEXT (Live Join Link)', '#D4FF00'],
              ],
            },
          ].map((tbl) => (
            <View key={tbl.title} style={styles.infoCard}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableTitle, { color: tbl.color }]}>
                  {tbl.title}
                </Text>
                <View style={styles.tableTag}>
                  <Text style={styles.tableTagText}>{tbl.tag}</Text>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                {tbl.cols.map(([colName, colType, typeColor]) => (
                  <View key={colName} style={styles.colRow}>
                    <Text style={styles.colName}>{colName}</Text>
                    <Text style={[styles.colType, { color: typeColor }]}>
                      {colType}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* TAB 3: API ARCHITECTURE & INTEGRATION FLOWS */}
      {activeTab === 'apis' && (
        <View style={styles.sectionGrid}>
          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <Music size={16} color="#1DB954" />
              <Text style={[styles.apiFlowTitle, { color: '#1DB954' }]}>
                1. Custom Broadcast API -&gt; Spotify API Translation
              </Text>
            </View>
            <Text style={styles.subBoxBody}>
              Instead of streaming heavy audio bytes over cellular, the host phone sends a lightweight Custom Broadcast Signal (track_uri, position_ms, server_epoch_ms) via our FastAPI/Supabase broadcast endpoint to all session members. Each peer phone’s Expo app translates that custom payload into an authenticated PUT https://api.spotify.com/v1/me/player/play request with network latency compensation.
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <Radio size={16} color="#FF4D2A" />
              <Text style={[styles.apiFlowTitle, { color: '#FF4D2A' }]}>
                2. LiveKit Cloud Call-to-Call Walkie-Talkie API
              </Text>
            </View>
            <Text style={styles.subBoxBody}>
              Every runner/rider joins a shared LiveKit Cloud WebRTC Room using live talk minutes minted by our backend API. Microphones stay muted by default so wind/breathing noise never pollutes the call. Holding the Push-To-Talk paddle enables the local Opus audio track, ducks everyone’s Spotify volume to 25%, and streams crystal-clear voice across all phones.
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <MapPin size={16} color="#00F0FF" />
              <Text style={[styles.apiFlowTitle, { color: '#00F0FF' }]}>
                3. Geolocation + Google Maps Road Conditions API
              </Text>
            </View>
            <Text style={styles.subBoxBody}>
              expo-location samples high-accuracy GPS (BestForNavigation) every 250ms, projects each athlete’s coordinates onto the route polyline to compute their exact 0–100% linear progress, and overlays Google Maps Directions/Roads API surface conditions alongside user-reported hazard pins.
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.cardHeaderRow}>
              <KeyRound size={16} color="#D4FF00" />
              <Text style={[styles.apiFlowTitle, { color: '#D4FF00' }]}>
                4. Live Activities PFP Progress Bar (iOS &amp; In-App)
              </Text>
            </View>
            <Text style={styles.subBoxBody}>
              Everyone’s PFP avatar is rendered on a unified 1D route line both at the top of the app cockpit and on the iOS Lock Screen / Dynamic Island via ActivityKit push updates, giving instant eyes-up awareness of pack order, road conditions ahead, expected finish time, and current speed.
            </Text>
          </View>
        </View>
      )}

      {/* TAB 4: COPYABLE PRODUCTION CODE SNIPPETS */}
      {activeTab === 'code' && (
        <View style={styles.sectionGrid}>
          {[
            {
              id: 'sql',
              title: 'Supabase SQL Schema (Users, Playlists, Friends)',
              code: supabaseSchemaSql,
            },
            {
              id: 'spotify',
              title: 'Custom Broadcast -> Spotify API Translator (TS)',
              code: customBroadcastTranslatorCode,
            },
            {
              id: 'livekit',
              title: 'LiveKit Cloud Push-To-Talk Controller (TS)',
              code: liveKitPttCode,
            },
          ].map((block) => (
            <View key={block.id} style={styles.infoCard}>
              <View style={styles.codeHeaderRow}>
                <Text style={styles.codeBlockTitle}>{block.title}</Text>
                <Pressable
                  onPress={() => handleCopy(block.id, block.code)}
                  style={styles.copyBtn}
                >
                  {copiedId === block.id ? (
                    <>
                      <Check size={12} color="#34D399" />
                      <Text style={[styles.copyBtnText, { color: '#34D399' }]}>
                        Copied
                      </Text>
                    </>
                  ) : (
                    <>
                      <Copy size={12} color="#FFFFFF" />
                      <Text style={styles.copyBtnText}>Copy</Text>
                    </>
                  )}
                </Pressable>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.codeBox}
              >
                <Text style={styles.codeText}>{block.code}</Text>
              </ScrollView>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  bannerCard: {
    backgroundColor: '#0E131D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    gap: 12,
  },
  bannerTitleBlock: {
    gap: 4,
  },
  bannerBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  specBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(212, 255, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(212, 255, 0, 0.35)',
  },
  specBadgeText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    color: '#D4FF00',
  },
  stackSubtitle: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#94A3B8',
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  envStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  envPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#080B10',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  envPillText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: '#080B10',
    padding: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#D4FF00',
  },
  tabBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  tabBtnTextActive: {
    color: '#080B10',
  },
  sectionGrid: {
    gap: 12,
  },
  infoCard: {
    backgroundColor: '#0E131D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  subBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  subBoxHeading: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  subBoxBody: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 18,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tableTitle: {
    fontSize: 12,
    fontFamily: MONO_FONT,
    fontWeight: '800',
  },
  tableTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tableTagText: {
    fontSize: 9,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
  },
  colRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#080B10',
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  colName: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  colType: {
    fontSize: 11,
    fontFamily: MONO_FONT,
  },
  apiFlowTitle: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    textTransform: 'uppercase',
    flex: 1,
  },
  codeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  codeBlockTitle: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#D4FF00',
    flex: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  copyBtnText: {
    fontSize: 10,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  codeBox: {
    backgroundColor: '#080B10',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    maxHeight: 260,
  },
  codeText: {
    fontSize: 10.5,
    fontFamily: MONO_FONT,
    color: '#CBD5E1',
    lineHeight: 16,
  },
});
