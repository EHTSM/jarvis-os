import React, { useState, useCallback, useEffect } from "react";
import "./CredentialDashboard.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

const TABS = [
  { id: "overview", label: "Overview",  icon: "🔐" },
  { id: "email",    label: "Email",     icon: "📧" },
  { id: "ai",       label: "AI",        icon: "🤖" },
  { id: "oauth",    label: "OAuth",     icon: "🔑" },
  { id: "crash",    label: "Crash",     icon: "🛡️" },
  { id: "storage",  label: "Storage",   icon: "💾" },
  { id: "env",      label: "Env Vars",  icon: "⚙️" },
  { id: "benchmark",label: "Benchmark", icon: "📊" },
];

const STATUS_ICONS = { configured: "✅", missing: "❌", invalid: "🔴", expired: "⏰", warning: "⚠️" };
const STATUS_CLASS  = { configured: "cd-pass", missing: "cd-fail", invalid: "cd-fail", expired: "cd-warn", warning: "cd-warn" };

function useCD(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api(path);
      setData(r);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => { load(); }, [...deps, load]);

  return { data, loading, err, reload: load };
}

function ScoreRing({ score, size = 80 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const color = score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="cd-ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#334155" strokeWidth={8} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2 + 5} textAnchor="middle" fill={color} fontSize={size * 0.22} fontWeight="bold">{score}%</text>
    </svg>
  );
}

function CredItem({ cred }) {
  const icon  = STATUS_ICONS[cred.status] || "?";
  const cls   = STATUS_CLASS[cred.status]  || "cd-warn";
  return (
    <div className={`cd-cred-row ${cls}`}>
      <span className="cd-cred-icon">{icon}</span>
      <div className="cd-cred-body">
        <div className="cd-cred-label">{cred.label}</div>
        {cred.detail && <div className="cd-cred-detail">{cred.detail}</div>}
        {cred.fix && <div className="cd-cred-fix">Fix: {cred.fix}</div>}
        {cred.envVars?.length > 0 && (
          <div className="cd-cred-keys">{cred.envVars.map(k => <code key={k}>{k}</code>)}</div>
        )}
      </div>
    </div>
  );
}

function CredList({ creds = [] }) {
  if (!creds.length) return <div className="cd-empty">No credentials to display.</div>;
  return <div className="cd-cred-list">{creds.map(c => <CredItem key={c.id} cred={c} />)}</div>;
}

function SectionCard({ section }) {
  const color = section.score >= 70 ? "#34d399" : section.score >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div className="cd-section-card">
      <div className="cd-section-score" style={{ color }}>{section.score}%</div>
      <div className="cd-section-name">{section.label}</div>
      <div className="cd-section-sub">{section.configured}/{section.total} configured</div>
      {section.missing > 0 && <div className="cd-section-badge cd-badge-fail">{section.missing} missing</div>}
      {section.warnings > 0 && <div className="cd-section-badge cd-badge-warn">{section.warnings} warnings</div>}
    </div>
  );
}

