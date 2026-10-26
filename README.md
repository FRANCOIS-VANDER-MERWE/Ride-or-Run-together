# PACELOCK · Ride or Run Together (Expo React Native App)

A social group running & cycling mobile app built with **Expo (React Native + TypeScript)**, **Supabase**, **LiveKit Cloud**, and **Spotify Web API**.

## Features

- **Cockpit & Live Activity Pack Line**: Everyone's profile picture (PFP) positioned live on a 1D linear route bar with vertical stagger anti-collision, Google Maps-style road condition segments (`Clear`, `Caution`, `Hazard`), real-time speed/pace, % done, ETA countdown, and an **iOS 18 Lock Screen Live Activity (`ActivityKit`)** preview.
- **Tactical Route Map (`react-native-svg`)**: Interactive vector GPS route map with live athlete markers, draft distance tethers, wind vector overlays, and a **Pin Condition** drawer to broadcast road hazards at your current GPS position.
- **Walkie-Talkie PTT (`LiveKit Cloud`)**: Call-to-call WebRTC voice mesh with a tactile hardware-style **Hold-to-Talk** paddle (`onPressIn` / `onPressOut` + `expo-haptics`), hands-free latch mode, 20-bar spectrum visualizer, automatic Spotify volume ducking (to 25%), and preset voice callouts.
- **Synchronized Spotify Stream**: Custom Broadcast Signal (`POST /v1/session/.../broadcast` / Supabase Realtime) translated on each peer's phone into an authenticated `PUT https://api.spotify.com/v1/me/player/play` call with network transit drift compensation.
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
