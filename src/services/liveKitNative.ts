import type * as LiveKitClient from 'livekit-client';
import type { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';

export interface LiveKitModules {
  client: typeof LiveKitClient;
  AudioSession: typeof AudioSession;
  AndroidAudioTypePresets: typeof AndroidAudioTypePresets;
}

/**
 * Web build: the LiveKit React Native SDK depends on native WebRTC, so voice
 * stays simulated here. `liveKitNative.native.ts` is the iOS/Android version.
 */
export function loadLiveKit(): LiveKitModules | null {
  return null;
}
