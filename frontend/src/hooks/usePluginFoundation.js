// Phase 1021-1027: Plugin foundation + integration connector system + extension sandboxing +
// workflow extension APIs + ecosystem governance + third-party security hardening +
// ecosystem observability.
//
// Consolidates seven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 10 plugins, 10 connectors, 30 ecosystem events, 20 trust snapshots, 30d retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const PLUGIN_KEY  = "jarvis_plugins";
const CONN_KEY    = "jarvis_connectors";
const ECO_KEY     = "jarvis_ecosystem_events";
const ETRUST_KEY  = "jarvis_ecosystem_trust";
const PLUGIN_MAX  = 10;
const CONN_MAX    = 10;
const ECO_MAX     = 30;
const ETRUST_MAX  = 20;
const PLUGIN_TTL  = 30 * 24 * 60 * 60 * 1000;
const ECO_TTL     = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1021: Plugin registration ──────────────────────────────────────────

const PLUGIN_TYPES = new Set(["workflow_extension", "diagnostics_adapter", "deploy_hook", "replay_observer"]);

function _validatePluginManifest(manifest) {
  const issues = [];
  if (!manifest?.id)      issues.push("Plugin missing id");
  if (!manifest?.type)    issues.push("Plugin missing type");
  if (!PLUGIN_TYPES.has(manifest?.type)) issues.push(`Unknown plugin type: ${manifest?.type}`);
  if (!manifest?.version) issues.push("Plugin missing version");
  // Security: no executable code references allowed in manifest
  if (manifest?.exec || manifest?.run || manifest?.eval) issues.push("Plugin manifest must not reference executable code");
  return { valid: issues.length === 0, issues };
}

function _buildPluginRecord(manifest, approved = false) {
  return {
    id:          manifest.id.slice(0, 30),
    type:        manifest.type,
    version:     String(manifest.version).slice(0, 20),
    label:       (manifest.label || manifest.id).slice(0, 40),
    approved,
    trustScore:  approved ? 80 : 40,
    status:      "registered",   // registered | active | suspended
    registeredAt: Date.now(),
    lastActiveAt: null,
    replayCompatible: manifest.replayCompatible !== false,
    isolated:    true,
  };
}

// ── Phase 1022: Integration connector system ──────────────────────────────────

const CONNECTOR_TYPES = new Set(["deploy_tool", "diagnostics_sink", "workflow_adapter", "monitoring"]);

const CONNECTOR_LIMITS = {
  maxChainDepth:     1,    // connectors cannot chain to other connectors
  requireApproval:   true,
  blockRecursive:    true,
  rateLimit:         20,   // actions/min per connector
};

function _validateConnector(spec) {
  const issues = [];
  if (!spec?.id)    issues.push("Connector missing id");
  if (!spec?.type)  issues.push("Connector missing type");
  if (!CONNECTOR_TYPES.has(spec?.type)) issues.push(`Unknown connector type: ${spec?.type}`);
  if (spec?.recursive || spec?.chain)   issues.push("Connectors cannot be recursive or chained");
  return { valid: issues.length === 0, issues };
}

function _buildConnectorRecord(spec) {
  return {
    id:           spec.id.slice(0, 30),
    type:         spec.type,
    label:        (spec.label || spec.id).slice(0, 40),
    approved:     false,
    status:       "pending",   // pending | active | suspended
    registeredAt: Date.now(),
    callCount:    0,
    lastCallAt:   null,
  };
}

// ── Phase 1023: Extension sandboxing ─────────────────────────────────────────

function _checkSandboxViolation(pluginId, action) {
  const violations = [];
  // Forbidden actions for plugin scope
  const FORBIDDEN = ["spawn_workflow", "modify_governance", "access_cross_plugin", "modify_audit"];
  if (FORBIDDEN.includes(action)) {
    violations.push(`Plugin '${pluginId}' cannot perform action '${action}'`);
  }
  return { safe: violations.length === 0, violations };
}

// ── Phase 1024: Workflow extension APIs ───────────────────────────────────────

const API_SCOPE = {
  workflow_extension: ["read_workflow_hist", "suggest_next_step", "read_friction_signals"],
  diagnostics_adapter:["read_diagnostics", "export_summary"],
  deploy_hook:        ["read_deploy_state", "validate_deployment"],
  replay_observer:    ["read_health_snapshot", "read_session_continuity"],
};

function _resolveExtensionScope(pluginType) {
  return new Set(API_SCOPE[pluginType] || []);
}

function _checkExtensionApiAccess(plugin, apiEndpoint) {
  if (!plugin?.approved) return { allowed: false, reason: "Plugin not approved" };
  const scope = _resolveExtensionScope(plugin.type);
  const allowed = scope.has(apiEndpoint);
  return {
    allowed,
    reason: allowed ? null : `API '${apiEndpoint}' not in scope for plugin type '${plugin.type}'`,
  };
}

