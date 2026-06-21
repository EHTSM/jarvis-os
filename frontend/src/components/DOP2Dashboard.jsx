import React, { useState, useCallback } from "react";
import "./DOP2Dashboard.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

// ── Helpers ──────────────────────────────────────────────────────────────────
const VERDICT_COLOR = { "GO": "#34d399", "CONDITIONAL GO": "#fbbf24", "NO GO": "#f87171" };
const PHASE_ICONS = {
  vps_connection:    "🖥",
  dependencies:      "📦",
  repository:        "🗂",
  environment:       "🔐",
  nginx:             "⚡",
  ssl:               "🔒",
  pm2:               "🔄",
  health_verification: "❤️",
  smoke_test:        "🧪",
};
const PHASE_KEYS = ["vpsConn","deps","repo","env","nginx","ssl","pm2","health","smoke"];
const PHASE_IDS  = ["vps_connection","dependencies","repository","environment","nginx","ssl","pm2","health_verification","smoke_test"];

function scoreColor(s) { return s >= 70 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171"; }

function ScoreRing({ score, size = 64 }) {
  const r = (size - 8) / 2, c = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - (score || 0) / 100);
  return (
    <svg width={size} height={size} className="dop2-ring">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle cx={c} cy={c} r={r} fill="none" stroke={scoreColor(score)} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={fill}
        strokeLinecap="round" transform={`rotate(-90 ${c} ${c})`} />
      <text x={c} y={c + 4} textAnchor="middle" fontSize={size < 50 ? 11 : 14}
        fontWeight="700" fill={scoreColor(score)}>{score ?? "--"}%</text>
    </svg>
  );
}

function VerdictBadge({ verdict }) {
  const color = VERDICT_COLOR[verdict] || "#94a3b8";
  return <span className="dop2-verdict" style={{ color, borderColor: color }}>{verdict || "—"}</span>;
}

