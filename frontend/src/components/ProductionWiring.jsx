import React, { useState, useCallback, useEffect } from "react";
import "./ProductionWiring.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

function usePW(path, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api(path).then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, reload: load };
}

const INTEGRATIONS = [
  { id: "ai_providers",      label: "AI Providers",   icon: "◎", path: "/wiring/ai"        },
  { id: "payments",          label: "Payments",        icon: "₹", path: "/wiring/payments"  },
  { id: "email",             label: "Email",           icon: "✉", path: "/wiring/email"     },
  { id: "oauth",             label: "OAuth",           icon: "⚷", path: "/wiring/oauth"     },
  { id: "whatsapp",          label: "WhatsApp",        icon: "◈", path: "/wiring/whatsapp"  },
  { id: "browser_automation",label: "Browser",         icon: "⬡", path: "/wiring/browser"   },
];

const TABS = [
  { id: "overview",   label: "Overview"   },
  { id: "ai",         label: "AI"         },
  { id: "payments",   label: "Payments"   },
  { id: "email",      label: "Email"      },
  { id: "oauth",      label: "OAuth"      },
  { id: "whatsapp",   label: "WhatsApp"   },
  { id: "browser",    label: "Browser"    },
  { id: "benchmark",  label: "Benchmark"  },
];

function scoreColor(score) {
  if (score >= 80) return "var(--pw-green)";
  if (score >= 50) return "var(--pw-yellow)";
  return "var(--pw-red)";
}

function scoreClass(score) {
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "fail";
}

