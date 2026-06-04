import React from "react";
import { track } from "../analytics";
import "./Landing.css";

const YEAR = new Date().getFullYear();

// ── Conversion-optimized copy ────────────────────────────────────────

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

// Trust signals — concise, specific
const TRUST_SIGNALS = [
  "7-day free trial",
  "No credit card required",
  "Cancel anytime",
  "Your data stays yours",
];

// Social proof stats — aspirational but believable
const PROOF_STATS = [
  { value: "< 2s",    label: "Avg task runtime" },
  { value: "6",       label: "Follow-up sequences" },
  { value: "99.9%",   label: "Uptime target" },
  { value: "24/7",    label: "Autonomous operation" },
];

// Objection busters — answers the 3 things stopping a signup
const OBJECTIONS = [
  {
    q: "Is it really automated?",
    a: "Yes. Once WhatsApp is connected, Ooplix sends every follow-up without you touching anything. The 10-minute greeting, the 24-hour check-in, the 3-day close — all automatic.",
  },
  {
    q: "What if I'm not technical?",
    a: "Setup takes under 2 minutes: tell Ooplix your business type, connect WhatsApp, add a contact. That's it. No code, no config files, no integrations to wire.",
  },
  {
    q: "What does it actually do for me today?",
    a: "The moment you add a contact it queues a WhatsApp follow-up. By end of day you'll have sent more follow-ups than most businesses do in a week — automatically.",
  },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Tell Ooplix about your business",   desc: "3 questions. 90 seconds. Your follow-up messages are personalised from the start." },
  { step: "2", title: "Add a contact with their number",   desc: "Name + WhatsApp number. Ooplix queues the first follow-up immediately. No manual action needed." },
  { step: "3", title: "Connect WhatsApp once",             desc: "One-time QR code scan. After that, every sequence runs without you." },
  { step: "4", title: "Watch revenue and leads grow",      desc: "Control Center shows every message sent, payment collected, and task run — live." },
];

