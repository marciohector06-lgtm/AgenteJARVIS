import { useCallback, useState } from 'react';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';

export type AppState = 'idle' | 'listening' | 'processing' | 'speaking';

export function useAudio() {
  const [appState, setAppState] = useState<AppState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    try {
      const current = await getRecordingPermissionsAsync();
      if (current.granted) return true;

      const requested = await requestRecordingPermissionsAsync();
      return requested.granted;
    } catch (error) {
      console.warn('Erro ao verificar/solicitar permissão de microfone:', error);
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    const granted = await ensurePermission();
    if (!granted) {
      console.warn('Permissão de microfone negada — gravação cancelada.');
      return;
    }

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setAppState('listening');
    } catch (error) {
      console.warn('Erro ao iniciar gravação:', error);
      setAppState('idle');
    }
  }, [ensurePermission, recorder]);

  const stopRecording = useCallback(async (): Promise<{ audioBuffer: string; mimeType: string }> => {
    if (!recorder.isRecording) {
      throw new Error('Nenhuma gravação em andamento.');
    }

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
