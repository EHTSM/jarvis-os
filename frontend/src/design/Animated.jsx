/**
 * Ooplix Animated Primitives
 *
 * Pre-built animated components that apply the motion system.
 * Drop these in wherever a generic motion.div would go.
 *
 * All components automatically respect prefers-reduced-motion via useMotionSafe.
 */

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  fadeUp,
  fadeIn,
  scaleIn,
  slideDown,
  staggerContainer,
  staggerItem,
  feedRowVariants,
  execStateVariants,
  statusDotVariants,
  pulseDotOk,
  pulseDotCrit,
  thinkingScanStyle,
  thinkingScanAnim,
  thinkingScanTransition,
  approvalExitApprove,
  approvalExitReject,
  spring,
  transition,
  presenceConfig,
} from "./motion";

// ─────────────────────────────────────────────────────────────────────────────
// FadeUp — standard page section / card appear
// ─────────────────────────────────────────────────────────────────────────────

export function FadeUp({ children, delay = 0, className, style }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={reduced ? { duration: 0.01 } : { delay }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FadeIn — simple opacity transition
// ─────────────────────────────────────────────────────────────────────────────

export function FadeIn({ children, delay = 0, className, style }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={reduced ? { duration: 0.01 } : { delay }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScaleIn — modal / popover / dropdown appear
// ─────────────────────────────────────────────────────────────────────────────

export function ScaleIn({ children, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SlideDown — sub-nav, dropdown reveal
// ─────────────────────────────────────────────────────────────────────────────

export function SlideDown({ children, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={slideDown}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StaggerList — animates children in sequence
// Wrap a list of items; children should use StaggerItem
// ─────────────────────────────────────────────────────────────────────────────

export function StaggerList({ children, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerItem}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeedRow — Mission Feed row with entry/exit animation
// ─────────────────────────────────────────────────────────────────────────────

export function FeedRow({ children, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={feedRowVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
      layoutId={undefined}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecStateCard — card border/bg changes based on execution state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * execState: "idle" | "queued" | "running" | "thinking" | "done" | "error" | "paused"
 */
export function ExecStateCard({ children, execState = "idle", className, style }) {
  return (
    <motion.div
      className={className}
      style={{ border: "1px solid", borderRadius: 14, ...style }}
      variants={execStateVariants}
      animate={execState}
      initial={execState}
    >
      {children}

      {/* Thinking scan overlay */}
      {execState === "thinking" && (
        <motion.div
          style={thinkingScanStyle}
          animate={thinkingScanAnim}
          transition={thinkingScanTransition}
        />
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusDot — animated execution state indicator dot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * size: "sm" (6px) | "md" (8px, default) | "lg" (10px)
 * execState: "idle" | "queued" | "running" | "thinking" | "done" | "error" | "paused"
 */
export function StatusDot({ execState = "idle", size = "md" }) {
  const sizeMap = { sm: 6, md: 8, lg: 10 };
  const px = sizeMap[size] ?? 8;

  return (
    <motion.span
      style={{
        display: "inline-block",
        width: px,
        height: px,
        borderRadius: "50%",
        flexShrink: 0,
      }}
      variants={statusDotVariants}
      animate={execState}
      initial={execState}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PulseDot — health indicator with continuous pulse
// ─────────────────────────────────────────────────────────────────────────────

export function PulseDot({ status = "ok", size = 8 }) {
  return (
    <motion.span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: status === "ok" ? "#52d68a" : "#f55b5b",
        flexShrink: 0,
      }}
      animate={status === "ok" ? pulseDotOk : pulseDotCrit}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PresencePage — wraps a page-level view for enter/exit
// ─────────────────────────────────────────────────────────────────────────────

export function PresencePage({ id, children, className, style }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        className={className}
        style={style}
        initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
        transition={transition.enter}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PresenceList — wraps a list for AnimatePresence (add/remove items)
// ─────────────────────────────────────────────────────────────────────────────

export function PresenceList({ children, className, style }) {
  return (
    <AnimatePresence {...presenceConfig.listUpdate}>
      <motion.div
        className={className}
        style={style}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalCard — with swipe-like approve/reject exit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * onApprove / onReject: called after exit animation completes
 * status: null | "approved" | "rejected"
 */
export function AnimatedApprovalCard({ children, status, className, style }) {
  const exitVariant =
    status === "approved" ? approvalExitApprove :
    status === "rejected" ? approvalExitReject  : undefined;

  return (
    <AnimatePresence>
      {!status && (
        <motion.div
          className={className}
          style={style}
          variants={staggerItem}
          initial="hidden"
          animate="visible"
          exit={exitVariant ?? "exit"}
          layout
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric — value that flashes on change
// ─────────────────────────────────────────────────────────────────────────────

/**
 * direction: "up" | "down" | null
 * On direction change, briefly flashes green (up) or red (down).
 */
export function MetricValue({ value, direction = null, className, style }) {
  const colors = {
    up:   ["var(--text-primary, #fff)", "#52d68a", "var(--text-primary, #fff)"],
    down: ["var(--text-primary, #fff)", "#f55b5b", "var(--text-primary, #fff)"],
    null: undefined,
  };

  return (
    <motion.span
      key={`${value}-${direction}`}
      className={className}
      style={style}
      animate={
        direction
          ? {
              scale: [1, 1.08, 1],
              color: colors[direction],
              transition: { duration: 0.5, ease: [0.175, 0.885, 0.32, 1.275] },
            }
          : {}
      }
    >
      {value}
    </motion.span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PressButton — spring scale on tap
// ─────────────────────────────────────────────────────────────────────────────

export function PressButton({ children, onClick, className, style, disabled }) {
  return (
    <motion.button
      className={className}
      style={style}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
    >
      {children}
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoneNavItem — zone nav button with active indicator
// ─────────────────────────────────────────────────────────────────────────────

export function ZoneNavItem({ children, isActive, onClick, className, style }) {
  return (
    <motion.button
      className={className}
      style={style}
      onClick={onClick}
      animate={{ opacity: isActive ? 1 : 0.55 }}
      whileHover={{ opacity: 1, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
    >
      {children}
    </motion.button>
  );
}
