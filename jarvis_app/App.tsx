import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getPin, authenticate } from './src/services/auth';
import { PinScreen } from './src/screens/PinScreen';
import { MainScreen } from './src/screens/MainScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { StudioScreen } from './src/screens/StudioScreen';
import { usePushNotifications } from './src/hooks/usePushNotifications';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<'main' | 'dashboard' | 'studio'>('main');

  usePushNotifications(token, () => setScreen('studio'));

  useEffect(() => {
    (async () => {
      try {
        const pin = await getPin();
        if (!pin) return;

        const result = await authenticate(pin);
        setToken(result.token);
      } catch {
        // sem PIN salvo ou autenticação falhou — mantém token null, cai na PinScreen
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />
      {token === null ? (
        <PinScreen onSuccess={setToken} />
      ) : screen === 'dashboard' ? (
        <DashboardScreen token={token} onBack={() => setScreen('main')} />
      ) : screen === 'studio' ? (
        <StudioScreen token={token} onBack={() => setScreen('main')} />
      ) : (
        <MainScreen
          token={token}
          onOpenDashboard={() => setScreen('dashboard')}
          onOpenStudio={() => setScreen('studio')}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
