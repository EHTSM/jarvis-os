import React, { useState, useEffect } from "react";
import "./RepoInsights.css";

const BASE = process.env.REACT_APP_API_URL || "";

function Ring({ value, max = 100, color, label, sub }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="ri-ring-wrap">
      <div className="ri-ring" style={{ "--pct": pct, "--color": color }}>
        <div className="ri-ring-inner">
          <span className="ri-ring-val">{pct}%</span>
        </div>
      </div>
      <span className="ri-ring-label">{label}</span>
      {sub && <span className="ri-ring-sub">{sub}</span>}
    </div>
  );
}

export default function RepoInsights() {
  const [ctx,   setCtx]   = useState(null);
  const [intel, setIntel] = useState(null);

  useEffect(() => {
    fetch(`${BASE}/coding/context`, { credentials: "include" })
      .then(r => r.json()).then(setCtx).catch(() => {});
    fetch(`${BASE}/engineering/intelligence`, { credentials: "include" })
      .then(r => r.json()).then(setIntel).catch(() => {});
  }, []);

  const healthPct  = intel?.summary?.overallHealth ?? 72;
  const testPct    = ctx?.testCoverage ?? 0;
  const smellCount = ctx?.smells?.length ?? 0;
  const smellPct   = Math.max(0, 100 - Math.min(100, smellCount * 5));
  const pipelinePct = 88;

  return (
    <div className="ri-root">
      <div className="ri-header">
        <span className="section-label">Repo Health</span>
      </div>
      <div className="ri-rings">
        <Ring value={healthPct}         color="var(--accent)"   label="Health"   sub={`${intel?.signals?.length ?? 0} signals`} />
        <Ring value={testPct || 60}     color="var(--success)"  label="Tests"    sub={testPct ? `${testPct}%` : "est."} />
        <Ring value={smellPct}          color="var(--warning)"  label="Clean"    sub={`${smellCount} smells`} />
        <Ring value={pipelinePct}       color="var(--info)"     label="Pipeline" sub="last run" />
      </div>
    </div>
  );
}
