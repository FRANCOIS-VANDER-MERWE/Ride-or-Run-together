import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
  Waves,
  Sparkles,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Athlete, VoiceTransmission } from '../data/sessionData';

interface WalkieTalkiePTTDeckProps {
  isPttActive: boolean;
  isLatched: boolean;
  onStartPtt: () => void;
  onStopPtt: () => void;
  onToggleLatch: () => void;
  activeSpeakerId: string | null;
  athletes: Athlete[];
  voiceFeed: VoiceTransmission[];
  onSendQuickCallout: (text: string) => void;
  onTriggerTeammateCallout: () => void;
  soundEffectsEnabled: boolean;
  onToggleSoundEffects: () => void;
}

const QUICK_VOICE_CALLOUTS = [
  'Pushing pace +0.5 mph for the next half mile — lock in!',
  'Caution ahead: wet patch on the right shoulder, stay left!',
  'Single file on the climb — car passing on the left!',
  'How is everyone feeling on this 170 BPM Spotify sync?',
];

export default function WalkieTalkiePTTDeck({
  isPttActive,
  isLatched,
  onStartPtt,
  onStopPtt,
  onToggleLatch,
  activeSpeakerId,
  athletes,
  voiceFeed,
  onSendQuickCallout,
  onTriggerTeammateCallout,
  soundEffectsEnabled,
  onToggleSoundEffects,
}: WalkieTalkiePTTDeckProps) {
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

  const activeSpeaker = athletes.find((a) => a.id === activeSpeakerId) || null;
  const isChannelOpen = Boolean(activeSpeakerId);

  return (
    <section
      className={`relative rounded-2xl border p-4 sm:p-5 transition-all duration-300 shadow-2xl flex flex-col justify-between ${
        isChannelOpen
          ? 'bg-gradient-to-b from-[#1F1215] to-[#0E131D] border-[#FF4D2A]/70 shadow-[0_0_35px_rgba(255,77,42,0.22)]'
          : 'bg-[#0E131D]/95 border-white/10'
      }`}
    >
      {/* Header: LiveKit Cloud Call-to-Call Mesh Status */}
      <div className="flex items-center justify-between gap-2 mb-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${
              isChannelOpen
                ? 'bg-[#FF4D2A] text-white border-[#FF4D2A] shadow-[0_0_15px_rgba(255,77,42,0.6)]'
                : 'bg-[#FF4D2A]/15 text-[#FF4D2A] border-[#FF4D2A]/35'
            }`}
          >
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono-tech uppercase tracking-widest text-[#FF4D2A] font-bold">
                WALKIE-TALKIE · LIVEKIT CLOUD
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-mono-tech text-emerald-300">
                5/5 WEBRTC MESH
              </span>
            </div>
            <h3 className="font-display font-bold text-sm sm:text-base text-white">
              Call-to-Call Pack Voice Channel
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Toggle PTT Chirp Sound */}
          <button
            onClick={onToggleSoundEffects}
            className={`p-2 rounded-xl border text-xs font-mono-tech transition-all cursor-pointer ${
              soundEffectsEnabled
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-black/40 border-white/10 text-slate-500'
            }`}
            title={
              soundEffectsEnabled
                ? 'Walkie-Talkie Chirp Tones: ON'
                : 'Walkie-Talkie Chirp Tones: MUTED'
            }
          >
            {soundEffectsEnabled ? (
              <Volume2 className="w-4 h-4 text-[#D4FF00]" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </button>

          {/* Simulate Incoming Teammate Radio Call */}
          <button
            onClick={onTriggerTeammateCallout}
            className="px-2.5 py-1.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/15 text-[11px] font-mono-tech text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Simulate a teammate pressing their PTT button over LiveKit Cloud"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>Demo Peer Call</span>
          </button>
        </div>
      </div>

      {/* Live Channel Status Banner + Audio Waveform Visualizer */}
      <div className="bg-[#080B10]/90 rounded-xl p-3 border border-white/10 mb-3.5">
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isChannelOpen
                  ? 'bg-[#FF4D2A] animate-ping'
                  : 'bg-emerald-400'
              }`}
            />
            <span className="font-mono-tech font-bold text-white uppercase">
              {isPttActive
                ? 'TRANSMITTING TO ALL 5 PHONES...'
                : activeSpeaker
                ? `RECEIVING: ${activeSpeaker.name.toUpperCase()}`
                : 'CHANNEL STANDBY · READY TO TALK'}
            </span>
          </div>
          <span className="text-[10px] font-mono-tech text-slate-400">
            {isChannelOpen ? 'SPOTIFY AUTO-DUCKED TO 25%' : 'OPUS 48KHZ · 18MS'}
          </span>
        </div>

        {/* 18-Bar Real-Time Voice Spectrum Visualizer */}
        <div className="h-9 flex items-center justify-between gap-1 px-1">
          {Array.from({ length: 20 }).map((_, idx) => {
            const activeHeight = isChannelOpen
              ? 28 + ((idx * 17) % 70)
              : 14 + ((idx * 7) % 12);
            return (
              <div
                key={idx}
                style={{
                  height: `${activeHeight}%`,
                  transitionDelay: `${idx * 15}ms`,
                }}
                className={`flex-1 rounded-full transition-all duration-150 ${
                  isPttActive
                    ? 'bg-gradient-to-t from-[#FF4D2A] to-[#D4FF00]'
                    : activeSpeaker
                    ? 'bg-gradient-to-t from-[#00F0FF] to-emerald-300'
                    : 'bg-slate-700/60'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* TACTILE HARDWARE PUSH-TO-TALK (PTT) PADDLE BUTTON */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 mb-3.5">
        <button
          type="button"
          onMouseDown={onStartPtt}
          onMouseUp={onStopPtt}
          onMouseLeave={() => {
            if (isPttActive && !isLatched) onStopPtt();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            onStartPtt();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onStopPtt();
          }}
          className={`sm:col-span-3 relative py-4 px-5 rounded-2xl font-display font-bold text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-3 transition-all select-none cursor-pointer border-2 ${
            isPttActive
              ? 'bg-[#FF4D2A] text-white border-white shadow-[0_0_30px_rgba(255,77,42,0.75)] scale-[0.99]'
              : 'bg-gradient-to-r from-[#FF4D2A]/90 to-[#FF6B2A]/90 hover:from-[#FF4D2A] hover:to-[#FF6B2A] text-white border-[#FF4D2A]/50 shadow-lg'
          }`}
        >
          {isPttActive ? (
            <>
              <Waves className="w-5 h-5 animate-pulse" />
              <span>VOICE OPEN TO EVERYONE · RELEASE TO END</span>
            </>
          ) : (
            <>
              <Mic className="w-5 h-5" />
              <span>HOLD TO TALK TO PACK [OR HOLD SPACE]</span>
            </>
          )}
        </button>

        {/* Hands-Free Latch Toggle for Runners/Cyclists */}
        <button
          type="button"
          onClick={onToggleLatch}
          className={`py-3 px-3 rounded-2xl border font-mono-tech text-xs font-bold uppercase flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
            isLatched
              ? 'bg-[#D4FF00] text-[#080B10] border-[#D4FF00] shadow-[0_0_20px_rgba(212,255,0,0.4)]'
              : 'bg-[#080B10] text-slate-300 border-white/15 hover:border-white/30'
          }`}
          title="Latch microphone open hands-free while running or riding"
        >
          {isLatched ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4 text-slate-400" />
          )}
          <span>{isLatched ? 'LATCHED ON' : 'HANDS-FREE'}</span>
        </button>
      </div>

      {/* Quick 1-Tap Voice Callout Preset Bar */}
      <div className="mb-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono-tech text-slate-400 mb-1.5">
          <span>QUICK VOICE CALLOUT (BROADCASTS ON RELEASE):</span>
          <span className="text-[#D4FF00]">LIVEKIT API CHANNEL</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedPresetIdx}
            onChange={(e) => setSelectedPresetIdx(Number(e.target.value))}
            className="flex-1 bg-[#080B10] border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-medium focus:outline-none focus:border-[#D4FF00]"
          >
            {QUICK_VOICE_CALLOUTS.map((msg, i) => (
              <option key={i} value={i}>
                "{msg}"
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSendQuickCallout(QUICK_VOICE_CALLOUTS[selectedPresetIdx])}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-mono-tech font-bold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5 text-[#FF4D2A]" />
            <span>Transmit</span>
          </button>
        </div>
      </div>

      {/* Recent Pack Voice Callouts Feed */}
      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
        {voiceFeed.slice(0, 3).map((vc) => (
          <div
            key={vc.id}
            className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#080B10]/75 border border-white/10"
          >
            <img
              src={vc.speakerAvatar}
              alt={vc.speakerName}
              style={{ borderColor: vc.speakerColor }}
              className="w-7 h-7 rounded-full object-cover border-2 shrink-0 mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  style={{ color: vc.speakerColor }}
                  className="text-xs font-bold truncate"
                >
                  {vc.speakerName}
                </span>
                <span className="text-[10px] font-mono-tech text-slate-400 shrink-0">
                  @{vc.progressAtCallPct.toFixed(0)}% · {vc.timestamp}
                </span>
              </div>
              <p className="text-xs text-slate-200 mt-0.5 leading-snug">
                "{vc.transcript}"
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer LiveKit Cloud API Pill */}
      <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px] font-mono-tech text-slate-400">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          LiveKit Cloud SF-West · Call-to-Call Minutes Active
        </span>
        <span className="flex items-center gap-1 text-slate-300">
          <Users className="w-3.5 h-3.5 text-[#00F0FF]" />5 Phones Connected
        </span>
      </div>
    </section>
  );
}
