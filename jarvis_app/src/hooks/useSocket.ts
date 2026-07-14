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

export function useSocket(token: string | null, onResponse: (payload: JarvisResponsePayload) => void) {
  const [isConnected, setIsConnected] = useState(false);
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

    socket.on('jarvis:response', (payload: JarvisResponsePayload) => {
      onResponse(payload);
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
    socketRef.current?.emit('user:audio', { audioBuffer, mimeType });
  }, []);

  const sendMessage = useCallback((text: string) => {
    socketRef.current?.emit('user:message', { text });
  }, []);

  return { isConnected, sendAudio, sendMessage };
}
