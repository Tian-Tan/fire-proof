import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';

const API_BASE_URL = 'http://YOUR_LOCAL_IP:8000';

export default function App() {
  const [text, setText] = useState('不要走东边。立刻改走西南楼梯。');
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = useAudioPlayer(audioUri ? { uri: audioUri } : null, {
    downloadFirst: true,
  });

  useEffect(() => {
    if (!audioUri) {
      return;
    }

    const timeoutId = setTimeout(() => {
      player.seekTo(0);
      player.play();
    }, 250);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [audioUri, player]);

  const speak = async () => {
    const trimmed = text.trim();

    if (!trimmed || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      player.pause();
      player.seekTo(0);

      const nextUri = `${API_BASE_URL}/tts?text=${encodeURIComponent(trimmed)}&t=${Date.now()}`;
      setAudioUri(nextUri);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start audio playback.');
    } finally {
      setIsLoading(false);
    }
  };

  const stop = () => {
    player.pause();
    player.seekTo(0);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>ElevenLabs Voice Bridge</Text>
      <Text style={styles.subtitle}>
        Feed upstream LLM text into your FastAPI proxy and stream the generated speech back here.
      </Text>

      <TextInput
        multiline
        onChangeText={setText}
        placeholder="Enter the guidance text to speak"
        style={styles.input}
        value={text}
      />

      <View style={styles.buttonRow}>
        <Button disabled={isLoading} onPress={speak} title={isLoading ? 'Loading...' : 'Speak'} />
        <Button onPress={stop} title="Stop" />
      </View>

      <Text style={styles.helper}>
        Replace `API_BASE_URL` with the IP address of the machine running the FastAPI server.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f0ea',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 16,
  },
  title: {
    color: '#231f20',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#544a4b',
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    minHeight: 180,
    borderColor: '#c7bfb6',
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#fffdf9',
    padding: 14,
    textAlignVertical: 'top',
    fontSize: 16,
    color: '#231f20',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  helper: {
    color: '#6f6465',
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: '#9d2f2f',
    fontSize: 14,
  },
});
