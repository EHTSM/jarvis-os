// CO2 Production Deployment + Founder Dogfooding — FounderOps.jsx
import React, { useState, useCallback, useEffect } from "react";
import "./FounderOps.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());

function useOps(path, deps = []) {
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
  const el    = msg ? <span className="fo-toast">{msg}</span> : null;
  return [toast, el];
}

const sc = (s) => s >= 90 ? "var(--fo-green)" : s >= 70 ? "var(--fo-teal)" : s >= 50 ? "var(--fo-yellow)" : "var(--fo-red)";

function ScoreBar({ label, score }) {
  const c = sc(score ?? 0);
  return (
    <div className="fo-score-row">
      <span className="fo-score-label">{label}</span>
      <div className="fo-score-track"><div className="fo-score-fill" style={{ width: `${score ?? 0}%`, background: c }} /></div>
      <span className="fo-score-val" style={{ color: c }}>{score ?? "–"}%</span>
    </div>
  );
}

function Chip({ label, type = "gray" }) {
  return <span className={`fo-chip fo-chip-${type}`}>{label}</span>;
}

// ── M1: Deploy ────────────────────────────────────────────────────────────────
function DeployPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/deploy", []);
  const toggle = useCallback(async (itemId, done) => {
    await api(`/co2/deploy/${itemId}/${done ? "done" : "undone"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    reload();
    toast(done ? "Marked done" : "Marked incomplete");
  }, [reload, toast]);

  if (loading) return <div className="fo-loading">Loading deployment checklist…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading deployment state</div>;

  const cats = [...new Set((data.items || []).map(i => i.category))];
  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Deploy Production Stack</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.critScore) }}>{data.critScore}%</div><div className="fo-stat-lbl">Critical Done</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.score) }}>{data.score}%</div><div className="fo-stat-lbl">Overall</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val">{data.done}/{data.total}</div><div className="fo-stat-lbl">Completed</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.deployed ? "var(--fo-green)" : "var(--fo-red)" }}>{data.deployed ? "LIVE" : "PENDING"}</div><div className="fo-stat-lbl">Status</div></div>
      </div>
      {cats.map(cat => {
        const items = (data.items || []).filter(i => i.category === cat);
        const prog  = data.byCategory?.[cat];
        return (
          <div key={cat} className="fo-cat-group">
            <div className="fo-cat-hdr">
              {cat.toUpperCase()}
              {prog && <span style={{ color: "var(--fo-accent)" }}>{prog.done}/{prog.total}</span>}
            </div>
            {items.map(item => (
              <div key={item.id} className={`fo-check-item ${item.done ? "done" : ""} ${item.critical ? "critical" : ""}`}
                onClick={() => toggle(item.id, !item.done)}>
                <div className={`fo-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
                <div style={{ flex: 1 }}>
                  <div className="fo-check-lbl">{item.label}</div>
                  {item.critical && <span className="fo-chip fo-chip-red" style={{ fontSize: 9, marginTop: 2 }}>CRITICAL</span>}
                  {item.doneAt && <div className="fo-check-note">Done {new Date(item.doneAt).toLocaleDateString()}</div>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── M2: AI Providers ──────────────────────────────────────────────────────────
function AIProvidersPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/ai-providers", []);

  const markTested = useCallback(async (providerId, ok) => {
    await api(`/co2/ai-providers/${providerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tested: true, testResult: ok ? "pass" : "fail", configuredAt: new Date().toISOString() }),
    });
    reload();
    toast(ok ? "Provider marked as working" : "Provider marked as failing");
  }, [reload, toast]);

  if (loading) return <div className="fo-loading">Loading AI provider config…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading AI providers</div>;

  const tiers = ["free", "premium", "byok", "local"];
  const tierLabel = { free: "Free Tier", premium: "Premium", byok: "BYOK", local: "Local Models" };
  const tierColor = { free: "green", premium: "blue", byok: "teal", local: "yellow" };

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">AI Provider Configuration</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.score) }}>{data.activeCount}</div><div className="fo-stat-lbl">Active</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: "var(--fo-accent)" }}>{data.primaryProvider?.toUpperCase()}</div><div className="fo-stat-lbl">Primary</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: "var(--fo-green)" }}>✓</div><div className="fo-stat-lbl">BYOK</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: "var(--fo-teal)" }}>✓</div><div className="fo-stat-lbl">Local</div></div>
      </div>
      {tiers.map(tier => {
        const providers = (data.providers || []).filter(p => p.tier === tier);
        if (!providers.length) return null;
        return (
          <div key={tier} className="fo-cat-group">
            <div className="fo-cat-hdr">{tierLabel[tier]}</div>
            <div className="fo-list">
              {providers.map(p => (
                <div key={p.id} className={`fo-row ${p.keyPresent ? "fo-row-pass" : ""}`}>
                  <div className="fo-row-body">
                    <div className="fo-row-name">{p.name}</div>
                    <div className="fo-row-meta" style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                      {p.models?.slice(0, 3).map(m => <span key={m} className="fo-chip fo-chip-gray" style={{ fontSize: 9 }}>{m}</span>)}
                    </div>
                    {p.testResult && <div className="fo-check-note">Last test: {p.testResult}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <Chip label={p.keyPresent ? "KEY SET" : "NO KEY"} type={p.keyPresent ? "green" : "red"} />
                    <Chip label={tier} type={tierColor[tier]} />
                    {p.keyPresent && (
                      <div style={{ display: "flex", gap: 3 }}>
                        <button className="fo-btn-sm" style={{ fontSize: 9, padding: "2px 5px" }} onClick={() => markTested(p.id, true)}>✓ Works</button>
                        <button className="fo-btn-sm" style={{ fontSize: 9, padding: "2px 5px" }} onClick={() => markTested(p.id, false)}>✗ Fail</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── M3: Billing ───────────────────────────────────────────────────────────────
function BillingPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/billing", []);
  const toggle = useCallback(async (itemId, done) => {
    await api(`/co2/billing/${itemId}/${done ? "done" : "undone"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    reload();
    toast(done ? "Marked complete" : "Marked incomplete");
  }, [reload, toast]);

  if (loading) return <div className="fo-loading">Loading billing configuration…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading billing config</div>;

  const providers = ["razorpay", "stripe", "license"];
  const providerLabel = { razorpay: "Razorpay", stripe: "Stripe (Optional)", license: "License Validation" };

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Billing Configuration</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.critScore) }}>{data.critScore}%</div><div className="fo-stat-lbl">Critical</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val">{data.done}/{data.total}</div><div className="fo-stat-lbl">Done</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.razorpayLive ? "var(--fo-green)" : "var(--fo-red)" }}>{data.razorpayLive ? "LIVE" : "—"}</div><div className="fo-stat-lbl">Razorpay</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.licenseActive ? "var(--fo-green)" : "var(--fo-muted)" }}>{data.licenseActive ? "✓" : "—"}</div><div className="fo-stat-lbl">License</div></div>
      </div>
      {providers.map(prov => {
        const items = (data.items || []).filter(i => i.provider === prov);
        return (
          <div key={prov} className="fo-cat-group">
            <div className="fo-cat-hdr">{providerLabel[prov]}</div>
            {items.map(item => (
              <div key={item.id} className={`fo-check-item ${item.done ? "done" : ""} ${item.critical ? "critical" : ""}`}
                onClick={() => toggle(item.id, !item.done)}>
                <div className={`fo-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
                <div style={{ flex: 1 }}>
                  <div className="fo-check-lbl">{item.label}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                    {item.critical && <span className="fo-chip fo-chip-red" style={{ fontSize: 9 }}>CRITICAL</span>}
                    {item.note && <span className="fo-check-note">{item.note}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── M4: Email ─────────────────────────────────────────────────────────────────
function EmailPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/email", []);
  const toggle = useCallback(async (itemId, done) => {
    await api(`/co2/email/${itemId}/${done ? "done" : "undone"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    reload();
    toast(done ? "Marked complete" : "Marked incomplete");
  }, [reload, toast]);

  if (loading) return <div className="fo-loading">Loading email configuration…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading email config</div>;

  const cats = ["smtp", "transactional", "otp", "marketing"];
  const catLabel = { smtp: "SMTP", transactional: "Transactional", otp: "OTP", marketing: "Marketing" };

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Email Configuration</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.critScore) }}>{data.critScore}%</div><div className="fo-stat-lbl">Critical</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val">{data.done}/{data.total}</div><div className="fo-stat-lbl">Done</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.smtpReady ? "var(--fo-green)" : "var(--fo-red)" }}>{data.smtpReady ? "READY" : "SETUP"}</div><div className="fo-stat-lbl">SMTP</div></div>
      </div>
      {data.providers && (
        <div className="fo-card">
          <div className="fo-card-title">Supported Providers</div>
          <div className="fo-tag-row">{(data.providers || []).map(p => <Chip key={p} label={p} type="gray" />)}</div>
        </div>
      )}
      {cats.map(cat => {
        const items = (data.items || []).filter(i => i.category === cat);
        if (!items.length) return null;
        const prog = data.byCategory?.[cat];
        return (
          <div key={cat} className="fo-cat-group">
            <div className="fo-cat-hdr">{catLabel[cat]} {prog && <span style={{ color: "var(--fo-accent)" }}>{prog.done}/{prog.total}</span>}</div>
            {items.map(item => (
              <div key={item.id} className={`fo-check-item ${item.done ? "done" : ""} ${item.critical ? "critical" : ""}`}
                onClick={() => toggle(item.id, !item.done)}>
                <div className={`fo-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
                <div style={{ flex: 1 }}>
                  <div className="fo-check-lbl">{item.label}</div>
                  {item.critical && <span className="fo-chip fo-chip-red" style={{ fontSize: 9 }}>CRITICAL</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── M5: Dogfooding ────────────────────────────────────────────────────────────
function DogfoodPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/dogfood", []);
  const [form, setForm] = useState({ module: "", duration: 30, rating: 4, notes: "", escapeCategory: "", escapeDesc: "" });
  const [escapes, setEscapes] = useState([]);

  const addEscape = () => {
    if (!form.escapeCategory || !form.escapeDesc) return;
    setEscapes(prev => [...prev, { category: form.escapeCategory, description: form.escapeDesc, severity: "medium" }]);
    setForm(f => ({ ...f, escapeCategory: "", escapeDesc: "" }));
  };

  const logSession = async () => {
    if (!form.module) return toast("Select a module");
    await api("/co2/dogfood/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: form.module, duration: Number(form.duration), rating: Number(form.rating), notes: form.notes, escapes }),
    });
    setEscapes([]);
    setForm({ module: "", duration: 30, rating: 4, notes: "", escapeCategory: "", escapeDesc: "" });
    reload();
    toast("Session logged");
  };

  if (loading) return <div className="fo-loading">Loading dogfood dashboard…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading dogfood data</div>;

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">14-Day Founder Dogfooding</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.progressPct) }}>{data.activeDays}/14</div><div className="fo-stat-lbl">Days Done</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val">{data.sessions}</div><div className="fo-stat-lbl">Sessions</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.escapes > 5 ? "var(--fo-yellow)" : "var(--fo-green)" }}>{data.escapes}</div><div className="fo-stat-lbl">Escapes</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.criticalEscapes > 0 ? "var(--fo-red)" : "var(--fo-green)" }}>{data.criticalEscapes}</div><div className="fo-stat-lbl">Critical</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: "var(--fo-yellow)" }}>{data.avgRating}/5</div><div className="fo-stat-lbl">Avg Rating</div></div>
      </div>
      <div className="fo-card">
        <div className="fo-card-title">14-Day Progress</div>
        <div className="fo-prog-bar"><div className="fo-prog-fill" style={{ width: `${data.progressPct}%`, background: sc(data.progressPct) }} /></div>
        <div style={{ fontSize: 11, color: "var(--fo-muted)", marginTop: 4 }}>{data.activeDays} of 14 days completed — {data.progressPct}%</div>
      </div>
      <div className="fo-form">
        <div className="fo-form-title">Log Dogfood Session</div>
        <div className="fo-form-row">
          <span className="fo-label">Module</span>
          <select className="fo-select" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))}>
            <option value="">Select module…</option>
            {(data.allModules || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="fo-label">Duration (min)</span>
          <input className="fo-input" type="number" min="5" max="240" value={form.duration}
            onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} style={{ width: 60 }} />
          <span className="fo-label">Rating</span>
          <select className="fo-select" value={form.rating} onChange={e => setForm(f => ({ ...f, rating: e.target.value }))}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} ★</option>)}
          </select>
        </div>
        <div className="fo-form-row">
          <span className="fo-label">Escape type</span>
          <select className="fo-select" value={form.escapeCategory} onChange={e => setForm(f => ({ ...f, escapeCategory: e.target.value }))}>
            <option value="">No escape…</option>
            {(data.ESCAPE_CATEGORIES || []).map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <input className="fo-input" placeholder="Escape description…" value={form.escapeDesc}
            onChange={e => setForm(f => ({ ...f, escapeDesc: e.target.value }))} />
          <button className="fo-btn-sm" onClick={addEscape}>Add</button>
        </div>
        {escapes.length > 0 && (
          <div className="fo-tag-row" style={{ marginBottom: 8 }}>
            {escapes.map((e, i) => <span key={i} className="fo-chip fo-chip-red">{e.category}: {e.description.slice(0, 30)}</span>)}
          </div>
        )}
        <textarea className="fo-textarea" placeholder="Session notes…" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <div style={{ marginTop: 8 }}>
          <button className="fo-btn" onClick={logSession}>Log Session</button>
        </div>
      </div>
      {(data.recentSessions || []).length > 0 && (
        <div className="fo-card">
          <div className="fo-card-title">Recent Sessions</div>
          {data.recentSessions.slice().reverse().map(s => (
            <div key={s.id} className="fo-row">
              <div className="fo-row-body">
                <div className="fo-row-name">{s.module} <Chip label={`${s.rating}★`} type="yellow" /></div>
                <div className="fo-row-meta">{s.date} · {s.duration}min · {(s.escapes || []).length} escape(s)</div>
                {s.notes && <div className="fo-check-note">{s.notes}</div>}
              </div>
              {(s.escapes || []).length > 0 && (
                <div className="fo-tag-row">{(s.escapes || []).map((e, i) => <Chip key={i} label={e.category} type="red" />)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M6: Product QA ────────────────────────────────────────────────────────────
function QAPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/qa", []);
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState(null);

  const runQA = async () => {
    setRunning(true);
    const r = await api("/co2/qa/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setLatest(r);
    setRunning(false);
    reload();
    toast("QA run complete");
  };

  useEffect(() => {
    if (data?.runs?.length > 0) setLatest(data.runs[data.runs.length - 1]);
  }, [data]);

  if (loading) return <div className="fo-loading">Loading QA data…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading QA</div>;

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Product QA</div>
        {toastEl}
        <button className="fo-btn" onClick={runQA} disabled={running}>{running ? "Running…" : "Run QA"}</button>
      </div>
      {latest && (
        <div className="fo-stats-grid">
          <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(latest.score || 0) }}>{latest.score ?? 0}%</div><div className="fo-stat-lbl">QA Score</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val">{latest.passed}/{latest.tested}</div><div className="fo-stat-lbl">Passed</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(latest.coveragePct || 0) }}>{latest.coveragePct ?? 0}%</div><div className="fo-stat-lbl">Coverage</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val">{latest.total}</div><div className="fo-stat-lbl">Total Checks</div></div>
        </div>
      )}
      <div className="fo-card">
        <div className="fo-card-title">Modules ({(data.modules || []).length} total)</div>
        <div className="fo-list">
          {(data.modules || []).map(m => {
            const result = latest?.results?.find(r => r.id === m.id);
            return (
              <div key={m.id} className={`fo-row ${result?.score === 100 ? "fo-row-pass" : result?.score != null ? "fo-row-warn" : ""}`}>
                <div className="fo-row-body">
                  <div className="fo-row-name">{m.label}</div>
                  <div className="fo-row-meta">{m.checks?.length} checks</div>
                </div>
                {result ? (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sc(result.score || 0) }}>{result.score}%</span>
                    <Chip label={`${result.passed}/${result.tested}`} type="gray" />
                  </div>
                ) : <Chip label="NOT RUN" type="gray" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── M7: Bug Registry ──────────────────────────────────────────────────────────
function BugsPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/bugs", []);
  const [form, setForm] = useState({ title: "", severity: "medium", module: "", description: "", steps: "" });
  const [filter, setFilter] = useState("all");

  const report = async () => {
    if (!form.title) return toast("Title required");
    await api("/co2/bugs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, steps: form.steps ? form.steps.split("\n") : [] }),
    });
    setForm({ title: "", severity: "medium", module: "", description: "", steps: "" });
    reload();
    toast("Bug reported");
  };

  const markFixed = async (bugId) => {
    await api(`/co2/bugs/${bugId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "fixed" }),
    });
    reload();
    toast("Bug marked fixed");
  };

  if (loading) return <div className="fo-loading">Loading bug registry…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading bugs</div>;

  const severityColor = { critical: "red", high: "red", medium: "yellow", low: "gray" };
  const statusColor   = { open: "red", in_progress: "yellow", fixed: "green", verified: "green", wontfix: "gray" };
  const bugs = (data.bugs || []).filter(b => filter === "all" || b.status === filter || b.severity === filter);

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Bug Registry</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-stats-grid">
        <div className="fo-stat-card"><div className="fo-stat-val">{data.total}</div><div className="fo-stat-lbl">Total</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.open > 0 ? "var(--fo-red)" : "var(--fo-green)" }}>{data.open}</div><div className="fo-stat-lbl">Open</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: data.critical > 0 ? "var(--fo-red)" : "var(--fo-green)" }}>{data.critical}</div><div className="fo-stat-lbl">Critical</div></div>
        <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(data.fixRate) }}>{data.fixRate}%</div><div className="fo-stat-lbl">Fix Rate</div></div>
      </div>
      <div className="fo-form">
        <div className="fo-form-title">Report Bug</div>
        <div className="fo-form-row">
          <input className="fo-input" placeholder="Bug title…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <select className="fo-select" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
            {(data.BUG_SEVERITIES || ["critical","high","medium","low"]).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="fo-input" placeholder="Module…" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} style={{ maxWidth: 120 }} />
          <button className="fo-btn" onClick={report}>Report</button>
        </div>
        <textarea className="fo-textarea" placeholder="Description + steps to reproduce (one per line)…" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 50 }} />
      </div>
      <div className="fo-tag-row" style={{ marginBottom: 8 }}>
        {["all", "open", "fixed", "critical", "high"].map(f => (
          <button key={f} className={`fo-btn-sm ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="fo-list">
        {bugs.length === 0 && <div className="fo-empty">No bugs matching filter</div>}
        {bugs.map(b => (
          <div key={b.id} className={`fo-row ${b.status === "open" || b.status === "in_progress" ? "fo-row-fail" : "fo-row-pass"}`}>
            <div className="fo-row-body">
              <div className="fo-row-name">{b.title}</div>
              <div className="fo-row-meta">{b.module} · {b.reportedAt?.slice(0,10)}</div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Chip label={b.severity} type={severityColor[b.severity] || "gray"} />
              <Chip label={b.status} type={statusColor[b.status] || "gray"} />
              {(b.status === "open" || b.status === "in_progress") && (
                <button className="fo-btn-sm" style={{ fontSize: 9, padding: "2px 5px" }} onClick={() => markFixed(b.id)}>Fix</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M8: Performance ───────────────────────────────────────────────────────────
function PerfPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/perf", []);
  const [form, setForm] = useState({ metric: "", value: "", unit: "ms", notes: "" });

  const record = async () => {
    if (!form.metric || !form.value) return toast("Metric and value required");
    const bm = data?.benchmarks?.find(b => b.id === form.metric);
    await api("/co2/perf/record", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric: form.metric, value: Number(form.value), unit: form.unit, target: bm?.target_ms || bm?.target_mb, notes: form.notes }),
    });
    setForm({ metric: "", value: "", unit: "ms", notes: "" });
    reload();
    toast("Measurement recorded");
  };

  if (loading) return <div className="fo-loading">Loading performance data…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading performance</div>;

  const mem = data.live?.memory;

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Performance Measurements</div>
        {toastEl}
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      {mem && (
        <div className="fo-stats-grid">
          <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: mem.rss <= 200 ? "var(--fo-green)" : mem.rss <= 400 ? "var(--fo-yellow)" : "var(--fo-red)" }}>{mem.rss}MB</div><div className="fo-stat-lbl">RSS Memory</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val">{mem.heapUsed}MB</div><div className="fo-stat-lbl">Heap Used</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val">{mem.heapTotal}MB</div><div className="fo-stat-lbl">Heap Total</div></div>
        </div>
      )}
      <div className="fo-form">
        <div className="fo-form-title">Record Measurement</div>
        <div className="fo-form-row">
          <select className="fo-select" value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}>
            <option value="">Select metric…</option>
            {(data.benchmarks || []).map(b => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <input className="fo-input" type="number" placeholder="Value…" value={form.value}
            onChange={e => setForm(f => ({ ...f, value: e.target.value }))} style={{ width: 80 }} />
          <select className="fo-select" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
            <option value="ms">ms</option><option value="mb">MB</option><option value="s">s</option>
          </select>
          <button className="fo-btn" onClick={record}>Record</button>
        </div>
      </div>
      <div className="fo-card">
        <div className="fo-card-title">Benchmark Targets</div>
        {(data.benchmarks || []).map(b => {
          const s = data.summary?.[b.id];
          return (
            <div key={b.id} className="fo-kv-row">
              <span className="fo-kv-key">{b.id.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 11, color: "var(--fo-muted)", marginRight: 8 }}>target: {b.target_ms || b.target_mb}{b.target_ms ? "ms" : "MB"}</span>
              {s ? (
                <span className="fo-kv-val" style={{ color: s.pass ? "var(--fo-green)" : s.pass === false ? "var(--fo-red)" : "var(--fo-muted)" }}>
                  {s.avg}{b.target_ms ? "ms" : "MB"} avg
                </span>
              ) : <Chip label="NOT MEASURED" type="gray" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── M9: Readiness Report ──────────────────────────────────────────────────────
function ReadinessPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/readiness", []);
  const [gen, setGen] = useState(false);

  const generate = async () => {
    setGen(true);
    await api("/co2/readiness/generate", { method: "POST" });
    reload();
    setGen(false);
    toast("Readiness report generated");
  };

  if (loading) return <div className="fo-loading">Loading readiness report…</div>;
  const r = data?.id ? data : null;
  const gradeColor = { A: "var(--fo-green)", B: "var(--fo-teal)", C: "var(--fo-yellow)", D: "var(--fo-red)" };

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Production Readiness Report</div>
        {toastEl}
        <button className="fo-btn" onClick={generate} disabled={gen}>{gen ? "Generating…" : "Generate Report"}</button>
      </div>
      {!r && <div className="fo-empty">No report generated yet. Click Generate Report.</div>}
      {r && <>
        <div className="fo-overall">
          <div className="fo-overall-score" style={{ color: sc(r.overall) }}>{r.overall}%</div>
          <div className="fo-overall-meta">
            <div className="fo-overall-grade" style={{ color: gradeColor[r.grade] || "var(--fo-accent)" }}>Grade {r.grade} — {(r.readinessLevel || "").replace(/_/g, " ")}</div>
            <div className="fo-overall-sub">Generated {new Date(r.generatedAt).toLocaleString()}</div>
          </div>
        </div>
        <div className="fo-card">
          <div className="fo-card-title">Dimension Scores</div>
          {Object.entries(r.dimensions || {}).map(([k, d]) => (
            <ScoreBar key={k} label={`${k.replace(/_/g," ")} (${d.weight}%)`} score={d.score} />
          ))}
        </div>
        {r.blockers?.length > 0 && (
          <div className="fo-card" style={{ borderColor: "rgba(239,68,68,.3)" }}>
            <div className="fo-card-title" style={{ color: "var(--fo-red)" }}>Blockers</div>
            {r.blockers.map((b, i) => <div key={i} className="fo-row fo-row-fail"><span className="fo-row-name">{b}</span></div>)}
          </div>
        )}
        {r.recommendations?.length > 0 && (
          <div className="fo-card">
            <div className="fo-card-title">Recommendations</div>
            {r.recommendations.map((rec, i) => (
              <div key={i} className="fo-row"><span className="fo-row-name">{rec}</span></div>
            ))}
          </div>
        )}
      </>}
    </div>
  );
}

// ── M10: Alpha Launch Report ──────────────────────────────────────────────────
function AlphaPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/co2/alpha", []);
  const [gen, setGen] = useState(false);

  const generate = async () => {
    setGen(true);
    await api("/co2/alpha/generate", { method: "POST" });
    reload();
    setGen(false);
    toast("Alpha report generated");
  };

  if (loading) return <div className="fo-loading">Loading alpha launch report…</div>;
  const r = data?.id ? data : null;
  const readinessColor = { GO: "var(--fo-green)", "CONDITIONAL GO": "var(--fo-yellow)", "NOT YET": "var(--fo-red)" };

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">Alpha Launch Report</div>
        {toastEl}
        <button className="fo-btn" onClick={generate} disabled={gen}>{gen ? "Generating…" : "Generate Report"}</button>
      </div>
      {!r && <div className="fo-empty">No report generated yet. Click Generate Report.</div>}
      {r && <>
        <div className="fo-overall">
          <div className="fo-overall-score" style={{ color: readinessColor[r.alphaReadiness] || "var(--fo-accent)", fontSize: 28 }}>{r.alphaReadiness}</div>
          <div className="fo-overall-meta">
            <div className="fo-overall-grade">{r.criteriaMet}/{r.criteriaTotal} criteria met — {r.weightedScore}% weighted score</div>
            <div className="fo-overall-sub">Generated {new Date(r.generatedAt).toLocaleString()}</div>
          </div>
        </div>
        <div className="fo-card">
          <div className="fo-card-title">Launch Criteria ({r.criteriaTotal})</div>
          <div className="fo-list">
            {(r.criteriaResults || []).map(c => (
              <div key={c.id} className={`fo-row ${c.met ? "fo-row-pass" : "fo-row-fail"}`}>
                <div className="fo-row-body">
                  <div className="fo-row-name">{c.label}</div>
                  <div className="fo-row-meta">{c.value} · weight: {c.weight}%</div>
                </div>
                <Chip label={c.met ? "MET" : "UNMET"} type={c.met ? "green" : "red"} />
              </div>
            ))}
          </div>
        </div>
        {r.timeline?.length > 0 && (
          <div className="fo-card">
            <div className="fo-card-title">Launch Timeline</div>
            <div className="fo-timeline">
              {r.timeline.map((t, i) => (
                <div key={i} className="fo-tl-item">
                  <div className={`fo-tl-dot ${t.done ? "done" : i === r.timeline.findIndex(x => !x.done) ? "active" : ""}`} />
                  <div className="fo-tl-body">
                    <div className="fo-tl-label">{t.milestone}</div>
                    <div className="fo-tl-date">{t.target}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {r.nextSteps?.length > 0 && (
          <div className="fo-card">
            <div className="fo-card-title">Next Steps</div>
            {r.nextSteps.map((s, i) => <div key={i} className="fo-row"><span className="fo-row-name">{s}</span></div>)}
          </div>
        )}
        {r.alphaProfile && (
          <div className="fo-card">
            <div className="fo-card-title">Alpha User Profile</div>
            <div className="fo-kv-row"><span className="fo-kv-key">Target users</span><span className="fo-kv-val">{r.alphaProfile.targetUsers}</span></div>
            <div className="fo-kv-row"><span className="fo-kv-key">Segment</span><span className="fo-kv-val" style={{ color: "var(--fo-muted)" }}>{r.alphaProfile.targetSegment}</span></div>
            <div className="fo-kv-row"><span className="fo-kv-key">Geographies</span><span className="fo-kv-val" style={{ color: "var(--fo-muted)" }}>{r.alphaProfile.geographies?.join(", ")}</span></div>
            <div className="fo-kv-row"><span className="fo-kv-key">Trial</span><span className="fo-kv-val">{r.alphaProfile.pricing?.trial}</span></div>
          </div>
        )}
      </>}
    </div>
  );
}

// ── Executive ─────────────────────────────────────────────────────────────────
function ExecutivePanel() {
  const { data, loading, reload } = useOps("/co2/executive", []);
  if (loading) return <div className="fo-loading">Loading CO2 executive view…</div>;
  if (!data?.ok) return <div className="fo-loading">Error loading executive view</div>;

  const modules = [
    { label: "Deploy",    score: data.deploy?.score,    sub: data.deploy?.deployed ? "Live" : "Pending"   },
    { label: "AI",        score: data.ai?.score,        sub: `${data.ai?.active || 0} active providers`  },
    { label: "Billing",   score: data.billing?.score,   sub: data.billing?.live ? "Razorpay live" : "—"  },
    { label: "Email",     score: data.email?.score,     sub: data.email?.ready ? "SMTP ready" : "—"      },
    { label: "Dogfood",   score: data.dogfood?.score,   sub: `${data.dogfood?.days || 0}/14 days`        },
    { label: "Bug Rate",  score: data.bugs?.fixRate,    sub: `${data.bugs?.open || 0} open bugs`         },
  ];

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">CO2 Executive Dashboard</div>
        <button className="fo-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="fo-overall">
        <div className="fo-overall-score" style={{ color: sc(data.overall) }}>{data.overall}%</div>
        <div className="fo-overall-meta">
          <div className="fo-overall-grade" style={{ color: sc(data.overall) }}>Production Deployment + Dogfooding</div>
          <div className="fo-overall-sub">Memory: {data.perf?.memoryMB}MB RSS · {new Date(data.checkedAt).toLocaleString()}</div>
        </div>
      </div>
      <div className="fo-exec-grid">
        {modules.map(m => (
          <div key={m.label} className="fo-exec-card">
            <div className="fo-exec-val" style={{ color: sc(m.score ?? 0), fontSize: 16 }}>{m.score ?? "–"}%</div>
            <div className="fo-exec-label">{m.label}</div>
            <div className="fo-exec-sub">{m.sub}</div>
          </div>
        ))}
      </div>
      {data.readiness && (
        <div className="fo-card">
          <div className="fo-card-title">Readiness Report</div>
          <div className="fo-kv-row">
            <span className="fo-kv-key">Overall Score</span>
            <span className="fo-kv-val" style={{ color: sc(data.readiness.overall) }}>{data.readiness.overall}% — Grade {data.readiness.grade}</span>
          </div>
          <div className="fo-kv-row">
            <span className="fo-kv-key">Level</span>
            <span className="fo-kv-val">{(data.readiness.readinessLevel || "").replace(/_/g, " ")}</span>
          </div>
        </div>
      )}
      {data.alpha && (
        <div className="fo-card">
          <div className="fo-card-title">Alpha Launch Gate</div>
          <div className="fo-kv-row">
            <span className="fo-kv-key">Decision</span>
            <span className="fo-kv-val" style={{ color: data.alpha.readiness === "GO" ? "var(--fo-green)" : data.alpha.readiness === "CONDITIONAL GO" ? "var(--fo-yellow)" : "var(--fo-red)", fontWeight: 800 }}>{data.alpha.readiness}</span>
          </div>
          <div className="fo-kv-row">
            <span className="fo-kv-key">Weighted Score</span>
            <span className="fo-kv-val">{data.alpha.score}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Benchmark ─────────────────────────────────────────────────────────────────
function BenchmarkPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    api("/co2/benchmark").then(r => { setResult(r); setLoading(false); });
  };

  useEffect(() => { run(); }, []);

  return (
    <div>
      <div className="fo-section-hdr">
        <div className="fo-section-title">CO2 Benchmark</div>
        <button className="fo-btn" onClick={run} disabled={loading}>{loading ? "Running…" : "Run Benchmark"}</button>
      </div>
      {loading && <div className="fo-loading">Running all 10 CO2 checks…</div>}
      {result && !loading && <>
        <div className="fo-stats-grid">
          <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: sc(result.score) }}>{result.score}%</div><div className="fo-stat-lbl">Score</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val">{result.passing}/{result.total}</div><div className="fo-stat-lbl">Passing</div></div>
          <div className="fo-stat-card"><div className="fo-stat-val" style={{ color: result.regressionPass ? "var(--fo-green)" : "var(--fo-red)" }}>{result.regressionPass ? "PASS" : "FAIL"}</div><div className="fo-stat-lbl">Regression</div></div>
        </div>
        <div className="fo-card">
          <div className="fo-card-title">Checks</div>
          <div className="fo-list">
            {(result.checks || []).map((c, i) => (
              <div key={c.id} className={`fo-row ${c.ok ? "fo-row-pass" : "fo-row-fail"}`}>
                <div className="fo-row-body">
                  <div className="fo-row-name">M{i+1}. {c.label}</div>
                  {c.error && <div className="fo-row-meta" style={{ color: "var(--fo-red)" }}>Error: {c.error}</div>}
                </div>
                <Chip label={c.ok ? "PASS" : "FAIL"} type={c.ok ? "green" : "red"} />
              </div>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "executive",  label: "Overview",     icon: "◎" },
  { id: "deploy",     label: "Deploy",       icon: "⬡" },
  { id: "ai",         label: "AI Config",    icon: "◉" },
  { id: "billing",    label: "Billing",      icon: "◈" },
  { id: "email",      label: "Email",        icon: "⊞" },
  { id: "dogfood",    label: "Dogfood",      icon: "◇" },
  { id: "qa",         label: "Product QA",   icon: "⬢" },
  { id: "bugs",       label: "Bugs",         icon: "✕" },
  { id: "perf",       label: "Performance",  icon: "▷" },
  { id: "readiness",  label: "Readiness",    icon: "✦" },
  { id: "alpha",      label: "Alpha",        icon: "◎" },
  { id: "benchmark",  label: "Benchmark",    icon: "⚡" },
];

const PANELS = {
  executive:  <ExecutivePanel />,
  deploy:     <DeployPanel />,
  ai:         <AIProvidersPanel />,
  billing:    <BillingPanel />,
  email:      <EmailPanel />,
  dogfood:    <DogfoodPanel />,
  qa:         <QAPanel />,
  bugs:       <BugsPanel />,
  perf:       <PerfPanel />,
  readiness:  <ReadinessPanel />,
  alpha:      <AlphaPanel />,
  benchmark:  <BenchmarkPanel />,
};

export default function FounderOps() {
  const [tab, setTab] = useState("executive");
  return (
    <div className="fo-root">
      <div className="fo-header">
        <span className="fo-title">Founder Ops</span>
        <span className="fo-subtitle">CO2 · Production Deployment + Dogfooding</span>
      </div>
      <div className="fo-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`fo-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="fo-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      <div className="fo-content">{PANELS[tab] || null}</div>
    </div>
  );
}
