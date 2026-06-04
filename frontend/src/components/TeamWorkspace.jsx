import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./TeamWorkspace.css";

// ── Storage ───────────────────────────────────────────────────────────
const MEMBERS_KEY  = "ooplix_team_members";
const INVITES_KEY  = "ooplix_team_invites";
const ACTIVITY_KEY = "ooplix_team_activity";

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

// ── Role definitions ─────────────────────────────────────────────────
const ROLES = [
  {
    id:    "owner",
    label: "Owner",
    color: "var(--warning)",
    icon:  "◉",
    desc:  "Full control. Can manage billing, delete workspace, and assign all roles.",
    perms: ["All permissions"],
  },
  {
    id:    "admin",
    label: "Admin",
    color: "var(--accent)",
    icon:  "◈",
    desc:  "Manage team, settings, and integrations. Cannot delete workspace or change billing.",
    perms: ["Manage team", "Manage settings", "View billing", "Full data access"],
  },
  {
    id:    "manager",
    label: "Manager",
    color: "var(--accent2)",
    icon:  "◎",
    desc:  "Manage contacts, run campaigns, view pipeline. Cannot change settings.",
    perms: ["Manage contacts", "Run campaigns", "View pipeline", "View team activity"],
  },
  {
    id:    "operator",
    label: "Operator",
    color: "#52d68a",
    icon:  "▷",
    desc:  "Execute tasks, send messages, update lead status. Cannot manage other users.",
    perms: ["Execute tasks", "Send messages", "Update leads", "View pipeline"],
  },
  {
    id:    "viewer",
    label: "Viewer",
    color: "var(--text-faint)",
    icon:  "○",
    desc:  "Read-only access. Can view pipeline, contacts, and reports. Cannot take action.",
    perms: ["View pipeline", "View contacts", "View reports"],
  },
];

// ── Seed data ─────────────────────────────────────────────────────────
const SEED_MEMBERS = [
  { id: "m1", name: "You (Account Owner)", email: "owner@ooplix.com", role: "owner",    joined: "2026-01-01", lastActive: "Today",      status: "active"   },
];

const SEED_ACTIVITY = [
  { id: "a1", actor: "You",        action: "Workspace created",             ts: "2 months ago" },
  { id: "a2", actor: "You",        action: "WhatsApp connected",            ts: "2 months ago" },
  { id: "a3", actor: "You",        action: "First contact added",           ts: "6 weeks ago"  },
  { id: "a4", actor: "You",        action: "Billing plan upgraded",         ts: "3 weeks ago"  },
];

function RoleBadge({ role }) {
  const def = ROLES.find(r => r.id === role) || ROLES[4];
  return (
    <span className="tw-role-badge" style={{ color: def.color, borderColor: def.color + "33" }}>
      {def.icon} {def.label}
    </span>
  );
}

