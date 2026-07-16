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

// Fallback icon when the catalog entry doesn't specify one (backend catalog
// entries don't carry an icon glyph field).
const DEFAULT_ICON = "◈";

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

const SUBMIT_FIELDS = ["id", "name", "version", "description", "author", "category"];
const SUBMIT_DEFAULTS = { id: "", name: "", version: "1.0.0", description: "", author: "", category: "integration", capabilities: "" };

export default function PluginMarketplace() {
  const [installed, setInstalled] = useState({});
  const [catalog,   setCatalog]   = useState([]);
  const [catalogErr,setCatalogErr]= useState(false);
  const [search,    setSearch]    = useState("");
  const [tab,       setTab]       = useState("marketplace"); // marketplace | installed | submit
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [health,    setHealth]    = useState(null);
  const [submitForm, setSubmitForm] = useState(SUBMIT_DEFAULTS);
  const [submitErrors, setSubmitErrors] = useState([]);
  const [submitOk,   setSubmitOk] = useState(false);

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

  const loadCatalog = useCallback(async () => {
    try {
      const r = await get("/marketplace/catalog");
      if (!Array.isArray(r.plugins)) throw new Error("bad catalog response");
      setCatalog(r.plugins);
      setCatalogErr(false);
    } catch { setCatalogErr(true); }
  }, []);

  useEffect(() => { loadInstalled(); loadCatalog(); }, [loadInstalled, loadCatalog]);

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

  const submitConnector = useCallback(async () => {
    setSubmitErrors([]); setSubmitOk(false);
    const manifest = {
      id: submitForm.id.trim(), name: submitForm.name.trim(), version: submitForm.version.trim(),
      description: submitForm.description.trim(), author: submitForm.author.trim(), category: submitForm.category,
      capabilities: submitForm.capabilities.split(",").map(c => c.trim()).filter(Boolean),
    };
    try {
      const res = await post("/marketplace/submit", manifest);
      if (res?.error) {
        setSubmitErrors(res.validationErrors || [res.error]);
      } else {
        setSubmitOk(true);
        setSubmitForm(SUBMIT_DEFAULTS);
      }
    } catch { setSubmitErrors(["Submit failed — check server connection"]); }
  }, [submitForm]);

  const query = search.toLowerCase();
  const filteredCatalog = catalog.filter(p =>
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
        {["marketplace", "installed", "submit"].map(t => (
          <button
            key={t}
            className={`pm-tab${tab === t ? " pm-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "marketplace" ? "Marketplace" : t === "installed" ? `Installed (${installedList.length})` : "Submit a Connector"}
          </button>
        ))}
      </div>

      {tab !== "submit" && (
        <input
          className="pm-search"
          placeholder="Search plugins…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}

      {tab === "marketplace" && catalogErr && (
        <div className="pm-empty">Marketplace catalog unavailable — check your connection and retry.</div>
      )}

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

      {tab === "submit" && (
        <div className="pm-list" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 4px" }}>
          <p style={{ fontSize: 13, opacity: 0.75, margin: 0 }}>
            Submit a connector manifest for review. An operator will approve or reject it before it appears in the marketplace.
          </p>
          {submitOk && <div className="pm-toast" style={{ position: "static" }}>Submitted — pending operator review.</div>}
          {submitErrors.length > 0 && (
            <div className="pm-empty" style={{ color: "var(--danger, #f55b5b)" }}>
              {submitErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          {SUBMIT_FIELDS.map(field => (
            <input
              key={field}
              className="pm-search"
              placeholder={field}
              value={submitForm[field]}
              onChange={e => setSubmitForm(prev => ({ ...prev, [field]: e.target.value }))}
            />
          ))}
          <input
            className="pm-search"
            placeholder="capabilities (comma-separated)"
            value={submitForm.capabilities}
            onChange={e => setSubmitForm(prev => ({ ...prev, capabilities: e.target.value }))}
          />
          <button className="pm-btn pm-btn--install" onClick={submitConnector}>
            Submit for review
          </button>
        </div>
      )}

      {toast && <div className="pm-toast">{toast}</div>}
    </div>
  );
}
