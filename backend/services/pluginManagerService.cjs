"use strict";
/**
 * L1 — Plugin Manager Service (Plugin SDK V2)
 *
 * Wraps the existing pluginSDK (registerPlugin, unregisterPlugin,
 * listPlugins, getPlugin, executeHook) and adds the V2 layer:
 *
 *   • Plugin Manifest v2 (dependencies, permissions, configSchema, minSDKVersion)
 *   • Plugin Lifecycle v2 (install / uninstall / enable / disable per workspace)
 *   • Version management (semver stored, upgrade detection)
 *   • Workspace-scoped enable/disable (no reload needed)
 *   • Plugin health (ok / degraded / error state + last-checked timestamp)
 *   • Diagnostics (last 50 events per plugin, ring buffer)
 *   • Capability permissions (allowedCapabilities whitelist per plugin)
 *   • Configuration schema + stored config per plugin per workspace
 *   • Plugin validation (manifest completeness check)
 *
 * Storage: data/plugin-manager.json (keyed by workspaceId)
 *   {
 *     [workspaceId]: {
 *       installed:  { [pluginId]: ManifestV2 },
 *       config:     { [pluginId]: Record<string,any> },
 *       enabled:    { [pluginId]: boolean },
 *       health:     { [pluginId]: HealthRecord },
 *       diagnostics:{ [pluginId]: DiagEvent[] },
 *     }
 *   }
 *
 * No new SDK. No new registry. No new event bus.
 * All capability registrations delegate to pluginSDK.registerCapability().
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE   = path.join(__dirname, "../../data/plugin-manager.json");
const MAX_DIAG    = 50;   // diagnostic events per plugin

// ── Lazy deps ─────────────────────────────────────────────────────
let _sdk = null, _sec = null, _bus = null;
function _pluginSDK() { if (!_sdk) try { _sdk = require("./pluginSDK.cjs");                                    } catch {} return _sdk; }
function _secLayer()  { if (!_sec) try { _sec = require("./securityLayer.cjs");                                } catch {} return _sec; }
function _evtBus()    { if (!_bus) try { _bus = require("../../agents/runtime/runtimeEventBus.cjs");           } catch {} return _bus; }

// ── Storage ───────────────────────────────────────────────────────
function _read() { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; } }
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function _wsData(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) {
    all[workspaceId] = { installed: {}, config: {}, enabled: {}, health: {}, diagnostics: {} };
    _write(all);
  }
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

// ── Audit bridge ──────────────────────────────────────────────────
function _audit(workspaceId, accountId, action, detail) {
  try { _secLayer()?.addAuditEntry(workspaceId, accountId, `plugin.${action}`, detail); } catch {}
}

// ── Event emit ────────────────────────────────────────────────────
function _emit(event, payload) {
  try { _evtBus()?.emit(event, { ...payload, _ts: Date.now() }); } catch {}
}

// ── Diagnostic ring buffer ────────────────────────────────────────
function _diag(ws, pluginId, level, message) {
  if (!ws.diagnostics[pluginId]) ws.diagnostics[pluginId] = [];
  ws.diagnostics[pluginId].unshift({ id: crypto.randomBytes(4).toString("hex"), ts: Date.now(), level, message });
  if (ws.diagnostics[pluginId].length > MAX_DIAG) ws.diagnostics[pluginId].length = MAX_DIAG;
}

// ── Manifest V2 validation ────────────────────────────────────────
const REQUIRED_FIELDS = ["id", "name", "version", "description", "author", "capabilities"];
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return { valid: false, errors: ["manifest must be an object"] };

  for (const f of REQUIRED_FIELDS) {
    if (!manifest[f] && manifest[f] !== 0) errors.push(`${f} is required`);
  }
  if (manifest.version && !SEMVER_RE.test(manifest.version)) {
    errors.push(`version "${manifest.version}" must be semver (e.g. 1.0.0)`);
  }
  if (manifest.minSDKVersion && !SEMVER_RE.test(manifest.minSDKVersion)) {
    errors.push(`minSDKVersion "${manifest.minSDKVersion}" must be semver`);
  }
  if (!Array.isArray(manifest.capabilities)) {
    errors.push("capabilities must be an array");
  }
  if (manifest.dependencies && !Array.isArray(manifest.dependencies)) {
    errors.push("dependencies must be an array if provided");
  }
  if (manifest.permissions && !Array.isArray(manifest.permissions)) {
    errors.push("permissions must be an array if provided");
  }
  if (manifest.configSchema && typeof manifest.configSchema !== "object") {
    errors.push("configSchema must be an object if provided");
  }
  return { valid: errors.length === 0, errors };
}

// ── Install ───────────────────────────────────────────────────────
/**
 * install(workspaceId, manifest, requestingAccountId)
 *
 * Validates Manifest V2, stores it workspace-scoped, registers
 * capabilities in the existing pluginSDK registry, sets enabled=true.
 */
