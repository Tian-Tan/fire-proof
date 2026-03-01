import { useEffect, useRef, useState } from "react";
import { setAudioModeAsync } from "expo-audio";
import * as Notifications from "expo-notifications";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { useFireAlert, API_BASE_URL } from "./hooks/useFireAlert";
import { useNavigation } from "./hooks/useNavigation";
import { useTTS } from "./hooks/useTTS";
import { useGuidance } from "./hooks/useGuidance";
import { useMicInput } from "./hooks/useMicInput";
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
import { SafePlacesPanel } from "./components/SafePlacesPanel";

const NAV_ARROW = require("./assets/nav-arrow.png");
const DEST_PIN  = require("./assets/dest-pin.png");

export default function App() {
  const { coords: gpsCoords, granted } = useUserLocation();
  const [demoCoords, setDemoCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const coords = demoCoords ?? gpsCoords;
  const {
    alertLevel,
    closestFireKm,
    firesDetected,
    dangerZones,
    safePlaces,
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
  const { speak } = useTTS();
  const { fetchGuidance } = useGuidance();
  const { isRecording, isTranscribing, startRecording, stopAndTranscribe } =
    useMicInput();
  const [isProcessing, setIsProcessing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [safePlacesExpanded, setSafePlacesExpanded] = useState(false);
  const [chatLog, setChatLog] = useState<{ question: string; answer: string }[]>([]);
  const [showChat, setShowChat] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);
  const [showQueryInput, setShowQueryInput] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [routeBounds, setRouteBounds] = useState<{
    ne: [number, number];
    sw: [number, number];
  } | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const isAnimating = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  // Demo: schedule a wildfire alert push notification ~5 s after launch
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    (async () => {
      const perms = await Notifications.requestPermissionsAsync();
      const authorized = perms.ios?.status === 2 || perms.granted === true || perms.status === 'granted';
      if (!authorized) return;

      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: "⚠️ Wildfire Alert",
            body: "Active wildfire detected near your area. Tap to view evacuation guidance.",
            data: { action: "moveNearFire" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 5,
            repeats: false,
          },
        });
        console.log("[Notif] scheduled:", id);
      } catch (e) {
        console.error("[Notif] schedule error:", e);
      }
    })();

    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      if (response.notification.request.content.data?.action !== "moveNearFire") return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/fires/locations?days=2&limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        const fire = data.nearest ?? data.fires?.[0];
        if (!fire) return;
        setDemoCoords({ latitude: fire.latitude, longitude: fire.longitude });
        setFollowing(true);
      } catch (e) {
        console.error("[Notif] move near fire failed:", e);
      }
    });


    return () => sub.remove();
  }, []);

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
    }, 5000);

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

  // Announce destination and first instruction when route loads
  useEffect(() => {
    if (route?.steps[0]) {
      const destination = route.destinationName ?? "a safe location";
      speak(
        `Your recommended evacuation destination is ${destination}. ${route.steps[0].instruction}`,
      );
    }
  }, [route]);

  // Speak each subsequent step as user advances
  useEffect(() => {
    if (currentStepIndex > 0 && route?.steps[currentStepIndex]) {
      speak(route.steps[currentStepIndex].instruction);
    }
  }, [currentStepIndex]);

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

  const addChatEntry = (question: string, answer: string) => {
    setChatLog((prev) => [...prev, { question, answer }]);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleQuerySubmit = async () => {
    if (!queryText.trim() || !coords) return;
    setShowQueryInput(false);
    const question = queryText.trim();
    setQueryText("");
    const guidance = await fetchGuidance(question, coords.latitude, coords.longitude);
    if (guidance?.guidanceText) {
      speak(guidance.guidanceText);
      addChatEntry(question, guidance.guidanceText);
    }
  };

  const handleMicPress = async () => {
    if (isTranscribing || isProcessing) return;
    if (isRecording) {
      const transcribed = await stopAndTranscribe();
      if (transcribed && coords) {
        setIsProcessing(true);
        try {
          const guidance = await fetchGuidance(transcribed, coords.latitude, coords.longitude);
          if (guidance?.guidanceText) {
            speak(guidance.guidanceText);
            addChatEntry(transcribed, guidance.guidanceText);
          }
        } finally {
          setIsProcessing(false);
        }
      }
    } else {
      const started = await startRecording();
      if (!started) setShowQueryInput(true);
    }
  };

  const handleMoveNearFire = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/fires/locations?days=2&limit=1`);
      if (!res.ok) return;
      const data = await res.json();
      const fire = data.nearest ?? data.fires?.[0];
      if (!fire) return;
      setDemoCoords({ latitude: fire.latitude, longitude: fire.longitude });
      setFollowing(true);
    } catch (e) {
      console.error("[Demo] move near fire failed:", e);
    }
  };
  // Keep ref current every render so the notification listener never uses a stale closure

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

      {routeLoading && (
        <View style={[styles.routeLoadingCard, { top: bannerHeight + 8 }]}>
          <ActivityIndicator color="#007AFF" />
          <Text style={styles.routeLoadingText}>Finding safest route…</Text>
        </View>
      )}

      {showNavigateButton && (
        <TouchableOpacity
          style={[
            styles.navigateButton,
            evacuationRecommended && styles.navigateButtonUrgent,
            { top: bannerHeight + 8 },
          ]}
          onPress={handleNavigate}
        >
          <Text style={styles.navigateButtonText}>
            {evacuationRecommended ? "⚠ Navigate to Safety" : "Find Safe Route"}
          </Text>
        </TouchableOpacity>
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

        <Images images={{ "nav-arrow": NAV_ARROW, "dest-pin": DEST_PIN }} />

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

        {destinationGeoJSON && (
          <ShapeSource id="destination" shape={destinationGeoJSON}>
            <SymbolLayer
              id="destinationPin"
              style={{
                iconImage: "dest-pin",
                iconSize: 0.7,
                iconAnchor: "bottom",
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </ShapeSource>
        )}

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

      {routeError && (
        <View style={styles.routeErrorCard}>
          <Text style={styles.routeErrorText}>{routeError}</Text>
        </View>
      )}

      <SafePlacesPanel
        safePlaces={safePlaces}
        bannerHeight={bannerHeight}
        expanded={safePlacesExpanded}
        onToggleExpanded={() => setSafePlacesExpanded((v) => !v)}
      />

      {granted && !following && <RecenterButton onPress={handleRecenter} />}

      {showChat && chatLog.length > 0 && (
        <View style={styles.chatPanel}>
          <TouchableOpacity style={styles.chatClose} onPress={() => setShowChat(false)}>
            <Text style={styles.chatCloseText}>✕</Text>
          </TouchableOpacity>
          <ScrollView ref={chatScrollRef} style={styles.chatScroll} contentContainerStyle={{ padding: 12, gap: 12 }}>
            {chatLog.map((entry, i) => (
              <View key={i}>
                <View style={styles.chatBubbleUser}>
                  <Text style={styles.chatBubbleUserText}>{entry.question}</Text>
                </View>
                <View style={styles.chatBubbleBot}>
                  <Text style={styles.chatBubbleBotText}>{entry.answer}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <TouchableOpacity style={styles.demoButton} onPress={handleMoveNearFire}>
        <Text style={styles.demoButtonText}>🔥</Text>
      </TouchableOpacity>

      {route && (
        <TouchableOpacity
          style={[styles.demoButton, { bottom: 116 }]}
          onPress={() => {
            setDemoCoords({ latitude: route.destinationLat, longitude: route.destinationLng });
            setFollowing(true);
          }}
        >
          <Text style={styles.demoButtonText}>🏁</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.micButton, isRecording && styles.micButtonRecording]}
        onPress={handleMicPress}
        disabled={isTranscribing || isProcessing}
      >
        {isTranscribing || isProcessing ? (
          <ActivityIndicator color={isProcessing ? "#007AFF" : "#8e8e93"} />
        ) : (
          <Text style={styles.micIcon}>{isRecording ? "■" : "🎙"}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.typeInsteadButton}
        onPress={() => setShowQueryInput(true)}
      >
        <Text style={styles.typeInsteadText}>Type instead</Text>
      </TouchableOpacity>

      {chatLog.length > 0 && (
        <TouchableOpacity style={styles.chatToggleButton} onPress={() => setShowChat((v) => !v)}>
          <Text style={styles.chatToggleText}>💬 {chatLog.length}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showQueryInput} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.queryCard}>
            <Text style={styles.queryLabel}>Ask a question</Text>
            <TextInput
              style={styles.queryInput}
              placeholder="e.g. What should I do with my pets?"
              value={queryText}
              onChangeText={setQueryText}
              autoFocus
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={handleQuerySubmit}
            />
            <View style={styles.queryButtons}>
              <TouchableOpacity
                style={styles.queryCancelButton}
                onPress={() => {
                  setShowQueryInput(false);
                  setQueryText("");
                }}
              >
                <Text style={styles.queryCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.querySubmitButton}
                onPress={handleQuerySubmit}
              >
                <Text style={styles.querySubmitText}>Ask</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  navigateButton: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 5,
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  navigateButtonUrgent: { backgroundColor: "#FF453A" },
  navigateButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  routeLoadingCard: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 5,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  micButton: {
    position: "absolute",
    bottom: 60,
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  micIcon: { fontSize: 28 },
  micButtonRecording: { backgroundColor: "#FF453A" },
  typeInsteadButton: {
    position: "absolute",
    bottom: 20,
    alignSelf: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1d1d6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  typeInsteadText: { fontSize: 13, color: "#007AFF", fontWeight: "600" },
  chatPanel: {
    position: "absolute",
    bottom: 160,
    left: 12,
    right: 12,
    maxHeight: 260,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
    overflow: "hidden",
  },
  chatClose: { position: "absolute", top: 8, right: 10, zIndex: 1, padding: 4 },
  chatCloseText: { fontSize: 13, color: "#8e8e93" },
  chatScroll: { maxHeight: 260 },
  chatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#007AFF",
    borderRadius: 14,
    borderBottomRightRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 6,
    maxWidth: "80%",
  },
  chatBubbleUserText: { color: "#fff", fontSize: 14 },
  chatBubbleBot: {
    alignSelf: "flex-start",
    backgroundColor: "#f2f2f7",
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: "85%",
  },
  chatBubbleBotText: { color: "#1c1c1e", fontSize: 14 },
  chatToggleButton: {
    position: "absolute",
    bottom: 160,
    right: 16,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  chatToggleText: { fontSize: 14, fontWeight: "600", color: "#1c1c1e" },
  demoButton: {
    position: "absolute",
    bottom: 72,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.45,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  demoButtonText: { fontSize: 18 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  queryCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  queryLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1c1c1e",
    marginBottom: 12,
  },
  queryInput: {
    borderWidth: 1,
    borderColor: "#d1d1d6",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1c1c1e",
    marginBottom: 14,
  },
  queryButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  queryCancelButton: { paddingHorizontal: 16, paddingVertical: 10 },
  queryCancelText: { fontSize: 15, color: "#8e8e93" },
  querySubmitButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  querySubmitText: { fontSize: 15, color: "#fff", fontWeight: "600" },
});
