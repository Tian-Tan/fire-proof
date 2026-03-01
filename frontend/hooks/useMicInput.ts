import { useState } from 'react';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { API_BASE_URL } from './useFireAlert';

export function useMicInput() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startRecording = async (): Promise<boolean> => {
    setError(null);
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) {
      setError('Microphone permission denied');
      return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
    audioRecorder.record();
    setIsRecording(true);
    return true;
  };

  const stopAndTranscribe = async (): Promise<string | null> => {
    setIsRecording(false);
    audioRecorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setIsTranscribing(true);
    try {
      // Give the recorder a moment to flush the file
      await new Promise((r) => setTimeout(r, 300));
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('No recording captured');

      const formData = new FormData();
      formData.append('file', { uri, type: 'audio/mp4', name: 'recording.m4a' } as any);

      const res = await fetch(`${API_BASE_URL}/api/audio/speech-to-text`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`STT error: HTTP ${res.status}`);
      const data = await res.json();
      return (data.text as string) || null;
    } catch (e: any) {
      setError(e.message ?? 'Transcription failed');
      return null;
    } finally {
      setIsTranscribing(false);
    }
  };

  return { isRecording, isTranscribing, error, startRecording, stopAndTranscribe };
}
