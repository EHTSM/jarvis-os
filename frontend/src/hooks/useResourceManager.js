import { useEffect, useRef, useCallback } from 'react';
import { useStableCallback } from './useStableCallback';

const isElectron = () => !!window.electronAPI?.isElectron;

/**
 * useLowMemoryGuard — listens for the Electron low-memory IPC signal
 * and calls the provided callback so components can release caches,
 * reset large state, or trim internal buffers.
 *
 * @param {Function} onLowMemory — called with { heapMb }
 */
export function useLowMemoryGuard(onLowMemory) {
  const stable = useStableCallback(onLowMemory);

  useEffect(() => {
    if (!isElectron()) return;
    const unsub = window.electronAPI?.onLowMemory?.(stable);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []); // eslint-disable-line
}

/**
 * useEventListenerCleanup — registers a DOM or window event listener
 * and guarantees cleanup on unmount. Preferred over bare addEventListener
 * for long-lived components.
 *
 * @param {EventTarget|null} target
 * @param {string}           event
 * @param {Function}         handler
 * @param {object}           [opts]
 */
export function useEventListenerCleanup(target, event, handler, opts) {
  const stable = useStableCallback(handler);

  useEffect(() => {
    const el = typeof target === 'function' ? target() : target;
    if (!el) return;
    el.addEventListener(event, stable, opts);
    return () => el.removeEventListener(event, stable, opts);
  }, [target, event]); // eslint-disable-line
}

/**
 * useIpcCleanup — subscribes to an Electron IPC channel and
 * auto-unsubscribes on unmount.
 *
 * @param {string|null}  channel   — electronAPI method name (e.g. 'onBackendOnline')
 * @param {Function}     handler
 */
export function useIpcCleanup(channel, handler) {
  const stable = useStableCallback(handler);

  useEffect(() => {
    if (!isElectron() || !channel) return;
    const api = window.electronAPI;
    const sub = api?.[channel]?.(stable);
    return () => { if (typeof sub === 'function') sub(); };
  }, [channel]); // eslint-disable-line
}

/**
 * useIntervalCleanup — setInterval wrapper that guarantees clearInterval
 * on unmount and whenever the delay changes.
 *
 * @param {Function} fn
 * @param {number|null} delay — null pauses the interval
 */
export function useIntervalCleanup(fn, delay) {
  const stable = useStableCallback(fn);

  useEffect(() => {
    if (!delay) return;
    const id = setInterval(stable, delay);
    return () => clearInterval(id);
  }, [delay, stable]);
}

/**
 * useRequestGC — asks the Electron main process to run a GC cycle
 * when the component is hidden for > `delayMs`. Useful for heavy panels
 * that hold large caches and are closed by the user.
 *
 * @param {boolean} isVisible
 * @param {number}  [delayMs=5000]
 */
export function useRequestGC(isVisible, delayMs = 5_000) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (isVisible) {
      clearTimeout(timerRef.current);
      return;
    }
    timerRef.current = setTimeout(() => {
      window.electronAPI?.requestGC?.().catch?.(() => {});
    }, delayMs);
    return () => clearTimeout(timerRef.current);
  }, [isVisible, delayMs]);
}
