/**
 * Ooplix Motion System — Framer Motion animation library
 *
 * Import:
 *   import { variants, spring, transition, useExecState } from '../design/motion';
 *
 * Usage pattern:
 *   <motion.div variants={variants.fadeUp} initial="hidden" animate="visible" />
 *
 * All durations in seconds (Framer Motion convention).
 * All variants are designed to work with AnimatePresence for enter/exit.
 */

import { useReducedMotion } from "framer-motion";

// ─────────────────────────────────────────────────────────────────────────────
// Spring configs — tuned for OS feel (fast, decisive, not bouncy)
// ─────────────────────────────────────────────────────────────────────────────

export const spring = {
  /** Buttons, badges, small state changes */
  snappy: { type: "spring", stiffness: 500, damping: 32, mass: 1 },

  /** Cards, panels, medium transitions */
  crisp:  { type: "spring", stiffness: 350, damping: 28, mass: 1 },

  /** Zone navigation, page-level transitions */
  smooth: { type: "spring", stiffness: 220, damping: 24, mass: 1 },

  /** Modals, drawers, large surfaces */
  float:  { type: "spring", stiffness: 160, damping: 20, mass: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Easing curves — mirrors CSS custom properties in index.css
// ─────────────────────────────────────────────────────────────────────────────

export const ease = {
  out:    [0.16, 1, 0.3, 1],
  in:     [0.4, 0, 1, 1],
  std:    [0.25, 0.46, 0.45, 0.94],
  spring: [0.22, 1, 0.36, 1],
  back:   [0.175, 0.885, 0.32, 1.275],
};

// ─────────────────────────────────────────────────────────────────────────────
// Duration (seconds)
// ─────────────────────────────────────────────────────────────────────────────

export const dur = {
  instant:  0.08,
  fast:     0.14,
  standard: 0.22,
  enter:    0.28,
  slow:     0.36,
  breathe:  2.4,
};

// ─────────────────────────────────────────────────────────────────────────────
// transition helpers — pre-built transition objects
// ─────────────────────────────────────────────────────────────────────────────

export const transition = {
  /** Instant UI response (press, toggle) */
  instant:  { duration: dur.instant, ease: ease.out },

  /** Fast state swap (badge, dot, status) */
  fast:     { duration: dur.fast,    ease: ease.out },

  /** Standard element transition */
  standard: { duration: dur.standard, ease: ease.spring },

  /** Page/panel enter */
  enter:    { duration: dur.enter, ease: ease.spring },

  /** Slow emphasis (modal, overlay) */
  slow:     { duration: dur.slow, ease: ease.spring },

  /** Spring button */
  button:   spring.snappy,

  /** Spring card */
  card:     spring.crisp,

  /** Spring panel */
  panel:    spring.smooth,

  /** Spring modal */
  modal:    spring.float,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant sets — ready to pass to motion components
// ─────────────────────────────────────────────────────────────────────────────

/** Fade up — page enter, row enter, card enter */
export const fadeUp = {
  hidden:  { opacity: 0, y: 10, filter: "blur(2px)" },
  visible: { opacity: 1, y: 0,  filter: "blur(0px)", transition: transition.enter },
  exit:    { opacity: 0, y: -6, filter: "blur(2px)", transition: { duration: dur.fast, ease: ease.in } },
};

/** Fade in — simple opacity only */
export const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: transition.standard },
  exit:    { opacity: 0, transition: transition.fast },
};

/** Scale in — modal, popover, tooltip */
export const scaleIn = {
  hidden:  { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1,   transition: transition.modal },
  exit:    { opacity: 0, scale: 0.98, transition: { duration: dur.fast, ease: ease.in } },
};

/** Slide down — dropdown menus, sub-navs */
export const slideDown = {
  hidden:  { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: transition.panel },
  exit:    { opacity: 0, y: -6, transition: transition.fast },
};

/** Slide right — drawer open */
export const slideRight = {
  hidden:  { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: transition.panel },
  exit:    { opacity: 0, x: 20, transition: transition.fast },
};

/** Slide up — approval card enters from below */
export const slideUp = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0,  transition: transition.card },
  exit:    { opacity: 0, y: -8, scale: 0.97, transition: { ...transition.fast } },
};

