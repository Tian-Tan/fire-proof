import { StyleSheet, Text, View, LayoutChangeEvent } from "react-native";
import { AlertLevel } from "../hooks/useFireAlert";
import { ALERT_CONFIG } from "../constants/mapConfig";

type Props = {
  alertLevel: AlertLevel;
  loading: boolean;
  error: string | null;
  closestFireKm: number | null;
  firesDetected: number;
  onLayout: (e: LayoutChangeEvent) => void;
};

export function AlertBanner({
  alertLevel,
  loading,
  error,
  closestFireKm,
  firesDetected,
  onLayout,
}: Props) {
  const alert = ALERT_CONFIG[alertLevel];

  const subtitleText = loading
    ? "Checking fire data…"
    : error
      ? `Error: ${error}`
      : closestFireKm != null
        ? `Closest fire: ${closestFireKm.toFixed(1)} km away (${firesDetected} detected)`
        : "No fires in range";

  return (
    <View
      style={[styles.alertBanner, { backgroundColor: alert.bg }]}
      onLayout={onLayout}
    >
      <Text style={[styles.alertTitle, { color: alert.text }]}>
        {alert.label.toUpperCase()}
      </Text>
      <Text style={[styles.alertSubtitle, { color: alert.text }]}>
        {subtitleText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  alertBanner: {
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  alertTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  alertSubtitle: { fontSize: 12, marginTop: 2, opacity: 0.9 },
});
