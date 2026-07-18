import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import "./OrgAdminCenter.css";

// Real multi-tenant org management UI — the first frontend consumer of
// backend/routes/organizations.js (V2 multi-tenant mission, Modules 1-4).
// Covers the Org → Department → Team → Member hierarchy and RBAC roles
// already fully implemented in organizationService.cjs.

const ROLE_COLOR = {
  org_owner: "var(--warning)",
  org_admin: "var(--accent)",
  dept_lead: "var(--success)",
  team_lead: "var(--accent2)",
  member:    "var(--text-dim)",
  viewer:    "var(--text-faint)",
};

function Badge({ label, color }) {
  return <span className="oac-badge" style={{ color, borderColor: color + "44", background: color + "11" }}>{label.replace("_", " ")}</span>;
}

function Empty({ title, sub }) {
  return <div className="oac-empty"><p className="oac-empty-title">{title}</p>{sub && <p className="oac-empty-sub">{sub}</p>}</div>;
}

// ── Overview ──────────────────────────────────────────────────────────

function OverviewPanel({ org, myRole, onToast }) {
  if (!org) return <Empty title="No organization selected" sub="Use the organization switcher in the header to select or create one." />;
  return (
    <div className="oac-section">
      <div className="oac-stats-grid">
        <div className="oac-stat-card">
          <span className="oac-stat-val">{org.memberCount ?? 0}</span>
          <span className="oac-stat-label">Members</span>
        </div>
        <div className="oac-stat-card">
          <span className="oac-stat-val">{org.deptCount ?? 0}</span>
          <span className="oac-stat-label">Departments</span>
        </div>
        <div className="oac-stat-card">
          <span className="oac-stat-val" style={{ textTransform: "capitalize" }}>{org.plan || "free"}</span>
          <span className="oac-stat-label">Plan</span>
        </div>
        <div className="oac-stat-card">
          <Badge label={myRole || "—"} color={ROLE_COLOR[myRole] || "var(--text-faint)"} />
          <span className="oac-stat-label" style={{ marginTop: 6 }}>Your role</span>
        </div>
      </div>
      <div className="oac-meta-row">
        <span className="oac-meta-label">Slug</span>
        <span className="oac-meta-val">{org.slug}</span>
      </div>
      <div className="oac-meta-row">
        <span className="oac-meta-label">Created</span>
        <span className="oac-meta-val">{org.createdAt ? new Date(org.createdAt).toLocaleDateString() : "—"}</span>
      </div>
      {org.description && (
        <div className="oac-meta-row">
          <span className="oac-meta-label">Description</span>
          <span className="oac-meta-val">{org.description}</span>
        </div>
      )}
    </div>
  );
}

// ── Members ───────────────────────────────────────────────────────────

const ORG_ROLES = ["org_admin", "dept_lead", "team_lead", "member", "viewer"];

