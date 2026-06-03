import React, { useState } from "react";
import "./Onboarding.css";

const STEPS = [
  {
    key:         "business",
    question:    "What kind of business do you run?",
    subtext:     "JARVIS uses this to write follow-up messages in the right tone — so messages feel personal, not automated.",
    placeholder: "e.g. Freelance designer, coaching, digital agency…",
    type:        "text",
  },
  {
    key:         "product",
    question:    "What do you sell or offer?",
    subtext:     "This lets JARVIS mention your work naturally when following up with leads. No jargon, just clear and human.",
    placeholder: "e.g. Logo packages, 1-on-1 coaching, SEO services…",
    type:        "text",
  },
  {
    key:         "price",
    question:    "What's your typical price?",
    subtext:     "Sets the default amount on your payment links. You can change it any time for individual clients.",
    placeholder: "e.g. ₹999, ₹5000/month, ₹15,000 per project",
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
        <div className="onboarding-inner">

          <div className="ob-header">
            <div className="ob-logo">J</div>
            <div className="ob-header-meta">
              <span className="ob-title-brand">JARVIS</span>
              <span className="ob-step-label">Setup complete</span>
            </div>
          </div>

          <div className="ob-progress-track">
            <div className="ob-progress-fill" style={{ width: "100%" }} />
          </div>

          <div className="ob-body">
            <h2 className="ob-done-heading">
              You're all set.
            </h2>
            <p className="ob-done-sub">
              JARVIS is configured for <strong>{profile?.business || "your business"}</strong>. Here's exactly what to do first:
            </p>
            <ul className="ob-checklist">
              <li>
                <span className="ob-check">1</span>
                <span><strong>Add a lead</strong> — go to the Clients tab and enter a name and WhatsApp number. Takes 30 seconds.</span>
              </li>
              <li>
                <span className="ob-check">2</span>
                <span><strong>Watch follow-ups begin</strong> — JARVIS sends friendly messages on your behalf automatically. No manual work.</span>
              </li>
              <li>
                <span className="ob-check">3</span>
                <span><strong>Send a payment link</strong> — one click from the client card when they're ready to buy.</span>
              </li>
              <li>
                <span className="ob-check">4</span>
                <span><strong>Track it all</strong> — the Revenue tab shows your full pipeline and what's converting.</span>
              </li>
            </ul>
            <button
              className="ob-btn ob-btn--complete"
              onClick={() => onComplete(profile)}
            >
              Open JARVIS →
            </button>
            <p className="ob-confidence-note">Your setup is saved — you can update it any time in Settings.</p>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner">

        <div className="ob-header">
          <div className="ob-logo">J</div>
          <div className="ob-header-meta">
            <span className="ob-title-brand">Quick setup</span>
            <span className="ob-step-label">Step {step + 1} of {STEPS.length} — takes under a minute</span>
          </div>
          <span className="ob-step-count">{step + 1}/{STEPS.length}</span>
        </div>

        <div className="ob-progress-track">
          <div className="ob-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className={`ob-body ob-step-${step + 1}`}>
          <h2 className="ob-question">{current.question}</h2>
          {current.subtext && <p className="ob-subtext">{current.subtext}</p>}

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
            {isLast ? "Complete Setup →" : "Continue →"}
          </button>

          {step > 0 ? (
            <button className="ob-back" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
          ) : (
            <p className="ob-confidence-note">No credit card needed. Setup is saved locally.</p>
          )}
        </div>

      </div>
    </div>
  );
}
