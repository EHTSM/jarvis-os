import React, { useState, useEffect } from "react";
import { _fetch } from "../_client";

// ── K6 Analytics helpers ──────────────────────────────────────────
const GRADE_COLOR = { A: "#52d68a", B: "var(--accent)", C: "var(--warning)", D: "var(--error)" };

function K6Stat({ label, value, sub, color }) {
  return (
    <div className="k6-stat-card">
      <span className="k6-stat-val" style={color ? { color } : {}}>{value ?? "—"}</span>
      <span className="k6-stat-label">{label}</span>
      {sub && <span className="k6-stat-sub">{sub}</span>}
    </div>
  );
}

function K6Section({ title }) {
  return <div className="k6-section-label">{title}</div>;
}

// ── K6 — Executive Analytics Panel ───────────────────────────────
function ExecutivePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/executive").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading executive analytics…</div>;
  if (!data)   return <div className="k2-empty">No data available.</div>;
  const { kpis, topErrors, byIntent, latency } = data;
  return (
    <div className="k6-panel">
      <K6Section title="Platform KPIs" />
      <div className="k6-stat-grid">
        <K6Stat label="Health Score"    value={`${kpis.healthScore}%`}        color={kpis.healthScore >= 80 ? "#52d68a" : kpis.healthScore >= 60 ? "var(--warning)" : "var(--error)"} />
        <K6Stat label="Uptime"          value={`${Math.round(kpis.uptimeSeconds / 3600)}h`} />
        <K6Stat label="Total Requests"  value={kpis.totalRequests} />
        <K6Stat label="Error Rate"      value={`${kpis.errorRate}%`}          color={kpis.errorRate > 5 ? "var(--error)" : kpis.errorRate > 1 ? "var(--warning)" : "#52d68a"} />
        <K6Stat label="Active Agents"   value={kpis.activeAgents} />
        <K6Stat label="AI Providers Up" value={kpis.aiProvidersUp} />
        <K6Stat label="Runtime Recs"    value={kpis.runtimeRecs} />
      </div>

      {topErrors?.length > 0 && (
        <>
          <K6Section title="Top Errors" />
          <div className="k6-list">
            {topErrors.map((e, i) => (
              <div key={i} className="k6-row">
                <span className="k6-row-name">{e.message || e.fingerprint || "Unknown error"}</span>
                <span className="k6-row-val" style={{ color: "var(--error)" }}>{e.count}×</span>
              </div>
            ))}
          </div>
        </>
      )}

      {Object.keys(byIntent || {}).length > 0 && (
        <>
          <K6Section title="Requests by Intent" />
          <div className="k6-stat-grid k6-stat-grid--sm">
            {Object.entries(byIntent).map(([k, v]) => (
              <K6Stat key={k} label={k} value={v} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── K6 — Workspace Health Panel ───────────────────────────────────
function WorkspaceHealthPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/workspace").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading workspace health…</div>;
  if (!data)   return <div className="k2-empty">No data available.</div>;
  const { security, governance, members, quotas } = data;
  return (
    <div className="k6-panel">
      <K6Section title="Security" />
      <div className="k6-stat-grid">
        <K6Stat label="Security Score" value={`${security.score}%`} color={GRADE_COLOR[security.grade]} sub={`Grade ${security.grade}`} />
        <K6Stat label="Active Sessions" value={security.activeSessions} />
      </div>
      <K6Section title="Governance" />
      <div className="k6-stat-grid">
        <K6Stat label="Compliance Score" value={`${governance.complianceScore}%`} color={GRADE_COLOR[governance.complianceGrade]} sub={`Grade ${governance.complianceGrade}`} />
        <K6Stat label="Active Policies"  value={governance.activePolicies} />
      </div>
      <K6Section title="Team" />
      <div className="k6-stat-grid">
        <K6Stat label="Total Members"     value={members.total} />
        <K6Stat label="Active"            value={members.active} />
        <K6Stat label="Suspended"         value={members.suspended} color={members.suspended > 0 ? "var(--warning)" : undefined} />
        <K6Stat label="Max Members Quota" value={quotas.maxMembers} />
      </div>
    </div>
  );
}

// ── K6 — Automation ROI Panel ─────────────────────────────────────
function AutomationROIPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/automation").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading automation analytics…</div>;
  if (!data)   return <div className="k2-empty">No data available.</div>;
  const { rules, execution, roi, topRules } = data;
  return (
    <div className="k6-panel">
      <K6Section title="ROI Estimate" />
      <div className="k6-stat-grid">
        <K6Stat label="Est. Hours Saved"  value={roi.estimatedHoursSaved} sub="@ 5 min/task" color="#52d68a" />
        <K6Stat label="Automation Runs"   value={roi.automationRunsTotal} />
        <K6Stat label="Success Rate"      value={`${execution.successRate}%`} color={execution.successRate >= 90 ? "#52d68a" : "var(--warning)"} />
        <K6Stat label="Active Rules"      value={rules.active} />
        <K6Stat label="Last 24h Runs"     value={execution.last24h} />
        <K6Stat label="Last 7d Runs"      value={execution.last7d} />
      </div>
      {topRules?.length > 0 && (
        <>
          <K6Section title="Top Rules by Run Count" />
          <div className="k6-list">
            {topRules.map(r => (
              <div key={r.id} className="k6-row">
                <span className="k6-row-name">{r.name}</span>
                <span className="k6-row-meta">{r.runCount} runs</span>
                <span className="k6-row-val" style={{ color: r.lastOutcome === "success" ? "#52d68a" : "var(--text-faint)" }}>{r.lastOutcome || "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── K6 — AI Provider Utilization Panel ───────────────────────────
function AIUtilizationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/ai").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading AI utilization…</div>;
  if (!data)   return <div className="k2-empty">No data available.</div>;
  const { providers, totalCalls, requestsTotal } = data;
  return (
    <div className="k6-panel">
      <K6Section title="Call Volume" />
      <div className="k6-stat-grid">
        <K6Stat label="Total AI Calls"      value={totalCalls} />
        <K6Stat label="Total App Requests"  value={requestsTotal} />
      </div>
      <K6Section title="Provider Status" />
      <div className="k6-list">
        {providers.map(p => (
          <div key={p.name} className="k6-row">
            <span className="k6-row-name" style={{ textTransform: "capitalize" }}>{p.name}</span>
            <span className="k6-row-meta">{p.callCount} calls</span>
            <span className="k6-badge" style={{ background: p.available ? "rgba(82,214,138,0.12)" : "rgba(255,80,80,0.12)", color: p.available ? "#52d68a" : "var(--error)" }}>
              {p.available ? "up" : p.hasKey ? "down" : "no key"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K6 — Runtime Capacity Panel ───────────────────────────────────
function RuntimeCapacityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/runtime").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading runtime capacity…</div>;
  if (!data)   return <div className="k2-empty">No data available.</div>;
  const { process: proc, taskQueue, graphs, agents, missions } = data;
  return (
    <div className="k6-panel">
      <K6Section title="Process" />
      <div className="k6-stat-grid">
        <K6Stat label="Uptime"         value={`${Math.round(proc.uptimeSeconds / 3600)}h`} />
        <K6Stat label="Memory (RSS)"   value={`${proc.memoryMB} MB`} />
        <K6Stat label="Heap Used"      value={`${proc.heapUsedMB} MB`} />
        <K6Stat label="Heap Total"     value={`${proc.heapTotalMB} MB`} />
      </div>
      <K6Section title="Task Queue" />
      <div className="k6-stat-grid">
        <K6Stat label="Pending"    value={taskQueue.pending}  color={taskQueue.pending  > 10 ? "var(--warning)" : undefined} />
        <K6Stat label="Running"    value={taskQueue.running} />
        <K6Stat label="Total"      value={taskQueue.total} />
        <K6Stat label="Slow Tasks" value={taskQueue.slowTaskCount} color={taskQueue.slowTaskCount > 0 ? "var(--warning)" : undefined} />
      </div>
      {taskQueue.typeBreakdown?.length > 0 && (
        <>
          <K6Section title="Task Types" />
          <div className="k6-list">
            {taskQueue.typeBreakdown.map(t => (
              <div key={t.type} className="k6-row">
                <span className="k6-row-name">{t.type}</span>
                <span className="k6-row-meta">{t.count} runs · avg {t.avg_ms}ms</span>
                <span className="k6-row-val" style={{ color: t.success_rate >= 90 ? "#52d68a" : "var(--warning)" }}>{t.success_rate}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      <K6Section title="Graphs & Missions" />
      <div className="k6-stat-grid">
        <K6Stat label="Total Graphs"    value={graphs.total} />
        <K6Stat label="Completed"       value={graphs.completed} />
        <K6Stat label="Failed Graphs"   value={graphs.failed}   color={graphs.failed  > 0 ? "var(--error)" : undefined} />
        <K6Stat label="Running Graphs"  value={graphs.running} />
        <K6Stat label="Total Missions"  value={missions.total} />
        <K6Stat label="Agents"          value={agents.count} />
      </div>
    </div>
  );
}

// ── K6 — Enterprise Reports Panel ────────────────────────────────
function EnterpriseReportsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/analytics/reports").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Generating enterprise report…</div>;
  if (!data)   return <div className="k2-empty">Report unavailable.</div>;

  const ts = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—";
  const sections = [
    { key: "executive",    title: "Executive KPIs",     cells: [
      ["Health Score",  `${data.executive?.kpis?.healthScore ?? "—"}%`],
      ["Requests",      data.executive?.kpis?.totalRequests ?? "—"],
      ["Error Rate",    `${data.executive?.kpis?.errorRate ?? "—"}%`],
      ["Active Agents", data.executive?.kpis?.activeAgents ?? "—"],
    ]},
    { key: "workspace",    title: "Workspace Health",    cells: [
      ["Security Grade",    data.workspace?.security?.grade ?? "—"],
      ["Compliance Grade",  data.workspace?.governance?.complianceGrade ?? "—"],
      ["Members",           data.workspace?.members?.total ?? "—"],
      ["Active Policies",   data.workspace?.governance?.activePolicies ?? "—"],
    ]},
    { key: "automation",   title: "Automation ROI",      cells: [
      ["Hours Saved",   data.automation?.roi?.estimatedHoursSaved ?? "—"],
      ["Success Rate",  `${data.automation?.execution?.successRate ?? "—"}%`],
      ["Active Rules",  data.automation?.rules?.active ?? "—"],
      ["Last 7d Runs",  data.automation?.execution?.last7d ?? "—"],
    ]},
    { key: "security",     title: "Security",            cells: [
      ["Score",       `${data.security?.score ?? "—"}%`],
      ["Grade",       data.security?.grade ?? "—"],
      ["Audit Events (24h)", data.security?.audit?.last24h ?? "—"],
      ["Trusted Devices",   data.security?.devices?.trusted ?? "—"],
    ]},
    { key: "governance",   title: "Governance",          cells: [
      ["Compliance",   `${data.governance?.compliance?.score ?? "—"}%`],
      ["Frameworks",   (data.governance?.compliance?.frameworks || []).length],
      ["Policies",     data.governance?.policies?.total ?? "—"],
      ["Critical Risk", data.governance?.risk?.summary?.critical ?? 0],
    ]},
    { key: "ai",           title: "AI Utilization",      cells: [
      ["Total Calls",   data.ai?.totalCalls ?? "—"],
      ["Providers Up",  (data.ai?.providers || []).filter(p => p.available).length],
    ]},
    { key: "runtime",      title: "Runtime Capacity",    cells: [
      ["Memory (MB)",    data.runtime?.process?.memoryMB ?? "—"],
      ["Queue Pending",  data.runtime?.taskQueue?.pending ?? "—"],
      ["Graphs Total",   data.runtime?.graphs?.total ?? "—"],
      ["Missions",       data.runtime?.missions?.total ?? "—"],
    ]},
  ];

  return (
    <div className="k6-panel">
      <div className="k6-report-header">
        <span className="k6-report-title">Enterprise Report</span>
        <span className="k6-report-ts">Generated {ts}</span>
      </div>
      {sections.map(sec => (
        <div key={sec.key} className="k6-report-block">
          <K6Section title={sec.title} />
          <div className="k6-stat-grid k6-stat-grid--sm">
            {sec.cells.map(([label, val]) => (
              <K6Stat key={label} label={label} value={val} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


export { K6Stat, K6Section, ExecutivePanel, WorkspaceHealthPanel, AutomationROIPanel, AIUtilizationPanel, RuntimeCapacityPanel, EnterpriseReportsPanel };
