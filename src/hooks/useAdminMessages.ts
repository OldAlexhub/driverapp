import { useCallback, useEffect, useState } from 'react';
import { acknowledgeDriverMessage, snoozeDriverMessage } from '../api/driverApp';
import { useRealtime } from '../providers/RealtimeProvider';
import { useAuth } from './useAuth';

export type AdminMessage = {
  id?: string;
  title?: string;
  body?: string;
  sendAt?: string | number | Date;
};

export default function useAdminMessages() {
  const { socket } = useRealtime();
  const [message, setMessage] = useState<AdminMessage | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleNew = (payload: any) => {
      // payload likely shaped as { id, title, body, ... }
      setMessage({
        id: payload?.id || payload?._id || undefined,
        title: payload?.title || 'Message from admin',
        body: payload?.body || String(payload || ''),
        sendAt: payload?.sendAt || Date.now(),
      });
    };

    const handleCancelled = (payload: any) => {
      // If the currently shown message matches the cancelled id, dismiss it
      const cancelId = payload?.id || payload?._id || payload;
      if (cancelId && message?.id && String(cancelId) === String(message.id)) {
        setMessage(null);
      }
    };

    socket.on('message:new', handleNew);
    socket.on('message:cancelled', handleCancelled);

    return () => {
      socket.off('message:new', handleNew);
      socket.off('message:cancelled', handleCancelled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const dismiss = () => setMessage(null);

  const { token } = useAuth();

  const acknowledge = useCallback(
    async (note?: string) => {
      if (!message) return null;
      try {
        if (!token) throw new Error('Not authenticated');
        await acknowledgeDriverMessage(token, String(message.id), note);
        // notify local UI that we've acknowledged
        setMessage(null);
        return true;
      } catch (err) {
        console.warn('Failed to acknowledge admin message', err);
        return false;
      }
    },
    [message, token],
  );

  const snooze = useCallback(
    async (minutes = 10) => {
      if (!message) return null;
      try {
        if (!token) throw new Error('Not authenticated');
        const res = await snoozeDriverMessage(token, String(message.id), minutes);
        // dismiss locally after snooze
        setMessage(null);
        return res?.snoozeUntil || null;
      } catch (err) {
        console.warn('Failed to snooze admin message', err);
        return null;
      }
    },
    [message, token],
  );

  return { message, dismiss, acknowledge, snooze };
}
