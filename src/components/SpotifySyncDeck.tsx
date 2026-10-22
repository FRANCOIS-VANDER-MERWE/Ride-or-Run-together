import React, { useState } from 'react';
import {
  Music2,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RefreshCw,
  Code2,
  CheckCircle2,
  Volume2,
  ArrowRight,
  Activity,
  Cpu,
} from 'lucide-react';
import {
  Athlete,
  BroadcastSignalEvent,
  SpotifyTrack,
} from '../data/sessionData';

interface SpotifySyncDeckProps {
  tracks: SpotifyTrack[];
  currentTrackIndex: number;
  isPlaying: boolean;
  progressSec: number;
  isVoiceDucked: boolean;
  athletes: Athlete[];
  broadcastLogs: BroadcastSignalEvent[];
  onTogglePlay: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSeekTrack: (newSec: number) => void;
  onForceResyncBroadcast: () => void;
  onSelectTrackIndex: (index: number) => void;
}

function formatTrackTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

export default function SpotifySyncDeck({
  tracks,
  currentTrackIndex,
  isPlaying,
  progressSec,
  isVoiceDucked,
  athletes,
  broadcastLogs,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onSeekTrack,
  onForceResyncBroadcast,
  onSelectTrackIndex,
}: SpotifySyncDeckProps) {
  const [showApiTranslator, setShowApiTranslator] = useState(true);
  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const latestSignal = broadcastLogs[0];

  const pctPlayed = Math.min(
    100,
    Math.max(0, (progressSec / currentTrack.durationSec) * 100)
  );

  return (
    <section className="bg-[#0E131D]/95 border border-white/10 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col justify-between">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1DB954]/15 border border-[#1DB954]/40 text-[#1DB954] flex items-center justify-center">
            <Music2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono-tech uppercase tracking-widest text-[#1DB954] font-bold">
                SPOTIFY PACK SYNC · CUSTOM BROADCAST API
              </span>
              <span className="px-1.5 py-0.5 rounded bg-[#1DB954]/15 border border-[#1DB954]/30 text-[10px] font-mono-tech text-[#1DB954]">
                {currentTrack.bpm} BPM LOCKED
              </span>
            </div>
            <h3 className="font-display font-bold text-sm sm:text-base text-white">
              Synchronized Cadence Music Stream
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onForceResyncBroadcast}
            className="px-2.5 py-1.5 rounded-xl bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/50 text-[11px] font-mono-tech font-bold text-[#1DB954] flex items-center gap-1.5 transition-all cursor-pointer"
            title="Emit custom broadcast signal to re-align all peers within 5ms"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Broadcast Sync</span>
          </button>

          <button
            onClick={() => setShowApiTranslator((v) => !v)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono-tech flex items-center gap-1.5 transition-all cursor-pointer ${
              showApiTranslator
                ? 'bg-[#D4FF00]/15 border-[#D4FF00]/50 text-[#D4FF00]'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>API Translator</span>
          </button>
        </div>
      </div>

      {/* Now Playing Card + Controls */}
      <div className="bg-[#080B10]/90 rounded-xl p-3.5 border border-white/10 mb-3.5">
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="w-16 h-16 rounded-xl object-cover border border-white/15 shadow-lg"
            />
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded bg-[#1DB954] text-[#080B10] font-mono-tech font-bold text-[9px]">
              {currentTrack.bpm} BPM
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display font-bold text-sm text-white truncate">
                {currentTrack.title}
              </h4>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono-tech font-bold flex items-center gap-1 shrink-0 ${
                  isVoiceDucked
                    ? 'bg-[#FF4D2A]/20 text-[#FF4D2A] border border-[#FF4D2A]/40'
                    : 'bg-white/10 text-slate-300'
                }`}
              >
                <Volume2 className="w-3 h-3" />
                {isVoiceDucked ? 'DUCKED 25% (PTT)' : 'VOL 100%'}
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {currentTrack.artist} · <span className="text-slate-500">{currentTrack.album}</span>
            </p>

            {/* Interactive Scrubber Bar (Seeking emits a custom broadcast signal!) */}
            <div className="mt-2.5">
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickRatio = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width)
                  );
                  onSeekTrack(Math.round(clickRatio * currentTrack.durationSec));
                }}
                className="relative h-2 w-full rounded-full bg-slate-800 cursor-pointer overflow-hidden group"
                title="Click to seek & broadcast new timestamp to all 5 phones"
              >
                <div
                  style={{ width: `${pctPlayed}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-[#1DB954] to-[#D4FF00] transition-all duration-200"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono-tech text-slate-400 mt-1">
                <span>{formatTrackTime(progressSec)}</span>
                <span className="text-[#1DB954]">
                  URI: {currentTrack.uri.slice(0, 26)}...
                </span>
                <span>{formatTrackTime(currentTrack.durationSec)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Playback Controls + Track Queue Selector */}
        <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevTrack}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-white transition-all cursor-pointer"
              title="Previous Track (Broadcasts to Pack)"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={onTogglePlay}
              className="px-4 py-2 rounded-xl bg-[#1DB954] hover:bg-[#22d45f] text-[#080B10] font-mono-tech font-bold text-xs uppercase flex items-center gap-1.5 shadow-[0_0_15px_rgba(29,185,84,0.4)] transition-all cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>Pause Pack</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Sync Play</span>
                </>
              )}
            </button>
            <button
              onClick={onNextTrack}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-white transition-all cursor-pointer"
              title="Next Track (Broadcasts to Pack)"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Track Pills */}
          <div className="flex items-center gap-1">
            {tracks.map((t, idx) => (
              <button
                key={t.id}
                onClick={() => onSelectTrackIndex(idx)}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono-tech border transition-all cursor-pointer ${
                  idx === currentTrackIndex
                    ? 'bg-[#1DB954]/20 border-[#1DB954] text-[#1DB954] font-bold'
                    : 'bg-black/40 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {t.bpm} BPM
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Per-User Drift Status Row */}
      <div className="flex items-center justify-between gap-1.5 mb-3 overflow-x-auto pb-1">
        {athletes.map((ath) => (
          <div
            key={ath.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#080B10]/70 border border-white/10 shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#1DB954]" />
            <span className="text-[10px] font-medium text-slate-300">
              {ath.isSelf ? 'You' : ath.name.split(' ')[0]}
            </span>
            <span className="text-[10px] font-mono-tech text-[#1DB954]">
              {ath.isSelf ? 'HOST' : `+${ath.spotifyDriftMs}ms`}
            </span>
          </div>
        ))}
      </div>

      {/* CUSTOM API BROADCAST -> CLIENT SPOTIFY API TRANSLATOR INSPECTOR */}
      {showApiTranslator && latestSignal && (
        <div className="bg-[#080B10] rounded-xl p-3 border border-[#D4FF00]/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono-tech uppercase tracking-wider text-[#D4FF00] font-bold flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              Custom Broadcast Signal -&gt; Client Spotify API Translation
            </span>
            <span className="text-[10px] font-mono-tech text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {latestSignal.peersTranslated}/5 Peers Translated ({latestSignal.avgDriftMs}ms drift)
            </span>
          </div>

          {/* 3-Step Visual Pipeline */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono-tech">
            <div className="p-2 rounded-lg bg-[#111726] border border-white/10">
              <div className="text-[#D4FF00] font-bold mb-0.5">
                1. CUSTOM APP BROADCAST
              </div>
              <div className="text-slate-300 truncate">
                {latestSignal.customEndpoint}
              </div>
              <div className="text-slate-400 mt-1">
                action: <span className="text-white">{latestSignal.action}</span>
              </div>
              <div className="text-slate-400">
                pos_ms:{' '}
                <span className="text-white">
                  {latestSignal.customPayload.position_ms}
                </span>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-[#111726] border border-white/10 flex flex-col justify-between">
              <div className="text-[#00F0FF] font-bold flex items-center justify-between">
                <span>2. SUPABASE REALTIME</span>
                <ArrowRight className="w-3 h-3" />
              </div>
              <div className="text-slate-300">
                Channel: <span className="text-white">session:sf-884</span>
              </div>
              <div className="text-slate-400">
                Each phone receives broadcast &amp; adds RTT offset (+12ms)
              </div>
            </div>

            <div className="p-2 rounded-lg bg-[#111726] border border-[#1DB954]/40">
              <div className="text-[#1DB954] font-bold mb-0.5">
                3. PEER SPOTIFY API CALL
              </div>
              <div className="text-slate-300 truncate">
                {latestSignal.clientSpotifyEndpoint}
              </div>
              <div className="text-slate-400 mt-1 truncate">
                uri: <span className="text-white">{latestSignal.clientSpotifyBody.uris[0]}</span>
              </div>
              <div className="text-slate-400">
                seek_ms:{' '}
                <span className="text-[#1DB954] font-bold">
                  {latestSignal.clientSpotifyBody.position_ms}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer status */}
      <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px] font-mono-tech text-slate-400">
        <span className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#1DB954]" />
          Spotify OAuth Tokens via Supabase `users` table
        </span>
        <span>Last signal: {latestSignal?.timestamp}</span>
      </div>
    </section>
  );
}
