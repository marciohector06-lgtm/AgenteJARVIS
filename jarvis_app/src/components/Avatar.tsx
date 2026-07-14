import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import type { AppState } from '../hooks/useAudio';

const STATE_CONFIG: Record<AppState, { color: string; duration: number }> = {
  idle: { color: '#00FFFF', duration: 2000 },
  listening: { color: '#FF4444', duration: 500 },
  processing: { color: '#FFAA00', duration: 300 },
  speaking: { color: '#00FF88', duration: 1000 },
};

type Props = {
  appState: AppState;
};

export function Avatar({ appState }: Props) {
  const { color, duration } = STATE_CONFIG[appState];

  const pulseOuter = useSharedValue(0);
  const pulseMiddle = useSharedValue(0);
  const pulseInner = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.inOut(Easing.ease);
    pulseOuter.value = withRepeat(withTiming(1, { duration, easing }), -1, true);
    pulseMiddle.value = withRepeat(withTiming(1, { duration: duration * 0.85, easing }), -1, true);
    pulseInner.value = withRepeat(withTiming(1, { duration: duration * 0.7, easing }), -1, true);
  }, [appState, duration, pulseOuter, pulseMiddle, pulseInner]);

  const outerStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulseOuter.value * 0.7,
    transform: [{ scale: 0.9 + pulseOuter.value * 0.1 }],
  }));

  const middleStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulseMiddle.value * 0.7,
    transform: [{ scale: 0.9 + pulseMiddle.value * 0.1 }],
  }));

  const innerStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulseInner.value * 0.7,
    transform: [{ scale: 0.9 + pulseInner.value * 0.1 }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.ring, styles.outerRing, { borderColor: color }, outerStyle]} />
      <Animated.View style={[styles.ring, styles.middleRing, { borderColor: color }, middleStyle]} />
      <Animated.View style={[styles.ring, styles.innerRing, { borderColor: color }, innerStyle]} />
      <Text style={[styles.label, { color }]}>J.A.R.V.I.S.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 999,
  },
  outerRing: {
    width: 200,
    height: 200,
  },
  middleRing: {
    width: 150,
    height: 150,
  },
  innerRing: {
    width: 100,
    height: 100,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 14,
  },
});
