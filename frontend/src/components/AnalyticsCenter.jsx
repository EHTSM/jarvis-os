import React, { useState } from "react";
import { track } from "../analytics";
import {
  ExecutivePanel, WorkspaceHealthPanel, AutomationROIPanel, AIUtilizationPanel,
  RuntimeCapacityPanel, EnterpriseReportsPanel,
} from "./WorkspaceSettingsK6";
import "./WorkspaceSettings.css";
import "./AnalyticsCenter.css";

const VIEWS = [
  { id: "executive",  label: "Executive"       },
  { id: "workspace",  label: "Workspace Health"},
  { id: "automation", label: "Automation ROI"  },
  { id: "ai",         label: "AI Usage"        },
  { id: "runtime",    label: "Runtime Capacity"},
  { id: "reports",    label: "Enterprise Report"},
];

export default function AnalyticsCenter() {
  const [view, setView] = useState("executive");

  React.useEffect(() => { track.event("analytics_center_viewed"); }, []);

  return (
    <div className="anc-root">
      <div className="anc-header">
        <div>
          <h1 className="anc-title">Analytics</h1>
          <p className="anc-subtitle">Executive KPIs, workspace health, automation ROI, AI usage, and runtime capacity — one rollup, generated live.</p>
        </div>
      </div>

      <nav className="anc-subnav">
        {VIEWS.map(v => (
          <button key={v.id} className={`anc-subnav-btn ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="anc-content">
        {view === "executive"  && <ExecutivePanel />}
        {view === "workspace"  && <WorkspaceHealthPanel />}
        {view === "automation" && <AutomationROIPanel />}
        {view === "ai"         && <AIUtilizationPanel />}
        {view === "runtime"    && <RuntimeCapacityPanel />}
        {view === "reports"    && <EnterpriseReportsPanel />}
      </div>
    </div>
  );
}
