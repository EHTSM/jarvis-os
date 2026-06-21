import React, { useState, useCallback, useEffect } from "react";
import "./ProductionWiring2.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

function usePW2(path, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api(path).then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, reload: load };
}

const TABS = [
  { id: "overview",    label: "Overview"    },
  { id: "smtp",        label: "SMTP"        },
  { id: "ai",          label: "AI"          },
  { id: "oauth",       label: "OAuth"       },
  { id: "monitoring",  label: "Monitoring"  },
  { id: "storage",     label: "Storage"     },
  { id: "e2e",         label: "E2E Smoke"   },
  { id: "env",         label: "Env Vars"    },
  { id: "benchmark",   label: "Benchmark"   },
];

const INT_PATHS = {
  smtp:       "/wiring2/smtp",
  ai:         "/wiring2/ai",
  oauth:      "/wiring2/oauth",
  monitoring: "/wiring2/monitoring",
  storage:    "/wiring2/storage",
  e2e:        "/wiring2/e2e",
};

function scoreColor(s) {
  if (s >= 80) return "var(--pw2-green)";
  if (s >= 50) return "var(--pw2-yellow)";
  return "var(--pw2-red)";
}
function scoreClass(s) {
  if (s >= 80) return "ok";
  if (s >= 50) return "warn";
  return "fail";
}

