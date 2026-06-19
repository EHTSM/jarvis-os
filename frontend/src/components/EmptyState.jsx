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

  missions: {
    icon:  "🎯",
    title: "No missions yet",
    desc:  "Missions are long-running AI objectives — each one tracks sub-tasks, decisions, artifacts, learnings, and failures automatically. Create your first mission to start autonomous operation.",
    steps: [
      { title: "Define an objective",   desc: "A mission is a goal: \"Grow revenue by 20% this quarter\" or \"Fix all critical incidents\"." },
      { title: "Jarvis plans it",       desc: "The Brain Center breaks the mission into planning horizons and sub-tasks." },
      { title: "Execution runs live",   desc: "Track progress, decisions, and outcomes from the Brain Center." },
    ],
    primaryLabel: "Open Brain Center →",
    primaryTab:   "jarvisbrain",
    secondaryLabel: "View Execution →",
    secondaryTab:   "execution",
    metric: null,
  },

  agents: {
    icon:  "🤖",
    title: "No agents registered",
    desc:  "Agents are autonomous workers — each one specializes in a domain (SEO, sales, code, reliability, compliance) and executes tasks without manual instruction.",
    steps: [
      { title: "Open Agent Factory",    desc: "Create an agent from a template or define a custom one." },
      { title: "Assign capabilities",   desc: "Every agent gets a capability map that defines what it can do." },
      { title: "Register and deploy",   desc: "Registered agents appear in the registry and can be triggered by Jarvis." },
    ],
    primaryLabel: "Open Agent Factory →",
    primaryTab:   "agentfactory",
    secondaryLabel: "Agent Registry →",
    secondaryTab:   "registry",
    metric: null,
  },

  memory: {
    icon:  "🧠",
    title: "Memory is empty",
    desc:  "Memory OS stores facts, decisions, learnings, and successful/failed patterns that all agents share. It grows automatically as Jarvis executes missions and learns from outcomes.",
    steps: [
      { title: "Run a mission",         desc: "Missions produce decisions and learnings that are stored automatically." },
      { title: "Memory indexes it",     desc: "Every outcome — success or failure — is recorded with context and confidence." },
      { title: "Agents query it",       desc: "Future agents retrieve relevant memories before acting — no repeated mistakes." },
    ],
    primaryLabel: "Open Brain Center →",
    primaryTab:   "jarvisbrain",
    secondaryLabel: "Intelligence →",
    secondaryTab:   "intel",
    metric: null,
  },

  execution: {
    icon:  "⚡",
    title: "Nothing in the execution queue",
    desc:  "The Execution Center manages all pending, running and completed tasks — from AI agents, scheduled workflows, and manual dispatches. Queue items appear here as soon as Jarvis plans a mission.",
    steps: [
      { title: "Create a mission",      desc: "Missions generate execution tasks automatically." },
      { title: "Or dispatch manually",  desc: "Use the Dispatch bar to queue a one-off task." },
      { title: "Monitor live",          desc: "Real-time progress, approvals, confidence scores." },
    ],
    primaryLabel: "Open Brain Center →",
    primaryTab:   "jarvisbrain",
    secondaryLabel: "View Reliability →",
    secondaryTab:   "reliability",
    metric: null,
  },

  recommendations: {
    icon:  "✦",
    title: "No recommendations right now",
    desc:  "The Observer continuously monitors execution health, incident patterns, and system signals. Recommendations appear when it detects something worth acting on.",
    steps: [
      { title: "Observer runs continuously", desc: "It watches reliability metrics, deployment risk, and pattern anomalies." },
      { title: "Recommendations appear here", desc: "Each one explains why it was triggered and what to do." },
      { title: "Act or dismiss",              desc: "One-click to navigate to the affected system, or dismiss if resolved." },
    ],
    primaryLabel: "View Reliability →",
    primaryTab:   "reliability",
    secondaryLabel: "Guardrails →",
    secondaryTab:   "guardrails",
    metric: null,
  },

  plugins: {
    icon:  "⬡",
    title: "No plugins registered",
    desc:  "Plugins extend Jarvis with custom capabilities — connect APIs, add tool hooks, and register new integrations. All registered plugins are available to every agent.",
    steps: [
      { title: "Open Agent Factory",    desc: "The Plugin tab shows all registered plugins and their hooks." },
      { title: "Register a plugin",     desc: "POST to /p26/plugins with a name, type, and config." },
      { title: "Assign to agents",      desc: "Agents can call any registered plugin via the capability map." },
    ],
    primaryLabel: "Agent Factory →",
    primaryTab:   "agentfactory",
    secondaryLabel: null,
    secondaryTab:   null,
    metric: null,
  },

  intelligence: {
    icon:  "◈",
    title: "No intelligence data yet",
    desc:  "The Intelligence Panel surfaces insights from knowledge graphs, memory patterns, and cross-agent learning. Data populates as missions run and agents share learnings.",
    steps: [
      { title: "Run missions",           desc: "Each completed mission adds to the knowledge graph." },
      { title: "Agents share learnings", desc: "Cross-agent patterns are detected automatically." },
      { title: "Query insights",         desc: "Ask questions or browse patterns from this panel." },
    ],
    primaryLabel: "Open Brain Center →",
    primaryTab:   "jarvisbrain",
    secondaryLabel: "Memory OS →",
    secondaryTab:   "memory",
    metric: null,
  },

  engineering: {
    icon:  "⬡",
    title: "No engineering activity",
    desc:  "The Engineering Center tracks code changes, deployment history, incident resolution, and technical health. Activity appears once you connect a repo or start running deployments.",
    steps: [
      { title: "Connect your repo",       desc: "Engineering tracks git history and diff impact automatically." },
      { title: "Run a deployment",        desc: "DevOps Center triggers builds; this panel tracks their outcomes." },
      { title: "Incidents get linked",    desc: "Failures are automatically correlated with recent code changes." },
    ],
    primaryLabel: "DevOps Center →",
    primaryTab:   "devops",
    secondaryLabel: "Self-Healing →",
    secondaryTab:   "selfhealing",
    metric: null,
  },

  default: {
    icon:  "◌",
    title: "Nothing here yet",
    desc:  "Start working to see content here.",
    steps: null,
    primaryLabel: null,
    primaryTab:   null,
    secondaryLabel: null,
    secondaryTab:   null,
    metric: null,
  },

};

// ── Root component ────────────────────────────────────────────────────
export default function EmptyState({ variant = "pipeline", onNavigate, onExampleClick, body }) {
  const v = VARIANTS[variant] || VARIANTS.default;

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
      <p className="es-desc">{body || v.desc}</p>

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
