import React, { useState, useCallback, useEffect } from "react";
import "./ExternalPlatformDashboard.css";

const api = (path, opts = {}) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

const SECTIONS = [
  { id: "meta",         label: "Meta",         icon: "◈" },
  { id: "google",       label: "Google",       icon: "⬡" },
  { id: "microsoft",    label: "Microsoft",    icon: "◇" },
  { id: "git",          label: "Git",          icon: "⌥" },
  { id: "productivity", label: "Productivity", icon: "◎" },
  { id: "design",       label: "Design",       icon: "◉" },
  { id: "commerce",     label: "Commerce",     icon: "◐" },
  { id: "automation",   label: "Automation",   icon: "⊕" },
];

const TABS = [
  { id: "matrix",    label: "Matrix",    icon: "🗂" },
  { id: "overview",  label: "Overview",  icon: "📊" },
  ...SECTIONS.map(s => ({ id: s.id, label: s.label, icon: s.icon })),
  { id: "env",       label: "Env Vars",  icon: "⚙️" },
  { id: "benchmark", label: "Benchmark", icon: "🏁" },
];

const STATUS_ICON  = { ready: "✅", missing: "❌", invalid: "🔴", optional: "⚫", unsupported: "—" };
const STATUS_CLASS = { ready: "ep-ready", missing: "ep-fail", invalid: "ep-fail", optional: "ep-opt", unsupported: "ep-opt" };

function useExt(path, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const load = useCallback(() => {
    setLoading(true); setErr(null);
    api(path).then(r => { setData(r); setLoading(false); }).catch(e => { setErr(e.message); setLoading(false); });
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, err, reload: load };
}

function ScoreRing({ score, size = 70 }) {
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const color = score >= 60 ? "#34d399" : score >= 30 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="ep-ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#334155" strokeWidth={8}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+5} textAnchor="middle" fill={color} fontSize={size*0.22} fontWeight="bold">{score}%</text>
    </svg>
  );
}

function StatusBadge({ status }) {
  return <span className={`ep-badge ${STATUS_CLASS[status] || "ep-opt"}`}>{status}</span>;
}

function PlatformRow({ plat }) {
  const icon = STATUS_ICON[plat.status] || "?";
  return (
    <div className={`ep-plat-row ${STATUS_CLASS[plat.status] || ""}`}>
      <span className="ep-plat-icon">{icon}</span>
      <div className="ep-plat-body">
        <div className="ep-plat-label">{plat.label}</div>
        {plat.detail && <div className="ep-plat-detail">{plat.detail}</div>}
        {plat.fix    && <div className="ep-plat-fix">Fix: {plat.fix}</div>}
        {plat.note   && <div className="ep-plat-note">{plat.note}</div>}
        {plat.envVars?.length > 0 && (
          <div className="ep-plat-envkeys">{plat.envVars.map(k => <code key={k}>{k}</code>)}</div>
        )}
      </div>
      <StatusBadge status={plat.status} />
    </div>
  );
}

function SectionCard({ s }) {
  const color = s.score >= 60 ? "#34d399" : s.score >= 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="ep-sec-card">
      <div className="ep-sec-score" style={{ color }}>{s.score}%</div>
      <div className="ep-sec-name">{s.label}</div>
      <div className="ep-sec-stats">
        <span className="ep-stat-ready">{s.ready} ready</span>
        {s.missing > 0 && <span className="ep-stat-fail">{s.missing} missing</span>}
        {s.optional > 0 && <span className="ep-stat-opt">{s.optional} optional</span>}
        {s.invalid > 0  && <span className="ep-stat-fail">{s.invalid} invalid</span>}
      </div>
    </div>
  );
}

function MatrixPanel({ onRunAudit, running }) {
  const { data, loading, err } = useExt("/ext/matrix", []);
  const matrix = data?.matrix || [];

  if (loading) return <div className="ep-loading">Loading matrix…</div>;

  return (
    <div className="ep-matrix">
      <div className="ep-matrix-header">
        <div className="ep-matrix-title">External Platform Matrix</div>
        <button className="ep-btn-sm" onClick={onRunAudit} disabled={running}>
          {running ? "Auditing…" : "Re-run Audit"}
        </button>
      </div>
      {(err || matrix.length === 0) && (
        <div className="ep-empty-state">
          <div className="ep-empty-icon">🗂</div>
          <div className="ep-empty-title">No audit data</div>
          <button className="ep-btn-primary" onClick={onRunAudit} disabled={running}>
            {running ? "Running…" : "Run Full Audit"}
          </button>
        </div>
      )}
      {matrix.map(s => (
        <div key={s.section} className="ep-matrix-section">
          <div className="ep-matrix-section-title">{s.label}</div>
          <div className="ep-plat-list">
            {s.platforms.map(p => <PlatformRow key={p.id} plat={p} />)}
          </div>
        </div>
      ))}
      {data?.score !== undefined && (
        <div className="ep-matrix-footer">
          Production readiness: <strong>{data.score}%</strong> — Last run: {data.runAt ? new Date(data.runAt).toLocaleString() : "—"}
        </div>
      )}
    </div>
  );
}

