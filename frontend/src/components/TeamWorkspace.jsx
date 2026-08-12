import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { _fetch } from "../_client";
import { useConfirm } from "./ConfirmDialog.jsx";
import "./TeamWorkspace.css";
import { clickableProps } from "../hooks/useClickableProps";
import { overlayProps } from "../hooks/useClickableProps";

// ── Role definitions ─────────────────────────────────────────────────
// Matches the real backend role vocabulary (workspaceService.cjs ROLES) —
// the fictional owner/admin/manager/operator/viewer set previously used
// here didn't correspond to anything the API actually returns or accepts.
const ROLES = [
  {
    id:    "Owner",
    label: "Owner",
    color: "var(--warning)",
    icon:  "◉",
    desc:  "Full control. Can manage billing, delete workspace, and assign all roles.",
    perms: ["All permissions"],
  },
  {
    id:    "Admin",
    label: "Admin",
    color: "var(--accent)",
    icon:  "◈",
    desc:  "Manage team, settings, and integrations. Cannot delete workspace or change billing.",
    perms: ["Manage team", "Manage settings", "View billing", "Full data access"],
  },
  {
    id:    "Operator",
    label: "Operator",
    color: "var(--success)",
    icon:  "▷",
    desc:  "Execute tasks, send messages, update lead status. Cannot manage other users.",
    perms: ["Execute tasks", "Send messages", "Update leads", "View pipeline"],
  },
  {
    id:    "Developer",
    label: "Developer",
    color: "var(--accent2)",
    icon:  "◎",
    desc:  "Access engineering tools, code workspace, and deployment controls.",
    perms: ["Code workspace", "Deployments", "View pipeline", "View team activity"],
  },
  {
    id:    "Viewer",
    label: "Viewer",
    color: "var(--text-faint)",
    icon:  "○",
    desc:  "Read-only access. Can view pipeline, contacts, and reports. Cannot take action.",
    perms: ["View pipeline", "View contacts", "View reports"],
  },
];
const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));

function RoleBadge({ role }) {
  const def = ROLE_BY_ID[role] || ROLES[4];
  return (
    <span className="tw-role-badge" style={{ color: def.color, borderColor: def.color + "33" }}>
      {def.icon} {def.label}
    </span>
  );
}

function MemberRow({ member, isOnly, onRemove }) {
  return (
    <div className="tw-member-row">
      <div className="tw-member-avatar" style={{ background: `hsl(${(member.name || "?").charCodeAt(0) * 7 % 360}, 50%, 25%)` }}>
        {(member.name || member.accountId || "?").slice(0, 2).toUpperCase()}
      </div>
      <div className="tw-member-info">
        <span className="tw-member-name">{member.name}</span>
        <span className="tw-member-email">{member.email}</span>
      </div>
      <RoleBadge role={member.role} />
      {!isOnly && member.role !== "Owner" && (
        <button className="tw-menu-item tw-menu-item--danger" onClick={() => onRemove(member.accountId)}>
          Remove
        </button>
      )}
    </div>
  );
}

