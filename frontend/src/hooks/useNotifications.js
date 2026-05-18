import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * useNotifications - Scoped hook for non-disruptive operator feedback.
 * Includes timer cleanup and deduplication to prevent "notification storms".
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const timers = useRef({});
  const lastMessages = useRef({});

  const addNotification = useCallback((message, type = 'info', duration = 5000) => {
    const now = Date.now();
    
    // Deduplication: prevent flood of identical alerts (e.g. connection errors)
    if (lastMessages.current[message] && now - lastMessages.current[message] < 2500) {
      return null;
    }
    lastMessages.current[message] = now;

    const id = now + Math.random();
    const notification = { id, message, type, duration };
    setNotifications((prev) => [...prev, notification]);

    if (duration > 0) {
      timers.current[id] = setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        delete timers.current[id];
      }, duration);
    }
    
    // Memory safety: purge old messages from dedupe cache occasionally
    if (Object.keys(lastMessages.current).length > 50) {
      const threshold = now - 10000;
      Object.keys(lastMessages.current).forEach(msg => {
        if (lastMessages.current[msg] < threshold) delete lastMessages.current[msg];
      });
    }

    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  return { notifications, addNotification, removeNotification };
}
