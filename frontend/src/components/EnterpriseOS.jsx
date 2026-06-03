import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getEnterpriseDashboard, getEnterpriseDailySummary, getEnterpriseWeeklySummary, getEnterpriseComplianceSummary,
  getEnterpriseStats, getEnterpriseOrgs, createEnterpriseOrg, updateEnterpriseOrg, archiveEnterpriseOrg,
  getEnterpriseDepts, createEnterpriseDept, updateEnterpriseDept, archiveEnterpriseDept,
  getEnterpriseTeams, createEnterpriseTeam, updateEnterpriseTeam, archiveEnterpriseTeam,
  addEnterpriseTeamMember, removeEnterpriseTeamMember,
  getEnterpriseRoles, createEnterpriseRole, updateEnterpriseRole, deprecateEnterpriseRole,
  getEnterprisePermissions, grantEnterprisePermission, updateEnterprisePermission, revokeEnterprisePermission,
  getEnterprisePolicies, createEnterprisePolicy, updateEnterprisePolicy, enforceEnterprisePolicy, archiveEnterprisePolicy,
  logEnterpriseAuditEvent, getEnterpriseAuditEvents, getEnterpriseAuditStats,
} from "../enterpriseApi";
import "./EnterpriseOS.css";

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "orgs", label: "Organizations" },
  { id: "depts", label: "Departments" },
  { id: "teams", label: "Teams" },
  { id: "roles", label: "Roles" },
  { id: "permissions", label: "Permissions" },
  { id: "policies", label: "Policies" },
  { id: "audit", label: "Audit" },
];

const INDUSTRY_OPTIONS = ["tech", "finance", "healthcare", "retail", "education", "other"];
const PLAN_OPTIONS = ["free", "starter", "growth", "enterprise"];
const STATUS_OPTIONS = ["all", "active", "suspended", "archived", "deprecated"];
const TEAM_TYPES = ["engineering", "product", "design", "ops", "sales", "support", "other"];
const ROLE_SCOPES = ["org", "dept", "team", "global"];
const POLICY_TYPES = ["access", "data", "security", "compliance", "operational", "other"];
const ENFORCEMENT_OPTIONS = ["advisory", "warn", "block"];

function _timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function _fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function _fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" });
}

