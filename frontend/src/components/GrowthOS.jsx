import React, { useState, useEffect, useCallback } from "react";
import "./GrowthOS.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api   = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const TABS = [
  { id: "dashboard",  label: "Dashboard",   icon: "◉" },
  { id: "email",      label: "Email",        icon: "✉" },
  { id: "sms",        label: "SMS",          icon: "◻" },
  { id: "whatsapp",   label: "WhatsApp",     icon: "⬡" },
  { id: "push",       label: "Push",         icon: "◈" },
  { id: "automation", label: "Automation",   icon: "⚡" },
  { id: "audience",   label: "Audience",     icon: "◇" },
  { id: "analytics",  label: "Analytics",    icon: "◎" },
  { id: "templates",  label: "Templates",    icon: "✦" },
  { id: "benchmark",  label: "Benchmark",    icon: "⬢" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function Chip({ children, color }) {
  return <span className={`gos-chip${color ? ` gos-chip-${color}` : ""}`}>{children}</span>;
}

function StatusDot({ status }) {
  const c = status === "sent" ? "green" : status === "draft" ? "gray" : status === "active" ? "green" : status === "scheduled" ? "yellow" : "gray";
  return <span className={`gos-dot gos-dot-${c}`} />;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="gos-stat-card" style={accent ? { borderTop: `2px solid ${accent}` } : {}}>
      <div className="gos-stat-val" style={accent ? { color: accent } : {}}>{value ?? "—"}</div>
      <div className="gos-stat-lbl">{label}</div>
      {sub && <div className="gos-stat-sub">{sub}</div>}
    </div>
  );
}

function Bar({ value, max = 100, color }) {
  const pct = Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0);
  const col = color || (pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#7c6af7");
  return (
    <div className="gos-bar-track">
      <div className="gos-bar-fill" style={{ width: `${pct}%`, background: col }} />
    </div>
  );
}

