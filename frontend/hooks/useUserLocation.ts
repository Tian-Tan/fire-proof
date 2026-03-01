import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type Coords = {
  latitude: number;
  longitude: number;
  heading: number;
};

export function useUserLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setGranted(true);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
        (location) => {
          const c = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            heading: location.coords.heading ?? 0,
          };
          console.log('User coords:', c);
          setCoords(c);
        }
      );
    })();

    return () => { subscription?.remove(); };
  }, []);

  return { coords, granted };
}
