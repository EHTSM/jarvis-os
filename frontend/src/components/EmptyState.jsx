/**
 * EmptyState — contextual guidance shown when a section has no data.
 *
 * Each variant answers:
 *   What is this?          → title
 *   What should I do next? → primaryAction
 *   Why should I care?     → description
 *
 * Usage:
 *   <EmptyState variant="pipeline" onNavigate={setTab} />
 */

import React from "react";
import { track } from "../analytics";
import "./EmptyState.css";

// ── Step list subcomponent ───────────────────────────────────────────
function Steps({ steps }) {
  return (
    <ol className="es-steps">
      {steps.map((s, i) => (
        <li key={i} className="es-step">
          <span className="es-step-num">{i + 1}</span>
          <div className="es-step-body">
            <span className="es-step-title">{s.title}</span>
            {s.desc && <span className="es-step-desc">{s.desc}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Variant catalogue ────────────────────────────────────────────────
const VARIANTS = {

  pipeline: {
    icon:  "◉",
    title: "Your pipeline is empty",
    desc:  "The pipeline tracks every lead from first contact to paid. Add a contact to start the loop — Ooplix queues the first follow-up in 10 minutes automatically.",
    steps: [
      { title: "Add a contact",     desc: "Name + WhatsApp number in the Contacts tab." },
      { title: "Connect WhatsApp",  desc: "One-time QR scan — then every follow-up runs without you." },
      { title: "Watch it move",     desc: "Ooplix tracks engagement and marks leads as hot automatically." },
    ],
    primaryLabel: "Add first contact →",
    primaryTab:   "clients",
    secondaryLabel: "See how it works",
    secondaryTab:   "success",
    metric: "Businesses using Ooplix send 6× more follow-ups than manual operators.",
  },

  contacts: {
    icon:  "◈",
    title: "No contacts yet",
    desc:  "Add a name and WhatsApp number. Ooplix handles the rest — greetings, follow-ups, closing messages — on the right schedule, automatically.",
    steps: [
      { title: "Click \"Add Contact\"", desc: "Takes 10 seconds — just a name and number." },
      { title: "Ooplix queues follow-up", desc: "First message fires in 10 minutes, no action needed." },
      { title: "Connect WhatsApp once",   desc: "After setup, every message sends automatically." },
    ],
    primaryLabel: "Add first contact →",
    primaryTab:   null, // rendered inline, already on contacts tab
    secondaryLabel: "Getting Started",
    secondaryTab:   "success",
    metric: null,
  },

  intelligence: {
    icon:  "◇",
    title: "Ask Ooplix anything",
    desc:  "Intelligence is a command interface — not just chat. You can ask questions, run shell commands, dispatch tasks, read files, and execute workflows directly.",
    steps: [
      { title: "Ask a question",         desc: "\"What's my pipeline status?\" or \"How many leads this week?\"" },
      { title: "Run a command",          desc: "\"Run pm2 list\" or \"Show git status\" — executes on the server." },
      { title: "Trigger a workflow",     desc: "\"Send daily pipeline summary\" — runs the automation now." },
    ],
    primaryLabel: null,
    primaryTab:   null,
    secondaryLabel: null,
    secondaryTab:   null,
    examples: [
      "What's my pipeline status?",
      "Run pm2 list",
      "Show my revenue this week",
      "Send a follow-up to hot leads",
      "Check system health",
    ],
    metric: null,
  },

  billing: {
    icon:  "✦",
    title: "No billing history yet",
    desc:  "Payment records and subscription history appear here once you upgrade. Your trial is running — all features are active for 7 days.",
    steps: [
      { title: "Complete your trial",  desc: "Use Ooplix for the full 7 days to see its value clearly." },
      { title: "Choose a plan",        desc: "Starter (₹999/mo) or Growth (₹2,499/mo) — upgrade in one click." },
      { title: "Payment via Razorpay", desc: "Secure, instant, and auto-renewing monthly." },
    ],
    primaryLabel: "View plans →",
    primaryTab:   "billing",
    secondaryLabel: null,
    secondaryTab:   null,
    metric: "No credit card needed during trial.",
  },

  activity: {
    icon:  "⚡",
    title: "No activity yet",
    desc:  "Every message sent, payment collected, workflow executed, and system event appears here in real time. Start by adding a contact.",
    steps: [
      { title: "Add a contact",       desc: "The first follow-up queues in 10 minutes." },
      { title: "Connect WhatsApp",    desc: "Messages send automatically on schedule." },
      { title: "Watch the feed",      desc: "Events appear as they happen — live, no refresh needed." },
    ],
    primaryLabel: "Add first contact →",
    primaryTab:   "clients",
    secondaryLabel: null,
    secondaryTab:   null,
    metric: null,
  },

  runtime: {
    icon:  "◎",
    title: "No execution history",
    desc:  "Tasks run from the Control Center, workflows dispatched by automations, and AI-triggered actions all log here. Run your first command to get started.",
    steps: [
      { title: "Open Control Center",  desc: "Use the Dispatch bar to send a command." },
      { title: "Try a quick command",  desc: "\"Run pm2 status\" or \"Show pipeline summary\"." },
      { title: "Use quick-chips",      desc: "Pre-set commands appear as chips — one click to run." },
    ],
    primaryLabel: "Go to Control Center →",
    primaryTab:   "home",
    secondaryLabel: null,
    secondaryTab:   null,
    metric: null,
  },

};

// ── Root component ────────────────────────────────────────────────────
export default function EmptyState({ variant = "pipeline", onNavigate, onExampleClick }) {
  const v = VARIANTS[variant] || VARIANTS.pipeline;

  const handlePrimary = () => {
    track.event("empty_state_cta", { variant, action: "primary" });
    if (v.primaryTab) onNavigate?.(v.primaryTab);
  };

  const handleSecondary = () => {
    track.event("empty_state_cta", { variant, action: "secondary" });
    if (v.secondaryTab) onNavigate?.(v.secondaryTab);
  };

  return (
    <div className="es-root animate-fade-up">
      <div className="es-icon" aria-hidden="true">{v.icon}</div>
      <h2 className="es-title">{v.title}</h2>
      <p className="es-desc">{v.desc}</p>

      {v.steps && <Steps steps={v.steps} />}

      {/* Intelligence example prompts */}
      {v.examples && (
        <div className="es-examples">
          <p className="es-examples-label">Try asking:</p>
          <div className="es-example-chips">
            {v.examples.map(ex => (
              <button
                key={ex}
                className="es-example-chip"
                onClick={() => {
                  track.event("empty_state_example_clicked", { variant, example: ex });
                  onExampleClick?.(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {v.metric && (
        <p className="es-metric">{v.metric}</p>
      )}

      <div className="es-actions">
        {v.primaryLabel && v.primaryTab && (
          <button className="es-cta-primary" onClick={handlePrimary}>
            {v.primaryLabel}
          </button>
        )}
        {v.secondaryLabel && v.secondaryTab && (
          <button className="es-cta-secondary" onClick={handleSecondary}>
            {v.secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
