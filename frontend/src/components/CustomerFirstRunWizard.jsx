import React, { useState, useCallback } from "react";
import "./CustomerFirstRunWizard.css";

// Real customer-facing first-run wizard — shown once after signup. Distinct
// from FirstRunSetup.jsx (components/operator/widgets/), which is the
// founder/operator's own onboarding covering risk levels, dry-run mode, and
// runtime health — none of which apply to a regular customer.

const FR_KEY = "jarvis_customer_first_run_done";

const STEPS = [
  {
    id: "welcome",
    icon: "⚡",
    title: "Welcome to Ooplix",
    body: "Your 7-day free trial has started. Here's how to get the most out of it in the next few minutes.",
    cta: "Let's go",
  },
  {
    id: "lead",
    icon: "◈",
    title: "Add your first lead",
    body: "Track deals, contacts, and revenue in your CRM. Add one real lead now to see your pipeline come alive.",
    cta: "Go to CRM",
    tab: "business",
  },
  {
    id: "team",
    icon: "👥",
    title: "Invite your team",
    body: "Ooplix works better with your team in it. Invite a teammate by email — they'll get a link to join.",
    cta: "Invite a teammate",
    tab: "orgadmin",
  },
  {
    id: "connect",
    icon: "🔌",
    title: "Connect a channel",
    body: "Link WhatsApp, email, or payments so Ooplix can act on your behalf — send follow-ups, collect payments, and more.",
    cta: "Set up connectors",
    tab: "integrations",
  },
  {
    id: "done",
    icon: "✅",
    title: "You're set up",
    body: "Explore the Dashboard for your pipeline, trial status, and AI usage. Reach out anytime from the Help menu.",
    cta: "Start using Ooplix",
  },
];

export function shouldShowCustomerFirstRun() {
  try { return !localStorage.getItem(FR_KEY); } catch { return false; }
}

export default function CustomerFirstRunWizard({ onComplete, onNavigate }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const finish = useCallback((skipped = false) => {
    try { localStorage.setItem(FR_KEY, JSON.stringify({ doneAt: new Date().toISOString(), skipped })); } catch { /* no-op */ }
    onComplete?.();
  }, [onComplete]);

  const next = useCallback(() => {
    if (current.tab) onNavigate?.(current.tab);
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else finish(false);
  }, [step, current, onNavigate, finish]);

  return (
    <div className="cfr-backdrop">
      <div className="cfr-card">
        <div className="cfr-progress">
          {STEPS.map((_, i) => (
            <div key={i} className={`cfr-dot ${i < step ? "past" : i === step ? "current" : "future"}`} />
          ))}
          <span className="cfr-step-count">{step + 1}/{STEPS.length}</span>
        </div>

        <div className="cfr-icon">{current.icon}</div>
        <h2 className="cfr-title">{current.title}</h2>
        <p className="cfr-body">{current.body}</p>

        <div className="cfr-actions">
          <button className="cfr-btn-primary" onClick={next}>{current.cta} →</button>
          {step < STEPS.length - 1 && (
            <button className="cfr-btn-skip" onClick={() => finish(true)}>Skip for now</button>
          )}
        </div>
      </div>
    </div>
  );
}
