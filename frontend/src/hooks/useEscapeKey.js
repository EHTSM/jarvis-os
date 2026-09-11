import { useEffect } from "react";

/**
 * Phase B19.1 — dismiss-on-Escape for modals and drawers.
 *
 * Several modals could only be dismissed by clicking the backdrop, which is a
 * mouse-only affordance: a keyboard user who opened one had no way to close it.
 * This binds Escape to the same dismiss handler the backdrop already calls, so
 * the keyboard path matches the mouse path exactly.
 *
 *   useEscapeKey(open, onClose);
 *
 * The listener is only attached while `active` is true, and is bound in the
 * capture phase so a dialog closes even when focus sits in a nested input.
 */
export function useEscapeKey(active, onClose) {
  useEffect(() => {
    if (!active || typeof onClose !== "function") return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "Esc") {
        e.stopPropagation();
        onClose(e);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, onClose]);
}

export default useEscapeKey;
