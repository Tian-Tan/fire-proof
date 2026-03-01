import { useEffect, useState } from 'react';
import { Coords } from './useUserLocation';

export type AlertLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type DangerZone = {
  center_lat: number;
  center_lng: number;
  radius_km: number;
  fire_id: string | null;
  risk_level: AlertLevel;
};

export type SafePlace = {
  id: string;
  name: string;
  place_type: string;
  latitude: number;
  longitude: number;
  distance_km: number | null;
  has_cell_coverage: boolean;
};

export type FireAlert = {
  alertLevel: AlertLevel;
  closestFireKm: number | null;
  firesDetected: number;
  dangerZones: DangerZone[];
  safePlaces: SafePlace[];
  evacuationRecommended: boolean;
  loading: boolean;
  error: string | null;
};

export const API_BASE_URL = 'http://134.199.193.195:8001';

const POLL_INTERVAL_MS = 60_000;

export function useFireAlert(coords: Coords | null): FireAlert {
  const [alertLevel, setAlertLevel] = useState<AlertLevel>('none');
  const [closestFireKm, setClosestFireKm] = useState<number | null>(null);
  const [firesDetected, setFiresDetected] = useState(0);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [safePlaces, setSafePlaces] = useState<SafePlace[]>([]);
  const [evacuationRecommended, setEvacuationRecommended] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coords) return;

    // Reset stale data immediately so the banner doesn't show the previous location's risk
    setAlertLevel('none');
    setClosestFireKm(null);
    setFiresDetected(0);
    setDangerZones([]);
    setSafePlaces([]);
    setEvacuationRecommended(false);
    setLoading(true);

    const controller = new AbortController();

    const fetchAlert = async () => {
      setLoading(true);
      setError(null);
      try {
        const url =
          `${API_BASE_URL}/api/navigate` +
          `?latitude=${coords.latitude}` +
          `&longitude=${coords.longitude}` +
          `&fire_radius_km=50` +
          `&days=2` +
          `&include_route=false`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAlertLevel(data.alert_level as AlertLevel);
        setClosestFireKm(data.closest_fire_km ?? null);
        setFiresDetected(data.fires_detected ?? 0);
        setDangerZones(data.danger_zones ?? []);
        setSafePlaces(data.safe_places ?? []);
        setEvacuationRecommended(data.evacuation_recommended ?? false);
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        setError(e.message ?? 'Failed to fetch fire data');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchAlert();
    const interval = setInterval(fetchAlert, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [coords?.latitude, coords?.longitude]);

  return { alertLevel, closestFireKm, firesDetected, dangerZones, safePlaces, evacuationRecommended, loading, error };
}