function install(workspaceId, manifest, requestingAccountId) {
  const { valid, errors } = validateManifest(manifest);
  if (!valid) throw new Error(`Invalid plugin manifest: ${errors.join("; ")}`);

  const { all, ws } = _wsData(workspaceId);
  const pluginId = manifest.id;

  // Version upgrade detection
  const existing = ws.installed[pluginId];
  const upgrading = !!existing;
  if (existing && existing.version === manifest.version) {
    throw new Error(`Plugin "${pluginId}" v${manifest.version} is already installed`);
  }

  // Build V2 manifest record
  const record = {
    id:             pluginId,
    name:           manifest.name,
    version:        manifest.version,
    description:    manifest.description,
    author:         manifest.author,
    capabilities:   manifest.capabilities || [],
    permissions:    manifest.permissions  || [],
    dependencies:   manifest.dependencies || [],
    configSchema:   manifest.configSchema || {},
    minSDKVersion:  manifest.minSDKVersion || "1.0.0",
    category:       manifest.category     || "general",
    tags:           manifest.tags         || [],
    homepage:       manifest.homepage     || null,
    installedAt:    existing?.installedAt || Date.now(),
    updatedAt:      Date.now(),
    installedBy:    requestingAccountId,
    previousVersion: existing?.version    || null,
  };

  ws.installed[pluginId] = record;
  ws.enabled[pluginId]   = true;

  // Register capabilities in existing SDK registry
  const sdk = _pluginSDK();
  if (sdk) {
    for (const cap of record.capabilities) {
      try {
        sdk.registerCapability(`${pluginId}:${cap}`, {
          name:         cap,
          description:  `Capability "${cap}" from plugin "${pluginId}" v${manifest.version}`,
          providedBy:   pluginId,
          providerType: "plugin",
          category:     record.category,
        });
      } catch { /* capability may already exist */ }
    }
  }

  // Merge default config from schema
  if (!ws.config[pluginId]) ws.config[pluginId] = {};
  if (record.configSchema?.defaults) {
    ws.config[pluginId] = { ...record.configSchema.defaults, ...ws.config[pluginId] };
  }

  // Health: mark healthy on fresh install
  ws.health[pluginId] = { status: "ok", lastChecked: Date.now(), message: upgrading ? "Upgraded" : "Installed" };
  _diag(ws, pluginId, "info", upgrading ? `Upgraded from v${existing.version} to v${manifest.version}` : `Installed v${manifest.version}`);

  _audit(workspaceId, requestingAccountId, upgrading ? "upgraded" : "installed", `id=${pluginId} version=${manifest.version}`);
  _emit("plugin_installed", { workspaceId, pluginId, version: manifest.version, upgrading });
  _save(all);

  return { pluginId, installed: true, upgrading, version: manifest.version };
}

