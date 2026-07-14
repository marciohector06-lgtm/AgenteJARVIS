import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { savePin, authenticate } from '../services/auth';

type Props = {
  onSuccess: (token: string) => void;
};

export function PinScreen({ onSuccess }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);

    try {
      await savePin(pin);
      const { token } = await authenticate(pin);
      onSuccess(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao conectar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>J.A.R.V.I.S.</Text>
      <Text style={styles.subtitle}>Digite seu PIN de acesso</Text>

      <TextInput
        value={pin}
        onChangeText={setPin}
        keyboardType="numeric"
        secureTextEntry
        style={styles.input}
        placeholder="PIN"
        placeholderTextColor="#00FFFF80"
      />

      <Pressable style={styles.button} onPress={handleConnect} disabled={loading || !pin}>
        <Text style={styles.buttonText}>{loading ? 'CONECTANDO...' : 'CONECTAR'}</Text>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    color: '#00FFFF80',
    fontFamily: 'monospace',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#00FFFF',
    backgroundColor: '#001111',
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    textAlign: 'center',
    letterSpacing: 4,
  },
  button: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#00FFFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  buttonText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 'bold',
  },
  error: {
    color: '#FF4444',
    fontFamily: 'monospace',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
});
