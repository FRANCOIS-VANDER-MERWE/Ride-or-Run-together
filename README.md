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

## Supabase Backend and Auth

The backend schema is `schema.sql` at the repo root (profiles,
ride_sessions, session_participants, session_invites, routes,
location_pings, ride_metrics, friendships, playlists, tracks,
session_queue, session_playback_state, user_bikes, user_stats,
user_music_accounts). The typed client layer lives in `src/services/`:

| File | Covers |
| --- | --- |
| `supabaseClient.ts` | The typed client, session persistence, Realtime broadcast and Postgres-changes helpers |
| `database.types.ts` | Row and enum types generated to match `schema.sql` exactly |
| `profilesService.ts` | Profiles (including the sign-up bootstrap), stats, bikes, music account links |
| `sessionsService.ts` | Sessions, participants, invites, lifecycle status |
| `friendsService.ts` | Friend requests and the friends list |
| `rideDataService.ts` | Routes, location pings, ride metrics (GeoJSON in and out) |
| `musicDataService.ts` | Track catalog, playlists, session queue, playback state |

### One-time project setup

1. In the Supabase dashboard SQL editor, run `schema.sql`.
2. **Then run `supabase/rls_policies.sql`.** This step is not optional:
   `schema.sql` turns Row Level Security ON for every table but ships
   zero policies, and with no policies the API denies everything. The
   policies file also adds the session tables to the Realtime
   publication.
3. Authentication, Email: make sure the Email provider is enabled.
   For a class demo you can turn off "Confirm email" so sign-ups get a
   session immediately; with it on, the app shows a check-your-email
   state and the confirmation link signs the user in.
4. Authentication, URL Configuration: add `pacelock://auth-callback`
   to the redirect allow list. Password reset and email confirmation
   links deep-link back into the app on that URL.
5. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   in `.env` (Project Settings, API). Without them the app still runs,
   but unauthenticated, with no backend.

### Auth flows in the app

`src/auth/AuthProvider.tsx` owns the session, `AuthGate` shows the
sign-in screen until a session exists, and `AuthScreen` covers sign
up (with username), sign in, forgot password, and the set-new-password
form shown after a reset link. On the first session the provider
creates the `public.profiles` row (and a zeroed `user_stats` row),
because the schema has no sign-up trigger. The header shows the
signed-in `@username` with a tap-to-sign-out control.
