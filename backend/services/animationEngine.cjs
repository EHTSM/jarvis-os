"use strict";
/**
 * ODI-27 Autonomous Animation Engine
 *
 * Analyzes a DOM snapshot to detect where animations would improve UX:
 *   - Entry animations: elements below fold that should animate in on scroll
 *   - Feedback animations: buttons/CTAs that lack click feedback (ripple/press)
 *   - State transitions: tabpanels/modals/accordions missing transitions
 *   - Loading animations: spinners, skeleton pulse
 *   - Micro-interactions: hover states, focus rings
 *
 * Respects:
 *   - prefers-reduced-motion: all animations wrapped in @media check
 *   - WCAG 2.3.3: animations can be disabled
 *
 * Outputs: Tailwind animation class suggestions + CSS @keyframe definitions
 * Storage: data/odi/animations/
 */

const fs   = require("fs");
const path = require("path");

const ANIM_DIR = path.join(__dirname, "../../data/odi/animations");
function _ensureDir() { if (!fs.existsSync(ANIM_DIR)) fs.mkdirSync(ANIM_DIR, { recursive: true }); }

// ── Animation suggestion catalog ──────────────────────────────────────────────

const ANIMATION_CATALOG = {
  fadeIn: {
    tailwind:   "animate-fade-in",
    css:        `@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }`,
    usage:      "Entry animation for page sections and cards",
    reducedSafe:false,
    duration:   "300ms",
  },
  slideUp: {
    tailwind:   "animate-slide-up",
    css:        `@keyframes slide-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`,
    usage:      "Entry animation for list items and modals",
    reducedSafe:false,
    duration:   "250ms",
  },
  scaleIn: {
    tailwind:   "animate-scale-in",
    css:        `@keyframes scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`,
    usage:      "Dialog/modal open animation",
    reducedSafe:false,
    duration:   "200ms",
  },
  pulse: {
    tailwind:   "animate-pulse",
    css:        `/* Built-in Tailwind */`,
    usage:      "Skeleton loading placeholder",
    reducedSafe:true,
    duration:   "2s",
  },
  spin: {
    tailwind:   "animate-spin",
    css:        `/* Built-in Tailwind */`,
    usage:      "Loading spinner",
    reducedSafe:true,
    duration:   "1s",
  },
  pressEffect: {
    tailwind:   "active:scale-95 transition-transform duration-100",
    css:        "",
    usage:      "Button press feedback",
    reducedSafe:true,
    duration:   "100ms",
  },
  hoverLift: {
    tailwind:   "hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200",
    css:        "",
    usage:      "Card hover lift effect",
    reducedSafe:false,
    duration:   "200ms",
  },
  focusRing: {
    tailwind:   "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus:outline-none",
    css:        "",
    usage:      "Keyboard focus indicator for all interactive elements",
    reducedSafe:true,
    duration:   "instant",
  },
};

// ── DOM-based animation detector ──────────────────────────────────────────────

