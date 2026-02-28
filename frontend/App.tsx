import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { MapView, Camera, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';

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

async function recenterCamera(cameraRef: React.RefObject<CameraRef | null>) {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  cameraRef.current?.setCamera({
    centerCoordinate: [location.coords.longitude, location.coords.latitude],
    zoomLevel: 12,
    animationDuration: 800,
  });
}

export default function App() {
  const cameraRef = useRef<CameraRef>(null);
  const [hasLocation, setHasLocation] = useState(false);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setHasLocation(true);
      setFollowing(true);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapStyle={OSM_STYLE}
        onTouchStart={() => setFollowing(false)}
      >
        <Camera
          ref={cameraRef}
          followUserLocation={following}
          followZoomLevel={12}
          defaultSettings={{
            centerCoordinate: [-119.5, 37.5],
            zoomLevel: 5,
          }}
        />
        {hasLocation && <UserLocation visible />}
      </MapView>

      {hasLocation && !following && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => setFollowing(true)}
        >
          <View style={styles.recenterIcon} />
        </TouchableOpacity>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
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
