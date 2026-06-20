import React, { useState, useEffect, useCallback } from "react";
import "./GrowthOS.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const TABS = [
  { id: "dashboard",   label: "Dashboard",   icon: "◉" },
  { id: "email",       label: "Email",        icon: "✉" },
  { id: "sms",         label: "SMS",          icon: "◻" },
  { id: "whatsapp",    label: "WhatsApp",     icon: "⬡" },
  { id: "push",        label: "Push",         icon: "◈" },
  { id: "automation",  label: "Automation",   icon: "⚡" },
  { id: "audience",    label: "Audience",     icon: "◇" },
  { id: "analytics",   label: "Analytics",    icon: "◎" },
  { id: "templates",   label: "Templates",    icon: "✦" },
  { id: "benchmark",   label: "Benchmark",    icon: "⬢" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function Chip({ children, color }) {
  return <span className={`gos-chip${color ? ` gos-chip-${color}` : ""}`}>{children}</span>;
}

function StatusDot({ status }) {
  const c = status === "sent" ? "green" : status === "draft" ? "gray" : status === "active" ? "green" : "yellow";
  return <span className={`gos-dot gos-dot-${c}`} />;
}

function StatCard({ label, value, sub }) {
  return (
    <div className="gos-stat-card">
      <div className="gos-stat-val">{value}</div>
      <div className="gos-stat-lbl">{label}</div>
      {sub && <div className="gos-stat-sub">{sub}</div>}
    </div>
  );
}

function Bar({ value, max = 100 }) {
  const pct = Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0);
  const col = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#7c6af7";
  return (
    <div className="gos-bar-track">
      <div className="gos-bar-fill" style={{ width: `${pct}%`, background: col }} />
    </div>
  );
}

function useGrowth(path, deps = []) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api(path).then(r => r.ok !== false && setData(r)); }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return [data, load];
}

// ── MODULE 9: Dashboard (shown first) ────────────────────────────────────────