function InviteForm({ onInvite, onCancel, submitting }) {
  const [email, setEmail] = useState("");
  const [role,  setRole]  = useState("Operator");
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    onInvite({ email: email.trim(), role });
  };
  return (
    <form className="tw-invite-form" onSubmit={handleSubmit}>
      <h3 className="tw-invite-title" id="tw-invite-title">Invite team member</h3>
      <div className="tw-invite-fields">
        <div className="tw-invite-field">
          <label className="tw-field-label">Email address</label>
          <input
            className="tw-field-input"
            type="email"
            placeholder="colleague@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="tw-invite-field">
          <label className="tw-field-label">Role</label>
          <select className="tw-field-select" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.filter(r => r.id !== "Owner").map(r => (
              <option key={r.id} value={r.id}>{r.label} — {r.desc.split(".")[0]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="tw-invite-actions">
        <button type="button" className="tw-cancel-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="tw-send-btn" disabled={submitting}>{submitting ? "Sending…" : "Send invite →"}</button>
      </div>
    </form>
  );
}

// ── K1 Workspaces panel ───────────────────────────────────────────
const K1_ROLES = ROLES.map(r => r.id);
const K1_ROLE_COLOR = Object.fromEntries(ROLES.map(r => [r.id, r.color]));

// Workspace list/switch/create only — members/invites/activity now live in
// the parent (TeamWorkspace) so the top-level Members/Invites/Activity tabs
// can share the same real data instead of duplicating the fetch here.
function WorkspacesPanel({ workspaces, activeId, loading, onSwitch, onCreated, toast }) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");

  async function doCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const d = await _fetch("/workspace", { method: "POST", body: JSON.stringify({ name }) });
      onCreated(d.workspace);
      setNewName(""); setCreating(false);
      toast(`Workspace "${name}" created`);
    } catch (e) { toast(e.message || "Create failed"); }
  }

  const activeWs = workspaces.find(w => w.id === activeId);

  if (loading) return <div className="tw-ws-loading">Loading workspaces…</div>;

  return (
    <div className="tw-ws-panel">
      <div className="tw-ws-list">
        <div className="tw-ws-list-header">
          <span>{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</span>
          <button className="tw-ws-create-btn" onClick={() => setCreating(c => !c)}>＋ New</button>
        </div>

        {creating && (
          <div className="tw-ws-create-form">
            <input
              autoFocus className="tw-ws-create-input" placeholder="Workspace name…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doCreate(); if (e.key === "Escape") setCreating(false); }}
            />
            <button className="tw-ws-create-confirm" onClick={doCreate} disabled={!newName.trim()}>Create</button>
          </div>
        )}

        {workspaces.map(ws => (
          <div key={ws.id} className={`tw-ws-card${ws.id === activeId ? " tw-ws-card--active" : ""}`}>
            <div className="tw-ws-card-avatar">{ws.name.slice(0, 2).toUpperCase()}</div>
            <div className="tw-ws-card-meta">
              <span className="tw-ws-card-name">{ws.name}</span>
              <span className="tw-ws-card-info">{ws.members?.length || 0} members · {ws.description || "No description"}</span>
            </div>
            {ws.id === activeId
              ? <span className="tw-ws-active-badge">Active</span>
              : <button className="tw-ws-switch-btn" onClick={() => onSwitch(ws.id)}>Switch →</button>
            }
          </div>
        ))}

        {activeWs && (
          <div className="tw-ws-active-info">
            <span className="tw-ws-active-label">Active:</span>
            <span className="tw-ws-active-name">{activeWs.name}</span>
            <span className="tw-ws-active-role" style={{ color: K1_ROLE_COLOR[activeWs.myRole] || "var(--text-faint)" }}>
              {activeWs.myRole || "Member"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamWorkspace({ onNavigate }) {
  const [section,     setSection]     = useState("members");
  const [workspaces,  setWorkspaces]  = useState([]);
  const [activeId,    setActiveId]    = useState(null);
  const [members,     setMembers]     = useState([]);
  const [pendingInvs, setPendingInvs] = useState([]);
  const [activity,    setActivity]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviting,    setInviting]    = useState(false);
  const [toastMsg,    setToastMsg]    = useState(null);
  const [retryToken,  setRetryToken]  = useState(0);
  const [confirm, ConfirmUI]          = useConfirm();

  React.useEffect(() => { track.event("team_workspace_viewed"); }, []);

  const toast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await _fetch("/workspace");
      setWorkspaces(d.workspaces || []);
      setActiveId(d.activeWorkspaceId || null);
      const wsId = d.activeWorkspaceId;
      if (wsId) {
        const [mem, act] = await Promise.all([
          _fetch(`/workspace/${wsId}/members`).then(r => r.members || []),
          _fetch(`/workspace/activity?workspaceId=${wsId}`).then(r => r.activity || []),
        ]);
        setMembers(mem);
        setActivity(act);
        const ws = (d.workspaces || []).find(w => w.id === wsId);
        setPendingInvs((ws?.invitations || []).filter(i => !i.usedAt && i.expiresAt > Date.now()));
      } else {
        setMembers([]); setActivity([]); setPendingInvs([]);
      }
    } catch (e) {
      setError(e.message || "Failed to load team data");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, retryToken]);

  async function doSwitch(id) {
    try {
      await _fetch("/workspace/switch", { method: "POST", body: JSON.stringify({ workspaceId: id }) });
      setActiveId(id); load();
      toast("Workspace switched");
    } catch (e) { toast(e.message || "Switch failed"); }
  }

  const handleInvite = useCallback(async (data) => {
    if (!activeId) { toast("No active workspace"); return; }
    setInviting(true);
    try {
      // A.6 business-owner-journey finding: this always showed "Invite
      // sent to {email}" as soon as the invite RECORD was created,
      // discarding the response body entirely — so it never actually
      // checked whether the email itself sent. Confirmed live: with zero
      // email provider credentials configured, the invite record was
      // created (pending invite correctly appeared) but no email could
      // possibly have been delivered, and the founder still saw "sent."
      // The backend already returns the real emailSent/emailError fields
      // (backend/routes/workspace.js) — this now reads and shows them
      // instead of a hardcoded success message.
      const res = await _fetch("/workspace/invite", {
        method: "POST",
        body: JSON.stringify({ workspaceId: activeId, email: data.email, role: data.role }),
      });
      setShowInvite(false);
      if (res?.emailSent === false) {
        toast(`Invite created for ${data.email}, but the email could not be sent: ${res.emailError || "unknown error"}`);
      } else {
        toast(`Invite sent to ${data.email}`);
      }
      track.event("team_invite_sent", { role: data.role, emailSent: res?.emailSent !== false });
      load();
    } catch (e) { toast(e.message || "Invite failed"); }
    setInviting(false);
  }, [activeId, load]);

  // Phase A.11.8 — destructive-action confirmation recovered in place.
  // This is the app's established pattern for irreversible actions:
  // ConfirmDialog/useConfirm, already used by OrgAdminCenter's five sites
  // (A.11.5), the CRM (A.11.2), connector Disconnect (A.11.7) and
  // WorkspaceSettingsL1. A.11.5 deliberately left THIS site unfixed because it
  // was treated as part of that phase's UNKNOWN-A (TeamWorkspace's local toast
  // subsystem, which genuinely does require re-wiring `onToast` through
  // App.jsx). Re-evaluated here as instructed: the two are separable. useConfirm
  // is entirely self-contained — a hook plus a rendered element, no prop
  // threading, no call-signature change in App.jsx, nothing deleted — so gating
  // this DELETE is an in-place recovery of an existing pattern, not the toast
  // re-architecture. The toast subsystem is left exactly as it was.
  const handleRemove = useCallback(async (accountId) => {
    if (!activeId) return;
    const member = members.find(m => m.accountId === accountId);
    if (!await confirm({
      title: `Remove ${member?.name || member?.email || "this member"}?`,
      message: "They will immediately lose access to this workspace. You can invite them again later.",
      danger: true,
      confirmLabel: "Remove",
    })) return;
    try {
      await _fetch(`/workspace/${activeId}/members/${accountId}`, { method: "DELETE" });
      setMembers(prev => prev.filter(m => m.accountId !== accountId));
      toast("Member removed");
    } catch (e) { toast(e.message || "Remove failed"); }
  }, [activeId, members, confirm]);

  return (
    <div className="team-workspace page-enter">
      {ConfirmUI}
      {toastMsg && <div className="tw-toast">{toastMsg}</div>}

      <div className="tw-header">
        <div>
          <h1 className="tw-title">Team Workspace</h1>
          <p className="tw-subtitle">Manage members, roles, permissions, and workspace activity.</p>
        </div>
        <button className="tw-invite-btn" onClick={() => setShowInvite(true)}>+ Invite member</button>
      </div>

      {/* Summary strip.
          The tiles sit ABOVE the `error` guard on .tw-content, so when the load
          genuinely fails they still render — and used to assert "0 MEMBERS /
          0 ROLES / 0 WORKSPACES" as fact while the banner below said the data
          couldn't load. Measured live: a real account with 1 real member, 1 real
          role and 1 real workspace displayed 0/0/0/0 under a request timeout.
          When the truth is unknown, show the app's established "—" unknown
          placeholder (MissionControlV1.jsx's metric cards, BillingDashboard's
          own summary row) instead of a confident, false zero. */}
      <div className="tw-summary-strip">
        {[
          { label: "Members",         value: error || loading ? "—" : members.length },
          { label: "Pending invites", value: error || loading ? "—" : pendingInvs.length },
          { label: "Roles",           value: error || loading ? "—" : [...new Set(members.map(m => m.role))].length },
          { label: "Workspaces",      value: error || loading ? "—" : workspaces.length },
        ].map(s => (
          <div key={s.label} className="tw-summary-item">
            <span className="tw-summary-value">{s.value}</span>
            <span className="tw-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="tw-tabs">
        {[
          { id: "workspaces",  label: "Workspaces"  },
          { id: "members",     label: "Members"     },
          { id: "invites",     label: `Invites${pendingInvs.length ? ` (${pendingInvs.length})` : ""}` },
          { id: "roles",       label: "Roles"       },
          { id: "permissions", label: "Permissions" },
          { id: "activity",    label: "Activity"    },
        ].map(t => (
          <button
            key={t.id}
            className={`tw-tab${section === t.id ? " tw-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="tw-content" key={section}>

        {error ? (
          <div className="k2-error">
            <span>Couldn't load team data — {error}.</span>
            <button className="k2-error-retry" onClick={() => setRetryToken(t => t + 1)}>Retry</button>
          </div>
        ) : (
          <>
            {/* K1 — Enterprise Workspaces */}
            {section === "workspaces" && (
              <WorkspacesPanel
                workspaces={workspaces} activeId={activeId} loading={loading}
                onSwitch={doSwitch} onCreated={ws => setWorkspaces(prev => [...prev, ws])} toast={toast}
              />
            )}

            {/* Invite modal */}
            {showInvite && (
              <div className="tw-modal-overlay" {...overlayProps(() => setShowInvite(false))}>
                <div className="tw-modal" role="dialog" aria-modal="true" aria-labelledby="tw-invite-title" {...clickableProps(e => e.stopPropagation())}>
                  <InviteForm onInvite={handleInvite} onCancel={() => setShowInvite(false)} submitting={inviting} />
                </div>
              </div>
            )}

            {/* Members */}
            {section === "members" && (
              <div className="tw-members-section">
                {loading ? (
                  <div className="k2-loading">Loading members…</div>
                ) : (
                  <>
                    <div className="tw-members-list">
                      {members.map(m => (
                        <MemberRow
                          key={m.accountId}
                          member={m}
                          isOnly={members.length === 1}
                          onRemove={handleRemove}
                        />
                      ))}
                    </div>
                    {members.length === 1 && (
                      <div className="tw-solo-prompt">
                        <span className="tw-solo-icon">◈</span>
                        <div>
                          <p className="tw-solo-title">You're the only member</p>
                          <p className="tw-solo-sub">Invite colleagues to collaborate. Each role has specific access — see the Roles tab for details.</p>
                        </div>
                        <button className="tw-solo-cta" onClick={() => setShowInvite(true)}>Invite someone →</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

        {/* Invites */}
        {section === "invites" && (
          <div className="tw-invites-section">
            {loading ? (
              <div className="k2-loading">Loading invites…</div>
            ) : pendingInvs.length === 0 ? (
              <div className="tw-empty">
                <span className="tw-empty-icon">✉</span>
                <p className="tw-empty-title">No pending invites</p>
                <p className="tw-empty-sub">Invite a team member to get started.</p>
                <button className="tw-empty-cta" onClick={() => setShowInvite(true)}>Send invite →</button>
              </div>
            ) : (
              <div className="tw-invite-list">
                {pendingInvs.map((inv, i) => (
                  <div key={i} className="tw-invite-row">
                    <div className="tw-invite-info">
                      <span className="tw-invite-email">{inv.email}</span>
                      <span className="tw-invite-meta">
                        Expires {new Date(inv.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <RoleBadge role={inv.role} />
                    <span className="tw-invite-status tw-invite-status--pending">pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Roles */}
        {section === "roles" && (
          <div className="tw-roles-list">
            {ROLES.map(r => (
              <div key={r.id} className="tw-role-card">
                <div className="tw-role-header">
                  <span className="tw-role-icon" style={{ color: r.color }}>{r.icon}</span>
                  <div className="tw-role-name-block">
                    <span className="tw-role-name" style={{ color: r.color }}>{r.label}</span>
                    <span className="tw-role-count">
                      {members.filter(m => m.role === r.id).length} member{members.filter(m => m.role === r.id).length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <p className="tw-role-desc">{r.desc}</p>
                <div className="tw-role-perms">
                  {r.perms.map((p, i) => (
                    <span key={i} className="tw-perm-chip" style={{ borderColor: r.color + "33", color: r.color }}>✓ {p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Permissions matrix */}
        {section === "permissions" && (
          <div className="tw-perms-section">
            <p className="tw-perms-note">Permission matrix — what each role can do.</p>
            <div className="tw-perms-table-wrap">
              <table className="tw-perms-table">
                <thead>
                  <tr>
                    <th className="tw-pth tw-pth--action">Action</th>
                    {ROLES.map(r => (
                      <th key={r.id} className="tw-pth" style={{ color: r.color }}>{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { action: "View pipeline",          perms: [1, 1, 1, 1, 1] },
                    { action: "View contacts",           perms: [1, 1, 1, 1, 1] },
                    { action: "View reports",            perms: [1, 1, 1, 1, 1] },
                    { action: "Update lead status",      perms: [1, 1, 1, 1, 0] },
                    { action: "Send messages",           perms: [1, 1, 1, 1, 0] },
                    { action: "Execute tasks",           perms: [1, 1, 1, 1, 0] },
                    { action: "Run campaigns",           perms: [1, 1, 1, 0, 0] },
                    { action: "Manage contacts",         perms: [1, 1, 1, 0, 0] },
                    { action: "View team activity",      perms: [1, 1, 1, 0, 0] },
                    { action: "Manage settings",         perms: [1, 1, 0, 0, 0] },
                    { action: "Manage team",             perms: [1, 1, 0, 0, 0] },
                    { action: "View billing",            perms: [1, 1, 0, 0, 0] },
                    { action: "Manage integrations",     perms: [1, 1, 0, 0, 0] },
                    { action: "Change billing/plan",     perms: [1, 0, 0, 0, 0] },
                    { action: "Delete workspace",        perms: [1, 0, 0, 0, 0] },
                    { action: "Assign all roles",        perms: [1, 0, 0, 0, 0] },
                  ].map((row, i) => (
                    <tr key={i} className="tw-ptr">
                      <td className="tw-ptd tw-ptd--action">{row.action}</td>
                      {row.perms.map((p, j) => (
                        <td key={j} className="tw-ptd">
                          {p
                            ? <span className="tw-perm-yes" style={{ color: ROLES[j].color }}>✓</span>
                            : <span className="tw-perm-no">—</span>
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Activity */}
        {section === "activity" && (
          <div className="tw-activity-section">
            <p className="tw-activity-note">Recent workspace activity. Full audit log available in Workspace Settings.</p>
            {loading ? (
              <div className="k2-loading">Loading activity…</div>
            ) : activity.length === 0 ? (
              <div className="tw-empty">
                <p className="tw-empty-title">No activity yet</p>
              </div>
            ) : (
              <div className="tw-activity-list">
                {activity.map((a, i) => (
                  <div key={i} className="tw-activity-row">
                    <span className="tw-activity-dot" />
                    <span className="tw-activity-actor">{members.find(m => m.accountId === a.accountId)?.name || a.accountId}</span>
                    <span className="tw-activity-action">{a.action}</span>
                    {a.detail && <span className="tw-ws-act-detail">{a.detail}</span>}
                    <span className="tw-activity-ts">{new Date(a.ts).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
          </>
        )}

      </div>
    </div>
  );
}
