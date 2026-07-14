import { useCallback, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { File, Paths } from 'expo-file-system';

export type AppState = 'idle' | 'listening' | 'processing' | 'speaking';

export function useAudio() {
  const [appState, setAppState] = useState<AppState>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);
  const permissionRequestedRef = useRef(false);

  const requestPermission = useCallback(async () => {
    if (permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Permissão de gravação de áudio negada.');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
  }, []);

  const startRecording = useCallback(async () => {
    await requestPermission();

    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    recordingRef.current = recording;
    setAppState('listening');
  }, [requestPermission]);

  const stopRecording = useCallback(async (): Promise<{ audioBuffer: string; mimeType: string }> => {
    const recording = recordingRef.current;
    if (!recording) {
      throw new Error('Nenhuma gravação em andamento.');
    }

    setAppState('processing');
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recordingRef.current = null;

    if (!uri) {
      throw new Error('Não foi possível obter o áudio gravado.');
    }

    const audioBuffer = await new File(uri).base64();

    return { audioBuffer, mimeType: 'audio/m4a' };
  }, []);

  const playResponse = useCallback(async (audioBuffer: string) => {
    setAppState('speaking');

    const file = new File(Paths.cache, 'response.mp3');
    file.write(audioBuffer, { encoding: 'base64' });

    const { sound } = await Audio.Sound.createAsync({ uri: file.uri });

    sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      if (status.isLoaded && status.didJustFinish) {
        setAppState('idle');
        sound.unloadAsync();
      }
    });

    await sound.playAsync();
  }, []);

  return { startRecording, stopRecording, playResponse, appState, setAppState };
}
