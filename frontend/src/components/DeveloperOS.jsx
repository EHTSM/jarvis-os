import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getDeveloperDashboard, getDeveloperDailySummary, getDeveloperWeeklySummary, getDeveloperVelocity, getDeveloperStats,
  getDevRepos, createDevRepo, updateDevRepo, archiveDevRepo,
  getDevProjects, createDevProject, updateDevProject, completeDevProject, archiveDevProject,
  getDevIssues, createDevIssue, updateDevIssue, assignDevIssue, closeDevIssue, reopenDevIssue, deleteDevIssue,
  recordDevBuild, getDevBuilds, getDevBuildStats,
  recordDevDeployment, getDevDeployments, getDevDeploymentStats, rollbackDevDeployment,
  searchDeveloper,
} from "../developerApi";
import "./DeveloperOS.css";

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "repos", label: "Repositories" },
  { id: "projects", label: "Projects" },
  { id: "issues", label: "Issues" },
  { id: "builds", label: "Builds" },
  { id: "deployments", label: "Deployments" },
];

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function _fmtDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Badge({ label, color }) {
  return <span className="dos-badge" style={{ color, borderColor: color + "33", background: color + "11" }}>{label}</span>;
}

function Skeleton() {
  return <div className="dos-skeleton-wrap"><div className="dos-skeleton" /><div className="dos-skeleton dos-skeleton--sm" /></div>;
}

function Empty({ title, sub }) {
  return (
    <div className="dos-empty">
      <p className="dos-empty-title">{title}</p>
      <p className="dos-empty-sub">{sub}</p>
    </div>
  );
}

