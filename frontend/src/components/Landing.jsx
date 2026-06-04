import React from "react";
import { track } from "../analytics";
import "./Landing.css";

const YEAR = new Date().getFullYear();

const CAPABILITIES = [
  {
    icon: "⚡",
    title: "Autonomous Execution",
    desc: "Run commands, workflows, and long-horizon tasks in the background. Ooplix acts while you focus.",
  },
  {
    icon: "🔁",
    title: "Automated Follow-ups",
    desc: "WhatsApp sequences fire automatically — greetings, check-ins, closings — calibrated to your business.",
  },
  {
    icon: "💳",
    title: "Payment Collection",
    desc: "Generate and send secure Razorpay checkout links in one tap. Revenue tracked in real time.",
  },
  {
    icon: "📡",
    title: "Live Runtime Monitor",
    desc: "Watch every automation, execution, and system event as it happens. Full audit trail included.",
  },
  {
    icon: "🧠",
    title: "AI Command Interface",
    desc: "Chat with an AI that actually executes — dispatches tasks, reads files, runs shell commands.",
  },
  {
    icon: "🏗️",
    title: "Business + Dev OS",
    desc: "Pipeline management, repo tracking, deployments, campaigns — all modules under one roof.",
  },
];

const TRUST_POINTS = [
  "No credit card required",
  "7-day free trial",
  "Cancel anytime",
];

const SYSTEM_STATS = [
  { label: "Execution modes",  value: "7"       },
  { label: "Follow-up tiers",  value: "6"       },
  { label: "Avg task runtime", value: "<2s"     },
  { label: "Uptime target",    value: "99.9%"   },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Connect your stack",   desc: "WhatsApp Business API, Razorpay, AI provider. One-time setup, guided." },
  { step: "2", title: "Add your first lead",  desc: "Name and number. Ooplix queues the follow-up sequence immediately."    },
  { step: "3", title: "Watch it run",         desc: "Live activity feed shows every message sent, every task executed."      },
  { step: "4", title: "Collect and compound", desc: "Payment links, conversion tracking, revenue dashboard — all live."     },
];

export default function Landing({ onStart, onLogin, onLegal, onPricing }) {
  const handleStart = (source) => { track.signupStarted(source); onStart(); };

  return (
    <div className="landing">
      <div className="landing-inner">

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <div className="landing-hero">
          <div className="landing-hero-copy">

            <div className="landing-brand-row">
              <div className="landing-logo">O</div>
              <span className="landing-brand-name">Ooplix</span>
              <span className="landing-brand-tag">AI Operating System</span>
            </div>

            <h1 className="landing-headline">
              Your business runs<br />
              <span className="landing-headline-accent">while you sleep.</span>
            </h1>

            <p className="landing-sub">
              Ooplix is an AI Operating System — it executes workflows, follows up with leads,
              collects payments, monitors your pipeline, and runs autonomous tasks in the background.
              Not a chatbot. Not a CRM. An operating system for your work.
            </p>

            <div className="landing-actions">
              <button className="landing-btn-primary" onClick={() => handleStart("hero_primary")}>
                Start Free Trial — 7 days free
              </button>
              <button className="landing-btn-ghost" onClick={onLogin}>
                Sign in
              </button>
            </div>

            <ul className="landing-trust-row">
              {TRUST_POINTS.map(t => (
                <li key={t} className="landing-trust-item">
                  <span className="landing-trust-check" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Live system preview ──────────────────────────────── */}
          <div className="landing-hero-preview">
            <div className="landing-preview-panel">
              <div className="landing-preview-header">
                <span className="landing-preview-badge">
                  <span className="landing-preview-pulse" />
                  Live
                </span>
                <span className="landing-preview-title-sm">Ooplix Runtime</span>
              </div>
              <div className="landing-preview-feed">
                <div className="landing-feed-row landing-feed-row--ok">
                  <span className="landing-feed-dot" />
                  <span className="landing-feed-text">Follow-up sent → Ahmed Hassan</span>
                  <span className="landing-feed-time">2m</span>
                </div>
                <div className="landing-feed-row landing-feed-row--ok">
                  <span className="landing-feed-dot" />
                  <span className="landing-feed-text">Payment link → Priya Sharma · ₹12,000</span>
                  <span className="landing-feed-time">14m</span>
                </div>
                <div className="landing-feed-row landing-feed-row--run">
                  <span className="landing-feed-dot landing-feed-dot--run" />
                  <span className="landing-feed-text">Workflow: daily-pipeline-summary</span>
                  <span className="landing-feed-time">now</span>
                </div>
                <div className="landing-feed-row landing-feed-row--ok">
                  <span className="landing-feed-dot" />
                  <span className="landing-feed-text">Lead marked hot → Rohan Mehta</span>
                  <span className="landing-feed-time">1h</span>
                </div>
              </div>
              <div className="landing-preview-stats">
                {SYSTEM_STATS.map(s => (
                  <div key={s.label} className="landing-stat-chip">
                    <span className="landing-stat-value">{s.value}</span>
                    <span className="landing-stat-label">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="landing-divider" />

        {/* ── Capability grid ───────────────────────────────────────── */}
        <div className="landing-section">
          <p className="landing-section-label">What Ooplix runs for you</p>
          <div className="landing-cap-grid">
            {CAPABILITIES.map(c => (
              <div key={c.title} className="landing-cap-card">
                <span className="landing-cap-icon">{c.icon}</span>
                <h3 className="landing-cap-title">{c.title}</h3>
                <p className="landing-cap-desc">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-divider" />

        {/* ── How it works ──────────────────────────────────────────── */}
        <div className="landing-how">
          <p className="landing-how-label">How it works</p>
          <ol className="landing-steps">
            {HOW_IT_WORKS.map(s => (
              <li key={s.step} className="landing-step">
                <span className="landing-step-num">{s.step}</span>
                <div className="landing-step-body">
                  <span className="landing-step-title">{s.title}</span>
                  <span className="landing-step-desc">{s.desc}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="landing-divider" />

        {/* ── CTA repeat ────────────────────────────────────────────── */}
        <div className="landing-cta-block">
          <h2 className="landing-cta-headline">Ready to run your business on autopilot?</h2>
          <p className="landing-cta-sub">
            Join operators using Ooplix to close more leads, collect faster, and execute without the manual work.
          </p>
          <button className="landing-btn-primary landing-btn-primary--lg" onClick={() => handleStart("bottom_cta")}>
            Start Free — 7 days, no card
          </button>
        </div>

        <div className="landing-divider" />

        {/* ── Footer ────────────────────────────────────────────────── */}
        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <span className="landing-footer-logo">O</span>
            <span className="landing-footer-name">Ooplix <span className="landing-footer-tag">AI Operating System</span></span>
          </div>
          <nav className="landing-footer-nav" aria-label="Site navigation">
            <button className="landing-footer-link landing-footer-link--accent" onClick={onPricing}>Pricing</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("company")}>Company</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("privacy")}>Privacy</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("terms")}>Terms</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("refund")}>Refunds</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("contact")}>Contact</button>
            <button className="landing-footer-link" onClick={() => onLegal?.("trust")}>Trust & Security</button>
          </nav>
          <p className="landing-footer-legal">
            &copy; {YEAR} ALWALIY TECHNOLOGIES PRIVATE LIMITED. Ooplix is a trademark of ALWALIY TECHNOLOGIES PRIVATE LIMITED.
          </p>
        </footer>

      </div>
    </div>
  );
}
