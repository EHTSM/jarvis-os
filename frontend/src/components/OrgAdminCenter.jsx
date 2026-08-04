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

function OverviewPanel({ org, myRole, onToast, onReload }) {
  const [busy, setBusy] = useState(false);
  if (!org) return <Empty title="No organization selected" sub="Use the organization switcher in the header to select or create one." />;

  const isArchived = org.status === "archived";

  const handleArchive = async () => {
    if (!window.confirm(`Archive "${org.name}"? Members will lose access until it's restored. Data is preserved and this can be undone.`)) return;
    setBusy(true);
    const r = await _fetch(`/orgs/${org.id}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok === false) onToast?.("error", r.error || "Failed to archive organization");
    else { onToast?.("success", "Organization archived"); onReload?.(); }
  };

  const handleRestore = async () => {
    setBusy(true);
    const r = await _fetch(`/orgs/${org.id}/restore`, { method: "POST" }).catch(e => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok === false) onToast?.("error", r.error || "Failed to restore organization");
    else { onToast?.("success", "Organization restored"); onReload?.(); }
  };

  return (
    <div className="oac-section">
      {isArchived && (
        <div className="oac-empty" style={{ borderColor: "var(--warning)", padding: "16px 20px" }}>
          <p className="oac-empty-title" style={{ color: "var(--warning)" }}>This organization is archived</p>
          <p className="oac-empty-sub">Members cannot access it while archived. Restore it to resume normal access.</p>
          <button className="oac-btn primary" disabled={busy} onClick={handleRestore} style={{ marginTop: 8 }}>Restore organization</button>
        </div>
      )}
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
      {myRole === "org_owner" && !isArchived && (
        <div className="oac-section" style={{ marginTop: 8 }}>
          <h3 className="oac-section-title" style={{ color: "var(--danger)" }}>Danger zone</h3>
          <div className="oac-form-card" style={{ justifyContent: "space-between" }}>
            <span className="oac-card-desc">Archive this organization. Data is preserved; members lose access until restored.</span>
            <button className="oac-btn" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} disabled={busy} onClick={handleArchive}>
              Archive organization
            </button>
          </div>
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

// ── Cross-org grants (Module 6) ─────────────────────────────────────────
// Lets an org_owner give another account (not a member) a fixed set of
// permissions on this org — e.g. an agency or portfolio-owner account that
// needs visibility into a client org without joining it.

const GRANTABLE_ACTIONS = ["view_missions", "view_members", "view_departments", "view_teams", "view_analytics"];

// ── Executive Intelligence ───────────────────────────────────────────────
// V6 Phase 6 recovery: backend/routes/orgExecutiveIntelligence.js (/org-executive/:orgId/*)
// was fully built (V5 Global AI Organization Platform, Module 6) with zero
// frontend consumers until this panel.

function ExecIntelPanel({ orgId, onToast }) {
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState(null);
  const [recs, setRecs] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      _fetch(`/org-executive/${orgId}/summary`).catch(e => ({ ok: false, error: e.message })),
      _fetch(`/org-executive/${orgId}/insights`).catch(e => ({ ok: false, error: e.message })),
      _fetch(`/org-executive/${orgId}/recommendations`).catch(e => ({ ok: false, error: e.message })),
      _fetch(`/org-executive/${orgId}/forecast`).catch(e => ({ ok: false, error: e.message })),
    ]).then(([s, i, r, f]) => {
      setSummary(s.ok !== false ? s : null);
      setInsights(i.ok !== false ? i : null);
      setRecs(r.ok !== false ? r.recommendations : []);
      setForecast(f.ok !== false ? f : null);
      setError(s.ok === false ? (s.error || "Failed to load executive intelligence") : null);
    }).finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !summary) return <div className="oac-loading">Loading executive intelligence…</div>;
  if (error && !summary) return <Empty title="Couldn't load executive intelligence" sub={error} />;

  return (
    <div>
      {summary?.summary && (
        <div className="oac-panel" style={{ marginBottom: 16 }}>
          {summary.summary.map((line, i) => <p key={i} style={{ margin: "4px 0", fontSize: 13 }}>{line}</p>)}
        </div>
      )}

      {insights && (
        <div className="oac-panel" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <div><div style={{ fontSize: 18, fontWeight: 800 }}>{insights.connectorHealthScore ?? "—"}</div><div style={{ fontSize: 10, opacity: 0.7 }}>Connector Health</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 800 }}>${insights.aiSpendUsd ?? 0}</div><div style={{ fontSize: 10, opacity: 0.7 }}>AI Spend (sampled)</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 800 }}>{insights.knowledgeNodeCount ?? 0}</div><div style={{ fontSize: 10, opacity: 0.7 }}>Knowledge Nodes</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 800 }}>{insights.automationRulesActive ?? 0}</div><div style={{ fontSize: 10, opacity: 0.7 }}>Active Automations</div></div>
        </div>
      )}

      {recs && recs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", opacity: 0.7, marginBottom: 8 }}>Recommendations</div>
          {recs.map(r => (
            <div key={r.id} style={{ padding: "8px 10px", marginBottom: 6, borderRadius: 5, background: r.severity === "critical" ? "rgba(245,91,91,0.1)" : "rgba(240,180,41,0.1)", fontSize: 12 }}>
              {r.text}
            </div>
          ))}
        </div>
      )}

      {forecast && !forecast.insufficientData && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Projected AI spend over next {forecast.projectionDays} days: ~${forecast.projectedTotalCostUsd} (based on {forecast.historicalDays} real days of usage history)
        </div>
      )}
      {forecast?.insufficientData && (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Not enough usage history yet to forecast ({forecast.historicalDays} day(s) recorded).</div>
      )}
    </div>
  );
}

function GrantsPanel({ orgId, isOwner, onToast }) {
  const [grants, setGrants] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ granteeAccountId: "", permissions: ["view_missions"] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch(`/orgs/${orgId}/grants`).catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setGrants(r.grants || []);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (!isOwner) return <Empty title="Owner access required" sub="Only the organization owner can manage cross-org grants." />;

  const togglePermission = (perm) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm) ? f.permissions.filter(p => p !== perm) : [...f.permissions, perm],
    }));
  };

  const handleAdd = async () => {
    if (!form.granteeAccountId.trim()) { onToast?.("error", "Account ID is required"); return; }
    if (!form.permissions.length) { onToast?.("error", "Select at least one permission"); return; }
    setBusy(true);
    const r = await _fetch(`/orgs/${orgId}/grants`, { method: "POST", body: JSON.stringify(form) }).catch(e => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok === false) onToast?.("error", r.error || "Failed to create grant");
    else { onToast?.("success", "Access granted"); setShowAdd(false); setForm({ granteeAccountId: "", permissions: ["view_missions"] }); load(); }
  };

  const handleRevoke = async (accountId) => {
    const r = await _fetch(`/orgs/${orgId}/grants/${accountId}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) onToast?.("error", r.error || "Failed to revoke access");
    else { onToast?.("success", "Access revoked"); load(); }
  };

  if (loading) return <div className="oac-loading">Loading grants…</div>;

  return (
    <div className="oac-section">
      <div className="oac-section-header">
        <h3 className="oac-section-title">Cross-org access</h3>
        <button className="oac-btn primary" onClick={() => setShowAdd(s => !s)}>{showAdd ? "Cancel" : "+ Grant access"}</button>
      </div>
      <p className="oac-card-desc">Give another account limited access to this organization without adding them as a member.</p>

      {showAdd && (
        <div className="oac-form-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <input className="oac-input" placeholder="Account ID" value={form.granteeAccountId} onChange={e => setForm(f => ({ ...f, granteeAccountId: e.target.value }))} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {GRANTABLE_ACTIONS.map(perm => (
              <label key={perm} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-dim)" }}>
                <input type="checkbox" checked={form.permissions.includes(perm)} onChange={() => togglePermission(perm)} />
                {perm.replace("view_", "").replace("_", " ")}
              </label>
            ))}
          </div>
          <button className="oac-btn primary" onClick={handleAdd} disabled={busy} style={{ alignSelf: "flex-start" }}>{busy ? "Granting…" : "Grant access"}</button>
        </div>
      )}

      {!grants?.length ? <Empty title="No grants" sub="No external accounts have cross-org access to this organization." /> : (
        <table className="oac-table">
          <thead><tr><th>Account</th><th>Permissions</th><th>Granted</th><th></th></tr></thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.id}>
                <td className="oac-td-name">{g.granteeAccountId}</td>
                <td className="oac-td-dim">{(g.permissions || []).map(p => p.replace("view_", "")).join(", ")}</td>
                <td className="oac-td-dim">{g.grantedAt ? new Date(g.grantedAt).toLocaleDateString() : "—"}</td>
                <td className="oac-td-actions">
                  <button className="oac-icon-btn danger" title="Revoke" onClick={() => handleRevoke(g.granteeAccountId)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Invite team (Module 4) ──────────────────────────────────────────────
// Workspace-based email invites (workspaceService.createInvitation), distinct
// from the org "Members" tab above which requires already knowing the
// invitee's accountId. This is the actual "invite a teammate who doesn't have
// an account yet" flow — they get an emailed link, sign up/log in, and land
// as a workspace member.
const WS_ROLES = ["Admin", "Operator", "Developer", "Viewer"];

function InviteTeamPanel({ onToast }) {
  const [workspaceId, setWorkspaceId] = useState(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [members, setMembers] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: "", role: "Operator" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const wsList = await _fetch("/workspace").catch(() => ({ workspaces: [] }));
    const activeId = wsList.activeWorkspaceId || wsList.workspaces?.[0]?.id;
    if (!activeId) { setLoading(false); return; }
    setWorkspaceId(activeId);
    const active = wsList.workspaces?.find(w => w.id === activeId);
    setWorkspaceName(active?.name || "");
    setPending((active?.invitations || []).filter(i => !i.usedAt));

    const memRes = await _fetch(`/workspace/${activeId}/members`).catch(() => ({ members: [] }));
    setMembers(memRes.members || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!form.email.trim()) { onToast?.("error", "Email is required"); return; }
    setBusy(true);
    const r = await _fetch("/workspace/invite", {
      method: "POST",
      body: JSON.stringify({ workspaceId, email: form.email.trim(), role: form.role }),
    }).catch(e => ({ error: e.message }));
    setBusy(false);
    if (r.error) { onToast?.("error", r.error); return; }
    onToast?.("success", r.emailSent ? "Invite sent" : "Invite created (email delivery unavailable — share the link manually)");
    setForm({ email: "", role: "Operator" });
    setShowInvite(false);
    load();
  };

  const handleRemove = async (accountId) => {
    const r = await _fetch(`/workspace/${workspaceId}/members/${accountId}`, { method: "DELETE" }).catch(e => ({ error: e.message }));
    if (r.error) onToast?.("error", r.error);
    else { onToast?.("success", "Member removed"); load(); }
  };

  if (loading) return <div className="oac-loading">Loading team…</div>;

  if (!workspaceId) {
    return <Empty title="No workspace yet" sub="A workspace is created automatically with your organization." />;
  }

  return (
    <div className="oac-section">
      <div className="oac-section-header">
        <h3 className="oac-section-title">{workspaceName || "Team"}</h3>
        <button className="oac-btn primary" onClick={() => setShowInvite(s => !s)}>{showInvite ? "Cancel" : "+ Invite teammate"}</button>
      </div>

      {showInvite && (
        <div className="oac-form-card">
          <input className="oac-input" type="email" placeholder="teammate@company.com"
            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <select className="oac-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {WS_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="oac-btn primary" onClick={handleInvite} disabled={busy}>{busy ? "Sending…" : "Send invite"}</button>
        </div>
      )}

      {!members?.length ? <Empty title="No teammates yet" sub="Invite a teammate to collaborate in this workspace." /> : (
        <table className="oac-table">
          <thead><tr><th>Account</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.accountId}>
                <td className="oac-td-name">{m.email || m.name || m.accountId}</td>
                <td><Badge label={m.role} color={m.role === "Owner" ? "var(--warning)" : "var(--text-dim)"} /></td>
                <td className="oac-td-actions">
                  {m.role !== "Owner" && <button className="oac-icon-btn danger" title="Remove" onClick={() => handleRemove(m.accountId)}>🗑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="oac-section-title" style={{ marginTop: 8 }}>Pending invites</h3>
          <table className="oac-table">
            <thead><tr><th>Email</th><th>Role</th><th>Expires</th></tr></thead>
            <tbody>
              {pending.map((inv, i) => (
                <tr key={i}>
                  <td className="oac-td-name">{inv.email}</td>
                  <td className="oac-td-dim">{inv.role}</td>
                  <td className="oac-td-dim">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const VIEWS = [
  { id: "overview",    label: "Overview"    },
  { id: "invite",      label: "Invite Team" },
  { id: "members",     label: "Roles"       },
  { id: "departments", label: "Departments" },
  { id: "grants",      label: "Cross-org access" },
  { id: "execintel",   label: "Executive Intelligence" },
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
  const loadDetail = useCallback(() => {
    if (!orgId) return;
    _fetch(`/orgs/${orgId}`).then(r => { if (r.ok !== false) setOrgDetail(r.org); }).catch(() => {});
  }, [orgId]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const handleOverviewReload = () => { loadCtx(); loadDetail(); };

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
        {view === "overview"    && <OverviewPanel org={orgDetail} myRole={primary.orgRole} onToast={onToast} onReload={handleOverviewReload} />}
        {view === "invite"      && <InviteTeamPanel onToast={onToast} />}
        {view === "members"     && <MembersPanel orgId={orgId} myRole={primary.orgRole} canManage={canManage} onToast={onToast} />}
        {view === "departments" && <DepartmentsPanel orgId={orgId} canManage={canManage} onToast={onToast} />}
        {view === "grants"      && <GrantsPanel orgId={orgId} isOwner={primary.orgRole === "org_owner"} onToast={onToast} />}
        {view === "execintel"   && <ExecIntelPanel orgId={orgId} onToast={onToast} />}
      </div>
    </div>
  );
}