function detectAnimationOpportunities(domSnapshot) {
  const { nodes = [], viewport = { width: 1280, height: 900 } } = domSnapshot;
  const suggestions = [];

  // 1. Buttons without press feedback
  const buttons = nodes.filter(n => n.tag === "button" || n.attrs?.role === "button");
  for (const btn of buttons) {
    const hasActive = (btn.classes || []).some(c => c.includes("active:") || c.includes("transition"));
    if (!hasActive && btn.visibility?.isVisible) {
      suggestions.push({
        type:      "missing_press_feedback",
        element:   { nodeId: btn.nodeId, tag: btn.tag, classes: btn.classes },
        animation: ANIMATION_CATALOG.pressEffect,
        priority:  "high",
        rationale: "Buttons need visual feedback on press for UX confidence",
      });
    }
  }

  // 2. Cards without hover lift
  const cards = nodes.filter(n => {
    const cls = (n.classes || []).join(" ");
    return cls.includes("card") || cls.includes("shadow") || (n.spacing?.borderRadius && parseFloat(n.spacing.borderRadius) > 4);
  });
  for (const card of cards.slice(0, 5)) {
    const hasHover = (card.classes || []).some(c => c.includes("hover:"));
    if (!hasHover && card.visibility?.isVisible) {
      suggestions.push({
        type:      "missing_hover_lift",
        element:   { nodeId: card.nodeId, tag: card.tag, classes: card.classes },
        animation: ANIMATION_CATALOG.hoverLift,
        priority:  "medium",
        rationale: "Cards should respond to hover to indicate interactivity",
      });
    }
  }

  // 3. All interactive elements without focus ring
  const interactive = nodes.filter(n => ["button", "a", "input", "select"].includes(n.tag) && n.visibility?.isVisible);
  const missingFocus = interactive.filter(n => !(n.classes || []).some(c => c.includes("focus")));
  if (missingFocus.length > interactive.length * 0.5) {
    suggestions.push({
      type:      "missing_focus_rings",
      count:     missingFocus.length,
      animation: ANIMATION_CATALOG.focusRing,
      priority:  "high",
      rationale: "Keyboard accessibility requires visible focus indicators on all interactive elements",
    });
  }

  // 4. Elements below fold (scroll entry animations)
  const belowFold = nodes.filter(n => n.visibility?.isVisible && n.bbox?.y > viewport.height && n.bbox?.h > 50);
  if (belowFold.length > 2) {
    suggestions.push({
      type:      "scroll_entry_animations",
      count:     belowFold.length,
      animation: ANIMATION_CATALOG.slideUp,
      priority:  "low",
      rationale: `${belowFold.length} elements below fold — slide-up entry animation on scroll improves perceived performance`,
      implementation: "Use Intersection Observer API with animate-slide-up class",
    });
  }

  // 5. Skeleton loading opportunities
  const hasLoading = nodes.some(n => (n.classes || []).some(c => c.includes("loading") || c.includes("skeleton") || c.includes("pulse")));
  if (!hasLoading && nodes.length > 3) {
    suggestions.push({
      type:      "missing_loading_skeleton",
      animation: ANIMATION_CATALOG.pulse,
      priority:  "medium",
      rationale: "No skeleton loading detected — add animate-pulse placeholders for data fetch states",
    });
  }

  return suggestions;
}

// ── CSS output generator ───────────────────────────────────────────────────────

function generateAnimationCSS(suggestions) {
  const keyframes = new Set();
  const utilityClasses = [];

  for (const s of suggestions) {
    if (s.animation?.css && !s.animation.css.includes("Built-in")) {
      keyframes.add(s.animation.css);
    }
    utilityClasses.push(s.animation?.tailwind || "");
  }

  const cssBlocks = [...keyframes].map(kf => kf).join("\n\n");

  // Generate custom Tailwind-compatible animation definitions
  const tailwindAnimations = {
    "fade-in": "fade-in 300ms ease-out both",
    "slide-up": "slide-up 250ms ease-out both",
    "scale-in": "scale-in 200ms ease-out both",
  };

  const reducedMotionCSS = `
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}`;

  return {
    keyframes: cssBlocks,
    reducedMotion: reducedMotionCSS,
    tailwindExtend: { animation: tailwindAnimations },
    utilityClasses: [...new Set(utilityClasses.filter(Boolean))],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function analyzeAnimations({ domFilename, domSnapshot } = {}) {
  let snapshot = domSnapshot;
  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  const suggestions = detectAnimationOpportunities(snapshot);
  const css = generateAnimationCSS(suggestions);

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `anim-${slug}.json`;
  const record   = { url: snapshot.url, suggestions, css, counts: { high: suggestions.filter(s => s.priority === "high").length, medium: suggestions.filter(s => s.priority === "medium").length, low: suggestions.filter(s => s.priority === "low").length }, timestamp: new Date().toISOString() };

  fs.writeFileSync(path.join(ANIM_DIR, filename), JSON.stringify(record, null, 2));

  return { ok: true, filename, path: `data/odi/animations/${filename}`, suggestions: suggestions.length, ...record.counts, css, suggestions };
}

function listReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(ANIM_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ANIM_DIR, f), "utf8"));
        return { filename: f, url: d.url, suggestions: d.suggestions?.length, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeAnimations, detectAnimationOpportunities, generateAnimationCSS, listReports, ANIMATION_CATALOG };
