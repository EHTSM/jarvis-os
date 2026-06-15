import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import { HEALTH_COLOR_SH, DIAG_COLOR_SH } from "./WorkspaceSettingsL3";

// ── L1 Plugin Manager Panels ─────────────────────────────────────
const HEALTH_COLOR = HEALTH_COLOR_SH;
const DIAG_COLOR   = DIAG_COLOR_SH;

function PluginsPanel() {
  const [plugins,   setPlugins]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState({ id: "", name: "", version: "1.0.0", description: "", author: "", capabilities: "", category: "general" });
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState(null);

  const reload = () => {
    setLoading(true);
    _fetch("/plugins").then(r => setPlugins(r.plugins || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const handleInstall = async () => {
    setSaving(true); setErr(null);
    try {
      const manifest = {
        id:           form.id.trim(),
        name:         form.name.trim(),
        version:      form.version.trim(),
        description:  form.description.trim(),
        author:       form.author.trim(),
        capabilities: form.capabilities.split(",").map(s => s.trim()).filter(Boolean),
        category:     form.category,
      };
      await _fetch("/plugins/install", { method: "POST", body: JSON.stringify(manifest) });
      setShowForm(false);
      setForm({ id: "", name: "", version: "1.0.0", description: "", author: "", capabilities: "", category: "general" });
      reload();
    } catch (e) { setErr(e.message || "Install failed"); }
    finally { setSaving(false); }
  };

  const toggle = async (p) => {
    const endpoint = p.enabled ? "/plugins/disable" : "/plugins/enable";
    await _fetch(endpoint, { method: "POST", body: JSON.stringify({ pluginId: p.id }) }).catch(() => {});
    reload();
  };

  const uninstall = async (pluginId) => {
    if (!window.confirm(`Uninstall plugin "${pluginId}"?`)) return;
    await _fetch("/plugins/uninstall", { method: "POST", body: JSON.stringify({ pluginId }) }).catch(() => {});
    reload();
  };

  if (loading) return <div className="k2-loading">Loading plugins…</div>;

  return (
    <div className="l1-panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="k2-form-btn" onClick={() => setShowForm(f => !f)}>{showForm ? "Cancel" : "+ Install Plugin"}</button>
        <button className="k2-form-btn" style={{ background: "none", color: "var(--text-dim)" }} onClick={reload}>↺ Refresh</button>
      </div>

      {showForm && (
        <div className="l1-install-form">
          <div className="k5-form-section-label">Plugin Manifest V2</div>
          {err && <div className="l1-err">{err}</div>}
          {[
            ["Plugin ID",    "id",          "my-plugin"],
            ["Name",         "name",        "My Plugin"],
            ["Version",      "version",     "1.0.0"],
            ["Description",  "description", "What this plugin does"],
            ["Author",       "author",      "Your Name"],
            ["Capabilities", "capabilities","capability_a, capability_b"],
          ].map(([label, key, placeholder]) => (
            <div key={key} className="k2-form-row">
              <label className="k2-form-label">{label}</label>
              <input className="k2-form-input" value={form[key]} placeholder={placeholder}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="k2-form-row">
            <label className="k2-form-label">Category</label>
            <select className="k2-form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {["general","integration","automation","analytics","security","developer"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button className="k2-form-btn" disabled={saving} onClick={handleInstall}>{saving ? "Installing…" : "Install"}</button>
        </div>
      )}

      {plugins.length === 0 ? (
        <div className="k2-empty">No plugins installed. Install your first plugin above.</div>
      ) : (
        <div className="l1-plugin-list">
          {plugins.map(p => (
            <div key={p.id} className={`l1-plugin-row${p.enabled ? "" : " l1-plugin-row--off"}`}>
              <div className="l1-plugin-meta">
                <span className="l1-plugin-name">{p.name}</span>
                <span className="l1-plugin-id">#{p.id} · v{p.version}</span>
                <span className="l1-plugin-desc">{p.description}</span>
                {p.capabilities?.length > 0 && (
                  <div className="l1-caps">{p.capabilities.map(c => <span key={c} className="l1-cap-chip">{c}</span>)}</div>
                )}
              </div>
              <div className="l1-plugin-actions">
                <span className="l1-health-dot" style={{ background: HEALTH_COLOR[p.health?.status || "unknown"] }} title={p.health?.message || "unknown"} />
                <span className="k2-badge" style={{ background: p.enabled ? "rgba(82,214,138,0.1)" : "var(--surface)", color: p.enabled ? "#52d68a" : "var(--text-faint)" }}>{p.enabled ? "enabled" : "disabled"}</span>
                <button className="k5-toggle-btn" onClick={() => toggle(p)}>{p.enabled ? "Disable" : "Enable"}</button>
                <button className="k2-revoke-btn" onClick={() => uninstall(p.id)}>Uninstall</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PluginHealthPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking,setChecking]= useState(false);

  const reload = () => {
    setLoading(true);
    _fetch("/plugins/health").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const runCheck = async () => {
    setChecking(true);
    await _fetch("/plugins/health/check", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    setChecking(false);
    reload();
  };

  if (loading) return <div className="k2-loading">Loading health…</div>;
  if (!data)   return <div className="k2-empty">No health data.</div>;

  const { summary, plugins } = data;
  return (
    <div className="l1-panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="k2-form-btn" onClick={runCheck} disabled={checking}>{checking ? "Checking…" : "Run Health Check"}</button>
      </div>
      <div className="k6-stat-grid" style={{ marginBottom: 12 }}>
        {Object.entries(summary).map(([status, count]) => (
          <div key={status} className="k6-stat-card">
            <span className="k6-stat-val" style={{ color: HEALTH_COLOR[status] }}>{count}</span>
            <span className="k6-stat-label">{status}</span>
          </div>
        ))}
      </div>
      {plugins.length === 0 ? (
        <div className="k2-empty">No plugins installed.</div>
      ) : (
        <div className="l1-plugin-list">
          {plugins.map(p => (
            <div key={p.pluginId} className="l1-plugin-row">
              <div className="l1-plugin-meta">
                <span className="l1-plugin-name">{p.name} <span className="l1-plugin-id">v{p.version}</span></span>
                <span className="l1-plugin-desc">{p.message}</span>
              </div>
              <div className="l1-plugin-actions">
                <span className="l1-health-dot" style={{ background: HEALTH_COLOR[p.status] }} />
                <span className="k2-badge" style={{ color: HEALTH_COLOR[p.status] }}>{p.status}</span>
                {p.lastChecked && <span className="l1-ts">{new Date(p.lastChecked).toLocaleTimeString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PluginDiagPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("");

  useEffect(() => {
    setLoading(true);
    _fetch("/plugins/diagnostics").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading diagnostics…</div>;
  if (!data)   return <div className="k2-empty">No diagnostic data.</div>;

  const diagMap = data.diagnostics || {};
  const filtered = Object.entries(diagMap).filter(([id]) => !filter || id.includes(filter));

  return (
    <div className="l1-panel">
      <input className="k2-form-input" placeholder="Filter by plugin ID…" value={filter}
        onChange={e => setFilter(e.target.value)} style={{ marginBottom: 10 }} />
      {filtered.length === 0 ? (
        <div className="k2-empty">No events{filter ? " matching filter" : ""}.</div>
      ) : filtered.map(([pluginId, events]) => (
        <div key={pluginId} className="l1-diag-block">
          <div className="k5-form-section-label">{pluginId}</div>
          {events.length === 0 ? (
            <div className="k2-empty" style={{ fontSize: 11, padding: "4px 0" }}>No events</div>
          ) : events.map(ev => (
            <div key={ev.id} className="l1-diag-row">
              <span className="l1-diag-dot" style={{ background: DIAG_COLOR[ev.level] || "var(--text-faint)" }} />
              <span className="l1-diag-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
              <span className="l1-diag-msg">{ev.message}</span>
              <span className="l1-diag-lvl" style={{ color: DIAG_COLOR[ev.level] }}>{ev.level}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}


export { PluginsPanel, PluginHealthPanel, PluginDiagPanel };
