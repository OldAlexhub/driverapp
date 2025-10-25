import { flushDiagnostics, logDiagnostic } from '@/src/utils/diagnostics';
import { flushOutbox } from '@/src/utils/offlineOutbox';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../api/driverApp';
import { useAuth } from '../hooks/useAuth';

type DriverRealtimeContextValue = {
  socket: Socket | null;
  connected: boolean;
};

const DriverRealtimeContext = createContext<DriverRealtimeContextValue>({
  socket: null,
  connected: false,
});

function deriveSocketUrl() {
  const override = process.env.EXPO_PUBLIC_SOCKET_URL;
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  return API_BASE_URL.replace(/\/api$/i, '');
}

function deriveSocketPath() {
  const override = process.env.EXPO_PUBLIC_SOCKET_PATH;
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  return '/socket.io';
}

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const url = deriveSocketUrl();
    const client = io(url, {
      path: deriveSocketPath(),
      auth: { token, role: 'driver' },
      transports: ['websocket'],
    });
    socketRef.current = client;

    const handleConnect = () => {
      setConnected(true);
      try {
        logDiagnostic({ level: 'info', tag: 'realtime.connect', message: 'socket connected', payload: { url } });
        // attempt to flush any buffered diagnostics and queued outbox entries now that we're authenticated and online
        try {
          flushDiagnostics(token).catch(() => {});
        } catch {
          // ignore
        }
        try {
          flushOutbox(token).catch(() => {});
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    const handleDisconnect = (reason?: any) => {
      setConnected(false);
      try {
        logDiagnostic({ level: 'warn', tag: 'realtime.disconnect', message: 'socket disconnected', payload: { reason, url } });
      } catch {
        // ignore
      }
    };
    const handleError = (error: any) => {
      console.warn('Realtime connection error', error);
      try {
        logDiagnostic({ level: 'error', tag: 'realtime.error', message: String(error?.message ?? error), payload: { error, url } });
      } catch {
        // ignore
      }
    };

    client.on('connect', handleConnect);
    client.on('disconnect', handleDisconnect);
    client.on('connect_error', handleError);

    return () => {
      client.off('connect', handleConnect);
      client.off('disconnect', handleDisconnect);
      client.off('connect_error', handleError);
      client.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const value = useMemo<DriverRealtimeContextValue>(
    () => ({
      socket: socketRef.current,
      connected,
    }),
    [connected],
  );

  return <DriverRealtimeContext.Provider value={value}>{children}</DriverRealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(DriverRealtimeContext);
}
