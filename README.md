# PACELOCK · Ride or Run Together (Expo React Native App)

A social group running & cycling mobile app built with **Expo (React Native + TypeScript)**, **Supabase**, **LiveKit Cloud**, and **Spotify Web API**.

## Features

- **Cockpit & Live Activity Pack Line**: Everyone's profile picture (PFP) positioned live on a 1D linear route bar with vertical stagger anti-collision, Google Maps-style road condition segments (`Clear`, `Caution`, `Hazard`), real-time speed/pace, % done, ETA countdown, and an **iOS 18 Lock Screen Live Activity (`ActivityKit`)** preview.
- **Tactical Route Map (`react-native-svg`)**: Interactive vector GPS route map with live athlete markers, draft distance tethers, wind vector overlays, and a **Pin Condition** drawer to broadcast road hazards at your current GPS position.
- **Walkie-Talkie PTT (`LiveKit Cloud`)**: Call-to-call WebRTC voice mesh with a tactile hardware-style **Hold-to-Talk** paddle (`onPressIn` / `onPressOut` + `expo-haptics`), hands-free latch mode, 20-bar spectrum visualizer, automatic Spotify volume ducking (to 25%), and preset voice callouts.
- **Music (Spotify + Apple Music)**: Link a Spotify account (OAuth PKCE), search either service's live catalog, and play. Spotify full tracks play on your own active Spotify device through the Web API (Premium); when no device is active, the same song's 30s preview plays in-app. Apple Music search uses the dedicated Apple Music API (api.music.apple.com) with the MusicKit developer token, previews play in-app on mobile, and full-length playback works in the web build through MusicKit. The player UI always labels which mode is playing. Group music sync is future work and is not claimed here: the music layer (`src/music/`) is a provider interface (`MusicProvider`) with Spotify and Apple implementations over a real in-app audio engine (`expo-audio`), designed so a sync layer can be added behind it later.

Spotify App Remote spike (branch app-remote-spike, Nov 2026): on native builds, the Spotify provider now tries Spotify App Remote first (via @wwdrew/expo-spotify-sdk, wrapping Spotify's official iOS/Android App Remote libraries, transport in src/music/spotifyAppRemote.ts). App Remote remote-controls the Spotify app on the same phone over IPC, so playback no longer depends on an active Spotify Connect device, it can wake the Spotify app, and player state is pushed in real time. It still does not play audio inside PACELOCK and has no music tempo control. Fallback order stays: App Remote, then Web API device, then the 30s preview. Web and Expo Go are unaffected (the module is loaded lazily and simply reports unavailable). To test it: (1) in app.json, replace the plugin clientID placeholder REPLACE_WITH_EXPO_PUBLIC_SPOTIFY_CLIENT_ID with the same client ID as EXPO_PUBLIC_SPOTIFY_CLIENT_ID in .env; (2) in the Spotify Developer Dashboard, make sure the app has the iOS bundle ID run.pacelock.app and the Android package run.pacelock.app (with your debug keystore SHA-1) registered, plus the redirect URI pacelock://spotify-auth-callback; (3) disconnect and reconnect Spotify inside PACELOCK once, because tokens granted earlier do not carry the new app-remote-control scope; (4) build a dev client (npx expo prebuild, then run on a physical phone with the Spotify app installed and a Premium account signed in). Known Android caveat: the Android App Remote library keys its session off the native auth flow, so a token from the in-app PKCE flow may not connect there; iOS is the primary spike target.

MusicKit on Expo web, hard-won notes (Nov 2026): MusicKit JS silently refuses to queue anything (empty queue, no error event, while authorize and API reads work fine) when the Expo `process` global is present while it loads, configures, and authorizes. The Apple provider hides that global during initialization and restores it after authorize; do not simplify that away. A token minted for web playback also needs an `origin` claim listing the served origins (see the mint script). A clean-room diagnostic page lives in `public/musickit-test.html` (open `/musickit-test.html` in the web dev server): if MusicKit ever misbehaves again, test there first to split environment problems from token problems.
- **Real Device GPS + Live Simulation**: Works out-of-the-box in Expo Go & Simulator with a 250ms pack telemetry simulation loop, or toggle **GPS** in the header to read real device speed via `expo-location`.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the Expo development server:**
   ```bash
   npx expo start
   ```
   - Press `i` to open in **iOS Simulator**
   - Press `a` to open in **Android Emulator**
   - Press `w` to open in **Expo Web**
   - Or scan the QR code with **Expo Go** on your physical phone

3. **Optional API Keys (`.env`):**
   Copy `.env.example` to `.env` to connect live Supabase, FastAPI/LiveKit Cloud, and Spotify OAuth credentials:
   ```bash
   cp .env.example .env
   ```
