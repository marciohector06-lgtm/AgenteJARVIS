import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Avatar } from '../components/Avatar';
import { PushToTalk } from '../components/PushToTalk';
import { useAudio } from '../hooks/useAudio';
import { useSocket } from '../hooks/useSocket';

const STATUS_LABEL = {
  idle: 'Aguardando',
  listening: 'Ouvindo...',
  processing: 'Processando...',
  speaking: 'Respondendo...',
} as const;

type Props = {
  token: string;
};

export function MainScreen({ token }: Props) {
  const { startRecording, stopRecording, playResponse, appState } = useAudio();

  const handleResponse = useCallback(
    ({ audioBuffer }: { text: string; audioBuffer: string }) => {
      playResponse(audioBuffer);
    },
    [playResponse]
  );

  const { isConnected, sendAudio } = useSocket(token, handleResponse);

  const handlePressIn = () => {
    startRecording();
  };

  const handlePressOut = async () => {
    const { audioBuffer, mimeType } = await stopRecording();
    sendAudio(audioBuffer, mimeType);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#00FF00' : '#FF0000' }]} />

      <View style={styles.avatarSection}>
        <Avatar appState={appState} />
      </View>

      <View style={styles.controlSection}>
        <PushToTalk appState={appState} onPressIn={handlePressIn} onPressOut={handlePressOut} />
      </View>

      <View style={styles.statusSection}>
        <Text style={styles.statusText}>{STATUS_LABEL[appState]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  connectionDot: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 12,
    height: 12,
    borderRadius: 6,
    zIndex: 10,
  },
  avatarSection: {
    flex: 0.7,
  },
  controlSection: {
    flex: 0.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusSection: {
    flex: 0.1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 13,
  },
});