function Funnel({ stages }) {
  if (!stages?.length) return null;
  const max = stages[0]?.value || 1;
  return (
    <div className="gos-funnel">
      {stages.map((s, i) => (
        <div key={i} className="gos-funnel-row">
          <span className="gos-funnel-label">{s.stage}</span>
          <div className="gos-funnel-bar-wrap">
            <div className="gos-funnel-bar" style={{ width: `${Math.max(4, Math.round(s.value / max * 100))}%` }} />
          </div>
          <span className="gos-funnel-val">{(s.value || 0).toLocaleString()}</span>
          <span className="gos-funnel-pct">{s.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function useGrowth(path, deps = []) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api(path).then(r => r.ok !== false && setData(r)); }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return [data, load];
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const Toast = msg ? <span className="gos-toast">{msg}</span> : null;
  return [toast, Toast];
}

// ── MODULE 9: Dashboard ───────────────────────────────────────────────────────

function DashboardPanel() {
  const [dash, reload] = useGrowth("/growth/dashboard");

  if (!dash?.dashboard) return <div className="gos-loading">Loading dashboard…</div>;
  const d = dash.dashboard;
  const k = d.kpis || {};

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Growth Dashboard — Unified Marketing KPIs</span>
        <button className="gos-btn-sm" onClick={reload}>Refresh</button>
      </div>

      <div className="gos-stats-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))" }}>
        <StatCard label="Total Campaigns" value={k.totalCampaigns} accent="#22c55e" />
        <StatCard label="Total Reach"     value={(k.totalReach || 0).toLocaleString()} />
        <StatCard label="Revenue"         value={`₹${(k.totalRevenue || 0).toLocaleString()}`} accent="#7c6fff" />
        <StatCard label="Overall ROAS"    value={`${k.overallROAS}x`} accent="#4ecdc4" />
        <StatCard label="Audiences"       value={k.totalAudiences} sub={`${(k.totalMembers || 0).toLocaleString()} members`} />
        <StatCard label="Automations"     value={k.totalAutomations} sub={`${k.activeAutomations} active`} />
        <StatCard label="Templates"       value={k.totalTemplates} />
        <StatCard label="WA Flows"        value={k.waFlows} />
      </div>

      <div className="gos-channel-grid">
        {[
          { label: "Email",    ch: d.email,    icon: "✉", color: "#7c6fff", meta: `${d.email?.avgOpenRate}% open · ${d.email?.sequences} seq · ${d.email?.abTests} A/B` },
          { label: "SMS",      ch: d.sms,      icon: "◻", color: "#22c55e", meta: `${d.sms?.deliveryRate}% delivery · ${d.sms?.scheduled} scheduled` },
          { label: "WhatsApp", ch: d.whatsapp, icon: "⬡", color: "#4ecdc4", meta: `${d.whatsapp?.avgReadRate}% read · ${d.whatsapp?.totalLeads} leads · ${d.whatsapp?.flows} flows` },
          { label: "Push",     ch: d.push,     icon: "◈", color: "#f59e0b", meta: `${d.push?.avgClickRate}% CTR` },
        ].map(({ label, ch, icon, color, meta }) => (
          <div key={label} className="gos-channel-card" style={{ borderTop: `2px solid ${color}` }}>
            <div className="gos-channel-icon" style={{ color }}>{icon}</div>
            <div className="gos-channel-name">{label}</div>
            <div className="gos-channel-val" style={{ color }}>{(ch?.totalSent || 0).toLocaleString()} sent</div>
            <div className="gos-channel-meta">{meta}</div>
            <div className="gos-channel-count">{ch?.campaigns || 0} campaigns</div>
          </div>
        ))}
      </div>

      {(d.recentCampaigns || []).length > 0 && (
        <>
          <div className="gos-sub-title">Recent Campaigns</div>
          <div className="gos-list">
            {d.recentCampaigns.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <span className="gos-campaign-name">{c.name}</span>
                <Chip>{c.type}</Chip>
                <span className="gos-campaign-sent">{(c.sent || 0).toLocaleString()} sent</span>
                {c.revenue > 0 && <span className="gos-campaign-sent" style={{ color: "#4ecdc4" }}>₹{c.revenue.toLocaleString()}</span>}
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MODULE 1: Email Marketing OS ──────────────────────────────────────────────

function EmailPanel() {
  const [camps,   reloadCamps]  = useGrowth("/growth/email/campaigns");
  const [seqs,    reloadSeqs]   = useGrowth("/growth/email/sequences");
  const [tmpls]                 = useGrowth("/growth/templates?type=email");
  const [view,    setView]      = useState("campaigns");
  const [form,    setForm]      = useState({ name: "", subject: "", fromName: "Ooplix", fromEmail: "", abTest: false, variantB: null });
  const [seqForm, setSeqForm]   = useState({ name: "", description: "", triggerEvent: "contact_created" });
  const [toast,   Toast]        = useToast();

  const createCampaign = async () => {
    if (!form.name || !form.subject) return;
    const payload = { ...form };
    if (payload.abTest) payload.variantB = { subject: payload.variantBSubject || form.subject + " (B)" };
    delete payload.variantBSubject;
    await post("/growth/email/campaigns", payload);
    setForm({ name: "", subject: "", fromName: "Ooplix", fromEmail: "", abTest: false, variantB: null });
    toast("Campaign created");
    reloadCamps();
  };

  const send = async (id) => {
    await post(`/growth/email/campaigns/${id}/send`, {});
    toast("Campaign sent!");
    reloadCamps();
  };

  const createSeq = async () => {
    if (!seqForm.name) return;
    await post("/growth/email/sequences", { ...seqForm, steps: [] });
    setSeqForm({ name: "", description: "", triggerEvent: "contact_created" });
    toast("Sequence created");
    reloadSeqs();
  };

  const list    = camps?.campaigns || [];
  const seqList = seqs?.sequences  || [];
  const tplList = tmpls?.templates || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["campaigns","sequences","create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New" : v === "campaigns" ? `Campaigns (${list.length})` : `Sequences (${seqList.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "campaigns" && (
        <div>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total"    value={list.length} />
            <StatCard label="Sent"     value={list.filter(c => c.status === "sent").length} accent="#22c55e" />
            <StatCard label="Draft"    value={list.filter(c => c.status === "draft").length} />
            <StatCard label="Reach"    value={list.reduce((s,c)=>s+(c.stats?.sent||0),0).toLocaleString()} />
            <StatCard label="Opens"    value={list.reduce((s,c)=>s+(c.stats?.opened||0),0).toLocaleString()} />
            <StatCard label="A/B Tests" value={list.filter(c => c.abTest).length} accent="#7c6fff" />
          </div>
          <div className="gos-list">
            {list.length === 0 && <div className="gos-empty">No email campaigns yet. Create one to get started.</div>}
            {list.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="gos-campaign-name">{c.name}</div>
                  <div className="gos-campaign-meta">{c.subject}</div>
                </div>
                {c.abTest && <Chip color="purple">A/B</Chip>}
                {c.stats?.sent > 0 && (
                  <div className="gos-campaign-stats">
                    <span>{c.stats.sent.toLocaleString()} sent</span>
                    <span>{c.stats.opened} opened ({c.stats.sent ? (c.stats.opened/c.stats.sent*100).toFixed(0) : 0}%)</span>
                    <span>{c.stats.clicked} clicked</span>
                  </div>
                )}
                {c.variantBStats?.sent > 0 && (
                  <div className="gos-campaign-stats" style={{ color: "#7c6fff" }}>
                    <span>B: {c.variantBStats.sent} sent</span>
                    <span>{c.variantBStats.opened} opened ({c.variantBStats.sent ? (c.variantBStats.opened/c.variantBStats.sent*100).toFixed(0) : 0}%)</span>
                  </div>
                )}
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
                {c.status === "draft" && <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "sequences" && (
        <div>
          <div className="gos-list">
            {seqList.length === 0 && <div className="gos-empty">No sequences. Create a drip sequence to nurture leads automatically.</div>}
            {seqList.map(s => (
              <div key={s.id} className="gos-campaign-row">
                <StatusDot status={s.status} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{s.name}</div>
                  <div className="gos-campaign-meta">Trigger: {s.triggerEvent?.replace(/_/g," ")} · {s.steps?.length || 0} steps</div>
                </div>
                <div className="gos-campaign-stats">
                  <span>{s.stats?.enrolled || 0} enrolled</span>
                  <span>{s.stats?.completed || 0} completed</span>
                </div>
                <Chip color="green">{s.status}</Chip>
              </div>
            ))}
          </div>
          <div className="gos-form" style={{ marginTop: 16 }}>
            <div className="gos-form-title">New Drip Sequence</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Sequence name *" value={seqForm.name} onChange={e => setSeqForm(f => ({...f, name: e.target.value}))} />
              <select className="gos-select" value={seqForm.triggerEvent} onChange={e => setSeqForm(f => ({...f, triggerEvent: e.target.value}))}>
                {["contact_created","trial_started","form_submitted","purchase"].map(t => (
                  <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                ))}
              </select>
              <button className="gos-btn" onClick={createSeq}>Create</button>
            </div>
            <input className="gos-input" style={{ width: "100%", marginTop: 6 }} placeholder="Description" value={seqForm.description} onChange={e => setSeqForm(f => ({...f, description: e.target.value}))} />
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Email Campaign</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Campaign name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="gos-input" placeholder="Subject line *" value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="From name" value={form.fromName} onChange={e => setForm(f => ({...f, fromName: e.target.value}))} />
            <input className="gos-input" placeholder="From email" value={form.fromEmail} onChange={e => setForm(f => ({...f, fromEmail: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <select className="gos-select" value={form.templateId || ""} onChange={e => setForm(f => ({...f, templateId: e.target.value || null}))}>
              <option value="">— No template —</option>
              {tplList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <label className="gos-check-label" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={form.abTest || false} onChange={e => setForm(f => ({...f, abTest: e.target.checked}))} />
            Enable A/B Test
          </label>
          {form.abTest && (
            <input className="gos-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Variant B subject line" value={form.variantBSubject || ""} onChange={e => setForm(f => ({...f, variantBSubject: e.target.value}))} />
          )}
          <div className="gos-form-row">
            <button className="gos-btn" onClick={createCampaign}>Create Campaign</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 2: SMS Marketing OS ────────────────────────────────────────────────

function SMSPanel() {
  const [camps, reload]  = useGrowth("/growth/sms/campaigns");
  const [tmpls]          = useGrowth("/growth/templates?type=sms");
  const [form,  setForm] = useState({ name: "", body: "", senderId: "OOPLIX", bulk: true, unicode: false });
  const [otp,   setOtp]  = useState({ to: "" });
  const [sched, setSched] = useState({ id: "", scheduledAt: "" });
  const [view,  setView] = useState("campaigns");
  const [toast, Toast]   = useToast();

  const create = async () => {
    if (!form.name || !form.body) return;
    await post("/growth/sms/campaigns", form);
    setForm({ name: "", body: "", senderId: "OOPLIX", bulk: true, unicode: false });
    toast("Campaign created");
    reload();
  };

  const send = async (id) => {
    await post(`/growth/sms/campaigns/${id}/send`, {});
    toast("SMS campaign sent!");
    reload();
  };

  const schedule = async () => {
    if (!sched.id || !sched.scheduledAt) return;
    await post(`/growth/sms/campaigns/${sched.id}/schedule`, { scheduledAt: sched.scheduledAt });
    toast("Campaign scheduled");
    setSched({ id: "", scheduledAt: "" });
    reload();
  };

  const sendOTP = async () => {
    if (!otp.to) return;
    await post("/growth/sms/otp", otp);
    toast(`OTP sent to ${otp.to}`);
    setOtp({ to: "" });
  };

  const list    = camps?.campaigns || [];
  const tplList = tmpls?.templates || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["campaigns","otp","schedule","create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New" : v === "otp" ? "OTP" : v === "schedule" ? "Schedule" : `Campaigns (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "campaigns" && (
        <div>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total"     value={list.length} />
            <StatCard label="Sent"      value={list.filter(c => c.status === "sent").length} accent="#22c55e" />
            <StatCard label="Scheduled" value={list.filter(c => c.status === "scheduled").length} accent="#f59e0b" />
            <StatCard label="Total Sent" value={list.reduce((s,c)=>s+(c.stats?.sent||0),0).toLocaleString()} />
          </div>
          <div className="gos-list">
            {list.length === 0 && <div className="gos-empty">No SMS campaigns. Create one to start bulk SMS.</div>}
            {list.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="gos-campaign-name">{c.name}</div>
                  <div className="gos-campaign-meta">{c.body?.slice(0, 70)}{c.body?.length > 70 ? "…" : ""}</div>
                  {c.scheduledAt && c.status === "scheduled" && <div className="gos-campaign-meta" style={{ color: "#f59e0b" }}>Scheduled: {new Date(c.scheduledAt).toLocaleString()}</div>}
                </div>
                {c.bulk && <Chip>bulk</Chip>}
                {c.unicode && <Chip color="purple">unicode</Chip>}
                {c.stats?.sent > 0 && <span className="gos-campaign-sent">{c.stats.sent} sent · {c.stats.delivered} delivered</span>}
                <Chip color={c.status === "sent" ? "green" : c.status === "scheduled" ? "yellow" : "gray"}>{c.status}</Chip>
                {c.status === "draft" && (
                  <>
                    <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>
                    <button className="gos-btn-sm" onClick={() => setSched({ id: c.id, scheduledAt: sched.scheduledAt }) || setView("schedule")}>Schedule</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "otp" && (
        <div className="gos-form">
          <div className="gos-form-title">Send OTP</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Phone number (+91XXXXXXXXXX) *" value={otp.to} onChange={e => setOtp(o => ({...o, to: e.target.value}))} />
            <button className="gos-btn" onClick={sendOTP}>Send OTP</button>
          </div>
          <p className="gos-hint">Auto-generates a 6-digit code. Uses the OTP Message template.</p>
        </div>
      )}

      {view === "schedule" && (
        <div className="gos-form">
          <div className="gos-form-title">Schedule a Campaign</div>
          <div className="gos-form-row">
            <select className="gos-select" style={{ flex: 1 }} value={sched.id} onChange={e => setSched(s => ({...s, id: e.target.value}))}>
              <option value="">— Select campaign —</option>
              {list.filter(c => c.status === "draft").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="datetime-local" className="gos-input" value={sched.scheduledAt} onChange={e => setSched(s => ({...s, scheduledAt: e.target.value}))} />
            <button className="gos-btn" onClick={schedule}>Schedule</button>
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New SMS Campaign</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Campaign name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="gos-input" placeholder="Sender ID" style={{ width: 140, flex: "none" }} value={form.senderId} onChange={e => setForm(f => ({...f, senderId: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <select className="gos-select" value={form.templateId || ""} onChange={e => setForm(f => ({...f, templateId: e.target.value || null}))}>
              <option value="">— No template —</option>
              {tplList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <textarea className="gos-textarea" placeholder="SMS message body *" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
          <div className="gos-form-row">
            <span className="gos-hint">{form.body.length}/160 chars</span>
            <label className="gos-check-label">
              <input type="checkbox" checked={form.bulk} onChange={e => setForm(f => ({...f, bulk: e.target.checked}))} />
              Bulk
            </label>
            <label className="gos-check-label">
              <input type="checkbox" checked={form.unicode} onChange={e => setForm(f => ({...f, unicode: e.target.checked}))} />
              Unicode
            </label>
            <button className="gos-btn" onClick={create}>Create Campaign</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 3: WhatsApp Business OS ────────────────────────────────────────────

function WhatsAppPanel() {
  const [camps,  reload]  = useGrowth("/growth/whatsapp/campaigns");
  const [flows,  reloadF] = useGrowth("/growth/whatsapp/flows");
  const [rules,  reloadR] = useGrowth("/growth/whatsapp/auto-replies");
  const [form,   setForm] = useState({ name: "", body: "", flowId: null, leadQualification: false });
  const [flowForm, setFlowForm] = useState({ name: "", keyword: "", trigger: "keyword" });
  const [arForm, setArForm]    = useState({ keyword: "", reply: "", matchType: "exact" });
  const [view,   setView] = useState("broadcasts");
  const [toast,  Toast]  = useToast();

  const createBroadcast = async () => {
    if (!form.name || !form.body) return;
    await post("/growth/whatsapp/broadcasts", form);
    setForm({ name: "", body: "", flowId: null, leadQualification: false });
    toast("Broadcast created");
    reload();
  };

  const send = async (id) => {
    await post(`/growth/whatsapp/broadcasts/${id}/send`, {});
    toast("Broadcast sent!");
    reload();
  };

  const syncCRM = async (id) => {
    await post(`/growth/whatsapp/broadcasts/${id}/sync-crm`, {});
    toast("CRM synced");
  };

  const createFlow = async () => {
    if (!flowForm.name) return;
    await post("/growth/whatsapp/flows", { ...flowForm, steps: [{ type: "text", content: "Welcome! How can I help?" }] });
    setFlowForm({ name: "", keyword: "", trigger: "keyword" });
    toast("Flow created");
    reloadF();
  };

  const createAR = async () => {
    if (!arForm.keyword || !arForm.reply) return;
    await post("/growth/whatsapp/auto-replies", arForm);
    setArForm({ keyword: "", reply: "", matchType: "exact" });
    toast("Auto-reply rule created");
    reloadR();
  };

  const campList  = camps?.campaigns || [];
  const flowList  = flows?.flows     || [];
  const ruleList  = rules?.rules     || [];

  const WA_VIEWS = [
    { id: "broadcasts",  label: `Broadcasts (${campList.length})` },
    { id: "flows",       label: `Flows (${flowList.length})` },
    { id: "auto-replies",label: `Auto-replies (${ruleList.length})` },
    { id: "create",      label: "+ New Broadcast" },
  ];

  return (
    <div>
      <div className="gos-sub-tabs">
        {WA_VIEWS.map(v => (
          <button key={v.id} className={`gos-sub-tab${view === v.id ? " active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
        {Toast}
      </div>

      {view === "broadcasts" && (
        <div>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Broadcasts"  value={campList.length} />
            <StatCard label="Total Sent"  value={campList.reduce((s,c)=>s+(c.stats?.sent||0),0).toLocaleString()} />
            <StatCard label="Total Read"  value={campList.reduce((s,c)=>s+(c.stats?.read||0),0).toLocaleString()} accent="#4ecdc4" />
            <StatCard label="Leads Gen'd" value={campList.reduce((s,c)=>s+(c.stats?.leads||0),0).toLocaleString()} accent="#22c55e" />
          </div>
          <div className="gos-list">
            {campList.length === 0 && <div className="gos-empty">No WhatsApp broadcasts yet.</div>}
            {campList.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="gos-campaign-name">{c.name}</div>
                  <div className="gos-campaign-meta">{c.body?.slice(0, 60)}{c.body?.length > 60 ? "…" : ""}</div>
                </div>
                {c.stats?.sent > 0 && (
                  <div className="gos-campaign-stats">
                    <span>{c.stats.sent} sent</span>
                    <span style={{ color: "#4ecdc4" }}>{c.stats.read} read</span>
                    <span>{c.stats.replied} replied</span>
                    <span style={{ color: "#22c55e" }}>{c.stats.leads} leads</span>
                  </div>
                )}
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
                {c.status === "draft" && <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>}
                {c.status === "sent" && <button className="gos-btn-sm" onClick={() => syncCRM(c.id)}>Sync CRM</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "flows" && (
        <div>
          <div className="gos-list">
            {flowList.length === 0 && <div className="gos-empty">No WA flows. Create interactive conversation flows triggered by keywords.</div>}
            {flowList.map(f => (
              <div key={f.id} className="gos-campaign-row">
                <StatusDot status={f.active ? "active" : "draft"} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{f.name}</div>
                  <div className="gos-campaign-meta">Keyword: "{f.keyword}" · {f.steps?.length || 0} steps · {f.trigger}</div>
                </div>
                <div className="gos-campaign-stats">
                  <span>{f.stats?.initiated || 0} initiated</span>
                  <span>{f.stats?.completed || 0} completed</span>
                </div>
                <Chip color={f.active ? "green" : "gray"}>{f.active ? "active" : "paused"}</Chip>
              </div>
            ))}
          </div>
          <div className="gos-form" style={{ marginTop: 16 }}>
            <div className="gos-form-title">New WA Flow</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Flow name *" value={flowForm.name} onChange={e => setFlowForm(f => ({...f, name: e.target.value}))} />
              <input className="gos-input" placeholder='Trigger keyword (e.g. "START")' value={flowForm.keyword} onChange={e => setFlowForm(f => ({...f, keyword: e.target.value}))} />
              <select className="gos-select" value={flowForm.trigger} onChange={e => setFlowForm(f => ({...f, trigger: e.target.value}))}>
                <option value="keyword">Keyword</option>
                <option value="welcome">First Message</option>
                <option value="button">Button Click</option>
              </select>
              <button className="gos-btn" onClick={createFlow}>Create</button>
            </div>
          </div>
        </div>
      )}

      {view === "auto-replies" && (
        <div>
          <div className="gos-list">
            {ruleList.length === 0 && <div className="gos-empty">No auto-reply rules. Create keyword-triggered automatic responses.</div>}
            {ruleList.map(r => (
              <div key={r.id} className="gos-campaign-row">
                <StatusDot status={r.active ? "active" : "draft"} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">"{r.keyword}" → {r.matchType}</div>
                  <div className="gos-campaign-meta">{r.reply?.slice(0, 80)}</div>
                </div>
                <span className="gos-campaign-sent">{r.stats?.triggered || 0} triggered</span>
                <Chip color={r.active ? "green" : "gray"}>{r.active ? "active" : "off"}</Chip>
              </div>
            ))}
          </div>
          <div className="gos-form" style={{ marginTop: 16 }}>
            <div className="gos-form-title">New Auto-reply Rule</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder='Keyword (e.g. "HELP") *' value={arForm.keyword} onChange={e => setArForm(f => ({...f, keyword: e.target.value}))} />
              <select className="gos-select" value={arForm.matchType} onChange={e => setArForm(f => ({...f, matchType: e.target.value}))}>
                <option value="exact">Exact Match</option>
                <option value="contains">Contains</option>
                <option value="regex">Regex</option>
              </select>
            </div>
            <div className="gos-form-row">
              <input className="gos-input" style={{ flex: 1 }} placeholder="Reply text *" value={arForm.reply} onChange={e => setArForm(f => ({...f, reply: e.target.value}))} />
              <button className="gos-btn" onClick={createAR}>Create Rule</button>
            </div>
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New WhatsApp Broadcast</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Broadcast name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
          </div>
          <textarea className="gos-textarea" placeholder="Message body * — use *bold*, _italic_, 🎉 emojis freely" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
          <div className="gos-form-row" style={{ marginTop: 8 }}>
            <label className="gos-check-label">
              <input type="checkbox" checked={form.leadQualification || false} onChange={e => setForm(f => ({...f, leadQualification: e.target.checked}))} />
              Lead qualification flow
            </label>
            <label className="gos-check-label">
              <input type="checkbox" checked={form.flow || false} onChange={e => setForm(f => ({...f, flow: e.target.checked}))} />
              Interactive flow
            </label>
            <button className="gos-btn" onClick={createBroadcast}>Create Broadcast</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 4: Push Notification Center ───────────────────────────────────────

function PushPanel() {
  const [camps,    reload]  = useGrowth("/growth/push/campaigns");
  const [triggers, reloadT] = useGrowth("/growth/push/triggers");
  const [form,     setForm] = useState({ title: "", body: "", url: "" });
  const [tForm,    setTForm] = useState({ name: "", event: "page_visit", title: "", body: "" });
  const [view,     setView] = useState("send");
  const [toast,    Toast]  = useToast();

  const sendPush = async () => {
    if (!form.title || !form.body) return;
    await post("/growth/push/send", { ...form, trigger: "manual" });
    setForm({ title: "", body: "", url: "" });
    toast("Push notification sent!");
    reload();
  };

  const createTrigger = async () => {
    if (!tForm.name || !tForm.title || !tForm.body) return;
    await post("/growth/push/triggers", tForm);
    setTForm({ name: "", event: "page_visit", title: "", body: "" });
    toast("Trigger rule created");
    reloadT();
  };

  const list = camps?.campaigns    || [];
  const tlist = triggers?.rules    || [];

  const PUSH_EVENTS = ["page_visit","trial_started","purchase","inactivity_7d","inactivity_30d","tag_added","plan_upgraded"];

  return (
    <div>
      <div className="gos-push-platforms">
        {[
          { icon: "◉", label: "Desktop",       desc: "Electron app push notifications", color: "#7c6fff" },
          { icon: "◈", label: "Mobile-ready",  desc: "FCM-compatible payload structure", color: "#22c55e" },
          { icon: "⬡", label: "Browser",        desc: "Web Push API (service worker)", color: "#4ecdc4" },
          { icon: "⚡", label: "Auto Triggers",  desc: `${tlist.length} automation trigger rules`, color: "#f59e0b" },
        ].map(p => (
          <div key={p.label} className="gos-push-platform-card" style={{ borderTop: `2px solid ${p.color}` }}>
            <span className="gos-push-icon" style={{ color: p.color }}>{p.icon}</span>
            <div className="gos-push-label">{p.label}</div>
            <div className="gos-push-desc">{p.desc}</div>
          </div>
        ))}
      </div>

      <div className="gos-sub-tabs">
        {[
          { id: "send",     label: "Send Push" },
          { id: "triggers", label: `Trigger Rules (${tlist.length})` },
          { id: "history",  label: `History (${list.length})` },
        ].map(v => (
          <button key={v.id} className={`gos-sub-tab${view === v.id ? " active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
        {Toast}
      </div>

      {view === "send" && (
        <div className="gos-form">
          <div className="gos-form-title">Send Push Notification</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Title *" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} />
            <input className="gos-input" placeholder="Action URL" value={form.url} onChange={e => setForm(f => ({...f, url: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Message body *" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
            <button className="gos-btn" onClick={sendPush}>Send Push</button>
          </div>
        </div>
      )}

      {view === "triggers" && (
        <div>
          <div className="gos-list">
            {tlist.length === 0 && <div className="gos-empty">No trigger rules. Create event-based automatic push notifications.</div>}
            {tlist.map(t => (
              <div key={t.id} className="gos-campaign-row">
                <StatusDot status={t.active ? "active" : "draft"} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{t.name}</div>
                  <div className="gos-campaign-meta">On: {t.event?.replace(/_/g," ")} → "{t.template?.title}"</div>
                </div>
                <span className="gos-campaign-sent">{t.stats?.fired || 0} fired</span>
                <Chip color={t.active ? "green" : "gray"}>{t.active ? "active" : "paused"}</Chip>
              </div>
            ))}
          </div>
          <div className="gos-form" style={{ marginTop: 16 }}>
            <div className="gos-form-title">New Trigger Rule</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Rule name *" value={tForm.name} onChange={e => setTForm(f => ({...f, name: e.target.value}))} />
              <select className="gos-select" value={tForm.event} onChange={e => setTForm(f => ({...f, event: e.target.value}))}>
                {PUSH_EVENTS.map(ev => <option key={ev} value={ev}>{ev.replace(/_/g," ")}</option>)}
              </select>
            </div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Push title *" value={tForm.title} onChange={e => setTForm(f => ({...f, title: e.target.value}))} />
              <input className="gos-input" placeholder="Push body *" value={tForm.body} onChange={e => setTForm(f => ({...f, body: e.target.value}))} />
              <button className="gos-btn" onClick={createTrigger}>Create</button>
            </div>
          </div>
        </div>
      )}

      {view === "history" && (
        <div className="gos-list">
          {list.length === 0 && <div className="gos-empty">No push notifications sent yet.</div>}
          {[...list].reverse().slice(0, 20).map(c => (
            <div key={c.id} className="gos-campaign-row">
              <span className="gos-campaign-name">{c.title}</span>
              <span className="gos-campaign-meta">{c.body}</span>
              {c.stats && (
                <div className="gos-campaign-stats">
                  <span>{c.stats.sent} sent</span>
                  <span>{c.stats.clicked} clicked</span>
                  <span>{c.stats.dismissed} dismissed</span>
                </div>
              )}
              <Chip>{c.trigger}</Chip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MODULE 5: Marketing Automation Builder ────────────────────────────────────

const STEP_ICONS = { send_email: "✉", send_sms: "◻", send_whatsapp: "⬡", send_push: "◈", add_tag: "⊕", remove_tag: "⊖", wait: "⏳", condition: "◈", webhook: "↗", update_crm: "◉", add_to_audience: "◇", remove_from_audience: "◇", assign_owner: "◉" };

function AutomationPanel() {
  const [autos,  reload]   = useGrowth("/growth/automations");
  const [meta,   setMeta]  = useState(null);
  const [form,   setForm]  = useState({ name: "", triggerType: "contact_created", description: "" });
  const [steps,  setSteps] = useState([]);
  const [view,   setView]  = useState("list");
  const [toast,  Toast]    = useToast();

  useEffect(() => {
    api("/growth/automations/meta/triggers").then(r => r.ok !== false && setMeta(r));
  }, []);

  const addStep = (type) => setSteps(s => [...s, { type, config: {} }]);
  const removeStep = (i) => setSteps(s => s.filter((_, idx) => idx !== i));

  const create = async () => {
    if (!form.name) return;
    await post("/growth/automations", { name: form.name, description: form.description, trigger: { type: form.triggerType }, steps });
    setForm({ name: "", triggerType: "contact_created", description: "" });
    setSteps([]);
    toast("Automation created");
    reload();
  };

  const toggleStatus = async (a) => {
    await patch(`/growth/automations/${a.id}`, { status: a.status === "active" ? "paused" : "active" });
    reload();
  };

  const list = autos?.automations || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Flow" : `Flows (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="gos-list">
            {list.length === 0 && (
              <div className="gos-empty">
                <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
                No automation flows. Build your first to market on autopilot.
              </div>
            )}
            {list.map(a => (
              <div key={a.id} className="gos-campaign-row">
                <StatusDot status={a.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="gos-campaign-name">{a.name}</div>
                  <div className="gos-campaign-meta">
                    Trigger: {a.trigger?.type?.replace(/_/g," ")} · {a.steps?.length || 0} steps
                    {a.steps?.length > 0 && ` (${a.steps.map(s => STEP_ICONS[s.type] || "◈").join(" → ")})`}
                  </div>
                </div>
                <div className="gos-campaign-stats">
                  <span>{a.stats?.enrolled || 0} enrolled</span>
                  <span>{a.stats?.inProgress || 0} in progress</span>
                  <span>{a.stats?.completed || 0} done</span>
                </div>
                <Chip color={a.status === "active" ? "green" : "gray"}>{a.status}</Chip>
                <button className="gos-btn-sm" onClick={() => toggleStatus(a)}>
                  {a.status === "active" ? "Pause" : "Activate"}
                </button>
              </div>
            ))}
          </div>

          {meta && (
            <div style={{ marginTop: 16 }}>
              <div className="gos-sub-title">Available Triggers ({meta.triggers?.length})</div>
              <div className="gos-tag-cloud">{(meta.triggers || []).map(t => <Chip key={t}>{t.replace(/_/g," ")}</Chip>)}</div>
              <div className="gos-sub-title" style={{ marginTop: 8 }}>Available Actions ({meta.actions?.length})</div>
              <div className="gos-tag-cloud">{(meta.actions || []).map(a => <Chip key={a} color="purple">{a.replace(/_/g," ")}</Chip>)}</div>
            </div>
          )}
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Automation Flow</div>
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Flow name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="gos-input" style={{ flex: 1 }} placeholder="Description" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>Trigger when:</span>
            <select className="gos-select" style={{ flex: 1 }} value={form.triggerType} onChange={e => setForm(f => ({...f, triggerType: e.target.value}))}>
              {(meta?.triggers || []).map(t => <option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
            </select>
          </div>

          {/* Visual Step Builder */}
          <div className="gos-sub-title">Steps ({steps.length})</div>
          {steps.length === 0 && <div className="gos-empty" style={{ padding: "8px 0" }}>No steps. Add actions below.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {steps.map((s, i) => (
              <div key={i} className="gos-step-row">
                <span className="gos-step-icon">{STEP_ICONS[s.type] || "◈"}</span>
                <span className="gos-step-label">{s.type.replace(/_/g," ")}</span>
                {s.type === "wait" && (
                  <input className="gos-input" style={{ width: 80, flex: "none" }} type="number" min={1} placeholder="days" onChange={e => setSteps(st => st.map((step, idx) => idx === i ? {...step, config: {...step.config, days: +e.target.value}} : step))} />
                )}
                <button className="gos-step-remove" onClick={() => removeStep(i)}>✕</button>
              </div>
            ))}
          </div>
          <div className="gos-form-row" style={{ flexWrap: "wrap" }}>
            {(meta?.actions || []).map(a => (
              <button key={a} className="gos-chip-btn" onClick={() => addStep(a)}>+ {a.replace(/_/g," ")}</button>
            ))}
          </div>
          <div className="gos-form-row" style={{ marginTop: 12 }}>
            <button className="gos-btn" onClick={create}>Create Flow</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 6: Audience Manager ────────────────────────────────────────────────

function AudiencePanel() {
  const [auds,  reload]  = useGrowth("/growth/audiences");
  const [tags,  reloadT] = useGrowth("/growth/tags");
  const [form,  setForm] = useState({ name: "", type: "list", tags: "", syncFromCRM: false });
  const [tagForm, setTagForm] = useState({ name: "", color: "#7c6fff" });
  const [dynFilter, setDynFilter] = useState({ field: "source", op: "equals", value: "" });
  const [view,  setView] = useState("list");
  const [toast, Toast]   = useToast();

  const create = async () => {
    if (!form.name) return;
    const payload = {
      name: form.name,
      type: form.type,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      syncFromCRM: form.syncFromCRM,
    };
    if (form.type === "dynamic") {
      payload.filters = dynFilter.value ? [dynFilter] : [];
    }
    await post("/growth/audiences", payload);
    setForm({ name: "", type: "list", tags: "", syncFromCRM: false });
    toast("Audience created");
    reload();
  };

  const syncCRM = async (id) => {
    await post(`/growth/audiences/${id}/sync-crm`, {});
    toast("CRM contacts synced");
    reload();
  };

  const evaluate = async (id) => {
    await post(`/growth/audiences/${id}/evaluate`, {});
    toast("Dynamic audience refreshed");
    reload();
  };

  const createTag = async () => {
    if (!tagForm.name) return;
    await post("/growth/tags", tagForm);
    setTagForm({ name: "", color: "#7c6fff" });
    toast("Tag created");
    reloadT();
  };

  const list    = auds?.audiences || [];
  const tagList = tags?.tags      || [];

  const TYPE_COLOR = { list: "#22c55e", segment: "#7c6fff", dynamic: "#4ecdc4" };

  return (
    <div>
      <div className="gos-sub-tabs">
        {["list","tags","create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "list" ? `Audiences (${list.length})` : v === "tags" ? `Tags (${tagList.length})` : "+ New Audience"}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total"   value={list.length} />
            <StatCard label="Lists"    value={list.filter(a => a.type === "list").length} accent="#22c55e" />
            <StatCard label="Segments" value={list.filter(a => a.type === "segment").length} accent="#7c6fff" />
            <StatCard label="Dynamic"  value={list.filter(a => a.type === "dynamic").length} accent="#4ecdc4" />
            <StatCard label="Members" value={list.reduce((s,a)=>s+(a.memberCount||0),0).toLocaleString()} />
          </div>
          <div className="gos-list">
            {list.length === 0 && <div className="gos-empty">No audiences. Create a list, segment, or dynamic audience.</div>}
            {list.map(a => (
              <div key={a.id} className="gos-campaign-row">
                <Chip color={a.type === "list" ? "green" : a.type === "segment" ? "purple" : ""}>{a.type}</Chip>
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{a.name}</div>
                  {a.filters?.length > 0 && (
                    <div className="gos-campaign-meta">Filters: {a.filters.map(f => `${f.field} ${f.op} "${f.value}"`).join(" AND ")}</div>
                  )}
                  {a.tags?.length > 0 && (
                    <div className="gos-tag-cloud" style={{ marginTop: 2 }}>
                      {a.tags.map(t => <Chip key={t} color="purple">{t}</Chip>)}
                    </div>
                  )}
                </div>
                <span className="gos-campaign-sent">{(a.memberCount || 0).toLocaleString()} members</span>
                {a.syncFromCRM && <button className="gos-btn-sm" onClick={() => syncCRM(a.id)}>Sync CRM</button>}
                {a.type === "dynamic" && <button className="gos-btn-sm" onClick={() => evaluate(a.id)}>Refresh</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "tags" && (
        <div>
          <div className="gos-tag-cloud" style={{ marginBottom: 12 }}>
            {tagList.length === 0 && <div className="gos-empty">No tags yet. Create global contact tags for segmentation.</div>}
            {tagList.map(t => (
              <span key={t.id} className="gos-chip" style={{ background: t.color + "22", color: t.color, border: `1px solid ${t.color}44` }}>
                {t.name}
              </span>
            ))}
          </div>
          <div className="gos-form">
            <div className="gos-form-title">New Tag</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Tag name *" value={tagForm.name} onChange={e => setTagForm(f => ({...f, name: e.target.value}))} />
              <input type="color" value={tagForm.color} onChange={e => setTagForm(f => ({...f, color: e.target.value}))} style={{ width: 40, height: 32, border: "1px solid #2a2a3a", borderRadius: 4, background: "none", cursor: "pointer", padding: 2 }} />
              <button className="gos-btn" onClick={createTag}>Create Tag</button>
            </div>
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Audience</div>
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="gos-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              <option value="list">List — manual membership</option>
              <option value="segment">Segment — filtered snapshot</option>
              <option value="dynamic">Dynamic — auto-refreshes from CRM</option>
            </select>
          </div>
          {form.type === "dynamic" && (
            <div className="gos-form-row">
              <select className="gos-select" value={dynFilter.field} onChange={e => setDynFilter(f => ({...f, field: e.target.value}))}>
                {["source","status","tags","city","plan"].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <select className="gos-select" value={dynFilter.op} onChange={e => setDynFilter(f => ({...f, op: e.target.value}))}>
                <option value="equals">equals</option>
                <option value="contains">contains</option>
                <option value="starts_with">starts with</option>
                <option value="not_empty">not empty</option>
              </select>
              <input className="gos-input" placeholder="Value" value={dynFilter.value} onChange={e => setDynFilter(f => ({...f, value: e.target.value}))} />
            </div>
          )}
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))} />
            <label className="gos-check-label">
              <input type="checkbox" checked={form.syncFromCRM || false} onChange={e => setForm(f => ({...f, syncFromCRM: e.target.checked}))} />
              Sync from CRM
            </label>
            <button className="gos-btn" onClick={create}>Create</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 7: Campaign Analytics ──────────────────────────────────────────────

function AnalyticsPanel() {
  const [data,    reload]    = useGrowth("/growth/analytics");
  const [campId,  setCampId] = useState("");
  const [campAna, setCampAna] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookupCampaign = async () => {
    if (!campId.trim()) return;
    setLoading(true);
    const r = await api(`/growth/analytics/${campId.trim()}`);
    if (r.ok !== false) setCampAna(r.analytics);
    setLoading(false);
  };

  const overall  = data?.analytics;
  const byType   = overall?.byType || {};

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Campaign Analytics</span>
        <button className="gos-btn-sm" onClick={reload}>Refresh</button>
      </div>

      {overall && (
        <>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total Sent"    value={(overall.totalSent     || 0).toLocaleString()} />
            <StatCard label="Total Conversions" value={(overall.totalConverted || 0).toLocaleString()} accent="#22c55e" />
            <StatCard label="Total Revenue" value={`₹${(overall.totalRevenue  || 0).toLocaleString()}`} accent="#7c6fff" />
            <StatCard label="Overall ROAS"  value={`${overall.overallROAS}x`} accent="#4ecdc4" />
          </div>

          <div className="gos-sub-title">By Channel</div>
          <div className="gos-list">
            {Object.entries(byType).map(([type, s]) => (
              <div key={type} className="gos-campaign-row">
                <Chip>{type}</Chip>
                <div style={{ flex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span className="gos-campaign-meta">{s.count} campaigns</span>
                  <span className="gos-campaign-meta">{(s.sent || 0).toLocaleString()} sent</span>
                  {s.opened  > 0 && <span className="gos-campaign-meta">{s.opened} opened ({s.sent ? (s.opened/s.sent*100).toFixed(1) : 0}%)</span>}
                  {s.clicked > 0 && <span className="gos-campaign-meta">{s.clicked} clicked</span>}
                  {s.converted > 0 && <span className="gos-campaign-meta" style={{ color: "#22c55e" }}>{s.converted} conv.</span>}
                  {s.revenue > 0 && <span className="gos-campaign-meta" style={{ color: "#7c6fff" }}>₹{s.revenue.toLocaleString()}</span>}
                </div>
                <Bar value={s.sent} max={overall?.totalSent || 1} />
              </div>
            ))}
            {Object.keys(byType).length === 0 && <div className="gos-empty">Send campaigns to see analytics.</div>}
          </div>

          {(overall.topCampaigns || []).length > 0 && (
            <>
              <div className="gos-sub-title" style={{ marginTop: 16 }}>Revenue Attribution — Top Campaigns</div>
              <div className="gos-list">
                {overall.topCampaigns.map(c => (
                  <div key={c.id} className="gos-campaign-row">
                    <Chip>{c.type}</Chip>
                    <span className="gos-campaign-name">{c.name}</span>
                    <span className="gos-campaign-sent" style={{ color: "#7c6fff" }}>₹{c.revenue.toLocaleString()}</span>
                    <Chip color="purple">ROAS {c.roas}x</Chip>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="gos-sub-title" style={{ marginTop: 20 }}>Campaign Deep-Dive</div>
      <div className="gos-form-row">
        <input className="gos-input" placeholder="Campaign ID" value={campId} onChange={e => setCampId(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupCampaign()} />
        <button className="gos-btn-sm" onClick={lookupCampaign} disabled={loading}>{loading ? "…" : "Look up"}</button>
      </div>
      {campAna && (
        <div className="gos-form" style={{ marginTop: 10 }}>
          <div className="gos-form-title">{campAna.name} ({campAna.type}){campAna.abTest ? " — A/B Test" : ""}</div>
          <div className="gos-stats-grid">
            <StatCard label="Sent"        value={campAna.sent.toLocaleString()} />
            <StatCard label="Delivered"   value={campAna.delivered.toLocaleString()} />
            <StatCard label="Open Rate"   value={`${campAna.openRate}%`}   accent="#22c55e" />
            <StatCard label="Click Rate"  value={`${campAna.clickRate}%`}  accent="#7c6fff" />
            <StatCard label="Conv. Rate"  value={`${campAna.conversionRate}%`} accent="#4ecdc4" />
            <StatCard label="Revenue"     value={`₹${campAna.revenue.toLocaleString()}`} accent="#f59e0b" />
            <StatCard label="ROAS"        value={`${campAna.roas}x`} accent="#7c6fff" />
          </div>
          {campAna.abTest && campAna.variantBStats && (
            <div className="gos-stats-grid" style={{ marginTop: 8 }}>
              <StatCard label="Variant B Sent"   value={campAna.variantBStats.sent} />
              <StatCard label="Variant B Opens"  value={campAna.variantBStats.opened} accent="#7c6fff" />
              <StatCard label="Variant B Clicks" value={campAna.variantBStats.clicked} />
            </div>
          )}
          <div className="gos-sub-title">Conversion Funnel</div>
          <Funnel stages={campAna.funnel} />
        </div>
      )}
    </div>
  );
}

// ── MODULE 8: Template Marketplace ────────────────────────────────────────────

function TemplatesPanel() {
  const [templates, reload] = useGrowth("/growth/templates");
  const [filter,    setFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [form,      setForm]   = useState({ name: "", type: "email", category: "Custom", subject: "", body: "", variables: "" });
  const [view,      setView]   = useState("marketplace");
  const [selected,  setSelected] = useState(null);
  const [toast,     Toast]     = useToast();

  const create = async () => {
    if (!form.name || !form.body) return;
    const payload = { ...form, variables: form.variables.split(",").map(v => v.trim()).filter(Boolean) };
    await post("/growth/templates", payload);
    setForm({ name: "", type: "email", category: "Custom", subject: "", body: "", variables: "" });
    toast("Template created");
    reload();
  };

  const list = (templates?.templates || [])
    .filter(t => filter === "all" || t.type === filter)
    .filter(t => catFilter === "all" || t.category === catFilter);

  const allCats = [...new Set((templates?.templates || []).map(t => t.category))].filter(Boolean).sort();

  return (
    <div>
      <div className="gos-sub-tabs">
        {["marketplace","create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Template" : `Marketplace (${templates?.count || 0})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "marketplace" && (
        <div>
          <div className="gos-filter-row">
            {["all","email","sms","whatsapp","push"].map(f => (
              <button key={f} className={`gos-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <select className="gos-select" style={{ marginLeft: "auto" }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="all">All categories</option>
              {allCats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="gos-hint">{list.length} templates</span>
          </div>

          <div className="gos-template-grid">
            {list.map(t => (
              <div key={t.id}
                className={`gos-template-card${selected?.id === t.id ? " selected" : ""}`}
                onClick={() => setSelected(selected?.id === t.id ? null : t)}
              >
                <div className="gos-tpl-header">
                  <Chip>{t.type}</Chip>
                  {t.builtin ? <Chip color="green">built-in</Chip> : <Chip color="purple">custom</Chip>}
                </div>
                <div className="gos-tpl-name">{t.name}</div>
                <div className="gos-tpl-category">{t.category}</div>
                {t.subject && <div className="gos-tpl-subject">Subj: {t.subject}</div>}
                <div className="gos-tpl-body">{t.body?.slice(0, 80)}{t.body?.length > 80 ? "…" : ""}</div>
                {t.variables?.length > 0 && (
                  <div className="gos-tag-cloud" style={{ marginTop: 6 }}>
                    {t.variables.map(v => <Chip key={v} color="purple">&#x7B;&#x7B;{v}&#x7D;&#x7D;</Chip>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selected && (
            <div className="gos-tpl-preview">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="gos-form-title">{selected.name}</div>
                <button className="gos-btn-sm" onClick={() => setSelected(null)}>✕</button>
              </div>
              {selected.subject && <div className="gos-tpl-preview-subject">Subject: {selected.subject}</div>}
              <pre className="gos-tpl-preview-body">{selected.body}</pre>
              {selected.variables?.length > 0 && (
                <>
                  <div className="gos-sub-title">Variables</div>
                  <div className="gos-tag-cloud">
                    {selected.variables.map(v => <Chip key={v} color="purple">&#x7B;&#x7B;{v}&#x7D;&#x7D;</Chip>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Template</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="gos-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="push">Push</option>
            </select>
            <input className="gos-input" placeholder="Category" value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} />
          </div>
          {form.type === "email" && (
            <input className="gos-input" placeholder="Subject line" style={{ width: "100%", marginBottom: 8 }} value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} />
          )}
          <textarea className="gos-textarea" placeholder="Template body * — use {{firstName}}, {{product}}, {{cta_url}} as variables" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} style={{ minHeight: 120 }} />
          <div className="gos-form-row" style={{ marginTop: 8 }}>
            <input className="gos-input" style={{ flex: 1 }} placeholder="Variables (comma separated): firstName,product,cta_url" value={form.variables} onChange={e => setForm(f => ({...f, variables: e.target.value}))} />
          </div>
          <div className="gos-form-row">
            <button className="gos-btn" onClick={create}>Create Template</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

function BenchmarkPanel() {
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/growth/benchmark");
    if (r.ok !== false) setResult(r);
    setRunning(false);
  };

  const READINESS_COLOR = { production_ready: "#22c55e", nearly_ready: "#f59e0b", needs_work: "#ef4444" };

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Commercial Benchmark — G1 Marketing Infrastructure</span>
        <button className="gos-btn" onClick={run} disabled={running}>{running ? "Running…" : "Run Benchmark"}</button>
      </div>
      <p className="gos-hint">Validates all 10 G1 modules: email + A/B + sequences, SMS + OTP + schedule, WhatsApp + flows + auto-reply, push + triggers, automation builder (13 triggers / 13 actions), audience manager (list/segment/dynamic/tags), analytics (funnel/ROAS/revenue attribution), template marketplace (18+ built-in), growth dashboard, commercial readiness.</p>

      {result && (
        <>
          <div className="gos-stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Score"     value={`${result.score}%`}              accent={READINESS_COLOR[result.marketingReadiness]} />
            <StatCard label="Passed"    value={`${result.passing}/${result.total}`} accent="#22c55e" />
            <StatCard label="Readiness" value={result.marketingReadiness?.replace(/_/g," ")} accent={READINESS_COLOR[result.marketingReadiness]} />
            <StatCard label="Regression" value={result.regressionPass ? "PASS" : "FAIL"} accent={result.regressionPass ? "#22c55e" : "#ef4444"} />
          </div>

          <div className="gos-list">
            {(result.checks || []).map(c => (
              <div key={c.id} className={`gos-campaign-row ${c.ok ? "" : "gos-row-fail"}`}>
                <span style={{ color: c.ok ? "#22c55e" : "#ef4444", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{c.ok ? "✓" : "✗"}</span>
                <span className="gos-campaign-name">{c.label}</span>
                {c.error && <span className="gos-campaign-meta" style={{ color: "#ef4444" }}>{c.error}</span>}
                <Chip color={c.ok ? "green" : "red"}>{c.ok ? "pass" : "fail"}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function GrowthOS() {
  const [tab, setTab] = useState("dashboard");

  const panels = {
    dashboard:  <DashboardPanel  />,
    email:      <EmailPanel      />,
    sms:        <SMSPanel        />,
    whatsapp:   <WhatsAppPanel   />,
    push:       <PushPanel       />,
    automation: <AutomationPanel />,
    audience:   <AudiencePanel   />,
    analytics:  <AnalyticsPanel  />,
    templates:  <TemplatesPanel  />,
    benchmark:  <BenchmarkPanel  />,
  };

  return (
    <div className="gos-root">
      <div className="gos-header">
        <span className="gos-title">Growth OS — G1</span>
        <span className="gos-subtitle">Marketing Infrastructure · Email · SMS · WhatsApp · Push · Automation · Audience · Analytics · Templates</span>
      </div>
      <div className="gos-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`gos-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="gos-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="gos-content">
        {panels[tab]}
      </div>
    </div>
  );
}