// ── Phase 1025: Ecosystem governance ─────────────────────────────────────────

function _scorePluginTrust(plugin, recentEcoEvents) {
  const now = Date.now();
  let score = plugin.approved ? 80 : 40;

  const pluginEvents = recentEcoEvents.filter(e => e.pluginId === plugin.id);
  const violations   = pluginEvents.filter(e => e.type === "sandbox_violation").length;
  const apiAbuse     = pluginEvents.filter(e => e.type === "api_scope_violation").length;
  const healthy      = pluginEvents.filter(e => e.type === "api_call_ok").length;

  score -= violations * 20;
  score -= apiAbuse   * 15;
  score += Math.min(healthy * 2, 10);  // cap healthy bonus
  score  = Math.max(0, Math.min(100, score));

  return {
    ...plugin,
    trustScore: score,
    trustLabel: score >= 80 ? "TRUSTED" : score >= 55 ? "GUARDED" : "SUSPENDED",
    trustColor: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
  };
}

// ── Phase 1026: Third-party security hardening ────────────────────────────────

function _hardEnConnectorAuth(connector, recentCalls) {
  const violations = [];
  if (!connector.approved) violations.push("Connector not approved for execution");

  const now     = Date.now();
  const winCalls = (recentCalls || []).filter(c =>
    c.connectorId === connector.id && now - (c.ts || 0) < 60000
  ).length;
  if (winCalls >= CONNECTOR_LIMITS.rateLimit) {
    violations.push(`Connector rate limit: ${winCalls}/${CONNECTOR_LIMITS.rateLimit}/min`);
  }

  return { allowed: violations.length === 0, violations };
}

// ── Phase 1027: Ecosystem observability ──────────────────────────────────────

const ECO_EVENT_TYPES = new Set([
  "plugin_registered", "plugin_approved", "plugin_suspended",
  "connector_registered", "connector_activated", "connector_suspended",
  "api_call_ok", "api_scope_violation", "sandbox_violation",
  "replay_compat_check", "ecosystem_health_snap",
]);

