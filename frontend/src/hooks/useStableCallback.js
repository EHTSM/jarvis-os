import { useRef, useCallback, useEffect } from 'react';

/**
 * useStableCallback — returns a stable function reference whose
 * implementation always reads the latest closure without triggering
 * re-renders on consumers.
 *
 * Equivalent to the React RFC `useEvent` pattern.
 * Safe to pass as a prop without wrapping callers in useMemo.
 *
 * Usage:
 *   const handleClick = useStableCallback((e) => {
 *     doSomethingWith(someProp);   // always the latest value
 *   });
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback((...args) => ref.current(...args), []);
}

/**
 * useThrottledCallback — limits how often a function can fire.
 *
 * @param {Function} fn
 * @param {number}   wait — minimum ms between invocations
 */
export function useThrottledCallback(fn, wait) {
  const last   = useRef(0);
  const stable = useStableCallback(fn);

  return useCallback((...args) => {
    const now = Date.now();
    if (now - last.current >= wait) {
      last.current = now;
      stable(...args);
    }
  }, [stable, wait]);
}

/**
 * useDebouncedCallback — fires only after `wait` ms of silence.
 */
export function useDebouncedCallback(fn, wait) {
  const timer  = useRef(null);
  const stable = useStableCallback(fn);

  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => stable(...args), wait);
  }, [stable, wait]);
}
