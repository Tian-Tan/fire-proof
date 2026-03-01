import { useRef } from "react";
import { createAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "./useFireAlert";

export function useTTS() {
  const isSpeaking = useRef(false);

  const speak = async (text: string) => {
    if (isSpeaking.current) return;
    isSpeaking.current = true;
    try {
      const res = await fetch(`${API_BASE_URL}/api/audio/text-to-speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) return;

      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const uri = FileSystem.cacheDirectory + "tts.mp3";
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const player = createAudioPlayer({ uri });
      player.play();
    } catch (e) {
      console.error("[TTS] error:", e);
    } finally {
      isSpeaking.current = false;
    }
  };

  return { speak };
}
