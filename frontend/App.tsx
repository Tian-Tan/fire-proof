import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MapView, Camera, ShapeSource, CircleLayer } from '@maplibre/maplibre-react-native';
import { useUserLocation } from './hooks/useUserLocation';

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};

export default function App() {
  const { coords, granted } = useUserLocation();
  const [following, setFollowing] = useState(false);
  const isAnimating = useRef(false);

  // Start following once location arrives
  useEffect(() => {
    if (granted) setFollowing(true);
  }, [granted]);

  const handleRegionChanging = () => {
    if (!isAnimating.current) setFollowing(false);
  };

  const handleRecenter = () => {
    isAnimating.current = true;
    setFollowing(true);
    setTimeout(() => { isAnimating.current = false; }, 800);
  };

  const userLocationGeoJSON = coords ? {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [coords.longitude, coords.latitude] },
      properties: {},
    }],
  } : null;

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapStyle={OSM_STYLE}
        onRegionIsChanging={handleRegionChanging}
      >
        <Camera
          centerCoordinate={following && coords ? [coords.longitude, coords.latitude] : undefined}
          zoomLevel={following ? 14 : undefined}
          animationDuration={500}
          defaultSettings={{ centerCoordinate: [-119.5, 37.5], zoomLevel: 5 }}
        />
        {userLocationGeoJSON && (
          <ShapeSource id="userLocation" shape={userLocationGeoJSON}>
            <CircleLayer
              id="userLocationDot"
              style={{
                circleRadius: 8,
                circleColor: '#007AFF',
                circleStrokeWidth: 2,
                circleStrokeColor: '#fff',
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {granted && !following && (
        <TouchableOpacity style={styles.recenterButton} onPress={handleRecenter}>
          <View style={styles.recenterIcon} />
        </TouchableOpacity>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  recenterButton: {
    position: 'absolute',
    bottom: 48,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  recenterIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: '#007AFF',
    backgroundColor: 'transparent',
  },
});
