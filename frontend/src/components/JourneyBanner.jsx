import React, { useState } from 'react';
import './JourneyBanner.css';

// ── Journey definitions ───────────────────────────────────────────────────────
const JOURNEYS = {
  saas: {
    label: 'SaaS Journey',
    icon:  '◉',
    steps: [
      { id: 'landing',      label: 'Landing',     tab: null,          icon: '◇', desc: 'Discovered Jarvis OS'           },
      { id: 'onboarding',   label: 'Onboarding',  tab: null,          icon: '◈', desc: 'Business profile created'       },
      { id: 'clients',      label: 'Contacts',    tab: 'clients',     icon: '👤', desc: 'Add leads and contacts'         },
      { id: 'insights',     label: 'Pipeline',    tab: 'insights',    icon: '◇', desc: 'Track leads through funnel'     },
      { id: 'payments',     label: 'Payments',    tab: 'payments',    icon: '✦', desc: 'Collect and track revenue'      },
      { id: 'executivedash',label: 'Executive',   tab: 'executivedash',icon: '◉', desc: 'Review performance and KPIs'   },
      { id: 'reports',      label: 'Reports',     tab: 'reports',     icon: '◻', desc: 'Full business reporting'        },
    ],
  },

  engineering: {
    label: 'Engineering Journey',
    icon:  '⬡',
    steps: [
      { id: 'jarvisbrain',  label: 'Mission',     tab: 'jarvisbrain', icon: '🎯', desc: 'Define objective and goal'     },
      { id: 'planning',     label: 'Planning',    tab: 'jarvisbrain', icon: '🗺️', desc: 'Horizons and sub-task graph'   },
      { id: 'engineering',  label: 'Engineering', tab: 'engineering', icon: '⬡', desc: 'Code, patch, refactor'         },
      { id: 'execution',    label: 'Execution',   tab: 'execution',   icon: '⚡', desc: 'Queue and run tasks'           },
      { id: 'devops',       label: 'Deploy',      tab: 'devops',      icon: '◈', desc: 'Deploy and validate'           },
      { id: 'reliability',  label: 'Reliability', tab: 'reliability', icon: '◈', desc: 'Success metrics and trust'     },
      { id: 'predict',      label: 'Predict',     tab: 'predict',     icon: '◇', desc: 'Failure prediction and risk'   },
      { id: 'selfhealing',  label: 'Heal',        tab: 'selfhealing', icon: '✦', desc: 'Auto-remediation and probes'   },
      { id: 'recommend',    label: 'Recommend',   tab: 'recommend',   icon: '✦', desc: 'Observer recommendations'      },
      { id: 'executivedash',label: 'Review',      tab: 'executivedash',icon: '◉', desc: 'Executive sign-off'           },
    ],
  },

  intelligence: {
    label: 'Intelligence Journey',
    icon:  '◈',
    steps: [
      { id: 'jarvisbrain',  label: 'Mission',     tab: 'jarvisbrain', icon: '🎯', desc: 'Goal and planning horizons'    },
      { id: 'intel',        label: 'Intelligence',tab: 'intel',       icon: '◈', desc: 'Knowledge graph and insights'  },
      { id: 'memory',       label: 'Memory',      tab: 'memory',      icon: '🧠', desc: 'Decisions, facts, learnings'   },
      { id: 'predict',      label: 'Prediction',  tab: 'predict',     icon: '◇', desc: 'Failure risk and confidence'   },
      { id: 'selfimprove',  label: 'Improve',     tab: 'selfimprove', icon: '⬡', desc: 'Self-analysis and overrides'   },
      { id: 'recommend',    label: 'Recommend',   tab: 'recommend',   icon: '✦', desc: 'Observer recommendations'      },
    ],
  },
};

// Determine which journey and step based on active tab
function resolveJourney(currentTab) {
  for (const [key, journey] of Object.entries(JOURNEYS)) {
    const idx = journey.steps.findIndex(s => s.tab === currentTab);
    if (idx !== -1) return { key, journey, currentIdx: idx };
  }
  // Default — fall back to saas if tab not found in any journey
  return null;
}

