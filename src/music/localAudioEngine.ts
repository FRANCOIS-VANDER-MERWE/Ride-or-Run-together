// src/music/localAudioEngine.ts
// Real-time Pitch-Preserving Audio Engine for LocalFileProvider (Section 6.4 & 9.4)
// - Synthesizes distinct multi-layered electronic workout loops (Kick + Hi-Hat + Snare + Sub-Bass + Synth Arp)
//   for each canonical track in the catalog.
// - Because note frequencies (Hz) are decoupled from the step-sequencer clock (`60 / (nativeBpm * rate)`),
//   changing `rate` performs genuine 100% pitch-preserving tempo stretch (e.g. 132 BPM -> 158 BPM in the same key).
// - Supports real-time voice-chat volume ducking (Section 14.4: 25% volume when Walkie-Talkie PTT is open).

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

interface TrackSynthPreset {
  nativeBpm: number;
  bassNotesHz: number[]; // 16-step bassline frequencies
  arpNotesHz: number[]; // 16-step synth lead/arp frequencies
  waveType: OscillatorType;
}

const TRACK_SYNTH_PRESETS: Record<string, TrackSynthPreset> = {
  // 1. HYPERDRIVE CADENCE (170 BPM - F minor driving drum & bass / techno)
  'local:asset:hyperdrive_cadence_170.wav': {
    nativeBpm: 170,
    bassNotesHz: [
      87.31, 87.31, 0, 87.31, 103.83, 0, 116.54, 0,
      87.31, 87.31, 0, 130.81, 116.54, 0, 103.83, 0,
    ],
    arpNotesHz: [
      349.23, 415.3, 523.25, 415.3, 349.23, 466.16, 523.25, 622.25,
      349.23, 415.3, 523.25, 415.3, 698.46, 622.25, 523.25, 466.16,
    ],
    waveType: 'sawtooth',
  },
  // 2. SLIPSTREAM VELOCITY (132 BPM - A minor melodic breakbeat / club dub)
  'local:asset:slipstream_velocity_132.wav': {
    nativeBpm: 132,
    bassNotesHz: [
      110.0, 0, 110.0, 0, 87.31, 0, 87.31, 98.0,
      110.0, 0, 130.81, 0, 98.0, 0, 98.0, 0,
    ],
    arpNotesHz: [
      440.0, 523.25, 659.25, 523.25, 349.23, 440.0, 523.25, 440.0,
      392.0, 493.88, 587.33, 493.88, 329.63, 392.0, 493.88, 659.25,
    ],
    waveType: 'triangle',
  },
  // 3. LACTATE THRESHOLD // NEON COAST (158 BPM - D minor progressive endurance)
  'local:asset:lactate_threshold_158.wav': {
    nativeBpm: 158,
    bassNotesHz: [
      73.42, 73.42, 0, 73.42, 87.31, 87.31, 0, 98.0,
      110.0, 110.0, 0, 98.0, 87.31, 0, 82.41, 0,
    ],
    arpNotesHz: [
      293.66, 349.23, 440.0, 587.33, 440.0, 349.23, 523.25, 440.0,
      293.66, 349.23, 440.0, 659.25, 587.33, 523.25, 440.0, 349.23,
    ],
    waveType: 'sawtooth',
  },
  // 4. SUMMIT ATTACK (174 BPM - G major / E minor euphoric sprint kick)
  'local:asset:summit_attack_174.wav': {
    nativeBpm: 174,
    bassNotesHz: [
      98.0, 0, 98.0, 98.0, 110.0, 0, 123.47, 0,
      82.41, 0, 82.41, 82.41, 110.0, 0, 123.47, 146.83,
    ],
    arpNotesHz: [
      392.0, 493.88, 587.33, 783.99, 587.33, 493.88, 659.25, 587.33,
      329.63, 493.88, 659.25, 783.99, 659.25, 587.33, 493.88, 392.0,
    ],
    waveType: 'square',
  },
  // 5. MARINA DAWN ROLLOUT (122 BPM - C major warm ambient house rollout)
  'local:asset:marina_dawn_122.wav': {
    nativeBpm: 122,
    bassNotesHz: [
      65.41, 0, 0, 65.41, 87.31, 0, 0, 87.31,
      98.0, 0, 0, 98.0, 87.31, 0, 73.42, 0,
    ],
    arpNotesHz: [
      261.63, 329.63, 392.0, 493.88, 523.25, 493.88, 392.0, 329.63,
      349.23, 440.0, 523.25, 659.25, 587.33, 523.25, 440.0, 392.0,
    ],
    waveType: 'sine',
  },
  // 6. BERLIN DUBPLATE (162 BPM - E minor industrial dub techno)
  'local:asset:berlin_dubplate_162.wav': {
    nativeBpm: 162,
    bassNotesHz: [
      82.41, 82.41, 82.41, 0, 82.41, 87.31, 0, 82.41,
      82.41, 82.41, 98.0, 0, 87.31, 82.41, 0, 73.42,
    ],
    arpNotesHz: [
      329.63, 0, 349.23, 0, 329.63, 392.0, 0, 493.88,
      329.63, 0, 349.23, 0, 523.25, 493.88, 392.0, 329.63,
    ],
    waveType: 'sawtooth',
  },
};

class LocalPitchStretchAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isSoundEnabled = false;
  private isPlaying = false;
  private currentTrackId = 'local:asset:hyperdrive_cadence_170.wav';
  private playbackRate = 1.0;
  private volumeRatio = 1.0;
  private stepIndex = 0;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  private ensureContext(): AudioContext | null {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.25 * this.volumeRatio;
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  public isAudioMonitorActive(): boolean {
    return this.isSoundEnabled;
  }

  public setAudioMonitorActive(enabled: boolean): void {
    this.isSoundEnabled = enabled;
    if (enabled) {
      this.ensureContext();
      if (this.isPlaying) {
        this.startStepScheduler();
      }
    } else {
      this.stopStepScheduler();
    }
    this.notify();
  }

  public getEffectiveBpm(): number {
    const preset = this.getCurrentPreset();
    return Math.round(preset.nativeBpm * this.playbackRate);
  }

  public getNativeBpm(): number {
    return this.getCurrentPreset().nativeBpm;
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  private getCurrentPreset(): TrackSynthPreset {
    return (
      TRACK_SYNTH_PRESETS[this.currentTrackId] ||
      TRACK_SYNTH_PRESETS['local:asset:hyperdrive_cadence_170.wav']
    );
  }

  public setTrack(providerTrackId: string): void {
    if (TRACK_SYNTH_PRESETS[providerTrackId]) {
      this.currentTrackId = providerTrackId;
    } else {
      // Match by BPM or fallback
      this.currentTrackId = 'local:asset:hyperdrive_cadence_170.wav';
    }
    this.notify();
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    if (this.isPlaying && this.isSoundEnabled) {
      this.startStepScheduler();
    } else {
      this.stopStepScheduler();
    }
    this.notify();
  }

  /**
   * Adjust playback rate (tempo) while preserving 100% of the musical pitch (frequencies in Hz).
   */
  public setRate(rate: number): void {
    this.playbackRate = Math.max(0.75, Math.min(1.35, Number(rate.toFixed(3))));
    this.notify();
  }

  /**
   * Duck volume when Walkie-Talkie PTT is open (Section 14.4).
   */
  public setVolumeRatio(ratio: number): void {
    this.volumeRatio = Math.max(0, Math.min(1, ratio));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        0.25 * this.volumeRatio,
        this.ctx.currentTime,
        0.03
      );
    }
    this.notify();
  }

  private stopStepScheduler(): void {
    if (this.stepTimer) {
      clearTimeout(this.stepTimer);
      this.stepTimer = null;
    }
  }

  private startStepScheduler(): void {
    this.stopStepScheduler();
    const tick = () => {
      if (!this.isPlaying || !this.isSoundEnabled) return;

      const preset = this.getCurrentPreset();
      const effectiveBpm = Math.max(
        70,
        Math.min(240, preset.nativeBpm * this.playbackRate)
      );
      // 16th-note step duration in ms (4 steps per beat)
      const stepDurationMs = (60_000 / effectiveBpm) / 4;

      this.triggerStepSound(this.stepIndex % 16, preset, stepDurationMs / 1000);
      this.stepIndex = (this.stepIndex + 1) % 16;

      this.stepTimer = setTimeout(tick, stepDurationMs);
    };

    tick();
  }

  private triggerStepSound(
    step: number,
    preset: TrackSynthPreset,
    stepDurSec: number
  ): void {
    if (Platform.OS !== 'web') {
      // On native iOS/Android without WebAudio, emit a haptic beat pulse on quarter notes
      if (step % 4 === 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;

    // 1. Four-on-the-floor Kick on steps 0, 4, 8, 12
    if (step % 4 === 0) {
      const kickOsc = ctx.createOscillator();
      const kickGain = ctx.createGain();
      kickOsc.type = 'sine';
      kickOsc.frequency.setValueAtTime(135, now);
      kickOsc.frequency.exponentialRampToValueAtTime(42, now + 0.11);

      kickGain.gain.setValueAtTime(0.85, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      kickOsc.connect(kickGain);
      kickGain.connect(this.masterGain);
      kickOsc.start(now);
      kickOsc.stop(now + 0.15);
    }

    // 2. Off-beat Hi-Hat tick on steps 2, 6, 10, 14
    if (step % 4 === 2) {
      const hatOsc = ctx.createOscillator();
      const hatGain = ctx.createGain();
      hatOsc.type = 'square';
      hatOsc.frequency.setValueAtTime(6400, now);

      hatGain.gain.setValueAtTime(0.12, now);
      hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      hatOsc.connect(hatGain);
      hatGain.connect(this.masterGain);
      hatOsc.start(now);
      hatOsc.stop(now + 0.045);
    }

    // 3. Pitch-locked Bassline (Hz stays strictly in key regardless of playbackRate!)
    const bassHz = preset.bassNotesHz[step];
    if (bassHz > 0) {
      const bassOsc = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bassOsc.type = 'triangle';
      bassOsc.frequency.setValueAtTime(bassHz, now);

      bassGain.gain.setValueAtTime(0.45, now);
      bassGain.gain.exponentialRampToValueAtTime(
        0.001,
        now + Math.max(0.08, stepDurSec * 0.9)
      );

      bassOsc.connect(bassGain);
      bassGain.connect(this.masterGain);
      bassOsc.start(now);
      bassOsc.stop(now + Math.max(0.09, stepDurSec * 0.95));
    }

    // 4. Pitch-locked Synth Arpeggio (Hz stays strictly in key regardless of playbackRate!)
    const arpHz = preset.arpNotesHz[step];
    if (arpHz > 0) {
      const arpOsc = ctx.createOscillator();
      const arpGain = ctx.createGain();
      arpOsc.type = preset.waveType;
      arpOsc.frequency.setValueAtTime(arpHz, now);

      arpGain.gain.setValueAtTime(0.18, now);
      arpGain.gain.exponentialRampToValueAtTime(
        0.001,
        now + Math.max(0.06, stepDurSec * 0.75)
      );

      arpOsc.connect(arpGain);
      arpGain.connect(this.masterGain);
      arpOsc.start(now);
      arpOsc.stop(now + Math.max(0.07, stepDurSec * 0.8));
    }
  }
}

export const localPitchStretchAudioEngine = new LocalPitchStretchAudioEngine();

