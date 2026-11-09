import { NativeModules } from 'react-native';
import type { LiveKitModules } from './liveKitNative';

let cached: LiveKitModules | null | undefined;

/**
 * Loads the LiveKit SDK once and registers its WebRTC globals.
 *
 * Expo Go doesn't contain LiveKit's native code, and importing the SDK there
 * crashes at startup, so it's only required after confirming the native module
 * exists. Returns null when it doesn't, and the app falls back to simulated voice.
 */
export function loadLiveKit(): LiveKitModules | null {
  if (cached !== undefined) return cached;
  cached = null;

  if (!NativeModules.WebRTCModule) return null;

  try {
    const sdk = require('@livekit/react-native') as typeof import('@livekit/react-native');
    sdk.registerGlobals();
    cached = {
      client: require('livekit-client') as typeof import('livekit-client'),
      AudioSession: sdk.AudioSession,
      AndroidAudioTypePresets: sdk.AndroidAudioTypePresets,
    };
  } catch (error) {
    console.warn('[LiveKit] Failed to load the SDK, voice stays simulated:', error);
  }
  return cached;
}