export default function JourneyBanner({ currentTab, onNavigate, className = '' }) {
  const [dismissed, setDismissed] = useState(false);
  const [journeyKey, setJourneyKey] = useState(null);

  if (dismissed) return null;

  // Pick the first matching journey, prefer explicit key
  const activeKey = journeyKey || (
    Object.keys(JOURNEYS).find(k => JOURNEYS[k].steps.some(s => s.tab === currentTab))
  );
  if (!activeKey) return null;

  const journey  = JOURNEYS[activeKey];
  const stepIdx  = journey.steps.findIndex(s => s.tab === currentTab);
  if (stepIdx === -1) return null;

  const current  = journey.steps[stepIdx];
  const next     = journey.steps[stepIdx + 1] || null;
  const prev     = journey.steps[stepIdx - 1] || null;
  const pct      = Math.round(((stepIdx + 1) / journey.steps.length) * 100);

  return (
    <div className={`jb-root ${className}`}>
      {/* Journey selector */}
      <div className="jb-selector">
        {Object.entries(JOURNEYS).map(([k, j]) => (
          <button
            key={k}
            className={`jb-journey-pill ${activeKey === k ? 'jb-journey-pill--active' : ''}`}
            onClick={() => setJourneyKey(k)}
          >
            <span>{j.icon}</span>
            <span>{j.label}</span>
          </button>
        ))}
        <button className="jb-dismiss" onClick={() => setDismissed(true)} title="Dismiss">✕</button>
      </div>

      {/* Progress track */}
      <div className="jb-track">
        {journey.steps.map((step, i) => {
          const done    = i < stepIdx;
          const active  = i === stepIdx;
          const future  = i > stepIdx;
          return (
            <React.Fragment key={step.id + i}>
              <button
                className={`jb-step ${done ? 'jb-step--done' : active ? 'jb-step--active' : 'jb-step--future'}`}
                onClick={() => step.tab && onNavigate?.(step.tab)}
                disabled={!step.tab || active}
                title={step.desc}
              >
                <span className="jb-step-icon">
                  {done ? '✓' : step.icon}
                </span>
                <span className="jb-step-label">{step.label}</span>
              </button>
              {i < journey.steps.length - 1 && (
                <span className={`jb-connector ${done ? 'jb-connector--done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Status bar */}
      <div className="jb-status">
        <div className="jb-progress-wrap">
          <div className="jb-progress-bar">
            <div className="jb-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="jb-pct">{pct}%</span>
        </div>

        <div className="jb-current">
          <span className="jb-current-label">Now:</span>
          <span className="jb-current-val">{current.label}</span>
          <span className="jb-current-desc">— {current.desc}</span>
        </div>

        {next && (
          <button className="jb-next-btn" onClick={() => next.tab && onNavigate?.(next.tab)}>
            Next: {next.label} →
          </button>
        )}
        {!next && (
          <span className="jb-complete-badge">✓ Journey Complete</span>
        )}
      </div>
    </div>
  );
}

// ── Compact inline variant for headers ────────────────────────────────────────
export function JourneyBreadcrumb({ currentTab, onNavigate }) {
  const result = resolveJourney(currentTab);
  if (!result) return null;
  const { journey, currentIdx } = result;
  const next = journey.steps[currentIdx + 1];

  return (
    <div className="jb-breadcrumb">
      <span className="jb-breadcrumb-journey">{journey.icon} {journey.label}</span>
      {journey.steps.slice(Math.max(0, currentIdx - 1), currentIdx + 3).map((step, i) => {
        const absIdx  = Math.max(0, currentIdx - 1) + i;
        const isActive = absIdx === currentIdx;
        const isDone   = absIdx < currentIdx;
        return (
          <React.Fragment key={step.id + absIdx}>
            <span className="jb-bc-sep">›</span>
            <button
              className={`jb-bc-step ${isActive ? 'jb-bc-step--active' : isDone ? 'jb-bc-step--done' : 'jb-bc-step--future'}`}
              onClick={() => !isActive && step.tab && onNavigate?.(step.tab)}
              disabled={isActive || !step.tab}
            >
              {isDone ? '✓ ' : ''}{step.label}
            </button>
          </React.Fragment>
        );
      })}
      {next && (
        <>
          <span className="jb-bc-sep">›</span>
          <button className="jb-bc-next" onClick={() => next.tab && onNavigate?.(next.tab)}>
            {next.label} →
          </button>
        </>
      )}
    </div>
  );
}
