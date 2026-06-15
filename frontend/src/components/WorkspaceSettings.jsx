import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { getSettingsStatus, saveWhatsAppCredentials } from "../settingsApi";
import { _fetch } from "../_client";
import "./WorkspaceSettings.css";

// ── Storage helpers ───────────────────────────────────────────────────
const BRAND_KEY    = "ooplix_ws_branding";
const SECURITY_KEY = "ooplix_ws_security";
const NOTIF_KEY    = "ooplix_ws_notifications";

function _load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; }
  catch { return fallback; }
}
function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

// ── Integration definitions ───────────────────────────────────────────
const INTEGRATIONS = [
  {
    id:      "whatsapp",
    name:    "WhatsApp Business",
    icon:    "◉",
    color:   "#25d366",
    status:  "check",
    desc:    "Automated follow-up sequences and outbound messaging.",
    setup:   "Connected via QR scan. Re-scan in Contacts tab to refresh session.",
  },
  {
    id:      "razorpay",
    name:    "Razorpay",
    icon:    "◈",
    color:   "#3395ff",
    status:  "check",
    desc:    "Payment link generation and collection tracking.",
    setup:   "API key configured. Update in Contacts → Payment tab.",
  },
  {
    id:      "gmail",
    name:    "Gmail / Google Workspace",
    icon:    "✉",
    color:   "#ea4335",
    status:  "disconnected",
    desc:    "Send emails and sync contacts from Google Contacts.",
    setup:   "Connect via OAuth. Requires Google account.",
  },
  {
    id:      "slack",
    name:    "Slack",
    icon:    "◇",
    color:   "#4a154b",
    status:  "disconnected",
    desc:    "Post activity alerts and pipeline updates to a Slack channel.",
    setup:   "Add the Ooplix app to your Slack workspace.",
  },
  {
    id:      "zapier",
    name:    "Zapier",
    icon:    "⬟",
    color:   "#ff4a00",
    status:  "disconnected",
    desc:    "Connect Ooplix to 5,000+ apps via Zapier webhooks.",
    setup:   "Use the Ooplix webhook URL in your Zap trigger.",
  },
  {
    id:      "stripe",
    name:    "Stripe",
    icon:    "◎",
    color:   "#635bff",
    status:  "disconnected",
    desc:    "Accept international payments and subscriptions.",
    setup:   "Enter Stripe publishable key in billing settings.",
  },
];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="ws-toggle-wrap">
      <button
        className={`ws-toggle${checked ? " ws-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="ws-toggle-thumb" />
      </button>
      {label && <span className="ws-toggle-label">{label}</span>}
    </label>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="ws-field-row">
      <div className="ws-field-meta">
        <span className="ws-field-label">{label}</span>
        {hint && <span className="ws-field-hint">{hint}</span>}
      </div>
      <div className="ws-field-control">{children}</div>
    </div>
  );
}

// ── K3 Admin helpers ─────────────────────────────────────────────
const STATUS_COLOR = { active: "#52d68a", invited: "var(--accent)", suspended: "var(--warning)", archived: "var(--text-faint)" };
const STATUS_LABEL = { active: "Active", invited: "Invited", suspended: "Suspended", archived: "Archived" };

function QuotaBar({ label, used, limit }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct >= 90 ? "var(--error)" : pct >= 70 ? "var(--warning)" : "#52d68a";
  return (
    <div className="k3-quota-row">
      <div className="k3-quota-meta">
        <span className="k3-quota-label">{label}</span>
        <span className="k3-quota-count" style={{ color }}>{used} / {limit}</span>
      </div>
      <div className="k3-quota-track">
        <div className="k3-quota-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ── K3 — Team Directory ──────────────────────────────────────────
function TeamDirectoryPanel() {
  const [team,      setTeam]      = useState([]);
  const [depts,     setDepts]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [statusF,   setStatusF]   = useState("");
  const [selected,  setSelected]  = useState([]);
  const [bulkMode,  setBulkMode]  = useState(false);
  const [bulkAction,setBulkAction]= useState("set_status");
  const [bulkVal,   setBulkVal]   = useState("");
  const [editing,   setEditing]   = useState(null); // { accountId, title, deptId, status }
  const [toast,     setToast]     = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, d] = await Promise.all([
        _fetch("/admin/team").then(r => r.team || []),
        _fetch("/admin/departments").then(r => r.departments || []),
      ]);
      setTeam(t); setDepts(d);
    } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = team.filter(m => {
    if (statusF && m.status !== statusF) return false;
    if (search) {
      const q = search.toLowerCase();
      return (m.name || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q);
    }
    return true;
  });

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function saveMember() {
    if (!editing) return;
    try {
      await _fetch(`/admin/member/${editing.accountId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: editing.status, title: editing.title, deptId: editing.deptId }),
      });
      doToast("Member updated"); setEditing(null); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function doBulk() {
    if (!selected.length || !bulkVal) return;
    const payload = bulkAction === "set_status" ? { status: bulkVal }
                  : bulkAction === "set_dept"   ? { deptId: bulkVal }
                  : { title: bulkVal };
    try {
      const r = await _fetch("/admin/member/bulk", {
        method: "POST",
        body: JSON.stringify({ accountIds: selected, action: bulkAction, payload }),
      });
      doToast(`Applied to ${r.applied} member${r.applied !== 1 ? "s" : ""}`);
      setSelected([]); setBulkMode(false); setBulkVal(""); load();
    } catch (e) { doToast(e.message || "Bulk action failed"); }
  }

  if (loading) return <div className="k2-loading">Loading team…</div>;

  return (
    <div className="k3-team-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k3-team-toolbar">
        <input className="k3-search" placeholder="Search name, email…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="k3-filter" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="">All statuses</option>
          {["active","invited","suspended","archived"].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button className={`k3-bulk-toggle${bulkMode ? " k3-bulk-toggle--on" : ""}`} onClick={() => { setBulkMode(b => !b); setSelected([]); }}>
          {bulkMode ? "Cancel bulk" : "Bulk edit"}
        </button>
      </div>

      {bulkMode && selected.length > 0 && (
        <div className="k3-bulk-bar">
          <span className="k3-bulk-count">{selected.length} selected</span>
          <select className="k3-filter" value={bulkAction} onChange={e => { setBulkAction(e.target.value); setBulkVal(""); }}>
            <option value="set_status">Set status</option>
            <option value="set_dept">Set department</option>
            <option value="set_title">Set title</option>
          </select>
          {bulkAction === "set_status" && (
            <select className="k3-filter" value={bulkVal} onChange={e => setBulkVal(e.target.value)}>
              <option value="">Choose…</option>
              {["active","suspended","archived"].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          )}
          {bulkAction === "set_dept" && (
            <select className="k3-filter" value={bulkVal} onChange={e => setBulkVal(e.target.value)}>
              <option value="">Choose dept…</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {bulkAction === "set_title" && (
            <input className="k3-search" style={{ maxWidth: 160 }} placeholder="Job title…" value={bulkVal} onChange={e => setBulkVal(e.target.value)} />
          )}
          <button className="k2-create-btn" onClick={doBulk} disabled={!bulkVal}>Apply</button>
        </div>
      )}

      <div className="k3-team-list">
        {filtered.length === 0 && <div className="k2-empty">No members match the current filter.</div>}
        {filtered.map(m => (
          <div key={m.accountId} className={`k3-member-row${selected.includes(m.accountId) ? " k3-member-row--selected" : ""}`}>
            {bulkMode && (
              <input type="checkbox" className="k3-check" checked={selected.includes(m.accountId)}
                onChange={() => toggleSelect(m.accountId)} />
            )}
            <div className="k3-member-avatar">{(m.name || m.email || "?").slice(0, 2).toUpperCase()}</div>
            <div className="k3-member-info">
              <span className="k3-member-name">{m.name || m.accountId}</span>
              <span className="k3-member-email">{m.email || ""}</span>
              {m.title && <span className="k3-member-title">{m.title}</span>}
            </div>
            <span className="k3-role-chip">{m.role}</span>
            {m.deptId && <span className="k3-dept-chip">{depts.find(d => d.id === m.deptId)?.name || m.deptId}</span>}
            <span className="k3-status-dot" style={{ background: STATUS_COLOR[m.status] }} title={STATUS_LABEL[m.status]} />
            {!bulkMode && (
              <button className="k3-edit-btn" onClick={() => setEditing({ accountId: m.accountId, status: m.status, title: m.title || "", deptId: m.deptId || "" })}>Edit</button>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="ws-modal-overlay" onClick={() => setEditing(null)}>
          <div className="ws-modal k3-edit-modal" onClick={e => e.stopPropagation()}>
            <h3 className="k3-modal-title">Edit Member</h3>
            <div className="k3-modal-fields">
              <label className="k3-modal-label">Job Title
                <input className="k3-modal-input" value={editing.title} onChange={e => setEditing(x => ({ ...x, title: e.target.value }))} placeholder="e.g. Senior Engineer" />
              </label>
              <label className="k3-modal-label">Department
                <select className="k3-modal-select" value={editing.deptId} onChange={e => setEditing(x => ({ ...x, deptId: e.target.value }))}>
                  <option value="">No department</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="k3-modal-label">Status
                <select className="k3-modal-select" value={editing.status} onChange={e => setEditing(x => ({ ...x, status: e.target.value }))}>
                  {["active","invited","suspended","archived"].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
            </div>
            <div className="k3-modal-actions">
              <button className="k2-cancel-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="k2-create-confirm" onClick={saveMember}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── K3 — Departments Panel ───────────────────────────────────────
function DepartmentsPanel() {
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating,setCreating]= useState(false);
  const [toast,   setToast]   = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    _fetch("/admin/departments").then(r => setDepts(r.departments || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!newName.trim()) return;
    try {
      await _fetch("/admin/departments", { method: "POST", body: JSON.stringify({ name: newName, description: newDesc }) });
      setNewName(""); setNewDesc(""); setCreating(false); doToast("Department created"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function archive(id) {
    try {
      await _fetch(`/admin/departments/${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      doToast("Department archived"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading departments…</div>;

  return (
    <div className="k3-dept-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      <div className="k3-dept-header">
        <span>{depts.length} department{depts.length !== 1 ? "s" : ""}</span>
        <button className="k2-create-btn" onClick={() => setCreating(c => !c)}>＋ New</button>
      </div>
      {creating && (
        <div className="k3-dept-form">
          <input className="k2-form-input" placeholder="Department name…" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }} autoFocus />
          <input className="k2-form-input" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          <div className="k2-form-actions">
            <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
            <button className="k2-create-confirm" onClick={create} disabled={!newName.trim()}>Create</button>
          </div>
        </div>
      )}
      <div className="k3-dept-list">
        {depts.length === 0 && <div className="k2-empty">No departments yet.</div>}
        {depts.map(d => (
          <div key={d.id} className="k3-dept-row">
            <div className="k3-dept-icon">◈</div>
            <div className="k3-dept-info">
              <span className="k3-dept-name">{d.name}</span>
              {d.description && <span className="k3-dept-desc">{d.description}</span>}
              <span className="k3-dept-count">{d.memberCount || 0} member{d.memberCount !== 1 ? "s" : ""}</span>
            </div>
            <button className="k2-revoke-btn" onClick={() => archive(d.id)}>Archive</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K3 — Organisation Profile Panel ─────────────────────────────
function OrgProfilePanel() {
  const [profile, setProfile] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/admin/profile").then(r => setProfile(r.profile)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await _fetch("/admin/profile", { method: "PATCH", body: JSON.stringify(profile) });
      setProfile(r.profile); doToast("Profile saved");
    } catch (e) { doToast(e.message || "Save failed"); }
    setSaving(false);
  }

  if (!profile) return <div className="k2-loading">Loading profile…</div>;

  const fields = [
    ["displayName",  "Display Name",  "text",   "Acme Corp"],
    ["industry",     "Industry",      "text",   "SaaS, Finance, Healthcare…"],
    ["size",         "Team Size",     "text",   "1-10, 11-50, 51-200…"],
    ["website",      "Website",       "url",    "https://company.com"],
    ["country",      "Country",       "text",   "United States"],
    ["timezone",     "Timezone",      "text",   "UTC, America/New_York…"],
  ];

  return (
    <div className="k3-profile-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      <div className="ws-fields">
        {fields.map(([key, label, type, placeholder]) => (
          <FieldRow key={key} label={label}>
            <input className="ws-input" type={type} placeholder={placeholder}
              value={profile[key] || ""} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} />
          </FieldRow>
        ))}
        <FieldRow label="Description">
          <textarea className="ws-input k3-textarea" rows={3} placeholder="Brief description of your organisation"
            value={profile.description || ""} onChange={e => setProfile(p => ({ ...p, description: e.target.value }))} />
        </FieldRow>
      </div>
      <button className="ws-save-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
    </div>
  );
}

// ── K3 — Statistics Panel ────────────────────────────────────────
function StatisticsPanel() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/admin/statistics").then(r => setStats(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading statistics…</div>;
  if (!stats)  return <div className="k2-empty">Statistics unavailable.</div>;

  const cards = [
    { label: "Total members",     value: stats.members?.total        || 0, color: "var(--accent)" },
    { label: "Active",            value: stats.members?.active       || 0, color: "#52d68a" },
    { label: "Pending invites",   value: stats.members?.pendingInvites || 0, color: "var(--warning)" },
    { label: "Suspended",         value: stats.members?.suspended    || 0, color: "var(--error)" },
    { label: "Departments",       value: stats.departments?.total    || 0, color: "var(--accent2)" },
    { label: "Active sessions",   value: stats.security?.activeSessions || 0, color: "var(--text-dim)" },
    { label: "API tokens",        value: stats.security?.activeTokens   || 0, color: "var(--text-dim)" },
    { label: "Audit events",      value: stats.security?.auditEvents    || 0, color: "var(--text-faint)" },
  ];

  return (
    <div className="k3-stats-grid">
      {cards.map(c => (
        <div key={c.label} className="k3-stat-card">
          <span className="k3-stat-value" style={{ color: c.color }}>{c.value}</span>
          <span className="k3-stat-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── K3 — Quotas Panel ────────────────────────────────────────────
function QuotasPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/admin/quotas").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading quotas…</div>;
  if (!data)   return <div className="k2-empty">Quota data unavailable.</div>;

  const { usage } = data;
  return (
    <div className="k3-quotas-panel">
      <p className="k3-quotas-note">Current usage against workspace plan limits.</p>
      <QuotaBar label="Members"        used={usage.members?.used}     limit={usage.members?.limit} />
      <QuotaBar label="Departments"    used={usage.departments?.used}  limit={usage.departments?.limit} />
      <QuotaBar label="API Tokens"     used={usage.apiTokens?.used}    limit={usage.apiTokens?.limit} />
      <QuotaBar label="Active Sessions" used={usage.sessions?.used}    limit={usage.sessions?.limit} />
    </div>
  );
}

// ── K4 Governance helpers ─────────────────────────────────────────
const RISK_COLOR  = { critical: "var(--error)", high: "#ff6b35", medium: "var(--warning)", low: "#52d68a" };
const ENF_COLOR   = { blocking: "var(--error)", advisory: "var(--warning)", logging: "var(--text-dim)" };
const POLICY_TYPES = ["approval","change","deployment","environment","retention","audit_retention","access"];
const ENFORCEMENT  = ["advisory","blocking","logging"];
const LIKELIHOOD   = ["rare","unlikely","possible","likely","almost_certain"];
const IMPACT       = ["negligible","minor","moderate","major","critical"];
const FRAMEWORKS   = ["SOC 2","GDPR","HIPAA","ISO 27001","PCI-DSS","CCPA"];

function _govFmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

// ── K4 — Policy Library Panel ─────────────────────────────────────
function PolicyLibraryPanel() {
  const [policies,  setPolicies]  = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState("policies"); // policies | templates
  const [creating,  setCreating]  = useState(false);
  const [form,      setForm]      = useState({ name: "", type: "change", enforcement: "advisory", description: "" });
  const [toast,     setToast]     = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        _fetch("/governance/policies").then(r => r.policies || []),
        _fetch("/governance/templates").then(r => r.templates || []),
      ]);
      setPolicies(p); setTemplates(t);
    } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createPolicy() {
    if (!form.name.trim()) return;
    try {
      await _fetch("/governance/policies", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", type: "change", enforcement: "advisory", description: "" });
      setCreating(false); doToast("Policy created"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function archivePolicy(id) {
    try {
      await _fetch(`/governance/policies/${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      doToast("Policy archived"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading policies…</div>;

  return (
    <div className="k4-policy-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k4-subtabs">
        {[["policies", `Policies (${policies.length})`], ["templates", `Templates (${templates.length})`]].map(([id, label]) => (
          <button key={id} className={`k4-subtab${tab === id ? " k4-subtab--active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "policies" && (
        <>
          <div className="k4-list-header">
            <span className="k4-list-count">{policies.length} active</span>
            <button className="k2-create-btn" onClick={() => setCreating(c => !c)}>＋ New policy</button>
          </div>

          {creating && (
            <div className="k4-create-form">
              <input className="k2-form-input" placeholder="Policy name…" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
              <div className="k4-form-row">
                <select className="k2-form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
                <select className="k2-form-select" value={form.enforcement} onChange={e => setForm(f => ({ ...f, enforcement: e.target.value }))}>
                  {ENFORCEMENT.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <input className="k2-form-input" placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <div className="k2-form-actions">
                <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
                <button className="k2-create-confirm" onClick={createPolicy} disabled={!form.name.trim()}>Create</button>
              </div>
            </div>
          )}

          <div className="k4-list">
            {policies.length === 0 && !creating && <div className="k2-empty">No active policies. Create one or apply a template.</div>}
            {policies.map(p => (
              <div key={p.id} className="k4-policy-row">
                <div className="k4-policy-meta">
                  <span className="k4-policy-name">{p.name}</span>
                  <span className="k4-policy-type">{p.type.replace("_"," ")}</span>
                  {p.description && <span className="k4-policy-desc">{p.description}</span>}
                </div>
                <span className="k4-enf-badge" style={{ color: ENF_COLOR[p.enforcement], borderColor: ENF_COLOR[p.enforcement] + "40" }}>
                  {p.enforcement}
                </span>
                <button className="k2-revoke-btn" onClick={() => archivePolicy(p.id)}>Archive</button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "templates" && (
        <div className="k4-list">
          {templates.map(t => (
            <div key={t.id} className="k4-template-card">
              <div className="k4-template-top">
                <span className="k4-template-name">{t.name}</span>
                {!t.custom && <span className="k2-badge k2-badge--dim">Built-in</span>}
                {t.custom  && <span className="k2-badge k2-badge--green">Custom</span>}
                <span className="k4-template-cat">{t.category}</span>
              </div>
              {t.description && <span className="k4-template-desc">{t.description}</span>}
              <div className="k4-template-policies">
                {(t.policies || []).map((p, i) => (
                  <span key={i} className="k4-tpl-policy-chip">
                    <span style={{ color: ENF_COLOR[p.enforcement] }}>●</span> {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── K4 — Compliance Panel ─────────────────────────────────────────
function CompliancePanel() {
  const [compliance, setCompliance] = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/governance/compliance").then(r => setCompliance(r.compliance)).catch(() => {});
  }, []);

  function toggleFramework(fw) {
    setCompliance(c => {
      const fws = c.frameworks || [];
      return { ...c, frameworks: fws.includes(fw) ? fws.filter(f => f !== fw) : [...fws, fw] };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await _fetch("/governance/compliance", { method: "PATCH", body: JSON.stringify(compliance) });
      setCompliance(r.compliance); doToast("Compliance profile saved");
    } catch (e) { doToast(e.message || "Failed"); }
    setSaving(false);
  }

  if (!compliance) return <div className="k2-loading">Loading compliance profile…</div>;

  return (
    <div className="k4-compliance-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k4-section-label">Active Frameworks</div>
      <div className="k4-frameworks-grid">
        {FRAMEWORKS.map(fw => (
          <button key={fw} className={`k4-fw-chip${(compliance.frameworks || []).includes(fw) ? " k4-fw-chip--active" : ""}`}
            onClick={() => toggleFramework(fw)}>{fw}</button>
        ))}
      </div>

      <div className="ws-fields" style={{ marginTop: 16 }}>
        <FieldRow label="Data classification" hint="Default classification level for workspace data">
          <select className="ws-select" value={compliance.dataClassification}
            onChange={e => setCompliance(c => ({ ...c, dataClassification: e.target.value }))}>
            {["public","internal","confidential","restricted"].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Risk tolerance" hint="Organization's overall risk appetite">
          <select className="ws-select" value={compliance.riskTolerance}
            onChange={e => setCompliance(c => ({ ...c, riskTolerance: e.target.value }))}>
            {["low","medium","high"].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Data retention (days)" hint="Default retention period for workspace data">
          <input className="ws-input" type="number" min={30} max={3650}
            value={compliance.retentionDays}
            onChange={e => setCompliance(c => ({ ...c, retentionDays: Number(e.target.value) }))} />
        </FieldRow>
        <FieldRow label="Review cycle (days)" hint="How often compliance posture is reviewed">
          <select className="ws-select" value={compliance.reviewCycleDays}
            onChange={e => setCompliance(c => ({ ...c, reviewCycleDays: Number(e.target.value) }))}>
            {[30, 60, 90, 180, 365].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Notes">
          <textarea className="ws-input k3-textarea" rows={2} value={compliance.notes || ""}
            onChange={e => setCompliance(c => ({ ...c, notes: e.target.value }))} placeholder="Internal compliance notes…" />
        </FieldRow>
      </div>

      {compliance.nextReviewAt && (
        <div className="k4-review-banner">
          Next review: <strong>{_govFmtDate(compliance.nextReviewAt)}</strong>
          {compliance.nextReviewAt < Date.now() && <span className="k4-overdue"> — OVERDUE</span>}
        </div>
      )}

      <button className="ws-save-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save compliance profile"}</button>
    </div>
  );
}

// ── K4 — Risk Matrix Panel ────────────────────────────────────────
function RiskMatrixPanel() {
  const [matrix,  setMatrix]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [toast,   setToast]   = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    _fetch("/governance/risk").then(r => setMatrix(r.riskMatrix || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveEntry() {
    if (!editing) return;
    try {
      await _fetch(`/governance/risk/${editing.category}`, {
        method: "PATCH",
        body: JSON.stringify({ likelihood: editing.likelihood, impact: editing.impact, mitigation: editing.mitigation }),
      });
      doToast("Risk entry updated"); setEditing(null); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading risk matrix…</div>;

  return (
    <div className="k4-risk-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      <div className="k4-risk-grid">
        {matrix.map(r => (
          <div key={r.category} className="k4-risk-card" style={{ borderColor: RISK_COLOR[r.riskLevel] + "50" }}>
            <div className="k4-risk-card-top">
              <span className="k4-risk-category">{r.category}</span>
              <span className="k4-risk-level" style={{ color: RISK_COLOR[r.riskLevel] }}>{r.riskLevel}</span>
            </div>
            <div className="k4-risk-score" style={{ color: RISK_COLOR[r.riskLevel] }}>{r.score}</div>
            <div className="k4-risk-dims">
              <span className="k4-risk-dim">L: {r.likelihood}</span>
              <span className="k4-risk-dim">I: {r.impact}</span>
            </div>
            {r.mitigation && <div className="k4-risk-mitigation">{r.mitigation}</div>}
            <button className="k3-edit-btn" style={{ marginTop: 6 }}
              onClick={() => setEditing({ ...r })}>Edit</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="ws-modal-overlay" onClick={() => setEditing(null)}>
          <div className="ws-modal k3-edit-modal" onClick={e => e.stopPropagation()}>
            <h3 className="k3-modal-title">Edit Risk: {editing.category}</h3>
            <div className="k3-modal-fields">
              <label className="k3-modal-label">Likelihood
                <select className="k3-modal-select" value={editing.likelihood}
                  onChange={e => setEditing(x => ({ ...x, likelihood: e.target.value }))}>
                  {LIKELIHOOD.map(v => <option key={v} value={v}>{v.replace("_"," ")}</option>)}
                </select>
              </label>
              <label className="k3-modal-label">Impact
                <select className="k3-modal-select" value={editing.impact}
                  onChange={e => setEditing(x => ({ ...x, impact: e.target.value }))}>
                  {IMPACT.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="k3-modal-label">Mitigation
                <input className="k3-modal-input" value={editing.mitigation || ""}
                  onChange={e => setEditing(x => ({ ...x, mitigation: e.target.value }))}
                  placeholder="Mitigation strategy…" />
              </label>
            </div>
            <div className="k3-modal-actions">
              <button className="k2-cancel-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="k2-create-confirm" onClick={saveEntry}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── K4 — Governance Overview (landing) ────────────────────────────
function GovernanceOverviewPanel() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/governance/reports").then(r => setReport(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading governance overview…</div>;
  if (!report)  return <div className="k2-empty">No governance data.</div>;

  const { policies, compliance, risk } = report;
  const scoreColor = s => s >= 85 ? "#52d68a" : s >= 70 ? "var(--warning)" : s >= 55 ? "#ffaa00" : "var(--error)";

  return (
    <div className="k4-overview-panel">
      <div className="k4-overview-cards">
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: scoreColor(compliance?.score || 0) }}>{compliance?.score || 0}</span>
          <span className="k4-ov-label">Compliance Score</span>
          <span className="k4-ov-sub">{compliance?.grade} grade</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--accent)" }}>{policies?.active || 0}</span>
          <span className="k4-ov-label">Active Policies</span>
          <span className="k4-ov-sub">{policies?.blocking || 0} blocking</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: RISK_COLOR[risk?.summary?.critical > 0 ? "critical" : "low"] }}>
            {(risk?.summary?.critical || 0) + (risk?.summary?.high || 0)}
          </span>
          <span className="k4-ov-label">High+ Risks</span>
          <span className="k4-ov-sub">{risk?.summary?.critical || 0} critical</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--text-dim)" }}>{compliance?.frameworks?.length || 0}</span>
          <span className="k4-ov-label">Frameworks</span>
          <span className="k4-ov-sub">{(compliance?.frameworks || []).slice(0,2).join(", ") || "None active"}</span>
        </div>
      </div>

      {risk?.highestRisk?.length > 0 && (
        <>
          <div className="k4-section-label" style={{ marginTop: 16 }}>Highest Risk Areas</div>
          {risk.highestRisk.map(r => (
            <div key={r.category} className="k2-row" style={{ borderColor: RISK_COLOR[r.riskLevel] + "40" }}>
              <span className="k4-risk-level" style={{ color: RISK_COLOR[r.riskLevel], minWidth: 56 }}>{r.riskLevel}</span>
              <span className="k4-risk-category" style={{ flex: 1 }}>{r.category}</span>
              <span className="k4-risk-score" style={{ color: RISK_COLOR[r.riskLevel] }}>Score: {r.score}</span>
            </div>
          ))}
        </>
      )}

      {compliance?.nextReview && (
        <div className="k4-review-banner" style={{ marginTop: 14 }}>
          Next compliance review: <strong>{_govFmtDate(compliance.nextReview)}</strong>
        </div>
      )}
    </div>
  );
}

// ── K4 — Governance Reports Panel ────────────────────────────────
function GovReportsPanel() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    _fetch("/governance/reports").then(r => setReport(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="k2-loading">Generating report…</div>;
  if (!report)  return <div className="k2-empty">Report unavailable.</div>;

  const { policies, audit, members, activity } = report;

  return (
    <div className="k4-report-panel">
      <div className="k4-report-header">
        <span className="k4-report-ts">Generated {_govFmtDate(report.generatedAt)}</span>
        <button className="k2-create-btn" onClick={load}>↺ Refresh</button>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Policy Breakdown</div>
        <div className="k4-report-grid">
          {Object.entries(policies?.byType || {}).filter(([, n]) => n > 0).map(([type, n]) => (
            <div key={type} className="k4-report-cell">
              <span className="k4-report-cell-val">{n}</span>
              <span className="k4-report-cell-key">{type.replace("_"," ")}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Audit Events by Type</div>
        <div className="k4-report-grid">
          {Object.entries(audit?.byType || {}).sort((a,b) => b[1]-a[1]).slice(0,8).map(([type, n]) => (
            <div key={type} className="k4-report-cell">
              <span className="k4-report-cell-val">{n}</span>
              <span className="k4-report-cell-key">{type}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Recent Audit Events</div>
        <div className="k2-audit-list">
          {(audit?.recent || []).slice(0,8).map((e, i) => (
            <div key={e.id || i} className="k2-audit-row">
              <span className="k2-audit-dot" style={{ background: "var(--accent)" }} />
              <span className="k2-audit-ts">{new Date(e.ts).toLocaleDateString()}</span>
              <span className="k2-audit-action">{e.action}</span>
              {e.detail && <span className="k2-audit-detail">{e.detail}</span>}
            </div>
          ))}
          {(!audit?.recent?.length) && <div className="k2-empty">No audit events yet.</div>}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Members Summary</div>
        <div className="k4-report-grid">
          {Object.entries(members || {}).filter(([k]) => ["total","active","suspended","pendingInvites"].includes(k)).map(([k, v]) => (
            <div key={k} className="k4-report-cell">
              <span className="k4-report-cell-val">{v}</span>
              <span className="k4-report-cell-key">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── K2 Security helpers ───────────────────────────────────────────
const SCORE_COLOR = s => s >= 85 ? "#52d68a" : s >= 70 ? "var(--warning)" : s >= 55 ? "#ffaa00" : "var(--error)";
function _fmtTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function _timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ── K2 — Security Score ───────────────────────────────────────────
function SecurityScore({ score, grade, factors }) {
  if (!score) return null;
  const color = SCORE_COLOR(score);
  return (
    <div className="k2-score-card">
      <div className="k2-score-ring" style={{ "--score-color": color }}>
        <span className="k2-score-num" style={{ color }}>{score}</span>
        <span className="k2-score-grade" style={{ color }}>{grade}</span>
      </div>
      <div className="k2-score-factors">
        {[
          ["MFA enabled",     factors?.mfa],
          ["Audit log",       factors?.auditLog],
          ["Device trust",    factors?.deviceTrust],
          ["IP allowlist",    factors?.ipAllowlist],
          ["Short sessions",  factors?.shortSessions],
        ].map(([label, ok]) => (
          <span key={label} className={`k2-factor${ok ? " k2-factor--ok" : ""}`}>
            <span>{ok ? "✓" : "○"}</span> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── K2 — Sessions Panel ───────────────────────────────────────────
function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/sessions").then(d => setSessions(d.sessions || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function revoke(id) {
    try {
      await _fetch(`/security/session/${id}`, { method: "DELETE" });
      setSessions(s => s.filter(x => x.id !== id));
      doToast("Session revoked");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading sessions…</div>;
  return (
    <div className="k2-list">
      {toast && <div className="tw-toast">{toast}</div>}
      {sessions.length === 0 && <div className="k2-empty">No active sessions recorded.</div>}
      {sessions.map(s => (
        <div key={s.id} className={`k2-row${s.isCurrent ? " k2-row--current" : ""}`}>
          <span className="k2-row-icon">⬡</span>
          <div className="k2-row-meta">
            <span className="k2-row-title">{s.userAgent || "Unknown browser"} {s.isCurrent && <span className="k2-badge k2-badge--green">Current</span>}</span>
            <span className="k2-row-sub">IP: {s.ip || "—"} · Last seen: {_timeAgo(s.lastSeenAt)}</span>
          </div>
          {!s.isCurrent && (
            <button className="k2-revoke-btn" onClick={() => revoke(s.id)}>Revoke</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── K2 — Devices Panel ───────────────────────────────────────────
function DevicesPanel() {
  const [devices,  setDevices]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/devices").then(d => setDevices(d.devices || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function trust(id) {
    try {
      const d = await _fetch(`/security/device/${id}/trust`, { method: "PATCH" });
      setDevices(prev => prev.map(x => x.id === id ? d.device : x));
      doToast("Device trusted");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function remove(id) {
    try {
      await _fetch(`/security/device/${id}`, { method: "DELETE" });
      setDevices(s => s.filter(x => x.id !== id));
      doToast("Device removed");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading devices…</div>;
  return (
    <div className="k2-list">
      {toast && <div className="tw-toast">{toast}</div>}
      {devices.length === 0 && <div className="k2-empty">No devices registered. Devices are registered on login.</div>}
      {devices.map(d => (
        <div key={d.id} className="k2-row">
          <span className="k2-row-icon">{d.trusted ? "◉" : "○"}</span>
          <div className="k2-row-meta">
            <span className="k2-row-title">{d.name} {d.trusted && <span className="k2-badge k2-badge--green">Trusted</span>}</span>
            <span className="k2-row-sub">Added {_fmtTs(d.createdAt)} · Last seen {_timeAgo(d.lastSeenAt)}</span>
          </div>
          <div className="k2-row-actions">
            {!d.trusted && <button className="k2-trust-btn" onClick={() => trust(d.id)}>Trust</button>}
            <button className="k2-revoke-btn" onClick={() => remove(d.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── K2 — Audit Log Panel ─────────────────────────────────────────
function AuditPanel() {
  const [log,     setLog]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/security/audit?limit=100").then(d => setLog(d.audit || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ACTION_COLOR = {
    "session":  "var(--accent)",
    "device":   "var(--accent2)",
    "token":    "var(--warning)",
    "policy":   "#52d68a",
    "workspace":"var(--text-dim)",
  };
  const color = (action) => {
    const key = Object.keys(ACTION_COLOR).find(k => action.startsWith(k));
    return key ? ACTION_COLOR[key] : "var(--text-faint)";
  };

  if (loading) return <div className="k2-loading">Loading audit log…</div>;
  return (
    <div className="k2-audit-list">
      {log.length === 0 && <div className="k2-empty">No audit events yet.</div>}
      {log.map((e, i) => (
        <div key={e.id || i} className="k2-audit-row">
          <span className="k2-audit-dot" style={{ background: color(e.action || "") }} />
          <span className="k2-audit-ts">{_timeAgo(e.ts)}</span>
          <span className="k2-audit-action" style={{ color: color(e.action || "") }}>{e.action}</span>
          {e.detail && <span className="k2-audit-detail">{e.detail}</span>}
          <span className={`k2-badge k2-badge--${e.outcome === "success" ? "green" : "red"}`}>{e.outcome}</span>
        </div>
      ))}
    </div>
  );
}

// ── K2 — API Tokens Panel ─────────────────────────────────────────
const TOKEN_SCOPES = ["read:all", "write:missions", "write:agents", "admin:workspace", "read:analytics"];

function TokensPanel() {
  const [tokens,     setTokens]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [newName,    setNewName]    = useState("");
  const [newType,    setNewType]    = useState("pat");
  const [newScopes,  setNewScopes]  = useState(["read:all"]);
  const [newExpiry,  setNewExpiry]  = useState(90);
  const [created,    setCreated]    = useState(null); // one-time secret reveal
  const [toast,      setToast]      = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    _fetch("/security/tokens").then(d => setTokens(d.tokens || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const d = await _fetch("/security/tokens", {
        method: "POST",
        body: JSON.stringify({ name: newName, type: newType, scopes: newScopes, expiresInDays: newExpiry }),
      });
      setCreated(d.token);
      setCreating(false); setNewName(""); setNewScopes(["read:all"]); setNewType("pat");
      load();
    } catch (e) { doToast(e.message || "Failed to create token"); }
  }

  async function revoke(id) {
    try {
      await _fetch(`/security/tokens/${id}`, { method: "DELETE" });
      setTokens(t => t.filter(x => x.id !== id));
      doToast("Token revoked");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading tokens…</div>;
  return (
    <div className="k2-tokens-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      {created && (
        <div className="k2-secret-reveal">
          <div className="k2-secret-header">
            <span className="k2-badge k2-badge--green">Token created</span>
            <span className="k2-secret-note">Copy this secret now — it won't be shown again.</span>
          </div>
          <code className="k2-secret-val">{created.secret}</code>
          <button className="k2-revoke-btn" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      <div className="k2-tokens-header">
        <span>{tokens.length} active token{tokens.length !== 1 ? "s" : ""}</span>
        <button className="k2-create-btn" onClick={() => setCreating(c => !c)}>＋ New token</button>
      </div>

      {creating && (
        <div className="k2-token-form">
          <input className="k2-form-input" placeholder="Token name…" value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="k2-form-select" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="pat">Personal Access Token</option>
            <option value="service">Service Token</option>
          </select>
          <select className="k2-form-select" value={newExpiry} onChange={e => setNewExpiry(Number(e.target.value))}>
            <option value={30}>Expires in 30 days</option>
            <option value={90}>Expires in 90 days</option>
            <option value={180}>Expires in 180 days</option>
            <option value={365}>Expires in 1 year</option>
          </select>
          <div className="k2-scopes-row">
            {TOKEN_SCOPES.map(s => (
              <label key={s} className="k2-scope-chip">
                <input
                  type="checkbox" checked={newScopes.includes(s)}
                  onChange={e => setNewScopes(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))}
                />
                {s}
              </label>
            ))}
          </div>
          <div className="k2-form-actions">
            <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
            <button className="k2-create-confirm" onClick={create} disabled={!newName.trim()}>Create token</button>
          </div>
        </div>
      )}

      <div className="k2-list">
        {tokens.length === 0 && !creating && <div className="k2-empty">No active tokens. Create one to integrate external tools.</div>}
        {tokens.map(t => (
          <div key={t.id} className="k2-row">
            <span className="k2-row-icon">{t.type === "service" ? "◈" : "◎"}</span>
            <div className="k2-row-meta">
              <span className="k2-row-title">
                {t.name}
                <span className="k2-badge k2-badge--dim">{t.type}</span>
              </span>
              <span className="k2-row-sub">
                Hint: {t.secretHint} · Expires {_fmtTs(t.expiresAt)} · Last used: {_timeAgo(t.lastUsedAt)}
              </span>
            </div>
            <button className="k2-revoke-btn" onClick={() => revoke(t.id)}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K2 — Policies Panel ───────────────────────────────────────────
function PoliciesPanel() {
  const [policies, setPolicies] = useState(null);
  const [score,    setScore]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/policies")
      .then(d => { setPolicies(d.policies); setScore(d.score); })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const d = await _fetch("/security/policies", { method: "PATCH", body: JSON.stringify(policies) });
      setPolicies(d.policies);
      doToast("Policies saved");
    } catch (e) { doToast(e.message || "Save failed"); }
    setSaving(false);
  }

  if (!policies) return <div className="k2-loading">Loading policies…</div>;
  return (
    <div className="k2-policies-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      {score && <SecurityScore {...score} />}
      <div className="ws-fields" style={{ marginTop: 16 }}>
        <FieldRow label="Require MFA" hint="All workspace members must use two-factor authentication">
          <Toggle checked={policies.requireMfa} onChange={v => setPolicies(p => ({ ...p, requireMfa: v }))} />
        </FieldRow>
        <FieldRow label="Session timeout" hint="Auto-logout inactive sessions">
          <select className="ws-select" value={policies.sessionTimeoutHours}
            onChange={e => setPolicies(p => ({ ...p, sessionTimeoutHours: Number(e.target.value) }))}>
            <option value={1}>1 hour</option>
            <option value={4}>4 hours</option>
            <option value={8}>8 hours</option>
            <option value={24}>24 hours</option>
            <option value={168}>7 days</option>
          </select>
        </FieldRow>
        <FieldRow label="Max sessions per user" hint="Revoke oldest when limit exceeded">
          <select className="ws-select" value={policies.maxSessionsPerUser}
            onChange={e => setPolicies(p => ({ ...p, maxSessionsPerUser: Number(e.target.value) }))}>
            {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Enforce device trust" hint="Block unrecognised devices until trusted by Admin">
          <Toggle checked={policies.enforceDeviceTrust} onChange={v => setPolicies(p => ({ ...p, enforceDeviceTrust: v }))} />
        </FieldRow>
        <FieldRow label="Audit log" hint="Record all security events (required for compliance)">
          <Toggle checked={policies.auditLogEnabled} onChange={v => setPolicies(p => ({ ...p, auditLogEnabled: v }))} />
        </FieldRow>
        <FieldRow label="Token expiry (days)" hint="Default expiry for new API tokens">
          <select className="ws-select" value={policies.tokenExpiryDays}
            onChange={e => setPolicies(p => ({ ...p, tokenExpiryDays: Number(e.target.value) }))}>
            {[30, 60, 90, 180, 365].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="IP allowlist" hint="Comma-separated CIDR ranges. Leave blank for no restriction.">
          <input className="ws-input ws-input--mono"
            placeholder="e.g. 192.168.1.0/24, 10.0.0.1"
            value={(policies.ipAllowlist || []).join(", ")}
            onChange={e => setPolicies(p => ({
              ...p, ipAllowlist: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
            }))}
          />
        </FieldRow>
        <FieldRow label="Allowed email domains" hint="Only allow sign-in from these domains. Leave blank for any.">
          <input className="ws-input ws-input--mono"
            placeholder="e.g. company.com, partner.io"
            value={(policies.allowedDomains || []).join(", ")}
            onChange={e => setPolicies(p => ({
              ...p, allowedDomains: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
            }))}
          />
        </FieldRow>
      </div>
      <button className="ws-save-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save policies"}</button>
    </div>
  );
}

export default function WorkspaceSettings({ onNavigate }) {
  const [section, setSection] = useState("branding");
  const [brand, setBrand] = useState(() => _load(BRAND_KEY, {
    workspaceName: "My Workspace",
    businessName:  "",
    tagline:       "",
    primaryColor:  "#7c6fff",
    accentColor:   "#4ecdc4",
    logoUrl:       "",
  }));
  const [security, setSecurity] = useState(() => _load(SECURITY_KEY, {
    twoFactor:        false,
    sessionTimeout:   "24h",
    ipAllowlist:      "",
    auditLog:         true,
    apiKeyVisible:    false,
  }));
  const [notifs, setNotifs] = useState(() => _load(NOTIF_KEY, {
    emailDigest:      true,
    taskAlerts:       true,
    billingAlerts:    true,
    weeklyReport:     false,
    teamActivity:     true,
  }));
  const [toast,         setToast]        = useState(null);
  const [apiKeyShown,   setApiKeyShown]   = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(null);
  const [waForm,        setWaForm]        = useState({ token: "", phoneId: "", verifyToken: "", apiVersion: "v18.0" });
  const [waSaving,      setWaSaving]      = useState(false);

  useEffect(() => {
    track.event("workspace_settings_viewed");
    getSettingsStatus().then(s => { if (s && !s.error) setSettingsStatus(s); });
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveBrand = () => {
    _save(BRAND_KEY, brand);
    showToast("Branding saved");
    track.event("ws_branding_saved");
  };

  const saveSecurity = () => {
    _save(SECURITY_KEY, security);
    showToast("Security settings saved");
    track.event("ws_security_saved");
  };

  const saveNotifs = () => {
    _save(NOTIF_KEY, notifs);
    showToast("Notification preferences saved");
  };

  const handleIntegrationAction = (integ) => {
    if (integ.id === "whatsapp") return; // handled by dedicated form below
    if (integ.status === "check") {
      showToast(`${integ.name} is connected`);
    } else {
      showToast(`${integ.name} setup: ${integ.setup}`);
    }
    track.event("integration_action", { id: integ.id, status: integ.status });
  };

  const handleSaveWhatsApp = useCallback(async () => {
    if (!waForm.token || !waForm.phoneId) { showToast("Token and Phone ID are required"); return; }
    setWaSaving(true);
    const res = await saveWhatsAppCredentials(waForm);
    setWaSaving(false);
    if (res?.success !== false) {
      showToast("WhatsApp credentials saved");
      track.event("ws_whatsapp_saved");
      getSettingsStatus().then(s => { if (s && !s.error) setSettingsStatus(s); });
    } else {
      showToast(res.error || "Failed to save WhatsApp credentials");
    }
  }, [waForm]);

  return (
    <div className="workspace-settings page-enter">
      {toast && <div className="ws-toast" role="alert" aria-live="polite">{toast}</div>}

      <div className="ws-header">
        <div>
          <h1 className="ws-title">Workspace Settings</h1>
          <p className="ws-subtitle">Branding, team, billing, security, and integrations — all in one place.</p>
        </div>
      </div>

      <div className="ws-layout">

        {/* Sidebar nav */}
        <nav className="ws-sidenav">
          {[
            { id: "branding",      icon: "◎", label: "Branding"      },
            { id: "team",          icon: "◈", label: "Team"          },
            { id: "billing",       icon: "◉", label: "Billing"       },
            { id: "security",      icon: "⬟", label: "Security"      },
            { id: "policies",      icon: "⬡", label: "Policies"      },
            { id: "sessions",      icon: "▷", label: "Sessions"      },
            { id: "devices",       icon: "◇", label: "Devices"       },
            { id: "tokens",        icon: "◎", label: "API Tokens"    },
            { id: "auditlog",      icon: "✦", label: "Audit Log"     },
            { id: "directory",     icon: "◈", label: "Team Directory" },
            { id: "departments",   icon: "⬡", label: "Departments"   },
            { id: "orgprofile",    icon: "◉", label: "Org Profile"   },
            { id: "statistics",    icon: "▷", label: "Statistics"    },
            { id: "quotas",        icon: "◎", label: "Quotas"        },
            { id: "governance",    icon: "⬟", label: "Governance"    },
            { id: "compliance",    icon: "◉", label: "Compliance"    },
            { id: "risk",          icon: "▷", label: "Risk Matrix"   },
            { id: "policylibrary", icon: "◈", label: "Policy Library"},
            { id: "govreports",    icon: "✦", label: "Gov Reports"   },
            { id: "notifications", icon: "✦", label: "Notifications" },
            { id: "integrations",  icon: "◇", label: "Integrations"  },
          ].map(s => (
            <button
              key={s.id}
              className={`ws-nav-item${section === s.id ? " ws-nav-item--active" : ""}`}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
            >
              <span className="ws-nav-icon">{s.icon}</span>
              <span className="ws-nav-label">{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Content pane */}
        <div className="ws-pane" key={section}>

          {/* Branding */}
          {section === "branding" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Branding</h2>
              <p className="ws-section-desc">Customise your workspace identity. These settings personalise your experience within Ooplix.</p>
              <div className="ws-fields">
                <FieldRow label="Workspace name" hint="Shown in the header and reports">
                  <input className="ws-input" value={brand.workspaceName}
                    onChange={e => setBrand(b => ({ ...b, workspaceName: e.target.value }))}
                    placeholder="My Workspace" />
                </FieldRow>
                <FieldRow label="Business name" hint="Shown in email footers and outreach">
                  <input className="ws-input" value={brand.businessName}
                    onChange={e => setBrand(b => ({ ...b, businessName: e.target.value }))}
                    placeholder="Your Business Name" />
                </FieldRow>
                <FieldRow label="Tagline" hint="1-line description of what you do">
                  <input className="ws-input" value={brand.tagline}
                    onChange={e => setBrand(b => ({ ...b, tagline: e.target.value }))}
                    placeholder="E.g. Lead automation for consultants" />
                </FieldRow>
                <FieldRow label="Primary color" hint="Accent color for reports and exports">
                  <div className="ws-color-row">
                    <input type="color" className="ws-color-input" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))} />
                    <input className="ws-input ws-input--mono" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))}
                      placeholder="#7c6fff" />
                  </div>
                </FieldRow>
                <FieldRow label="Logo URL" hint="Link to your logo image (optional)">
                  <input className="ws-input" value={brand.logoUrl}
                    onChange={e => setBrand(b => ({ ...b, logoUrl: e.target.value }))}
                    placeholder="https://yoursite.com/logo.png" />
                </FieldRow>
              </div>
              <button className="ws-save-btn" onClick={saveBrand}>Save branding</button>
            </div>
          )}

          {/* Team */}
          {section === "team" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Team</h2>
              <p className="ws-section-desc">Manage team members and roles from the Team Workspace.</p>
              <div className="ws-team-shortcut">
                <div className="ws-ts-body">
                  <p className="ws-ts-title">Team Workspace</p>
                  <p className="ws-ts-sub">Invite members, assign roles (Owner → Viewer), and view workspace activity.</p>
                </div>
                <button className="ws-ts-btn" onClick={() => onNavigate && onNavigate("team")}>
                  Open Team Workspace →
                </button>
              </div>
              <div className="ws-fields ws-fields--top">
                <FieldRow label="Workspace plan" hint="Current team capacity">
                  <span className="ws-badge">Starter — up to 3 seats</span>
                </FieldRow>
                <FieldRow label="Default role" hint="Role assigned to new invited members">
                  <select className="ws-select" aria-label="Default role for new members" onChange={e => showToast(`Default role set to ${e.target.value}`)}>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                  </select>
                </FieldRow>
              </div>
            </div>
          )}

          {/* Billing */}
          {section === "billing" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Billing</h2>
              <p className="ws-section-desc">Manage your plan, payment method, and invoices.</p>
              <div className="ws-billing-summary">
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Current plan</span>
                  <span className="ws-bill-value">Starter</span>
                  <span className="ws-bill-sub">₹999/month · Up to 100 leads</span>
                </div>
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Next billing date</span>
                  <span className="ws-bill-value">—</span>
                  <span className="ws-bill-sub">Connect billing to track</span>
                </div>
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Payment method</span>
                  <span className="ws-bill-value">—</span>
                  <span className="ws-bill-sub">Not configured</span>
                </div>
              </div>
              <div className="ws-billing-actions">
                <button className="ws-bill-cta" onClick={() => onNavigate && onNavigate("billing")}>
                  Manage billing →
                </button>
                <button className="ws-bill-secondary" onClick={() => showToast("Invoice download: connect billing via Manage billing → to enable")}>Download invoices</button>
              </div>
              <div className="ws-billing-plans">
                <p className="ws-section-label">Upgrade options</p>
                {[
                  { name: "Starter",    price: "₹999/mo",  leads: "100 leads",  seats: "1 seat",  highlight: false },
                  { name: "Growth",     price: "₹2,499/mo", leads: "1,000 leads",seats: "5 seats", highlight: true  },
                  { name: "Scale",      price: "Custom",    leads: "Unlimited",  seats: "Unlimited", highlight: false },
                ].map(p => (
                  <div key={p.name} className={`ws-plan-row${p.highlight ? " ws-plan-row--current" : ""}`}>
                    <span className="ws-plan-name">{p.name}</span>
                    <span className="ws-plan-price">{p.price}</span>
                    <span className="ws-plan-feat">{p.leads}</span>
                    <span className="ws-plan-feat">{p.seats}</span>
                    {p.highlight
                      ? <span className="ws-plan-badge">Recommended</span>
                      : <button className="ws-plan-btn" onClick={() => onNavigate && onNavigate("billing")}>Select</button>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security */}
          {section === "security" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Security</h2>
              <p className="ws-section-desc">Protect your workspace with authentication and access controls.</p>
              <div className="ws-fields">
                <FieldRow label="Two-factor authentication" hint="Require 2FA for all team members">
                  <Toggle checked={security.twoFactor}
                    onChange={v => setSecurity(s => ({ ...s, twoFactor: v }))} />
                </FieldRow>
                <FieldRow label="Session timeout" hint="Auto-logout after inactivity">
                  <select className="ws-select" value={security.sessionTimeout}
                    onChange={e => setSecurity(s => ({ ...s, sessionTimeout: e.target.value }))}>
                    <option value="1h">1 hour</option>
                    <option value="8h">8 hours</option>
                    <option value="24h">24 hours</option>
                    <option value="7d">7 days</option>
                    <option value="never">Never</option>
                  </select>
                </FieldRow>
                <FieldRow label="Audit log" hint="Record all team actions (required for compliance)">
                  <Toggle checked={security.auditLog}
                    onChange={v => setSecurity(s => ({ ...s, auditLog: v }))} />
                </FieldRow>
                <FieldRow label="IP allowlist" hint="Restrict login to specific IP ranges (leave blank to allow all)">
                  <input className="ws-input ws-input--mono" value={security.ipAllowlist}
                    onChange={e => setSecurity(s => ({ ...s, ipAllowlist: e.target.value }))}
                    placeholder="e.g. 192.168.1.0/24, 10.0.0.1" />
                </FieldRow>
                <FieldRow label="API key" hint="Use to integrate Ooplix with external tools">
                  <div className="ws-api-key-row">
                    <span className="ws-api-key-val ws-input--mono">
                      {apiKeyShown ? "API key generation not configured — contact support" : "••••••••••••••••••••••••••••••••••"}
                    </span>
                    <button className="ws-api-toggle" onClick={() => setApiKeyShown(v => !v)}>
                      {apiKeyShown ? "Hide" : "Show"}
                    </button>
                  </div>
                </FieldRow>
              </div>
              <button className="ws-save-btn" onClick={saveSecurity}>Save security settings</button>
              <div className="ws-security-note">
                <span className="ws-sec-icon">⬟</span>
                <span>For critical security events, contact <a className="ws-sec-link" href="mailto:security@ooplix.com">security@ooplix.com</a></span>
              </div>
            </div>
          )}

          {/* K2 — Workspace Policies + Security Score */}
          {section === "policies" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Policies</h2>
              <p className="ws-section-desc">Fine-grained security rules for this workspace. Changes take effect immediately.</p>
              <PoliciesPanel />
            </div>
          )}

          {/* K2 — Active Sessions */}
          {section === "sessions" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Active Sessions</h2>
              <p className="ws-section-desc">All active login sessions across workspace members. Revoke any session instantly.</p>
              <SessionsPanel />
            </div>
          )}

          {/* K2 — Trusted Devices */}
          {section === "devices" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Trusted Devices</h2>
              <p className="ws-section-desc">Devices that have accessed this workspace. Require device trust in Policies to enforce this list.</p>
              <DevicesPanel />
            </div>
          )}

          {/* K2 — API Tokens */}
          {section === "tokens" && (
            <div className="ws-section">
              <h2 className="ws-section-title">API Tokens</h2>
              <p className="ws-section-desc">Personal Access Tokens (PAT) and Service Tokens for API integrations. Secrets are shown only once on creation.</p>
              <TokensPanel />
            </div>
          )}

          {/* K2 — Security Audit Log */}
          {section === "auditlog" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Security Audit Log</h2>
              <p className="ws-section-desc">Immutable record of all security events — sessions, tokens, policy changes, device registrations.</p>
              <AuditPanel />
            </div>
          )}

          {/* K3 — Team Directory */}
          {section === "directory" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Team Directory</h2>
              <p className="ws-section-desc">All workspace members — lifecycle status, job titles, departments, and bulk management.</p>
              <TeamDirectoryPanel />
            </div>
          )}

          {/* K3 — Departments */}
          {section === "departments" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Departments</h2>
              <p className="ws-section-desc">Organise workspace members into departments for reporting and access management.</p>
              <DepartmentsPanel />
            </div>
          )}

          {/* K3 — Org Profile */}
          {section === "orgprofile" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Organisation Profile</h2>
              <p className="ws-section-desc">Public-facing details about your organisation. Used in reports and invoices.</p>
              <OrgProfilePanel />
            </div>
          )}

          {/* K3 — Statistics */}
          {section === "statistics" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Statistics</h2>
              <p className="ws-section-desc">Live snapshot of member activity, departments, and security health.</p>
              <StatisticsPanel />
            </div>
          )}

          {/* K3 — Quotas */}
          {section === "quotas" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Quotas</h2>
              <p className="ws-section-desc">Current usage against plan limits. Contact support to increase quotas.</p>
              <QuotasPanel />
            </div>
          )}

          {/* K4 — Governance Overview */}
          {section === "governance" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Governance</h2>
              <p className="ws-section-desc">Enterprise governance posture — compliance score, active policies, risk summary, and upcoming reviews.</p>
              <GovernanceOverviewPanel />
            </div>
          )}

          {/* K4 — Compliance */}
          {section === "compliance" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Compliance</h2>
              <p className="ws-section-desc">Configure active compliance frameworks, data classification, risk tolerance, and review cadence.</p>
              <CompliancePanel />
            </div>
          )}

          {/* K4 — Risk Matrix */}
          {section === "risk" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Risk Matrix</h2>
              <p className="ws-section-desc">5×5 risk matrix across access, data, deployment, compliance, and operational risk categories.</p>
              <RiskMatrixPanel />
            </div>
          )}

          {/* K4 — Policy Library */}
          {section === "policylibrary" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Policy Library</h2>
              <p className="ws-section-desc">Workspace governance policies and reusable templates (SOC 2, GDPR, HIPAA, ISO 27001, and custom).</p>
              <PolicyLibraryPanel />
            </div>
          )}

          {/* K4 — Governance Reports */}
          {section === "govreports" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Governance Reports</h2>
              <p className="ws-section-desc">Aggregated governance report — policy breakdown, audit event summary, member stats. No new log storage.</p>
              <GovReportsPanel />
            </div>
          )}

          {/* Notifications */}
          {section === "notifications" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Notifications</h2>
              <p className="ws-section-desc">Choose what Ooplix notifies you about and how.</p>
              <div className="ws-fields">
                {[
                  { key: "emailDigest",   label: "Daily email digest",       hint: "Summary of activity sent each morning"            },
                  { key: "taskAlerts",    label: "Task completion alerts",    hint: "Notified when an automated task completes"        },
                  { key: "billingAlerts", label: "Billing alerts",            hint: "Invoice receipts and payment failures"            },
                  { key: "weeklyReport",  label: "Weekly performance report", hint: "Revenue, leads, and activity summary every Monday"},
                  { key: "teamActivity",  label: "Team activity updates",     hint: "When team members join, leave, or change roles"   },
                ].map(n => (
                  <FieldRow key={n.key} label={n.label} hint={n.hint}>
                    <Toggle
                      checked={!!notifs[n.key]}
                      onChange={v => setNotifs(prev => ({ ...prev, [n.key]: v }))}
                    />
                  </FieldRow>
                ))}
              </div>
              <button className="ws-save-btn" onClick={saveNotifs}>Save preferences</button>
            </div>
          )}

          {/* Integrations */}
          {section === "integrations" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Integrations</h2>
              <p className="ws-section-desc">Connect Ooplix to the tools your business already uses.</p>
              <div className="ws-integrations-list">
                {INTEGRATIONS.map(integ => {
                  const liveConnected = integ.id === "whatsapp"
                    ? settingsStatus?.whatsapp?.configured
                    : integ.status === "check";
                  return (
                    <div key={integ.id} className={`ws-integ-card${liveConnected ? " ws-integ-card--connected" : ""}`}>
                      <span className="ws-integ-icon" style={{ color: integ.color }}>{integ.icon}</span>
                      <div className="ws-integ-info">
                        <div className="ws-integ-top">
                          <span className="ws-integ-name">{integ.name}</span>
                          <span className={`ws-integ-status ws-integ-status--${liveConnected ? "check" : "disconnected"}`}>
                            {liveConnected ? "Connected" : "Not connected"}
                          </span>
                        </div>
                        <span className="ws-integ-desc">{integ.desc}</span>
                        {integ.id === "whatsapp" && (
                          <div className="ws-wa-form">
                            <input className="ws-input ws-input--mono" placeholder="WA_TOKEN (Bearer token)"
                              value={waForm.token} onChange={e => setWaForm(f => ({ ...f, token: e.target.value }))} />
                            <input className="ws-input ws-input--mono" placeholder="Phone Number ID"
                              value={waForm.phoneId} onChange={e => setWaForm(f => ({ ...f, phoneId: e.target.value }))} />
                            <input className="ws-input ws-input--mono" placeholder="Verify Token (webhook)"
                              value={waForm.verifyToken} onChange={e => setWaForm(f => ({ ...f, verifyToken: e.target.value }))} />
                            <button className="ws-save-btn" onClick={handleSaveWhatsApp} disabled={waSaving}>
                              {waSaving ? "Saving…" : "Save WhatsApp credentials"}
                            </button>
                          </div>
                        )}
                        {integ.id !== "whatsapp" && !liveConnected && (
                          <span className="ws-integ-setup">{integ.setup}</span>
                        )}
                      </div>
                      {integ.id !== "whatsapp" && (
                        <button
                          className={`ws-integ-btn ws-integ-btn--${liveConnected ? "connected" : "connect"}`}
                          onClick={() => handleIntegrationAction(integ)}
                        >
                          {liveConnected ? "Manage" : "Connect"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
