import { useState } from 'react';
import { API_BASE_URL } from './useFireAlert';

export type RouteStep = {
  instruction: string;
  distanceM: number;
  lat: number;
  lng: number;
};

export type RouteInfo = {
  coordinates: [number, number][];   // [lng, lat] pairs for GeoJSON
  distanceKm: number;
  durationMinutes: number;
  destinationName: string | null;
  destinationLat: number;
  destinationLng: number;
  avoidsFireZones: boolean;
  warnings: string[];
  steps: RouteStep[];
};

function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0, result = 0, b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    // decoded is (lat, lng) — GeoJSON needs [lng, lat]
    coords.push([lng / factor, lat / factor]);
  }

  return coords;
}

export function useNavigation() {
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoute = async (latitude: number, longitude: number) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        `${API_BASE_URL}/api/navigate` +
        `?latitude=${latitude}` +
        `&longitude=${longitude}` +
        `&fire_radius_km=50` +
        `&days=2` +
        `&include_route=true`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const r = data.route;
      const dest = data.recommended_destination;

      if (!r || !dest) {
        throw new Error('No safe route found in your area');
      }

      setRoute({
        coordinates: decodePolyline(r.geometry),
        distanceKm: r.distance_km,
        durationMinutes: r.duration_minutes,
        destinationName: r.destination_name ?? dest.name ?? 'Safe location',
        destinationLat: r.destination.latitude,
        destinationLng: r.destination.longitude,
        avoidsFireZones: r.avoids_fire_zones,
        warnings: r.warnings ?? [],
        steps: (r.steps ?? []).map((s: any) => ({
          instruction: s.instruction,
          distanceM: s.distance_m,
          lat: s.latitude,
          lng: s.longitude,
        })),
      });
    } catch (e: any) {
      setError(e.message ?? 'Failed to get route');
    } finally {
      setLoading(false);
    }
  };

  const clearRoute = () => setRoute(null);

  return { route, loading, error, fetchRoute, clearRoute };
}