function _parseArray(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function _label(value) {
  return String(value || "").replace(/\b\w/g, ch => ch.toUpperCase());
}

function Badge({ text, color }) {
  return <span className="eos-badge" style={{ background: `${color}22`, color }}>{text}</span>;
}

function Skeleton() {
  return <div className="eos-loading"><div className="eos-skeleton" /><div className="eos-skeleton eos-skeleton--sm" /></div>;
}

function EmptyState({ title, description }) {
  return (
    <div className="eos-empty">
      <div className="eos-empty-title">{title}</div>
      <div className="eos-empty-text">{description}</div>
    </div>
  );
}

export default function EnterpriseOS({ onToast }) {
  const [view, setView] = useState("overview");

  return (
    <div className="eos-wrap">
      <div className="eos-header">
        <div>
          <h2>Enterprise OS</h2>
          <p>Govern organizations, departments, teams, roles, permissions, policies, and audit activity.</p>
        </div>
      </div>
      <div className="eos-nav">
        {VIEWS.map(tab => (
          <button
            key={tab.id}
            className={`eos-tab ${view === tab.id ? "active" : ""}`}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="eos-view">
        {view === "overview" && <OverviewView onToast={onToast} />}
        {view === "orgs" && <OrganizationsView onToast={onToast} />}
        {view === "depts" && <DepartmentsView onToast={onToast} />}
        {view === "teams" && <TeamsView onToast={onToast} />}
        {view === "roles" && <RolesView onToast={onToast} />}
        {view === "permissions" && <PermissionsView onToast={onToast} />}
        {view === "policies" && <PoliciesView onToast={onToast} />}
        {view === "audit" && <AuditView onToast={onToast} />}
      </div>
    </div>
  );
}

function OverviewView({ onToast }) {
  const [dashboard, setDashboard] = useState(null);
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [stats, setStats] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [dash, day, week, stat, orgResp] = await Promise.all([
      getEnterpriseDashboard(),
      getEnterpriseDailySummary(),
      getEnterpriseWeeklySummary(),
      getEnterpriseStats(),
      getEnterpriseOrgs({ limit: 100 }),
    ]);

    if (dash.success !== false) setDashboard(dash);
    if (day.success !== false) setDaily(day);
    if (week.success !== false) setWeekly(week);
    if (stat.success !== false) setStats(stat);
    setOrgs(orgResp.orgs ?? []);
    setSelectedOrg(orgResp.orgs?.[0]?.orgId || "");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    if (!selectedOrg) return;
    (async () => {
      const r = await getEnterpriseComplianceSummary(selectedOrg);
      if (active && r.success !== false) setCompliance(r);
    })();
    return () => { active = false; };
  }, [selectedOrg]);

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Enterprise Dashboard</h3>
          <div className="eos-subtitle">High-level health and governance metrics.</div>
        </div>
        <button className="eos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="eos-grid">
        <div className="eos-card">
          <div className="eos-card-title">Organizations</div>
          <div className="eos-card-value">{dashboard?.organization?.total ?? 0}</div>
          <div className="eos-card-meta">{dashboard?.organization?.active ?? 0} active</div>
        </div>
        <div className="eos-card">
          <div className="eos-card-title">Departments</div>
          <div className="eos-card-value">{dashboard?.departments?.total ?? 0}</div>
          <div className="eos-card-meta">{dashboard?.departments?.active ?? 0} active</div>
        </div>
        <div className="eos-card">
          <div className="eos-card-title">Teams</div>
          <div className="eos-card-value">{dashboard?.teams?.total ?? 0}</div>
          <div className="eos-card-meta">{dashboard?.teams?.active ?? 0} active</div>
        </div>
        <div className="eos-card">
          <div className="eos-card-title">Roles</div>
          <div className="eos-card-value">{dashboard?.roles?.total ?? 0}</div>
          <div className="eos-card-meta">Active roles</div>
        </div>
        <div className="eos-card">
          <div className="eos-card-title">Permissions</div>
          <div className="eos-card-value">{dashboard?.permissions?.active ?? 0}</div>
          <div className="eos-card-meta">Active grants</div>
        </div>
        <div className="eos-card">
          <div className="eos-card-title">Policies</div>
          <div className="eos-card-value">{dashboard?.governance?.activePolicies ?? 0}</div>
          <div className="eos-card-meta">Active policies</div>
        </div>
      </div>

      <div className="eos-split-row">
        <div className="eos-box">
          <h4>Recent Audit</h4>
          {dashboard?.recentAudit?.length > 0 ? (
            <div className="eos-list">
              {dashboard.recentAudit.map(event => (
                <div key={event.eventId} className="eos-list-item">
                  <div>
                    <span className="eos-list-strong">{event.action}</span>
                    <div className="eos-list-sub">{event.detail}</div>
                  </div>
                  <div className="eos-list-meta">{_timeAgo(event.ts)}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No audit events" description="No recent audit activity found." />}
        </div>

        <div className="eos-box">
          <h4>Compliance Summary</h4>
          <label className="eos-label">Organization</label>
          <select
            className="eos-select"
            value={selectedOrg}
            onChange={e => setSelectedOrg(e.target.value)}
          >
            <option value="">Select organization</option>
            {orgs.map(org => (
              <option key={org.orgId} value={org.orgId}>{org.name}</option>
            ))}
          </select>
          {compliance ? (
            <div className="eos-box-sub">
              <div className="eos-box-row">
                <div>Score</div>
                <div><strong>{compliance.complianceScore ?? 0}%</strong></div>
              </div>
              <div className="eos-box-row">
                <div>Active policies</div>
                <div>{compliance.activePolicies ?? 0}</div>
              </div>
              <div className="eos-box-row">
                <div>Violations</div>
                <div>{compliance.policiesWithViolations ?? 0}</div>
              </div>
              <div className="eos-box-row">
                <div>Missing coverage</div>
                <div>{(compliance.missingCoverage || []).join(", ") || "None"}</div>
              </div>
            </div>
          ) : <EmptyState title="Compliance summary unavailable" description="Choose an organization to view compliance." />}
        </div>
      </div>

      <div className="eos-split-row">
        <div className="eos-box">
          <h4>Daily Summary</h4>
          {daily ? (
            <div className="eos-box-sub">
              <div className="eos-box-row"><div>Audit events</div><div>{daily.auditEvents ?? 0}</div></div>
              <div className="eos-box-row"><div>New organizations</div><div>{daily.newOrgs ?? 0}</div></div>
              <div className="eos-box-row"><div>New teams</div><div>{daily.newTeams ?? 0}</div></div>
              <div className="eos-box-row"><div>Violations</div><div>{daily.violations ?? 0}</div></div>
            </div>
          ) : <EmptyState title="Daily summary unavailable" description="Unable to load today’s enterprise summary." />}
        </div>

        <div className="eos-box">
          <h4>Weekly Summary</h4>
          {weekly ? (
            <div className="eos-box-sub">
              <div className="eos-box-row"><div>New organizations</div><div>{weekly.newOrgs ?? 0}</div></div>
              <div className="eos-box-row"><div>New teams</div><div>{weekly.newTeams ?? 0}</div></div>
              <div className="eos-box-row"><div>Audit events</div><div>{weekly.auditEvents ?? 0}</div></div>
              <div className="eos-box-row"><div>Violations</div><div>{weekly.violations ?? 0}</div></div>
            </div>
          ) : <EmptyState title="Weekly summary unavailable" description="Unable to load weekly enterprise metrics." />}
        </div>
      </div>
    </div>
  );
}

function OrganizationsView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ name: "", description: "", industry: "other", plan: "free", ownerId: "", tags: "" });
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getEnterpriseOrgs({ status: filter === "all" ? undefined : filter, limit: 200 });
    setOrgs(r.orgs ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const clearForm = () => {
    setForm({ name: "", description: "", industry: "other", plan: "free", ownerId: "", tags: "" });
    setEditing(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { onToast?.("error", "Organization name is required"); return; }
    const payload = { ...form, tags: _parseArray(form.tags) };
    const result = editing ? await updateEnterpriseOrg(editing, payload) : await createEnterpriseOrg(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to save organization");
      return;
    }
    onToast?.("success", editing ? "Organization updated" : "Organization created");
    clearForm();
    load();
  };

  const handleEdit = (org) => {
    setEditing(org.orgId);
    setForm({
      name: org.name || "",
      description: org.description || "",
      industry: org.industry || "other",
      plan: org.plan || "free",
      ownerId: org.ownerId || "",
      tags: (org.tags || []).join(", "),
    });
  };

  const handleArchive = async (orgId) => {
    const r = await archiveEnterpriseOrg(orgId);
    if (r.success === false || r.ok === false) {
      onToast?.("error", r.error || "Archive failed");
      return;
    }
    onToast?.("success", "Organization archived");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Organizations</h3>
          <div className="eos-subtitle">Create, update, and archive organization records.</div>
        </div>
        <button className="eos-btn outline" onClick={clearForm}>New organization</button>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel">
          <label className="eos-label">Name</label>
          <input className="eos-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="eos-label">Description</label>
          <textarea className="eos-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="eos-label">Industry</label>
          <select className="eos-select" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
            {INDUSTRY_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Plan</label>
          <select className="eos-select" value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
            {PLAN_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Owner ID</label>
          <input className="eos-input" value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))} />
          <label className="eos-label">Tags</label>
          <input className="eos-input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="comma-separated" />
          <div className="eos-form-actions">
            <button className="eos-btn" onClick={handleSave}>{editing ? "Update" : "Create"}</button>
            {editing && <button className="eos-btn outline" onClick={clearForm}>Cancel</button>}
          </div>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Status</label>
              <select className="eos-select" value={filter} onChange={e => setFilter(e.target.value)}>
                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
          </div>
          {orgs.length === 0 ? <EmptyState title="No organizations" description="Add an organization to get started." /> : (
            <div className="eos-list">
              {orgs.map(org => (
                <div key={org.orgId} className="eos-list-item">
                  <div>
                    <div className="eos-list-strong">{org.name}</div>
                    <div className="eos-list-sub">{org.description || "No description"}</div>
                    <div className="eos-meta-row">
                      <Badge text={org.status} color={org.status === "active" ? "#22c55e" : org.status === "archived" ? "#f97316" : "#64748b"} />
                      <span>{_label(org.industry)} · {_label(org.plan)}</span>
                    </div>
                  </div>
                  <div className="eos-list-actions">
                    <button className="eos-btn outline" onClick={() => handleEdit(org)}>Edit</button>
                    <button className="eos-btn danger" onClick={() => handleArchive(org.orgId)}>Archive</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DepartmentsView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterOrg, setFilterOrg] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState({ orgId: "", name: "", description: "", headId: "", tags: "" });
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, deptResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterpriseDepts({ orgId: filterOrg || undefined, status: status === "all" ? undefined : status, limit: 200 }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setDepts(deptResp.depts ?? []);
    setLoading(false);
  }, [filterOrg, status]);

  useEffect(() => { load(); }, [load]);

  const clearForm = () => {
    setForm({ orgId: "", name: "", description: "", headId: "", tags: "" });
    setEditing(null);
  };

  const handleSave = async () => {
    if (!form.orgId) { onToast?.("error", "Organization is required"); return; }
    if (!form.name.trim()) { onToast?.("error", "Department name is required"); return; }
    const payload = { ...form, tags: _parseArray(form.tags) };
    const result = editing ? await updateEnterpriseDept(editing, payload) : await createEnterpriseDept(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to save department");
      return;
    }
    onToast?.("success", editing ? "Department updated" : "Department created");
    clearForm();
    load();
  };

  const handleEdit = (dept) => {
    setEditing(dept.deptId);
    setForm({
      orgId: dept.orgId || "",
      name: dept.name || "",
      description: dept.description || "",
      headId: dept.headId || "",
      tags: (dept.tags || []).join(", "),
    });
  };

  const handleArchive = async (deptId) => {
    const r = await archiveEnterpriseDept(deptId);
    if (r.success === false || r.ok === false) {
      onToast?.("error", r.error || "Archive failed");
      return;
    }
    onToast?.("success", "Department archived");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Departments</h3>
          <div className="eos-subtitle">Manage department structure across organizations.</div>
        </div>
        <button className="eos-btn outline" onClick={clearForm}>New department</button>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel">
          <label className="eos-label">Organization</label>
          <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
            <option value="">Select organization</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
          <label className="eos-label">Name</label>
          <input className="eos-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="eos-label">Description</label>
          <textarea className="eos-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="eos-label">Head ID</label>
          <input className="eos-input" value={form.headId} onChange={e => setForm(f => ({ ...f, headId: e.target.value }))} />
          <label className="eos-label">Tags</label>
          <input className="eos-input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="comma-separated" />
          <div className="eos-form-actions">
            <button className="eos-btn" onClick={handleSave}>{editing ? "Update" : "Create"}</button>
            {editing && <button className="eos-btn outline" onClick={clearForm}>Cancel</button>}
          </div>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Organization</label>
              <select className="eos-select" value={filterOrg} onChange={e => setFilterOrg(e.target.value)}>
                <option value="">All organizations</option>
                {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Status</label>
              <select className="eos-select" value={status} onChange={e => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
          </div>
          {depts.length === 0 ? <EmptyState title="No departments" description="Create a department to organize teams." /> : (
            <div className="eos-list">
              {depts.map(dept => (
                <div key={dept.deptId} className="eos-list-item">
                  <div>
                    <div className="eos-list-strong">{dept.name}</div>
                    <div className="eos-list-sub">{dept.description || "No description"}</div>
                    <div className="eos-meta-row">
                      <Badge text={dept.status} color={dept.status === "active" ? "#22c55e" : dept.status === "archived" ? "#f97316" : "#64748b"} />
                      <span>Head: {dept.headId || "Unassigned"}</span>
                    </div>
                  </div>
                  <div className="eos-list-actions">
                    <button className="eos-btn outline" onClick={() => handleEdit(dept)}>Edit</button>
                    <button className="eos-btn danger" onClick={() => handleArchive(dept.deptId)}>Archive</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamsView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [depts, setDepts] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ orgId: "", deptId: "", status: "all", type: "" });
  const [form, setForm] = useState({ orgId: "", deptId: "", name: "", description: "", type: "other", tags: "" });
  const [editing, setEditing] = useState(null);
  const [memberForm, setMemberForm] = useState({ memberId: "", name: "", email: "", role: "member" });
  const [selectedTeam, setSelectedTeam] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, deptResp, teamResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterpriseDepts({ orgId: filter.orgId || undefined, status: "active", limit: 200 }),
      getEnterpriseTeams({
        orgId: filter.orgId || undefined,
        deptId: filter.deptId || undefined,
        status: filter.status === "all" ? undefined : filter.status,
        type: filter.type || undefined,
        limit: 200,
      }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setDepts(deptResp.depts ?? []);
    setTeams(teamResp.teams ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const clearForm = () => {
    setEditing(null);
    setForm({ orgId: "", deptId: "", name: "", description: "", type: "other", tags: "" });
    setSelectedTeam(null);
  };

  const handleSave = async () => {
    if (!form.orgId) { onToast?.("error", "Organization is required"); return; }
    if (!form.name.trim()) { onToast?.("error", "Team name is required"); return; }
    const payload = { ...form, tags: _parseArray(form.tags) };
    const result = editing ? await updateEnterpriseTeam(editing, payload) : await createEnterpriseTeam(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to save team");
      return;
    }
    onToast?.("success", editing ? "Team updated" : "Team created");
    clearForm();
    load();
  };

  const handleEdit = (team) => {
    setEditing(team.teamId);
    setForm({
      orgId: team.orgId || "",
      deptId: team.deptId || "",
      name: team.name || "",
      description: team.description || "",
      type: team.type || "other",
      tags: (team.tags || []).join(", "),
    });
    setSelectedTeam(team);
  };

  const handleArchive = async (teamId) => {
    const r = await archiveEnterpriseTeam(teamId);
    if (r.success === false || r.ok === false) {
      onToast?.("error", r.error || "Archive failed");
      return;
    }
    onToast?.("success", "Team archived");
    clearForm();
    load();
  };

  const handleAddMember = async () => {
    if (!selectedTeam?.teamId) { onToast?.("error", "Select a team first"); return; }
    if (!memberForm.memberId.trim()) { onToast?.("error", "Member ID is required"); return; }
    const result = await addEnterpriseTeamMember(selectedTeam.teamId, memberForm);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to add member");
      return;
    }
    onToast?.("success", "Member added");
    setMemberForm({ memberId: "", name: "", email: "", role: "member" });
    load();
  };

  const handleRemoveMember = async (teamId, memberId) => {
    const result = await removeEnterpriseTeamMember(teamId, memberId);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to remove member");
      return;
    }
    onToast?.("success", "Member removed");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Teams</h3>
          <div className="eos-subtitle">Create teams, manage membership, and archive team units.</div>
        </div>
        <button className="eos-btn outline" onClick={clearForm}>New team</button>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel">
          <label className="eos-label">Organization</label>
          <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
            <option value="">Select organization</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
          <label className="eos-label">Department</label>
          <select className="eos-select" value={form.deptId} onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}>
            <option value="">Select department</option>
            {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
          </select>
          <label className="eos-label">Name</label>
          <input className="eos-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="eos-label">Type</label>
          <select className="eos-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {TEAM_TYPES.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Description</label>
          <textarea className="eos-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="eos-label">Tags</label>
          <input className="eos-input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="comma-separated" />
          <div className="eos-form-actions">
            <button className="eos-btn" onClick={handleSave}>{editing ? "Update" : "Create"}</button>
            {editing && <button className="eos-btn outline" onClick={clearForm}>Cancel</button>}
          </div>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Organization</label>
              <select className="eos-select" value={filter.orgId} onChange={e => setFilter(f => ({ ...f, orgId: e.target.value }))}>
                <option value="">All organizations</option>
                {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Department</label>
              <select className="eos-select" value={filter.deptId} onChange={e => setFilter(f => ({ ...f, deptId: e.target.value }))}>
                <option value="">All departments</option>
                {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Status</label>
              <select className="eos-select" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
          </div>
          {teams.length === 0 ? <EmptyState title="No teams" description="Create a team to start organizing work." /> : (
            <div className="eos-list eos-list--tall">
              {teams.map(team => (
                <div key={team.teamId} className="eos-list-item eos-list-item--stacked">
                  <div>
                    <div className="eos-list-strong">{team.name}</div>
                    <div className="eos-list-sub">{team.description || "No description"}</div>
                    <div className="eos-meta-row">
                      <Badge text={team.status} color={team.status === "active" ? "#22c55e" : team.status === "archived" ? "#f97316" : "#64748b"} />
                      <span>{_label(team.type)} • {team.members?.length ?? 0} members</span>
                    </div>
                  </div>
                  <div className="eos-list-actions">
                    <button className="eos-btn outline" onClick={() => handleEdit(team)}>Edit</button>
                    <button className="eos-btn" onClick={() => { setSelectedTeam(team); setEditing(team.teamId); }}>Members</button>
                    <button className="eos-btn danger" onClick={() => handleArchive(team.teamId)}>Archive</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedTeam && (
            <div className="eos-box eos-box--secondary">
              <h4>Team members for {selectedTeam.name}</h4>
              <div className="eos-form-row">
                <input className="eos-input" placeholder="Member ID" value={memberForm.memberId} onChange={e => setMemberForm(f => ({ ...f, memberId: e.target.value }))} />
                <input className="eos-input" placeholder="Name" value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />
                <input className="eos-input" placeholder="Email" value={memberForm.email} onChange={e => setMemberForm(f => ({ ...f, email: e.target.value }))} />
                <input className="eos-input" placeholder="Role" value={memberForm.role} onChange={e => setMemberForm(f => ({ ...f, role: e.target.value }))} />
                <button className="eos-btn" onClick={handleAddMember}>Add</button>
              </div>
              {selectedTeam.members?.length ? (
                <div className="eos-list eos-list--compact">
                  {selectedTeam.members.map(member => (
                    <div key={member.memberId} className="eos-list-item">
                      <div>
                        <div className="eos-list-strong">{member.name || member.memberId}</div>
                        <div className="eos-list-sub">{member.email || "No email"} • {member.role}</div>
                      </div>
                      <button className="eos-btn danger" onClick={() => handleRemoveMember(selectedTeam.teamId, member.memberId)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No team members" description="Add team members to collaborate." />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RolesView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ orgId: "", scope: "", status: "all" });
  const [form, setForm] = useState({ orgId: "", name: "", description: "", scope: "org", permissions: "" });
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, roleResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterpriseRoles({
        orgId: filter.orgId || undefined,
        scope: filter.scope || undefined,
        status: filter.status === "all" ? undefined : filter.status,
        limit: 200,
      }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setRoles(roleResp.roles ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const clearForm = () => {
    setEditing(null);
    setForm({ orgId: "", name: "", description: "", scope: "org", permissions: "" });
  };

  const handleSave = async () => {
    if (!form.orgId) { onToast?.("error", "Organization is required"); return; }
    if (!form.name.trim()) { onToast?.("error", "Role name is required"); return; }
    const payload = { ...form, permissions: _parseArray(form.permissions) };
    const result = editing ? await updateEnterpriseRole(editing, payload) : await createEnterpriseRole(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to save role");
      return;
    }
    onToast?.("success", editing ? "Role updated" : "Role created");
    clearForm();
    load();
  };

  const handleEdit = (role) => {
    setEditing(role.roleId);
    setForm({
      orgId: role.orgId || "",
      name: role.name || "",
      description: role.description || "",
      scope: role.scope || "org",
      permissions: (role.permissions || []).join(", "),
    });
  };

  const handleDeprecate = async (roleId) => {
    const r = await deprecateEnterpriseRole(roleId);
    if (r.success === false || r.ok === false) {
      onToast?.("error", r.error || "Unable to deprecate role");
      return;
    }
    onToast?.("success", "Role deprecated");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Roles</h3>
          <div className="eos-subtitle">Define roles, scopes, and permission sets for the enterprise.</div>
        </div>
        <button className="eos-btn outline" onClick={clearForm}>New role</button>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel">
          <label className="eos-label">Organization</label>
          <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
            <option value="">Select organization</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
          <label className="eos-label">Role name</label>
          <input className="eos-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="eos-label">Scope</label>
          <select className="eos-select" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}>
            {ROLE_SCOPES.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Description</label>
          <textarea className="eos-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="eos-label">Permissions</label>
          <input className="eos-input" value={form.permissions} onChange={e => setForm(f => ({ ...f, permissions: e.target.value }))} placeholder="comma-separated" />
          <div className="eos-form-actions">
            <button className="eos-btn" onClick={handleSave}>{editing ? "Update" : "Create"}</button>
            {editing && <button className="eos-btn outline" onClick={clearForm}>Cancel</button>}
          </div>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Organization</label>
              <select className="eos-select" value={filter.orgId} onChange={e => setFilter(f => ({ ...f, orgId: e.target.value }))}>
                <option value="">All organizations</option>
                {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Scope</label>
              <select className="eos-select" value={filter.scope} onChange={e => setFilter(f => ({ ...f, scope: e.target.value }))}>
                <option value="">All scopes</option>
                {ROLE_SCOPES.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Status</label>
              <select className="eos-select" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
          </div>
          {roles.length === 0 ? <EmptyState title="No roles" description="Create roles to assign permissions." /> : (
            <div className="eos-list eos-list--tall">
              {roles.map(role => (
                <div key={role.roleId} className="eos-list-item eos-list-item--stacked">
                  <div>
                    <div className="eos-list-strong">{role.name}</div>
                    <div className="eos-list-sub">{role.description || "No description"}</div>
                    <div className="eos-meta-row">
                      <Badge text={role.status} color={role.status === "active" ? "#22c55e" : "#f97316"} />
                      <span>{_label(role.scope)} • {role.permissions?.length ?? 0} permissions</span>
                    </div>
                  </div>
                  <div className="eos-list-actions">
                    <button className="eos-btn outline" onClick={() => handleEdit(role)}>Edit</button>
                    {role.status !== "deprecated" && !role.isSystem && (
                      <button className="eos-btn danger" onClick={() => handleDeprecate(role.roleId)}>Deprecate</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PermissionsView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [perms, setPerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ orgId: "", active: "all", roleId: "", memberId: "" });
  const [form, setForm] = useState({ orgId: "", memberId: "", memberName: "", roleId: "", resource: "*", actions: "read", expiresAt: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, roleResp, permResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterpriseRoles({ limit: 200 }),
      getEnterprisePermissions({
        orgId: filter.orgId || undefined,
        roleId: filter.roleId || undefined,
        memberId: filter.memberId || undefined,
        active: filter.active === "all" ? undefined : filter.active === "true",
        limit: 200,
      }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setRoles(roleResp.roles ?? []);
    setPerms(permResp.permissions ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleGrant = async () => {
    if (!form.orgId || !form.memberId || !form.roleId) { onToast?.("error", "Organization, member, and role are required"); return; }
    const payload = { ...form, actions: _parseArray(form.actions) };
    const result = await grantEnterprisePermission(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to grant permission");
      return;
    }
    onToast?.("success", "Permission granted");
    setForm({ orgId: "", memberId: "", memberName: "", roleId: "", resource: "*", actions: "read", expiresAt: "" });
    load();
  };

  const handleRevoke = async (permId) => {
    const result = await revokeEnterprisePermission(permId, { revokedBy: "admin" });
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to revoke permission");
      return;
    }
    onToast?.("success", "Permission revoked");
    load();
  };

  const handleUpdate = async (perm) => {
    const result = await updateEnterprisePermission(perm.permId, { resource: perm.resource, actions: perm.actions, expiresAt: perm.expiresAt });
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to update permission");
      return;
    }
    onToast?.("success", "Permission updated");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Permissions</h3>
          <div className="eos-subtitle">Grant, update, and revoke access permissions.</div>
        </div>
      </div>

      <div className="eos-form-panel eos-form-panel--narrow">
        <h4>Grant new permission</h4>
        <label className="eos-label">Organization</label>
        <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
          <option value="">Select organization</option>
          {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
        </select>
        <label className="eos-label">Member ID</label>
        <input className="eos-input" value={form.memberId} onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))} />
        <label className="eos-label">Member name</label>
        <input className="eos-input" value={form.memberName} onChange={e => setForm(f => ({ ...f, memberName: e.target.value }))} />
        <label className="eos-label">Role</label>
        <select className="eos-select" value={form.roleId} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}>
          <option value="">Select role</option>
          {roles.map(role => <option key={role.roleId} value={role.roleId}>{role.name}</option>)}
        </select>
        <label className="eos-label">Resource</label>
        <input className="eos-input" value={form.resource} onChange={e => setForm(f => ({ ...f, resource: e.target.value }))} placeholder="*" />
        <label className="eos-label">Actions</label>
        <input className="eos-input" value={form.actions} onChange={e => setForm(f => ({ ...f, actions: e.target.value }))} placeholder="read, write" />
        <label className="eos-label">Expires at (ISO)</label>
        <input className="eos-input" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} placeholder="2026-12-31T23:59:59Z" />
        <button className="eos-btn" onClick={handleGrant}>Grant permission</button>
      </div>

      <div className="eos-list-panel">
        <div className="eos-list-controls">
          <div>
            <label className="eos-label">Organization</label>
            <select className="eos-select" value={filter.orgId} onChange={e => setFilter(f => ({ ...f, orgId: e.target.value }))}>
              <option value="">All organizations</option>
              {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="eos-label">Role</label>
            <select className="eos-select" value={filter.roleId} onChange={e => setFilter(f => ({ ...f, roleId: e.target.value }))}>
              <option value="">All roles</option>
              {roles.map(role => <option key={role.roleId} value={role.roleId}>{role.name}</option>)}
            </select>
          </div>
          <div>
            <label className="eos-label">Active</label>
            <select className="eos-select" value={filter.active} onChange={e => setFilter(f => ({ ...f, active: e.target.value }))}>
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Revoked</option>
            </select>
          </div>
        </div>
        {perms.length === 0 ? <EmptyState title="No permissions" description="Grant a permission to start." /> : (
          <div className="eos-list eos-list--tall">
            {perms.map(perm => (
              <div key={perm.permId} className="eos-list-item eos-list-item--stacked">
                <div>
                  <div className="eos-list-strong">{perm.memberName || perm.memberId}</div>
                  <div className="eos-list-sub">Role: {perm.roleId} • Resource: {perm.resource}</div>
                  <div className="eos-meta-row">
                    <Badge text={perm.active ? "active" : "revoked"} color={perm.active ? "#22c55e" : "#f97316"} />
                    <span>Actions: {(perm.actions || []).join(", ")}</span>
                  </div>
                </div>
                <div className="eos-list-actions">
                  <button className="eos-btn danger" onClick={() => handleRevoke(perm.permId)}>Revoke</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PoliciesView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ orgId: "", type: "", status: "", enforcement: "" });
  const [form, setForm] = useState({ orgId: "", name: "", description: "", type: "operational", enforcement: "advisory", rules: "", status: "active" });
  const [editing, setEditing] = useState(null);
  const [context, setContext] = useState("");
  const [policyResult, setPolicyResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, policyResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterprisePolicies({
        orgId: filter.orgId || undefined,
        type: filter.type || undefined,
        status: filter.status || undefined,
        enforcement: filter.enforcement || undefined,
        limit: 200,
      }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setPolicies(policyResp.policies ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const clearForm = () => {
    setEditing(null);
    setForm({ orgId: "", name: "", description: "", type: "operational", enforcement: "advisory", rules: "", status: "active" });
    setPolicyResult(null);
  };

  const handleSave = async () => {
    if (!form.orgId) { onToast?.("error", "Organization is required"); return; }
    if (!form.name.trim()) { onToast?.("error", "Policy name is required"); return; }
    const rules = form.rules ? [{ condition: form.rules, action: "notify", severity: "medium" }] : [];
    const payload = { ...form, rules };
    const result = editing ? await updateEnterprisePolicy(editing, payload) : await createEnterprisePolicy(payload);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to save policy");
      return;
    }
    onToast?.("success", editing ? "Policy updated" : "Policy created");
    clearForm();
    load();
  };

  const handleEdit = (policy) => {
    setEditing(policy.policyId);
    setForm({
      orgId: policy.orgId || "",
      name: policy.name || "",
      description: policy.description || "",
      type: policy.type || "operational",
      enforcement: policy.enforcement || "advisory",
      rules: policy.rules?.length ? policy.rules[0].condition : "",
      status: policy.status || "active",
    });
  };

  const handleEnforce = async (policyId) => {
    if (!policyId) return;
    const result = await enforceEnterprisePolicy(policyId, { text: context });
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Enforcement failed");
      return;
    }
    setPolicyResult(result);
    onToast?.("success", "Policy evaluated");
  };

  const handleArchive = async (policyId) => {
    const result = await archiveEnterprisePolicy(policyId);
    if (result.success === false || result.ok === false) {
      onToast?.("error", result.error || "Unable to archive policy");
      return;
    }
    onToast?.("success", "Policy archived");
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Policies</h3>
          <div className="eos-subtitle">Define governance policies and evaluate compliance context.</div>
        </div>
        <button className="eos-btn outline" onClick={clearForm}>New policy</button>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel">
          <label className="eos-label">Organization</label>
          <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
            <option value="">Select organization</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
          <label className="eos-label">Policy name</label>
          <input className="eos-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="eos-label">Type</label>
          <select className="eos-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {POLICY_TYPES.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Enforcement</label>
          <select className="eos-select" value={form.enforcement} onChange={e => setForm(f => ({ ...f, enforcement: e.target.value }))}>
            {ENFORCEMENT_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
          </select>
          <label className="eos-label">Description</label>
          <textarea className="eos-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="eos-label">Rule condition</label>
          <textarea className="eos-textarea" value={form.rules} onChange={e => setForm(f => ({ ...f, rules: e.target.value }))} placeholder="Enter a keyword or phrase that triggers this policy." />
          <div className="eos-form-actions">
            <button className="eos-btn" onClick={handleSave}>{editing ? "Update" : "Create"}</button>
            {editing && <button className="eos-btn outline" onClick={clearForm}>Cancel</button>}
          </div>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Organization</label>
              <select className="eos-select" value={filter.orgId} onChange={e => setFilter(f => ({ ...f, orgId: e.target.value }))}>
                <option value="">All organizations</option>
                {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Type</label>
              <select className="eos-select" value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
                <option value="">All types</option>
                {POLICY_TYPES.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Enforcement</label>
              <select className="eos-select" value={filter.enforcement} onChange={e => setFilter(f => ({ ...f, enforcement: e.target.value }))}>
                <option value="">All enforcement</option>
                {ENFORCEMENT_OPTIONS.map(opt => <option key={opt} value={opt}>{_label(opt)}</option>)}
              </select>
            </div>
          </div>
          {policies.length === 0 ? <EmptyState title="No policies" description="Create a policy to protect your enterprise." /> : (
            <div className="eos-list eos-list--tall">
              {policies.map(policy => (
                <div key={policy.policyId} className="eos-list-item eos-list-item--stacked">
                  <div>
                    <div className="eos-list-strong">{policy.name}</div>
                    <div className="eos-list-sub">{policy.description || "No description"}</div>
                    <div className="eos-meta-row">
                      <Badge text={policy.status} color={policy.status === "active" ? "#22c55e" : policy.status === "archived" ? "#f97316" : "#64748b"} />
                      <span>{_label(policy.type)} • {policy.enforcement}</span>
                    </div>
                  </div>
                  <div className="eos-list-actions">
                    <button className="eos-btn outline" onClick={() => handleEdit(policy)}>Edit</button>
                    <button className="eos-btn outline" onClick={() => handleEnforce(policy.policyId)}>Evaluate</button>
                    <button className="eos-btn danger" onClick={() => handleArchive(policy.policyId)}>Archive</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="eos-box eos-box--secondary">
            <h4>Enforcement context</h4>
            <textarea className="eos-textarea" value={context} onChange={e => setContext(e.target.value)} placeholder="Enter sample event data or context to evaluate." />
            {policyResult && (
              <div className="eos-box-sub">
                <div className="eos-box-row"><div>Passed</div><div>{policyResult.passed ? "Yes" : "No"}</div></div>
                <div className="eos-box-row"><div>Enforcement</div><div>{policyResult.enforcement}</div></div>
                <div className="eos-box-row"><div>Violations</div><div>{policyResult.violations?.length ?? 0}</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditView({ onToast }) {
  const [orgs, setOrgs] = useState([]);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ orgId: "", actorId: "", action: "", resource: "", outcome: "" });
  const [form, setForm] = useState({ orgId: "", actorId: "", actorName: "", action: "", resource: "", resourceId: "", outcome: "success", detail: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [orgResp, eventResp, statResp] = await Promise.all([
      getEnterpriseOrgs({ limit: 100 }),
      getEnterpriseAuditEvents({
        orgId: filter.orgId || undefined,
        actorId: filter.actorId || undefined,
        action: filter.action || undefined,
        resource: filter.resource || undefined,
        outcome: filter.outcome || undefined,
        limit: 200,
      }),
      getEnterpriseAuditStats({ orgId: filter.orgId || undefined }),
    ]);
    setOrgs(orgResp.orgs ?? []);
    setEvents(eventResp.events ?? []);
    setStats(statResp.success === false ? null : statResp);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleLog = async () => {
    if (!form.orgId || !form.action || !form.resource) { onToast?.("error", "Organization, action, and resource are required"); return; }
    const result = await logEnterpriseAuditEvent(form);
    if (result.success === false) {
      onToast?.("error", result.error || "Unable to log audit event");
      return;
    }
    onToast?.("success", "Audit event recorded");
    setForm({ orgId: "", actorId: "", actorName: "", action: "", resource: "", resourceId: "", outcome: "success", detail: "" });
    load();
  };

  if (loading) return <Skeleton />;

  return (
    <div className="eos-section">
      <div className="eos-section-header">
        <div>
          <h3>Audit</h3>
          <div className="eos-subtitle">Review enterprise audit trails and log events manually.</div>
        </div>
      </div>

      <div className="eos-form-grid">
        <div className="eos-form-panel eos-form-panel--narrow">
          <h4>Log new audit event</h4>
          <label className="eos-label">Organization</label>
          <select className="eos-select" value={form.orgId} onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}>
            <option value="">Select organization</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
          <label className="eos-label">Actor ID</label>
          <input className="eos-input" value={form.actorId} onChange={e => setForm(f => ({ ...f, actorId: e.target.value }))} />
          <label className="eos-label">Actor name</label>
          <input className="eos-input" value={form.actorName} onChange={e => setForm(f => ({ ...f, actorName: e.target.value }))} />
          <label className="eos-label">Action</label>
          <input className="eos-input" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} />
          <label className="eos-label">Resource</label>
          <input className="eos-input" value={form.resource} onChange={e => setForm(f => ({ ...f, resource: e.target.value }))} />
          <label className="eos-label">Resource ID</label>
          <input className="eos-input" value={form.resourceId} onChange={e => setForm(f => ({ ...f, resourceId: e.target.value }))} />
          <label className="eos-label">Outcome</label>
          <select className="eos-select" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}>
            <option value="success">Success</option>
            <option value="violation">Violation</option>
            <option value="failure">Failure</option>
          </select>
          <label className="eos-label">Detail</label>
          <textarea className="eos-textarea" value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} />
          <button className="eos-btn" onClick={handleLog}>Log event</button>
        </div>

        <div className="eos-list-panel">
          <div className="eos-list-controls">
            <div>
              <label className="eos-label">Organization</label>
              <select className="eos-select" value={filter.orgId} onChange={e => setFilter(f => ({ ...f, orgId: e.target.value }))}>
                <option value="">All organizations</option>
                {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eos-label">Action</label>
              <input className="eos-input" value={filter.action} onChange={e => setFilter(f => ({ ...f, action: e.target.value }))} />
            </div>
            <div>
              <label className="eos-label">Outcome</label>
              <select className="eos-select" value={filter.outcome} onChange={e => setFilter(f => ({ ...f, outcome: e.target.value }))}>
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="violation">Violation</option>
                <option value="failure">Failure</option>
              </select>
            </div>
          </div>
          {events.length === 0 ? <EmptyState title="No audit events" description="Trigger events or load existing audit history." /> : (
            <div className="eos-list eos-list--tall">
              {events.map(event => (
                <div key={event.eventId} className="eos-list-item eos-list-item--stacked">
                  <div>
                    <div className="eos-list-strong">{event.action}</div>
                    <div className="eos-list-sub">{event.detail || "No detail provided"}</div>
                    <div className="eos-meta-row">
                      <Badge text={event.outcome} color={event.outcome === "success" ? "#22c55e" : event.outcome === "violation" ? "#f97316" : "#64748b"} />
                      <span>{event.actorName || event.actorId}</span>
                    </div>
                  </div>
                  <div className="eos-list-meta">{_fmtDateTime(event.ts)}</div>
                </div>
              ))}
            </div>
          )}

          {stats && (
            <div className="eos-box eos-box--secondary">
              <h4>Audit stats</h4>
              <div className="eos-box-row"><div>Total events</div><div>{stats.total ?? 0}</div></div>
              <div className="eos-box-row"><div>By outcome</div><div>{Object.entries(stats.byOutcome || {}).map(([k,v]) => `${k}: ${v}`).join(", ")}</div></div>
              <div className="eos-box-row"><div>By action</div><div>{Object.entries(stats.byAction || {}).map(([k,v]) => `${k}: ${v}`).join(", ")}</div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
