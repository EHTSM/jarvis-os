import React, { useState } from "react";
import "./Onboarding.css";

const STEPS = [
  {
    key:         "business",
    question:    "What type of business do you run?",
    placeholder: "e.g. Freelance designer, coaching, digital agency…",
    type:        "text",
  },
  {
    key:         "product",
    question:    "What do you sell?",
    placeholder: "e.g. Logo packages, 1-on-1 coaching sessions, SEO services…",
    type:        "text",
  },
  {
    key:         "price",
    question:    "What do you charge?",
    placeholder: "e.g. ₹999, ₹5000/month, ₹15,000 per project",
    type:        "text",
  },
];

export default function Onboarding({ onComplete }) {
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ business: "", product: "", price: "" });

  const current = STEPS[step];
  const value   = answers[current.key];
  const isLast  = step === STEPS.length - 1;

  const handleNext = () => {
    if (!value.trim()) return;
    if (isLast) {
      const profile = { ...answers, [current.key]: value.trim() };
      localStorage.setItem("jarvis_biz_profile", JSON.stringify(profile));
      onComplete(profile);
    } else {
      setAnswers(prev => ({ ...prev, [current.key]: value.trim() }));
      setStep(s => s + 1);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleNext(); }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="onboarding">
      <div className="onboarding-inner">

        <div className="ob-header">
          <div className="ob-logo">J</div>
          <p className="ob-step-label">Step {step + 1} of {STEPS.length}</p>
        </div>

        <div className="ob-progress-track">
          <div className="ob-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="ob-body">
          <h2 className="ob-question">{current.question}</h2>

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
            {isLast ? "Let's go →" : "Continue →"}
          </button>

          {step > 0 && (
            <button className="ob-back" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
