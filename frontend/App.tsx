import { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  MapView,
  Camera,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  Images,
  LineLayer,
  HeatmapLayer,
} from "@maplibre/maplibre-react-native";
import { useUserLocation } from "./hooks/useUserLocation";
import { useFireAlert } from "./hooks/useFireAlert";
import { useNavigation } from "./hooks/useNavigation";
import { OSM_STYLE } from "./constants/mapConfig";
import {
  buildFireGeoJSON,
  buildUserLocationGeoJSON,
  buildRouteGeoJSON,
  buildDestinationGeoJSON,
} from "./utils/geoJSON";
import { AlertBanner } from "./components/AlertBanner";
import { RoutePanel } from "./components/RoutePanel";
import { RecenterButton } from "./components/RecenterButton";

const NAV_ARROW = require("./assets/nav-arrow.png");

export default function App() {
  const { coords, granted } = useUserLocation();
  const {
    alertLevel,
    closestFireKm,
    firesDetected,
    dangerZones,
    evacuationRecommended,
    loading,
    error,
  } = useFireAlert(coords);
  const {
    route,
    loading: routeLoading,
    error: routeError,
    fetchRoute,
    clearRoute,
  } = useNavigation();
  const [following, setFollowing] = useState(false);
  const [routeBounds, setRouteBounds] = useState<{
    ne: [number, number];
    sw: [number, number];
  } | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const isAnimating = useRef(false);

  useEffect(() => {
    if (granted) setFollowing(true);
  }, [granted]);

  // Auto-fetch route for medium/high/critical risk
  useEffect(() => {
    if (
      coords &&
      ["medium", "high", "critical"].includes(alertLevel) &&
      !route &&
      !routeLoading
    ) {
      fetchRoute(coords.latitude, coords.longitude);
    }
  }, [alertLevel, coords?.latitude, coords?.longitude]);

  // When route loads: zoom out to show full route, then return to following
  useEffect(() => {
    setCurrentStepIndex(0);
    setStepsExpanded(false);
    if (!route || route.coordinates.length === 0) {
      setRouteBounds(null);
      return;
    }

    const lngs = route.coordinates.map((c) => c[0]);
    const lats = route.coordinates.map((c) => c[1]);
    const bounds = {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
    };

    setFollowing(false);
    setRouteBounds(bounds);

    const timer = setTimeout(() => {
      setRouteBounds(null);
      setFollowing(true);
    }, 2500); // 1s zoom-out animation + 1.5s to view

    return () => clearTimeout(timer);
  }, [route]);

  // Advance to nearest upcoming step as user moves
  useEffect(() => {
    if (!coords || !route || route.steps.length === 0) return;
    let nearest = currentStepIndex;
    let nearestDist = Infinity;
    for (let i = currentStepIndex; i < route.steps.length; i++) {
      const s = route.steps[i];
      const d = Math.hypot(s.lat - coords.latitude, s.lng - coords.longitude);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    if (nearest !== currentStepIndex) setCurrentStepIndex(nearest);
  }, [coords?.latitude, coords?.longitude]);

  const handleRegionChanging = () => {
    if (!isAnimating.current) setFollowing(false);
  };

  const handleRecenter = () => {
    isAnimating.current = true;
    setFollowing(true);
    setTimeout(() => {
      isAnimating.current = false;
    }, 800);
  };

  const handleNavigate = () => {
    if (coords) fetchRoute(coords.latitude, coords.longitude);
  };

  const userLocationGeoJSON = coords ? buildUserLocationGeoJSON(coords) : null;
  const fireGeoJSON =
    dangerZones.length > 0 ? buildFireGeoJSON(dangerZones) : null;
  const routeGeoJSON = route ? buildRouteGeoJSON(route) : null;
  const destinationGeoJSON = route ? buildDestinationGeoJSON(route) : null;

  const showNavigateButton = firesDetected > 0 && !route && !routeLoading;

  return (
    <View style={styles.container}>
      <AlertBanner
        alertLevel={alertLevel}
        loading={loading}
        error={error}
        closestFireKm={closestFireKm}
        firesDetected={firesDetected}
        onLayout={(e) => setBannerHeight(e.nativeEvent.layout.height)}
      />

      {route && (
        <RoutePanel
          route={route}
          bannerHeight={bannerHeight}
          currentStepIndex={currentStepIndex}
          stepsExpanded={stepsExpanded}
          onToggleExpanded={() => setStepsExpanded((e) => !e)}
          onClear={clearRoute}
        />
      )}

      <MapView
        style={styles.map}
        mapStyle={OSM_STYLE}
        onRegionIsChanging={handleRegionChanging}
      >
        <Camera
          bounds={
            routeBounds
              ? {
                  ...routeBounds,
                  paddingTop: 80,
                  paddingBottom: 80,
                  paddingLeft: 40,
                  paddingRight: 40,
                }
              : undefined
          }
          centerCoordinate={
            !routeBounds && following && coords
              ? [coords.longitude, coords.latitude]
              : undefined
          }
          zoomLevel={!routeBounds && following ? 14 : undefined}
          animationDuration={routeBounds ? 1000 : 500}
          defaultSettings={{ centerCoordinate: [-119.5, 37.5], zoomLevel: 5 }}
        />

        <Images images={{ "nav-arrow": NAV_ARROW }} />

        {/* Evacuation route */}
        {routeGeoJSON && (
          <ShapeSource id="route" shape={routeGeoJSON}>
            <LineLayer
              id="routeCasing"
              style={{
                lineColor: "#fff",
                lineWidth: 7,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <LineLayer
              id="routeLine"
              style={{
                lineColor: route?.avoidsFireZones ? "#007AFF" : "#FF9F0A",
                lineWidth: 4,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </ShapeSource>
        )}

        {/* Destination marker */}
        {destinationGeoJSON && (
          <ShapeSource id="destination" shape={destinationGeoJSON}>
            <CircleLayer
              id="destinationRing"
              style={{
                circleRadius: 14,
                circleColor: "#007AFF",
                circleOpacity: 0.2,
              }}
            />
            <CircleLayer
              id="destinationDot"
              style={{
                circleRadius: 8,
                circleColor: "#007AFF",
                circleStrokeWidth: 2,
                circleStrokeColor: "#fff",
              }}
            />
          </ShapeSource>
        )}

        {/* Fire heatmap */}
        {fireGeoJSON && (
          <ShapeSource id="fires" shape={fireGeoJSON}>
            <HeatmapLayer
              id="fireHeatmap"
              style={{
                heatmapRadius: [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  1,
                  7,
                  4,
                  10,
                  12,
                  13,
                  25,
                  16,
                  40,
                ],
                heatmapIntensity: [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  0.1,
                  9,
                  0.35,
                  13,
                  0.8,
                ],
                heatmapOpacity: 0.85,
                heatmapWeight: [
                  "match",
                  ["get", "risk_level"],
                  "critical",
                  2.0,
                  "high",
                  1.5,
                  "medium",
                  1.0,
                  0.6,
                ],
                heatmapColor: [
                  "interpolate",
                  ["linear"],
                  ["heatmap-density"],
                  0,
                  "rgba(0,0,0,0)",
                  0.1,
                  "rgba(34,197,94,0.5)",
                  0.3,
                  "rgba(132,204,22,0.65)",
                  0.5,
                  "rgba(255,159,10,0.8)",
                  0.7,
                  "rgba(255,69,58,0.9)",
                  0.9,
                  "rgba(180,20,10,1)",
                  1.0,
                  "rgba(100,0,0,1)",
                ],
              }}
            />
            <CircleLayer
              id="fireDot"
              style={{
                circleRadius: 2,
                circleColor: "#fff",
                circleOpacity: 0.9,
              }}
            />
          </ShapeSource>
        )}

        {/* User location arrow */}
        {userLocationGeoJSON && (
          <ShapeSource id="userLocation" shape={userLocationGeoJSON}>
            <SymbolLayer
              id="userArrow"
              style={{
                iconImage: "nav-arrow",
                iconSize: 0.8,
                iconRotate: ["get", "heading"],
                iconRotationAlignment: "map",
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* Navigate to safety button */}
      {showNavigateButton && (
        <TouchableOpacity
          style={[
            styles.navigateButton,
            evacuationRecommended && styles.navigateButtonUrgent,
          ]}
          onPress={handleNavigate}
        >
          <Text style={styles.navigateButtonText}>
            {evacuationRecommended ? "⚠ Navigate to Safety" : "Find Safe Route"}
          </Text>
        </TouchableOpacity>
      )}

      {/* Route loading indicator */}
      {routeLoading && (
        <View style={styles.routeLoadingCard}>
          <ActivityIndicator color="#007AFF" />
          <Text style={styles.routeLoadingText}>Finding safest route…</Text>
        </View>
      )}

      {/* Route error */}
      {routeError && (
        <View style={styles.routeErrorCard}>
          <Text style={styles.routeErrorText}>{routeError}</Text>
        </View>
      )}

      {granted && !following && <RecenterButton onPress={handleRecenter} />}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  navigateButton: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  navigateButtonUrgent: { backgroundColor: "#FF453A" },
  navigateButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  routeLoadingCard: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  routeLoadingText: { fontSize: 15, color: "#1c1c1e" },
  routeErrorCard: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "#FF453A",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  routeErrorText: { color: "#fff", fontSize: 14 },
});