function _buildEcoHealthSnapshot(plugins, connectors, ecoEvents) {
  const now     = Date.now();
  const win     = ECO_TTL;
  const recent  = ecoEvents.filter(e => now - (e.ts || 0) < win);

  const activePlugins     = plugins.filter(p => p.status === "active").length;
  const approvedPlugins   = plugins.filter(p => p.approved).length;
  const activeConnectors  = connectors.filter(c => c.status === "active").length;
  const violations        = recent.filter(e =>
    e.type === "sandbox_violation" || e.type === "api_scope_violation"
  ).length;

  let score = 100;
  if (violations > 0)      score -= Math.min(violations * 15, 40);
  if (approvedPlugins === 0 && plugins.length > 0) score -= 10;
  score = Math.max(0, score);

  return {
    ts: now,
    score,
    label: score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    activePlugins,
    approvedPlugins,
    activeConnectors,
    violations,
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePluginFoundation() {
  const [plugins,     setPlugins]     = useState([]);
  const [connectors,  setConnectors]  = useState([]);
  const [ecoEvents,   setEcoEvents]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const now = Date.now();
    setPlugins(_load(PLUGIN_KEY, []).filter(p => now - (p.registeredAt || 0) < PLUGIN_TTL));
    setConnectors(_load(CONN_KEY, []));
    setEcoEvents(_load(ECO_KEY, []).filter(e => now - (e.ts || 0) < ECO_TTL));
    setInitialized(true);
  }, []);

  // Record an ecosystem event
  const recordEcoEvent = useCallback((eventType, meta = {}) => {
    if (!ECO_EVENT_TYPES.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now(), ...meta };
    setEcoEvents(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < ECO_TTL).slice(0, ECO_MAX);
      _save(ECO_KEY, next);
      return next;
    });
  }, []);

  // Register a plugin
  const registerPlugin = useCallback((manifest) => {
    const validation = _validatePluginManifest(manifest);
    if (!validation.valid) return { ok: false, issues: validation.issues };

    if (plugins.length >= PLUGIN_MAX) {
      return { ok: false, issues: [`Plugin limit reached (${PLUGIN_MAX})`] };
    }
    if (plugins.find(p => p.id === manifest.id)) {
      return { ok: false, issues: ["Plugin ID already registered"] };
    }

    const plugin = _buildPluginRecord(manifest, false);
    setPlugins(prev => {
      const next = [plugin, ...prev].slice(0, PLUGIN_MAX);
      _save(PLUGIN_KEY, next);
      return next;
    });
    recordEcoEvent("plugin_registered", { pluginId: plugin.id });
    return { ok: true, plugin };
  }, [plugins, recordEcoEvent]);

  // Approve a plugin
  const approvePlugin = useCallback((pluginId) => {
    setPlugins(prev => {
      const next = prev.map(p =>
        p.id === pluginId ? { ...p, approved: true, status: "active", trustScore: 80 } : p
      );
      _save(PLUGIN_KEY, next);
      return next;
    });
    recordEcoEvent("plugin_approved", { pluginId });
  }, [recordEcoEvent]);

  // Suspend a plugin
  const suspendPlugin = useCallback((pluginId) => {
    setPlugins(prev => {
      const next = prev.map(p =>
        p.id === pluginId ? { ...p, status: "suspended", trustScore: 0 } : p
      );
      _save(PLUGIN_KEY, next);
      return next;
    });
    recordEcoEvent("plugin_suspended", { pluginId });
  }, [recordEcoEvent]);

  // Register a connector
  const registerConnector = useCallback((spec) => {
    const validation = _validateConnector(spec);
    if (!validation.valid) return { ok: false, issues: validation.issues };

    if (connectors.length >= CONN_MAX) {
      return { ok: false, issues: [`Connector limit reached (${CONN_MAX})`] };
    }

    const conn = _buildConnectorRecord(spec);
    setConnectors(prev => {
      const next = [conn, ...prev].slice(0, CONN_MAX);
      _save(CONN_KEY, next);
      return next;
    });
    recordEcoEvent("connector_registered", { connectorId: conn.id });
    return { ok: true, connector: conn };
  }, [connectors, recordEcoEvent]);

  // Check extension API access (Phase 1024)
  const checkExtensionApi = useCallback((pluginId, apiEndpoint) => {
    const plugin = plugins.find(p => p.id === pluginId);
    if (!plugin) return { allowed: false, reason: "Plugin not found" };
    const result = _checkExtensionApiAccess(plugin, apiEndpoint);
    if (!result.allowed) recordEcoEvent("api_scope_violation", { pluginId, apiEndpoint });
    else recordEcoEvent("api_call_ok", { pluginId, apiEndpoint });
    return result;
  }, [plugins, recordEcoEvent]);

  // Check sandbox safety (Phase 1023)
  const checkSandbox = useCallback((pluginId, action) => {
    const result = _checkSandboxViolation(pluginId, action);
    if (!result.safe) recordEcoEvent("sandbox_violation", { pluginId, action });
    return result;
  }, [recordEcoEvent]);

  // Validate connector auth (Phase 1026)
  const validateConnector = useCallback((connectorId, recentCalls = []) => {
    const connector = connectors.find(c => c.id === connectorId);
    if (!connector) return { allowed: false, violations: ["Connector not registered"] };
    return _hardEnConnectorAuth(connector, recentCalls);
  }, [connectors]);

  // Derived: plugins with trust scores (Phase 1025)
  const scoredPlugins = useMemo(() =>
    plugins.map(p => _scorePluginTrust(p, ecoEvents)),
    [plugins, ecoEvents]
  );

  // Ecosystem health snapshot (Phase 1027)
  const ecoHealth = useMemo(() =>
    _buildEcoHealthSnapshot(plugins, connectors, ecoEvents),
    [plugins, connectors, ecoEvents]
  );

  // Ecosystem trust score (aggregate)
  const ecoTrustScore = useMemo(() => {
    if (scoredPlugins.length === 0) return 100;
    const avg = Math.round(scoredPlugins.reduce((a, p) => a + p.trustScore, 0) / scoredPlugins.length);
    return avg;
  }, [scoredPlugins]);

  // Operator bar status pill (Phase 1031 UX)
  const ecoStatusPill = useMemo(() => {
    if (ecoHealth.violations > 0) {
      return { label: "ECOSYSTEM", msg: `${ecoHealth.violations} violation(s)`, color: "var(--op-red)" };
    }
    if (plugins.length > 0 && ecoHealth.approvedPlugins < plugins.length) {
      const pending = plugins.length - ecoHealth.approvedPlugins;
      return { label: "PLUGINS", msg: `${pending} pending approval`, color: "var(--op-amber)" };
    }
    return null;
  }, [ecoHealth, plugins]);

  return {
    initialized,
    plugins: scoredPlugins,
    connectors,
    ecoEvents,
    ecoHealth,
    ecoTrustScore,
    ecoStatusPill,
    connectorLimits: CONNECTOR_LIMITS,
    // Actions
    registerPlugin,
    approvePlugin,
    suspendPlugin,
    registerConnector,
    checkExtensionApi,
    checkSandbox,
    validateConnector,
    recordEcoEvent,
  };
}