// ── Uninstall ─────────────────────────────────────────────────────
function uninstall(workspaceId, pluginId, requestingAccountId) {
  const { all, ws } = _wsData(workspaceId);
  if (!ws.installed[pluginId]) throw new Error(`Plugin "${pluginId}" is not installed`);

  const version = ws.installed[pluginId].version;
  delete ws.installed[pluginId];
  delete ws.enabled[pluginId];
  delete ws.health[pluginId];
  delete ws.config[pluginId];
  // Keep diagnostics for audit trail — truncate to last 10
  if (ws.diagnostics[pluginId]) ws.diagnostics[pluginId] = ws.diagnostics[pluginId].slice(0, 10);

  _audit(workspaceId, requestingAccountId, "uninstalled", `id=${pluginId} version=${version}`);
  _emit("plugin_uninstalled", { workspaceId, pluginId });
  _save(all);

  return { pluginId, uninstalled: true };
}

// ── Enable / Disable ──────────────────────────────────────────────
function enable(workspaceId, pluginId, requestingAccountId) {
  const { all, ws } = _wsData(workspaceId);
  if (!ws.installed[pluginId]) throw new Error(`Plugin "${pluginId}" is not installed`);
  if (ws.enabled[pluginId]) return { pluginId, enabled: true, changed: false };
  ws.enabled[pluginId] = true;
  _diag(ws, pluginId, "info", "Enabled");
  _audit(workspaceId, requestingAccountId, "enabled", `id=${pluginId}`);
  _emit("plugin_enabled", { workspaceId, pluginId });
  _save(all);
  return { pluginId, enabled: true, changed: true };
}

function disable(workspaceId, pluginId, requestingAccountId) {
  const { all, ws } = _wsData(workspaceId);
  if (!ws.installed[pluginId]) throw new Error(`Plugin "${pluginId}" is not installed`);
  if (!ws.enabled[pluginId]) return { pluginId, enabled: false, changed: false };
  ws.enabled[pluginId] = false;
  _diag(ws, pluginId, "info", "Disabled");
  _audit(workspaceId, requestingAccountId, "disabled", `id=${pluginId}`);
  _emit("plugin_disabled", { workspaceId, pluginId });
  _save(all);
  return { pluginId, enabled: false, changed: true };
}

// ── List / Get ────────────────────────────────────────────────────
function list(workspaceId, { category, enabled: filterEnabled, tag } = {}) {
  const { ws } = _wsData(workspaceId);
  let plugins = Object.values(ws.installed);
  if (category !== undefined) plugins = plugins.filter(p => p.category === category);
  if (filterEnabled !== undefined) plugins = plugins.filter(p => !!ws.enabled[p.id] === filterEnabled);
  if (tag) plugins = plugins.filter(p => p.tags?.includes(tag));
  return plugins.map(p => _enrich(p, ws));
}

function get(workspaceId, pluginId) {
  const { ws } = _wsData(workspaceId);
  const plugin = ws.installed[pluginId];
  if (!plugin) return null;
  return _enrich(plugin, ws);
}

function _enrich(plugin, ws) {
  return {
    ...plugin,
    enabled:     !!ws.enabled[plugin.id],
    health:      ws.health[plugin.id]   || { status: "unknown", lastChecked: null },
    config:      ws.config[plugin.id]   || {},
  };
}

// ── Health ────────────────────────────────────────────────────────
/**
 * checkHealth(workspaceId, pluginId?)
 * Runs a lightweight self-check on installed plugins.
 * For each: verify manifest still present, check enabled state,
 * validate config against schema if provided.
 */
function checkHealth(workspaceId, pluginId = null) {
  const { all, ws } = _wsData(workspaceId);
  const targets = pluginId ? [pluginId] : Object.keys(ws.installed);
  const results = [];

  for (const id of targets) {
    const plugin = ws.installed[id];
    if (!plugin) {
      results.push({ pluginId: id, status: "error", message: "Plugin record missing" });
      continue;
    }

    let status  = "ok";
    let message = "Healthy";

    // Config schema validation
    const schema = plugin.configSchema || {};
    const config = ws.config[id] || {};
    const configErrors = [];
    if (schema.required) {
      for (const field of schema.required) {
        if (config[field] === undefined || config[field] === null || config[field] === "") {
          configErrors.push(`missing required config: ${field}`);
        }
      }
    }
    if (configErrors.length > 0) {
      status  = "degraded";
      message = configErrors.join("; ");
    }

    // Disabled = degraded
    if (!ws.enabled[id]) {
      status  = "degraded";
      message = "Plugin is disabled";
    }

    ws.health[id] = { status, lastChecked: Date.now(), message };
    _diag(ws, id, status === "ok" ? "info" : "warn", `Health check: ${message}`);
    results.push({ pluginId: id, status, message });
  }

  _save(all);
  return results;
}

