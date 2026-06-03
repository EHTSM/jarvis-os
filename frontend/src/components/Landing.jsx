import React from "react";
import "./Landing.css";

const FEATURES = [
  { icon: "✨", text: "Nurtures every relationship automatically with scheduled, warm follow-ups" },
  { icon: "💳", text: "Delivers secure payment links exactly when clients are ready to close"      },
  { icon: "📊", text: "A single unified view of your pipeline — clean, intentional, and quiet"   },
  { icon: "💬", text: "Engages natively on WhatsApp, where your clients are already comfortable"  },
  { icon: "🖥️", text: "Secure Electron desktop workspace for local execution and peace of mind"    },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Add a client",          desc: "Enter name and WhatsApp number. Takes under 30 seconds." },
  { step: "2", title: "Sequence starts",      desc: "Quiet, scheduled follow-ups keep you top-of-mind."   },
  { step: "3", title: "Collect securely",     desc: "Generate and send a professional checkout link in one tap." },
  { step: "4", title: "Watch it compound",    desc: "Monitor your conversions and revenue grow in real-time." },
];

const TRUST_POINTS = [
  "No credit card required",
  "7-day free trial",
  "Cancel anytime",
];

const PILLARS = [
  { title: "Clear messaging", desc: "Present your business with confidence — Jarvis writes follow-ups in the right tone for your work." },
  { title: "Visible automation", desc: "See exactly what Jarvis is doing — no black boxes, just a clear timeline of every follow-up sent." },
  { title: "One workspace", desc: "WhatsApp, payments, and your client list — all in one place, without switching apps." },
];

const PRICING = [
  { title: "Immediate launch", detail: "Start in minutes with guided setup and a 7-day free trial.", badge: "Trial-first" },
  { title: "Designed to scale", detail: "Upgrade when your team is ready with simple SaaS pricing and premium support.", badge: "Growth-ready" },
];

export default function Landing({ onStart, onLogin }) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-logo">J</div>
            <div className="landing-hero-copy-inner">
              <h1 className="landing-headline">
                Automate your <span className="landing-headline-accent">sales pipeline</span><br />on WhatsApp
              </h1>
              <p className="landing-sub">
                Quietly follows up with leads, delivers secure payment links, and handles client operations — so you can focus entirely on delivery.
              </p>

              <div className="landing-actions">
                <button className="landing-btn-primary" onClick={onStart}>
                  Start Free Trial — 7 days free
                </button>
                <button className="landing-btn-ghost" onClick={onLogin}>
                  Sign in to your account
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
          </div>

          <div className="landing-hero-preview">
            <div className="landing-preview-panel">
              <span className="landing-preview-badge">Desktop workspace</span>
              <div className="landing-preview-title">Everything you need to close clients — one calm workspace.</div>
              <p className="landing-preview-copy">
                Instant visibility into sequences, payments, and customer signals — all in one calm, premium workspace.
              </p>
              <div className="landing-preview-pillars">
                <span>Live follow-up status</span>
                <span>Secure payment links</span>
                <span>Full pipeline visibility</span>
              </div>
            </div>

            <div className="landing-preview-stack">
              <div className="landing-preview-card">
                <div className="landing-preview-card-title">Follow-up speed</div>
                <div className="landing-preview-card-value">72% faster response</div>
              </div>
              <div className="landing-preview-card">
                <div className="landing-preview-card-title">Payment links sent</div>
                <div className="landing-preview-card-value">6 secure links sent</div>
              </div>
            </div>
          </div>

          <div className="landing-onboarding">
        <div className="landing-section-headline">Ready in 3 steps</div>
        <div className="landing-onboarding-grid">
          <article className="landing-onboarding-card" tabIndex="0">
            <div className="landing-onboarding-step">1</div>
            <h3>Add your clients</h3>
            <p>Enter a name and WhatsApp number. Jarvis is ready in under 30 seconds.</p>
            <div className="landing-onboarding-progress"><i /></div>
          </article>
          <article className="landing-onboarding-card" tabIndex="0">
            <div className="landing-onboarding-step">2</div>
            <h3>Jarvis follows up</h3>
            <p>Automated messages go out at the right time — no manual reminders needed.</p>
            <div className="landing-onboarding-progress"><i /></div>
          </article>
          <article className="landing-onboarding-card" tabIndex="0">
            <div className="landing-onboarding-step">3</div>
            <h3>Collect payment</h3>
            <p>Send a secure checkout link in one tap when a client is ready to buy.</p>
            <div className="landing-onboarding-progress"><i /></div>
          </article>
        </div>
      </div>
        </div>

        <div className="landing-divider" />

        <ul className="landing-features">
          {FEATURES.map(f => (
            <li key={f.text}>
              <span className="landing-feature-icon">{f.icon}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>

        <div className="landing-divider" />

        <div className="landing-pricing-grid">
          {PRICING.map(item => (
            <div key={item.title} className="landing-pricing-card">
              <div className="landing-pricing-badge">{item.badge}</div>
              <div className="landing-pricing-title">{item.title}</div>
              <div className="landing-pricing-detail">{item.detail}</div>
            </div>
          ))}
        </div>

        <div className="landing-divider" />

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

      </div>
    </div>
  );
}

