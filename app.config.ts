import type { ExpoConfig } from 'expo/config';

// Dynamic config layer over app.json. Its one job: feed the Spotify
// App Remote config plugin its clientID from the environment, so the
// value never has to be pasted into app.json (app.json is static JSON
// and does not interpolate env var names; a literal name there would
// be treated as the client ID itself).
//
// The plugin reads this at prebuild/native-build time, and Expo loads
// .env before evaluating this file, so keeping
// EXPO_PUBLIC_SPOTIFY_CLIENT_ID in .env is enough.
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const clientId = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.warn(
      '[app.config] EXPO_PUBLIC_SPOTIFY_CLIENT_ID is not set. The Spotify App Remote plugin keeps the placeholder from app.json, and native Spotify auth will fail. Set it in .env before running expo prebuild.'
    );
  }
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === '@wwdrew/expo-spotify-sdk') {
      const [name, props] = plugin as [string, Record<string, unknown>];
      return [name, { ...props, ...(clientId ? { clientID: clientId } : {}) }];
    }
    return plugin;
  });
  return { ...config, plugins: plugins as ExpoConfig['plugins'] };
};
