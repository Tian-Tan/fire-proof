import { StyleSheet, TouchableOpacity, View } from "react-native";

type Props = {
  onPress: () => void;
};

export function RecenterButton({ onPress }: Props) {
  return (
    <TouchableOpacity style={styles.recenterButton} onPress={onPress}>
      <View style={styles.targetRing} />
      <View style={styles.targetDot} />
      <View style={[styles.targetLine, styles.targetLineH]} />
      <View style={[styles.targetLine, styles.targetLineV]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  recenterButton: {
    position: "absolute",
    bottom: 48,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  targetRing: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#007AFF",
    backgroundColor: "transparent",
  },
  targetDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#007AFF",
  },
  targetLine: { position: "absolute", backgroundColor: "#007AFF" },
  targetLineH: { width: 28, height: 2 },
  targetLineV: { width: 2, height: 28 },
});