function DashboardPanel() {
  const [dash, reload] = useGrowth("/growth/dashboard");

  if (!dash?.dashboard) return <div className="gos-loading">Loading dashboard…</div>;
  const d = dash.dashboard;
  const k = d.kpis || {};

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Growth Dashboard</span>
        <button className="gos-btn-sm" onClick={reload}>Refresh</button>
      </div>

      <div className="gos-stats-grid">
        <StatCard label="Campaigns"    value={k.totalCampaigns}   />
        <StatCard label="Total Reach"  value={(k.totalReach || 0).toLocaleString()} />
        <StatCard label="Revenue"      value={`₹${(k.totalRevenue || 0).toLocaleString()}`} />
        <StatCard label="Audiences"    value={k.totalAudiences}   />
        <StatCard label="Automations"  value={k.totalAutomations} sub={`${k.activeAutomations} active`} />
        <StatCard label="Templates"    value={k.totalTemplates}   />
      </div>

      <div className="gos-channel-grid">
        {[
          { label: "Email",     ch: d.email,     icon: "✉", meta: `${d.email?.avgOpenRate}% open · ${d.email?.sequences} sequences` },
          { label: "SMS",       ch: d.sms,        icon: "◻", meta: `${d.sms?.deliveryRate}% delivery` },
          { label: "WhatsApp",  ch: d.whatsapp,   icon: "⬡", meta: `${d.whatsapp?.avgReadRate}% read rate` },
          { label: "Push",      ch: d.push,       icon: "◈", meta: "desktop + mobile-ready" },
        ].map(({ label, ch, icon, meta }) => (
          <div key={label} className="gos-channel-card">
            <div className="gos-channel-icon">{icon}</div>
            <div className="gos-channel-name">{label}</div>
            <div className="gos-channel-val">{(ch?.totalSent || 0).toLocaleString()} sent</div>
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
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MODULE 1: Email ───────────────────────────────────────────────────────────

function EmailPanel() {
  const [camps,  reloadCamps]  = useGrowth("/growth/email/campaigns");
  const [seqs,   reloadSeqs]   = useGrowth("/growth/email/sequences");
  const [view,   setView]      = useState("campaigns");
  const [form,   setForm]      = useState({ name: "", subject: "", fromName: "Ooplix", fromEmail: "" });
  const [seqForm,setSeqForm]   = useState({ name: "", description: "" });
  const [msg,    setMsg]       = useState("");

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const createCampaign = async () => {
    if (!form.name || !form.subject) return;
    await post("/growth/email/campaigns", form);
    setForm({ name: "", subject: "", fromName: "Ooplix", fromEmail: "" });
    notify("Campaign created");
    reloadCamps();
  };

  const send = async (id) => {
    await post(`/growth/email/campaigns/${id}/send`, {});
    notify("Campaign sent!");
    reloadCamps();
  };

  const createSeq = async () => {
    if (!seqForm.name) return;
    await post("/growth/email/sequences", seqForm);
    setSeqForm({ name: "", description: "" });
    notify("Sequence created");
    reloadSeqs();
  };

  const list = camps?.campaigns || [];
  const seqList = seqs?.sequences || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["campaigns", "sequences", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New" : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "campaigns" && (
        <div>
          <div className="gos-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total"    value={list.length} />
            <StatCard label="Sent"     value={list.filter(c => c.status === "sent").length} />
            <StatCard label="Draft"    value={list.filter(c => c.status === "draft").length} />
            <StatCard label="Reach"    value={list.reduce((s,c)=>s+(c.stats?.sent||0),0).toLocaleString()} />
          </div>
          <div className="gos-list">
            {list.length === 0 && <div className="gos-empty">No email campaigns yet. Create one to get started.</div>}
            {list.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{c.name}</div>
                  <div className="gos-campaign-meta">{c.subject}</div>
                </div>
                {c.stats?.sent > 0 && (
                  <div className="gos-campaign-stats">
                    <span>{c.stats.sent} sent</span>
                    <span>{c.stats.opened} opened</span>
                    <span>{c.stats.clicked} clicked</span>
                  </div>
                )}
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
                {c.status === "draft" && (
                  <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "sequences" && (
        <div>
          <div className="gos-list">
            {seqList.length === 0 && <div className="gos-empty">No sequences yet.</div>}
            {seqList.map(s => (
              <div key={s.id} className="gos-campaign-row">
                <span className="gos-campaign-name">{s.name}</span>
                <span className="gos-campaign-meta">{s.steps?.length || 0} steps</span>
                <Chip color="green">{s.status}</Chip>
              </div>
            ))}
          </div>
          <div className="gos-form" style={{ marginTop: 16 }}>
            <div className="gos-form-title">New Sequence</div>
            <div className="gos-form-row">
              <input className="gos-input" placeholder="Sequence name" value={seqForm.name} onChange={e => setSeqForm(f => ({...f, name: e.target.value}))} />
              <input className="gos-input" placeholder="Description" value={seqForm.description} onChange={e => setSeqForm(f => ({...f, description: e.target.value}))} />
              <button className="gos-btn" onClick={createSeq}>Create</button>
            </div>
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
            <label className="gos-check-label">
              <input type="checkbox" checked={form.abTest || false} onChange={e => setForm(f => ({...f, abTest: e.target.checked}))} />
              A/B Test
            </label>
            <button className="gos-btn" onClick={createCampaign}>Create Campaign</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 2: SMS ─────────────────────────────────────────────────────────────

function SMSPanel() {
  const [camps, reload] = useGrowth("/growth/sms/campaigns");
  const [form,  setForm] = useState({ name: "", body: "", senderId: "OOPLIX" });
  const [otp,   setOtp]  = useState({ to: "" });
  const [view,  setView] = useState("campaigns");
  const [msg,   setMsg]  = useState("");

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const create = async () => {
    if (!form.name || !form.body) return;
    await post("/growth/sms/campaigns", form);
    setForm({ name: "", body: "", senderId: "OOPLIX" });
    notify("Campaign created");
    reload();
  };

  const send = async (id) => {
    await post(`/growth/sms/campaigns/${id}/send`, {});
    notify("SMS campaign sent!");
    reload();
  };

  const sendOTP = async () => {
    if (!otp.to) return;
    await post("/growth/sms/otp", otp);
    notify(`OTP sent to ${otp.to}`);
    setOtp({ to: "" });
  };

  const list = camps?.campaigns || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["campaigns", "otp", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New" : v === "otp" ? "OTP" : "Campaigns"}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "campaigns" && (
        <div className="gos-list">
          {list.length === 0 && <div className="gos-empty">No SMS campaigns. Create one to start bulk SMS.</div>}
          {list.map(c => (
            <div key={c.id} className="gos-campaign-row">
              <StatusDot status={c.status} />
              <div style={{ flex: 1 }}>
                <div className="gos-campaign-name">{c.name}</div>
                <div className="gos-campaign-meta">{c.body?.slice(0, 60)}{c.body?.length > 60 ? "…" : ""}</div>
              </div>
              {c.stats?.sent > 0 && <span className="gos-campaign-sent">{c.stats.sent} sent · {c.stats.delivered} delivered</span>}
              <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
              {c.status === "draft" && <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>}
            </div>
          ))}
        </div>
      )}

      {view === "otp" && (
        <div className="gos-form">
          <div className="gos-form-title">Send OTP</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Phone number (+91XXXXXXXXXX)" value={otp.to} onChange={e => setOtp(o => ({...o, to: e.target.value}))} />
            <button className="gos-btn" onClick={sendOTP}>Send OTP</button>
          </div>
          <p className="gos-hint">OTP is auto-generated as a 6-digit code.</p>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New SMS Campaign</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Campaign name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="gos-input" placeholder="Sender ID" style={{ width: 140 }} value={form.senderId} onChange={e => setForm(f => ({...f, senderId: e.target.value}))} />
          </div>
          <textarea
            className="gos-textarea"
            placeholder="SMS message body *"
            value={form.body}
            onChange={e => setForm(f => ({...f, body: e.target.value}))}
          />
          <div className="gos-form-row">
            <span className="gos-hint">{form.body.length}/160 chars</span>
            <button className="gos-btn" onClick={create}>Create Campaign</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 3: WhatsApp ────────────────────────────────────────────────────────

function WhatsAppPanel() {
  const [camps, reload] = useGrowth("/growth/whatsapp/campaigns");
  const [form,  setForm] = useState({ name: "", body: "" });
  const [view,  setView] = useState("broadcasts");
  const [msg,   setMsg]  = useState("");

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const create = async () => {
    if (!form.name || !form.body) return;
    await post("/growth/whatsapp/broadcasts", form);
    setForm({ name: "", body: "" });
    notify("Broadcast created");
    reload();
  };

  const send = async (id) => {
    await post(`/growth/whatsapp/broadcasts/${id}/send`, {});
    notify("Broadcast sent!");
    reload();
  };

  const syncCRM = async (id) => {
    await post(`/growth/whatsapp/broadcasts/${id}/sync-crm`, {});
    notify("CRM synced");
  };

  const list = camps?.campaigns || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["broadcasts", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Broadcast" : "Broadcasts"}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "broadcasts" && (
        <div>
          <div className="gos-list">
            {list.length === 0 && <div className="gos-empty">No WhatsApp broadcasts. Create one to engage customers on WhatsApp.</div>}
            {list.map(c => (
              <div key={c.id} className="gos-campaign-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{c.name}</div>
                  <div className="gos-campaign-meta">{c.body?.slice(0, 60)}{c.body?.length > 60 ? "…" : ""}</div>
                </div>
                {c.stats?.sent > 0 && (
                  <div className="gos-campaign-stats">
                    <span>{c.stats.sent} sent</span>
                    <span>{c.stats.read} read</span>
                    <span>{c.stats.replied} replied</span>
                    <span>{c.stats.leads} leads</span>
                  </div>
                )}
                <Chip color={c.status === "sent" ? "green" : "gray"}>{c.status}</Chip>
                {c.status === "draft" && <button className="gos-btn-sm" onClick={() => send(c.id)}>Send</button>}
                {c.status === "sent" && <button className="gos-btn-sm" onClick={() => syncCRM(c.id)}>Sync CRM</button>}
              </div>
            ))}
          </div>

          <div className="gos-wa-features">
            {[
              { icon: "⬡", label: "Flows", desc: "Build interactive multi-step WA flows" },
              { icon: "◈", label: "Catalog", desc: "Product catalog in WhatsApp" },
              { icon: "◉", label: "Auto Replies", desc: "Keyword-triggered automatic replies" },
              { icon: "◇", label: "Lead Qualification", desc: "Multi-question lead scoring" },
            ].map(f => (
              <div key={f.label} className="gos-wa-feature-card">
                <span className="gos-wa-feat-icon">{f.icon}</span>
                <div>
                  <div className="gos-wa-feat-label">{f.label}</div>
                  <div className="gos-wa-feat-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New WhatsApp Broadcast</div>
          <div className="gos-form-row">
            <input className="gos-input" placeholder="Broadcast name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
          </div>
          <textarea
            className="gos-textarea"
            placeholder="Message body * — use *bold*, _italic_, emojis freely"
            value={form.body}
            onChange={e => setForm(f => ({...f, body: e.target.value}))}
          />
          <div className="gos-form-row">
            <label className="gos-check-label">
              <input type="checkbox" checked={form.flow || false} onChange={e => setForm(f => ({...f, flow: e.target.checked}))} />
              Flow campaign
            </label>
            <label className="gos-check-label">
              <input type="checkbox" checked={form.leadQualification || false} onChange={e => setForm(f => ({...f, leadQualification: e.target.checked ? {} : null}))} />
              Lead qualification
            </label>
            <button className="gos-btn" onClick={create}>Create Broadcast</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 4: Push ────────────────────────────────────────────────────────────

function PushPanel() {
  const [camps, reload] = useGrowth("/growth/push/campaigns");
  const [form,  setForm] = useState({ title: "", body: "", url: "" });
  const [msg,   setMsg]  = useState("");

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const sendPush = async () => {
    if (!form.title || !form.body) return;
    await post("/growth/push/send", { ...form, trigger: "manual" });
    setForm({ title: "", body: "", url: "" });
    notify("Push notification sent!");
    reload();
  };

  const list = camps?.campaigns || [];

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Push Notification Center</span>
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      <div className="gos-push-platforms">
        {[
          { icon: "◉", label: "Desktop",      desc: "Electron app notifications" },
          { icon: "◈", label: "Mobile-ready",  desc: "FCM-compatible payload" },
          { icon: "⬡", label: "Browser",       desc: "Web Push API" },
          { icon: "⚡", label: "Auto Triggers", desc: "Event-based automation" },
        ].map(p => (
          <div key={p.label} className="gos-push-platform-card">
            <span className="gos-push-icon">{p.icon}</span>
            <div className="gos-push-label">{p.label}</div>
            <div className="gos-push-desc">{p.desc}</div>
          </div>
        ))}
      </div>

      <div className="gos-form" style={{ marginTop: 16 }}>
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

      <div className="gos-sub-title" style={{ marginTop: 16 }}>Recent Pushes</div>
      <div className="gos-list">
        {list.length === 0 && <div className="gos-empty">No push notifications sent yet.</div>}
        {[...list].reverse().slice(0, 20).map(c => (
          <div key={c.id} className="gos-campaign-row">
            <span className="gos-campaign-name">{c.title}</span>
            <span className="gos-campaign-meta">{c.body}</span>
            {c.stats && <span className="gos-campaign-sent">{c.stats.sent} sent · {c.stats.clicked} clicked</span>}
            <Chip>{c.trigger}</Chip>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MODULE 5: Automation ──────────────────────────────────────────────────────

function AutomationPanel() {
  const [autos,    reload]   = useGrowth("/growth/automations");
  const [meta,     setMeta]  = useState(null);
  const [form,     setForm]  = useState({ name: "", triggerType: "contact_created" });
  const [view,     setView]  = useState("list");
  const [msg,      setMsg]   = useState("");

  useEffect(() => {
    api("/growth/automations/meta/triggers").then(r => r.ok !== false && setMeta(r));
  }, []);

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const create = async () => {
    if (!form.name) return;
    await post("/growth/automations", {
      name: form.name,
      trigger: { type: form.triggerType },
      steps: [],
    });
    setForm({ name: "", triggerType: "contact_created" });
    notify("Automation created");
    reload();
  };

  const list = autos?.automations || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["list", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Flow" : "Flows"}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "list" && (
        <div>
          <div className="gos-list">
            {list.length === 0 && (
              <div className="gos-empty">
                <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
                No automation flows. Create your first to automate marketing on autopilot.
              </div>
            )}
            {list.map(a => (
              <div key={a.id} className="gos-campaign-row">
                <StatusDot status={a.status} />
                <div style={{ flex: 1 }}>
                  <div className="gos-campaign-name">{a.name}</div>
                  <div className="gos-campaign-meta">Trigger: {a.trigger?.type} · {a.steps?.length || 0} steps</div>
                </div>
                <div className="gos-campaign-stats">
                  <span>{a.stats?.enrolled || 0} enrolled</span>
                  <span>{a.stats?.completed || 0} completed</span>
                </div>
                <Chip color={a.status === "active" ? "green" : "gray"}>{a.status}</Chip>
              </div>
            ))}
          </div>

          {meta && (
            <div style={{ marginTop: 16 }}>
              <div className="gos-sub-title">Available Triggers</div>
              <div className="gos-tag-cloud">
                {(meta.triggers || []).map(t => <Chip key={t}>{t.replace(/_/g, " ")}</Chip>)}
              </div>
              <div className="gos-sub-title">Available Actions</div>
              <div className="gos-tag-cloud">
                {(meta.actions || []).map(a => <Chip key={a}>{a.replace(/_/g, " ")}</Chip>)}
              </div>
            </div>
          )}
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Automation Flow</div>
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Flow name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="gos-select" value={form.triggerType} onChange={e => setForm(f => ({...f, triggerType: e.target.value}))}>
              {(meta?.triggers || ["contact_created","email_opened","sms_replied"]).map(t => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
            <button className="gos-btn" onClick={create}>Create Flow</button>
          </div>
          <p className="gos-hint">Steps (send_email, send_sms, wait, add_tag…) are added in the visual builder after creation.</p>
        </div>
      )}
    </div>
  );
}

// ── MODULE 6: Audience ────────────────────────────────────────────────────────

function AudiencePanel() {
  const [auds,  reload]  = useGrowth("/growth/audiences");
  const [form,  setForm] = useState({ name: "", type: "list", tags: "" });
  const [view,  setView] = useState("list");
  const [msg,   setMsg]  = useState("");

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const create = async () => {
    if (!form.name) return;
    await post("/growth/audiences", {
      name: form.name,
      type: form.type,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
    });
    setForm({ name: "", type: "list", tags: "" });
    notify("Audience created");
    reload();
  };

  const syncCRM = async (id) => {
    await post(`/growth/audiences/${id}/sync-crm`, {});
    notify("CRM contacts synced");
    reload();
  };

  const list = auds?.audiences || [];

  return (
    <div>
      <div className="gos-sub-tabs">
        {["list", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Audience" : "Audiences"}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "list" && (
        <div className="gos-list">
          {list.length === 0 && <div className="gos-empty">No audiences. Create a list, segment, or dynamic audience.</div>}
          {list.map(a => (
            <div key={a.id} className="gos-campaign-row">
              <Chip>{a.type}</Chip>
              <div style={{ flex: 1 }}>
                <div className="gos-campaign-name">{a.name}</div>
                {a.tags?.length > 0 && <div className="gos-tag-cloud" style={{ marginTop: 2 }}>{a.tags.map(t => <Chip key={t} color="purple">{t}</Chip>)}</div>}
              </div>
              <span className="gos-campaign-sent">{(a.memberCount || 0).toLocaleString()} members</span>
              {a.syncFromCRM && <button className="gos-btn-sm" onClick={() => syncCRM(a.id)}>Sync CRM</button>}
            </div>
          ))}
        </div>
      )}

      {view === "create" && (
        <div className="gos-form">
          <div className="gos-form-title">New Audience</div>
          <div className="gos-form-row">
            <input className="gos-input" style={{ flex: 1 }} placeholder="Name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="gos-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              <option value="list">List</option>
              <option value="segment">Segment</option>
              <option value="dynamic">Dynamic</option>
            </select>
          </div>
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

// ── MODULE 7: Analytics ───────────────────────────────────────────────────────

function AnalyticsPanel() {
  const [data,   reload]   = useGrowth("/growth/analytics");
  const [campId, setCampId] = useState("");
  const [campAna, setCampAna] = useState(null);

  const lookupCampaign = async () => {
    if (!campId.trim()) return;
    const r = await api(`/growth/analytics/${campId.trim()}`);
    if (r.ok !== false) setCampAna(r.analytics);
  };

  const overall = data?.analytics;
  const byType  = overall?.byType || {};

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Campaign Analytics</span>
        <button className="gos-btn-sm" onClick={reload}>Refresh</button>
      </div>

      {overall && (
        <div className="gos-stats-grid" style={{ marginBottom: 16 }}>
          <StatCard label="Total Sent"    value={(overall.totalSent || 0).toLocaleString()} />
          <StatCard label="Total Revenue" value={`₹${(overall.totalRevenue || 0).toLocaleString()}`} />
          <StatCard label="Campaigns"     value={overall.totalCampaigns} />
        </div>
      )}

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
              {s.revenue > 0 && <span className="gos-campaign-meta">₹{s.revenue.toLocaleString()} revenue</span>}
            </div>
            <Bar value={s.sent} max={overall?.totalSent || 1} />
          </div>
        ))}
        {Object.keys(byType).length === 0 && <div className="gos-empty">Send campaigns to see analytics.</div>}
      </div>

      <div className="gos-sub-title" style={{ marginTop: 20 }}>Campaign Lookup</div>
      <div className="gos-form-row">
        <input className="gos-input" placeholder="Campaign ID" value={campId} onChange={e => setCampId(e.target.value)} />
        <button className="gos-btn-sm" onClick={lookupCampaign}>Look up</button>
      </div>
      {campAna && (
        <div className="gos-form" style={{ marginTop: 10 }}>
          <div className="gos-form-title">{campAna.name} ({campAna.type})</div>
          <div className="gos-stats-grid">
            <StatCard label="Sent"       value={campAna.sent} />
            <StatCard label="Delivered"  value={campAna.delivered} />
            <StatCard label="Open Rate"  value={`${campAna.openRate}%`} />
            <StatCard label="Click Rate" value={`${campAna.clickRate}%`} />
            <StatCard label="Conv. Rate" value={`${campAna.conversionRate}%`} />
            <StatCard label="Revenue"    value={`₹${campAna.revenue}`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 8: Templates ───────────────────────────────────────────────────────

function TemplatesPanel() {
  const [templates, reload] = useGrowth("/growth/templates");
  const [filter,    setFilter] = useState("all");
  const [form,      setForm]   = useState({ name: "", type: "email", category: "Custom", subject: "", body: "" });
  const [view,      setView]   = useState("marketplace");
  const [msg,       setMsg]    = useState("");
  const [selected,  setSelected] = useState(null);

  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const create = async () => {
    if (!form.name || !form.body) return;
    await post("/growth/templates", form);
    setForm({ name: "", type: "email", category: "Custom", subject: "", body: "" });
    notify("Template created");
    reload();
  };

  const list = (templates?.templates || []).filter(t => filter === "all" || t.type === filter);

  return (
    <div>
      <div className="gos-sub-tabs">
        {["marketplace", "create"].map(v => (
          <button key={v} className={`gos-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Template" : "Marketplace"}
          </button>
        ))}
        {msg && <span className="gos-msg">{msg}</span>}
      </div>

      {view === "marketplace" && (
        <div>
          <div className="gos-filter-row">
            {["all", "email", "sms", "whatsapp", "push"].map(f => (
              <button key={f} className={`gos-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <span className="gos-hint" style={{ marginLeft: "auto" }}>{list.length} templates</span>
          </div>

          <div className="gos-template-grid">
            {list.map(t => (
              <div
                key={t.id}
                className={`gos-template-card${selected?.id === t.id ? " selected" : ""}`}
                onClick={() => setSelected(selected?.id === t.id ? null : t)}
              >
                <div className="gos-tpl-header">
                  <Chip>{t.type}</Chip>
                  {!t.builtin && <Chip color="purple">custom</Chip>}
                </div>
                <div className="gos-tpl-name">{t.name}</div>
                <div className="gos-tpl-category">{t.category}</div>
                {t.subject && <div className="gos-tpl-subject">{t.subject}</div>}
                <div className="gos-tpl-body">{t.body?.slice(0, 80)}{t.body?.length > 80 ? "…" : ""}</div>
              </div>
            ))}
          </div>

          {selected && (
            <div className="gos-tpl-preview">
              <div className="gos-form-title">{selected.name}</div>
              {selected.subject && <div className="gos-tpl-preview-subject">Subject: {selected.subject}</div>}
              <pre className="gos-tpl-preview-body">{selected.body}</pre>
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
          <div className="gos-form-row">
            <button className="gos-btn" onClick={create}>Create Template</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 10: Benchmark ──────────────────────────────────────────────────────

function BenchmarkPanel() {
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/growth/benchmark");
    if (r.ok !== false) setResult(r);
    setRunning(false);
  };

  return (
    <div>
      <div className="gos-section-hdr">
        <span className="gos-section-title">Commercial Benchmark</span>
        <button className="gos-btn" onClick={run} disabled={running}>{running ? "Running…" : "Run Benchmark"}</button>
      </div>
      <p className="gos-hint">Validates all 10 marketing modules: email, SMS, WhatsApp, push, automation, audience, analytics, templates, dashboard, CRM sync.</p>

      {result && (
        <>
          <div className="gos-stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Score"        value={`${result.score}%`} />
            <StatCard label="Passed"       value={`${result.passing}/${result.total}`} />
            <StatCard label="Readiness"    value={result.marketingReadiness?.replace(/_/g, " ")} />
            <StatCard label="Regression"   value={result.regressionPass ? "PASS" : "FAIL"} />
          </div>

          <div className="gos-list">
            {(result.checks || []).map(c => (
              <div key={c.id} className={`gos-campaign-row ${c.ok ? "" : "gos-row-fail"}`}>
                <span className="gos-check-icon" style={{ color: c.ok ? "#22c55e" : "#ef4444" }}>{c.ok ? "✓" : "✗"}</span>
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
        <span className="gos-title">Growth Operating System — G1</span>
        <span className="gos-subtitle">Marketing Infrastructure · Email · SMS · WhatsApp · Push · Automation</span>
      </div>
      <div className="gos-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`gos-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
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
