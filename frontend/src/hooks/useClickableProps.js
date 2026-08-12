/**
 * Phase B19.1 — keyboard recovery for clickable non-interactive elements.
 *
 * Many rows, cards and headers in the app carry an `onClick` on a plain <div>
 * or <span>. Those are real controls to a mouse user but did not exist at all
 * for a keyboard user: no focus stop, no Enter/Space activation.
 *
 * `clickableProps(onClick, opts)` returns the attributes that make such an
 * element behave the way it already looked like it behaved. Visual output is
 * unchanged — `[role="button"]:focus-visible` styling already ships in
 * polish.css, so focus becomes visible without any new CSS.
 *
 *   <div {...clickableProps(() => select(id))} className="row">…</div>
 *
 * Enter and Space both activate, matching native <button>. Space is
 * preventDefault-ed so activating a control never scrolls the page.
 *
 * Prefer a real <button> for new code; this exists to recover the keyboard
 * path for the existing div/span controls without restyling them.
 */

export function clickableProps(onClick, opts = {}) {
  const { role = 'button', disabled = false, label, stopPropagation = false } = opts;

  if (disabled) {
    return { role, 'aria-disabled': true, tabIndex: -1, ...(label ? { 'aria-label': label } : {}) };
  }

  const activate = (e) => {
    if (stopPropagation) e.stopPropagation();
    onClick?.(e);
  };

  return {
    role,
    tabIndex: 0,
    onClick: activate,
    onKeyDown: (e) => {
      // Ignore keys bubbling up from a nested input/button that handles its own.
      if (e.target !== e.currentTarget && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        activate(e);
      }
    },
    ...(label ? { 'aria-label': label } : {}),
  };
}

/**
 * Backdrop/overlay dismissal. An overlay is not a control: it must not take
 * focus or appear in the tab order. Its keyboard equivalent is Escape, which
 * `useEscapeKey` binds. Marked aria-hidden so the backdrop itself is not
 * announced; the dialog above it carries the accessible content.
 */
export function overlayProps(onDismiss) {
  return {
    onClick: (e) => { if (e.target === e.currentTarget) onDismiss?.(e); },
    'aria-hidden': true,
  };
}

export default clickableProps;