function CheckList({ checks }) {
  if (!checks?.length) return <div className="pw2-empty">No checks.</div>;
  return (
    <div className="pw2-checks">
      {checks.map(c => (
        <div key={c.id} className={`pw2-check ${c.pass ? "pass" : c.warning ? "warn" : "fail"}`}>
          <span className="pw2-check-icon">{c.pass ? "✓" : c.warning ? "⚠" : "✗"}</span>
          <div className="pw2-check-body">
            <div className="pw2-check-label">{c.label}</div>
            {c.detail && <div className="pw2-check-detail">{c.detail}</div>}
            {!c.pass && c.fix && <div className="pw2-check-fix">Fix: {c.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function IntPanel({ tabId }) {
  const path = INT_PATHS[tabId];
  const { data, loading, reload } = usePW2(path);
  const [running, setRunning] = useState(false);

  const reRun = async () => {
    setRunning(true);
    await api(`/wiring2/audit/${tabId === "smtp" ? "smtp_email" : tabId === "ai" ? "ai_extended" : tabId === "oauth" ? "oauth_extended" : tabId === "e2e" ? "e2e_smoke" : tabId}`, { method: "POST" });
    reload();
    setRunning(false);
  };

  if (loading) return <div className="pw2-loading">Loading…</div>;
  const result = data?.result;
  if (!result) return <div className="pw2-empty">No data — run an audit.</div>;

  const failures = result.checks.filter(c => !c.pass && !c.warning);
  const warnings = result.checks.filter(c => !c.pass && c.warning);

  return (
    <div>
      <div className="pw2-section-hdr">
        <div className="pw2-section-title">{result.label}</div>
        <span className="pw2-chip pw2-chip-gray">{result.passing}/{result.total}</span>
        <button className="pw2-btn-sm" onClick={reRun} disabled={running}>{running ? "Running…" : "Re-run"}</button>
      </div>
      <div className="pw2-card" style={{ marginBottom: 12 }}>
        <div className="pw2-score-row">
          <span className="pw2-score-big" style={{ color: scoreColor(result.score) }}>{result.score}%</span>
          <div className="pw2-score-meta">
            <div className="pw2-score-sub">{result.score >= 80 ? "Wired" : result.score >= 50 ? "Partially Wired" : "Needs Wiring"}</div>
            <div className="pw2-score-lbl">{result.passing}/{result.total} checks · {failures.length} failures · {warnings.length} warnings</div>
          </div>
        </div>
      </div>
      {failures.length > 0 && (
        <div className="pw2-card" style={{ marginBottom: 8 }}>
          <div className="pw2-card-title" style={{ color: "var(--pw2-red)" }}>Failures ({failures.length})</div>
          <CheckList checks={failures} />
        </div>
      )}
      {warnings.length > 0 && (
        <div className="pw2-card" style={{ marginBottom: 8 }}>
          <div className="pw2-card-title" style={{ color: "var(--pw2-yellow)" }}>Warnings ({warnings.length}) — optional</div>
          <CheckList checks={warnings} />
        </div>
      )}
      <div className="pw2-card">
        <div className="pw2-card-title">All Checks</div>
        <CheckList checks={result.checks} />
      </div>
    </div>
  );
}

function EnvPanel() {
  const { data, loading, reload } = usePW2("/wiring2/env");
  const [filter, setFilter] = useState("missing");

  if (loading) return <div className="pw2-loading">Loading…</div>;
  const d = data;
  if (!d) return <div className="pw2-empty">No data.</div>;

  const rows = filter === "missing" ? d.missing : filter === "present" ? d.present : [...d.missing, ...d.present];

  // Group by integration
  const groups = {};
  for (const r of rows) {
    const g = r.group || r.integration || "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push(r);
  }

  return (
    <div>
      <div className="pw2-section-hdr">
        <div className="pw2-section-title">Environment Variables</div>
        <span className="pw2-chip pw2-chip-red">{d.missingCount} missing</span>
        <span className="pw2-chip pw2-chip-green" style={{ marginLeft: 4 }}>{d.presentCount} present</span>
        <button className="pw2-btn-sm" onClick={reload} style={{ marginLeft: 8 }}>Refresh</button>
      </div>

      <div className="pw2-filter-row">
        {["missing","present","all"].map(f => (
          <button key={f} className={`pw2-filter-btn${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}>
            {f === "missing" ? `Missing (${d.missingCount})` : f === "present" ? `Present (${d.presentCount})` : "All"}
          </button>
        ))}
      </div>

      {Object.entries(groups).map(([group, vars]) => (
        <div key={group} className="pw2-card" style={{ marginBottom: 8 }}>
          <div className="pw2-card-title">{group}</div>
          <table className="pw2-env-table">
            <thead>
              <tr><th>Variable</th><th>Description</th><th>Status</th></tr>
            </thead>
            <tbody>
              {vars.map(v => {
                const present = !!process?.env?.[v.key]; // always false in browser — use data
                const isPresent = d.present.some(p => p.key === v.key);
                return (
                  <tr key={v.key}>
                    <td><code className={`pw2-env-key ${isPresent ? "present" : "missing"}`}>{v.key}</code></td>
                    <td className="pw2-env-desc">{v.desc}</td>
                    <td>{isPresent
                      ? <span className="pw2-chip pw2-chip-green">SET</span>
                      : <span className="pw2-chip pw2-chip-red">MISSING</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {rows.length === 0 && (
        <div className="pw2-empty">
          {filter === "missing" ? "All env vars configured!" : filter === "present" ? "No env vars set yet." : "No env vars."}
        </div>
      )}
    </div>
  );
}

function BenchmarkPanel() {
  const { data, loading, reload } = usePW2("/wiring2/benchmark");
  const [running, setRunning] = useState(false);

  const run = async () => { setRunning(true); await reload(); setRunning(false); };
  if (loading) return <div className="pw2-loading">Running benchmark…</div>;
  const r = data;
  if (!r?.checks) return <div className="pw2-empty">No data.</div>;

  const intChecks  = r.checks.filter(c => !c.id?.startsWith("gate_"));
  const gateChecks = r.checks.filter(c => c.id?.startsWith("gate_"));

  return (
    <div>
      <div className="pw2-section-hdr">
        <div className="pw2-section-title">Sprint 2 Benchmark</div>
        <button className="pw2-btn-sm" onClick={run} disabled={running}>{running ? "Running…" : "Re-run"}</button>
      </div>
      <div className="pw2-card" style={{ marginBottom: 12 }}>
        <div className="pw2-score-row">
          <span className="pw2-score-big" style={{ color: scoreColor(r.score) }}>{r.score}%</span>
          <div className="pw2-score-meta">
            <div className="pw2-score-sub">{r.passing}/{r.total} checks passing</div>
            <div className="pw2-score-lbl">Integration score: {r.integrationScore}% · Check score: {r.overallCheckScore}%</div>
            <div style={{ marginTop: 6 }}>
              {r.regressionPass
                ? <span className="pw2-chip pw2-chip-green">All passing</span>
                : <span className="pw2-chip pw2-chip-red">{r.total - r.passing} failing</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="pw2-two-col">
        <div className="pw2-card">
          <div className="pw2-card-title">Integrations</div>
          <div className="pw2-checks">
            {intChecks.map(c => (
              <div key={c.id} className={`pw2-check ${c.ok ? "pass" : "fail"}`}>
                <span className="pw2-check-icon">{c.ok ? "✓" : "✗"}</span>
                <div className="pw2-check-body"><div className="pw2-check-label">{c.label}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="pw2-card">
          <div className="pw2-card-title">Production Gates</div>
          <div className="pw2-checks">
            {gateChecks.map(c => (
              <div key={c.id} className={`pw2-check ${c.ok ? "pass" : "warn"}`}>
                <span className="pw2-check-icon">{c.ok ? "✓" : "⚠"}</span>
                <div className="pw2-check-body">
                  <div className="pw2-check-label">{c.label.replace("Gate: ", "")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {r.env && (
        <div className="pw2-card">
          <div className="pw2-card-title">Missing Env Vars ({r.env.missingCount})</div>
          {r.env.missing?.length === 0
            ? <div className="pw2-chip pw2-chip-green">All env vars configured!</div>
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {r.env.missing.map(v => (
                  <span key={v.key} className="pw2-chip pw2-chip-red" title={v.desc}>{v.key}</span>
                ))}
              </div>
            )}
        </div>
      )}

      <div className="pw2-score-ts" style={{ color: "var(--pw2-muted)", fontSize: 10, marginTop: 6 }}>
        Run at: {r.runAt ? new Date(r.runAt).toLocaleString() : "—"}
      </div>
    </div>
  );
}

function OverviewPanel() {
  const { data: rpt, loading, reload } = usePW2("/wiring2/report");
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");

  const runAudit = async () => {
    setRunning(true);
    setToast("Running Sprint 2 audit — SMTP, AI, OAuth, Monitoring, Storage, E2E…");
    try {
      await api("/wiring2/audit", { method: "POST" });
      reload();
      setToast("Audit complete");
    } catch { setToast("Audit failed"); }
    setRunning(false);
    setTimeout(() => setToast(""), 4000);
  };

  if (loading) return <div className="pw2-loading">Loading…</div>;
  const report = rpt?.report;

  return (
    <div>
      <div className="pw2-section-hdr">
        <div className="pw2-section-title">Production Wiring Report — Sprint 2</div>
        {toast && <span className="pw2-toast">{toast}</span>}
        <button className="pw2-btn" onClick={runAudit} disabled={running}>
          {running ? "Running…" : "Run Full Audit"}
        </button>
      </div>

      {!report ? (
        <div className="pw2-card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ color: "var(--pw2-muted)", marginBottom: 12 }}>No audit run yet.</div>
          <button className="pw2-btn" onClick={runAudit} disabled={running}>{running ? "Running…" : "Run Audit Now"}</button>
        </div>
      ) : (
        <>
          {/* Score */}
          <div className="pw2-card" style={{ marginBottom: 12 }}>
            <div className="pw2-score-row">
              <span className="pw2-score-big" style={{ color: scoreColor(report.overallScore) }}>
                {report.overallScore}%
              </span>
              <div className="pw2-score-meta">
                <div className="pw2-score-sub">{report.totalPassing}/{report.totalChecks} checks passing</div>
                <div className="pw2-score-lbl">{report.criticalFailures} failures · {report.warnings} warnings</div>
                <div className="pw2-score-ts">Last run: {new Date(report.runAt).toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Gates */}
          <div className="pw2-card" style={{ marginBottom: 12 }}>
            <div className="pw2-card-title">Production Gates</div>
            <div className="pw2-gates">
              {Object.entries(report.gates || {}).map(([k, v]) => (
                <span key={k} className={`pw2-gate ${v ? "ok" : "fail"}`}>
                  {v ? "✓" : "✗"} {k.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          {/* Integration grid */}
          <div className="pw2-card-title" style={{ marginBottom: 8 }}>Integrations</div>
          <div className="pw2-int-grid">
            {(report.integrations || []).map(i => (
              <div key={i.integration} className={`pw2-int-card ${scoreClass(i.score)}`}>
                <div className="pw2-int-name">{i.label}</div>
                <div className="pw2-int-score" style={{ color: scoreColor(i.score) }}>{i.score}%</div>
                <div className="pw2-int-sub">{i.passing}/{i.total} checks</div>
                <div className="pw2-int-bar">
                  <div className="pw2-int-fill" style={{ width: `${i.score}%`, background: scoreColor(i.score) }} />
                </div>
              </div>
            ))}
          </div>

          {/* Failures */}
          {report.failures?.length > 0 && (
            <div className="pw2-card" style={{ marginBottom: 10 }}>
              <div className="pw2-card-title" style={{ color: "var(--pw2-red)" }}>
                Critical Failures ({report.failures.length})
              </div>
              <div className="pw2-checks">
                {report.failures.map(f => (
                  <div key={f.id} className="pw2-check fail">
                    <span className="pw2-check-icon">✗</span>
                    <div className="pw2-check-body">
                      <span className="pw2-chip pw2-chip-red" style={{ marginRight: 6, fontSize: 9 }}>{f.integration}</span>
                      <span className="pw2-check-label">{f.label}</span>
                      {f.detail && <div className="pw2-check-detail">{f.detail}</div>}
                      {f.fix   && <div className="pw2-check-fix">Fix: {f.fix}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {report.warnings?.length > 0 && (
            <div className="pw2-card" style={{ marginBottom: 10 }}>
              <div className="pw2-card-title" style={{ color: "var(--pw2-yellow)" }}>
                Warnings ({report.warnings.length}) — optional integrations
              </div>
              <div className="pw2-checks">
                {report.warnings.map(w => (
                  <div key={w.id} className="pw2-check warn">
                    <span className="pw2-check-icon">⚠</span>
                    <div className="pw2-check-body">
                      <span className="pw2-chip pw2-chip-yellow" style={{ marginRight: 6, fontSize: 9 }}>{w.integration}</span>
                      <span className="pw2-check-label">{w.label}</span>
                      {w.detail && <div className="pw2-check-detail">{w.detail}</div>}
                      {w.fix   && <div className="pw2-check-fix">Fix: {w.fix}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing env vars summary */}
          {report.env?.missing?.length > 0 && (
            <div className="pw2-card">
              <div className="pw2-card-title" style={{ color: "var(--pw2-red)" }}>
                Missing Env Vars ({report.env.missingCount}) — exact variables still required
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {report.env.missing.map(v => (
                  <span key={v.key} className="pw2-chip pw2-chip-red" title={v.desc}>{v.key}</span>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--pw2-muted)" }}>
                See the <strong style={{ color: "var(--pw2-text)" }}>Env Vars</strong> tab for descriptions and fix instructions.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ProductionWiring2() {
  const [tab, setTab] = useState("overview");
  const { data: rpt } = usePW2("/wiring2/report");
  const overall = rpt?.report?.overallScore ?? null;

  const badgeClass = overall === null ? "" : overall >= 80 ? "pw2-badge-ok" : overall >= 50 ? "pw2-badge-warn" : "pw2-badge-err";

  return (
    <div className="pw2-root">
      <div className="pw2-header">
        <span className="pw2-title">Production Wiring 2</span>
        <span className="pw2-subtitle">Sprint 2 — SMTP · AI · OAuth · Monitoring · Storage · E2E</span>
        {overall !== null && (
          <span className={`pw2-badge ${badgeClass}`}>{overall}% wired</span>
        )}
      </div>
      <div className="pw2-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`pw2-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="pw2-content">
        {tab === "overview"   && <OverviewPanel />}
        {tab === "smtp"       && <IntPanel tabId="smtp"       />}
        {tab === "ai"         && <IntPanel tabId="ai"         />}
        {tab === "oauth"      && <IntPanel tabId="oauth"      />}
        {tab === "monitoring" && <IntPanel tabId="monitoring" />}
        {tab === "storage"    && <IntPanel tabId="storage"    />}
        {tab === "e2e"        && <IntPanel tabId="e2e"        />}
        {tab === "env"        && <EnvPanel />}
        {tab === "benchmark"  && <BenchmarkPanel />}
      </div>
    </div>
  );
}