/** Stagger container — apply to list parent */
export const staggerContainer = {
  hidden:  {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren:   0.02,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};

/** Stagger item — apply to each list child */
export const staggerItem = {
  hidden:  { opacity: 0, y: 8, filter: "blur(1px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: transition.enter },
  exit:    { opacity: 0, y: -4, transition: transition.fast },
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution state motion — the OS process state animation system
// Each state has: initial, animate, exit.
// Apply to AgentCard, ExecRow, ApprovalCard borders.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * execStateVariants — animate the visual state of an execution container.
 * Drive with state = "idle" | "queued" | "running" | "thinking" | "done" | "error" | "paused"
 *
 * Usage:
 *   <motion.div
 *     variants={execStateVariants}
 *     animate={execState}       // "running", "done", etc.
 *     initial="idle"
 *   />
 */
export const execStateVariants = {
  idle: {
    backgroundColor: "rgba(124, 111, 255, 0.00)",
    borderColor:     "rgba(255, 255, 255, 0.07)",
    boxShadow:       "none",
    transition:      transition.standard,
  },
  queued: {
    backgroundColor: "rgba(124, 111, 255, 0.06)",
    borderColor:     "rgba(124, 111, 255, 0.16)",
    boxShadow:       "none",
    transition:      transition.standard,
  },
  running: {
    backgroundColor: "rgba(124, 111, 255, 0.12)",
    borderColor:     "rgba(124, 111, 255, 0.30)",
    boxShadow:       "0 0 0 1px rgba(124,111,255,0.30), 0 0 18px rgba(124,111,255,0.12)",
    transition:      transition.card,
  },
  thinking: {
    backgroundColor: "rgba(78, 205, 196, 0.10)",
    borderColor:     "rgba(78, 205, 196, 0.26)",
    boxShadow:       "0 0 0 1px rgba(78,205,196,0.26), 0 0 18px rgba(78,205,196,0.10)",
    transition:      transition.card,
  },
  done: {
    backgroundColor: "rgba(82, 214, 138, 0.09)",
    borderColor:     "rgba(82, 214, 138, 0.22)",
    boxShadow:       "none",
    transition:      transition.standard,
  },
  error: {
    backgroundColor: "rgba(245, 91, 91, 0.10)",
    borderColor:     "rgba(245, 91, 91, 0.26)",
    boxShadow:       "none",
    transition:      transition.standard,
  },
  paused: {
    backgroundColor: "rgba(240, 180, 41, 0.08)",
    borderColor:     "rgba(240, 180, 41, 0.22)",
    boxShadow:       "none",
    transition:      transition.standard,
  },
};

/**
 * statusDotVariants — animate the StatusDot based on execution state.
 * Combines color and pulse animation.
 */
export const statusDotVariants = {
  idle:     { backgroundColor: "#4a5470", scale: 1 },
  queued:   { backgroundColor: "#7c6fff", scale: 1, opacity: 0.6 },
  running:  { backgroundColor: "#7c6fff", scale: [1, 1.3, 1], transition: { scale: { duration: dur.breathe, repeat: Infinity, ease: ease.std } } },
  thinking: { backgroundColor: "#4ecdc4", scale: [1, 1.3, 1], transition: { scale: { duration: dur.breathe, repeat: Infinity, ease: ease.std } } },
  done:     { backgroundColor: "#52d68a", scale: 1 },
  error:    { backgroundColor: "#f55b5b", scale: 1 },
  paused:   { backgroundColor: "#f0b429", scale: 1, opacity: 0.7 },
};

/**
 * completionResolve — the "done" flash when a task completes.
 * Apply to the primary value/label of a completed item.
 */
export const completionResolve = {
  initial: { scale: 1, color: "var(--text)" },
  animate: {
    scale:  [1, 1.06, 1],
    color:  ["var(--text)", "var(--success)", "var(--text)"],
    transition: { duration: 0.6, ease: ease.back },
  },
};

/**
 * approvalCardAttention — 3× border pulse then settle.
 * Apply to ApprovalCard on mount when priority is high/critical.
 */
export const approvalCardAttention = {
  initial: { borderColor: "rgba(255,255,255,0.07)" },
  animate: {
    borderColor: [
      "rgba(255,255,255,0.07)",
      "rgba(124,111,255,0.45)",
      "rgba(255,255,255,0.07)",
      "rgba(124,111,255,0.45)",
      "rgba(255,255,255,0.07)",
      "rgba(124,111,255,0.45)",
      "rgba(255,255,255,0.07)",
    ],
    transition: { duration: 3.6, ease: ease.std },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page transition — zone change
// ─────────────────────────────────────────────────────────────────────────────

export const pageVariants = {
  /** Enter from below */
  enterFromBelow: {
    hidden:  { opacity: 0, y: 12, filter: "blur(3px)" },
    visible: { opacity: 1, y: 0,  filter: "blur(0px)", transition: transition.enter },
    exit:    { opacity: 0, y: -8, filter: "blur(2px)", transition: { duration: dur.fast, ease: ease.in } },
  },

  /** Enter from right (zone forward navigation) */
  enterFromRight: {
    hidden:  { opacity: 0, x: 20, filter: "blur(2px)" },
    visible: { opacity: 1, x: 0,  filter: "blur(0px)", transition: transition.panel },
    exit:    { opacity: 0, x: -20, filter: "blur(2px)", transition: { duration: dur.fast, ease: ease.in } },
  },

  /** Enter from left (zone backward navigation) */
  enterFromLeft: {
    hidden:  { opacity: 0, x: -20, filter: "blur(2px)" },
    visible: { opacity: 1, x: 0,   filter: "blur(0px)", transition: transition.panel },
    exit:    { opacity: 0, x: 20,  filter: "blur(2px)", transition: { duration: dur.fast, ease: ease.in } },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Thinking scan — the LLM-processing state animation
// Apply as a motion.div overlay with pointer-events: none inside a row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * thinkingScan — horizontally scanning gradient shimmer.
 * Wrap the row with position:relative, then overlay this div.
 *
 * Usage:
 *   <motion.div
 *     style={thinkingScanStyle}
 *     animate={thinkingScanAnim}
 *     transition={thinkingScanTransition}
 *   />
 */
export const thinkingScanStyle = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(90deg, transparent 0%, rgba(78,205,196,0.10) 50%, transparent 100%)",
  backgroundSize: "200% 100%",
  pointerEvents: "none",
  borderRadius: "inherit",
};

export const thinkingScanAnim   = { backgroundPosition: ["-200% center", "300% center"] };
export const thinkingScanTransition = { duration: 1.8, repeat: Infinity, ease: "linear" };

// ─────────────────────────────────────────────────────────────────────────────
// Mission Feed row — new item arrival
// ─────────────────────────────────────────────────────────────────────────────

export const feedRowVariants = {
  hidden:  { opacity: 0, x: -8, filter: "blur(2px)" },
  visible: { opacity: 1, x: 0,  filter: "blur(0px)", transition: { ...transition.enter, delay: 0 } },
  exit:    { opacity: 0, x: 8,  filter: "blur(1px)", transition: transition.fast },
};

// ─────────────────────────────────────────────────────────────────────────────
// Approval card — approve/reject exit
// ─────────────────────────────────────────────────────────────────────────────

export const approvalExitApprove = {
  opacity:    0,
  scale:      0.97,
  x:          30,
  backgroundColor: "rgba(82,214,138,0.18)",
  transition: { duration: dur.standard, ease: ease.spring },
};

export const approvalExitReject = {
  opacity:    0,
  scale:      0.97,
  x:          -30,
  backgroundColor: "rgba(245,91,91,0.18)",
  transition: { duration: dur.standard, ease: ease.spring },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zone nav item — active indicator
// ─────────────────────────────────────────────────────────────────────────────

export const zoneNavItemVariants = {
  inactive: { scale: 1, opacity: 0.6, transition: transition.fast },
  active:   { scale: 1, opacity: 1.0, transition: transition.fast },
  hover:    { scale: 1.02,            transition: spring.snappy },
};

// ─────────────────────────────────────────────────────────────────────────────
// Health pulse dot — system state
// ─────────────────────────────────────────────────────────────────────────────

export const pulseDotOk = {
  scale:   [1, 1.3, 1],
  opacity: [1, 0.7, 1],
  transition: { duration: dur.breathe, repeat: Infinity, ease: ease.std },
};

export const pulseDotCrit = {
  scale:   [1, 1.4, 1],
  opacity: [1, 0.5, 1],
  backgroundColor: ["#f55b5b", "#ff8080", "#f55b5b"],
  transition: { duration: 1.2, repeat: Infinity, ease: ease.std },
};

// ─────────────────────────────────────────────────────────────────────────────
// Metric counter — value change flash
// ─────────────────────────────────────────────────────────────────────────────

export const metricUp = {
  scale: [1, 1.08, 1],
  color: ["var(--text)", "var(--success)", "var(--text)"],
  transition: { duration: 0.5, ease: ease.back },
};

export const metricDown = {
  scale: [1, 1.06, 1],
  color: ["var(--text)", "var(--danger)", "var(--text)"],
  transition: { duration: 0.5, ease: ease.back },
};

// ─────────────────────────────────────────────────────────────────────────────
// useMotionSafe — respects prefers-reduced-motion
// Wraps any variant set and returns instant transitions if reduced motion active
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useMotionSafe(variants) → safe variants
 * If user prefers reduced motion, replaces all transitions with instant opacity.
 *
 * Usage:
 *   const safeVariants = useMotionSafe(fadeUp);
 *   <motion.div variants={safeVariants} initial="hidden" animate="visible" />
 */
export function useMotionSafe(variants) {
  const reduced = useReducedMotion();
  if (!reduced) return variants;

  // Strip all animations, keep only opacity transitions
  return Object.fromEntries(
    Object.entries(variants).map(([key, value]) => [
      key,
      {
        opacity: value.opacity ?? 1,
        transition: { duration: 0.01 },
      },
    ])
  );
}

/**
 * useSafeSpring(springConfig) → safe spring
 * Returns instant transition if reduced motion is preferred.
 */
export function useSafeSpring(springConfig) {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0.01 } : springConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// AnimatePresence wrapper config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * presenceProps — default props for AnimatePresence.
 * Use mode="wait" for page transitions (one page exits before next enters).
 * Use mode="popLayout" for lists where items shift position on remove.
 */
export const presenceConfig = {
  pageTransition: { mode: "wait",      initial: false },
  listUpdate:     { mode: "popLayout", initial: false },
  overlay:        { mode: "wait",      initial: true  },
};
