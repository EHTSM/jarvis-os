import React from "react";
import "./CapabilitiesOverview.css";

const CAPABILITIES = [
  {
    id:    "chat",
    icon:  "◈",
    title: "Ask Jarvis",
    desc:  "Chat with an AI that takes real action — runs code, sends messages, looks things up, and executes tasks on your behalf.",
    cta:   "Open Chat",
  },
  {
    id:    "clients",
    icon:  "◎",
    title: "Contacts & Pipeline",
    desc:  "Manage leads, automate WhatsApp follow-ups, send payment links, and track who's hot, who's paid, and who needs attention.",
    cta:   "Open Contacts",
  },
  {
    id:    "runtime",
    icon:  "⬡",
    title: "Control Room",
    desc:  "Execute workflows, run automations, schedule tasks, and monitor everything Jarvis is doing in real time.",
    cta:   "Open Control Room",
    featured: true,
  },
  {
    id:    "business",
    icon:  "◇",
    title: "Business OS",
    desc:  "Pipeline management, campaign tracking, revenue reporting, and growth tools — your full business in one place.",
    cta:   "Open Business",
  },
  {
    id:    "developer",
    icon:  "◻",
    title: "Dev Tools",
    desc:  "Run commands, manage repos, trigger builds, check deployments, and automate developer workflows.",
    cta:   "Open Dev Tools",
  },
];

export default function CapabilitiesOverview({ onNavigate }) {
  return (
    <div className="cap-overview">
      <div className="cap-header">
        <h2 className="cap-title">What Jarvis can do</h2>
        <p className="cap-sub">Five integrated modules. One operating system for your work.</p>
      </div>

      <div className="cap-grid">
        {CAPABILITIES.map(cap => (
          <div key={cap.id} className={`cap-card${cap.featured ? " cap-card--featured" : ""}`}>
            <span className="cap-icon" aria-hidden="true">{cap.icon}</span>
            <h3 className="cap-card-title">{cap.title}</h3>
            <p className="cap-card-desc">{cap.desc}</p>
            <button
              className="cap-card-btn"
              onClick={() => onNavigate?.(cap.id)}
            >
              {cap.cta} →
            </button>
          </div>
        ))}
      </div>

      <div className="cap-footer">
        <p className="cap-footer-text">All modules share the same data — leads, tasks, and automations flow between them automatically.</p>
      </div>
    </div>
  );
}
