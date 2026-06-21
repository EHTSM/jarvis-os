// OP-1 Ooplix Public Launch — PublicLaunch.jsx
// No feature development. Only execution.
import React, { useState, useCallback, useEffect } from "react";
import "./PublicLaunch.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());

function useOP(path, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api(path).then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, reload: load };
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2800); };
  const el = msg ? <span className="pl-toast">{msg}</span> : null;
  return [toast, el];
}

const sc = (s) => s >= 90 ? "var(--pl-green)" : s >= 70 ? "var(--pl-teal)" : s >= 50 ? "var(--pl-yellow)" : "var(--pl-red)";
function Chip({ label, type = "gray" }) { return <span className={`pl-chip pl-chip-${type}`}>{label}</span>; }

const WEEK_ORDER = ["w1","w2","w3","w4","w5","w6plus"];
const statusColor = { complete: "green", in_progress: "yellow", pending: "gray" };

// ── Executive / Mission Control ────────────────────────────────────────────────
function ExecutivePanel() {
  const { data, loading, reload } = useOP("/op1/executive", []);
  if (loading) return <div className="pl-loading">Loading launch command center…</div>;
  if (!data?.ok) return <div className="pl-loading">Error loading executive view</div>;

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">OP-1 Mission Control</div>
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>

      {data.officiallyLaunched && (
        <div className="pl-success-banner">
          <div className="pl-success-icon">🚀</div>
          <div>
            <div className="pl-success-title">Ooplix is Officially Launched</div>
            <div className="pl-success-sub">All 7 success criteria met. Company launched.</div>
          </div>
        </div>
      )}

      <div className="pl-stats-grid">
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: sc(data.overallScore) }}>{data.overallScore}%</div>
          <div className="pl-stat-lbl">Launch Progress</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: sc(data.launchScore) }}>{data.launchScore}%</div>
          <div className="pl-stat-lbl">KPI Achievement</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: "var(--pl-accent)" }}>{data.completedWeeks}/{data.totalWeeks}</div>
          <div className="pl-stat-lbl">Weeks Done</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: data.blockers?.p0 > 0 ? "var(--pl-red)" : "var(--pl-green)" }}>
            {data.blockers?.open || 0}
          </div>
          <div className="pl-stat-lbl">Open Blockers</div>
          {data.blockers?.p0 > 0 && <div className="pl-stat-sub" style={{ color: "var(--pl-red)" }}>{data.blockers.p0} P0</div>}
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: data.escapes?.unresolved > 3 ? "var(--pl-orange)" : "var(--pl-muted)" }}>
            {data.escapes?.unresolved || 0}
          </div>
          <div className="pl-stat-lbl">Open Escapes</div>
        </div>
        {data.systemHealth && (
          <div className="pl-stat-card">
            <div className="pl-stat-val" style={{ color: sc(data.systemHealth.score) }}>{data.systemHealth.score}%</div>
            <div className="pl-stat-lbl">System Health</div>
          </div>
        )}
      </div>

      <div className="pl-card">
        <div className="pl-card-title">Current Week: {data.currentWeekLabel}</div>
        <div className="pl-weeks-grid">
          {(data.weeks || []).map(w => (
            <div key={w.id} className={`pl-week-card ${w.status}`}>
              <div className="pl-week-num">{w.id.replace("plus", "+")}</div>
              <div className="pl-week-label">{w.label.split("—")[1]?.trim() || w.label}</div>
              <div className="pl-week-score" style={{ color: sc(w.score) }}>{w.score}%</div>
              <div className="pl-week-prog"><div className="pl-week-fill" style={{ width: `${w.score}%` }} /></div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <Chip label={w.status} type={statusColor[w.status] || "gray"} />
                <Chip label={`${w.critScore}% critical`} type={w.critScore === 100 ? "green" : "yellow"} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pl-card">
        <div className="pl-card-title">Success Criteria</div>
        <div className="pl-kpi-grid">
          {(data.kpis || []).map(k => (
            <div key={k.id} className={`pl-kpi-card`}>
              <div className="pl-kpi-val" style={{ color: k.met ? "var(--pl-green)" : sc(k.progressPct) }}>
                {k.current ?? 0}{k.unit === "%" ? "%" : k.unit === "₹" ? "" : ""}{k.unit === "₹" ? <span style={{ fontSize: 12 }}>₹{k.current?.toLocaleString("en-IN") ?? 0}</span> : null}
                {k.unit !== "₹" && k.unit !== "%" && k.unit !== "score" && <span style={{ fontSize: 12, color: "var(--pl-muted)", fontWeight: 400 }}> {k.unit}</span>}
                {k.unit === "score" && (k.current === null ? <span style={{ fontSize: 14, color: "var(--pl-muted)" }}>—</span> : null)}
              </div>
              <div className="pl-kpi-label">{k.label}</div>
              <div className="pl-kpi-target">Target: {k.unit === "₹" ? `₹${k.target.toLocaleString("en-IN")}` : `${k.target}${k.unit === "%" ? "%" : ""}`}</div>
              <div className="pl-kpi-bar"><div className="pl-kpi-fill" style={{ width: `${k.progressPct}%`, background: k.met ? "var(--pl-green)" : sc(k.progressPct) }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Week Detail Panel ──────────────────────────────────────────────────────────
function WeekPanel({ weekId }) {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP(`/op1/weeks/${weekId}`, [weekId]);

  const toggle = useCallback(async (itemId, done) => {
    await api(`/op1/weeks/${weekId}/items/${itemId}/${done ? "done" : "undone"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    reload();
    toast(done ? "✓ Marked done" : "Marked incomplete");
  }, [weekId, reload, toast]);

  const activate = async () => {
    await api(`/op1/weeks/${weekId}/activate`, { method: "POST" });
    reload(); toast("Week activated");
  };

  if (loading) return <div className="pl-loading">Loading week {weekId}…</div>;
  if (!data?.ok) return <div className="pl-loading">Error loading week</div>;

  const critItems  = (data.items || []).filter(i => i.critical);
  const nonCrit    = (data.items || []).filter(i => !i.critical);

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">{data.label}</div>
        {toastEl}
        {data.status === "pending" && (
          <button className="pl-btn" onClick={activate}>Activate Week</button>
        )}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: sc(data.score) }}>{data.score}%</div>
          <div className="pl-stat-lbl">Complete</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: sc(data.critScore) }}>{data.critScore}%</div>
          <div className="pl-stat-lbl">Critical Done</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val">{data.done}/{data.total}</div>
          <div className="pl-stat-lbl">Items</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: data.status === "complete" ? "var(--pl-green)" : data.status === "in_progress" ? "var(--pl-yellow)" : "var(--pl-muted)" }}>
            {data.status?.toUpperCase().replace("_", " ")}
          </div>
          <div className="pl-stat-lbl">Status</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--pl-muted)", marginBottom: 10 }}>{data.description}</div>
      {critItems.length > 0 && (
        <div className="pl-card" style={{ borderColor: "rgba(245,158,11,.2)" }}>
          <div className="pl-card-title" style={{ color: "var(--pl-accent)" }}>Critical ({data.critDone}/{data.critTotal} done)</div>
          {critItems.map(item => (
            <div key={item.id} className={`pl-check-item critical ${item.done ? "done" : ""}`}
              onClick={() => toggle(item.id, !item.done)}>
              <div className={`pl-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
              <div style={{ flex: 1 }}>
                <div className="pl-check-lbl">{item.label}</div>
                {item.note   && <div className="pl-check-note">{item.note}</div>}
                {item.doneAt && <div className="pl-check-note">Done {new Date(item.doneAt).toLocaleDateString()}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {nonCrit.length > 0 && (
        <div className="pl-card">
          <div className="pl-card-title">Additional Items</div>
          {nonCrit.map(item => (
            <div key={item.id} className={`pl-check-item ${item.done ? "done" : ""}`}
              onClick={() => toggle(item.id, !item.done)}>
              <div className={`pl-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
              <div style={{ flex: 1 }}>
                <div className="pl-check-lbl">{item.label}</div>
                {item.doneAt && <div className="pl-check-note">Done {new Date(item.doneAt).toLocaleDateString()}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Escape Log (Week 2) ────────────────────────────────────────────────────────
function EscapePanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP("/op1/escapes", []);
  const [form, setForm] = useState({ category: "friction_too_high", tool: "", description: "", severity: "medium" });

  const log = async () => {
    if (!form.description) return toast("Description required");
    await api("/op1/escapes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ category: "friction_too_high", tool: "", description: "", severity: "medium" });
    reload(); toast("Escape logged");
  };

  const resolve = async (id) => {
    await api(`/op1/escapes/${id}/resolve`, { method: "POST" });
    reload(); toast("Escape resolved");
  };

  if (loading) return <div className="pl-loading">Loading escape log…</div>;
  if (!data?.ok) return <div className="pl-loading">Error</div>;

  const sevColor = { critical: "red", high: "red", medium: "yellow", low: "gray" };

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">Week 2 — Escape Log</div>
        {toastEl}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card"><div className="pl-stat-val">{data.total}</div><div className="pl-stat-lbl">Total</div></div>
        <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: data.unresolved > 3 ? "var(--pl-red)" : "var(--pl-green)" }}>{data.unresolved}</div><div className="pl-stat-lbl">Unresolved</div></div>
        <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: "var(--pl-green)" }}>{data.total - data.unresolved}</div><div className="pl-stat-lbl">Fixed</div></div>
      </div>
      <div className="pl-form">
        <div className="pl-form-title">Log Escape (left Ooplix for external tool)</div>
        <div className="pl-form-row">
          <select className="pl-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {(data.ESCAPE_CATEGORIES || []).map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <select className="pl-select" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
            {["critical","high","medium","low"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="pl-input" placeholder="Tool used (optional)…" value={form.tool}
            onChange={e => setForm(f => ({ ...f, tool: e.target.value }))} style={{ maxWidth: 140 }} />
          <button className="pl-btn" onClick={log}>Log</button>
        </div>
        <div className="pl-form-row">
          <input className="pl-input" placeholder="What happened? Why did you leave Ooplix?…" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
      </div>
      {Object.keys(data.byCategory || {}).length > 0 && (
        <div className="pl-card">
          <div className="pl-card-title">By Category</div>
          {Object.entries(data.byCategory).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
            <div key={cat} className="pl-kv-row">
              <span className="pl-kv-key">{cat.replace(/_/g, " ")}</span>
              <span className="pl-kv-val">{count}×</span>
            </div>
          ))}
        </div>
      )}
      <div className="pl-list">
        {(data.escapes || []).length === 0 && <div className="pl-empty">No escapes yet — great!</div>}
        {(data.escapes || []).slice().reverse().map(e => (
          <div key={e.id} className={`pl-row ${e.fixedAt ? "pl-row-pass" : e.severity === "critical" ? "pl-row-fail" : ""}`}>
            <div className="pl-row-body">
              <div className="pl-row-name">{e.description}</div>
              <div className="pl-row-meta">{e.category.replace(/_/g, " ")} {e.tool ? `· via ${e.tool}` : ""} · {e.date}</div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Chip label={e.severity} type={sevColor[e.severity] || "gray"} />
              {e.fixedAt ? <Chip label="Fixed" type="green" /> : (
                <button className="pl-btn-sm" style={{ fontSize: 9 }} onClick={() => resolve(e.id)}>Fix</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Blockers ───────────────────────────────────────────────────────────────────
function BlockersPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP("/op1/blockers", []);
  const [form, setForm] = useState({ title: "", severity: "P1", week: "w1", module: "", description: "" });
  const [filter, setFilter] = useState("open");

  const report = async () => {
    if (!form.title) return toast("Title required");
    await api("/op1/blockers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", severity: "P1", week: "w1", module: "", description: "" });
    reload(); toast("Blocker reported");
  };

  const resolve = async (id) => {
    await api(`/op1/blockers/${id}/resolve`, { method: "POST" });
    reload(); toast("Blocker resolved");
  };

  if (loading) return <div className="pl-loading">Loading blockers…</div>;
  if (!data?.ok) return <div className="pl-loading">Error</div>;

  const sevColor = { P0: "red", P1: "red", P2: "yellow", P3: "gray" };
  const blockers = (data.blockers || []).filter(b => filter === "all" || b.status === filter);

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">Blockers</div>
        {toastEl}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card"><div className="pl-stat-val">{data.total}</div><div className="pl-stat-lbl">Total</div></div>
        <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: data.open > 0 ? "var(--pl-yellow)" : "var(--pl-green)" }}>{data.open}</div><div className="pl-stat-lbl">Open</div></div>
        <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: data.p0Open > 0 ? "var(--pl-red)" : "var(--pl-green)" }}>{data.p0Open}</div><div className="pl-stat-lbl">P0 Open</div></div>
      </div>
      <div className="pl-form">
        <div className="pl-form-title">Report Blocker</div>
        <div className="pl-form-row">
          <select className="pl-select" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
            {(data.BLOCKER_SEVERITIES || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="pl-select" value={form.week} onChange={e => setForm(f => ({ ...f, week: e.target.value }))}>
            {WEEK_ORDER.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <input className="pl-input" placeholder="Module…" value={form.module}
            onChange={e => setForm(f => ({ ...f, module: e.target.value }))} style={{ maxWidth: 120 }} />
        </div>
        <div className="pl-form-row">
          <input className="pl-input" placeholder="Title…" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <button className="pl-btn" onClick={report}>Report</button>
        </div>
        <input className="pl-input" placeholder="Description (optional)…" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          style={{ width: "100%", marginTop: 6, boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {["open","all","resolved"].map(f => (
          <button key={f} className={`pl-btn-sm ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="pl-list">
        {blockers.length === 0 && <div className="pl-empty">No blockers {filter !== "all" ? `(${filter})` : ""}</div>}
        {blockers.map(b => (
          <div key={b.id} className={`pl-row ${b.status === "resolved" ? "pl-row-pass" : b.severity === "P0" || b.severity === "P1" ? "pl-row-fail" : "pl-row-warn"}`}>
            <div className="pl-row-body">
              <div className="pl-row-name">{b.title}</div>
              <div className="pl-row-meta">{b.week} · {b.module} · {b.createdAt?.slice(0,10)}</div>
              {b.description && <div className="pl-row-meta" style={{ marginTop: 2 }}>{b.description}</div>}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Chip label={b.severity} type={sevColor[b.severity] || "gray"} />
              {b.status === "resolved" ? <Chip label="Resolved" type="green" /> : (
                <button className="pl-btn-sm" style={{ fontSize: 9 }} onClick={() => resolve(b.id)}>Resolve</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── KPI Dashboard ──────────────────────────────────────────────────────────────
function KPIPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP("/op1/kpis", []);
  const [editing, setEditing] = useState(null);
  const [val, setVal] = useState("");

  const updateKPI = async (id) => {
    if (val === "") return;
    await api(`/op1/kpis/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: Number(val) }),
    });
    setEditing(null); setVal("");
    reload(); toast("KPI updated");
  };

  if (loading) return <div className="pl-loading">Loading KPIs…</div>;
  if (!data?.ok) return <div className="pl-loading">Error</div>;

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">Success Definition & KPIs</div>
        {toastEl}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: sc(data.launchScore) }}>{data.launchScore}%</div>
          <div className="pl-stat-lbl">Launch Score</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val">{data.metCount}/{data.totalKPIs}</div>
          <div className="pl-stat-lbl">Targets Met</div>
        </div>
        <div className="pl-stat-card">
          <div className="pl-stat-val" style={{ color: data.officiallyLaunched ? "var(--pl-green)" : "var(--pl-muted)" }}>
            {data.officiallyLaunched ? "YES" : "NO"}
          </div>
          <div className="pl-stat-lbl">Officially Launched</div>
        </div>
      </div>
      <div className="pl-card">
        <div className="pl-card-title">Definition of Success</div>
        {Object.entries(data.SUCCESS_DEFINITION || {}).map(([k, v]) => (
          <div key={k} className="pl-kv-row">
            <span className="pl-kv-key">{k.replace(/_/g, " ")}</span>
            <span className="pl-kv-val">{v}</span>
          </div>
        ))}
      </div>
      <div className="pl-kpi-grid">
        {(data.kpis || []).map(k => (
          <div key={k.id} className="pl-kpi-card">
            {editing === k.id ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input className="pl-input" type="number" value={val} onChange={e => setVal(e.target.value)}
                  style={{ width: 80 }} autoFocus onKeyDown={e => e.key === "Enter" && updateKPI(k.id)} />
                <button className="pl-btn-sm" onClick={() => updateKPI(k.id)}>✓</button>
                <button className="pl-btn-sm" onClick={() => { setEditing(null); setVal(""); }}>×</button>
              </div>
            ) : (
              <div className="pl-kpi-val" style={{ color: k.met ? "var(--pl-green)" : sc(k.progressPct), cursor: "pointer" }}
                onClick={() => { setEditing(k.id); setVal(String(k.current)); }}>
                {k.unit === "₹" ? `₹${(k.current || 0).toLocaleString("en-IN")}` : `${k.current ?? "—"}${k.unit === "%" ? "%" : ""}`}
              </div>
            )}
            <div className="pl-kpi-label">{k.label}</div>
            <div className="pl-kpi-target">Target: {k.unit === "₹" ? `₹${k.target.toLocaleString("en-IN")}` : `${k.target}${k.unit === "%" ? "%" : ""}`}</div>
            <div className="pl-kpi-bar"><div className="pl-kpi-fill" style={{ width: `${k.progressPct}%`, background: k.met ? "var(--pl-green)" : sc(k.progressPct) }} /></div>
            <div style={{ marginTop: 4 }}><Chip label={k.met ? "MET ✓" : `${k.progressPct}%`} type={k.met ? "green" : "gray"} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Daily Releases ─────────────────────────────────────────────────────────────
function ReleasesPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP("/op1/releases", []);
  const [form, setForm] = useState({ version: "", notes: "", week: "w3", fixes: "" });

  const ship = async () => {
    if (!form.notes) return toast("Release notes required");
    await api("/op1/releases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, fixes: form.fixes ? form.fixes.split("\n").filter(Boolean) : [] }),
    });
    setForm({ version: "", notes: "", week: "w3", fixes: "" });
    reload(); toast("Release logged");
  };

  if (loading) return <div className="pl-loading">Loading releases…</div>;
  if (!data?.ok) return <div className="pl-loading">Error</div>;

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">Daily Release Log</div>
        {toastEl}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card"><div className="pl-stat-val">{data.total}</div><div className="pl-stat-lbl">Total</div></div>
        <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: data.thisWeek >= 5 ? "var(--pl-green)" : "var(--pl-yellow)" }}>{data.thisWeek}</div><div className="pl-stat-lbl">This Week</div></div>
      </div>
      <div className="pl-form">
        <div className="pl-form-title">Log Release</div>
        <div className="pl-form-row">
          <input className="pl-input" placeholder="Version (e.g. 1.0.2-alpha)…" value={form.version}
            onChange={e => setForm(f => ({ ...f, version: e.target.value }))} style={{ maxWidth: 180 }} />
          <select className="pl-select" value={form.week} onChange={e => setForm(f => ({ ...f, week: e.target.value }))}>
            {WEEK_ORDER.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <button className="pl-btn" onClick={ship}>Ship</button>
        </div>
        <input className="pl-input" placeholder="Release notes…" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          style={{ width: "100%", marginBottom: 6, boxSizing: "border-box", display: "block", marginTop: 6 }} />
        <textarea className="pl-textarea" placeholder="Fixes (one per line, optional)…" value={form.fixes}
          onChange={e => setForm(f => ({ ...f, fixes: e.target.value }))} style={{ minHeight: 40 }} />
      </div>
      <div className="pl-list">
        {(data.releases || []).length === 0 && <div className="pl-empty">No releases yet</div>}
        {(data.releases || []).slice().reverse().map(r => (
          <div key={r.id} className="pl-row pl-row-pass">
            <div className="pl-row-body">
              <div className="pl-row-name">{r.version || "Release"} <span style={{ color: "var(--pl-muted)", fontWeight: 400 }}>{r.date}</span></div>
              <div className="pl-row-meta">{r.notes}</div>
              {r.fixes?.length > 0 && (
                <div className="pl-tag-row" style={{ marginTop: 4 }}>
                  {r.fixes.map((fix, i) => <Chip key={i} label={fix} type="gray" />)}
                </div>
              )}
            </div>
            <Chip label={r.week} type="blue" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Launch Log ─────────────────────────────────────────────────────────────────
function LaunchLogPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOP("/op1/log", []);
  const [form, setForm] = useState({ type: "milestone", body: "", week: "w1" });

  const log = async () => {
    if (!form.body) return toast("Log entry required");
    await api("/op1/log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ type: "milestone", body: "", week: "w1" });
    reload(); toast("Logged");
  };

  if (loading) return <div className="pl-loading">Loading launch log…</div>;
  if (!data?.ok) return <div className="pl-loading">Error</div>;

  const typeColor = { milestone: "yellow", blocker: "red", win: "green", note: "gray", fix: "teal" };

  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">Launch Activity Log</div>
        {toastEl}
        <button className="pl-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="pl-stats-grid">
        <div className="pl-stat-card"><div className="pl-stat-val">{data.total}</div><div className="pl-stat-lbl">Total Events</div></div>
      </div>
      <div className="pl-form">
        <div className="pl-form-row">
          <select className="pl-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {["milestone","win","blocker","fix","note"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="pl-select" value={form.week} onChange={e => setForm(f => ({ ...f, week: e.target.value }))}>
            {WEEK_ORDER.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <input className="pl-input" placeholder="What happened?…" value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && log()} />
          <button className="pl-btn" onClick={log}>Log</button>
        </div>
      </div>
      <div className="pl-log">
        {(data.events || []).length === 0 && <div className="pl-empty">No events yet</div>}
        {(data.events || []).slice().reverse().map(e => (
          <div key={e.id} className="pl-log-item">
            <div className="pl-log-dot" style={{ background: typeColor[e.type] ? `var(--pl-${typeColor[e.type]})` : "var(--pl-muted)" }} />
            <div className="pl-log-body">
              <div className="pl-log-text">
                <Chip label={e.type} type={typeColor[e.type] || "gray"} />
                {" "}{e.body}
                {e.week && <span style={{ color: "var(--pl-muted)", marginLeft: 6 }}>[{e.week}]</span>}
              </div>
              <div className="pl-log-ts">{new Date(e.ts).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Benchmark ──────────────────────────────────────────────────────────────────
function BenchmarkPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const run = () => { setLoading(true); api("/op1/benchmark").then(r => { setResult(r); setLoading(false); }); };
  useEffect(() => { run(); }, []);
  return (
    <div>
      <div className="pl-section-hdr">
        <div className="pl-section-title">OP-1 Benchmark</div>
        <button className="pl-btn" onClick={run} disabled={loading}>{loading ? "Running…" : "Run Benchmark"}</button>
      </div>
      {loading && <div className="pl-loading">Testing all launch operations…</div>}
      {result && !loading && (
        <>
          <div className="pl-stats-grid">
            <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: sc(result.score) }}>{result.score}%</div><div className="pl-stat-lbl">Score</div></div>
            <div className="pl-stat-card"><div className="pl-stat-val">{result.passing}/{result.total}</div><div className="pl-stat-lbl">Passing</div></div>
            <div className="pl-stat-card"><div className="pl-stat-val" style={{ color: result.regressionPass ? "var(--pl-green)" : "var(--pl-red)" }}>{result.regressionPass ? "PASS" : "FAIL"}</div><div className="pl-stat-lbl">Regression</div></div>
          </div>
          <div className="pl-card">
            <div className="pl-card-title">Launch Operations Checks</div>
            <div className="pl-list">
              {(result.checks || []).map((c, i) => (
                <div key={c.id} className={`pl-row ${c.ok ? "pl-row-pass" : "pl-row-fail"}`}>
                  <div className="pl-row-body">
                    <div className="pl-row-name">{i+1}. {c.label}</div>
                    {c.error && <div className="pl-row-meta" style={{ color: "var(--pl-red)" }}>Error: {c.error}</div>}
                  </div>
                  <Chip label={c.ok ? "PASS" : "FAIL"} type={c.ok ? "green" : "red"} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "executive", label: "Command Center", icon: "◎" },
  { id: "w1",        label: "W1: Deploy",     icon: "⬡" },
  { id: "w2",        label: "W2: Founder",    icon: "◇" },
  { id: "w3",        label: "W3: Alpha",      icon: "◈" },
  { id: "w4",        label: "W4: Beta 50",    icon: "◉" },
  { id: "w5",        label: "W5: Public",     icon: "⬢" },
  { id: "w6plus",    label: "W6+: Scale",     icon: "▷" },
  { id: "escapes",   label: "Escapes",        icon: "✕" },
  { id: "blockers",  label: "Blockers",       icon: "⚠" },
  { id: "kpis",      label: "KPIs",           icon: "✦" },
  { id: "releases",  label: "Releases",       icon: "▶" },
  { id: "log",       label: "Launch Log",     icon: "≡" },
  { id: "benchmark", label: "Benchmark",      icon: "⚡" },
];

const WEEK_TABS = ["w1","w2","w3","w4","w5","w6plus"];

export default function PublicLaunch() {
  const [tab, setTab] = useState("executive");
  const execData = useOP("/op1/executive", []);

  const renderPanel = () => {
    if (tab === "executive") return <ExecutivePanel />;
    if (WEEK_TABS.includes(tab)) return <WeekPanel weekId={tab} />;
    if (tab === "escapes")   return <EscapePanel />;
    if (tab === "blockers")  return <BlockersPanel />;
    if (tab === "kpis")      return <KPIPanel />;
    if (tab === "releases")  return <ReleasesPanel />;
    if (tab === "log")       return <LaunchLogPanel />;
    if (tab === "benchmark") return <BenchmarkPanel />;
    return null;
  };

  return (
    <div className="pl-root">
      <div className="pl-header">
        <span className="pl-title">OP-1</span>
        <span className="pl-subtitle">Ooplix Public Launch — No feature dev. Only execution.</span>
        {execData.data?.officiallyLaunched && <span className="pl-launched">🚀 LAUNCHED</span>}
      </div>
      <div className="pl-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`pl-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="pl-content">{renderPanel()}</div>
    </div>
  );
}