function MemberRow({ member, isOnly, onChangeRole, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="tw-member-row">
      <div className="tw-member-avatar" style={{ background: `hsl(${member.name.charCodeAt(0) * 7 % 360}, 50%, 25%)` }}>
        {member.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="tw-member-info">
        <span className="tw-member-name">{member.name}</span>
        <span className="tw-member-email">{member.email}</span>
      </div>
      <span className="tw-member-last">{member.lastActive}</span>
      <RoleBadge role={member.role} />
      {!isOnly && member.role !== "owner" && (
        <div className="tw-member-actions">
          <button className="tw-member-menu-btn" onClick={() => setMenuOpen(o => !o)}>⋯</button>
          {menuOpen && (
            <div className="tw-member-menu">
              {ROLES.filter(r => r.id !== "owner" && r.id !== member.role).map(r => (
                <button key={r.id} className="tw-menu-item" onClick={() => { onChangeRole(member.id, r.id); setMenuOpen(false); }}>
                  Set as {r.label}
                </button>
              ))}
              <button className="tw-menu-item tw-menu-item--danger" onClick={() => { onRemove(member.id); setMenuOpen(false); }}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InviteForm({ onInvite, onCancel }) {
  const [email, setEmail] = useState("");
  const [role,  setRole]  = useState("operator");
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    onInvite({ email: email.trim(), role });
  };
  return (
    <form className="tw-invite-form" onSubmit={handleSubmit}>
      <h3 className="tw-invite-title">Invite team member</h3>
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
            {ROLES.filter(r => r.id !== "owner").map(r => (
              <option key={r.id} value={r.id}>{r.label} — {r.desc.split(".")[0]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="tw-invite-actions">
        <button type="button" className="tw-cancel-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="tw-send-btn">Send invite →</button>
      </div>
    </form>
  );
}

export default function TeamWorkspace({ onNavigate }) {
  const [section,     setSection]     = useState("members");
  const [members,     setMembers]     = useState(() => _load(MEMBERS_KEY, SEED_MEMBERS));
  const [invites,     setInvites]     = useState(() => _load(INVITES_KEY, []));
  const [activity,    setActivity]    = useState(() => _load(ACTIVITY_KEY, SEED_ACTIVITY));
  const [showInvite,  setShowInvite]  = useState(false);
  const [toastMsg,    setToastMsg]    = useState(null);

  React.useEffect(() => { track.event("team_workspace_viewed"); }, []);

  const toast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const handleInvite = useCallback((data) => {
    const inv = { id: `inv_${Date.now()}`, ...data, status: "pending", sentAt: new Date().toISOString() };
    const all = [...invites, inv];
    _save(INVITES_KEY, all);
    setInvites(all);
    setShowInvite(false);
    toast(`Invite sent to ${data.email}`);
    track.event("team_invite_sent", { role: data.role });
  }, [invites]);

  const handleChangeRole = useCallback((memberId, newRole) => {
    const updated = members.map(m => m.id === memberId ? { ...m, role: newRole } : m);
    _save(MEMBERS_KEY, updated);
    setMembers(updated);
    toast("Role updated");
  }, [members]);

  const handleRemove = useCallback((memberId) => {
    const updated = members.filter(m => m.id !== memberId);
    _save(MEMBERS_KEY, updated);
    setMembers(updated);
    toast("Member removed");
  }, [members]);

  const handleCancelInvite = useCallback((invId) => {
    const updated = invites.filter(i => i.id !== invId);
    _save(INVITES_KEY, updated);
    setInvites(updated);
    toast("Invite cancelled");
  }, [invites]);

  return (
    <div className="team-workspace page-enter">
      {toastMsg && <div className="tw-toast">{toastMsg}</div>}

      <div className="tw-header">
        <div>
          <h1 className="tw-title">Team Workspace</h1>
          <p className="tw-subtitle">Manage members, roles, permissions, and workspace activity.</p>
        </div>
        <button className="tw-invite-btn" onClick={() => setShowInvite(true)}>+ Invite member</button>
      </div>

      {/* Summary strip */}
      <div className="tw-summary-strip">
        {[
          { label: "Members",         value: members.length },
          { label: "Pending invites", value: invites.filter(i => i.status === "pending").length },
          { label: "Roles",           value: [...new Set(members.map(m => m.role))].length },
          { label: "Active today",    value: members.filter(m => m.lastActive === "Today").length },
        ].map(s => (
          <div key={s.label} className="tw-summary-item">
            <span className="tw-summary-value">{s.value}</span>
            <span className="tw-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="tw-tabs">
        {[
          { id: "members",     label: "Members"     },
          { id: "invites",     label: `Invites${invites.length ? ` (${invites.length})` : ""}` },
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

        {/* Invite modal */}
        {showInvite && (
          <div className="tw-modal-overlay" onClick={() => setShowInvite(false)}>
            <div className="tw-modal" onClick={e => e.stopPropagation()}>
              <InviteForm onInvite={handleInvite} onCancel={() => setShowInvite(false)} />
            </div>
          </div>
        )}

        {/* Members */}
        {section === "members" && (
          <div className="tw-members-section">
            <div className="tw-members-list">
              {members.map(m => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isOnly={members.length === 1}
                  onChangeRole={handleChangeRole}
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
          </div>
        )}

        {/* Invites */}
        {section === "invites" && (
          <div className="tw-invites-section">
            {invites.length === 0 ? (
              <div className="tw-empty">
                <span className="tw-empty-icon">✉</span>
                <p className="tw-empty-title">No pending invites</p>
                <p className="tw-empty-sub">Invite a team member to get started.</p>
                <button className="tw-empty-cta" onClick={() => setShowInvite(true)}>Send invite →</button>
              </div>
            ) : (
              <div className="tw-invite-list">
                {invites.map(inv => (
                  <div key={inv.id} className="tw-invite-row">
                    <div className="tw-invite-info">
                      <span className="tw-invite-email">{inv.email}</span>
                      <span className="tw-invite-meta">
                        Sent {new Date(inv.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <RoleBadge role={inv.role} />
                    <span className={`tw-invite-status tw-invite-status--${inv.status}`}>{inv.status}</span>
                    <button className="tw-revoke-btn" onClick={() => handleCancelInvite(inv.id)}>Cancel</button>
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
            <div className="tw-activity-list">
              {activity.map(a => (
                <div key={a.id} className="tw-activity-row">
                  <span className="tw-activity-dot" />
                  <span className="tw-activity-actor">{a.actor}</span>
                  <span className="tw-activity-action">{a.action}</span>
                  <span className="tw-activity-ts">{a.ts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
