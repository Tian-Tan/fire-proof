import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafePlace } from "../hooks/useFireAlert";

type Props = {
  safePlaces: SafePlace[];
  bannerHeight: number;
  expanded: boolean;
  onToggleExpanded: () => void;
};

export function SafePlacesPanel({ safePlaces, bannerHeight, expanded, onToggleExpanded }: Props) {
  if (safePlaces.length === 0) return null;

  const top = safePlaces[0];

  return (
    <View style={[styles.panel, { top: bannerHeight + 8 }]}>
      <TouchableOpacity style={styles.header} onPress={onToggleExpanded} activeOpacity={0.7}>
        <View style={styles.headerText}>
          <Text style={styles.placeName}>{top.name}</Text>
          <Text style={styles.placeMeta}>
            {top.place_type}
            {top.distance_km != null ? ` · ${top.distance_km.toFixed(1)} km` : ""}
            {top.has_cell_coverage ? " · 📶" : " · 📵"}
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded && safePlaces.length > 1 && (
        <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {safePlaces.slice(1).map((p) => (
            <View key={p.id} style={styles.row}>
              <Text style={styles.placeName}>{p.name}</Text>
              <Text style={styles.placeMeta}>
                {p.place_type}
                {p.distance_km != null ? ` · ${p.distance_km.toFixed(1)} km` : ""}
                {p.has_cell_coverage ? " · 📶" : " · 📵"}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 5,
    backgroundColor: "#f2f2f7",
    borderRadius: 12,
    maxHeight: 280,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerText: { flex: 1 },
  chevron: { fontSize: 10, color: "#8e8e93", marginLeft: 8 },
  list: { maxHeight: 220, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#d1d1d6" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  placeName: { fontSize: 14, fontWeight: "600", color: "#1c1c1e" },
  placeMeta: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
});
