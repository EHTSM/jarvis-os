"use strict";
import React, { useState, useEffect, useCallback } from "react";
import { recordFrictionEvent } from "../../../hooks/useProductivityAnalytics";

const FR_KEY = "jarvis_first_run_done";
const STEPS = [
  {
    id: "welcome",
    title: "Welcome to Ooplix",
    icon: "⚡",
    body: "Ooplix is your workspace for running tasks, managing clients, and automating follow-ups. Let's check that everything is connected.",
    cta: "Let's go",
  },
  {
    id: "runtime",
    title: "Checking your connection",
    icon: "🔗",
    body: "Ooplix stays connected in the background. If it ever disconnects (yellow banner), it reconnects on its own — usually within 30 seconds. No action needed.",
    education: "Tip: Press ⌘K to search commands, Ctrl+D to run, Ctrl+H for history.",
    cta: "Looks good",
  },
  {
    id: "safety",
    title: "Safe by default",
    icon: "🛡️",
    body: "Anything risky (deleting files, dropping databases) shows a warning and asks you to confirm first. You can always use Dry Run mode to preview what a command will do before it runs.",
    education: "Every command shows a risk level: SAFE · OPERATIONAL · ELEVATED · DANGEROUS.",
    cta: "Got it",
  },
  {
    id: "done",
    title: "You're all set",
    icon: "✅",
    body: "Start by typing a command, or install a template pack from the Workflow panel to get pre-built shortcuts. If anything goes wrong, the ? Help button has answers.",
    cta: "Open Ooplix",
    releaseNotes: [
      "Install template packs from the Workflow panel → ▼ Install Template Pack",
      "Press ⌘K to search commands, macros, and quick actions",
      "If something breaks: Feedback → 📦 Diagnostics downloads a full report",
    ],
  },
];

export const FirstRunSetup = React.memo(({ onComplete, rtStatus }) => {
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(false);
  const [healthOk, setHealthOk] = useState(null);

  const current = STEPS[step];

  useEffect(() => {
    if (current.id === "runtime") {
      setChecking(true);
      fetch("/api/health", { credentials: "include" })
        .then(r => setHealthOk(r.ok))
        .catch(() => setHealthOk(false))
        .finally(() => setChecking(false));
    }
  }, [current.id]);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      try { localStorage.setItem(FR_KEY, JSON.stringify({ doneAt: new Date().toISOString() })); } catch {}
      onComplete?.();
    }
  }, [step, onComplete]);

  const skip = useCallback(() => {
    recordFrictionEvent("onboarding_skip", { atStep: step, stepId: STEPS[step]?.id });
    try { localStorage.setItem(FR_KEY, JSON.stringify({ doneAt: new Date().toISOString(), skipped: true })); } catch {}
    onComplete?.();
  }, [step, onComplete]);

  return (
    <div className="op-frs-backdrop">
      <div className="op-frs-card">

        {/* Progress dots */}
        <div className="op-frs-progress">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`op-frs-dot ${i < step ? "past" : i === step ? "current" : "future"}`}
            />
          ))}
          <span className="op-frs-step-count">{step + 1}/{STEPS.length}</span>
        </div>

        {/* Step header */}
        <div>
          <div className="op-frs-icon">{current.icon}</div>
          <div className="op-frs-title">{current.title}</div>
          <div className="op-frs-body">{current.body}</div>
        </div>

        {/* Runtime health check */}
        {current.id === "runtime" && (
          <div className={`op-frs-health ${healthOk === false ? "fail" : "ok"}`}>
            <div className="op-frs-health-row">
              <span className="op-frs-health-label">Backend health:</span>
              {checking ? (
                <span className="op-frs-health-checking">checking…</span>
              ) : healthOk === true ? (
                <span className="op-frs-health-ok">✓ Connected and ready</span>
              ) : healthOk === false ? (
                <span className="op-frs-health-fail">✗ Not reachable</span>
              ) : null}
            </div>
            {healthOk === false && (
              <div className="op-frs-recovery">
                <div className="op-frs-recovery-title">To connect, start the backend:</div>
                <code className="op-frs-recovery-cmd">npm run server</code>
                <div>Or if using pm2: <code className="op-frs-recovery-cmd" style={{ display: "inline", padding: "0 4px" }}>pm2 restart jarvis-backend</code></div>
                <div className="op-frs-recovery-alt">You can click Skip and come back — Ooplix reconnects automatically once the backend starts.</div>
              </div>
            )}
          </div>
        )}

        {/* Education callout */}
        {current.education && (
          <div className="op-frs-edu">💡 {current.education}</div>
        )}

        {/* Release notes on done step */}
        {current.releaseNotes && (
          <div className="op-frs-notes">
            <div className="op-frs-notes-title">Things to try first:</div>
            {current.releaseNotes.map((note, i) => (
              <div key={i}>• {note}</div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="op-frs-actions">
          <button className="op-frs-btn-primary" onClick={next}>
            {current.cta} →
          </button>
          {step < STEPS.length - 1 && (
            <button className="op-frs-btn-skip" onClick={skip}>Skip</button>
          )}
        </div>

      </div>
    </div>
  );
});

export function shouldShowFirstRun() {
  try { return !localStorage.getItem(FR_KEY); }
  catch { return false; }
}
