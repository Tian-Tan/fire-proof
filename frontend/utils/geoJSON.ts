import { DangerZone } from "../hooks/useFireAlert";
import { RouteInfo } from "../hooks/useNavigation";
import { Coords } from "../hooks/useUserLocation";

export function buildFireGeoJSON(zones: DangerZone[]) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((zone) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [zone.center_lng, zone.center_lat],
      },
      properties: { risk_level: zone.risk_level },
    })),
  };
}

export function buildUserLocationGeoJSON(coords: Coords) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [coords.longitude, coords.latitude],
        },
        properties: { heading: coords.heading },
      },
    ],
  };
}

export function buildRouteGeoJSON(route: RouteInfo) {
  return {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: route.coordinates,
    },
    properties: {},
  };
}

export function buildDestinationGeoJSON(route: RouteInfo) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [route.destinationLng, route.destinationLat],
        },
        properties: {},
      },
    ],
  };
}
