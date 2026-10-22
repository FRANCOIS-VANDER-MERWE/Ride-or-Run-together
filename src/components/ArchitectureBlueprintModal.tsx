import React, { useState } from 'react';
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
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';

type BlueprintTab = 'overview' | 'database' | 'apis' | 'code';

export default function ArchitectureBlueprintView() {
  const [activeTab, setActiveTab] = useState<BlueprintTab>('overview');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

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

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_KEY!);

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
      // Calculate network transit drift so all runners/riders hear the exact same beat
      const networkDriftMs = Math.max(0, Date.now() - payload.sent_at_epoch_ms);
      const compensatedPositionMs = payload.position_ms + networkDriftMs;

      // Translate custom signal -> Official Spotify Web API Player endpoint
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
import { Room, RoomEvent } from 'livekit-client';

export class PackWalkieTalkieController {
  private room: Room;

  constructor() {
    this.room = new Room({ adaptiveStream: true, dynacast: true });
  }

  async connectToPackRoom(livekitUrl: string, tokenFromFastApi: string) {
    await this.room.connect(livekitUrl, tokenFromFastApi);
    // Start with mic muted until user holds the Push-To-Talk button on phone
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
    <div className="space-y-5">
      {/* Top Sub-Navigation Banner */}
      <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#D4FF00]/15 text-[#D4FF00] border border-[#D4FF00]/30 text-[11px] font-mono-tech font-bold uppercase">
              SYSTEM ARCHITECTURE &amp; TEAM SPEC
            </span>
            <span className="text-xs font-mono-tech text-slate-400">
              Expo React Native · TypeScript · Supabase · FastAPI · LiveKit · Spotify
            </span>
          </div>
          <h2 className="font-display font-bold text-lg sm:text-xl text-white mt-1">
            Run &amp; Ride Together — Complete Technical Blueprint
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-[#080B10] p-1.5 rounded-xl border border-white/10">
          {(
            [
              { id: 'overview', label: 'Roles & Stack', icon: Layers },
              { id: 'database', label: 'Supabase Tables', icon: Database },
              { id: 'apis', label: 'API Mesh & Flows', icon: Server },
              { id: 'code', label: 'Implementation Code', icon: Code2 },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono-tech uppercase font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-[#D4FF00] text-[#080B10]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: ROLES, LANGUAGES, TOOLS & FEATURES BREAKDOWN */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Languages, Tools & Software Card */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <GitBranch className="w-5 h-5 text-[#D4FF00]" />
              <h3 className="font-display font-bold text-base text-white">
                Languages, Tools &amp; Software Stack
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-[#D4FF00] font-bold mb-1">
                  Languages &amp; Core Frameworks
                </div>
                <p className="text-slate-300 leading-relaxed">
                  • <strong>Expo + React Native (TypeScript)</strong> for cross-platform iOS &amp; Android app + iOS ActivityKit Live Activities
                  <br />• <strong>SQL / PostgreSQL</strong> in Supabase with Row Level Security (RLS)
                  <br />• <strong>Python (FastAPI / RESTful API)</strong> for LiveKit token minting, Spotify OAuth refresh, and custom broadcast validation
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-[#00F0FF] font-bold mb-1">
                  Developer Tools &amp; Workflow
                </div>
                <p className="text-slate-300 leading-relaxed">
                  • <strong>Claude &amp; ChatGPT</strong>: AI pair-programming, API schema generation, &amp; edge-case debugging
                  <br />• <strong>GitHub &amp; SourceTree</strong>: Git branch management, PR reviews, visual commit graph
                  <br />• <strong>RESTful API / FastAPI + Postman</strong>: Endpoint testing for custom Spotify broadcast signals
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-emerald-400 font-bold mb-1">
                  Authentication (Supabase Auth)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  • Email/Password + Spotify OAuth2 PKCE handshake stored securely in <code>public.users.spotify_credentials</code> with JWT session persistence via <code>@react-native-async-storage/async-storage</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Frontend Role & Screens Card */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Smartphone className="w-5 h-5 text-[#00F0FF]" />
              <h3 className="font-display font-bold text-base text-white">
                Role: Frontend Engineering (Expo + TS)
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-white font-bold mb-1">
                  1. Application Screens
                </div>
                <ul className="space-y-1 text-slate-300">
                  <li>• <strong>Auth &amp; Spotify Link Screen</strong>: Supabase login + Spotify OAuth connect</li>
                  <li>• <strong>Lobby &amp; Pack Squad Screen</strong>: Invite friends from <code>friends</code> table, choose Run or Ride mode &amp; route</li>
                  <li>• <strong>Live Cockpit Screen</strong>: Vector Google Map + Top Linear Progress Line + PTT Paddle + Spotify Deck</li>
                  <li>• <strong>iOS Lock Screen Live Activity</strong>: PFP avatars on linear route bar via <code>expo-live-activities</code></li>
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-white font-bold mb-1">
                  2. Connecting Front &amp; Back End
                </div>
                <ul className="space-y-1 text-slate-300">
                  <li>• <strong>Supabase Realtime Channels</strong>: Subscribes to 5Hz GPS coordinates &amp; custom music broadcast events</li>
                  <li>• <strong>RESTful FastAPI Client</strong>: Requests short-lived LiveKit room tokens &amp; refreshes Spotify bearer tokens</li>
                  <li>• <strong>Client-Side Spotify Translator</strong>: Listens for custom broadcast packets and calls <code>PUT /v1/me/player/play</code></li>
                </ul>
              </div>
            </div>
          </div>

          {/* Backend Role & Features Matrix Card */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-[#1DB954]" />
              <h3 className="font-display font-bold text-base text-white">
                Role: Backend, Database &amp; Features
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-[#1DB954] font-bold mb-1">
                  Building Database (Supabase)
                </div>
                <ul className="space-y-1 text-slate-300">
                  <li>• <strong>Users Table</strong>: <code>username</code>, <code>password</code>, <code>spotify_credentials</code>, <code>friend_list</code></li>
                  <li>• <strong>Playlists Table</strong>: BPM-tagged run/ride playlists &amp; track URIs</li>
                  <li>• <strong>Friends Table</strong>: Bidirectional friend graph &amp; online pack status</li>
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-[#080B10] border border-white/10">
                <div className="font-mono-tech uppercase text-[#FF4D2A] font-bold mb-1">
                  5 Core Feature Modules
                </div>
                <ul className="space-y-1 text-slate-300">
                  <li>• <strong>Map</strong>: Google Maps SDK + Geolocation 5Hz polyline &amp; pack tethers</li>
                  <li>• <strong>Music</strong>: Custom Broadcast API -&gt; per-phone Spotify API translator</li>
                  <li>• <strong>Walkie-Talkie</strong>: LiveKit Cloud push-to-talk call-to-call voice mesh</li>
                  <li>• <strong>Conditions</strong>: Live road surface, grade %, wind &amp; traffic hazard pins</li>
                  <li>• <strong>Stats</strong>: Real-time Speed (MPH/Pace), % Done, ETA &amp; Pack Gap</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SUPABASE DATABASE TABLES EXPLORER */}
      {activeTab === 'database' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Table 1: Users Table */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono-tech text-xs font-bold text-[#D4FF00] uppercase">
                TABLE 1 · public.users
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono-tech text-slate-300">
                RLS ENABLED
              </span>
            </div>
            <div className="space-y-2 text-xs font-mono-tech">
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">id</span>
                <span className="text-cyan-400">UUID (PK · auth.users)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">username</span>
                <span className="text-emerald-400">TEXT UNIQUE NOT NULL</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">password</span>
                <span className="text-amber-400">TEXT (bcrypt hash)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-[#1DB954]/40 flex justify-between">
                <span className="text-[#1DB954] font-bold">spotify_credentials</span>
                <span className="text-[#1DB954]">JSONB (OAuth tokens)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">friend_list</span>
                <span className="text-purple-400">UUID[] (Array of IDs)</span>
              </div>
            </div>
          </div>

          {/* Table 2: Playlists Table */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono-tech text-xs font-bold text-[#1DB954] uppercase">
                TABLE 2 · public.playlists
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono-tech text-slate-300">
                SPOTIFY URI SYNC
              </span>
            </div>
            <div className="space-y-2 text-xs font-mono-tech">
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">id</span>
                <span className="text-cyan-400">UUID (PK)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">owner_id</span>
                <span className="text-slate-400">UUID FK -&gt; users.id</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">spotify_playlist_uri</span>
                <span className="text-[#1DB954]">TEXT (spotify:playlist:...)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">target_bpm</span>
                <span className="text-[#D4FF00]">INT4 (e.g. 170 BPM)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">tracks</span>
                <span className="text-purple-400">JSONB (Track Queue)</span>
              </div>
            </div>
          </div>

          {/* Table 3: Friends Table */}
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono-tech text-xs font-bold text-[#00F0FF] uppercase">
                TABLE 3 · public.friends
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono-tech text-slate-300">
                SOCIAL GRAPH
              </span>
            </div>
            <div className="space-y-2 text-xs font-mono-tech">
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">id</span>
                <span className="text-cyan-400">UUID (PK)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">user_id</span>
                <span className="text-slate-400">UUID FK -&gt; users.id</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">friend_id</span>
                <span className="text-slate-400">UUID FK -&gt; users.id</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">status</span>
                <span className="text-emerald-400">'pending' | 'accepted'</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#080B10] border border-white/10 flex justify-between">
                <span className="text-white">active_session_id</span>
                <span className="text-[#D4FF00]">TEXT (Live Join Link)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: API ARCHITECTURE & INTEGRATION FLOWS */}
      {activeTab === 'apis' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#1DB954] font-mono-tech text-xs font-bold uppercase">
              <Music className="w-4 h-4" />
              1. Custom Broadcast API -&gt; Spotify API Translation
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Instead of relying on a single audio stream (which would consume heavy mobile bandwidth and violate DRM), the host app sends a lightweight <strong>Custom Broadcast Signal</strong> (<code>track_uri</code>, <code>position_ms</code>, <code>server_epoch_ms</code>) via our FastAPI/Supabase broadcast endpoint to all session members. Once the signal reaches each phone, that phone’s client translates the custom payload into an authenticated <code>PUT https://api.spotify.com/v1/me/player/play</code> call with network latency compensation.
            </p>
          </div>

          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#FF4D2A] font-mono-tech text-xs font-bold uppercase">
              <Radio className="w-4 h-4" />
              2. LiveKit Cloud Call-to-Call Walkie-Talkie API
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Every runner/rider joins a shared <strong>LiveKit Cloud WebRTC Room</strong> using live talk minutes minted by our backend API. Microphones remain muted by default so wind/breathing noise never pollutes the call. Holding the <strong>Push-To-Talk button</strong> enables the local Opus audio track (`setMicrophoneEnabled(true)`), sends a metadata signal that ducks everyone’s Spotify volume to 25%, and streams crystal-clear voice across all phones.
            </p>
          </div>

          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#00F0FF] font-mono-tech text-xs font-bold uppercase">
              <MapPin className="w-4 h-4" />
              3. Geolocation + Google Maps Road Conditions API
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              <code>expo-location</code> samples high-accuracy GPS (`BestForNavigation`) every 200ms, projects each athlete’s coordinates onto the route polyline to compute their exact <strong>0–100% linear progress</strong>, and overlays Google Maps Directions/Roads API traffic &amp; surface conditions alongside user-reported hazard pins.
            </p>
          </div>

          <div className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#D4FF00] font-mono-tech text-xs font-bold uppercase">
              <KeyRound className="w-4 h-4" />
              4. Live Activities PFP Progress Bar (iOS &amp; In-App)
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Everyone’s PFP avatar is rendered on a unified 1D route line both at the top of the app cockpit and on the iOS Lock Screen / Dynamic Island via ActivityKit push updates, giving instant eyes-up awareness of pack order, road conditions ahead, expected finish time, and current speed.
            </p>
          </div>
        </div>
      )}

      {/* TAB 4: COPYABLE PRODUCTION CODE SNIPPETS */}
      {activeTab === 'code' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
            <div
              key={block.id}
              className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-xs font-mono-tech font-bold text-[#D4FF00]">
                  {block.title}
                </span>
                <button
                  onClick={() => handleCopy(block.id, block.code)}
                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-mono-tech text-white flex items-center gap-1 cursor-pointer"
                >
                  {copiedId === block.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-[#080B10] border border-white/10 rounded-xl p-3 text-[10.5px] font-mono-tech text-slate-300 overflow-x-auto leading-relaxed max-h-80">
                <code>{block.code}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
