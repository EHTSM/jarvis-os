import { useState, useCallback, useRef, useEffect } from 'react';

const SEVERITY = { info: 0, success: 1, warn: 2, error: 3 };
const MAX_VISIBLE     = 4;      // Phase 143: tighter cap — 4 max to reduce visual noise
const DEDUP_MS        = 8_000;  // Phase 143: increased to 8s — reduces mid-reconnect jitter
const RECONNECT_DEDUP = 30_000; // collapse reconnect spam to one per 30s
const GROUP_WINDOW_MS = 4_000;  // Phase 143: wider group window for burst stabilization

/**
 * useNotifications — operator-safe notification system.
 *
 * Features:
 *  - Duplicate suppression: identical messages suppressed within DEDUP_MS
 *  - Reconnect spam collapse: reconnect alerts collapsed to one per 30s
 *  - Grouped alerts: same-type bursts merged into a single "N events" entry
 *  - Severity routing: warn/error always shown, info suppressed in degraded mode
 *  - Cap: max MAX_VISIBLE notifications visible at once
 */
export function useNotifications({ degraded = false } = {}) {
  const [notifications, setNotifications] = useState([]);
  const timers        = useRef({});
  const dedupCache    = useRef({});    // message → lastTs
  const groupCount    = useRef({});    // type+key → { count, id, lastTs }

  const _cleanup = useCallback(() => {
    const now = Date.now();
    const cache = dedupCache.current;
    for (const k of Object.keys(cache)) {
      if (now - cache[k] > DEDUP_MS * 4) delete cache[k];
    }
    const gc = groupCount.current;
    for (const k of Object.keys(gc)) {
      if (now - gc[k].lastTs > GROUP_WINDOW_MS * 4) delete gc[k];
    }
  }, []);

  const addNotification = useCallback((message, type = 'info', duration = 5000, opts = {}) => {
    const now = Date.now();

    // In degraded mode, suppress info-level notifications
    if (degraded && SEVERITY[type] < SEVERITY.warn) return null;

    // Reconnect spam collapse
    const isReconnect = opts.reconnect || message.toLowerCase().includes("reconnect");
    if (isReconnect) {
      const lastReconnect = dedupCache.current["__reconnect__"] || 0;
      if (now - lastReconnect < RECONNECT_DEDUP) return null;
      dedupCache.current["__reconnect__"] = now;
    }

    // General dedup
    const dedupKey = type + "|" + message.slice(0, 80);
    const lastSeen = dedupCache.current[dedupKey] || 0;
    if (now - lastSeen < DEDUP_MS) {
      // Increment group counter on suppressed duplicate
      const gKey = dedupKey;
      if (!groupCount.current[gKey]) groupCount.current[gKey] = { count: 0, id: null, lastTs: now };
      groupCount.current[gKey].count++;
      groupCount.current[gKey].lastTs = now;
      // Update existing notification text if it's still visible
      const gId = groupCount.current[gKey].id;
      if (gId) {
        setNotifications(prev => prev.map(n =>
          n.id === gId
            ? { ...n, message: `${message} (×${groupCount.current[gKey].count + 1})` }
            : n
        ));
      }
      return null;
    }
    dedupCache.current[dedupKey] = now;

    // Reset group counter for new notification
    const gKey = dedupKey;
    if (groupCount.current[gKey]) groupCount.current[gKey].count = 0;

    const id = now + Math.random();
    const notification = { id, message, type, duration };

    // Cap visible notifications — drop oldest info entries first
    setNotifications(prev => {
      let next = [...prev, notification];
      if (next.length > MAX_VISIBLE) {
        // Find lowest-severity entry to evict
        const lowestIdx = next.reduce((li, n, i) =>
          SEVERITY[n.type] < SEVERITY[next[li].type] ? i : li, 0);
        const evicted = next[lowestIdx];
        if (timers.current[evicted?.id]) {
          clearTimeout(timers.current[evicted.id]);
          delete timers.current[evicted.id];
        }
        next = next.filter((_, i) => i !== lowestIdx);
      }
      return next;
    });

    // Track group ID
    if (groupCount.current[gKey]) groupCount.current[gKey].id = id;

    if (duration > 0) {
      timers.current[id] = setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        delete timers.current[id];
        _cleanup();
      }, duration);
    }

    return id;
  }, [degraded, _cleanup]);

  const removeNotification = useCallback((id) => {
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    setNotifications([]);
  }, []);

  useEffect(() => {
    return () => { Object.values(timers.current).forEach(clearTimeout); };
  }, []);

  return { notifications, addNotification, removeNotification, clearAll };
}