function OverviewPanel({ onRunAudit, running }) {
  const { data, loading, err } = useCD("/credentials/report", []);
  const report = data?.report;

  if (loading) return <div className="cd-loading">Loading report…</div>;

  return (
    <div className="cd-overview">
      {err && !report && (
        <div className="cd-empty-state">
          <div className="cd-empty-icon">🔐</div>
          <div className="cd-empty-title">No credential audit yet</div>
          <div className="cd-empty-sub">Run a full audit to see which credentials are configured</div>
          <button className="cd-btn-primary" onClick={onRunAudit} disabled={running}>
            {running ? "Auditing…" : "Run Full Audit"}
          </button>
        </div>
      )}
      {report && (
        <>
          <div className="cd-overview-hero">
            <ScoreRing score={report.score} size={100} />
            <div className="cd-overview-stats">
              <div className="cd-stat"><span className="cd-stat-val cd-pass-text">{report.configured}</span><span className="cd-stat-lbl">Configured</span></div>
              <div className="cd-stat"><span className="cd-stat-val cd-fail-text">{report.missing}</span><span className="cd-stat-lbl">Missing</span></div>
              <div className="cd-stat"><span className="cd-stat-val cd-fail-text">{report.invalid}</span><span className="cd-stat-lbl">Invalid</span></div>
              <div className="cd-stat"><span className="cd-stat-val cd-warn-text">{report.warnings}</span><span className="cd-stat-lbl">Warnings</span></div>
            </div>
            <button className="cd-btn-primary" onClick={onRunAudit} disabled={running}>
              {running ? "Auditing…" : "Re-run Audit"}
            </button>
          </div>
          <div className="cd-section-grid">
            {report.sections?.map(s => <SectionCard key={s.section} section={s} />)}
          </div>
          {report.missing > 0 && (
            <div className="cd-missing-block">
              <div className="cd-block-title">Missing Credentials ({report.missing})</div>
              <CredList creds={(report.missing_items || report.missing_creds || []).concat(
                Object.values(report.details || {}).flat().filter(c => c.status === "missing")
              ).filter((c,i,a) => a.findIndex(x => x.id === c.id) === i)} />
            </div>
          )}
          {report.envVars?.missingCount > 0 && (
            <div className="cd-env-missing">
              <div className="cd-block-title">{report.envVars.missingCount} Env Vars to Set</div>
              <div className="cd-env-chips">
                {report.envVars.missing?.map(v => (
                  <div key={v.key} className="cd-env-chip">
                    <code>{v.key}</code>
                    <span className="cd-env-desc">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="cd-run-at">Last run: {report.runAt ? new Date(report.runAt).toLocaleString() : "—"}</div>
        </>
      )}
    </div>
  );
}

function SectionPanel({ section, onRerun, running }) {
  const { data, loading, err } = useCD(`/credentials/${section}`, []);
  const creds = data?.creds || [];

  if (loading) return <div className="cd-loading">Loading…</div>;
  if (err) return (
    <div className="cd-empty-state">
      <div className="cd-empty-icon">📭</div>
      <div className="cd-empty-sub">No data yet. Run an audit first.</div>
      <button className="cd-btn-primary" onClick={() => onRerun(section)} disabled={running}>Run {section} audit</button>
    </div>
  );

  const configured = creds.filter(c => c.status === "configured").length;
  const total      = creds.length;
  const score      = total ? Math.round(configured / total * 100) : 0;

  return (
    <div className="cd-section-panel">
      <div className="cd-section-header">
        <ScoreRing score={score} size={72} />
        <div>
          <div className="cd-section-header-title">{section.charAt(0).toUpperCase() + section.slice(1)} Credentials</div>
          <div className="cd-section-header-sub">{configured}/{total} configured</div>
        </div>
        <button className="cd-btn-sm" onClick={() => onRerun(section)} disabled={running}>
          {running ? "Running…" : "Re-run"}
        </button>
      </div>
      <CredList creds={creds} />
    </div>
  );
}

function EnvPanel() {
  const { data, loading } = useCD("/credentials/env", []);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const all     = data?.envVars?.all || [];
  const filtered = all.filter(v => {
    const matchFilter = filter === "all" || (filter === "missing" && !v.set) || (filter === "present" && v.set);
    const matchSearch = !search || v.key.toLowerCase().includes(search.toLowerCase()) || v.desc?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const sections = [...new Set(filtered.map(v => v.section))];

  if (loading) return <div className="cd-loading">Loading env vars…</div>;

  return (
    <div className="cd-env-panel">
      <div className="cd-env-controls">
        <div className="cd-filter-row">
          {["all","present","missing"].map(f => (
            <button key={f} className={`cd-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === "missing" && data?.envVars?.missingCount ? ` (${data.envVars.missingCount})` : ""}
            </button>
          ))}
        </div>
        <input className="cd-search" placeholder="Search env vars…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {sections.map(sec => {
        const items = filtered.filter(v => v.section === sec);
        return (
          <div key={sec} className="cd-env-section">
            <div className="cd-env-section-title">{sec.toUpperCase()}</div>
            <div className="cd-env-table">
              {items.map(v => (
                <div key={v.key} className={`cd-env-row ${v.set ? "cd-env-set" : "cd-env-unset"}`}>
                  <code className="cd-env-key">{v.key}</code>
                  <span className={`cd-env-badge ${v.set ? "cd-badge-pass" : "cd-badge-fail"}`}>{v.set ? "set" : "missing"}</span>
                  <span className="cd-env-desc-text">{v.desc}</span>
                  <span className={`cd-env-pri ${v.priority === "recommended" ? "cd-pri-rec" : ""}`}>{v.priority}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {filtered.length === 0 && <div className="cd-empty">No env vars match filter.</div>}
    </div>
  );
}

function BenchmarkPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api("/credentials/benchmark"); setData(r); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="cd-loading">Running benchmark…</div>;
  if (!data) return <div className="cd-empty">No benchmark data. <button className="cd-link-btn" onClick={load}>Run now</button></div>;

  return (
    <div className="cd-bench">
      <div className="cd-bench-hero">
        <ScoreRing score={data.score} size={90} />
        <div className="cd-bench-stats">
          <div className="cd-stat"><span className="cd-stat-val">{data.passing}/{data.total}</span><span className="cd-stat-lbl">Gates pass</span></div>
          <div className="cd-stat"><span className="cd-stat-val">{data.credentialScore}%</span><span className="cd-stat-lbl">Credential score</span></div>
          <div className="cd-stat"><span className={`cd-stat-val ${data.regressionPass ? "cd-pass-text" : "cd-fail-text"}`}>{data.regressionPass ? "PASS" : "FAIL"}</span><span className="cd-stat-lbl">Regression</span></div>
        </div>
      </div>
      <div className="cd-bench-checks">
        {data.checks?.map(c => (
          <div key={c.id} className={`cd-bench-row ${c.ok ? "cd-pass" : "cd-fail"}`}>
            <span>{c.ok ? "✅" : "❌"}</span>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      {data.missingEnvVars?.length > 0 && (
        <div className="cd-bench-missing">
          <div className="cd-block-title">Missing Env Vars ({data.missingEnvVars.length})</div>
          {data.missingEnvVars.map(v => (
            <div key={v.key} className="cd-bench-env-row">
              <code>{v.key}</code>
              <span className="cd-badge cd-badge-fail">{v.section}</span>
              <span className="cd-env-desc-text">{v.desc}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cd-run-at">Run: {data.runAt ? new Date(data.runAt).toLocaleString() : "—"}</div>
      <button className="cd-btn-sm" onClick={load} disabled={loading}>Re-run benchmark</button>
    </div>
  );
}

export default function CredentialDashboard() {
  const [tab, setTab] = useState("overview");
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditMsg, setAuditMsg] = useState(null);

  const runFullAudit = useCallback(async () => {
    setAuditRunning(true); setAuditMsg(null);
    try {
      await api("/credentials/audit", { method: "POST" });
      setAuditMsg("Audit complete — refreshing…");
      window.location.reload();
    } catch (e) { setAuditMsg(`Error: ${e.message}`); }
    finally { setAuditRunning(false); }
  }, []);

  const rerunSection = useCallback(async (section) => {
    setAuditRunning(true); setAuditMsg(null);
    try {
      await api(`/credentials/audit/${section}`, { method: "POST" });
      setAuditMsg(`${section} audit complete`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { setAuditMsg(`Error: ${e.message}`); }
    finally { setAuditRunning(false); }
  }, []);

  return (
    <div className="cd-root">
      <div className="cd-header">
        <div className="cd-title">🔐 Production Credentials</div>
        <div className="cd-subtitle">PCS-1 — credential health across all 5 production integrations</div>
        {auditMsg && <div className="cd-audit-msg">{auditMsg}</div>}
      </div>

      <div className="cd-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`cd-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="cd-body">
        {tab === "overview"  && <OverviewPanel onRunAudit={runFullAudit} running={auditRunning} />}
        {tab === "email"     && <SectionPanel section="email"   onRerun={rerunSection} running={auditRunning} />}
        {tab === "ai"        && <SectionPanel section="ai"      onRerun={rerunSection} running={auditRunning} />}
        {tab === "oauth"     && <SectionPanel section="oauth"   onRerun={rerunSection} running={auditRunning} />}
        {tab === "crash"     && <SectionPanel section="crash"   onRerun={rerunSection} running={auditRunning} />}
        {tab === "storage"   && <SectionPanel section="storage" onRerun={rerunSection} running={auditRunning} />}
        {tab === "env"       && <EnvPanel />}
        {tab === "benchmark" && <BenchmarkPanel />}
      </div>
    </div>
  );
}
