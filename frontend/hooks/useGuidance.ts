import { useState } from 'react';
import { API_BASE_URL } from './useFireAlert';

export type GuidanceResult = {
  guidanceText: string;
  model: string;
  latencyS: number;
};

export function useGuidance() {
  const [result, setResult] = useState<GuidanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGuidance = async (
    latitude: number,
    longitude: number,
    userContext?: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/guidance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude,
          longitude,
          fire_radius_km: 50,
          safe_place_radius_km: 20,
          include_route: false,
          user_context: userContext ?? null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult({
        guidanceText: data.guidance_text,
        model: data.model,
        latencyS: data.latency_s,
      });
    } catch (e: any) {
      setError(e.message ?? 'Failed to get guidance');
    } finally {
      setLoading(false);
    }
  };

  const clearGuidance = () => setResult(null);

  return { result, loading, error, fetchGuidance, clearGuidance };
}
