// CO3 First User Success Program — UserSuccess.jsx
import React, { useState, useCallback, useEffect } from "react";
import "./UserSuccess.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());

function useUS(path, deps = []) {
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
  const el = msg ? <span className="us-toast">{msg}</span> : null;
  return [toast, el];
}

const sc = (s) => s >= 90 ? "var(--us-green)" : s >= 70 ? "var(--us-teal)" : s >= 50 ? "var(--us-yellow)" : "var(--us-red)";
function Chip({ label, type = "gray" }) { return <span className={`us-chip us-chip-${type}`}>{label}</span>; }
function ScoreBar({ label, score }) {
  const c = sc(score ?? 0);
  return (
    <div className="us-score-row">
      <span className="us-score-label">{label}</span>
      <div className="us-score-track"><div className="us-score-fill" style={{ width: `${score ?? 0}%`, background: c }} /></div>
      <span className="us-score-val" style={{ color: c }}>{score ?? "–"}%</span>
    </div>
  );
}

// ── M1: Invitations ────────────────────────────────────────────────────────────
function InvitesPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/invites", []);
  const [form, setForm]  = useState({ tier: "alpha", maxUses: 1, note: "" });
  const [wlForm, setWlForm] = useState({ email: "", name: "", company: "", useCase: "" });

  const createCode = async () => {
    await api("/co3/invites/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    reload(); toast("Invite code created");
  };

  const bulkCreate = async (count) => {
    await api("/co3/invites/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, tier: form.tier }),
    });
    reload(); toast(`${count} codes created`);
  };

  const addWaitlist = async () => {
    if (!wlForm.email) return toast("Email required");
    await api("/co3/waitlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wlForm),
    });
    setWlForm({ email: "", name: "", company: "", useCase: "" });
    reload(); toast("Added to waitlist");
  };

  const approveWL = async (id) => {
    await api(`/co3/waitlist/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved", approvedAt: new Date().toISOString() }),
    });
    reload(); toast("Waitlist entry approved");
  };

  if (loading) return <div className="us-loading">Loading invitations…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading invitations</div>;

  const tierColor = { alpha: "purple", beta: "cyan", vip: "yellow", standard: "gray" };

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">User Invitation System</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-accent)" }}>{data.totalCodes}</div><div className="us-stat-lbl">Total Codes</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-green)" }}>{data.totalActivations}</div><div className="us-stat-lbl">Activations</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{data.waitlistTotal}</div><div className="us-stat-lbl">Waitlist</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-yellow)" }}>{data.waitlistPending}</div><div className="us-stat-lbl">Pending</div></div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Create Invite Code</div>
        <div className="us-form-row">
          <span className="us-label">Tier</span>
          <select className="us-select" value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}>
            {(data.INVITE_TIERS || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="us-label">Max Uses</span>
          <input className="us-input" type="number" min="1" max="100" value={form.maxUses}
            onChange={e => setForm(f => ({ ...f, maxUses: Number(e.target.value) }))} style={{ width: 60 }} />
          <input className="us-input" placeholder="Note…" value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          <button className="us-btn" onClick={createCode}>Create</button>
          <button className="us-btn-sm" onClick={() => bulkCreate(10)}>Bulk ×10</button>
          <button className="us-btn-sm" onClick={() => bulkCreate(50)}>Bulk ×50</button>
        </div>
      </div>
      <div className="us-card">
        <div className="us-card-title">Invite Codes ({data.totalCodes})</div>
        <div className="us-list">
          {data.inviteCodes?.length === 0 && <div className="us-empty">No invite codes yet</div>}
          {(data.inviteCodes || []).map(c => (
            <div key={c.code} className={`us-row ${c.uses > 0 ? "us-row-pass" : ""}`}>
              <div className="us-row-body">
                <div className="us-row-name" style={{ fontFamily: "monospace", letterSpacing: 2 }}>{c.code}</div>
                <div className="us-row-meta">{c.note || "—"} · expires: {c.expiresAt ? c.expiresAt.slice(0,10) : "never"}</div>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <Chip label={c.tier} type={tierColor[c.tier] || "gray"} />
                <Chip label={`${c.uses}/${c.maxUses}`} type={c.uses >= c.maxUses ? "red" : "green"} />
                <Chip label={c.status} type={c.status === "active" ? "teal" : "gray"} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Add to Waitlist</div>
        <div className="us-form-row">
          <input className="us-input" type="email" placeholder="Email…" value={wlForm.email} onChange={e => setWlForm(f => ({ ...f, email: e.target.value }))} />
          <input className="us-input" placeholder="Name…" value={wlForm.name} onChange={e => setWlForm(f => ({ ...f, name: e.target.value }))} />
          <input className="us-input" placeholder="Company…" value={wlForm.company} onChange={e => setWlForm(f => ({ ...f, company: e.target.value }))} />
          <button className="us-btn" onClick={addWaitlist}>Add</button>
        </div>
      </div>
      {data.waitlist?.length > 0 && (
        <div className="us-card">
          <div className="us-card-title">Waitlist ({data.waitlistTotal})</div>
          <div className="us-list">
            {data.waitlist.map(w => (
              <div key={w.id} className={`us-row ${w.status === "approved" ? "us-row-pass" : ""}`}>
                <div className="us-row-body">
                  <div className="us-row-name">#{w.position} {w.name} <span style={{ color: "var(--us-muted)", fontWeight: 400 }}>{w.email}</span></div>
                  <div className="us-row-meta">{w.company} · {w.useCase}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Chip label={w.status} type={w.status === "approved" ? "green" : w.status === "activated" ? "teal" : "gray"} />
                  {w.status === "pending" && (
                    <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => approveWL(w.id)}>Approve</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── M2: Feedback ───────────────────────────────────────────────────────────────
function FeedbackPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/feedback", []);
  const [form, setForm]  = useState({ type: "bug", title: "", severity: "medium", module: "", body: "" });
  const [filter, setFilter] = useState("all");

  const submit = async () => {
    if (!form.title) return toast("Title required");
    await api("/co3/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, screenshot: null }),
    });
    setForm({ type: "bug", title: "", severity: "medium", module: "", body: "" });
    reload(); toast("Feedback submitted");
  };

  const resolve = async (id) => {
    await api(`/co3/feedback/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    reload(); toast("Marked resolved");
  };

  if (loading) return <div className="us-loading">Loading feedback…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading feedback</div>;

  const typeColor = { bug: "red", feature: "blue", crash: "red", ux: "yellow", performance: "orange", question: "gray" };
  const sevColor  = { critical: "red", high: "red", medium: "yellow", low: "gray" };
  const items = (data.items || []).filter(i => filter === "all" || i.type === filter || i.status === filter);

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">In-App Feedback</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.total}</div><div className="us-stat-lbl">Total</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.open > 0 ? "var(--us-yellow)" : "var(--us-green)" }}>{data.open}</div><div className="us-stat-lbl">Open</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-teal)" }}>{data.withScreenshot}</div><div className="us-stat-lbl">w/ Screenshot</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-blue)" }}>{data.withVideo}</div><div className="us-stat-lbl">w/ Video</div></div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Submit Feedback</div>
        <div className="us-form-row">
          <select className="us-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {(data.FEEDBACK_TYPES || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="us-select" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
            {(data.FEEDBACK_SEVERITY || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="us-input" placeholder="Module…" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} style={{ maxWidth: 120 }} />
        </div>
        <div className="us-form-row">
          <input className="us-input" placeholder="Title…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <button className="us-btn" onClick={submit}>Submit</button>
        </div>
        <textarea className="us-textarea" placeholder="Description, steps to reproduce, expected vs actual…" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
      </div>
      <div className="us-tag-row" style={{ marginBottom: 8 }}>
        {["all", "bug", "feature", "crash", "open", "resolved"].map(f => (
          <button key={f} className={`us-btn-sm ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="us-list">
        {items.length === 0 && <div className="us-empty">No feedback items</div>}
        {items.map(i => (
          <div key={i.id} className={`us-row ${i.status === "resolved" || i.status === "shipped" ? "us-row-pass" : i.status === "open" ? "" : "us-row-warn"}`}>
            <div className="us-row-body">
              <div className="us-row-name">{i.title}</div>
              <div className="us-row-meta">{i.module} · {i.createdAt?.slice(0,10)}</div>
              {i.body && <div className="us-row-meta" style={{ marginTop: 2 }}>{i.body.slice(0, 80)}{i.body.length > 80 ? "…" : ""}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 3 }}>
                <Chip label={i.type}     type={typeColor[i.type] || "gray"} />
                <Chip label={i.severity} type={sevColor[i.severity] || "gray"} />
                <Chip label={i.status}   type={i.status === "resolved" ? "green" : "gray"} />
              </div>
              {(i.screenshot || i.videoRef) && (
                <div style={{ display: "flex", gap: 3 }}>
                  {i.screenshot && <Chip label="📷 Screenshot" type="teal" />}
                  {i.videoRef   && <Chip label="▶ Video"       type="blue" />}
                </div>
              )}
              {i.status === "open" && (
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => resolve(i.id)}>Resolve</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M3: Analytics ──────────────────────────────────────────────────────────────
function AnalyticsPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/analytics", []);
  const [evForm, setEvForm] = useState({ type: "feature_use", feature: "ai_chat", stage: "", duration: "" });

  const trackEv = async () => {
    await api("/co3/analytics/event", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...evForm, duration: evForm.duration ? Number(evForm.duration) : null }),
    });
    reload(); toast("Event tracked");
  };

  if (loading) return <div className="us-loading">Loading analytics…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading analytics</div>;

  const funnel  = data.funnel?.stages || [];
  const replays = data.sessionReplays?.sessions || [];
  const adoption = data.featureAdoption || {};
  const topFeatures = Object.entries(adoption).sort((a, b) => (b[1].uses || 0) - (a[1].uses || 0)).slice(0, 5);

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Analytics</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.sessionReplays?.totalEvents || 0}</div><div className="us-stat-lbl">Total Events</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{replays.length}</div><div className="us-stat-lbl">Sessions</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{topFeatures.length}</div><div className="us-stat-lbl">Features Tracked</div></div>
      </div>
      <div className="us-card">
        <div className="us-card-title">Activation Funnel</div>
        <div className="us-funnel">
          {funnel.map((s, i) => {
            const prev = i === 0 ? 100 : funnel[i-1]?.count || 1;
            const pct  = Math.min(100, prev > 0 ? Math.round((s.count / Math.max(s.count, prev)) * 100) : 0);
            return (
              <div key={s.id} className="us-funnel-stage">
                <div className="us-funnel-label">{s.label}</div>
                <div className="us-funnel-bar-wrap"><div className="us-funnel-bar" style={{ width: `${pct}%` }} /></div>
                <div className="us-funnel-count">{s.count}</div>
                <div className="us-funnel-pct">{s.conversionPct}%</div>
              </div>
            );
          })}
        </div>
      </div>
      {topFeatures.length > 0 && (
        <div className="us-card">
          <div className="us-card-title">Feature Adoption (Top 5)</div>
          {topFeatures.map(([f, v]) => (
            <ScoreBar key={f} label={f.replace(/_/g, " ")} score={Math.min(100, v.uses * 10)} />
          ))}
        </div>
      )}
      {replays.length > 0 && (
        <div className="us-card">
          <div className="us-card-title">Session Replay Hooks</div>
          <div className="us-list">
            {replays.map((s, i) => (
              <div key={i} className="us-row">
                <div className="us-row-body">
                  <div className="us-row-name">Account: {s.accountId}</div>
                  <div className="us-row-meta">{s.eventCount} events · {s.firstEvent?.slice(0,10)}</div>
                </div>
                <div className="us-tag-row">{(s.features || []).map(f => <Chip key={f} label={f} type="cyan" />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="us-form">
        <div className="us-form-title">Track Event</div>
        <div className="us-form-row">
          <input className="us-input" placeholder="Event type…" value={evForm.type} onChange={e => setEvForm(f => ({ ...f, type: e.target.value }))} />
          <select className="us-select" value={evForm.feature} onChange={e => setEvForm(f => ({ ...f, feature: e.target.value }))}>
            <option value="">No feature</option>
            {(data.FEATURE_LIST || []).map(feat => <option key={feat} value={feat}>{feat}</option>)}
          </select>
          <input className="us-input" placeholder="Duration (s)…" value={evForm.duration} onChange={e => setEvForm(f => ({ ...f, duration: e.target.value }))} style={{ width: 80 }} />
          <button className="us-btn" onClick={trackEv}>Track</button>
        </div>
      </div>
    </div>
  );
}

// ── M4: Customer Success Inbox ─────────────────────────────────────────────────
function CSInboxPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/cs", []);
  const [selected, setSelected] = useState(null);
  const [reply, setReply]   = useState("");
  const [form, setForm]     = useState({ userEmail: "", subject: "", body: "", priority: "normal", channel: "in_app" });
  const [filter, setFilter] = useState("all");

  const createTicket = async () => {
    if (!form.subject) return toast("Subject required");
    await api("/co3/cs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ userEmail: "", subject: "", body: "", priority: "normal", channel: "in_app" });
    reload(); toast("Ticket created");
  };

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    await api(`/co3/cs/${selected.id}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply, role: "support" }),
    });
    setReply("");
    reload();
    toast("Reply sent");
  };

  const closeTicket = async (id) => {
    await api(`/co3/cs/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    reload(); toast("Ticket resolved");
  };

  if (loading) return <div className="us-loading">Loading CS inbox…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading CS inbox</div>;

  const priColor = { urgent: "red", high: "red", normal: "blue", low: "gray" };
  const tickets  = (data.tickets || []).filter(t => filter === "all" || t.status === filter);

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Customer Success Inbox</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.total}</div><div className="us-stat-lbl">Total</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.open > 0 ? "var(--us-yellow)" : "var(--us-green)" }}>{data.open}</div><div className="us-stat-lbl">Open</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.slaBreach > 0 ? "var(--us-red)" : "var(--us-green)" }}>{data.slaBreach}</div><div className="us-stat-lbl">SLA Breach</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{data.avgResolutionHrs ?? "–"}h</div><div className="us-stat-lbl">Avg Resolve</div></div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Create Support Ticket</div>
        <div className="us-form-row">
          <input className="us-input" type="email" placeholder="User email…" value={form.userEmail} onChange={e => setForm(f => ({ ...f, userEmail: e.target.value }))} />
          <select className="us-select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            {(data.CS_TICKET_PRIORITY || []).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="us-select" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            {(data.CS_CHANNELS || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="us-form-row">
          <input className="us-input" placeholder="Subject…" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          <button className="us-btn" onClick={createTicket}>Create</button>
        </div>
        <textarea className="us-textarea" placeholder="Issue description…" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
      </div>
      <div className="us-tag-row" style={{ marginBottom: 8 }}>
        {["all", "open", "in_progress", "resolved"].map(f => (
          <button key={f} className={`us-btn-sm ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 10 }}>
        <div className="us-list">
          {tickets.length === 0 && <div className="us-empty">No tickets</div>}
          {tickets.map(t => (
            <div key={t.id} className={`us-row ${t.status === "resolved" ? "us-row-pass" : t.status === "open" ? "" : "us-row-warn"}`}
              style={{ cursor: "pointer" }} onClick={() => setSelected(t)}>
              <div className="us-row-body">
                <div className="us-row-name">{t.subject}</div>
                <div className="us-row-meta">{t.userEmail} · {t.createdAt?.slice(0,10)}</div>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                <Chip label={t.priority} type={priColor[t.priority] || "gray"} />
                <Chip label={t.status}   type={t.status === "resolved" ? "green" : "gray"} />
              </div>
            </div>
          ))}
        </div>
        {selected && (
          <div className="us-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ font: "700 12px/1 sans-serif" }}>{selected.subject}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="us-btn-sm" onClick={() => closeTicket(selected.id)}>Resolve</button>
                <button className="us-btn-sm" onClick={() => setSelected(null)}>×</button>
              </div>
            </div>
            <div className="us-thread">
              {(selected.thread || []).map((m, i) => (
                <div key={i} className={`us-msg us-msg-${m.role === "user" ? "user" : "support"}`}>
                  <div className="us-msg-body">{m.body}</div>
                  <div className="us-msg-meta">{m.role} · {m.ts?.slice(0,16)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input className="us-input" placeholder="Reply…" value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendReply()} />
              <button className="us-btn" onClick={sendReply}>Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── M5: Knowledge Base ─────────────────────────────────────────────────────────
function KnowledgeBasePanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/kb", []);
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({ type: "article", category: "features", title: "", body: "", videoUrl: "" });

  const search = async () => {
    const r = await api(`/co3/kb/search?q=${encodeURIComponent(q)}`);
    setSearchResults(r.results || []);
    toast(`${r.count} results`);
  };

  const createArticle = async () => {
    if (!form.title) return toast("Title required");
    await api("/co3/kb", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ type: "article", category: "features", title: "", body: "", videoUrl: "" });
    reload(); toast("Article created");
  };

  const rate = async (id, helpful) => {
    await api(`/co3/kb/${id}/rate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helpful }),
    });
    reload(); toast(helpful ? "Marked helpful" : "Marked not helpful");
  };

  if (loading) return <div className="us-loading">Loading knowledge base…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading knowledge base</div>;

  const typeColor = { article: "blue", faq: "teal", tutorial: "purple", video: "yellow" };
  const articles  = searchResults || data.articles || [];

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Knowledge Base</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.total}</div><div className="us-stat-lbl">Total</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-green)" }}>{data.published}</div><div className="us-stat-lbl">Published</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-yellow)" }}>{data.videoCount}</div><div className="us-stat-lbl">Videos</div></div>
      </div>
      <div className="us-form">
        <div className="us-form-row">
          <input className="us-input" placeholder="Search KB…" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()} />
          <button className="us-btn" onClick={search}>Search</button>
          {searchResults && <button className="us-btn-sm" onClick={() => setSearchResults(null)}>Clear</button>}
        </div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Create Article</div>
        <div className="us-form-row">
          <select className="us-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {(data.KB_TYPES || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="us-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {(data.KB_CATEGORIES || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="us-input" placeholder="Video URL (optional)…" value={form.videoUrl}
            onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))} />
          <button className="us-btn" onClick={createArticle}>Create</button>
        </div>
        <div className="us-form-row">
          <input className="us-input" placeholder="Title…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <textarea className="us-textarea" placeholder="Article body (markdown supported)…" value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))} style={{ minHeight: 80 }} />
      </div>
      <div className="us-list">
        {articles.length === 0 && <div className="us-empty">No articles</div>}
        {articles.map(a => (
          <div key={a.id} className="us-row">
            <div className="us-row-body">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div className="us-row-name">{a.title}</div>
                <Chip label={a.type}     type={typeColor[a.type] || "gray"} />
                <Chip label={a.category} type="gray" />
              </div>
              <div className="us-row-meta">{a.views} views · {a.helpful}👍 {a.notHelpful}👎</div>
              {expanded === a.id && a.body && (
                <div className="us-article-body" style={{ marginTop: 8 }}>{a.body}</div>
              )}
              {a.videoUrl && <div className="us-row-meta" style={{ color: "var(--us-yellow)" }}>▶ {a.videoUrl}</div>}
              <button className="us-expand-btn" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                {expanded === a.id ? "▲ Collapse" : "▼ Read article"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <Chip label={a.published ? "Published" : "Draft"} type={a.published ? "green" : "gray"} />
              <div style={{ display: "flex", gap: 3 }}>
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => rate(a.id, true)}>👍</button>
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => rate(a.id, false)}>👎</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M6: Release Management ─────────────────────────────────────────────────────
function ReleasesPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/releases", []);
  const [form, setForm] = useState({ strategy: "patch", notes: "", migration: "", breaking: "" });

  const bump = async () => {
    await api("/co3/releases/bump", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: form.strategy }),
    });
    reload(); toast(`Version bumped (${form.strategy})`);
  };

  const createRelease = async () => {
    if (!form.notes) return toast("Release notes required");
    await api("/co3/releases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes:     form.notes,
        migration: form.migration ? form.migration.split("\n").filter(Boolean) : [],
        breaking:  form.breaking  ? form.breaking.split("\n").filter(Boolean)  : [],
      }),
    });
    setForm({ strategy: "patch", notes: "", migration: "", breaking: "" });
    reload(); toast("Release created");
  };

  if (loading) return <div className="us-loading">Loading releases…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading releases</div>;

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Release Management</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-card">
        <div className="us-card-title">Current Version</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "var(--us-accent)", marginBottom: 8 }}>
          v{data.current?.version}
        </div>
        <div className="us-kv-row"><span className="us-kv-key">Previous</span><span className="us-kv-val">{data.current?.previous || "—"}</span></div>
        <div className="us-kv-row"><span className="us-kv-key">Created</span><span className="us-kv-val">{data.current?.createdAt?.slice(0,10)}</span></div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Bump Version</div>
        <div className="us-form-row">
          {(data.BUMP_STRATEGIES || []).map(s => (
            <button key={s} className={`us-btn-sm ${form.strategy === s ? "active" : ""}`} onClick={() => setForm(f => ({ ...f, strategy: s }))}>{s}</button>
          ))}
          <button className="us-btn" onClick={bump}>Bump</button>
        </div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Create Release</div>
        <textarea className="us-textarea" placeholder="Release notes…" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ minHeight: 50 }} />
        <textarea className="us-textarea" placeholder="Migration notes (one per line, optional)…" value={form.migration}
          onChange={e => setForm(f => ({ ...f, migration: e.target.value }))} style={{ minHeight: 40, marginTop: 6 }} />
        <textarea className="us-textarea" placeholder="Breaking changes (one per line, optional)…" value={form.breaking}
          onChange={e => setForm(f => ({ ...f, breaking: e.target.value }))} style={{ minHeight: 40, marginTop: 6 }} />
        <button className="us-btn" style={{ marginTop: 8 }} onClick={createRelease}>Create Release</button>
      </div>
      <div className="us-card">
        <div className="us-card-title">Release History ({data.releases?.length || 0})</div>
        <div className="us-list">
          {(data.releases || []).map(r => (
            <div key={r.id} className="us-row">
              <div className="us-row-body">
                <div className="us-row-name">v{r.version || r.release?.version} <span style={{ color: "var(--us-muted)", fontWeight: 400 }}>{r.createdAt?.slice(0,10)}</span></div>
                <div className="us-row-meta">{r.notes?.slice(0, 80)}{r.notes?.length > 80 ? "…" : ""}</div>
                {r.migration?.length > 0 && <Chip label={`${r.migration.length} migration steps`} type="yellow" />}
                {r.breaking?.length  > 0 && <Chip label={`${r.breaking.length} breaking changes`}  type="red"    />}
              </div>
            </div>
          ))}
          {(!data.releases || data.releases.length === 0) && <div className="us-empty">No releases yet</div>}
        </div>
      </div>
    </div>
  );
}

// ── M7: Crash Intelligence ─────────────────────────────────────────────────────
function CrashPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/crashes", []);
  const [form, setForm] = useState({ type: "js_error", error: "", stack: "", module: "", impact: "minor" });

  const report = async () => {
    if (!form.error) return toast("Error message required");
    await api("/co3/crashes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ type: "js_error", error: "", stack: "", module: "", impact: "minor" });
    reload(); toast("Crash reported");
  };

  const markResolved = async (fp) => {
    await api(`/co3/crashes/${encodeURIComponent(fp)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    reload(); toast("Marked resolved");
  };

  if (loading) return <div className="us-loading">Loading crash intelligence…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading crashes</div>;

  const impactColor = { critical: "red", degraded: "yellow", minor: "gray" };

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Crash Intelligence</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.total}</div><div className="us-stat-lbl">Groups</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.open > 0 ? "var(--us-yellow)" : "var(--us-green)" }}>{data.open}</div><div className="us-stat-lbl">Open</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.critical > 0 ? "var(--us-red)" : "var(--us-green)" }}>{data.critical}</div><div className="us-stat-lbl">Critical</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.regressions > 0 ? "var(--us-orange)" : "var(--us-green)" }}>{data.regressions}</div><div className="us-stat-lbl">Regressions</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{data.totalAffectedUsers}</div><div className="us-stat-lbl">Affected Users</div></div>
      </div>
      <div className="us-form">
        <div className="us-form-title">Report Crash</div>
        <div className="us-form-row">
          <select className="us-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {(data.CRASH_TYPES || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="us-select" value={form.impact} onChange={e => setForm(f => ({ ...f, impact: e.target.value }))}>
            {(data.CRASH_IMPACTS || []).map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <input className="us-input" placeholder="Module…" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} style={{ maxWidth: 120 }} />
          <button className="us-btn" onClick={report}>Report</button>
        </div>
        <div className="us-form-row">
          <input className="us-input" placeholder="Error message…" value={form.error} onChange={e => setForm(f => ({ ...f, error: e.target.value }))} />
        </div>
        <textarea className="us-textarea" placeholder="Stack trace (optional)…" value={form.stack} onChange={e => setForm(f => ({ ...f, stack: e.target.value }))} style={{ minHeight: 50 }} />
      </div>
      <div className="us-list">
        {(data.groups || []).length === 0 && <div className="us-empty">No crashes reported</div>}
        {(data.groups || []).map(g => (
          <div key={g.fingerprint} className={`us-row ${g.status === "resolved" ? "us-row-pass" : g.impact === "critical" ? "us-row-fail" : ""}`}>
            <div className="us-row-body">
              <div className="us-row-name">{g.title.slice(0, 80)}</div>
              <div className="us-row-meta">{g.module} · first: {g.firstSeenAt?.slice(0,10)} · last: {g.lastOccurredAt?.slice(0,10)}</div>
              {g.isRegression && <Chip label="REGRESSION" type="orange" />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 3 }}>
                <Chip label={`${g.occurrences}×`}        type="gray" />
                <Chip label={`${g.affectedUsers?.length || 0} users`} type="blue" />
                <Chip label={g.impact}  type={impactColor[g.impact] || "gray"} />
              </div>
              <Chip label={g.status}    type={g.status === "resolved" ? "green" : "gray"} />
              {g.status !== "resolved" && (
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => markResolved(g.fingerprint)}>Resolve</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M8: Usage Insights ─────────────────────────────────────────────────────────
function UsageInsightsPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/usage", []);

  const takeSnap = async () => {
    await api("/co3/usage/snapshot", { method: "POST" });
    reload(); toast("Snapshot taken");
  };

  if (loading) return <div className="us-loading">Loading usage insights…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading usage insights</div>;

  const latest = data.latest;

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Usage Insights</div>
        {toastEl}
        <button className="us-btn" onClick={takeSnap}>Take Snapshot</button>
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      {latest && (
        <>
          <div className="us-stats-grid">
            <div className="us-stat-card"><div className="us-stat-val">{latest.totalEvents}</div><div className="us-stat-lbl">Total Events</div></div>
            <div className="us-stat-card"><div className="us-stat-val">{latest.uniqueAccounts}</div><div className="us-stat-lbl">Unique Users</div></div>
            <div className="us-stat-card"><div className="us-stat-val">{latest.avgTimeToValueMin ?? "–"}</div><div className="us-stat-lbl">TTV (min)</div></div>
            <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-muted)", fontSize: 11 }}>{latest.date}</div><div className="us-stat-lbl">Snapshot Date</div></div>
          </div>
          {latest.mostUsed?.length > 0 && (
            <div className="us-card">
              <div className="us-card-title">Most Used Features</div>
              {latest.mostUsed.map(({ feature, count }) => (
                <div key={feature} className="us-kv-row">
                  <span className="us-kv-key">{feature.replace(/_/g, " ")}</span>
                  <span className="us-kv-val">{count} uses</span>
                </div>
              ))}
            </div>
          )}
          {latest.leastUsed?.length > 0 && (
            <div className="us-card">
              <div className="us-card-title">Least Used Features</div>
              {latest.leastUsed.map(({ feature, count }) => (
                <div key={feature} className="us-kv-row">
                  <span className="us-kv-key">{feature.replace(/_/g, " ")}</span>
                  <span className="us-kv-val" style={{ color: "var(--us-muted)" }}>{count} uses</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {!latest && <div className="us-empty">No snapshots yet. Click "Take Snapshot" to capture current usage.</div>}
      {(data.snapshots || []).length > 1 && (
        <div className="us-card">
          <div className="us-card-title">Snapshot History ({data.snapshots.length} snapshots)</div>
          {data.snapshots.slice(-7).reverse().map(s => (
            <div key={s.id} className="us-kv-row">
              <span className="us-kv-key">{s.date}</span>
              <span className="us-kv-val">{s.totalEvents} events · {s.uniqueAccounts} users</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M9: Beta Operations Center ─────────────────────────────────────────────────
function BetaOpsPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useUS("/co3/beta", []);
  const [form, setForm] = useState({ email: "", name: "", cohort: "alpha_10", notes: "" });
  const [filter, setFilter] = useState("all");

  const addUser = async () => {
    if (!form.email) return toast("Email required");
    await api("/co3/beta/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ email: "", name: "", cohort: "alpha_10", notes: "" });
    reload(); toast("Beta user added");
  };

  const updateStatus = async (id, status) => {
    const update = { status };
    if (status === "onboarded") update.onboardedAt  = new Date().toISOString();
    if (status === "active")    update.lastActiveAt  = new Date().toISOString();
    await api(`/co3/beta/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    reload(); toast(`Status → ${status}`);
  };

  if (loading) return <div className="us-loading">Loading beta ops…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading beta ops</div>;

  const cohortColor = { alpha_10: "purple", beta_50: "cyan", beta_100: "blue" };
  const statusColor = { invited: "gray", onboarded: "teal", active: "green", churned: "red", converted: "yellow" };
  const users = (data.users || []).filter(u => filter === "all" || u.cohort === filter || u.status === filter);

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Beta Operations Center</div>
        {toastEl}
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val">{data.total}</div><div className="us-stat-lbl">Total</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-green)" }}>{data.active}</div><div className="us-stat-lbl">Active</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-teal)" }}>{data.onboarded}</div><div className="us-stat-lbl">Onboarded</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.churned > 0 ? "var(--us-red)" : "var(--us-muted)" }}>{data.churned}</div><div className="us-stat-lbl">Churned</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-yellow)" }}>{data.avgNPS ?? "–"}</div><div className="us-stat-lbl">Avg NPS</div></div>
      </div>
      <div className="us-card">
        <div className="us-card-title">Cohort Capacity</div>
        {Object.entries(data.capacity || {}).map(([cohort, cap]) => (
          <div key={cohort} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: "var(--us-muted)", textTransform: "uppercase" }}>{cohort.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{cap.current}/{cap.limit} <span style={{ color: "var(--us-muted)", fontWeight: 400 }}>({cap.available} available)</span></span>
            </div>
            <div className="us-prog-bar"><div className="us-prog-fill" style={{ width: `${Math.min(100, cap.current / cap.limit * 100)}%`, background: sc(100 - cap.current / cap.limit * 100) }} /></div>
          </div>
        ))}
      </div>
      <div className="us-form">
        <div className="us-form-title">Add Beta User</div>
        <div className="us-form-row">
          <input className="us-input" type="email" placeholder="Email…" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className="us-input" placeholder="Name…" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ maxWidth: 140 }} />
          <select className="us-select" value={form.cohort} onChange={e => setForm(f => ({ ...f, cohort: e.target.value }))}>
            {(data.BETA_COHORTS || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="us-btn" onClick={addUser}>Add</button>
        </div>
      </div>
      <div className="us-tag-row" style={{ marginBottom: 8 }}>
        {["all", "alpha_10", "beta_50", "beta_100", "active", "churned"].map(f => (
          <button key={f} className={`us-btn-sm ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="us-list">
        {users.length === 0 && <div className="us-empty">No beta users</div>}
        {users.map(u => (
          <div key={u.id} className={`us-row ${u.status === "active" || u.status === "converted" ? "us-row-pass" : u.status === "churned" ? "us-row-fail" : ""}`}>
            <div className="us-row-body">
              <div className="us-row-name">{u.name} <span style={{ color: "var(--us-muted)", fontWeight: 400 }}>{u.email}</span></div>
              <div className="us-row-meta">Invited {u.invitedAt?.slice(0,10)} · {u.notes}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 3 }}>
                <Chip label={u.cohort}  type={cohortColor[u.cohort] || "gray"} />
                <Chip label={u.status}  type={statusColor[u.status] || "gray"} />
              </div>
              {u.status === "invited" && (
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => updateStatus(u.id, "onboarded")}>Mark Onboarded</button>
              )}
              {u.status === "onboarded" && (
                <button className="us-btn-sm" style={{ fontSize: 9 }} onClick={() => updateStatus(u.id, "active")}>Mark Active</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M10: Launch Benchmark ──────────────────────────────────────────────────────
function LaunchBenchmarkPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    api("/co3/benchmark").then(r => { setResult(r); setLoading(false); });
  };

  useEffect(() => { run(); }, []);

  const criteriaColor = (score) => score >= 80 ? "green" : score >= 50 ? "yellow" : "red";

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">Launch Benchmark</div>
        <button className="us-btn" onClick={run} disabled={loading}>{loading ? "Running…" : "Run Benchmark"}</button>
      </div>
      {loading && <div className="us-loading">Testing 10 CO3 success modules…</div>}
      {result && !loading && (
        <>
          <div className="us-stats-grid">
            <div className="us-stat-card"><div className="us-stat-val" style={{ color: sc(result.score) }}>{result.score}%</div><div className="us-stat-lbl">Score</div></div>
            <div className="us-stat-card"><div className="us-stat-val">{result.passing}/{result.total}</div><div className="us-stat-lbl">Passing</div></div>
            <div className="us-stat-card"><div className="us-stat-val" style={{ color: result.regressionPass ? "var(--us-green)" : "var(--us-red)" }}>{result.regressionPass ? "PASS" : "FAIL"}</div><div className="us-stat-lbl">Regression</div></div>
          </div>
          <div className="us-card">
            <div className="us-card-title">CO3 Module Health</div>
            <div className="us-list">
              {(result.checks || []).map((c, i) => (
                <div key={c.id} className={`us-row ${c.ok ? "us-row-pass" : "us-row-fail"}`}>
                  <div className="us-row-body">
                    <div className="us-row-name">M{i+1}. {c.label}</div>
                    {c.error && <div className="us-row-meta" style={{ color: "var(--us-red)" }}>Error: {c.error}</div>}
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

// ── Executive ──────────────────────────────────────────────────────────────────
function ExecutivePanel() {
  const { data, loading, reload } = useUS("/co3/executive", []);
  if (loading) return <div className="us-loading">Loading CO3 executive view…</div>;
  if (!data?.ok) return <div className="us-loading">Error loading executive view</div>;

  const modules = [
    { label: "Invites",    score: Math.min(100, (data.invite?.totalActivations || 0) * 10 + (data.invite?.totalCodes > 0 ? 50 : 0)), sub: `${data.invite?.totalActivations || 0} activations` },
    { label: "Feedback",   score: 100, sub: `${data.feedback?.total || 0} items, ${data.feedback?.open || 0} open` },
    { label: "Analytics",  score: 100, sub: "Events + funnels tracked" },
    { label: "CS Inbox",   score: data.cs?.slaBreach > 0 ? 70 : 100, sub: `${data.cs?.open || 0} open tickets` },
    { label: "KB",         score: Math.min(100, (data.kb?.published || 0) * 12), sub: `${data.kb?.published || 0} articles` },
    { label: "Crashes",    score: data.crash?.critical > 0 ? 30 : data.crash?.open > 0 ? 70 : 100, sub: `${data.crash?.critical || 0} critical` },
  ];

  return (
    <div>
      <div className="us-section-hdr">
        <div className="us-section-title">CO3 Executive — First User Success</div>
        <button className="us-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="us-overall">
        <div className="us-overall-score" style={{ color: sc(data.overall || 0) }}>{data.overall || 0}%</div>
        <div className="us-overall-meta">
          <div className="us-overall-grade">First User Success Program</div>
          <div className="us-overall-sub">v{data.release?.version} · {new Date(data.checkedAt).toLocaleString()}</div>
        </div>
      </div>
      <div className="us-exec-grid">
        {modules.map(m => (
          <div key={m.label} className="us-exec-card">
            <div className="us-exec-val" style={{ color: sc(m.score) }}>{m.score}%</div>
            <div className="us-exec-label">{m.label}</div>
            <div className="us-exec-sub">{m.sub}</div>
          </div>
        ))}
      </div>
      <div className="us-stats-grid">
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: "var(--us-accent)" }}>{data.invite?.totalCodes || 0}</div><div className="us-stat-lbl">Invite Codes</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{data.kb?.published || 0}</div><div className="us-stat-lbl">KB Articles</div></div>
        <div className="us-stat-card"><div className="us-stat-val">{data.kb?.videoCount || 0}</div><div className="us-stat-lbl">Video Tutorials</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.cs?.slaBreach > 0 ? "var(--us-red)" : "var(--us-green)" }}>{data.cs?.slaBreach || 0}</div><div className="us-stat-lbl">SLA Breaches</div></div>
        <div className="us-stat-card"><div className="us-stat-val" style={{ color: data.crash?.regressions > 0 ? "var(--us-orange)" : "var(--us-green)" }}>{data.crash?.regressions || 0}</div><div className="us-stat-lbl">Regressions</div></div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "executive",  label: "Overview",      icon: "◎" },
  { id: "invites",    label: "Invitations",   icon: "◈" },
  { id: "feedback",   label: "Feedback",      icon: "◇" },
  { id: "analytics",  label: "Analytics",     icon: "⊞" },
  { id: "cs",         label: "CS Inbox",      icon: "◉" },
  { id: "kb",         label: "Knowledge",     icon: "✦" },
  { id: "releases",   label: "Releases",      icon: "▷" },
  { id: "crashes",    label: "Crashes",       icon: "⬢" },
  { id: "usage",      label: "Usage",         icon: "◇" },
  { id: "beta",       label: "Beta Ops",      icon: "⬡" },
  { id: "benchmark",  label: "Benchmark",     icon: "⚡" },
];

const PANELS = {
  executive:  <ExecutivePanel />,
  invites:    <InvitesPanel />,
  feedback:   <FeedbackPanel />,
  analytics:  <AnalyticsPanel />,
  cs:         <CSInboxPanel />,
  kb:         <KnowledgeBasePanel />,
  releases:   <ReleasesPanel />,
  crashes:    <CrashPanel />,
  usage:      <UsageInsightsPanel />,
  beta:       <BetaOpsPanel />,
  benchmark:  <LaunchBenchmarkPanel />,
};

export default function UserSuccess() {
  const [tab, setTab] = useState("executive");
  return (
    <div className="us-root">
      <div className="us-header">
        <span className="us-title">User Success</span>
        <span className="us-subtitle">CO3 · First User Success Program</span>
      </div>
      <div className="us-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`us-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="us-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      <div className="us-content">{PANELS[tab] || null}</div>
    </div>
  );
}
