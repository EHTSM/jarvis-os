import React, { useState } from "react";
import { track } from "../analytics";
import {
  AutomationOverviewPanel, RuleBuilderPanel, TriggerLibraryPanel, AutoHistoryPanel, AutoStatsPanel,
} from "./WorkspaceSettingsK5";
import "./WorkspaceSettings.css";
import "./WorkflowAutomationCenter.css";

const VIEWS = [
  { id: "overview",  label: "Overview"        },
  { id: "rules",      label: "Rule Builder"   },
  { id: "templates",  label: "Trigger Library"},
  { id: "history",    label: "History"        },
  { id: "stats",      label: "Statistics"     },
];

export default function WorkflowAutomationCenter() {
  const [view, setView] = useState("overview");

  React.useEffect(() => { track.event("workflow_automation_viewed"); }, []);

  return (
    <div className="wfc-root">
      <div className="wfc-header">
        <div>
          <h1 className="wfc-title">Workflow Automation</h1>
          <p className="wfc-subtitle">Rules, triggers, conditions, and actions that run your business without you — with dry-run testing and full execution history.</p>
        </div>
      </div>

      <nav className="wfc-subnav">
        {VIEWS.map(v => (
          <button key={v.id} className={`wfc-subnav-btn ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="wfc-content">
        {view === "overview"  && <AutomationOverviewPanel />}
        {view === "rules"     && <RuleBuilderPanel />}
        {view === "templates" && <TriggerLibraryPanel />}
        {view === "history"   && <AutoHistoryPanel />}
        {view === "stats"     && <AutoStatsPanel />}
      </div>
    </div>
  );
}