function MembersPanel({ orgId, myRole, canManage, onToast }) {
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({ accountId: "", orgRole: "member" });
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch(`/orgs/${orgId}/members`).catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setMembers(r.members || []);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.accountId.trim()) { onToast?.("error", "Account ID is required"); return; }
    setBusy(true);
    const r = await _fetch(`/orgs/${orgId}/members`, { method: "POST", body: JSON.stringify(addForm) }).catch(e => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok === false) onToast?.("error", r.error || "Failed to add member");
    else { onToast?.("success", "Member added"); setShowAdd(false); setAddForm({ accountId: "", orgRole: "member" }); load(); }
  };

  const handleRoleChange = async (accountId, orgRole) => {
    const r = await _fetch(`/orgs/${orgId}/members/${accountId}`, { method: "PATCH", body: JSON.stringify({ orgRole }) }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) onToast?.("error", r.error || "Failed to update role");
    else { onToast?.("success", "Role updated"); load(); }
  };

  const handleRemove = async (accountId) => {
    const r = await _fetch(`/orgs/${orgId}/members/${accountId}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) onToast?.("error", r.error || "Failed to remove member");
    else { onToast?.("success", "Member removed"); load(); }
  };

  if (loading) return <div className="oac-loading">Loading members…</div>;

  return (
    <div className="oac-section">
      <div className="oac-section-header">
        <h3 className="oac-section-title">Members</h3>
        {canManage && <button className="oac-btn primary" onClick={() => setShowAdd(s => !s)}>{showAdd ? "Cancel" : "+ Add member"}</button>}
      </div>

      {showAdd && (
        <div className="oac-form-card">
          <input className="oac-input" placeholder="Account ID" value={addForm.accountId} onChange={e => setAddForm(f => ({ ...f, accountId: e.target.value }))} />
          <select className="oac-select" value={addForm.orgRole} onChange={e => setAddForm(f => ({ ...f, orgRole: e.target.value }))}>
            {ORG_ROLES.map(r => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
          </select>
          <button className="oac-btn primary" onClick={handleAdd} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        </div>
      )}

      {!members?.length ? <Empty title="No members" /> : (
        <table className="oac-table">
          <thead><tr><th>Account</th><th>Role</th><th>Joined</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.accountId}>
                <td className="oac-td-name">{m.accountId}</td>
                <td>
                  {canManage && m.orgRole !== "org_owner" ? (
                    <select className="oac-select oac-select--inline" value={m.orgRole} onChange={e => handleRoleChange(m.accountId, e.target.value)}>
                      {ORG_ROLES.map(r => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                    </select>
                  ) : (
                    <Badge label={m.orgRole} color={ROLE_COLOR[m.orgRole] || "var(--text-faint)"} />
                  )}
                </td>
                <td className="oac-td-dim">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : "—"}</td>
                {canManage && (
                  <td className="oac-td-actions">
                    {m.orgRole !== "org_owner" && <button className="oac-icon-btn danger" title="Remove" onClick={() => handleRemove(m.accountId)}>🗑</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Departments ───────────────────────────────────────────────────────

function DepartmentsPanel({ orgId, canManage, onToast }) {
  const [depts, setDepts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch(`/orgs/${orgId}/departments`).catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setDepts(r.departments || []);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await _fetch(`/orgs/${orgId}/departments`, { method: "POST", body: JSON.stringify({ name }) }).catch(e => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok === false) onToast?.("error", r.error || "Failed to create department");
    else { onToast?.("success", "Department created"); setName(""); setShowAdd(false); load(); }
  };

  const handleDelete = async (deptId) => {
    const r = await _fetch(`/orgs/${orgId}/departments/${deptId}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) onToast?.("error", r.error || "Failed to delete department");
    else { onToast?.("success", "Department deleted"); load(); }
  };

  if (loading) return <div className="oac-loading">Loading departments…</div>;

  return (
    <div className="oac-section">
      <div className="oac-section-header">
        <h3 className="oac-section-title">Departments</h3>
        {canManage && <button className="oac-btn primary" onClick={() => setShowAdd(s => !s)}>{showAdd ? "Cancel" : "+ New department"}</button>}
      </div>

      {showAdd && (
        <div className="oac-form-card">
          <input className="oac-input" placeholder="Department name" value={name} onChange={e => setName(e.target.value)} />
          <button className="oac-btn primary" onClick={handleAdd} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</button>
        </div>
      )}

      {!depts?.length ? <Empty title="No departments" sub="Departments group teams within your organization." /> : (
        <div className="oac-card-list">
          {depts.map(d => (
            <div key={d.id} className="oac-card">
              <div className="oac-card-top">
                <span className="oac-card-name">{d.name}</span>
                {canManage && <button className="oac-icon-btn danger" onClick={() => handleDelete(d.id)}>🗑</button>}
              </div>
              {d.description && <p className="oac-card-desc">{d.description}</p>}
              <span className="oac-card-meta">{(d.teams || []).length} team{(d.teams || []).length === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const VIEWS = [
  { id: "overview",    label: "Overview"    },
  { id: "members",     label: "Members"     },
  { id: "departments", label: "Departments" },
];

export default function OrgAdminCenter({ onToast }) {
  const [view, setView] = useState("overview");
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadCtx = useCallback(async () => {
    setLoading(true);
    const r = await _fetch("/orgs/me/context").catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setCtx(r);
  }, []);

  useEffect(() => { loadCtx(); }, [loadCtx]);

  const primary = ctx?.primaryOrg;
  const orgId   = primary?.orgId;
  const canManage = primary && ["org_owner", "org_admin"].includes(primary.orgRole);

  const [orgDetail, setOrgDetail] = useState(null);
  useEffect(() => {
    if (!orgId) return;
    _fetch(`/orgs/${orgId}`).then(r => { if (r.ok !== false) setOrgDetail(r.org); }).catch(() => {});
  }, [orgId]);

  if (loading) return <div className="org-admin-center oac-loading">Loading organization…</div>;

  if (!orgId) {
    return (
      <div className="org-admin-center page-enter">
        <div className="oac-header">
          <h1 className="oac-title">Organization</h1>
          <p className="oac-subtitle">Manage your company's members, departments, and settings.</p>
        </div>
        <Empty title="No organization yet" sub="Use the organization switcher in the header (◈ icon) to create your first organization." />
      </div>
    );
  }

  return (
    <div className="org-admin-center page-enter">
      <div className="oac-header">
        <div>
          <h1 className="oac-title">{orgDetail?.name || primary.orgName}</h1>
          <p className="oac-subtitle">Manage members, departments, and organization settings.</p>
        </div>
      </div>

      <nav className="oac-subnav">
        {VIEWS.map(v => (
          <button key={v.id} className={`oac-subnav-btn ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="oac-content">
        {view === "overview"    && <OverviewPanel org={orgDetail} myRole={primary.orgRole} onToast={onToast} />}
        {view === "members"     && <MembersPanel orgId={orgId} myRole={primary.orgRole} canManage={canManage} onToast={onToast} />}
        {view === "departments" && <DepartmentsPanel orgId={orgId} canManage={canManage} onToast={onToast} />}
      </div>
    </div>
  );
}
