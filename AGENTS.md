# PACELOCK · Ride or Run Together (Expo SDK 58)

Expo + React Native + TypeScript project using Expo SDK 58 (`https://docs.expo.dev/versions/v58.0.0/`).

## Development Server

Start the Expo Metro development server with:

```bash
npx expo start
```

## Project Structure

- `index.ts` - Expo root registration entrypoint (`registerRootComponent(App)`)
- `App.tsx` / `src/App.tsx` - Primary application component with 5-tab mobile navigation
- `src/components/` - React Native UI components (`LiveActivityProgressDock`, `TacticalRouteMap`, `WalkieTalkiePTTDeck`, `SpotifySyncDeck`, `ArchitectureBlueprintModal`)
- `src/services/` - Backend and device integrations (`supabaseClient.ts` using `expo-sqlite/localStorage/install`, `spotifySyncService.ts`, `liveKitVoiceService.ts`, `locationTelemetryService.ts`)
- `app.json` - Expo SDK 58 configuration with React Compiler enabled (`"experiments": { "reactCompiler": true }`)
- `package.json` - Expo SDK 58 dependencies and scripts

## Dependencies

- Runtime: Expo SDK 58 (`~58.0.19`), React 19.3.0, React Native 0.88.0 (New Architecture enabled by default)
- Storage & Auth: `@supabase/supabase-js` with `expo-sqlite/localStorage/install`
- Native Modules: `expo-location`, `expo-haptics`, `expo-clipboard`, `expo-symbols`, `react-native-svg`, `react-native-safe-area-context`
