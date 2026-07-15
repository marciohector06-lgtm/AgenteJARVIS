import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../constants/config';

export type DashboardData = {
  server: {
    uptimeSeconds: number;
    nodeVersion: string;
    memoryUsageMB: number;
    connectedSessions: number;
  };
  lastBackup: {
    name: string;
    sizeBytes: number;
    modifiedAt: string;
  } | null;
  recentKnowledge: Array<{
    document: string;
    topic: string | null;
    source: string | null;
    date: string | null;
  }>;
  pendingTasks: Array<{
    category: string;
    key: string;
    value: string;
    updatedAt: number;
    stale: boolean;
  }>;
};

export function useDashboard(token: string | null) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const requestDashboard = useCallback(() => {
    if (!socketRef.current?.connected) return;
    setIsLoading(true);
    setError(null);
    socketRef.current.emit('user:get_dashboard');
  }, []);

  useEffect(() => {
    if (!token) return;

    const socket = io(CONFIG.SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsLoading(true);
      setError(null);
      socket.emit('user:get_dashboard');
    });

    socket.on('jarvis:dashboard', (payload: DashboardData) => {
      setDashboard(payload);
      setIsLoading(false);
    });

    socket.on('jarvis:error', ({ message }: { message: string }) => {
      setError(message);
      setIsLoading(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return { dashboard, isLoading, error, refresh: requestDashboard };
}
