import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import type { AppState } from '../hooks/useAudio';

const STATE_COLOR: Record<AppState, string> = {
  idle: '#00FFFF',
  listening: '#FF4444',
  processing: '#FFAA00',
  speaking: '#00FF88',
};

const STATE_LABEL: Record<AppState, string> = {
  idle: 'FALAR',
  listening: '● REC',
  processing: '...',
  speaking: '♪',
};

type Props = {
  appState: AppState;
  onPressIn: () => void;
  onPressOut: () => void;
};

export function PushToTalk({ appState, onPressIn, onPressOut }: Props) {
  const disabled = appState === 'processing' || appState === 'speaking';
  const color = STATE_COLOR[appState];

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={[styles.button, { borderColor: color }, disabled && styles.disabled]}
    >
      <Text style={[styles.label, { color }]}>{STATE_LABEL[appState]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
