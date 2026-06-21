import React, { useState, useCallback, useEffect } from "react";
import "./DOP1Dashboard.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

const MODULES = [
  { id: "vps",        label: "VPS",         icon: "🖥" },
  { id: "nginx",      label: "Nginx",        icon: "⚡" },
  { id: "ssl",        label: "SSL",          icon: "🔒" },
  { id: "dns",        label: "DNS",          icon: "🌐" },
  { id: "domains",    label: "Domains",      icon: "◎" },
  { id: "deployment", label: "Deployment",   icon: "🚀" },
  { id: "backup",     label: "Backup",       icon: "💾" },
  { id: "monitoring", label: "Monitoring",   icon: "📊" },
  { id: "security",   label: "Security",     icon: "🛡" },
  { id: "stress",     label: "Stress",       icon: "⚗" },
];

const REPORTS = [
  { id: "infrastructure", label: "Infrastructure", icon: "🏗" },
  { id: "deployment",     label: "Deployment",     icon: "🚀" },
  { id: "security",       label: "Security",       icon: "🛡" },
  { id: "performance",    label: "Performance",    icon: "⚗" },
];

const TABS = [
  { id: "overview",   label: "Overview",     icon: "📋" },
  ...MODULES.map(m => ({ id: m.id, label: m.label, icon: m.icon })),
  { id: "reports",    label: "Reports",      icon: "📄" },
  { id: "benchmark",  label: "Benchmark",    icon: "🏁" },
];

const VERDICT_COLOR = { "GO": "#34d399", "CONDITIONAL GO": "#fbbf24", "NO GO": "#f87171" };

function useData(path, deps = []) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const load = useCallback(() => {
    setLoad(true);
    api(path).then(r => { setData(r); setLoad(false); }).catch(() => setLoad(false));
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, reload: load };
}

function ScoreRing({ score, size = 70, label = null }) {
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const dash  = (Math.min(score, 100) / 100) * circ;
  const color = score >= 70 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="dop-ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={8}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2 + 5} textAnchor="middle" fill={color}
        fontSize={size * 0.22} fontWeight="bold">{score}%</text>
      {label && <text x={size/2} y={size/2 + size*0.28} textAnchor="middle" fill="#64748b" fontSize={size*0.13}>{label}</text>}
    </svg>
  );
}

function VerdictBadge({ verdict }) {
  const color = VERDICT_COLOR[verdict] || "#94a3b8";
  return <span className="dop-verdict" style={{ color, borderColor: color }}>{verdict || "UNKNOWN"}</span>;
}

function CheckRow({ check }) {
  const [expanded, setExpanded] = useState(false);
  const icon = check.pass ? "✅" : (check.severity === "warning" ? "⚠️" : "❌");
  return (
    <div className={`dop-check ${check.pass ? "pass" : check.severity === "warning" ? "warn" : "fail"}`}
         onClick={() => setExpanded(!expanded)}>
      <span className="dop-check-icon">{icon}</span>
      <div className="dop-check-body">
        <div className="dop-check-label">{check.label}</div>
        {expanded && (
          <div className="dop-check-detail">
            <div className="dop-check-detail-text">{check.detail}</div>
            {check.fix && <div className="dop-check-fix">Fix: {check.fix}</div>}
          </div>
        )}
      </div>
      <span className="dop-check-expand">{expanded ? "▲" : "▼"}</span>
    </div>
  );
}

function ModuleCard({ m, score, verdict }) {
  const color = score >= 70 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  return (
    <div className="dop-mod-card">
      <div className="dop-mod-icon">{m.icon}</div>
      <div className="dop-mod-score" style={{ color }}>{score}%</div>
      <div className="dop-mod-label">{m.label}</div>
      <div className="dop-mod-verdict" style={{ color }}>{verdict}</div>
    </div>
  );
}

