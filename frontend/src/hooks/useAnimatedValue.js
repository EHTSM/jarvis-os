import { useState, useEffect, useRef } from "react";

/**
 * Smoothly animates a numeric value to its new target over `duration` ms.
 * Returns the current interpolated value (integer).
 * On first render returns the target immediately (no animation on mount).
 */
export function useAnimatedValue(target, duration = 600) {
  const numTarget    = Number(target) || 0;
  const [current, setCurrent] = useState(numTarget);
  const fromRef      = useRef(numTarget);
  const startRef     = useRef(null);
  const rafRef       = useRef(null);
  const prevTarget   = useRef(numTarget);

  useEffect(() => {
    if (numTarget === prevTarget.current) return;

    fromRef.current  = prevTarget.current;
    prevTarget.current = numTarget;
    startRef.current   = null;

    const ease = (t) => t < 0.5
      ? 2 * t * t
      : -1 + (4 - 2 * t) * t;

    const tick = (now) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const val = fromRef.current + (numTarget - fromRef.current) * ease(progress);
      setCurrent(Math.round(val));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setCurrent(numTarget);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [numTarget, duration]);

  return current;
}
