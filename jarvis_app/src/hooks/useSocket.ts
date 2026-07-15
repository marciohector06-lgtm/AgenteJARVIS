import { useEffect, useRef, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../constants/config';

type JarvisResponsePayload = {
  text: string;
  audioBuffer: string;
};

type ConfirmNeededPayload = {
  requestId: string;
  command: string;
};

export type ActiveLocation = {
  location: string | null;
  satelliteId: string | null;
  known: boolean;
  availableDevices: string[];
  satelliteStatus: string | null;
};

export function useSocket(token: string | null, onResponse: (payload: JarvisResponsePayload) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isKillSwitchActive, setIsKillSwitchActive] = useState(false);
  const [activeLocation, setActiveLocation] = useState<ActiveLocation | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = io(CONFIG.SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('jarvis:stream_chunk', ({ text }: { text: string }) => {
      setStreamingText((prev) => prev + text);
    });

    socket.on('jarvis:response', (payload: JarvisResponsePayload) => {
      onResponse(payload);
    });

    socket.on('jarvis:kill_switch', ({ active }: { active: boolean }) => {
      setIsKillSwitchActive(active);
    });

    socket.on('jarvis:active_location', (payload: ActiveLocation) => {
      setActiveLocation(payload);
    });

    socket.on('jarvis:confirm_needed', ({ requestId, command }: ConfirmNeededPayload) => {
      Alert.alert('Confirmação necessária', command, [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => socket.emit('user:confirm', { requestId, approved: false }),
        },
        {
          text: 'Aprovar',
          onPress: () => socket.emit('user:confirm', { requestId, approved: true }),
        },
      ]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, onResponse]);

  const sendAudio = useCallback((audioBuffer: string, mimeType: string) => {
    setStreamingText('');
    socketRef.current?.emit('user:audio', { audioBuffer, mimeType });
  }, []);

  const sendMessage = useCallback((text: string) => {
    setStreamingText('');
    socketRef.current?.emit('user:message', { text });
  }, []);

  const sendKillSwitch = useCallback((active: boolean) => {
    socketRef.current?.emit('user:kill_switch', { active });
  }, []);

  const sendNetworkContext = useCallback((ssid: string | null, subnet: string | null) => {
    if (!ssid && !subnet) return;
    socketRef.current?.emit('user:network_context', { ssid, subnet });
  }, []);

  return {
    isConnected,
    sendAudio,
    sendMessage,
    streamingText,
    isKillSwitchActive,
    sendKillSwitch,
    activeLocation,
    sendNetworkContext,
  };
}