export default function Landing({ onStart, onLogin, onLegal, onPricing }) {
  const handleStart = (source) => {
    track.signupStarted(source);
    onStart();
  };

  return (
    <div className="landing">
      <div className="landing-inner">

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="landing-hero">
          <div className="landing-hero-copy">

            {/* Brand */}
            <div className="landing-brand-row">
              <div className="landing-logo">O</div>
              <span className="landing-brand-name">Ooplix</span>
              <span className="landing-brand-tag">AI Operating System</span>
            </div>

            {/* Eyebrow — category context */}
            <p className="landing-eyebrow">
              For freelancers, coaches, and agencies in India
            </p>

            {/* Headline — benefit-led, specific */}
            <h1 className="landing-headline">
              Close more leads.<br />
              <span className="landing-headline-accent">While you sleep.</span>
            </h1>

            {/* Sub — one job, clear outcome */}
            <p className="landing-sub">
              Ooplix sends WhatsApp follow-ups automatically, generates payment links in one tap,
              and runs your workflows in the background — 24/7. Not a chatbot. An AI OS that acts.
            </p>

            {/* CTA cluster — primary dominant, ghost secondary */}
            <div className="landing-actions">
              <button
                className="landing-btn-primary"
                onClick={() => handleStart("hero_primary")}
              >
                Start Free — 7 days, no card
              </button>
              <button className="landing-btn-ghost" onClick={onLogin}>
                Sign in →
              </button>
            </div>

            {/* Trust micro-signals below CTA */}
            <ul className="landing-trust-row">
              {TRUST_SIGNALS.map(t => (
                <li key={t} className="landing-trust-item">
                  <span className="landing-trust-check" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>

          </div>

          {/* ── Live system preview ─────────────────────────────── */}
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
                <div className="landing-feed-row landing-feed-row--ok">
                  <span className="landing-feed-dot" />
                  <span className="landing-feed-text">3-day close sent → Fatima Al-Said</span>
                  <span className="landing-feed-time">3h</span>
                </div>
              </div>
              <div className="landing-preview-stats">
                {PROOF_STATS.map(s => (
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

        {/* ── Social proof bar ───────────────────────────────────── */}
        <div className="landing-proof-bar">
          <p className="landing-proof-label">What operators run on Ooplix</p>
          <div className="landing-proof-tiles">
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">🎨</span>
              <span className="landing-proof-type">Freelance Designers</span>
            </div>
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">🧑‍💼</span>
              <span className="landing-proof-type">Business Coaches</span>
            </div>
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">📱</span>
              <span className="landing-proof-type">Digital Agencies</span>
            </div>
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">🛒</span>
              <span className="landing-proof-type">D2C Brands</span>
            </div>
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">📚</span>
              <span className="landing-proof-type">EdTech Operators</span>
            </div>
            <div className="landing-proof-tile">
              <span className="landing-proof-icon">🏥</span>
              <span className="landing-proof-type">Healthcare Clinics</span>
            </div>
          </div>
        </div>

        <div className="landing-divider" />

        {/* ── Capabilities ───────────────────────────────────────── */}
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

        {/* ── How it works ────────────────────────────────────────── */}
        <div className="landing-how">
          <p className="landing-how-label">How it works — 4 steps</p>
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

        {/* ── Objections ──────────────────────────────────────────── */}
        <div className="landing-objections">
          <p className="landing-section-label">Common questions</p>
          <div className="landing-objection-grid">
            {OBJECTIONS.map(o => (
              <div key={o.q} className="landing-objection-card">
                <p className="landing-objection-q">{o.q}</p>
                <p className="landing-objection-a">{o.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-divider" />

        {/* ── Pricing entry point ─────────────────────────────────── */}
        <div className="landing-pricing-entry">
          <div className="landing-pricing-entry-copy">
            <p className="landing-section-label">Pricing</p>
            <h2 className="landing-pricing-entry-headline">
              Start free. Upgrade when you're ready.
            </h2>
            <p className="landing-pricing-entry-sub">
              7-day trial includes full access — follow-ups, payment links, AI execution,
              live monitoring. No credit card. No surprise charges.
            </p>
            <div className="landing-pricing-entry-actions">
              <button
                className="landing-btn-primary"
                onClick={() => handleStart("pricing_entry")}
              >
                Start Free Trial
              </button>
              <button className="landing-btn-ghost" onClick={onPricing}>
                See all plans →
              </button>
            </div>
          </div>
          <div className="landing-pricing-entry-card">
            <div className="landing-price-badge">Free to start</div>
            <div className="landing-price-display">
              <span className="landing-price-currency">₹</span>
              <span className="landing-price-amount">0</span>
              <span className="landing-price-period">/ 7 days</span>
            </div>
            <ul className="landing-price-features">
              <li><span className="landing-price-check">✓</span> Unlimited WhatsApp follow-ups</li>
              <li><span className="landing-price-check">✓</span> AI task execution</li>
              <li><span className="landing-price-check">✓</span> Payment link generation</li>
              <li><span className="landing-price-check">✓</span> Live runtime monitor</li>
              <li><span className="landing-price-check">✓</span> Full pipeline dashboard</li>
            </ul>
            <button
              className="landing-price-cta"
              onClick={() => handleStart("pricing_card")}
            >
              Start Free →
            </button>
          </div>
        </div>

        <div className="landing-divider" />

        {/* ── Bottom CTA ──────────────────────────────────────────── */}
        <div className="landing-cta-block">
          <h2 className="landing-cta-headline">
            Your next lead follow-up should be automatic.
          </h2>
          <p className="landing-cta-sub">
            Join operators using Ooplix to close faster, collect sooner, and
            spend zero time on manual follow-up.
          </p>
          <button
            className="landing-btn-primary landing-btn-primary--lg"
            onClick={() => handleStart("bottom_cta")}
          >
            Start Free — 7 days, no card
          </button>
          <p className="landing-cta-nudge">Takes 2 minutes to set up. No card required.</p>
        </div>

        <div className="landing-divider" />

        {/* ── Footer ──────────────────────────────────────────────── */}
        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <span className="landing-footer-logo">O</span>
            <span className="landing-footer-name">
              Ooplix <span className="landing-footer-tag">AI Operating System</span>
            </span>
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
