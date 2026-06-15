/**
 * WorkflowNav — shows the full mission→executive pipeline.
 * Current step highlighted; all others clickable. No dead ends.
 */
import React from "react";
import "./WorkflowNav.css";

export const WORKFLOW_STEPS = [
  { id: "jarvisbrain",  label: "Mission",       icon: "🎯", short: "Mission"   },
  { id: "jarvisbrain",  label: "Planning",       icon: "🗺️", short: "Plan",     tab: "jarvisbrain" },
  { id: "engineering",  label: "Engineering",    icon: "⬡",  short: "Eng"       },
  { id: "execution",    label: "Execution",      icon: "⚡",  short: "Execute"   },
  { id: "reliability",  label: "Reliability",    icon: "◈",  short: "Reliable"  },
  { id: "predict",      label: "Prediction",     icon: "◇",  short: "Predict"   },
  { id: "guardrails",   label: "Guardrails",     icon: "◻",  short: "Guard"     },
  { id: "recommend",    label: "Recommendation", icon: "✦",  short: "Rec"       },
  { id: "executivedash",label: "Executive",      icon: "◉",  short: "Exec"      },
  { id: "memory",       label: "Memory",         icon: "◎",  short: "Memory"    },
];

// Deduplicate: jarvisbrain appears twice (mission + planning). Use index as key.
const STEPS = [
  { tab: "jarvisbrain",  label: "Mission",       icon: "🎯" },
  { tab: "jarvisbrain",  label: "Planning",       icon: "🗺️" },
  { tab: "engineering",  label: "Engineering",    icon: "⬡"  },
  { tab: "execution",    label: "Execution",      icon: "⚡"  },
  { tab: "reliability",  label: "Reliability",    icon: "◈"  },
  { tab: "predict",      label: "Prediction",     icon: "◇"  },
  { tab: "guardrails",   label: "Guardrails",     icon: "◻"  },
  { tab: "recommend",    label: "Recommendation", icon: "✦"  },
  { tab: "executivedash",label: "Executive",      icon: "◉"  },
  { tab: "memory",       label: "Memory",         icon: "◎"  },
];

export default function WorkflowNav({ currentTab, onNavigate }) {
  const currentIdx = STEPS.findIndex(s => s.tab === currentTab);

  return (
    <div className="wfn-root" role="navigation" aria-label="Workflow pipeline">
      <span className="wfn-label">Pipeline:</span>
      <div className="wfn-steps">
        {STEPS.map((step, i) => {
          const isCurrent = step.tab === currentTab && (currentIdx === -1 || i === currentIdx);
          const isPast    = i < currentIdx;
          const isFirst   = i === 0;
          return (
            <React.Fragment key={`${step.tab}-${i}`}>
              {!isFirst && (
                <span className={`wfn-arrow${isPast ? " wfn-arrow--done" : ""}`}>›</span>
              )}
              <button
                className={`wfn-step${isCurrent ? " wfn-step--active" : ""}${isPast ? " wfn-step--done" : ""}`}
                onClick={() => !isCurrent && onNavigate?.(step.tab)}
                disabled={isCurrent}
                title={step.label}
              >
                <span className="wfn-step-icon">{step.icon}</span>
                <span className="wfn-step-label">{step.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
