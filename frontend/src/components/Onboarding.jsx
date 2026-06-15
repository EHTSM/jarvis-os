import React, { useState } from "react";
import "./Onboarding.css";

// ── Step definitions ──────────────────────────────────────────────────────────
const BIZ_TYPES = [
  { id: "agency",      label: "Agency",         icon: "🏢" },
  { id: "freelancer",  label: "Freelancer",      icon: "💻" },
  { id: "coaching",    label: "Coaching",         icon: "🎯" },
  { id: "ecommerce",   label: "E-commerce",       icon: "🛒" },
  { id: "saas",        label: "SaaS / Software",  icon: "⚙️" },
  { id: "consulting",  label: "Consulting",        icon: "📊" },
  { id: "services",    label: "Services",          icon: "🔧" },
  { id: "other",       label: "Other",             icon: "✦"  },
];

const TEAM_SIZES = [
  { id: "solo",   label: "Just me",   icon: "👤" },
  { id: "small",  label: "2–10",      icon: "👥" },
  { id: "medium", label: "11–50",     icon: "🏗️" },
  { id: "large",  label: "50+",       icon: "🏢" },
];

const GOALS = [
  { id: "follow_up",   label: "Automate follow-ups",     icon: "🔁" },
  { id: "payments",    label: "Collect payments faster",  icon: "💳" },
  { id: "leads",       label: "Manage more leads",        icon: "📋" },
  { id: "ai_commands", label: "Use AI for tasks",         icon: "⚡" },
  { id: "monitoring",  label: "Monitor operations",       icon: "📡" },
  { id: "devops",      label: "Developer / DevOps tools", icon: "🛠️" },
];

// ── Chip grid ─────────────────────────────────────────────────────────────────
function ChipGrid({ options, selected, onSelect, multi = false }) {
  const isSelected = (id) => multi
    ? (selected || []).includes(id)
    : selected === id;

  const handleClick = (id) => {
    if (multi) {
      const cur = selected || [];
      onSelect(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    } else {
      onSelect(id);
    }
  };

  return (
    <div className="ob2-chip-grid">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          className={`ob2-chip${isSelected(opt.id) ? " ob2-chip--selected" : ""}`}
          onClick={() => handleClick(opt.id)}
          aria-pressed={isSelected(opt.id)}
        >
          <span className="ob2-chip-icon">{opt.icon}</span>
          <span className="ob2-chip-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Root Onboarding ───────────────────────────────────────────────────────────
export default function Onboarding({ onComplete }) {
  const [step,     setStep]     = useState(0); // 0=biz 1=team 2=goals 3=done
  const [bizType,  setBizType]  = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [goals,    setGoals]    = useState([]);
  const [product,  setProduct]  = useState("");

  const canAdvance = [
    !!bizType,
    !!teamSize,
    goals.length > 0,
  ][step] ?? true;

  const handleNext = () => {
    if (!canAdvance) return;
    if (step < 2) { setStep(s => s + 1); return; }

    // Step 2 → done: save profile and notify parent
    const profile = {
      business:  BIZ_TYPES.find(b => b.id === bizType)?.label || bizType,
      teamSize,
      goals,
      product:   product.trim() || BIZ_TYPES.find(b => b.id === bizType)?.label || "",
      price:     "",
    };
    localStorage.setItem("jarvis_biz_profile", JSON.stringify(profile));
    setStep(3);
    // Give completion screen a moment to render, then call parent
    setTimeout(() => onComplete(profile), 1400);
  };

  const progress = step >= 3 ? 100 : ((step + 1) / 3) * 100;

  // ── Completion screen ────────────────────────────────────────────────────────
  if (step === 3) {
    return (
      <div className="onboarding">
        <div className="onboarding-inner ob2-complete">
          <div className="ob2-complete-icon">✓</div>
          <h2 className="ob2-complete-title">You're all set.</h2>
          <p className="ob2-complete-sub">
            Ooplix is configured for your business.<br />
            Creating your account…
          </p>
          <div className="ob2-progress-dots">
            <span className="ob2-dot ob2-dot--done" />
            <span className="ob2-dot ob2-dot--done" />
            <span className="ob2-dot ob2-dot--done" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner animate-scale-in">

        {/* Header */}
        <div className="ob-header">
          <div className="ob-logo">O</div>
          <div className="ob-header-meta">
            <span className="ob-title-brand">Quick setup</span>
            <span className="ob-step-label">Step {step + 1} of 3</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="ob-progress-track">
          <div
            className="ob-progress-fill"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Step ${step + 1} of 3`}
          />
        </div>

        {/* Step 0: Business type ───────────────────────────────────── */}
        {step === 0 && (
          <div className="ob-body">
            <h2 className="ob-question">What kind of business do you run?</h2>
            <p className="ob-subtext">
              This helps Ooplix write follow-up messages that sound like you.
            </p>
            <ChipGrid
              options={BIZ_TYPES}
              selected={bizType}
              onSelect={setBizType}
            />
            {bizType === "other" && (
              <input
                className="ob-input ob2-other-input"
                type="text"
                placeholder="Describe your business…"
                value={product}
                onChange={e => setProduct(e.target.value)}
                autoFocus
              />
            )}
          </div>
        )}

        {/* Step 1: Team size ───────────────────────────────────────── */}
        {step === 1 && (
          <div className="ob-body">
            <h2 className="ob-question">How big is your team?</h2>
            <p className="ob-subtext">
              Helps us calibrate agent workload and default limits.
            </p>
            <ChipGrid
              options={TEAM_SIZES}
              selected={teamSize}
              onSelect={setTeamSize}
            />
          </div>
        )}

        {/* Step 2: Goals ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="ob-body">
            <h2 className="ob-question">What do you want to achieve?</h2>
            <p className="ob-subtext">
              Pick one or more. Ooplix will prioritise these surfaces for you.
            </p>
            <ChipGrid
              options={GOALS}
              selected={goals}
              onSelect={setGoals}
              multi={true}
            />
          </div>
        )}

        {/* Actions */}
        <div className="ob2-actions">
          <button
            className="ob-btn"
            onClick={handleNext}
            disabled={!canAdvance}
          >
            {step === 2 ? "Finish setup →" : "Continue →"}
          </button>

          {step > 0 && (
            <button className="ob-back" type="button" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
          )}

          {step === 0 && (
            <p className="ob-confidence-note">No credit card. No account needed yet.</p>
          )}
        </div>

      </div>
    </div>
  );
}
