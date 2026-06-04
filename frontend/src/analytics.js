/**
 * Ooplix Analytics Layer
 *
 * Wraps GA4 (gtag) and GTM dataLayer pushes.
 * All methods are safe to call when the trackers haven't loaded yet —
 * they queue events via the same stub pattern GA4 uses.
 *
 * Environment gates:
 *   REACT_APP_GA4_ID      — GA4 Measurement ID  (e.g. G-XXXXXXXXXX)
 *   REACT_APP_GTM_ID      — GTM Container ID     (e.g. GTM-XXXXXXX)
 *
 * Usage:
 *   import { track } from './analytics';
 *   track.signupStarted();
 *   track.event('custom_event', { label: 'foo' });
 */

// ── Internal helpers ────────────────────────────────────────────────

function _gtag(...args) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(arguments); // GA4 uses `arguments`, not spread
}

function _safe(fn) {
  try { fn(); } catch (_) { /* never break the app over analytics */ }
}

// ── Core event push ─────────────────────────────────────────────────

export function event(name, params = {}) {
  _safe(() => {
    // GTM dataLayer push (always)
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ...params });

    // GA4 gtag send (only when GA4 is loaded)
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params);
    }
  });
}

// ── Named event helpers ─────────────────────────────────────────────
// Structured event catalogue — keeps the entire event taxonomy in one file.

export const track = {
  /** User clicked the primary CTA / started the signup flow */
  signupStarted: (source = "landing") =>
    event("signup_started", { source }),

  /** Onboarding form completed — profile saved to localStorage */
  signupCompleted: (bizType = "") =>
    event("signup_completed", { business_type: bizType }),

  /** User authenticated successfully */
  login: (method = "local") =>
    event("login", { method }),

  /** WhatsApp Business API connected */
  whatsappConnected: () =>
    event("whatsapp_connected"),

  /** User clicked "Generate payment link" */
  paymentStarted: (amount = 0) =>
    event("payment_started", { currency: "INR", value: amount }),

  /** Razorpay checkout completed / webhook confirmed */
  paymentCompleted: (amount = 0) =>
    event("payment_completed", { currency: "INR", value: amount }),

  /** Trial period begun (first app load after onboarding) */
  trialStarted: () =>
    event("trial_started"),

  /** Command Palette opened */
  commandPaletteOpened: (trigger = "keyboard") =>
    event("command_palette_opened", { trigger }),

  /** Navigation via tab */
  tabChanged: (tabId) =>
    event("tab_changed", { tab: tabId }),

  /** Task dispatched from Control Center */
  taskDispatched: () =>
    event("task_dispatched"),

  /** Generic escape hatch */
  event,
};

// ── Page view ───────────────────────────────────────────────────────

export function pageView(path = window.location.pathname) {
  _safe(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: "page_view", page_path: path });
    if (typeof window.gtag === "function") {
      window.gtag("event", "page_view", { page_path: path });
    }
  });
}
