/**
 * PluginMarketplace — UI over existing /plugins/* backend routes (L1 Plugin SDK V2).
 * Install, enable, disable, update, remove. Plugin permissions display.
 * No new backend — reuses existing routes.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./PluginMarketplace.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return r.json();
}
async function post(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return r.json();
}

// Curated marketplace catalog (shown when no custom plugins installed yet)
const CATALOG = [
  { id: "eslint-runner",       name: "ESLint Runner",      category: "linting",    icon: "◈", description: "Run ESLint in the AI pipeline. Auto-fix on save.", version: "1.0.0" },
  { id: "prettier-format",     name: "Prettier Format",    category: "formatter",  icon: "⬡", description: "Auto-format code with Prettier on save.", version: "1.2.0" },
  { id: "git-smart",           name: "Git Smart",          category: "git",        icon: "⎇", description: "AI commit messages, branch suggestions, conflict resolution.", version: "2.1.0" },
  { id: "test-guardian",       name: "Test Guardian",      category: "testing",    icon: "✓", description: "Auto-generate and run tests after each patch.", version: "1.0.3" },
  { id: "deploy-bot",          name: "Deploy Bot",         category: "deployment", icon: "▲", description: "One-click deploy to Vercel, Netlify, Fly.io from the editor.", version: "0.9.1" },
  { id: "ai-docs",             name: "AI Docs",            category: "docs",       icon: "◎", description: "Auto-generate JSDoc, README, and API docs from code.", version: "1.1.0" },
  { id: "security-scanner",    name: "Security Scanner",   category: "security",   icon: "🔒", description: "Scan for OWASP Top 10 vulnerabilities in real time.", version: "1.0.0" },
  { id: "perf-profiler",       name: "Perf Profiler",      category: "performance",icon: "⚡", description: "Identify slow functions and suggest optimizations.", version: "0.8.0" },
];

const STATUS_COLORS = {
  enabled:  "var(--success, #52d68a)",
  disabled: "var(--text-faint)",
  error:    "var(--danger, #f55b5b)",
};

function PermissionBadge({ perm }) {
  return <span className="pm-perm">{perm}</span>;
}

function PluginCard({ plugin, installed, onInstall, onEnable, onDisable, onRemove, loading }) {
  const [expanded, setExpanded] = useState(false);
  const isInstalled = !!installed;
  const isEnabled   = installed?.enabled;

  return (
    <div className={`pm-card${isInstalled ? " pm-card--installed" : ""}`}>
      <div className="pm-card__top">
        <span className="pm-card__icon">{plugin.icon || "◈"}</span>
        <div className="pm-card__info">
          <div className="pm-card__name">{plugin.name || plugin.id}</div>
          <div className="pm-card__meta">
            <span className="pm-card__version">v{plugin.version || "1.0.0"}</span>
            <span className="pm-card__category">{plugin.category || plugin.tags?.[0] || ""}</span>
          </div>
        </div>
        <div className="pm-card__status-dot" style={{ background: isInstalled ? STATUS_COLORS[isEnabled ? "enabled" : "disabled"] : "var(--border)" }} />
      </div>

      <div className="pm-card__desc">{plugin.description}</div>

      {isInstalled && installed.permissions?.length > 0 && (
        <div className="pm-card__perms">
          {installed.permissions.map(p => <PermissionBadge key={p} perm={p} />)}
        </div>
      )}

      <div className="pm-card__actions">
        {!isInstalled && (
          <button className="pm-btn pm-btn--install" onClick={() => onInstall(plugin)} disabled={loading}>
            Install
          </button>
        )}
        {isInstalled && !isEnabled && (
          <button className="pm-btn pm-btn--enable" onClick={() => onEnable(plugin.id)} disabled={loading}>
            Enable
          </button>
        )}
        {isInstalled && isEnabled && (
          <button className="pm-btn pm-btn--disable" onClick={() => onDisable(plugin.id)} disabled={loading}>
            Disable
          </button>
        )}
        {isInstalled && (
          <button className="pm-btn pm-btn--remove" onClick={() => onRemove(plugin.id)} disabled={loading}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function PluginMarketplace() {
  const [installed, setInstalled] = useState({});
  const [search,    setSearch]    = useState("");
  const [tab,       setTab]       = useState("marketplace"); // marketplace | installed
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [health,    setHealth]    = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const loadInstalled = useCallback(async () => {
    try {
      const r = await get("/plugins");
      const map = {};
      for (const p of r.plugins || []) map[p.id] = p;
      setInstalled(map);
      const h = await get("/plugins/health");
      setHealth(h);
    } catch {}
  }, []);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const installPlugin = useCallback(async (plugin) => {
    setLoading(true);
    try {
      await post("/plugins/install", { pluginId: plugin.id, name: plugin.name, version: plugin.version, category: plugin.category });
      showToast(`${plugin.name} installed`);
      await loadInstalled();
    } catch (e) { showToast("Install failed"); }
    setLoading(false);
  }, [loadInstalled]);

  const enablePlugin = useCallback(async (id) => {
    setLoading(true);
    try { await post("/plugins/enable", { pluginId: id }); await loadInstalled(); showToast("Enabled"); }
    catch { showToast("Enable failed"); }
    setLoading(false);
  }, [loadInstalled]);

  const disablePlugin = useCallback(async (id) => {
    setLoading(true);
    try { await post("/plugins/disable", { pluginId: id }); await loadInstalled(); showToast("Disabled"); }
    catch { showToast("Disable failed"); }
    setLoading(false);
  }, [loadInstalled]);

  const removePlugin = useCallback(async (id) => {
    setLoading(true);
    try { await post("/plugins/uninstall", { pluginId: id }); await loadInstalled(); showToast("Removed"); }
    catch { showToast("Remove failed"); }
    setLoading(false);
  }, [loadInstalled]);

  const query = search.toLowerCase();
  const filteredCatalog = CATALOG.filter(p =>
    !query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
  );
  const installedList = Object.values(installed);

  return (
    <div className="pm-root">
      <div className="pm-header">
        <span className="pm-title">Plugin Marketplace</span>
        {health && (
          <span className="pm-health">
            {installedList.filter(p => p.enabled).length} active
          </span>
        )}
      </div>

      <div className="pm-tabs">
        {["marketplace", "installed"].map(t => (
          <button
            key={t}
            className={`pm-tab${tab === t ? " pm-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "marketplace" ? "Marketplace" : `Installed (${installedList.length})`}
          </button>
        ))}
      </div>

      <input
        className="pm-search"
        placeholder="Search plugins…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="pm-list">
        {tab === "marketplace" && filteredCatalog.map(p => (
          <PluginCard
            key={p.id}
            plugin={p}
            installed={installed[p.id]}
            onInstall={installPlugin}
            onEnable={enablePlugin}
            onDisable={disablePlugin}
            onRemove={removePlugin}
            loading={loading}
          />
        ))}
        {tab === "installed" && (
          installedList.length === 0
            ? <div className="pm-empty">No plugins installed yet.</div>
            : installedList.map(p => (
              <PluginCard
                key={p.id}
                plugin={p}
                installed={p}
                onInstall={installPlugin}
                onEnable={enablePlugin}
                onDisable={disablePlugin}
                onRemove={removePlugin}
                loading={loading}
              />
            ))
        )}
      </div>

      {toast && <div className="pm-toast">{toast}</div>}
    </div>
  );
}
