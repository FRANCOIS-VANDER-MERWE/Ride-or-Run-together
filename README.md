# PACELOCK · Ride or Run Together (Expo React Native App)

A social group running & cycling mobile app built with **Expo (React Native + TypeScript)**, **Supabase**, **LiveKit Cloud**, and **Spotify Web API**.

## Features

- **Cockpit & Live Activity Pack Line**: Everyone's profile picture (PFP) positioned live on a 1D linear route bar with vertical stagger anti-collision, Google Maps-style road condition segments (`Clear`, `Caution`, `Hazard`), real-time speed/pace, % done, ETA countdown, and an **iOS 18 Lock Screen Live Activity (`ActivityKit`)** preview.
- **Tactical Route Map (`react-native-svg`)**: Interactive vector GPS route map with live athlete markers, draft distance tethers, wind vector overlays, and a **Pin Condition** drawer to broadcast road hazards at your current GPS position.
- **Walkie-Talkie PTT (`LiveKit Cloud`)**: Call-to-call WebRTC voice mesh with a tactile hardware-style **Hold-to-Talk** paddle (`onPressIn` / `onPressOut` + `expo-haptics`), hands-free latch mode, 20-bar spectrum visualizer, automatic Spotify volume ducking (to 25%), and preset voice callouts.
- **Music (Apple Music)**: Search the live Apple Music catalog and play. Apple Music search uses the dedicated Apple Music API (api.music.apple.com) with the MusicKit developer token; previews play in-app on mobile, and full-length playback works in the web build through MusicKit. The player UI always labels which mode is playing. Spotify was part of this feature until Nov 9, 2026, when it was removed for time constraints: its provider code remains dormant in `src/music/providers`, and the full Spotify integration, including the App Remote spike, is preserved on the `app-remote-spike` branch. Group music sync is future work and is not claimed here: the music layer (`src/music/`) is a provider interface (`MusicProvider`) over a real in-app audio engine (`expo-audio`), designed so a sync layer can be added behind it later.

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