function getHealth(workspaceId) {
  const { ws } = _wsData(workspaceId);
  const summary = { ok: 0, degraded: 0, error: 0, unknown: 0 };
  const plugins  = [];

  for (const [id, plugin] of Object.entries(ws.installed)) {
    const h = ws.health[id] || { status: "unknown", lastChecked: null };
    summary[h.status] = (summary[h.status] || 0) + 1;
    plugins.push({ pluginId: id, name: plugin.name, version: plugin.version, enabled: !!ws.enabled[id], ...h });
  }

  return { summary, plugins, total: plugins.length };
}

// ── Diagnostics ───────────────────────────────────────────────────
function getDiagnostics(workspaceId, pluginId = null) {
  const { ws } = _wsData(workspaceId);
  if (pluginId) {
    return { pluginId, events: ws.diagnostics[pluginId] || [] };
  }
  const all = {};
  for (const id of Object.keys(ws.installed)) {
    all[id] = ws.diagnostics[id] || [];
  }
  return { diagnostics: all, total: Object.keys(all).length };
}

// ── Manifest ──────────────────────────────────────────────────────
function getManifest(workspaceId, pluginId) {
  const { ws } = _wsData(workspaceId);
  const plugin = ws.installed[pluginId];
  if (!plugin) throw new Error(`Plugin "${pluginId}" not installed`);
  return {
    ...plugin,
    enabled: !!ws.enabled[pluginId],
    health:  ws.health[pluginId]  || { status: "unknown" },
    config:  ws.config[pluginId]  || {},
  };
}

// ── Config ────────────────────────────────────────────────────────
function getConfig(workspaceId, pluginId) {
  const { ws } = _wsData(workspaceId);
  if (!ws.installed[pluginId]) throw new Error(`Plugin "${pluginId}" not installed`);
  return { pluginId, config: ws.config[pluginId] || {}, schema: ws.installed[pluginId].configSchema || {} };
}

function updateConfig(workspaceId, pluginId, patch, requestingAccountId) {
  const { all, ws } = _wsData(workspaceId);
  if (!ws.installed[pluginId]) throw new Error(`Plugin "${pluginId}" not installed`);
  ws.config[pluginId] = { ...(ws.config[pluginId] || {}), ...patch };
  _diag(ws, pluginId, "info", `Config updated: ${Object.keys(patch).join(", ")}`);
  _audit(workspaceId, requestingAccountId, "config_updated", `id=${pluginId}`);
  _save(all);
  return { pluginId, config: ws.config[pluginId] };
}

// ── Workspace statistics ───────────────────────────────────────────
function getStats(workspaceId) {
  const { ws } = _wsData(workspaceId);
  const plugins = Object.values(ws.installed);
  const enabled = Object.values(ws.enabled).filter(Boolean).length;
  const byCategory = {};
  for (const p of plugins) byCategory[p.category || "general"] = (byCategory[p.category || "general"] || 0) + 1;

  const allCaps = plugins.flatMap(p => (p.capabilities || []).map(c => `${p.id}:${c}`));

  return {
    total:       plugins.length,
    enabled,
    disabled:    plugins.length - enabled,
    byCategory,
    totalCapabilities: allCaps.length,
    health:      getHealth(workspaceId).summary,
  };
}

module.exports = {
  validateManifest,
  install,
  uninstall,
  enable,
  disable,
  list,
  get,
  checkHealth,
  getHealth,
  getDiagnostics,
  getManifest,
  getConfig,
  updateConfig,
  getStats,
};
