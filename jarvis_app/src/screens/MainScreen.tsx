import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import * as Network from 'expo-network';
import { Avatar } from '../components/Avatar';
import { PushToTalk } from '../components/PushToTalk';
import { useAudio } from '../hooks/useAudio';
import { useSocket } from '../hooks/useSocket';
import { useNetworkDetection } from '../hooks/useNetworkDetection';

const STATUS_LABEL = {
  idle: 'Aguardando',
  listening: 'Ouvindo...',
  processing: 'Processando...',
  speaking: 'Respondendo...',
} as const;

type Props = {
  token: string;
  onOpenDashboard: () => void;
};

export function MainScreen({ token, onOpenDashboard }: Props) {
  const { startRecording, stopRecording, playResponse, appState, setAppState } = useAudio();
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
  const [textValue, setTextValue] = useState('');

  const handleResponse = useCallback(
    ({ audioBuffer }: { text: string; audioBuffer: string }) => {
      playResponse(audioBuffer);
    },
    [playResponse]
  );

  const {
    isConnected,
    sendAudio,
    sendMessage,
    streamingText,
    isKillSwitchActive,
    sendKillSwitch,
    activeLocation,
    sendNetworkContext,
  } = useSocket(token, handleResponse);

  const { detectNetwork } = useNetworkDetection();

  useEffect(() => {
    if (!isConnected) return;

    let cancelled = false;

    const detectAndSend = async () => {
      const { ssid, subnet } = await detectNetwork();
      if (!cancelled) sendNetworkContext(ssid, subnet);
    };

    detectAndSend();

    const subscription = Network.addNetworkStateListener(() => {
      detectAndSend();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [isConnected, detectNetwork, sendNetworkContext]);

  const handlePressIn = () => {
    startRecording();
  };

  const handlePressOut = async () => {
    const { audioBuffer, mimeType } = await stopRecording();
    sendAudio(audioBuffer, mimeType);
  };

  const handleSendText = () => {
    const text = textValue.trim();
    if (!text) return;
    setAppState('processing');
    sendMessage(text);
    setTextValue('');
  };

  const toggleKillSwitch = () => {
    sendKillSwitch(!isKillSwitchActive);
  };

  const showStreamingText = streamingText.length > 0 && (appState === 'processing' || appState === 'speaking');

  const locationLabel = !activeLocation
    ? null
    : activeLocation.known
      ? `📍 ${activeLocation.location} — ${activeLocation.availableDevices.length} capacidade(s)`
      : '📍 Rede desconhecida';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#00FF00' : '#FF0000' }]} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={toggleKillSwitch} style={styles.killSwitchButton}>
          <View style={[styles.killSwitchDot, { backgroundColor: isKillSwitchActive ? '#FF0000' : '#00FF88' }]} />
          <Text style={styles.killSwitchText}>{isKillSwitchActive ? 'KILL SWITCH ON' : 'KILL SWITCH OFF'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onOpenDashboard}>
          <Text style={styles.dashboardLink}>DASHBOARD</Text>
        </TouchableOpacity>
      </View>

      {locationLabel && (
        <View style={styles.locationBar}>
          <Text style={styles.locationText}>{locationLabel}</Text>
        </View>
      )}

      <View style={styles.avatarSection}>
        <Avatar appState={appState} />
      </View>

      {showStreamingText && (
        <View style={styles.streamingBox}>
          <Text style={styles.streamingText}>{streamingText}</Text>
        </View>
      )}

      <View style={styles.modeToggle}>
        <TouchableOpacity onPress={() => setInputMode('voice')}>
          <Text style={[styles.modeText, inputMode === 'voice' && styles.modeTextActive]}>VOZ</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setInputMode('text')}>
          <Text style={[styles.modeText, inputMode === 'text' && styles.modeTextActive]}>TEXTO</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controlSection}>
        {inputMode === 'voice' ? (
          <PushToTalk appState={appState} onPressIn={handlePressIn} onPressOut={handlePressOut} />
        ) : (
          <View style={styles.textInputRow}>
            <TextInput
              style={styles.textInput}
              value={textValue}
              onChangeText={setTextValue}
              placeholder="Digite sua mensagem..."
              placeholderTextColor="#666666"
              onSubmitEditing={handleSendText}
              returnKeyType="send"
            />
            <TouchableOpacity onPress={handleSendText} style={styles.sendButton}>
              <Text style={styles.sendButtonText}>ENVIAR</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.statusSection}>
        <Text style={styles.statusText}>{STATUS_LABEL[appState]}</Text>
      </View>
    </KeyboardAvoidingView>
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  killSwitchButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  killSwitchDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  killSwitchText: {
    color: '#CCCCCC',
    fontFamily: 'monospace',
    fontSize: 10,
  },
  dashboardLink: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1,
  },
  locationBar: {
    alignItems: 'center',
    paddingTop: 4,
  },
  locationText: {
    color: '#00FFFF88',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  avatarSection: {
    flex: 0.6,
  },
  streamingBox: {
    paddingHorizontal: 24,
    marginBottom: 8,
    maxHeight: 100,
  },
  streamingText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center',
  },
  modeToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
  },
  modeText: {
    color: '#666666',
    fontFamily: 'monospace',
    fontSize: 12,
    marginHorizontal: 12,
    letterSpacing: 1,
  },
  modeTextActive: {
    color: '#00FFFF',
    fontWeight: 'bold',
  },
  controlSection: {
    flex: 0.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '90%',
  },
  textInput: {
    flex: 1,
    borderColor: '#00FFFF66',
    borderWidth: 1,
    borderRadius: 8,
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  sendButton: {
    borderColor: '#00FFFF',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendButtonText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 11,
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
