/**
 * GuidedTour — lightweight interactive tour overlay.
 * Highlights key UI areas step-by-step with a dismissible tooltip.
 * No library dependencies beyond framer-motion (already installed).
 */
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./GuidedTour.css";

const TOUR_KEY = "ooplix_tour_done";

const STEPS = [
  {
    id: "cmdK",
    target: ".palette-trigger",
    title: "Command Palette",
    body: "Press ⌘K to search everything — tabs, missions, contacts, commands. The fastest way to navigate.",
    placement: "bottom",
  },
  {
    id: "tabs",
    target: ".tabs",
    title: "Primary Navigation",
    body: "Dashboard, Contacts, Payments, Pipeline, AI Chat. The More menu holds 65+ additional modules.",
    placement: "bottom",
  },
  {
    id: "ai",
    target: ".tab[aria-label='AI Chat'],.tab:nth-child(5)",
    title: "AI Assistant",
    body: "Ask anything, run shell commands, trigger workflows, or start autonomous missions — all from here.",
    placement: "bottom",
  },
  {
    id: "status",
    target: ".topbar-status",
    title: "Live Status",
    body: "Green means your backend is live and agents are active. Click the status dot to view system health.",
    placement: "bottom",
  },
];

function getTargetRect(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    return el.getBoundingClientRect();
  } catch { return null; }
}

export function useTour() {
  const [active, setActive] = useState(false);

  const start = () => setActive(true);
  const stop  = () => {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
    setActive(false);
  };

  return { active, start, stop };
}

export default function GuidedTour({ onFinish }) {
  const [step,    setStep]    = useState(0);
  const [rect,    setRect]    = useState(null);
  const [visible, setVisible] = useState(false);

  const current = STEPS[step];

  useEffect(() => {
    // Small delay to let DOM settle
    const t = setTimeout(() => {
      const r = getTargetRect(current.target);
      setRect(r);
      setVisible(true);
    }, 150);
    return () => clearTimeout(t);
  }, [step, current.target]);

  const next = () => {
    setVisible(false);
    setTimeout(() => {
      if (step < STEPS.length - 1) {
        setStep(s => s + 1);
      } else {
        try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
        onFinish?.();
      }
    }, 140);
  };

  const skip = () => {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
    onFinish?.();
  };

  if (!rect) return null;

  // Spotlight position
  const pad = 6;
  const spotlight = {
    left:   rect.left   - pad,
    top:    rect.top    - pad,
    width:  rect.width  + pad * 2,
    height: rect.height + pad * 2,
  };

  // Tooltip position — below target by default
  const tooltipLeft = Math.max(12, Math.min(rect.left, window.innerWidth - 300));
  const tooltipTop  = rect.bottom + 14;

  return (
    <div className="gt-overlay" onClick={e => { if (e.target === e.currentTarget) skip(); }}>
      {/* Dark mask with spotlight cutout */}
      <svg className="gt-mask" width="100%" height="100%">
        <defs>
          <mask id="gt-spot">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={spotlight.left}
              y={spotlight.top}
              width={spotlight.width}
              height={spotlight.height}
              rx={8}
              fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#gt-spot)" />
      </svg>

      {/* Spotlight border ring */}
      <div
        className="gt-spotlight-ring"
        style={{
          left:   spotlight.left,
          top:    spotlight.top,
          width:  spotlight.width,
          height: spotlight.height,
        }}
      />

      {/* Tooltip */}
      <AnimatePresence>
        {visible && (
          <motion.div
            className="gt-tooltip"
            style={{ left: tooltipLeft, top: tooltipTop }}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <div className="gt-tooltip-header">
              <span className="gt-step-count">{step + 1} / {STEPS.length}</span>
              <button className="gt-skip" onClick={skip}>Skip tour</button>
            </div>
            <h3 className="gt-title">{current.title}</h3>
            <p className="gt-body">{current.body}</p>
            <div className="gt-footer">
              <div className="gt-dots">
                {STEPS.map((_, i) => (
                  <span key={i} className={`gt-dot${i === step ? " gt-dot--active" : i < step ? " gt-dot--done" : ""}`} />
                ))}
              </div>
              <button className="gt-next" onClick={next}>
                {step < STEPS.length - 1 ? "Next →" : "Done ✓"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