function CheckList({ checks }) {
  if (!checks?.length) return <div className="pw-empty">No checks</div>;
  return (
    <div className="pw-checks">
      {checks.map(c => (
        <div key={c.id} className={`pw-check ${c.pass ? "pass" : c.warning ? "warn" : "fail"}`}>
          <span className="pw-check-icon">{c.pass ? "✓" : c.warning ? "⚠" : "✗"}</span>
          <div className="pw-check-body">
            <div className="pw-check-label">{c.label}</div>
            <div className="pw-check-detail">{c.detail}</div>
            {!c.pass && c.fix && <div className="pw-check-fix">Fix: {c.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function IntegrationPanel({ path }) {
  const { data, loading, reload } = usePW(path);
  const [running, setRunning] = useState(false);

  const reRun = async () => {
    setRunning(true);
    await api(path.replace("/wiring/", "/wiring/audit/"), { method: "POST" });
    reload();
    setRunning(false);
  };

  if (loading) return <div className="pw-loading">Loading...</div>;
  const result = data?.result;
  if (!result) return <div className="pw-empty">No data — run an audit first.</div>;

  return (
    <div>
      <div className="pw-section-hdr">
        <div className="pw-section-title">{result.label}</div>
        <span className="pw-chip" style={{ background: "rgba(129,140,248,.12)", borderColor: "rgba(129,140,248,.3)", color: "var(--pw-accent)" }}>
          {result.passing}/{result.total} checks
        </span>
        <button className="pw-btn-sm" onClick={reRun} disabled={running}>
          {running ? "Running…" : "Re-run"}
        </button>
      </div>
      <div className="pw-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 32, fontWeight: 900, color: scoreColor(result.score) }}>{result.score}%</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pw-text)" }}>
              {result.score >= 80 ? "Wired" : result.score >= 50 ? "Partially Wired" : "Needs Wiring"}
            </div>
            <div className="pw-report-ts">{result.passing} of {result.total} checks passing</div>
          </div>
        </div>
      </div>
      <CheckList checks={result.checks} />
    </div>
  );
}

function OverviewPanel() {
  const { data: rpt, loading, reload } = usePW("/wiring/report");
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");

  const runAudit = async () => {
    setRunning(true);
    setToast("Running full audit — testing all 6 integrations…");
    try {
      await api("/wiring/audit", { method: "POST" });
      reload();
      setToast("Audit complete");
    } catch { setToast("Audit failed"); }
    setRunning(false);
    setTimeout(() => setToast(""), 3000);
  };

  if (loading) return <div className="pw-loading">Loading…</div>;

  const report = rpt?.report;

  return (
    <div>
      <div className="pw-section-hdr">
        <div className="pw-section-title">Production Wiring Report</div>
        {toast && <span className="pw-toast">{toast}</span>}
        <button className="pw-btn" onClick={runAudit} disabled={running}>
          {running ? "Running…" : "Run Full Audit"}
        </button>
      </div>

      {!report ? (
        <div className="pw-card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ color: "var(--pw-muted)", marginBottom: 12 }}>No audit run yet.</div>
          <button className="pw-btn" onClick={runAudit} disabled={running}>{running ? "Running…" : "Run Audit Now"}</button>
        </div>
      ) : (
        <>
          {/* Score + gates */}
          <div className="pw-card" style={{ marginBottom: 12 }}>
            <div className="pw-score-row">
              <span className="pw-score-big" style={{ color: scoreColor(report.overallScore) }}>
                {report.overallScore}%
              </span>
              <div>
                <div className="pw-score-sub">
                  {report.totalPassing}/{report.totalChecks} checks passing
                </div>
                <div className="pw-score-lbl">
                  {report.criticalFailures} critical failures · {report.warnings} warnings
                </div>
                <div className="pw-report-ts">Last run: {new Date(report.runAt).toLocaleString()}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pw-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Production Gates
            </div>
            <div className="pw-gates">
              {Object.entries(report.gates || {}).map(([k, v]) => (
                <span key={k} className={`pw-gate ${v ? "ok" : "fail"}`}>
                  {v ? "✓" : "✗"} {k.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700 }}>
              {report.productionReady
                ? <span style={{ color: "var(--pw-green)" }}>✓ Production Ready — AI + Payments + WhatsApp all wired</span>
                : <span style={{ color: "var(--pw-red)" }}>✗ Not Production Ready — fix critical failures below</span>}
            </div>
          </div>

          {/* Integration summary grid */}
          <div className="pw-card-title" style={{ marginBottom: 8 }}>Integrations</div>
          <div className="pw-int-grid">
            {(report.integrations || []).map(i => (
              <div key={i.integration} className={`pw-int-card ${scoreClass(i.score)}`}>
                <div className="pw-int-name">{i.label}</div>
                <div className="pw-int-score" style={{ color: scoreColor(i.score) }}>{i.score}%</div>
                <div className="pw-int-sub">{i.passing}/{i.total} checks</div>
                <div className="pw-int-bar">
                  <div className="pw-int-fill" style={{ width: `${i.score}%`, background: scoreColor(i.score) }} />
                </div>
              </div>
            ))}
          </div>

          {/* Critical failures */}
          {report.details && (() => {
            const fails = report.details.flatMap(d =>
              d.checks.filter(c => !c.pass && !c.warning).map(c => ({ ...c, intLabel: d.label }))
            );
            if (!fails.length) return null;
            return (
              <div className="pw-card" style={{ marginBottom: 10 }}>
                <div className="pw-card-title" style={{ color: "var(--pw-red)" }}>Critical Failures ({fails.length})</div>
                <div className="pw-checks">
                  {fails.map(c => (
                    <div key={c.id} className="pw-check fail">
                      <span className="pw-check-icon">✗</span>
                      <div className="pw-check-body">
                        <span className="pw-chip pw-chip-red" style={{ marginRight: 6, fontSize: 9 }}>{c.intLabel}</span>
                        <span className="pw-check-label">{c.label}</span>
                        <div className="pw-check-detail">{c.detail}</div>
                        {c.fix && <div className="pw-check-fix">Fix: {c.fix}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Warnings */}
          {report.details && (() => {
            const warns = report.details.flatMap(d =>
              d.checks.filter(c => !c.pass && c.warning).map(c => ({ ...c, intLabel: d.label }))
            );
            if (!warns.length) return null;
            return (
              <div className="pw-card">
                <div className="pw-card-title" style={{ color: "var(--pw-yellow)" }}>Warnings ({warns.length}) — optional integrations</div>
                <div className="pw-checks">
                  {warns.map(c => (
                    <div key={c.id} className="pw-check warn">
                      <span className="pw-check-icon">⚠</span>
                      <div className="pw-check-body">
                        <span className="pw-chip pw-chip-yellow" style={{ marginRight: 6, fontSize: 9 }}>{c.intLabel}</span>
                        <span className="pw-check-label">{c.label}</span>
                        <div className="pw-check-detail">{c.detail}</div>
                        {c.fix && <div className="pw-check-fix">Fix: {c.fix}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function BenchmarkPanel() {
  const { data, loading, reload } = usePW("/wiring/benchmark");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    await reload();
    setRunning(false);
  };

  if (loading) return <div className="pw-loading">Running benchmark…</div>;
  const r = data;
  if (!r?.checks) return <div className="pw-empty">No data.</div>;

  return (
    <div>
      <div className="pw-section-hdr">
        <div className="pw-section-title">Production Wiring Benchmark</div>
        <button className="pw-btn-sm" onClick={run} disabled={running}>{running ? "Running…" : "Re-run"}</button>
      </div>
      <div className="pw-card" style={{ marginBottom: 12 }}>
        <div className="pw-score-row">
          <span className="pw-score-big" style={{ color: scoreColor(r.score) }}>{r.score}%</span>
          <div>
            <div className="pw-score-sub">{r.passing}/{r.total} integrations wired</div>
            <div className="pw-score-lbl">Overall check score: {r.overallScore}% · {r.launchReadiness?.replace(/_/g, " ")}</div>
            <div style={{ marginTop: 4 }}>
              {r.productionReady
                ? <span className="pw-chip pw-chip-green">Production Ready</span>
                : <span className="pw-chip pw-chip-red">Not Production Ready</span>}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pw-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8 }}>
          Gates
        </div>
        <div className="pw-gates">
          {Object.entries(r.gates || {}).map(([k, v]) => (
            <span key={k} className={`pw-gate ${v ? "ok" : "fail"}`}>
              {v ? "✓" : "✗"} {k.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>
      <div className="pw-checks">
        {r.checks.map(c => (
          <div key={c.id} className={`pw-check ${c.ok ? "pass" : "fail"}`}>
            <span className="pw-check-icon">{c.ok ? "✓" : "✗"}</span>
            <div className="pw-check-body">
              <div className="pw-check-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="pw-report-ts" style={{ marginTop: 8 }}>Run at: {r.runAt ? new Date(r.runAt).toLocaleString() : "—"}</div>
    </div>
  );
}

export default function ProductionWiring() {
  const [tab, setTab] = useState("overview");

  const { data: rpt } = usePW("/wiring/report");
  const report = rpt?.report;
  const overall = report?.overallScore ?? null;

  return (
    <div className="pw-root">
      <div className="pw-header">
        <span className="pw-title">Production Wiring</span>
        <span className="pw-subtitle">Sprint 1 — AI · Payments · Email · OAuth · WhatsApp · Browser</span>
        {overall !== null && (
          <span className={`pw-status-${scoreClass(overall)}`}>
            {overall}% wired
          </span>
        )}
      </div>
      <div className="pw-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`pw-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="pw-content">
        {tab === "overview"   && <OverviewPanel />}
        {tab === "ai"        && <IntegrationPanel path="/wiring/ai"       />}
        {tab === "payments"  && <IntegrationPanel path="/wiring/payments"  />}
        {tab === "email"     && <IntegrationPanel path="/wiring/email"     />}
        {tab === "oauth"     && <IntegrationPanel path="/wiring/oauth"     />}
        {tab === "whatsapp"  && <IntegrationPanel path="/wiring/whatsapp"  />}
        {tab === "browser"   && <IntegrationPanel path="/wiring/browser"   />}
        {tab === "benchmark" && <BenchmarkPanel />}
      </div>
    </div>
  );
}
