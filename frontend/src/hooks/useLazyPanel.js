import { useState, useEffect, useRef } from 'react';

/**
 * useLazyPanel — mounts a heavy panel only when first requested.
 *
 * Unlike React.lazy (which needs a dynamic import at the call-site),
 * this hook tracks whether a panel has ever been activated and
 * keeps it mounted (but hidden) after first activation so state
 * is preserved across tab switches.
 *
 * Usage:
 *   const { everShown, ref } = useLazyPanel(isActive);
 *   return (
 *     <div ref={ref} style={{ display: isActive ? 'flex' : 'none' }}>
 *       {everShown && <HeavyComponent />}
 *     </div>
 *   );
 */
export function useLazyPanel(isActive) {
  const [everShown, setEverShown] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (isActive && !everShown) setEverShown(true);
  }, [isActive, everShown]);

  return { everShown, ref };
}

/**
 * useDeferredRender — renders children after a requestIdleCallback
 * (or setTimeout fallback) so the main thread isn't blocked during
 * startup or tab switches.
 *
 * @param {number} [delay=0] — minimum ms before rendering
 */
export function useDeferredRender(delay = 0) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let id;
    if ('requestIdleCallback' in window) {
      id = requestIdleCallback(() => setReady(true), { timeout: Math.max(delay, 300) });
    } else {
      id = setTimeout(() => setReady(true), delay);
    }
    return () => {
      if ('cancelIdleCallback' in window) cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [delay]);

  return ready;
}
