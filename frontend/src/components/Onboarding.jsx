import React, { useState } from "react";
import "./Onboarding.css";

const STEPS = [
  {
    key:         "business",
    headline:    "What kind of business do you run?",
    hint:        "Ooplix writes follow-up messages that sound like you — not a bot. This keeps them natural.",
    placeholder: "e.g. Freelance designer, coaching, digital agency…",
    type:        "text",
  },
  {
    key:         "product",
    headline:    "What do you sell?",
    hint:        "Your product or service appears in follow-up messages, so they feel relevant instead of generic.",
    placeholder: "e.g. Logo packages, 1-on-1 coaching, SEO retainer…",
    type:        "text",
  },
  {
    key:         "price",
    headline:    "What's your price?",
    hint:        "Sets the default amount on payment links. You can override it per client at any time.",
    placeholder: "e.g. ₹5,000, ₹15,000 per project",
    type:        "text",
  },
];

export default function Onboarding({ onComplete }) {
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ business: "", product: "", price: "" });
  const [done,    setDone]    = useState(false);
  const [profile, setProfile] = useState(null);

  const current = done ? null : STEPS[step];
  const value   = done ? "" : answers[current.key];
  const isLast  = !done && step === STEPS.length - 1;

  const handleNext = () => {
    if (!value.trim()) return;
    const updated = { ...answers, [current.key]: value.trim() };
    if (isLast) {
      localStorage.setItem("jarvis_biz_profile", JSON.stringify(updated));
      setProfile(updated);
      setDone(true);
    } else {
      setAnswers(updated);
      setStep(s => s + 1);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleNext(); }
  };

  const progress = done ? 100 : ((step + 1) / STEPS.length) * 100;

  if (done) {
    return (
      <div className="onboarding">
        <div className="onboarding-inner animate-scale-in">

          <div className="ob-header">
            <div className="ob-logo">O</div>
            <div className="ob-header-meta">
              <span className="ob-title-brand">Ooplix</span>
              <span className="ob-step-label">Ready to run</span>
            </div>
          </div>

          <div className="ob-progress-track">
            <div className="ob-progress-fill" style={{ width: "100%" }} />
          </div>

          <div className="ob-body">
            <h2 className="ob-done-heading">
              Your AI OS is live.
            </h2>
            <p className="ob-done-sub">
              Configured for <strong>{profile?.business || "your business"}</strong>. Three actions to start the loop:
            </p>
            <ul className="ob-checklist">
              <li>
                <span className="ob-check">1</span>
                <div>
                  <strong>Add a contact</strong>
                  <p className="ob-check-sub">Name + WhatsApp number. The first follow-up fires in 10 minutes — automatically.</p>
                </div>
              </li>
              <li>
                <span className="ob-check">2</span>
                <div>
                  <strong>Connect WhatsApp</strong>
                  <p className="ob-check-sub">One-time setup. After that, every follow-up runs without you touching anything.</p>
                </div>
              </li>
              <li>
                <span className="ob-check">3</span>
                <div>
                  <strong>Watch it run</strong>
                  <p className="ob-check-sub">Control Center shows every action, send, and system event in real time.</p>
                </div>
              </li>
            </ul>
            <button
              className="ob-btn ob-btn--complete"
              onClick={() => onComplete(profile)}
            >
              Open Control Center →
            </button>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner animate-scale-in">

        <div className="ob-header">
          <div className="ob-logo">O</div>
          <div className="ob-header-meta">
            <span className="ob-title-brand">Setup — under a minute</span>
            <span className="ob-step-label">Step {step + 1} of {STEPS.length}</span>
          </div>
          <span className="ob-step-count">{step + 1}/{STEPS.length}</span>
        </div>

        <div className="ob-progress-track">
          <div className="ob-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className={`ob-body ob-step-${step + 1}`}>
          <h2 className="ob-question">{current.headline}</h2>
          {current.hint && <p className="ob-subtext">{current.hint}</p>}

          <input
            key={current.key}
            className="ob-input"
            type={current.type}
            placeholder={current.placeholder}
            value={value}
            onChange={e => setAnswers(prev => ({ ...prev, [current.key]: e.target.value }))}
            onKeyDown={handleKey}
            autoFocus
          />

          <button
            className="ob-btn"
            onClick={handleNext}
            disabled={!value.trim()}
          >
            {isLast ? "Finish Setup →" : "Continue →"}
          </button>

          {step > 0 ? (
            <button className="ob-back" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
          ) : (
            <p className="ob-confidence-note">No credit card. No account needed yet.</p>
          )}
        </div>

      </div>
    </div>
  );
}
