import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RouteInfo, RouteStep } from "../hooks/useNavigation";

type Props = {
  route: RouteInfo;
  bannerHeight: number;
  currentStepIndex: number;
  stepsExpanded: boolean;
  onToggleExpanded: () => void;
  onClear: () => void;
};

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function RoutePanel({
  route,
  bannerHeight,
  currentStepIndex,
  stepsExpanded,
  onToggleExpanded,
  onClear,
}: Props) {
  const current = route.steps[currentStepIndex];

  return (
    <View style={[styles.routePanel, { top: bannerHeight + 8 }]}>
      <View style={styles.routeCardContent}>
        <View style={styles.routeCardText}>
          <Text style={styles.routeDestination}>{route.destinationName}</Text>
          <Text style={styles.routeMeta}>
            {route.distanceKm.toFixed(1)} km ·{" "}
            {Math.round(route.durationMinutes)} min
            {!route.avoidsFireZones ? "  ⚠ May pass near fire zones" : ""}
          </Text>
        </View>
        <TouchableOpacity onPress={onClear} style={styles.clearRouteButton}>
          <Text style={styles.clearRouteText}>✕</Text>
        </TouchableOpacity>
      </View>

      {route.steps.length > 0 && current && (
        <>
          <TouchableOpacity
            style={styles.currentStepRow}
            onPress={onToggleExpanded}
            activeOpacity={0.7}
          >
            <View style={styles.stepBullet}>
              <Text style={styles.stepBulletText}>{currentStepIndex + 1}</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepInstruction}>{current.instruction}</Text>
              {current.distanceM > 0 && (
                <Text style={styles.stepDistance}>{formatDist(current.distanceM)}</Text>
              )}
            </View>
            <Text style={styles.expandChevron}>{stepsExpanded ? "▲" : "▼"}</Text>
          </TouchableOpacity>

          {stepsExpanded && (
            <ScrollView style={styles.stepsList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {route.steps.map((step: RouteStep, i: number) => (
                <View key={i} style={[styles.stepRow, i === currentStepIndex && styles.stepRowActive]}>
                  <View style={[styles.stepBullet, i < currentStepIndex && styles.stepBulletDone]}>
                    <Text style={styles.stepBulletText}>{i + 1}</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={[styles.stepInstruction, i < currentStepIndex && styles.stepDone]}>
                      {step.instruction}
                    </Text>
                    {step.distanceM > 0 && (
                      <Text style={styles.stepDistance}>{formatDist(step.distanceM)}</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  routePanel: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 5,
    backgroundColor: "#f2f2f7",
    borderRadius: 12,
    maxHeight: 260,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: "hidden",
  },
  routeCardContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d1d1d6",
  },
  routeCardText: { flex: 1 },
  routeDestination: { fontSize: 14, fontWeight: "600", color: "#1c1c1e" },
  routeMeta: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
  currentStepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f2f2f7",
  },
  expandChevron: { fontSize: 10, color: "#8e8e93", marginLeft: 8 },
  stepsList: { maxHeight: 200 },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  stepRowActive: { backgroundColor: "#e8f0ff" },
  stepBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    marginTop: 1,
    flexShrink: 0,
  },
  stepBulletDone: { backgroundColor: "#c7c7cc" },
  stepBulletText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  stepContent: { flex: 1 },
  stepInstruction: { fontSize: 13, color: "#1c1c1e" },
  stepDone: { color: "#c7c7cc" },
  stepDistance: { fontSize: 11, color: "#8e8e93", marginTop: 2 },
  clearRouteButton: { padding: 8 },
  clearRouteText: { fontSize: 16, color: "#8e8e93" },
});
