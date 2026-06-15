import React, { useState, useEffect, useRef, useCallback } from "react";
import { _fetch } from "../_client";

const ROLE_COLOR = {
  Owner:     "var(--warning)",
  Admin:     "var(--accent)",
  Operator:  "#52d68a",
  Developer: "var(--accent2)",
  Viewer:    "var(--text-faint)",
};

export default function WorkspaceSwitcher({ onNavigate }) {
  const [open, setOpen]         = useState(false);
  const [workspaces, setWs]     = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await _fetch("/workspace");
      setWs(d.workspaces || []);
      setActiveId(d.activeWorkspaceId || null);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeWs = workspaces.find(w => w.id === activeId);

  async function doSwitch(id) {
    if (id === activeId) { setOpen(false); return; }
    try {
      await _fetch("/workspace/switch", { method: "POST", body: JSON.stringify({ workspaceId: id }) });
      setActiveId(id);
      setOpen(false);
    } catch {}
  }

  async function doCreate() {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const d = await _fetch("/workspace", { method: "POST", body: JSON.stringify({ name }) });
      setWs(prev => [...prev, d.workspace]);
      setNewName("");
      setCreating(false);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        className="ws-switcher-trigger"
        onClick={() => setOpen(o => !o)}
        title="Switch workspace"
      >
        <span className="ws-switcher-icon">⬡</span>
        <span className="ws-switcher-name">{activeWs?.name || "Workspace"}</span>
        <span className="ws-switcher-caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="ws-switcher-dropdown">
          <div className="ws-switcher-header">Workspaces</div>

          {workspaces.map(ws => (
            <button
              key={ws.id}
              className={`ws-switcher-item${ws.id === activeId ? " ws-switcher-item--active" : ""}`}
              onClick={() => doSwitch(ws.id)}
            >
              <span className="ws-item-avatar">{ws.name.slice(0, 2).toUpperCase()}</span>
              <span className="ws-item-meta">
                <span className="ws-item-name">{ws.name}</span>
                <span className="ws-item-count">{ws.members?.length || 0} member{ws.members?.length !== 1 ? "s" : ""}</span>
              </span>
              {ws.id === activeId && <span className="ws-item-check">✓</span>}
            </button>
          ))}

          <div className="ws-switcher-divider" />

          {creating ? (
            <div className="ws-create-form">
              <input
                autoFocus
                className="ws-create-input"
                placeholder="Workspace name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <div className="ws-create-actions">
                <button className="ws-create-btn ws-create-btn--cancel" onClick={() => setCreating(false)}>Cancel</button>
                <button className="ws-create-btn ws-create-btn--confirm" onClick={doCreate} disabled={loading || !newName.trim()}>
                  {loading ? "…" : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <button className="ws-switcher-create" onClick={() => setCreating(true)}>
              <span>＋</span> New workspace
            </button>
          )}

          {onNavigate && (
            <button className="ws-switcher-manage" onClick={() => { setOpen(false); onNavigate("team"); }}>
              Manage workspaces →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
