import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
  cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated';
import type { AppState } from '../hooks/useAudio';

const STATE_CONFIG: Record<AppState, { color: string; duration: number; orbit: number; intensity: number }> = {
  idle: { color: '#00FFFF', duration: 2600, orbit: 22000, intensity: 0.35 },
  listening: { color: '#FF4444', duration: 620, orbit: 6000, intensity: 1 },
  processing: { color: '#FFAA00', duration: 340, orbit: 2600, intensity: 0.85 },
  speaking: { color: '#00FF88', duration: 900, orbit: 9000, intensity: 0.75 },
};

const ORBIT_COUNT = 8;
const ORBIT_RADIUS = 104;

type Props = {
  appState: AppState;
};

function Orbital({ index, color, spin, intensity }: { index: number; color: string; spin: SharedValue<number>; intensity: number }) {
  const anguloBase = (index / ORBIT_COUNT) * Math.PI * 2;

  const style = useAnimatedStyle(() => {
    const angulo = anguloBase + spin.value * Math.PI * 2;
    const raio = ORBIT_RADIUS + Math.sin(spin.value * Math.PI * 4 + anguloBase) * 10 * intensity;

    return {
      transform: [{ translateX: Math.cos(angulo) * raio }, { translateY: Math.sin(angulo) * raio }],
      opacity: 0.25 + (Math.sin(spin.value * Math.PI * 6 + anguloBase) + 1) * 0.3 * intensity,
    };
  });

  return <Animated.View style={[styles.orbital, { backgroundColor: color }, style]} />;
}

export function Avatar({ appState }: Props) {
  const { color, duration, orbit, intensity } = STATE_CONFIG[appState];

  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  const core = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.inOut(Easing.ease);

    cancelAnimation(pulse);
    cancelAnimation(core);

    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration, easing }), -1, true);

    core.value = withRepeat(
      withSequence(
        withTiming(1, { duration: duration * 0.45, easing }),
        withTiming(0.2, { duration: duration * 0.55, easing })
      ),
      -1,
      false
    );
  }, [appState, duration, pulse, core]);

  useEffect(() => {
    cancelAnimation(spin);
    spin.value = 0;
    spin.value = withRepeat(withTiming(1, { duration: orbit, easing: Easing.linear }), -1, false);
  }, [appState, orbit, spin]);

  const externo = useAnimatedStyle(() => {
    const p = pulse.value % 1;
    return {
      opacity: interpolate(p, [0, 0.5, 1], [0.15, 0.75 * intensity + 0.2, 0.15]),
      transform: [{ scale: interpolate(p, [0, 1], [0.88, 1.08]) }],
    };
  });

  const medio = useAnimatedStyle(() => {
    const p = (pulse.value + 0.18) % 1;
    return {
      opacity: interpolate(p, [0, 0.5, 1], [0.15, 0.75 * intensity + 0.2, 0.15]),
      transform: [{ scale: interpolate(p, [0, 1], [0.88, 1.08]) }],
    };
  });

  const interno = useAnimatedStyle(() => {
    const p = (pulse.value + 0.36) % 1;
    return {
      opacity: interpolate(p, [0, 0.5, 1], [0.15, 0.75 * intensity + 0.2, 0.15]),
      transform: [{ scale: interpolate(p, [0, 1], [0.88, 1.08]) }],
    };
  });

  const nucleoStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + core.value * 0.65,
    transform: [{ scale: 0.7 + core.value * 0.5 }],
  }));

  const orbitais = useMemo(() => Array.from({ length: ORBIT_COUNT }, (_, i) => i), []);

  return (
    <View style={styles.container}>
      <View style={styles.campo}>
        {orbitais.map((i) => (
          <Orbital key={i} index={i} color={color} spin={spin} intensity={intensity} />
        ))}
      </View>

      <Animated.View style={[styles.ring, styles.outerRing, { borderColor: color }, externo]} />
      <Animated.View style={[styles.ring, styles.middleRing, { borderColor: color }, medio]} />
      <Animated.View style={[styles.ring, styles.innerRing, { borderColor: color }, interno]} />
      <Animated.View style={[styles.nucleo, { backgroundColor: color, shadowColor: color }, nucleoStyle]} />

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
  campo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbital: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
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
  nucleo: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 14,
    marginTop: 260,
  },
});
