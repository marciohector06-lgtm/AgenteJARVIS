import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '../constants/config';

const PIN_KEY = 'jarvis_device_pin';

export async function getPin(): Promise<string | null> {
  return SecureStore.getItemAsync(PIN_KEY);
}

export async function savePin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}

export async function authenticate(pin: string): Promise<{ token: string }> {
  const response = await fetch(`${CONFIG.SERVER_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devicePin: pin }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Falha na autenticação (HTTP ${response.status}).`);
  }

  return response.json();
}