function OverviewPanel({ onRunAudit, running }) {
  const { data, loading, err } = useExt("/ext/report", []);
  const report = data?.report;

  if (loading) return <div className="ep-loading">Loading…</div>;
  if (err || !report) return (
    <div className="ep-empty-state">
      <div className="ep-empty-icon">📊</div>
      <div className="ep-empty-title">No audit yet</div>
      <button className="ep-btn-primary" onClick={onRunAudit} disabled={running}>
        {running ? "Running…" : "Run Full Audit"}
      </button>
    </div>
  );

  return (
    <div className="ep-overview">
      <div className="ep-overview-hero">
        <ScoreRing score={report.score} size={100} />
        <div className="ep-hero-stats">
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-ready">{report.ready}</span><span className="ep-stat-lbl">Ready</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-fail">{report.missing}</span><span className="ep-stat-lbl">Missing</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-fail">{report.invalid}</span><span className="ep-stat-lbl">Invalid</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-opt">{report.optional}</span><span className="ep-stat-lbl">Optional</span></div>
        </div>
        <button className="ep-btn-primary" onClick={onRunAudit} disabled={running}>
          {running ? "Re-running…" : "Re-run Audit"}
        </button>
      </div>
      <div className="ep-sec-grid">
        {report.sections?.map(s => <SectionCard key={s.section} s={s} />)}
      </div>
      {report.platforms?.missing?.length > 0 && (
        <div className="ep-missing-block">
          <div className="ep-block-title">Missing Platforms ({report.platforms.missing.length})</div>
          {report.platforms.missing.map(p => (
            <div key={p.id} className="ep-miss-row">
              <span className="ep-miss-label">{p.sectionLabel} → {p.label}</span>
              {p.fix && <span className="ep-miss-fix">{p.fix}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="ep-run-at">Run: {report.runAt ? new Date(report.runAt).toLocaleString() : "—"}</div>
    </div>
  );
}

function SectionPanel({ section, onRerun, running }) {
  const { data, loading, err } = useExt(`/ext/${section}`, []);
  const platforms = data?.platforms || [];

  if (loading) return <div className="ep-loading">Loading…</div>;
  if (err || platforms.length === 0) return (
    <div className="ep-empty-state">
      <div className="ep-empty-sub">No data. Run an audit first.</div>
      <button className="ep-btn-primary" onClick={() => onRerun(section)} disabled={running}>Run audit</button>
    </div>
  );

  const ready  = platforms.filter(p => p.status === "ready").length;
  const score  = Math.round(ready / platforms.length * 100);

  return (
    <div className="ep-sec-panel">
      <div className="ep-sec-panel-header">
        <ScoreRing score={score} size={64} />
        <div>
          <div className="ep-sec-panel-title">{SECTIONS.find(s => s.id === section)?.label} Platforms</div>
          <div className="ep-sec-panel-sub">{ready}/{platforms.length} ready</div>
        </div>
        <button className="ep-btn-sm" onClick={() => onRerun(section)} disabled={running}>
          {running ? "Running…" : "Re-run"}
        </button>
      </div>
      <div className="ep-plat-list">{platforms.map(p => <PlatformRow key={p.id} plat={p} />)}</div>
    </div>
  );
}

function EnvPanel() {
  const { data, loading } = useExt("/ext/env", []);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const all = data?.envVars?.all || [];
  const filtered = all.filter(v => {
    const matchF = filter === "all" || (filter === "missing" && !v.set) || (filter === "present" && v.set);
    const matchS = !search || v.key.toLowerCase().includes(search.toLowerCase()) || v.desc?.toLowerCase().includes(search.toLowerCase());
    return matchF && matchS;
  });
  const sections = [...new Set(filtered.map(v => v.section))];

  if (loading) return <div className="ep-loading">Loading env vars…</div>;

  return (
    <div className="ep-env-panel">
      <div className="ep-env-controls">
        <div className="ep-filter-row">
          {["all","present","missing"].map(f => (
            <button key={f} className={`ep-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === "missing" && data?.envVars?.missingCount ? ` (${data.envVars.missingCount})` : ""}
            </button>
          ))}
        </div>
        <input className="ep-search" placeholder="Search env vars…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {sections.map(sec => (
        <div key={sec} className="ep-env-section">
          <div className="ep-env-section-title">{sec.toUpperCase()}</div>
          <div className="ep-env-table">
            {filtered.filter(v => v.section === sec).map(v => (
              <div key={v.key} className={`ep-env-row ${v.set ? "ep-env-set" : "ep-env-unset"}`}>
                <code className="ep-env-key">{v.key}</code>
                <span className={`ep-env-badge ${v.set ? "ep-badge-pass" : "ep-badge-fail"}`}>{v.set ? "set" : "missing"}</span>
                <span className="ep-env-desc">{v.desc}</span>
                <span className={`ep-env-pri ${v.priority === "required" ? "ep-pri-req" : v.priority === "recommended" ? "ep-pri-rec" : ""}`}>{v.priority}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div className="ep-empty">No env vars match filter.</div>}
    </div>
  );
}

function BenchmarkPanel() {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api("/ext/benchmark").then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="ep-loading">Running benchmark…</div>;
  if (!data)   return <div className="ep-empty">No data. <button className="ep-link-btn" onClick={load}>Run now</button></div>;

  return (
    <div className="ep-bench">
      <div className="ep-bench-hero">
        <ScoreRing score={data.score} size={90} />
        <div className="ep-bench-stats">
          <div className="ep-stat-item"><span className="ep-stat-val">{data.passing}/{data.total}</span><span className="ep-stat-lbl">Gates pass</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val">{data.platformScore}%</span><span className="ep-stat-lbl">Platform score</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-ready">{data.ready}</span><span className="ep-stat-lbl">Ready</span></div>
          <div className="ep-stat-item"><span className="ep-stat-val ep-tv-opt">{data.optional}</span><span className="ep-stat-lbl">Optional</span></div>
          <div className="ep-stat-item"><span className={`ep-stat-val ${data.regressionPass ? "ep-tv-ready" : "ep-tv-fail"}`}>{data.regressionPass ? "PASS" : "FAIL"}</span><span className="ep-stat-lbl">Regression</span></div>
        </div>
      </div>
      <div className="ep-bench-checks">
        {data.checks?.map(c => (
          <div key={c.id} className={`ep-bench-row ${c.ok ? "ep-pass" : "ep-fail"}`}>
            <span>{c.ok ? "✅" : "❌"}</span><span>{c.label}</span>
          </div>
        ))}
      </div>
      {data.missingEnvVars?.filter(v => v.priority === "required" || v.priority === "recommended").length > 0 && (
        <div className="ep-bench-missing">
          <div className="ep-block-title">Required / Recommended Env Vars Missing</div>
          {data.missingEnvVars.filter(v => v.priority === "required" || v.priority === "recommended").map(v => (
            <div key={v.key} className="ep-bench-env-row">
              <code>{v.key}</code>
              <span className={`ep-badge ${v.priority === "required" ? "ep-badge-fail" : "ep-badge-warn"}`}>{v.priority}</span>
              <span className="ep-env-desc">{v.desc}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ep-run-at">Run: {data.runAt ? new Date(data.runAt).toLocaleString() : "—"}</div>
      <button className="ep-btn-sm" onClick={load} disabled={loading}>Re-run</button>
    </div>
  );
}

export default function ExternalPlatformDashboard() {
  const [tab, setTab]           = useState("matrix");
  const [running, setRunning]   = useState(false);
  const [msg, setMsg]           = useState(null);

  const runAudit = useCallback(async () => {
    setRunning(true); setMsg(null);
    try {
      await api("/ext/audit", { method: "POST" });
      setMsg("Audit complete — refreshing…");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRunning(false); }
  }, []);

  const rerunSection = useCallback(async (section) => {
    setRunning(true); setMsg(null);
    try {
      await api(`/ext/audit/${section}`, { method: "POST" });
      setMsg(`${section} audit complete`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRunning(false); }
  }, []);

  return (
    <div className="ep-root">
      <div className="ep-header">
        <div className="ep-title">🌐 External Platform Matrix</div>
        <div className="ep-subtitle">PCS-2 — 8 ecosystems · 30+ platforms · production wiring audit</div>
        {msg && <div className="ep-msg">{msg}</div>}
      </div>
      <div className="ep-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`ep-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="ep-body">
        {tab === "matrix"       && <MatrixPanel onRunAudit={runAudit} running={running} />}
        {tab === "overview"     && <OverviewPanel onRunAudit={runAudit} running={running} />}
        {SECTIONS.some(s => s.id === tab) && <SectionPanel section={tab} onRerun={rerunSection} running={running} />}
        {tab === "env"          && <EnvPanel />}
        {tab === "benchmark"    && <BenchmarkPanel />}
      </div>
    </div>
  );
}
