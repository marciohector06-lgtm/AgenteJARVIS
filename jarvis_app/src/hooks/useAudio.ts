import { useCallback, useRef, useState } from 'react';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';

export type AppState = 'idle' | 'listening' | 'processing' | 'speaking';

export function useAudio() {
  const [appState, setAppState] = useState<AppState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const permissionRequestedRef = useRef(false);

  const requestPermission = useCallback(async () => {
    if (permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;

    const { status } = await requestRecordingPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Permissão de gravação de áudio negada.');
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  }, []);

  const startRecording = useCallback(async () => {
    await requestPermission();

    await recorder.prepareToRecordAsync();
    recorder.record();
    setAppState('listening');
  }, [requestPermission, recorder]);

  const stopRecording = useCallback(async (): Promise<{ audioBuffer: string; mimeType: string }> => {
    setAppState('processing');
    await recorder.stop();
    const uri = recorder.uri;

    if (!uri) {
      throw new Error('Não foi possível obter o áudio gravado.');
    }

    const audioBuffer = await new File(uri).base64();

    return { audioBuffer, mimeType: 'audio/m4a' };
  }, [recorder]);

  const playResponse = useCallback(async (audioBuffer: string) => {
    setAppState('speaking');

    const file = new File(Paths.cache, 'response.mp3');
    file.write(audioBuffer, { encoding: 'base64' });

    const player = createAudioPlayer({ uri: file.uri });

    player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.didJustFinish) {
        setAppState('idle');
        player.remove();
      }
    });

    player.play();
  }, []);

  return { startRecording, stopRecording, playResponse, appState, setAppState };
}
