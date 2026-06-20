import React, { useState, useEffect, useCallback } from "react";
import "./FounderJournal.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function today() { return new Date().toISOString().slice(0, 10); }

const TABS = [
  { id: "journal",   label: "Journal"     },
  { id: "escapes",   label: "Escapes"     },
  { id: "crashes",   label: "Crashes"     },
  { id: "perf",      label: "Performance" },
  { id: "ai",        label: "AI Usage"    },
  { id: "credits",   label: "Credits"     },
  { id: "friction",  label: "Frictions"   },
  { id: "score",     label: "Weekly Score"},
  { id: "ship",      label: "Ship?        " },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function ScoreBadge({ value, max = 100, label }) {
  const pct  = Math.round((value / max) * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="fop-score-badge">
      <div className="fop-score-ring" style={{ "--pct": pct, "--color": color }}>
        <span className="fop-score-num">{value}</span>
      </div>
      {label && <div className="fop-score-label">{label}</div>}
    </div>
  );
}

function Bar({ value, max = 100, color }) {
  const pct  = Math.min(100, Math.round((value / max) * 100));
  const c    = color || (pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444");
  return (
    <div className="fop-bar-track">
      <div className="fop-bar-fill" style={{ width: `${pct}%`, background: c }} />
    </div>
  );
}

function SevDot({ sev }) {
  const c = sev === "critical" ? "#ef4444" : sev === "high" ? "#f97316" : sev === "medium" ? "#f59e0b" : "#888";
  return <span className="fop-sev-dot" style={{ background: c }} />;
}

// ── Panel: Daily Journal ──────────────────────────────────────────────────────

function JournalPanel() {
  const [day,        setDay]        = useState(null);
  const [days,       setDays]       = useState([]);
  const [selDate,    setSelDate]    = useState(today());
  const [narrative,  setNarrative]  = useState("");
  const [mood,       setMood]       = useState(null);
  const [hours,      setHours]      = useState("");
  const [goals,      setGoals]      = useState("");
  const [blockers,   setBlockers]   = useState("");
  const [notes,      setNotes]      = useState("");
  const [saving,     setSaving]     = useState(false);
  const [msg,        setMsg]        = useState("");

  const loadDay = useCallback(async (date) => {
    const r = await api(`/fop/journal/${date}`);
    if (r.ok) {
      const d = r.day;
      setDay(d);
      setNarrative(d.narrative || "");
      setMood(d.mood || null);
      setHours(d.productiveHours ?? "");
      setGoals((d.completedGoals || []).join("\n"));
      setBlockers((d.blockers || []).join("\n"));
      setNotes(d.notes || "");
    }
  }, []);

  useEffect(() => {
    loadDay(selDate);
    api("/fop/journal/list").then(r => r.ok && setDays(r.days || []));
  }, [loadDay, selDate]);

  const save = async () => {
    setSaving(true);
    await patch("/fop/journal", {
      date:           selDate,
      narrative,
      mood:           mood ? parseInt(mood) : null,
      productiveHours: hours ? parseFloat(hours) : null,
      completedGoals: goals.split("\n").filter(Boolean),
      blockers:       blockers.split("\n").filter(Boolean),
      notes,
    });
    setMsg("Saved");
    setSaving(false);
    setTimeout(() => setMsg(""), 2000);
    loadDay(selDate);
  };

  const seal = async () => {
    await post("/fop/journal/seal", { date: selDate });
    setMsg("Day sealed");
    loadDay(selDate);
    api("/fop/journal/list").then(r => r.ok && setDays(r.days || []));
  };

  return (
    <div className="fop-split">
      <aside className="fop-sidebar">
        <div className="fop-sidebar-title">14-Day Log</div>
        <button className="fop-day-btn active-day" onClick={() => setSelDate(today())}>Today — {today()}</button>
        {days.filter(d => d.date !== today()).slice(0, 13).map(d => (
          <button
            key={d.date}
            className={`fop-day-btn${selDate === d.date ? " active-day" : ""}`}
            onClick={() => setSelDate(d.date)}
          >
            <span className="fop-day-date">{d.date}</span>
            {d.sealed && <span className="fop-sealed-chip">✓</span>}
            {d.mood && <span className="fop-mood-chip">{"★".repeat(d.mood)}</span>}
            {d.frictions > 0 && <span className="fop-stat-chip">{d.frictions}f</span>}
          </button>
        ))}
      </aside>

      <div className="fop-main">
        <div className="fop-journal-header">
          <span className="fop-date-label">{selDate}</span>
          {day?.sealed && <span className="fop-chip green">Sealed</span>}
          <div style={{ flex: 1 }} />
          {msg && <span className="fop-msg">{msg}</span>}
          <button className="fop-btn" onClick={save} disabled={saving || day?.sealed}>
            {saving ? "Saving…" : "Save"}
          </button>
          {!day?.sealed && (
            <button className="fop-btn-outline" onClick={seal}>Seal Day</button>
          )}
        </div>

        <div className="fop-field-row">
          <div className="fop-field">
            <label className="fop-label">Mood (1–5)</label>
            <div className="fop-mood-row">
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  className={`fop-mood-btn${mood === n ? " selected" : ""}`}
                  onClick={() => !day?.sealed && setMood(n)}
                  disabled={day?.sealed}
                >{["😫","😕","😐","🙂","😄"][n-1]}</button>
              ))}
            </div>
          </div>
          <div className="fop-field" style={{ width: 120 }}>
            <label className="fop-label">Productive Hours</label>
            <input
              className="fop-input"
              type="number" min="0" max="24" step="0.5"
              value={hours} onChange={e => setHours(e.target.value)}
              disabled={day?.sealed}
            />
          </div>
        </div>

        <div className="fop-field">
          <label className="fop-label">Founder Narrative — what did you build in Ooplix today?</label>
          <textarea
            className="fop-textarea fop-narrative"
            value={narrative}
            onChange={e => setNarrative(e.target.value)}
            placeholder="Write what you worked on, what you discovered, what you felt..."
            disabled={day?.sealed}
          />
        </div>

        <div className="fop-field-row">
          <div className="fop-field">
            <label className="fop-label">Goals Completed (one per line)</label>
            <textarea
              className="fop-textarea fop-short"
              value={goals}
              onChange={e => setGoals(e.target.value)}
              disabled={day?.sealed}
            />
          </div>
          <div className="fop-field">
            <label className="fop-label">Blockers (one per line)</label>
            <textarea
              className="fop-textarea fop-short"
              value={blockers}
              onChange={e => setBlockers(e.target.value)}
              disabled={day?.sealed}
            />
          </div>
        </div>

        <div className="fop-field">
          <label className="fop-label">Notes</label>
          <textarea
            className="fop-textarea fop-short"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={day?.sealed}
          />
        </div>

        {day && (
          <div className="fop-day-stats">
            <span>{day.frictions?.length || 0} frictions logged</span>
            <span>{day.aiUsage?.length || 0} AI interactions</span>
            <span>{day.performance?.length || 0} perf samples</span>
            <span>{day.creditUsage?.length || 0} credit entries</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panel: Escape Log ─────────────────────────────────────────────────────────

function EscapePanel() {
  const [list,     setList]     = useState([]);
  const [tool,     setTool]     = useState("");
  const [reason,   setReason]   = useState("");
  const [feature,  setFeature]  = useState("");
  const [duration, setDuration] = useState("");
  const [msg,      setMsg]      = useState("");

  const load = async () => {
    const r = await api("/fop/escape");
    if (r.ok) setList(r.escapes || []);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!tool || !reason) return;
    await post("/fop/escape", { tool, reason, feature, duration: parseInt(duration) || null });
    setTool(""); setReason(""); setFeature(""); setDuration("");
    setMsg("Escape logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Escape Log</span>
        <span className="fop-chip">{list.length} total</span>
      </div>
      <p className="fop-desc">Every time you left Ooplix to use another tool.</p>

      <div className="fop-form-row">
        <input className="fop-input" placeholder="Tool used (e.g. VS Code, ChatGPT)" value={tool} onChange={e => setTool(e.target.value)} />
        <input className="fop-input" placeholder="Missing feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <input className="fop-input" type="number" placeholder="Minutes" style={{ width: 90 }} value={duration} onChange={e => setDuration(e.target.value)} />
      </div>
      <div className="fop-form-row" style={{ marginTop: 6 }}>
        <input className="fop-input" style={{ flex: 1 }} placeholder="Reason — why couldn't Ooplix handle this?" value={reason} onChange={e => setReason(e.target.value)} />
        <button className="fop-btn" onClick={submit}>Log Escape</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      <div className="fop-list" style={{ marginTop: 16 }}>
        {list.length === 0 && <div className="fop-empty">No escapes logged — you're building in Ooplix.</div>}
        {[...list].reverse().map(e => (
          <div key={e.id} className="fop-escape-row">
            <div className="fop-escape-tool">{e.tool}</div>
            <div className="fop-escape-reason">{e.reason}</div>
            {e.feature && <div className="fop-chip fop-chip-sm">missing: {e.feature}</div>}
            {e.duration && <div className="fop-chip fop-chip-sm">{e.duration} min</div>}
            <div className="fop-ts">{e.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel: Crash Log ──────────────────────────────────────────────────────────

function CrashPanel() {
  const [list,       setList]       = useState([]);
  const [title,      setTitle]      = useState("");
  const [desc,       setDesc]       = useState("");
  const [feature,    setFeature]    = useState("");
  const [severity,   setSeverity]   = useState("medium");
  const [resolving,  setResolving]  = useState(null);
  const [resolution, setResolution] = useState("");
  const [msg,        setMsg]        = useState("");

  const load = async () => {
    const r = await api("/fop/crash");
    if (r.ok) setList(r.crashes || []);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!title) return;
    await post("/fop/crash", { title, description: desc, feature, severity });
    setTitle(""); setDesc(""); setFeature(""); setSeverity("medium");
    setMsg("Crash logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  const resolve = async (id) => {
    await patch(`/fop/crash/${id}/resolve`, { resolution });
    setResolving(null); setResolution("");
    load();
  };

  const open   = list.filter(c => !c.resolved);
  const closed = list.filter(c => c.resolved);

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Crash Log</span>
        <span className="fop-chip red">{open.length} open</span>
        <span className="fop-chip green">{closed.length} resolved</span>
      </div>
      <p className="fop-desc">Every crash or error encountered. Fix immediately — log the resolution.</p>

      <div className="fop-form-row">
        <input className="fop-input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 2 }} />
        <input className="fop-input" placeholder="Feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <select className="fop-select" value={severity} onChange={e => setSeverity(e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div className="fop-form-row" style={{ marginTop: 6 }}>
        <input className="fop-input" style={{ flex: 1 }} placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
        <button className="fop-btn" onClick={submit}>Log Crash</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      <div className="fop-list" style={{ marginTop: 16 }}>
        {list.length === 0 && <div className="fop-empty">No crashes logged.</div>}
        {[...list].reverse().map(c => (
          <div key={c.id} className={`fop-crash-row ${c.resolved ? "resolved" : "open"}`}>
            <SevDot sev={c.severity} />
            <div style={{ flex: 1 }}>
              <div className="fop-crash-title">{c.title}</div>
              {c.description && <div className="fop-crash-desc">{c.description}</div>}
              {c.resolved && <div className="fop-crash-res">✓ {c.resolution}</div>}
            </div>
            {c.feature && <span className="fop-chip fop-chip-sm">{c.feature}</span>}
            <span className="fop-ts">{c.date}</span>
            {!c.resolved && (
              resolving === c.id ? (
                <div className="fop-resolve-row">
                  <input className="fop-input" placeholder="Resolution" value={resolution} onChange={e => setResolution(e.target.value)} />
                  <button className="fop-btn" onClick={() => resolve(c.id)}>Resolve</button>
                  <button className="fop-btn-outline" onClick={() => setResolving(null)}>Cancel</button>
                </div>
              ) : (
                <button className="fop-btn-sm" onClick={() => setResolving(c.id)}>Resolve</button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel: Performance Log ────────────────────────────────────────────────────

function PerfPanel() {
  const [list,        setList]        = useState([]);
  const [action,      setAction]      = useState("");
  const [ms,          setMs]          = useState("");
  const [feature,     setFeature]     = useState("");
  const [acceptable,  setAcceptable]  = useState(true);
  const [msg,         setMsg]         = useState("");

  const load = async () => {
    const r = await api("/fop/perf");
    if (r.ok) setList(r.perf || []);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!action || !ms) return;
    await post("/fop/perf", { action, ms: parseInt(ms), acceptable, feature });
    setAction(""); setMs(""); setFeature(""); setAcceptable(true);
    setMsg("Sample logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  const avg = list.length ? Math.round(list.reduce((s, p) => s + p.ms, 0) / list.length) : 0;
  const slow = list.filter(p => !p.acceptable).length;

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Performance Log</span>
        {list.length > 0 && <>
          <span className="fop-chip">avg {avg}ms</span>
          {slow > 0 && <span className="fop-chip red">{slow} slow</span>}
        </>}
      </div>
      <p className="fop-desc">Time key interactions. Log what felt slow or broken.</p>

      <div className="fop-form-row">
        <input className="fop-input" placeholder="Action (e.g. AI Chat response)" value={action} onChange={e => setAction(e.target.value)} style={{ flex: 2 }} />
        <input className="fop-input" type="number" placeholder="ms" style={{ width: 90 }} value={ms} onChange={e => setMs(e.target.value)} />
        <input className="fop-input" placeholder="Feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <label className="fop-check-label">
          <input type="checkbox" checked={acceptable} onChange={e => setAcceptable(e.target.checked)} />
          Acceptable
        </label>
        <button className="fop-btn" onClick={submit}>Log</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      <div className="fop-list" style={{ marginTop: 16 }}>
        {list.length === 0 && <div className="fop-empty">No performance samples logged today.</div>}
        {[...list].reverse().map(p => (
          <div key={p.id} className={`fop-perf-row ${p.acceptable ? "" : "slow"}`}>
            <span className="fop-perf-action">{p.action}</span>
            <span className="fop-perf-ms" style={{ color: p.acceptable ? "#22c55e" : "#ef4444" }}>{p.ms}ms</span>
            {p.feature && <span className="fop-chip fop-chip-sm">{p.feature}</span>}
            {!p.acceptable && <span className="fop-chip red fop-chip-sm">slow</span>}
            <span className="fop-ts">{p.ts?.slice(11, 16)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel: AI Usage ───────────────────────────────────────────────────────────

function AIPanel() {
  const [report,   setReport]   = useState(null);
  const [feature,  setFeature]  = useState("");
  const [model,    setModel]    = useState("claude-sonnet-4-6");
  const [pt,       setPt]       = useState("");
  const [ct,       setCt]       = useState("");
  const [lat,      setLat]      = useState("");
  const [helpful,  setHelpful]  = useState(true);
  const [msg,      setMsg]      = useState("");

  const load = async () => {
    const r = await api("/fop/ai/report");
    if (r.ok) setReport(r.report);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!feature) return;
    await post("/fop/ai", {
      feature, model,
      promptTokens:     parseInt(pt) || 0,
      completionTokens: parseInt(ct) || 0,
      latencyMs:        parseInt(lat) || 0,
      helpful,
    });
    setFeature(""); setPt(""); setCt(""); setLat(""); setHelpful(true);
    setMsg("Logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">AI Usage Report</span>
        {report && <>
          <span className="fop-chip">{report.totalCalls} calls</span>
          <span className="fop-chip">{report.helpfulRate}% helpful</span>
          <span className="fop-chip">avg {report.avgLatencyMs}ms</span>
        </>}
      </div>
      <p className="fop-desc">Every AI interaction — model, tokens, latency, helpfulness.</p>

      <div className="fop-form-row">
        <input className="fop-input" placeholder="Feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <input className="fop-input" placeholder="Model" value={model} onChange={e => setModel(e.target.value)} />
        <input className="fop-input" type="number" placeholder="Prompt tokens" style={{ width: 110 }} value={pt} onChange={e => setPt(e.target.value)} />
        <input className="fop-input" type="number" placeholder="Completion tokens" style={{ width: 130 }} value={ct} onChange={e => setCt(e.target.value)} />
        <input className="fop-input" type="number" placeholder="Latency ms" style={{ width: 100 }} value={lat} onChange={e => setLat(e.target.value)} />
        <label className="fop-check-label">
          <input type="checkbox" checked={helpful} onChange={e => setHelpful(e.target.checked)} />
          Helpful
        </label>
        <button className="fop-btn" onClick={submit}>Log</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      {report && (
        <div style={{ marginTop: 16 }}>
          <div className="fop-stats-grid">
            <div className="fop-stat-card"><div className="fop-stat-val">{report.totalCalls}</div><div className="fop-stat-lbl">AI Calls</div></div>
            <div className="fop-stat-card"><div className="fop-stat-val">{(report.totalTokens || 0).toLocaleString()}</div><div className="fop-stat-lbl">Total Tokens</div></div>
            <div className="fop-stat-card"><div className="fop-stat-val">{report.avgLatencyMs}ms</div><div className="fop-stat-lbl">Avg Latency</div></div>
            <div className="fop-stat-card"><div className="fop-stat-val">{report.helpfulRate}%</div><div className="fop-stat-lbl">Helpful Rate</div></div>
          </div>

          {Object.keys(report.byModel || {}).length > 0 && (
            <>
              <div className="fop-sub-title">By Model</div>
              {Object.entries(report.byModel).map(([model, s]) => (
                <div key={model} className="fop-perf-row">
                  <span className="fop-perf-action">{model}</span>
                  <span className="fop-chip fop-chip-sm">{s.calls} calls</span>
                  <span className="fop-chip fop-chip-sm">{(s.promptTokens + s.completionTokens).toLocaleString()} tokens</span>
                </div>
              ))}
            </>
          )}

          {Object.keys(report.byFeature || {}).length > 0 && (
            <>
              <div className="fop-sub-title">By Feature</div>
              {Object.entries(report.byFeature).sort((a,b)=>b[1]-a[1]).map(([f, n]) => (
                <div key={f} className="fop-perf-row">
                  <span className="fop-perf-action">{f}</span>
                  <span className="fop-chip fop-chip-sm">{n}</span>
                  <Bar value={n} max={Math.max(...Object.values(report.byFeature))} />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel: Credit Consumption ─────────────────────────────────────────────────

function CreditsPanel() {
  const [report,  setReport]  = useState(null);
  const [feature, setFeature] = useState("");
  const [credits, setCredits] = useState("");
  const [purpose, setPurpose] = useState("");
  const [msg,     setMsg]     = useState("");

  const load = async () => {
    const r = await api("/fop/credits/report");
    if (r.ok) setReport(r.report);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!feature || !credits) return;
    await post("/fop/credits", { feature, credits: parseFloat(credits), purpose });
    setFeature(""); setCredits(""); setPurpose("");
    setMsg("Logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Credit Consumption Report</span>
        {report && <span className="fop-chip">{report.totalCreditsUsed} credits today</span>}
      </div>
      <p className="fop-desc">Track every credit spent building with Ooplix.</p>

      <div className="fop-form-row">
        <input className="fop-input" placeholder="Feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <input className="fop-input" type="number" placeholder="Credits" style={{ width: 100 }} value={credits} onChange={e => setCredits(e.target.value)} />
        <input className="fop-input" placeholder="Purpose" style={{ flex: 1 }} value={purpose} onChange={e => setPurpose(e.target.value)} />
        <button className="fop-btn" onClick={submit}>Log</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      {report && (
        <div style={{ marginTop: 16 }}>
          <div className="fop-stats-grid">
            <div className="fop-stat-card">
              <div className="fop-stat-val">{report.totalCreditsUsed}</div>
              <div className="fop-stat-lbl">Credits Today</div>
            </div>
          </div>

          {Object.keys(report.byFeature || {}).length > 0 && (
            <>
              <div className="fop-sub-title">By Feature</div>
              {Object.entries(report.byFeature).sort((a,b)=>b[1]-a[1]).map(([f, n]) => (
                <div key={f} className="fop-perf-row">
                  <span className="fop-perf-action">{f}</span>
                  <span className="fop-chip fop-chip-sm">{n} cr</span>
                  <Bar value={n} max={Math.max(...Object.values(report.byFeature))} color="#7c6af7" />
                </div>
              ))}
            </>
          )}

          <div className="fop-sub-title">All Entries</div>
          <div className="fop-list">
            {(report.entries || []).length === 0 && <div className="fop-empty">No credit entries today.</div>}
            {[...(report.entries || [])].reverse().map(e => (
              <div key={e.id} className="fop-perf-row">
                <span className="fop-perf-action">{e.feature}</span>
                <span className="fop-perf-ms" style={{ color: "#7c6af7" }}>{e.credits} cr</span>
                {e.purpose && <span className="fop-chip fop-chip-sm">{e.purpose}</span>}
                <span className="fop-ts">{e.ts?.slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel: Top 20 Frictions ───────────────────────────────────────────────────

function FrictionPanel() {
  const [list,       setList]       = useState([]);
  const [text,       setText]       = useState("");
  const [score,      setScore]      = useState(5);
  const [feature,    setFeature]    = useState("");
  const [workaround, setWorkaround] = useState("");
  const [msg,        setMsg]        = useState("");

  const load = async () => {
    const r = await api("/fop/friction/top");
    if (r.ok) setList(r.frictions || []);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!text) return;
    await post("/fop/friction", { text, score: parseInt(score), feature, workaround });
    setText(""); setScore(5); setFeature(""); setWorkaround("");
    setMsg("Friction logged");
    setTimeout(() => setMsg(""), 2000);
    load();
  };

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Top 20 Daily Frictions</span>
        <span className="fop-chip">{list.length} logged</span>
      </div>
      <p className="fop-desc">Score 1–10 (10 = most painful). Workarounds reveal missing features.</p>

      <div className="fop-form-row">
        <input className="fop-input" style={{ flex: 2 }} placeholder="What caused friction?" value={text} onChange={e => setText(e.target.value)} />
        <input className="fop-input" placeholder="Feature" value={feature} onChange={e => setFeature(e.target.value)} />
        <div className="fop-score-input">
          <label className="fop-label" style={{ marginBottom: 0 }}>Score: {score}</label>
          <input type="range" min="1" max="10" value={score} onChange={e => setScore(e.target.value)} className="fop-range" />
        </div>
      </div>
      <div className="fop-form-row" style={{ marginTop: 6 }}>
        <input className="fop-input" style={{ flex: 1 }} placeholder="Workaround (if any)" value={workaround} onChange={e => setWorkaround(e.target.value)} />
        <button className="fop-btn" onClick={submit}>Log Friction</button>
      </div>
      {msg && <div className="fop-msg">{msg}</div>}

      <div className="fop-list" style={{ marginTop: 16 }}>
        {list.length === 0 && <div className="fop-empty">No frictions logged today. Smooth sailing.</div>}
        {list.map((f, i) => (
          <div key={f.id} className="fop-friction-row">
            <div className="fop-friction-rank">#{i + 1}</div>
            <div className="fop-friction-score" style={{
              color: f.score >= 8 ? "#ef4444" : f.score >= 6 ? "#f59e0b" : "#22c55e"
            }}>{f.score}/10</div>
            <div style={{ flex: 1 }}>
              <div className="fop-friction-text">{f.text}</div>
              {f.workaround && <div className="fop-friction-workaround">↳ {f.workaround}</div>}
            </div>
            {f.feature && <span className="fop-chip fop-chip-sm">{f.feature}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel: Weekly Score ───────────────────────────────────────────────────────

function ScorePanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api("/fop/score/weekly").then(r => { if (r.ok) setData(r); });
  }, []);

  if (!data) return <div className="fop-loading">Loading…</div>;
  if (data.daysLogged === 0) return (
    <div className="fop-empty" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 32 }}>◇</div>
      <div>No journal entries yet. Start writing your daily journal to see the weekly product score.</div>
    </div>
  );

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Weekly Product Score</span>
        <span className="fop-chip">{data.daysLogged} days logged</span>
      </div>

      <div className="fop-score-row">
        <ScoreBadge value={data.score} label="Overall" />
        <div className="fop-score-signals">
          {Object.entries(data.signals || {}).map(([k, v]) => (
            <div key={k} className="fop-signal-row">
              <span className="fop-signal-name">{k.replace(/Score$/, "").replace(/([A-Z])/g, " $1").trim()}</span>
              <Bar value={v} />
              <span className="fop-signal-val">{v}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="fop-stats-grid" style={{ marginTop: 20 }}>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.avgMood || "–"}</div><div className="fop-stat-lbl">Avg Mood (1–5)</div></div>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.totalFrictions}</div><div className="fop-stat-lbl">Frictions</div></div>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.escapeCount}</div><div className="fop-stat-lbl">Escapes</div></div>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.openCrashes}</div><div className="fop-stat-lbl">Open Crashes</div></div>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.aiInteractions}</div><div className="fop-stat-lbl">AI Interactions</div></div>
        <div className="fop-stat-card"><div className="fop-stat-val">{data.aiHelpfulRate}%</div><div className="fop-stat-lbl">AI Helpful Rate</div></div>
      </div>

      <div className="fop-sub-title" style={{ marginTop: 20 }}>Daily Breakdown</div>
      <div className="fop-day-table">
        <div className="fop-day-thead">
          <span>Date</span><span>Mood</span><span>Frictions</span><span>AI</span><span>Narrative</span>
        </div>
        {(data.days || []).map(d => (
          <div key={d.date} className="fop-day-trow">
            <span>{d.date}</span>
            <span>{"★".repeat(d.mood || 0) || "–"}</span>
            <span>{d.frictions}{d.avgFriction ? ` (avg ${d.avgFriction})` : ""}</span>
            <span>{d.aiInteractions}</span>
            <span className="fop-narrative-preview">{d.narrative || "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel: Ship Recommendation ────────────────────────────────────────────────

function ShipPanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api("/fop/launch").then(r => { if (r.ok) setData(r); });
  }, []);

  if (!data) return <div className="fop-loading">Loading…</div>;

  const recColor = data.recommendation === "GO" ? "#22c55e" :
                   data.recommendation === "CONDITIONAL GO" ? "#f59e0b" : "#ef4444";

  return (
    <div>
      <div className="fop-section-header">
        <span className="fop-section-title">Launch Confidence & Ship Recommendation</span>
      </div>

      <div className="fop-ship-card" style={{ borderColor: recColor }}>
        <div className="fop-ship-rec" style={{ color: recColor }}>{data.recommendation}</div>
        <div className="fop-ship-confidence">
          <ScoreBadge value={data.confidence} label="Confidence" />
          <div style={{ flex: 1 }}>
            <div className="fop-ship-rationale">{data.rationale}</div>
            <div className="fop-ship-meta">
              <span>Days logged: {data.daysLogged}</span>
              <span>Weekly score: {data.weeklyScore}/100</span>
              <span>Open crashes: {data.openCrashes}</span>
              <span>High frictions: {data.highFrictions}</span>
              <span>Escapes: {data.totalEscapes}</span>
            </div>
          </div>
        </div>
      </div>

      {(data.blockers || []).length > 0 && (
        <>
          <div className="fop-sub-title">Blockers to Clear</div>
          <div className="fop-list">
            {data.blockers.map((b, i) => (
              <div key={i} className="fop-escape-row">
                <span className="fop-chip red fop-chip-sm">!</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(data.blockers || []).length === 0 && (
        <div className="fop-empty" style={{ padding: "20px 0", color: "#22c55e" }}>
          No blockers. Keep building.
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function FounderJournal() {
  const [tab, setTab] = useState("journal");

  const panels = {
    journal:  <JournalPanel  />,
    escapes:  <EscapePanel   />,
    crashes:  <CrashPanel    />,
    perf:     <PerfPanel     />,
    ai:       <AIPanel       />,
    credits:  <CreditsPanel  />,
    friction: <FrictionPanel />,
    score:    <ScorePanel    />,
    ship:     <ShipPanel     />,
  };

  return (
    <div className="fop-root">
      <div className="fop-header">
        <span className="fop-title">Founder Operating Program — FOP-1</span>
        <span className="fop-subtitle">Use Ooplix to build Ooplix · 14 consecutive days</span>
      </div>
      <div className="fop-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`fop-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      <div className="fop-content">
        {panels[tab]}
      </div>
    </div>
  );
}
