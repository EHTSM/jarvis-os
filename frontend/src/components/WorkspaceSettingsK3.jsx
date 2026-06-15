import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import { FieldRow } from "./WorkspaceSettingsShared";

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

export { QuotaBar, TeamDirectoryPanel, DepartmentsPanel, OrgProfilePanel, StatisticsPanel, QuotasPanel };
