import { AlertLevel } from "../hooks/useFireAlert";

export const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export const ALERT_CONFIG: Record<
  AlertLevel,
  { bg: string; text: string; label: string }
> = {
  none: { bg: "#34C759", text: "#fff", label: "No fires detected nearby" },
  low: { bg: "#FFD60A", text: "#1c1c1e", label: "Low fire risk" },
  medium: { bg: "#FF9F0A", text: "#fff", label: "Moderate fire risk" },
  high: { bg: "#FF453A", text: "#fff", label: "High fire risk — stay alert" },
  critical: { bg: "#8B0000", text: "#fff", label: "CRITICAL — evacuate now" },
};
