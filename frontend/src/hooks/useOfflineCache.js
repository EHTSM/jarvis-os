import { useState, useEffect, useRef, useCallback } from 'react';
import { useStableCallback } from './useStableCallback';

const isElectron = () => !!window.electronAPI?.isElectron;

// ── Retry queue — persists failed requests and retries on reconnect ───
class RetryQueue {
  constructor() {
    this._q = [];
    this._running = false;
  }

  enqueue(key, fetcher) {
    const existing = this._q.findIndex(e => e.key === key);
    if (existing >= 0) this._q[existing].fetcher = fetcher;
    else this._q.push({ key, fetcher, attempts: 0, lastAttempt: 0 });
  }

  dequeue(key) {
    this._q = this._q.filter(e => e.key !== key);
  }

  async flush(onSuccess) {
    if (this._running || !this._q.length) return;
    this._running = true;
    const now = Date.now();
    const ready = this._q.filter(e => now - e.lastAttempt >= Math.min(30_000, 2 ** e.attempts * 1_000));
    for (const entry of ready) {
      try {
        const data = await entry.fetcher();
        onSuccess?.(entry.key, data);
        this.dequeue(entry.key);
      } catch {
        entry.attempts++;
        entry.lastAttempt = Date.now();
      }
    }
    this._running = false;
  }

  get size() { return this._q.length; }
}

const _globalRetryQueue = new RetryQueue();

/**
 * useOfflineCache — wraps any async fetcher with offline-first behaviour.
 *
 * 1. On mount: returns cached data immediately, then fetches fresh data.
 * 2. On fetch failure: keeps stale cache, enqueues into retry queue.
 * 3. On reconnect: flushes retry queue automatically.
 * 4. Cache backend: electronAPI.cacheSet/Get in Electron, sessionStorage in browser.
 *
 * @param {string}   cacheKey    — unique stable key for this data slice
 * @param {Function} fetcher     — async () => data
 * @param {object}   [opts]
 * @param {number}   [opts.ttl=300_000]   — cache TTL in ms (default 5 min)
 * @param {number}   [opts.pollMs=0]      — auto-refresh interval (0 = disabled)
 * @param {boolean}  [opts.retry=true]    — enqueue failed fetches for retry
 *
 * @returns {{ data, loading, error, refresh, isStale, pendingRetries }}
 */
export function useOfflineCache(cacheKey, fetcher, {
  ttl = 300_000,
  pollMs = 0,
  retry = true,
} = {}) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [retries, setRetries] = useState(0);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // ── Cache helpers ──────────────────────────────────────────────────
  const readCache = useCallback(async () => {
    try {
      if (isElectron()) {
        const entry = await window.electronAPI.cacheGet(cacheKey);
        if (entry && Date.now() - entry.ts < ttl) return entry.data;
        return null;
      } else {
        const raw = sessionStorage.getItem(`cache:${cacheKey}`);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (Date.now() - entry.ts < ttl) return entry.data;
        sessionStorage.removeItem(`cache:${cacheKey}`);
        return null;
      }
    } catch {
      return null;
    }
  }, [cacheKey, ttl]);

  const writeCache = useCallback(async (value) => {
    try {
      if (isElectron()) {
        await window.electronAPI.cacheSet(cacheKey, value);
      } else {
        sessionStorage.setItem(`cache:${cacheKey}`, JSON.stringify({ data: value, ts: Date.now() }));
      }
    } catch {}
  }, [cacheKey]);

  // ── Fetch with cache-first ─────────────────────────────────────────
  const doFetch = useStableCallback(async (background = false) => {
    if (!background && mounted.current) setLoading(true);
    try {
      const fresh = await fetcher();
      if (!mounted.current) return;
      setData(fresh);
      setError(null);
      setIsStale(false);
      setRetries(0);
      await writeCache(fresh);
      _globalRetryQueue.dequeue(cacheKey);
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || 'fetch failed');
      setIsStale(true);
      if (retry) {
        _globalRetryQueue.enqueue(cacheKey, fetcher);
        setRetries(_globalRetryQueue.size);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  });

  // ── Mount: load cache then fetch ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readCache();
      if (!mounted.current || cancelled) return;
      if (cached !== null) {
        setData(cached);
        setLoading(false);
        setIsStale(true);
      }
      await doFetch(cached !== null);
    })();
    return () => { cancelled = true; };
  }, [cacheKey]); // eslint-disable-line

  // ── Auto-poll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => doFetch(true), pollMs);
    return () => clearInterval(id);
  }, [pollMs, doFetch]);

  // ── Online reconnect → flush retry queue ──────────────────────────
  useEffect(() => {
    const onOnline = () => {
      _globalRetryQueue.flush((key, freshData) => {
        if (key === cacheKey && mounted.current) {
          setData(freshData);
          setError(null);
          setIsStale(false);
          setRetries(0);
          writeCache(freshData);
        }
      });
    };
    window.addEventListener('online', onOnline);
    const unsub = isElectron()
      ? window.electronAPI?.onBackendOnline?.(() => onOnline())
      : null;
    return () => {
      window.removeEventListener('online', onOnline);
      if (typeof unsub === 'function') unsub();
    };
  }, [cacheKey, writeCache]);

  return {
    data,
    loading,
    error,
    isStale,
    pendingRetries: retries,
    refresh: () => doFetch(false),
  };
}

/**
 * useBackgroundSync — fires a callback on a schedule only when the app
 * is online, pausing automatically during offline periods.
 *
 * @param {Function} fn        — async function to run
 * @param {number}   intervalMs
 * @param {boolean}  [enabled=true]
 */
export function useBackgroundSync(fn, intervalMs, enabled = true) {
  const stableFn = useStableCallback(fn);
  const online = useRef(navigator.onLine);

  useEffect(() => {
    const onOnline  = () => { online.current = true; };
    const onOffline = () => { online.current = false; };
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (online.current) stableFn();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, stableFn]);
}
