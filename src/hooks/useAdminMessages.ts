import { useEffect, useState } from 'react';
import { useRealtime } from '../providers/RealtimeProvider';

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

  return { message, dismiss };
}