function CheckRow({ check }) {
  const [open, setOpen] = useState(false);
  const cls = check.pass ? "pass" : check.severity === "warning" ? "warn" : "fail";
  const icon = check.pass ? "✓" : check.severity === "warning" ? "⚠" : "✗";
  const ic   = check.pass ? "#34d399" : check.severity === "warning" ? "#fbbf24" : "#f87171";
  return (
    <div className={`dop2-check ${cls}`} onClick={() => setOpen(o => !o)}>
      <span className="dop2-check-icon" style={{ color: ic }}>{icon}</span>
      <div className="dop2-check-body">
        <div className="dop2-check-label">{check.label}</div>
        {open && (
          <div className="dop2-check-detail">
            {check.detail && <div className="dop2-check-detail-text">{check.detail}</div>}
            {check.fix && <div className="dop2-check-fix">{check.fix}</div>}
          </div>
        )}
      </div>
      <span className="dop2-check-expand">{open ? "▲" : "▼"}</span>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewPanel({ report, onDeploy, loading }) {
  if (!report) return (
    <div className="dop2-empty">
      <div className="dop2-empty-icon">🚀</div>
      <div className="dop2-empty-title">No deployment report yet</div>
      <div className="dop2-empty-sub">Run the deployment validator to check production readiness</div>
      <button className="dop2-btn-primary" onClick={onDeploy} disabled={loading}>
        {loading ? "Running…" : "Run Deployment Validation"}
      </button>
    </div>
  );

  const { productionScore, verdict, totalChecks, totalPassing, criticalFails, runAt, vpsHost, baseUrl, phaseSummary } = report;
  const allChecks = PHASE_KEYS.flatMap(k => report.phases?.[k]?.checks || []);
  const failing   = allChecks.filter(c => !c.pass && c.severity === "critical").slice(0, 8);

  return (
    <div className="dop2-overview">
      <div className="dop2-hero">
        <ScoreRing score={productionScore} size={72} />
        <div className="dop2-hero-info">
          <div className="dop2-hero-verdict">
            <VerdictBadge verdict={verdict} />
          </div>
          <div className="dop2-hero-stats">
            <div className="dop2-stat">
              <span className="dop2-stat-v dop2-green">{totalPassing}</span>
              <span className="dop2-stat-l">passing</span>
            </div>
            <div className="dop2-stat">
              <span className="dop2-stat-v dop2-red">{totalChecks - totalPassing}</span>
              <span className="dop2-stat-l">failing</span>
            </div>
            <div className="dop2-stat">
              <span className="dop2-stat-v dop2-red">{criticalFails}</span>
              <span className="dop2-stat-l">critical</span>
            </div>
            <div className="dop2-stat">
              <span className="dop2-stat-v dop2-violet">{totalChecks}</span>
              <span className="dop2-stat-l">total</span>
            </div>
          </div>
          {vpsHost  && <div className="dop2-hero-run">VPS: {vpsHost}</div>}
          {baseUrl   && <div className="dop2-hero-run">URL: {baseUrl}</div>}
          <div className="dop2-hero-run">Run: {runAt ? new Date(runAt).toLocaleString() : "—"}</div>
        </div>
        <button className="dop2-btn-primary" onClick={onDeploy} disabled={loading}>
          {loading ? "Running…" : "Re-run"}
        </button>
      </div>

      {phaseSummary && (
        <div className="dop2-phase-grid">
          {phaseSummary.map(p => (
            <div className="dop2-phase-card" key={p.phase}>
              <div className="dop2-phase-icon">{PHASE_ICONS[p.phase] || "⚙"}</div>
              <div className="dop2-phase-score" style={{ color: scoreColor(p.score) }}>{p.score}%</div>
              <div className="dop2-phase-label">{p.label}</div>
              <div className="dop2-phase-verdict" style={{ color: VERDICT_COLOR[p.verdict] || "#94a3b8" }}>{p.verdict}</div>
            </div>
          ))}
        </div>
      )}

      {failing.length > 0 && (
        <div className="dop2-failing-block">
          <div className="dop2-block-title">Critical Failures ({failing.length})</div>
          {failing.map(c => (
            <div className="dop2-fail-row" key={c.id}>
              <span className="dop2-crit">CRIT</span>
              <span className="dop2-fail-label">{c.label}</span>
              {c.fix && <span className="dop2-fail-fix">{c.fix}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase Panel ───────────────────────────────────────────────────────────────
function PhasePanel({ phaseData, onRerun, loading, phaseId }) {
  if (!phaseData) return (
    <div className="dop2-empty">
      <div className="dop2-empty-icon">⚙</div>
      <div className="dop2-empty-title">No data for this phase</div>
      <div className="dop2-empty-sub">Run a full deployment validation first</div>
    </div>
  );
  const { label, score, checks = [], passing, total } = phaseData;
  const crit = checks.filter(c => !c.pass && c.severity === "critical").length;
  const warn = checks.filter(c => !c.pass && c.severity === "warning").length;
  return (
    <div className="dop2-phase-panel">
      <div className="dop2-phase-header">
        <ScoreRing score={score} size={52} />
        <div>
          <div className="dop2-phase-title">{label}</div>
          <div className="dop2-phase-sub">{passing}/{total} passing — {crit} critical, {warn} warnings</div>
        </div>
        <button className="dop2-btn-sm" onClick={() => onRerun(phaseId)} disabled={loading}>Re-run</button>
      </div>
      <div className="dop2-checks">
        {checks.map(c => <CheckRow key={c.id} check={c} />)}
      </div>
    </div>
  );
}

// ── Reports Panel ─────────────────────────────────────────────────────────────
function ReportsPanel({ report }) {
  const [repTab, setRepTab] = useState("deployment");
  if (!report?.reports) return (
    <div className="dop2-empty">
      <div className="dop2-empty-icon">📋</div>
      <div className="dop2-empty-title">No reports yet</div>
      <div className="dop2-empty-sub">Run deployment validation to generate reports</div>
    </div>
  );
  const { deployment, liveUrl, failedChecks, warnings } = report.reports;
  const REP_TABS = [
    { id: "deployment",  label: "Deployment" },
    { id: "liveurl",     label: "Live URLs" },
    { id: "failedchecks",label: "Failed Checks" },
    { id: "warnings",    label: "Warnings" },
  ];

  function barColor(s) { return s >= 70 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171"; }

  return (
    <div className="dop2-reports">
      <div className="dop2-report-tabs">
        {REP_TABS.map(t => (
          <button key={t.id} className={`dop2-rep-tab${repTab === t.id ? " active" : ""}`}
            onClick={() => setRepTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="dop2-report-body">
        {repTab === "deployment" && deployment && (
          <>
            <div className="dop2-report-header">
              <div className="dop2-report-type">Deployment Report</div>
              <VerdictBadge verdict={deployment.verdict} />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div className="dop2-stat"><span className="dop2-stat-v" style={{ color: scoreColor(deployment.score) }}>{deployment.score}%</span><span className="dop2-stat-l">prod score</span></div>
              <div className="dop2-stat"><span className="dop2-stat-v dop2-green">{deployment.passing}</span><span className="dop2-stat-l">passing</span></div>
              <div className="dop2-stat"><span className="dop2-stat-v dop2-red">{deployment.failing}</span><span className="dop2-stat-l">failing</span></div>
              <div className="dop2-stat"><span className="dop2-stat-v dop2-red">{deployment.criticalFails}</span><span className="dop2-stat-l">critical</span></div>
              <div className="dop2-stat"><span className="dop2-stat-v dop2-yellow">{deployment.warnings}</span><span className="dop2-stat-l">warnings</span></div>
            </div>
            {deployment.phaseScores && (
              <div className="dop2-phase-scores">
                {deployment.phaseScores.map(ps => (
                  <div className="dop2-ps-row" key={ps.phase}>
                    <div className="dop2-ps-label">{ps.label}</div>
                    <div className="dop2-ps-bar-wrap"><div className="dop2-ps-bar" style={{ width: `${ps.score}%`, background: barColor(ps.score) }} /></div>
                    <div className="dop2-ps-score">{ps.score}%</div>
                  </div>
                ))}
              </div>
            )}
            {deployment.criticalIssues?.length > 0 && (
              <div className="dop2-failing-block" style={{ marginTop: 10 }}>
                <div className="dop2-block-title">Critical Issues</div>
                {deployment.criticalIssues.map(c => (
                  <div className="dop2-fail-row" key={c.id}>
                    <span className="dop2-crit">CRIT</span>
                    <span className="dop2-fail-label">[{c.phaseLabel}] {c.label}</span>
                    {c.fix && <span className="dop2-fail-fix">{c.fix}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {repTab === "liveurl" && liveUrl && (
          <>
            <div className="dop2-report-header">
              <div className="dop2-report-type">Live URL Report</div>
              <span style={{ fontSize: 11, color: liveUrl.liveStatus === "PARTIAL" ? "#fbbf24" : "#94a3b8" }}>{liveUrl.liveStatus}</span>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
              Base: {liveUrl.baseUrl} — {liveUrl.smokeTestsPassing}/{liveUrl.smokeTestsTotal} smoke tests passing
            </div>
            <div className="dop2-url-list">
              {(liveUrl.urls || []).map((u, i) => (
                <div className="dop2-url-row" key={i}>
                  <span className="dop2-url-label">{u.label}</span>
                  <span className="dop2-url-link">{u.url}</span>
                  <span className="dop2-url-purpose">{u.purpose}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {repTab === "failedchecks" && failedChecks && (
          <>
            <div className="dop2-report-header">
              <div className="dop2-report-type">Failed Checks Report</div>
              <span style={{ fontSize: 11, color: "#f87171" }}>{failedChecks.totalFailed} failed</span>
            </div>
            {failedChecks.criticalChecks?.length > 0 && (
              <div className="dop2-failing-block" style={{ marginBottom: 8 }}>
                <div className="dop2-block-title">Critical ({failedChecks.critical})</div>
                {failedChecks.criticalChecks.map(c => (
                  <div className="dop2-fail-row" key={c.id}>
                    <span className="dop2-crit">CRIT</span>
                    <div className="dop2-fail-label">
                      <div>{c.label}</div>
                      <div style={{ fontSize: 10, color: "#475569" }}>{c.phase} — {c.detail}</div>
                    </div>
                    {c.fix && <div className="dop2-fail-fix">{c.fix}</div>}
                  </div>
                ))}
              </div>
            )}
            {failedChecks.actionItems?.length > 0 && (
              <div className="dop2-warn-block">
                <div className="dop2-block-title">Action Items</div>
                {failedChecks.actionItems.map((a, i) => (
                  <div key={i} className="dop2-fail-row">
                    <span style={{ color: "#f87171", fontWeight: 700, marginRight: 4 }}>{i + 1}.</span>
                    <span className="dop2-fail-label" style={{ fontFamily: "monospace", fontSize: 10 }}>{a}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {repTab === "warnings" && warnings && (
          <>
            <div className="dop2-report-header">
              <div className="dop2-report-type">Warnings Report</div>
              <span style={{ fontSize: 11, color: "#fbbf24" }}>{warnings.warningCount} warnings, {warnings.passingCount} passing</span>
            </div>
            {warnings.warnings?.length > 0 ? (
              <div className="dop2-warn-block">
                <div className="dop2-block-title">Warnings</div>
                {warnings.warnings.map(c => (
                  <div className="dop2-fail-row" key={c.id}>
                    <span className="dop2-warn">WARN</span>
                    <div className="dop2-fail-label">
                      <div>{c.label}</div>
                      <div style={{ fontSize: 10, color: "#475569" }}>{c.phase} — {c.detail}</div>
                    </div>
                    {c.fix && <div className="dop2-fail-fix">{c.fix}</div>}
                  </div>
                ))}
              </div>
            ) : <div className="dop2-pass-block"><div className="dop2-block-title">No warnings</div></div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Benchmark Panel ───────────────────────────────────────────────────────────
function BenchmarkPanel({ onRun, loading }) {
  const [bench, setBench] = useState(null);
  const [err,   setErr]   = useState(null);
  const [busy,  setBusy]  = useState(false);

  const runBench = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api("/dop2/benchmark");
      if (d.ok) setBench(d.benchmark);
      else setErr(d.error);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="dop2-bench">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Deployment Benchmark</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>20 deployment gates — validates full production readiness</div>
        </div>
        <button className="dop2-btn-primary" onClick={runBench} disabled={busy}>{busy ? "Running…" : "Run Benchmark"}</button>
      </div>
      {err && <div className="dop2-msg">{err}</div>}
      {bench && (
        <>
          <div className="dop2-hero" style={{ marginBottom: 0 }}>
            <ScoreRing score={bench.score} size={60} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {bench.passing}/{bench.total} gates passed
              </div>
              <VerdictBadge verdict={bench.verdict} />
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                Production: {bench.productionScore}% — Regression: <span style={{ color: bench.regressionPass ? "#34d399" : "#f87171" }}>{bench.regressionPass ? "PASS" : "FAIL"}</span>
              </div>
              {bench.vpsHost && <div style={{ fontSize: 10, color: "#475569" }}>VPS: {bench.vpsHost}</div>}
              {bench.baseUrl && <div style={{ fontSize: 10, color: "#475569" }}>URL: {bench.baseUrl}</div>}
            </div>
          </div>
          <div className="dop2-checks">
            {bench.checks.map(c => (
              <CheckRow key={c.id} check={{ ...c, pass: !!c.ok, detail: c.ok ? "PASS" : "FAIL", severity: c.ok ? "ok" : "critical" }} />
            ))}
          </div>
          <div className="dop2-run-at">Benchmark run: {bench.runAt ? new Date(bench.runAt).toLocaleString() : "—"}</div>
        </>
      )}
    </div>
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────
function HistoryPanel() {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const d = await api("/dop2/history"); if (d.ok) setHistory(d.history); }
    catch {}
    finally { setLoading(false); }
  };
  React.useEffect(() => { load(); }, []);
  if (loading) return <div className="dop2-loading">Loading history…</div>;
  if (!history?.length) return (
    <div className="dop2-empty">
      <div className="dop2-empty-icon">📜</div>
      <div className="dop2-empty-title">No deployment history</div>
      <div className="dop2-empty-sub">Run your first deployment validation to see history</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {history.map((h, i) => (
        <div key={i} style={{ background: "#1e293b", borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 12, fontSize: 11 }}>
          <ScoreRing score={h.productionScore} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}><VerdictBadge verdict={h.verdict} /></div>
            {h.vpsHost && <div style={{ color: "#64748b" }}>VPS: {h.vpsHost}</div>}
            {h.baseUrl && <div style={{ color: "#64748b" }}>URL: {h.baseUrl}</div>}
          </div>
          <div style={{ color: "#475569", fontSize: 10 }}>{h.runAt ? new Date(h.runAt).toLocaleString() : "—"}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",            label: "Overview" },
  { id: "vps_connection",      label: "VPS" },
  { id: "dependencies",        label: "Deps" },
  { id: "repository",          label: "Repo" },
  { id: "environment",         label: "Env" },
  { id: "nginx",               label: "Nginx" },
  { id: "ssl",                 label: "SSL" },
  { id: "pm2",                 label: "PM2" },
  { id: "health_verification", label: "Health" },
  { id: "smoke_test",          label: "Smoke" },
  { id: "reports",             label: "Reports" },
  { id: "benchmark",           label: "Benchmark" },
  { id: "history",             label: "History" },
];

const PHASE_KEY_MAP = {
  vps_connection: "vpsConn", dependencies: "deps", repository: "repo",
  environment: "env", nginx: "nginx", ssl: "ssl",
  pm2: "pm2", health_verification: "health", smoke_test: "smoke",
};

export default function DOP2Dashboard() {
  const [tab,    setTab]    = useState("overview");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,    setErr]    = useState(null);
  const [msg,    setMsg]    = useState(null);

  const loadReport = useCallback(async () => {
    try {
      const d = await api("/dop2/report");
      if (d.ok) setReport(d.report);
    } catch {}
  }, []);

  React.useEffect(() => { loadReport(); }, [loadReport]);

  const runDeploy = async () => {
    setLoading(true); setErr(null);
    setMsg("Running full deployment validation — this may take 30–60 seconds…");
    try {
      const d = await api("/dop2/deploy", { method: "POST" });
      if (d.ok) { setReport(d.report); setMsg("Deployment validation complete."); }
      else setErr(d.error);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const rerunPhase = async (phaseId) => {
    setLoading(true); setErr(null);
    try {
      const d = await api(`/dop2/deploy/phase/${phaseId}`, { method: "POST" });
      if (d.ok && d.phase && report) {
        const key = PHASE_KEY_MAP[phaseId] || phaseId;
        setReport(r => r ? { ...r, phases: { ...r.phases, [key]: d.phase } } : r);
      } else if (!d.ok) setErr(d.error);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const phaseData = tab in PHASE_KEY_MAP ? report?.phases?.[PHASE_KEY_MAP[tab]] : null;

  return (
    <div className="dop2-root">
      <div className="dop2-header">
        <div className="dop2-title">DOP-2 — Real Production Deployment</div>
        <div className="dop2-subtitle">10-phase deployment validation: VPS → Dependencies → Repo → Env → Nginx → SSL → PM2 → Health → Smoke → Reports</div>
        {msg && !err && <div className="dop2-msg">{msg}</div>}
        {err && <div className="dop2-msg" style={{ color: "#f87171" }}>Error: {err}</div>}
      </div>
      <div className="dop2-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`dop2-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="dop2-body">
        {tab === "overview"  && <OverviewPanel report={report} onDeploy={runDeploy} loading={loading} />}
        {tab in PHASE_KEY_MAP && <PhasePanel phaseData={phaseData} onRerun={rerunPhase} loading={loading} phaseId={tab} />}
        {tab === "reports"   && <ReportsPanel report={report} />}
        {tab === "benchmark" && <BenchmarkPanel onRun={runDeploy} loading={loading} />}
        {tab === "history"   && <HistoryPanel />}
      </div>
    </div>
  );
}
