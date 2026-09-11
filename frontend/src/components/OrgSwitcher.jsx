import React, { useState, useEffect, useRef, useCallback } from "react";
import { _fetch } from "../_client";
import { useAuth } from "../contexts/AuthContext";

const ROLE_COLOR = {
  org_owner: "var(--warning)",
  org_admin: "var(--accent)",
  dept_lead: "var(--success)",
  team_lead: "var(--accent2)",
  member:    "var(--text-dim)",
  viewer:    "var(--text-faint)",
};

// Company/organization switcher — the real multi-tenant boundary
// (backend/routes/organizations.js). Deliberately separate from
// WorkspaceSwitcher.jsx: workspaces and organizations are two distinct, both
// real systems in this codebase (see V2 multi-tenant mission Module 1 audit)
// — an org is the tenant/company boundary with isolated CRM/vault/mission
// data (Module 2) and per-org billing visibility (Module 3); a workspace is
// a lighter-weight project/team grouping. This component is additive: it
// does nothing if the account has no org memberships yet.
export default function OrgSwitcher({ onNavigate }) {
  const { logout } = useAuth();
  const [open, setOpen]         = useState(false);
  const [orgs, setOrgs]         = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [error, setError]       = useState(null);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await _fetch("/orgs/me/context");
      if (d.ok === false) return;
      setOrgs(d.orgs || []);
      setActiveId(d.primaryOrg?.orgId || null);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeOrg = orgs.find(o => o.orgId === activeId);

  async function doSwitch(orgId) {
    if (orgId === activeId) { setOpen(false); return; }
    setError(null);
    try {
      const r = await _fetch("/orgs/switch", { method: "POST", body: JSON.stringify({ orgId }) });
      if (r.ok === false) { setError(r.error || "Switch failed"); return; }
      setActiveId(orgId);
      setOpen(false);
      // Real, observed friction (Phase A.10.5): CustomerDashboard.jsx (and any
      // other org-scoped panel) fetches org/pipeline data once on mount and
      // never re-fetches — after switching here the header pill updated but
      // the dashboard body kept showing the previous org's data indefinitely,
      // with no reload. Reusing the existing window CustomEvent idiom already
      // used elsewhere in this codebase (e.g. CodeEditorPane.jsx's
      // 'symbol-index-update', ElectronWorkspace.jsx's 'jarvis-os-nav') so any
      // listening component can re-fetch without prop drilling or new state.
      window.dispatchEvent(new CustomEvent("org-switched", { detail: { orgId } }));
    } catch (e) { setError(e.message || "Switch failed"); }
  }

  async function doCreate() {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const d = await _fetch("/orgs", { method: "POST", body: JSON.stringify({ name }) });
      if (d.ok === false) { setError(d.error || "Create failed"); setLoading(false); return; }
      setNewName("");
      setCreating(false);
      await load();
      // Newly created org becomes the natural next choice — switch to it.
      if (d.id) await doSwitch(d.id);
    } catch (e) { setError(e.message || "Create failed"); }
    setLoading(false);
  }

  // Nothing to show for an account with no org memberships and nothing
  // pending creation — avoids a permanently-empty control cluttering the
  // header for single-tenant/no-org installs.
  if (!orgs.length && !open) {
    return (
      <button
        className="org-switcher-trigger org-switcher-trigger--empty"
        onClick={() => setOpen(true)}
        title="Create your first organization"
      >
        <span className="org-switcher-icon">◈</span>
        <span className="org-switcher-name">New org</span>
      </button>
    );
  }

  return (
    <div className="org-switcher" ref={ref}>
      <button
        className="org-switcher-trigger"
        onClick={() => setOpen(o => !o)}
        title="Switch organization"
      >
        <span className="org-switcher-icon">◈</span>
        {/* Matching label added to WorkspaceSwitcher.jsx's trigger — see its
            comment for why: the two pills sit side by side and default to
            the same name, otherwise indistinguishable at a glance. */}
        <span className="org-switcher-kind">Org</span>
        <span className="org-switcher-name">{activeOrg?.orgName || "Organization"}</span>
        <span className="org-switcher-caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="org-switcher-dropdown">
          <div className="org-switcher-header">Organizations</div>

          {orgs.map(o => (
            <button
              key={o.orgId}
              className={`org-switcher-item${o.orgId === activeId ? " org-switcher-item--active" : ""}`}
              onClick={() => doSwitch(o.orgId)}
            >
              <span className="org-item-avatar">{o.orgName.slice(0, 2).toUpperCase()}</span>
              <span className="org-item-meta">
                <span className="org-item-name">{o.orgName}</span>
                <span className="org-item-role" style={{ color: ROLE_COLOR[o.orgRole] || "var(--text-faint)" }}>
                  {o.orgRole.replace("_", " ")}
                </span>
              </span>
              {o.orgId === activeId && <span className="org-item-check">✓</span>}
            </button>
          ))}

          <div className="org-switcher-divider" />

          {error && <div className="org-switcher-error">{error}</div>}

          {creating ? (
            <div className="org-create-form">
              <input
                autoFocus
                className="org-create-input"
                placeholder="Organization name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <div className="org-create-actions">
                <button className="org-create-btn org-create-btn--cancel" onClick={() => setCreating(false)}>Cancel</button>
                <button className="org-create-btn org-create-btn--confirm" onClick={doCreate} disabled={loading || !newName.trim()}>
                  {loading ? "…" : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <button className="org-switcher-create" onClick={() => setCreating(true)}>
              <span>＋</span> New organization
            </button>
          )}

          {onNavigate && activeId && (
            <button className="org-switcher-manage" onClick={() => { setOpen(false); onNavigate("orgadmin"); }}>
              Manage organization →
            </button>
          )}

          <div className="org-switcher-divider" />

          {/* Founder Experience Certification finding: AuthContext.jsx has
              a real, fully-working logout() — but before this fix, zero
              components in the entire frontend called it. The only
              existing call site was a "Sign out" button buried inside a
              session-expiry warning banner that only renders in the last
              5 minutes of an 8-hour session. A founder had no way to log
              out of their own account through the UI. This dropdown
              (already showing account-level context — org name, role) is
              the most standard, discoverable place for this control,
              matching where most SaaS products put it. */}
          <button className="org-switcher-manage" onClick={() => { setOpen(false); logout(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