function OverviewPanel({ onAudit, running }) {
  const { data, loading } = useData("/dop/report", []);
  const report = data?.report;

  if (loading) return <div className="dop-loading">Loading…</div>;
  if (!report) return (
    <div className="dop-empty">
      <div className="dop-empty-icon">📋</div>
      <div className="dop-empty-title">No audit yet</div>
      <div className="dop-empty-sub">Run a full audit to validate all 10 production modules</div>
      <button className="dop-btn-primary" onClick={onAudit} disabled={running}>
        {running ? "Auditing…" : "Run Full Audit"}
      </button>
    </div>
  );

  const vcolor = VERDICT_COLOR[report.verdict] || "#94a3b8";
  return (
    <div className="dop-overview">
      <div className="dop-hero">
        <ScoreRing score={report.productionScore} size={110} />
        <div className="dop-hero-info">
          <div className="dop-hero-verdict" style={{ color: vcolor }}>{report.verdict}</div>
          <div className="dop-hero-stats">
            <div className="dop-stat"><span className="dop-stat-v dop-green">{report.totalPassing}</span><span className="dop-stat-l">Passing</span></div>
            <div className="dop-stat"><span className="dop-stat-v dop-red">{report.totalChecks - report.totalPassing}</span><span className="dop-stat-l">Failing</span></div>
            <div className="dop-stat"><span className="dop-stat-v dop-red">{report.criticalFails}</span><span className="dop-stat-l">Critical</span></div>
            <div className="dop-stat"><span className="dop-stat-v">{report.totalChecks}</span><span className="dop-stat-l">Total</span></div>
          </div>
          <div className="dop-hero-run">Run: {report.runAt ? new Date(report.runAt).toLocaleString() : "—"} · {Math.round((report.durationMs || 0)/1000)}s</div>
        </div>
        <button className="dop-btn-primary" onClick={onAudit} disabled={running}>
          {running ? "Running…" : "Re-run Audit"}
        </button>
      </div>

      <div className="dop-module-grid">
        {MODULES.map(m => {
          const s = report.summary?.[m.id];
          return s ? <ModuleCard key={m.id} m={m} score={report.modules?.[m.id === "dns" ? "dns" : m.id]?.score || 0} verdict={s.verdict} /> : null;
        })}
      </div>

      {report.reports?.infrastructure?.failingChecks?.length > 0 && (
        <div className="dop-failing-block">
          <div className="dop-block-title">⚠ Top Failing Checks</div>
          {report.reports.infrastructure.failingChecks.slice(0, 10).map(c => (
            <div key={c.id} className="dop-fail-row">
              <span className={c.severity === "critical" ? "dop-crit" : "dop-warn"}>{c.severity === "critical" ? "CRITICAL" : "WARN"}</span>
              <span className="dop-fail-label">{c.label}</span>
              {c.fix && <span className="dop-fail-fix">{c.fix}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModulePanel({ moduleId, onRerun, running }) {
  const { data, loading } = useData(`/dop/module/${moduleId}`, []);
  const mod = data?.module;
  const meta = MODULES.find(m => m.id === moduleId);

  if (loading) return <div className="dop-loading">Loading…</div>;
  if (!mod) return (
    <div className="dop-empty">
      <div className="dop-empty-sub">No data for {moduleId}. Run audit first.</div>
      <button className="dop-btn-sm" onClick={() => onRerun(moduleId)} disabled={running}>Run module</button>
    </div>
  );

  return (
    <div className="dop-module-panel">
      <div className="dop-module-header">
        <ScoreRing score={mod.score} size={70} />
        <div>
          <div className="dop-module-title">{meta?.icon} {mod.label}</div>
          <div className="dop-module-sub">{mod.passing}/{mod.total} checks passing</div>
        </div>
        <button className="dop-btn-sm" onClick={() => onRerun(moduleId)} disabled={running}>
          {running ? "Running…" : "Re-run"}
        </button>
      </div>
      <div className="dop-checks">
        {mod.checks?.map(c => <CheckRow key={c.id} check={c} />)}
      </div>
      {moduleId === "stress" && mod.results?.length > 0 && (
        <div className="dop-perf-table">
          <div className="dop-block-title">Load Test Results</div>
          <table className="dop-table">
            <thead><tr><th>Users</th><th>P50</th><th>P95</th><th>P99</th><th>Avg</th><th>Errors</th><th>CPU</th><th>Mem</th></tr></thead>
            <tbody>{mod.results.map(r => (
              <tr key={r.users} className={r.p95Pass && r.errPass ? "dop-tr-pass" : "dop-tr-fail"}>
                <td>{r.users}</td>
                <td>{r.p50}ms</td>
                <td className={r.p95Pass ? "dop-green" : "dop-red"}>{r.p95}ms</td>
                <td>{r.p99}ms</td>
                <td>{r.avg}ms</td>
                <td className={r.errPass ? "" : "dop-red"}>{r.errPct}%</td>
                <td>{r.cpuPct > 0 ? `${r.cpuPct}%` : "—"}</td>
                <td>{r.memUsedMB > 0 ? `${r.memUsedMB}MB` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportsPanel() {
  const { data, loading } = useData("/dop/report", []);
  const report = data?.report;
  const [activeReport, setActiveReport] = useState("infrastructure");

  if (loading) return <div className="dop-loading">Loading…</div>;
  if (!report) return <div className="dop-empty"><div className="dop-empty-sub">No report yet.</div></div>;

  const sub = report.reports?.[activeReport];
  const vcolor = VERDICT_COLOR[sub?.verdict] || "#94a3b8";

  return (
    <div className="dop-reports">
      <div className="dop-report-tabs">
        {REPORTS.map(r => (
          <button key={r.id} className={`dop-rep-tab ${activeReport === r.id ? "active" : ""}`}
            onClick={() => setActiveReport(r.id)}>
            {r.icon} {r.label}
          </button>
        ))}
      </div>
      {sub && (
        <div className="dop-report-body">
          <div className="dop-report-header">
            <div className="dop-report-type">{sub.type}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ScoreRing score={sub.score} size={60} />
              <VerdictBadge verdict={sub.verdict} />
            </div>
          </div>

          {activeReport === "infrastructure" && (
            <>
              <div className="dop-module-scores">
                {sub.moduleScores?.map(m => (
                  <div key={m.module} className="dop-ms-row">
                    <span className="dop-ms-label">{m.label}</span>
                    <div className="dop-ms-bar-wrap">
                      <div className="dop-ms-bar" style={{ width: `${m.score}%`, background: m.score >= 70 ? "#34d399" : m.score >= 50 ? "#fbbf24" : "#f87171" }} />
                    </div>
                    <span className="dop-ms-score">{m.score}%</span>
                  </div>
                ))}
              </div>
              {sub.failingChecks?.length > 0 && (
                <div className="dop-failing-block" style={{ marginTop: 10 }}>
                  <div className="dop-block-title">Failing Checks</div>
                  {sub.failingChecks.map(c => <CheckRow key={c.id} check={c} />)}
                </div>
              )}
            </>
          )}

          {activeReport === "security" && (
            <>
              {sub.criticalIssues?.length > 0 && (
                <div className="dop-failing-block">
                  <div className="dop-block-title">Critical Issues ({sub.criticalIssues.length})</div>
                  {sub.criticalIssues.map(c => <CheckRow key={c.id} check={c} />)}
                </div>
              )}
              {sub.warnings?.length > 0 && (
                <div className="dop-warn-block">
                  <div className="dop-block-title">Warnings ({sub.warnings.length})</div>
                  {sub.warnings.map(c => <CheckRow key={c.id} check={c} />)}
                </div>
              )}
              {sub.checks?.filter(c => c.pass).length > 0 && (
                <div className="dop-pass-block">
                  <div className="dop-block-title">Passing</div>
                  {sub.checks.filter(c => c.pass).map(c => <CheckRow key={c.id} check={c} />)}
                </div>
              )}
            </>
          )}

          {activeReport === "performance" && (
            <>
              {sub.summary?.length > 0 && (
                <div className="dop-perf-summary">
                  {sub.summary.map((s, i) => (
                    <div key={i} className="dop-perf-row">{s}</div>
                  ))}
                </div>
              )}
              {sub.results?.length > 0 && (
                <table className="dop-table" style={{ marginTop: 10 }}>
                  <thead><tr><th>Users</th><th>P50</th><th>P95</th><th>P99</th><th>Avg</th><th>Err%</th><th>CPU</th><th>Mem</th></tr></thead>
                  <tbody>{sub.results.map(r => (
                    <tr key={r.users} className={r.p95Pass && r.errPass ? "dop-tr-pass" : "dop-tr-fail"}>
                      <td>{r.users}</td>
                      <td>{r.p50}ms</td>
                      <td className={r.p95Pass ? "dop-green" : "dop-red"}>{r.p95}ms</td>
                      <td>{r.p99}ms</td>
                      <td>{r.avg}ms</td>
                      <td className={r.errPass ? "" : "dop-red"}>{r.errPct}%</td>
                      <td>{r.cpuPct > 0 ? `${r.cpuPct}%` : "—"}</td>
                      <td>{r.memUsedMB > 0 ? `${r.memUsedMB}MB` : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </>
          )}

          {["deployment"].includes(activeReport) && sub.checks && (
            <div className="dop-checks" style={{ marginTop: 8 }}>
              {sub.checks.map(c => <CheckRow key={c.id} check={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BenchmarkPanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api("/dop/benchmark").then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="dop-loading">Running benchmark…</div>;
  if (!data)   return <div className="dop-empty"><button className="dop-btn-sm" onClick={load}>Run Benchmark</button></div>;

  const vcolor = VERDICT_COLOR[data.verdict] || "#94a3b8";
  return (
    <div className="dop-bench">
      <div className="dop-hero" style={{ marginBottom: 12 }}>
        <ScoreRing score={data.score} size={90} />
        <div className="dop-hero-info">
          <div className="dop-hero-verdict" style={{ color: vcolor }}>{data.verdict}</div>
          <div className="dop-hero-stats">
            <div className="dop-stat"><span className="dop-stat-v">{data.passing}/{data.total}</span><span className="dop-stat-l">Gates</span></div>
            <div className="dop-stat"><span className="dop-stat-v">{data.productionScore}%</span><span className="dop-stat-l">Prod Score</span></div>
            <div className="dop-stat">
              <span className={`dop-stat-v ${data.regressionPass ? "dop-green" : "dop-red"}`}>
                {data.regressionPass ? "PASS" : "FAIL"}
              </span>
              <span className="dop-stat-l">Regression</span>
            </div>
          </div>
        </div>
        <button className="dop-btn-sm" onClick={load} disabled={loading}>Re-run</button>
      </div>
      <div className="dop-checks">
        {data.checks?.map(c => (
          <div key={c.id} className={`dop-check ${c.ok ? "pass" : "fail"}`}>
            <span className="dop-check-icon">{c.ok ? "✅" : "❌"}</span>
            <span className="dop-check-label" style={{ flex: 1 }}>{c.label}</span>
          </div>
        ))}
      </div>
      <div className="dop-run-at">Run: {data.runAt ? new Date(data.runAt).toLocaleString() : "—"}</div>
    </div>
  );
}

export default function DOP1Dashboard() {
  const [tab, setTab]           = useState("overview");
  const [running, setRunning]   = useState(false);
  const [msg, setMsg]           = useState(null);

  const runAudit = useCallback(async () => {
    setRunning(true); setMsg("Running full 10-module audit…");
    try {
      await api("/dop/audit", { method: "POST" });
      setMsg("Audit complete — refreshing…");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRunning(false); }
  }, []);

  const rerunModule = useCallback(async (mod) => {
    setRunning(true); setMsg(`Re-running ${mod}…`);
    try {
      await api(`/dop/audit/${mod}`, { method: "POST" });
      setMsg(`${mod} complete`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRunning(false); }
  }, []);

  return (
    <div className="dop-root">
      <div className="dop-header">
        <div className="dop-title">⚙ DOP-1 — Production Infrastructure Validation</div>
        <div className="dop-subtitle">10 modules · VPS · Nginx · SSL · DNS · Domains · Deployment · Backup · Monitoring · Security · Stress</div>
        {msg && <div className="dop-msg">{msg}</div>}
      </div>
      <div className="dop-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`dop-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="dop-body">
        {tab === "overview"   && <OverviewPanel onAudit={runAudit} running={running} />}
        {MODULES.some(m => m.id === tab) && <ModulePanel moduleId={tab} onRerun={rerunModule} running={running} />}
        {tab === "reports"    && <ReportsPanel />}
        {tab === "benchmark"  && <BenchmarkPanel />}
      </div>
    </div>
  );
}
