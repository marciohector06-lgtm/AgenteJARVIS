import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { CONFIG } from '../constants/config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registrarDispositivo(token: string, authToken: string) {
  await fetch(`${CONFIG.SERVER_URL}/api/v1/push/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
}

async function obterTokenDePush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'JARVIS',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00FFFF',
    });
  }

  const existente = await Notifications.getPermissionsAsync();
  const permissao = existente.granted ? existente : await Notifications.requestPermissionsAsync();

  if (!permissao.granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  return data;
}

export function usePushNotifications(authToken: string | null, onOpenStudio?: () => void) {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const aoAbrirStudio = useRef(onOpenStudio);

  useEffect(() => {
    aoAbrirStudio.current = onOpenStudio;
  }, [onOpenStudio]);

  useEffect(() => {
    if (!authToken) return;

    let cancelado = false;

    (async () => {
      try {
        const token = await obterTokenDePush();
        if (cancelado || !token) return;

        setPushToken(token);
        await registrarDispositivo(token, authToken);
      } catch (e) {
        if (!cancelado) setErro((e as Error).message);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [authToken]);

  useEffect(() => {
    const inscricao = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const tipo = resposta.notification.request.content.data?.tipo;
      if (tipo === 'studio_pending') aoAbrirStudio.current?.();
    });

    return () => inscricao.remove();
  }, []);

  return { pushToken, erro };
}
