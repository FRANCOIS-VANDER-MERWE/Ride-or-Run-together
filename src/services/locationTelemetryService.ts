import * as Location from 'expo-location';

export interface LiveGpsSample {
  latitude: number;
  longitude: number;
  speedMph: number;
  headingDeg: number;
  accuracyMeters: number | null;
  timestamp: number;
}

/**
 * Request foreground location permission and subscribe to high-frequency (5Hz) GPS telemetry
 * via `expo-location`. Used when the user toggles from Simulated GPS to Device GPS.
 */
export async function startDeviceGpsTracking(
  onUpdate: (sample: LiveGpsSample) => void,
  onError?: (reason: string) => void
): Promise<Location.LocationSubscription | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      onError?.('Location permission was not granted. Using simulated 5Hz pack GPS.');
      return null;
    }

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 250,
        distanceInterval: 1,
      },
      (loc) => {
        // Convert meters/second to miles/hour (1 m/s = 2.23694 mph)
        const rawSpeedMs = loc.coords.speed ?? 0;
        const speedMph = Math.max(0, Number((rawSpeedMs * 2.23694).toFixed(1)));
        onUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          speedMph,
          headingDeg: loc.coords.heading ?? 0,
          accuracyMeters: loc.coords.accuracy,
          timestamp: loc.timestamp,
        });
      }
    );

    return subscription;
  } catch (err) {
    onError?.(
      err instanceof Error
        ? err.message
        : 'Device GPS unavailable in this environment; running live simulation.'
    );
    return null;
  }
}