function OverviewView({ onToast }) {
  const [dash, setDash] = useState(null);
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, da, w, v, s] = await Promise.all([
      getDeveloperDashboard(),
      getDeveloperDailySummary(),
      getDeveloperWeeklySummary(),
      getDeveloperVelocity(7),
      getDeveloperStats(),
    ]);
    if (d.success !== false) setDash(d);
    if (da.success !== false) setDaily(da);
    if (w.success !== false) setWeekly(w);
    if (v.success !== false) setVelocity(v);
    if (s.success !== false) setStats(s);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton />;

  return (
    <div className="dos-section">
      <div className="dos-section-header">
        <h3 className="dos-section-title">Developer Overview</h3>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="dos-stats-grid">
        <div className="dos-stat-card">
          <div className="dos-stat-val" style={{ color: "var(--accent)" }}>{dash?.repos?.total ?? dash?.repoCount ?? 0}</div>
          <div className="dos-stat-lbl">Repositories</div>
          <div className="dos-stat-sub">{dash?.repos?.active ?? dash?.activeRepos ?? 0} active</div>
        </div>
        <div className="dos-stat-card">
          <div className="dos-stat-val" style={{ color: "var(--warning)" }}>{dash?.projects?.active ?? dash?.activeProjects ?? 0}</div>
          <div className="dos-stat-lbl">Active Projects</div>
          <div className="dos-stat-sub">{dash?.projects?.pending ?? 0} pending</div>
        </div>
        <div className="dos-stat-card">
          <div className="dos-stat-val" style={{ color: "var(--danger)" }}>{dash?.issues?.open ?? dash?.openIssues ?? 0}</div>
          <div className="dos-stat-lbl">Open Issues</div>
          <div className="dos-stat-sub">{dash?.issues?.priorityHigh ?? 0} high priority</div>
        </div>
        <div className="dos-stat-card">
          <div className="dos-stat-val" style={{ color: "var(--success)" }}>{dash?.deployments?.recent ?? dash?.recentDeployments ?? 0}</div>
          <div className="dos-stat-lbl">Deployments</div>
          <div className="dos-stat-sub">{dash?.deployments?.successRate ? `${Math.round(dash.deployments.successRate * 100)}% success` : ""}</div>
        </div>
      </div>

      {velocity && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">Velocity</h4>
          <div className="dos-split-row">
            <div>
              <strong>{velocity.commits ?? velocity.changes ?? 0}</strong>
              <div className="dos-text-dim">Recent engineering actions</div>
            </div>
            <div>
              <strong>{velocity.cycleTime ? `${velocity.cycleTime.toFixed(1)}h` : "—"}</strong>
              <div className="dos-text-dim">Cycle time</div>
            </div>
            <div>
              <strong>{velocity.throughput ?? 0}</strong>
              <div className="dos-text-dim">Stories closed</div>
            </div>
          </div>
        </div>
      )}

      {daily?.highlights?.length > 0 && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">Today</h4>
          {daily.highlights.map((item, idx) => (
            <div key={idx} className="dos-highlight-row">
              <span className="dos-highlight-dot" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {weekly && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">Weekly Summary</h4>
          <div className="dos-split-row">
            <div>
              <strong>{weekly.completed ?? weekly.closed ?? 0}</strong>
              <div className="dos-text-dim">Completed items</div>
            </div>
            <div>
              <strong>{weekly.newIssues ?? weekly.opened ?? 0}</strong>
              <div className="dos-text-dim">New issues</div>
            </div>
            <div>
              <strong>{weekly.deployments ?? 0}</strong>
              <div className="dos-text-dim">Deployments</div>
            </div>
          </div>
        </div>
      )}

      {stats && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">System Stats</h4>
          <div className="dos-split-row">
            <div>
              <strong>{stats.engineers ?? stats.teamSize ?? 0}</strong>
              <div className="dos-text-dim">Contributors</div>
            </div>
            <div>
              <strong>{stats.uptime ?? "—"}</strong>
              <div className="dos-text-dim">Uptime</div>
            </div>
            <div>
              <strong>{stats.errorsLast24h ?? 0}</strong>
              <div className="dos-text-dim">Errors</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_REPO = { name: "", description: "", language: "JavaScript", status: "active" };
function ReposView({ onToast }) {
  const [repos, setRepos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState(EMPTY_REPO);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getDevRepos({ status: status === "all" ? undefined : status, search, limit: 100 });
    setRepos(r.repos ?? []);
    setLoading(false);
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const openNew = () => {
    setForm(EMPTY_REPO);
    setEditing(null);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const openEdit = (repo) => {
    setForm({ name: repo.name || "", description: repo.description || "", language: repo.language || "JavaScript", status: repo.status || "active" });
    setEditing(repo.repoId || repo.id || null);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { onToast?.("error", "Repository name is required"); return; }
    setSaving(true);
    const payload = { ...form };
    const r = editing ? await updateDevRepo(editing, payload) : await createDevRepo(payload);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Save failed");
    else {
      onToast?.("success", editing ? "Repository updated" : "Repository created");
      setEditing(null);
      setForm(EMPTY_REPO);
      load();
    }
    setSaving(false);
  };

  const handleArchive = async (repoId) => {
    const r = await archiveDevRepo(repoId);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Archive failed");
    else { onToast?.("success", "Repository archived"); load(); }
  };

  return (
    <div className="dos-section">
      <div className="dos-section-header">
        <h3 className="dos-section-title">Developer Repositories</h3>
        <button className="dos-btn outline" onClick={openNew}>New repository</button>
      </div>

      <div className="dos-filter-row">
        <input
          className="dos-input dos-search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search repositories"
        />
        <select className="dos-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="pending">Pending</option>
        </select>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      {editing !== null || form.name ? (
        <div className="dos-form-card">
          <div className="dos-form-header">
            <strong>{editing ? "Edit repository" : "Create repository"}</strong>
          </div>
          <div className="dos-form-row">
            <input ref={nameRef} className="dos-input" value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Repository name" />
            <input className="dos-input" value={form.language} onChange={e => setField("language", e.target.value)} placeholder="Language" />
          </div>
          <div className="dos-form-row">
            <input className="dos-input" value={form.description} onChange={e => setField("description", e.target.value)} placeholder="Description" />
            <select className="dos-select" value={form.status} onChange={e => setField("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="dos-form-actions">
            <button className="dos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button className="dos-btn outline" onClick={() => { setEditing(null); setForm(EMPTY_REPO); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {loading ? <Skeleton /> : (repos.length === 0 ? <Empty title="No repositories found" sub="Create a repository to start tracking code work." /> : (
        <table className="dos-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Language</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {repos.map(repo => (
              <tr key={repo.repoId || repo.id || repo.name}>
                <td className="dos-td-name">{repo.name || "Untitled"}</td>
                <td><Badge label={repo.status || "unknown"} color={repo.status === "archived" ? "var(--danger)" : repo.status === "active" ? "var(--success)" : "var(--accent)"} /></td>
                <td className="dos-td-dim">{repo.language || "—"}</td>
                <td className="dos-td-dim">{_timeAgo(repo.updatedAt || repo.createdAt)}</td>
                <td className="dos-td-actions">
                  <button className="dos-icon-btn" onClick={() => openEdit(repo)}>Edit</button>
                  <button className="dos-icon-btn danger" onClick={() => handleArchive(repo.repoId || repo.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

const EMPTY_PROJECT = { title: "", repoId: "", priority: "medium", status: "active", description: "" };
function ProjectsView({ onToast }) {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [repoId, setRepoId] = useState("");
  const [form, setForm] = useState(EMPTY_PROJECT);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState([]);
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, r] = await Promise.all([getDevProjects({ status: status === "all" ? undefined : status, repoId: repoId || undefined, limit: 100 }), getDevRepos({ limit: 100 })]);
    setProjects(p.projects ?? []);
    setRepos(r.repos ?? []);
    setLoading(false);
  }, [status, repoId]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const openNew = () => {
    setForm(EMPTY_PROJECT);
    setEditing(null);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const openEdit = (project) => {
    setForm({ title: project.title || "", repoId: project.repoId || "", priority: project.priority || "medium", status: project.status || "active", description: project.description || "" });
    setEditing(project.projectId || project.id || null);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Project title is required"); return; }
    setSaving(true);
    const payload = { ...form };
    const r = editing ? await updateDevProject(editing, payload) : await createDevProject(payload);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Save failed");
    else {
      onToast?.("success", editing ? "Project updated" : "Project created");
      setEditing(null);
      setForm(EMPTY_PROJECT);
      load();
    }
    setSaving(false);
  };

  const handleComplete = async (projectId) => {
    const r = await completeDevProject(projectId);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Could not complete project");
    else { onToast?.("success", "Project completed"); load(); }
  };

  const handleArchive = async (projectId) => {
    const r = await archiveDevProject(projectId);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Archive failed");
    else { onToast?.("success", "Project archived"); load(); }
  };

  return (
    <div className="dos-section">
      <div className="dos-section-header">
        <h3 className="dos-section-title">Developer Projects</h3>
        <button className="dos-btn outline" onClick={openNew}>New project</button>
      </div>

      <div className="dos-filter-row">
        <select className="dos-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <select className="dos-select" value={repoId} onChange={e => setRepoId(e.target.value)}>
          <option value="">All repos</option>
          {repos.map(repo => <option key={repo.repoId || repo.id || repo.name} value={repo.repoId || repo.id || repo.name}>{repo.name}</option>)}
        </select>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="dos-form-card">
        <div className="dos-form-header"><strong>{editing ? "Edit project" : "Create project"}</strong></div>
        <div className="dos-form-row">
          <input ref={titleRef} className="dos-input" value={form.title} onChange={e => setField("title", e.target.value)} placeholder="Project title" />
          <select className="dos-select" value={form.repoId} onChange={e => setField("repoId", e.target.value)}>
            <option value="">Select repo</option>
            {repos.map(repo => <option key={repo.repoId || repo.id || repo.name} value={repo.repoId || repo.id || repo.name}>{repo.name}</option>)}
          </select>
        </div>
        <div className="dos-form-row">
          <select className="dos-select" value={form.priority} onChange={e => setField("priority", e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <select className="dos-select" value={form.status} onChange={e => setField("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <textarea className="dos-input dos-textarea" value={form.description} onChange={e => setField("description", e.target.value)} placeholder="Description" />
        <div className="dos-form-actions">
          <button className="dos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="dos-btn outline" onClick={() => { setEditing(null); setForm(EMPTY_PROJECT); }}>Cancel</button>
        </div>
      </div>

      {loading ? <Skeleton /> : (projects.length === 0 ? <Empty title="No projects found" sub="Create a project to track developer work." /> : (
        <table className="dos-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Repo</th>
              <th>Status</th>
              <th>Priority</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map(project => (
              <tr key={project.projectId || project.id || project.title}>
                <td className="dos-td-name">{project.title || "Untitled"}</td>
                <td className="dos-td-dim">{project.repoId || "—"}</td>
                <td>{project.status ? <Badge label={project.status} color={project.status === "completed" ? "var(--success)" : project.status === "archived" ? "var(--danger)" : "var(--accent)"} /> : "—"}</td>
                <td className="dos-td-dim">{project.priority || "medium"}</td>
                <td className="dos-td-actions">
                  <button className="dos-icon-btn" onClick={() => openEdit(project)}>Edit</button>
                  <button className="dos-icon-btn success" onClick={() => handleComplete(project.projectId || project.id)}>Complete</button>
                  <button className="dos-icon-btn danger" onClick={() => handleArchive(project.projectId || project.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

const EMPTY_ISSUE = { title: "", type: "bug", priority: "medium", repoId: "", projectId: "", assignee: "", label: "", description: "" };
function IssuesView({ onToast }) {
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_ISSUE);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignName, setAssignName]     = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getDevIssues({ status: status === "all" ? undefined : status, label: search || undefined, limit: 100 });
    setIssues(r.issues ?? []);
    setLoading(false);
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const openNew = () => {
    setForm(EMPTY_ISSUE);
    setEditing(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const openEdit = (issue) => {
    setForm({ title: issue.title || "", type: issue.type || "bug", priority: issue.priority || "medium", repoId: issue.repoId || "", projectId: issue.projectId || "", assignee: issue.assignee || "", label: issue.label || "", description: issue.description || "" });
    setEditing(issue.issueId || issue.id || null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Issue title is required"); return; }
    setSaving(true);
    const payload = { ...form };
    const r = editing ? await updateDevIssue(editing, payload) : await createDevIssue(payload);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Save failed");
    else {
      onToast?.("success", editing ? "Issue updated" : "Issue created");
      setEditing(null);
      setForm(EMPTY_ISSUE);
      load();
    }
    setSaving(false);
  };

  const handleAssign = (issueId) => { setAssignTarget(issueId); setAssignName(""); };
  const handleAssignConfirm = async () => {
    if (!assignName.trim()) return;
    const r = await assignDevIssue(assignTarget, assignName.trim());
    setAssignTarget(null);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Assign failed");
    else { onToast?.("success", "Issue assigned"); load(); }
  };

  const handleClose = async (issueId) => {
    const r = await closeDevIssue(issueId);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Close failed");
    else { onToast?.("success", "Issue closed"); load(); }
  };

  const handleReopen = async (issueId) => {
    const r = await reopenDevIssue(issueId);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Reopen failed");
    else { onToast?.("success", "Issue reopened"); load(); }
  };

  const handleDelete = (issueId) => setDeleteTarget(issueId);
  const handleDeleteConfirm = async () => {
    const r = await deleteDevIssue(deleteTarget);
    setDeleteTarget(null);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Delete failed");
    else { onToast?.("success", "Issue deleted"); load(); }
  };

  return (
    <div className="dos-section">
      {assignTarget && (
        <div className="dos-dialog-overlay" onClick={() => setAssignTarget(null)}>
          <div className="dos-dialog" onClick={e => e.stopPropagation()}>
            <div className="dos-dialog-title">Assign Issue</div>
            <input className="dos-input" autoFocus value={assignName} onChange={e => setAssignName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAssignConfirm(); if (e.key === "Escape") setAssignTarget(null); }} placeholder="Assignee name or email" />
            <div className="dos-dialog-actions">
              <button className="dos-btn outline" onClick={() => setAssignTarget(null)}>Cancel</button>
              <button className="dos-btn primary" onClick={handleAssignConfirm} disabled={!assignName.trim()}>Assign</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="dos-dialog-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dos-dialog" onClick={e => e.stopPropagation()}>
            <div className="dos-dialog-title">Delete Issue?</div>
            <div className="dos-dialog-body">This cannot be undone.</div>
            <div className="dos-dialog-actions">
              <button className="dos-btn outline" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="dos-btn danger" onClick={handleDeleteConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <div className="dos-section-header">
        <h3 className="dos-section-title">Developer Issues</h3>
        <button className="dos-btn outline" onClick={openNew}>New issue</button>
      </div>

      <div className="dos-filter-row">
        <input ref={searchRef} className="dos-input dos-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search labels" />
        <select className="dos-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="blocked">Blocked</option>
        </select>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="dos-form-card">
        <div className="dos-form-header"><strong>{editing ? "Edit issue" : "Create issue"}</strong></div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.title} onChange={e => setField("title", e.target.value)} placeholder="Issue title" />
          <select className="dos-select" value={form.type} onChange={e => setField("type", e.target.value)}>
            <option value="bug">Bug</option>
            <option value="task">Task</option>
            <option value="story">Story</option>
          </select>
        </div>
        <div className="dos-form-row">
          <select className="dos-select" value={form.priority} onChange={e => setField("priority", e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <input className="dos-input" value={form.assignee} onChange={e => setField("assignee", e.target.value)} placeholder="Assignee" />
        </div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.repoId} onChange={e => setField("repoId", e.target.value)} placeholder="Repo ID" />
          <input className="dos-input" value={form.projectId} onChange={e => setField("projectId", e.target.value)} placeholder="Project ID" />
        </div>
        <textarea className="dos-input dos-textarea" value={form.description} onChange={e => setField("description", e.target.value)} placeholder="Description" />
        <div className="dos-form-actions">
          <button className="dos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="dos-btn outline" onClick={() => { setEditing(null); setForm(EMPTY_ISSUE); }}>Cancel</button>
        </div>
      </div>

      {loading ? <Skeleton /> : (issues.length === 0 ? <Empty title="No issues found" sub="Track bugs and work items in the Issues tab." /> : (
        <table className="dos-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Repo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <tr key={issue.issueId || issue.id || issue.title}>
                <td className="dos-td-name">{issue.title || "Untitled issue"}</td>
                <td>{issue.status ? <Badge label={issue.status} color={issue.status === "open" ? "var(--accent)" : issue.status === "closed" ? "var(--success)" : "var(--warning)"} /> : "—"}</td>
                <td className="dos-td-dim">{issue.assignee || "—"}</td>
                <td className="dos-td-dim">{issue.repoId || "—"}</td>
                <td className="dos-td-actions">
                  <button className="dos-icon-btn" onClick={() => openEdit(issue)}>Edit</button>
                  <button className="dos-icon-btn" onClick={() => handleAssign(issue.issueId || issue.id)}>Assign</button>
                  <button className="dos-icon-btn success" onClick={() => handleClose(issue.issueId || issue.id)}>Close</button>
                  <button className="dos-icon-btn" onClick={() => handleReopen(issue.issueId || issue.id)}>Reopen</button>
                  <button className="dos-icon-btn danger" onClick={() => handleDelete(issue.issueId || issue.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

const EMPTY_BUILD = { repoId: "", branch: "main", trigger: "manual", status: "success", duration: "0" };
function BuildsView({ onToast }) {
  const [builds, setBuilds] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repoId, setRepoId] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState(EMPTY_BUILD);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, s] = await Promise.all([getDevBuilds({ status: status === "all" ? undefined : status, repoId: repoId || undefined, limit: 100 }), getDevBuildStats({ repoId: repoId || undefined })]);
    setBuilds(b.builds ?? []);
    setStats(s);
    setLoading(false);
  }, [status, repoId]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.repoId.trim()) { onToast?.("error", "Repo ID is required"); return; }
    setSaving(true);
    const payload = { ...form, duration: Number(form.duration) };
    const r = await recordDevBuild(payload);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Record failed");
    else { onToast?.("success", "Build recorded"); setForm(EMPTY_BUILD); load(); }
    setSaving(false);
  };

  return (
    <div className="dos-section">
      <div className="dos-section-header">
        <h3 className="dos-section-title">Builds</h3>
      </div>

      <div className="dos-filter-row">
        <input className="dos-input dos-search" value={repoId} onChange={e => setRepoId(e.target.value)} placeholder="Repo ID filter" />
        <select className="dos-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="dos-form-card">
        <div className="dos-form-header"><strong>Record build</strong></div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.repoId} onChange={e => setField("repoId", e.target.value)} placeholder="Repo ID" />
          <input className="dos-input" value={form.branch} onChange={e => setField("branch", e.target.value)} placeholder="Branch" />
        </div>
        <div className="dos-form-row">
          <select className="dos-select" value={form.trigger} onChange={e => setField("trigger", e.target.value)}>
            <option value="manual">Manual</option>
            <option value="push">Push</option>
            <option value="scheduled">Scheduled</option>
          </select>
          <select className="dos-select" value={form.status} onChange={e => setField("status", e.target.value)}>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.duration} onChange={e => setField("duration", e.target.value)} placeholder="Duration (seconds)" />
        </div>
        <div className="dos-form-actions">
          <button className="dos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Recording…" : "Record build"}</button>
        </div>
      </div>

      {stats && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">Build Stats</h4>
          <div className="dos-split-row">
            <div>
              <strong>{stats.totalBuilds ?? 0}</strong>
              <div className="dos-text-dim">Total builds</div>
            </div>
            <div>
              <strong>{stats.successRate ? `${Math.round(stats.successRate * 100)}%` : "—"}</strong>
              <div className="dos-text-dim">Success rate</div>
            </div>
            <div>
              <strong>{stats.averageDuration ? `${Math.round(stats.averageDuration)}s` : "—"}</strong>
              <div className="dos-text-dim">Average duration</div>
            </div>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : (builds.length === 0 ? <Empty title="No builds found" sub="Record a build to see recent CI activity." /> : (
        <table className="dos-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Trigger</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {builds.map(build => (
              <tr key={build.buildId || build.id || `${build.repoId}-${build.branch}-${build.createdAt}`}>
                <td className="dos-td-name">{build.repoId || "—"}</td>
                <td>{build.status ? <Badge label={build.status} color={build.status === "success" ? "var(--success)" : build.status === "failed" ? "var(--danger)" : "var(--accent)"} /> : "—"}</td>
                <td className="dos-td-dim">{build.branch || "—"}</td>
                <td className="dos-td-dim">{build.trigger || "—"}</td>
                <td className="dos-td-dim">{build.duration != null ? `${build.duration}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

const EMPTY_DEPLOYMENT = { repoId: "", projectId: "", environment: "staging", status: "success", target: "web", duration: "0" };
function DeploymentsView({ onToast }) {
  const [deployments, setDeployments] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repoId, setRepoId] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState(EMPTY_DEPLOYMENT);
  const [saving, setSaving] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [rollbackReason, setRollbackReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s] = await Promise.all([getDevDeployments({ status: status === "all" ? undefined : status, repoId: repoId || undefined, limit: 100 }), getDevDeploymentStats({ repoId: repoId || undefined })]);
    setDeployments(d.deployments ?? []);
    setStats(s);
    setLoading(false);
  }, [status, repoId]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.repoId.trim()) { onToast?.("error", "Repo ID is required"); return; }
    setSaving(true);
    const payload = { ...form, duration: Number(form.duration) };
    const r = await recordDevDeployment(payload);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Record failed");
    else { onToast?.("success", "Deployment recorded"); setForm(EMPTY_DEPLOYMENT); load(); }
    setSaving(false);
  };

  const handleRollback = (deploymentId) => { setRollbackTarget(deploymentId); setRollbackReason(""); };
  const handleRollbackConfirm = async () => {
    if (!rollbackReason.trim()) return;
    const r = await rollbackDevDeployment(rollbackTarget, { reason: rollbackReason.trim() });
    setRollbackTarget(null);
    if (r.success === false || r.ok === false) onToast?.("error", r.error || "Rollback failed");
    else { onToast?.("success", "Rollback recorded"); load(); }
  };

  return (
    <div className="dos-section">
      {rollbackTarget && (
        <div className="dos-dialog-overlay" onClick={() => setRollbackTarget(null)}>
          <div className="dos-dialog" onClick={e => e.stopPropagation()}>
            <div className="dos-dialog-title">Rollback Deployment</div>
            <input className="dos-input" autoFocus value={rollbackReason} onChange={e => setRollbackReason(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleRollbackConfirm(); if (e.key === "Escape") setRollbackTarget(null); }} placeholder="Reason for rollback…" />
            <div className="dos-dialog-actions">
              <button className="dos-btn outline" onClick={() => setRollbackTarget(null)}>Cancel</button>
              <button className="dos-btn danger" onClick={handleRollbackConfirm} disabled={!rollbackReason.trim()}>Rollback</button>
            </div>
          </div>
        </div>
      )}
      <div className="dos-section-header">
        <h3 className="dos-section-title">Deployments</h3>
      </div>

      <div className="dos-filter-row">
        <input className="dos-input dos-search" value={repoId} onChange={e => setRepoId(e.target.value)} placeholder="Repo ID filter" />
        <select className="dos-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="rolling_back">Rolling back</option>
        </select>
        <button className="dos-btn outline" onClick={load}>Refresh</button>
      </div>

      <div className="dos-form-card">
        <div className="dos-form-header"><strong>Record deployment</strong></div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.repoId} onChange={e => setField("repoId", e.target.value)} placeholder="Repo ID" />
          <input className="dos-input" value={form.projectId} onChange={e => setField("projectId", e.target.value)} placeholder="Project ID" />
        </div>
        <div className="dos-form-row">
          <select className="dos-select" value={form.environment} onChange={e => setField("environment", e.target.value)}>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
            <option value="qa">QA</option>
          </select>
          <select className="dos-select" value={form.status} onChange={e => setField("status", e.target.value)}>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="rolling_back">Rolling back</option>
          </select>
        </div>
        <div className="dos-form-row">
          <input className="dos-input" value={form.target} onChange={e => setField("target", e.target.value)} placeholder="Target" />
          <input className="dos-input" value={form.duration} onChange={e => setField("duration", e.target.value)} placeholder="Duration (seconds)" />
        </div>
        <div className="dos-form-actions">
          <button className="dos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Recording…" : "Record deployment"}</button>
        </div>
      </div>

      {stats && (
        <div className="dos-dash-block">
          <h4 className="dos-block-title">Deployment Stats</h4>
          <div className="dos-split-row">
            <div>
              <strong>{stats.totalDeployments ?? 0}</strong>
              <div className="dos-text-dim">Total deployments</div>
            </div>
            <div>
              <strong>{stats.successRate ? `${Math.round(stats.successRate * 100)}%` : "—"}</strong>
              <div className="dos-text-dim">Success rate</div>
            </div>
            <div>
              <strong>{stats.averageLeadTime ? `${Math.round(stats.averageLeadTime)}m` : "—"}</strong>
              <div className="dos-text-dim">Lead time</div>
            </div>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : (deployments.length === 0 ? <Empty title="No deployments found" sub="Record a deployment to track release activity." /> : (
        <table className="dos-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Status</th>
              <th>Env</th>
              <th>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {deployments.map(deployment => (
              <tr key={deployment.deploymentId || deployment.id || `${deployment.repoId}-${deployment.environment}-${deployment.createdAt}`}>
                <td className="dos-td-name">{deployment.repoId || "—"}</td>
                <td>{deployment.status ? <Badge label={deployment.status} color={deployment.status === "success" ? "var(--success)" : deployment.status === "failed" ? "var(--danger)" : "var(--accent)"} /> : "—"}</td>
                <td className="dos-td-dim">{deployment.environment || "—"}</td>
                <td className="dos-td-dim">{deployment.target || "—"}</td>
                <td className="dos-td-actions">
                  <button className="dos-icon-btn danger" onClick={() => handleRollback(deployment.deploymentId || deployment.id)}>Rollback</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

export default function DeveloperOS({ onToast }) {
  const [activeView, setActiveView] = useState("overview");

  return (
    <div className="dos-root">
      <div className="dos-subnav">
        {VIEWS.map(view => (
          <button
            key={view.id}
            className={`dos-subnav-btn ${activeView === view.id ? "active" : ""}`}
            onClick={() => setActiveView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div className="dos-content">
        {activeView === "overview" && <OverviewView onToast={onToast} />}
        {activeView === "repos" && <ReposView onToast={onToast} />}
        {activeView === "projects" && <ProjectsView onToast={onToast} />}
        {activeView === "issues" && <IssuesView onToast={onToast} />}
        {activeView === "builds" && <BuildsView onToast={onToast} />}
        {activeView === "deployments" && <DeploymentsView onToast={onToast} />}
      </div>
    </div>
  );
}
