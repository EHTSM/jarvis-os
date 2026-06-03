// Phase 1156-1165: Workflow marketplace foundation + plugin publishing +
// template distribution governance + marketplace trust system +
// ecosystem moderation + safe extension delivery + marketplace analytics +
// multi-tenant isolation + performance hardening + stress validation.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Privacy-safe: counts/scores/metadata only.
// Bounded: 30 workflows, 20 plugins, 20 templates, 50 analytics, 15 moderation, 15 isolation events.

import { useState, useEffect, useCallback, useMemo } from "react";

const MKT_KEY     = "jarvis_marketplace_workflows";
const PLUG_KEY    = "jarvis_marketplace_plugins";
const TMPL_KEY    = "jarvis_marketplace_templates";
const MANAL_KEY   = "jarvis_marketplace_analytics";
const MOD_KEY     = "jarvis_marketplace_moderation";
const MISO_KEY    = "jarvis_marketplace_isolation";
const TRUST_KEY   = "jarvis_marketplace_trust";

const MKT_MAX     = 30;
const PLUG_MAX    = 20;
const TMPL_MAX    = 20;
const MANAL_MAX   = 50;
const MOD_MAX     = 15;
const MISO_MAX    = 15;

const MKT_TTL     = 30 * 24 * 60 * 60 * 1000;
const PLUG_TTL    = 30 * 24 * 60 * 60 * 1000;
const TMPL_TTL    = 30 * 24 * 60 * 60 * 1000;
const MANAL_TTL   = 30 * 24 * 60 * 60 * 1000;
const MOD_TTL     = 7  * 24 * 60 * 60 * 1000;
const MISO_TTL    = 24 * 60 * 60 * 1000;

// ── Phase 1156: Workflow marketplace foundation ───────────────────────────────

const WORKFLOW_CATEGORIES = new Set([
  "debugging", "deployment", "replay", "monitoring", "automation",
  "testing", "analytics", "productivity",
]);

function _buildMarketplaceWorkflow({ name, category, version = "1.0.0", stepCount = 0 }) {
  if (!WORKFLOW_CATEGORIES.has(category)) return null;
  return {
    id:         `mwf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    category,
    version,
    stepCount:  Math.min(stepCount, 20), // bounded
    status:     "pending_review",        // pending_review → approved | rejected
    trustScore: null,
    imports:    0,
    ts:         Date.now(),
    updatedAt:  Date.now(),
  };
}

// ── Phase 1157: Plugin publishing ────────────────────────────────────────────

const PLUGIN_TYPES_ALLOWED = new Set(["debug", "deploy", "monitor", "productivity"]);

const PLUGIN_SAFETY_CHECKS = [
  (manifest) => !manifest.entryPoint?.includes("eval"),
  (manifest) => !manifest.entryPoint?.includes("exec"),
  (manifest) => !manifest.permissions?.includes("network_unrestricted"),
  (manifest) => typeof manifest.sandboxed === "undefined" || manifest.sandboxed === true,
];

function _validatePluginManifest(manifest = {}) {
  const failures = PLUGIN_SAFETY_CHECKS
    .map((check, i) => ({ id: `check_${i}`, passed: check(manifest) }))
    .filter(c => !c.passed);
  return { valid: failures.length === 0, failures };
}

function _buildMarketplacePlugin({ name, type, version = "1.0.0", manifest = {} }) {
  if (!PLUGIN_TYPES_ALLOWED.has(type)) return null;
  const validation = _validatePluginManifest(manifest);
  return {
    id:         `mplugin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    type,
    version,
    status:     validation.valid ? "pending_review" : "rejected",
    rejectReason: validation.valid ? null : "Safety check failed",
    trustScore: null,
    installs:   0,
    ts:         Date.now(),
    updatedAt:  Date.now(),
  };
}

// ── Phase 1158: Template distribution governance ──────────────────────────────

const TEMPLATE_TYPES = new Set(["deployment", "debugging", "replay_recovery", "monitoring_setup", "onboarding"]);

function _buildMarketplaceTemplate({ name, type, stepCount = 0, replayRequired = false }) {
  if (!TEMPLATE_TYPES.has(type)) return null;
  return {
    id:           `mtmpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    type,
    stepCount:    Math.min(stepCount, 15),
    replayRequired,
    status:       "pending_review",
    trustScore:   null,
    uses:         0,
    ts:           Date.now(),
    updatedAt:    Date.now(),
  };
}

// ── Phase 1159: Marketplace trust system ─────────────────────────────────────

const TRUST_DIMENSIONS = ["reliability", "survivability", "safety", "usability", "adoption"];

function _computeItemTrust({ successRate = 100, importCount = 0, safetyPassed = true, reviewScore = null } = {}) {
  let score = 60; // baseline for newly published items
  score += Math.min(20, Math.round(successRate * 0.2));
  score += Math.min(10, Math.floor(importCount / 5));
  if (!safetyPassed) score -= 30;
  if (reviewScore !== null) score += Math.round(reviewScore * 0.1);
  return Math.max(0, Math.min(100, score));
}

function _buildTrustSnapshot({ workflows = [], plugins = [], templates = [] } = {}) {
  const approved = [
    ...workflows.filter(w => w.status === "approved"),
    ...plugins.filter(p => p.status === "approved"),
    ...templates.filter(t => t.status === "approved"),
  ];
  const withTrust = approved.filter(i => i.trustScore !== null);
  const avgTrust = withTrust.length > 0
    ? Math.round(withTrust.reduce((s, i) => s + i.trustScore, 0) / withTrust.length)
    : 100;

  return {
    ts:           Date.now(),
    avgTrust,
    approvedCount: approved.length,
    label:        avgTrust >= 80 ? "TRUSTED" : avgTrust >= 60 ? "DEVELOPING" : "LOW TRUST",
    color:        avgTrust >= 80 ? "var(--op-green)" : avgTrust >= 60 ? "var(--op-amber)" : "var(--op-red)",
  };
}

// ── Phase 1160: Ecosystem moderation ─────────────────────────────────────────

const MOD_ACTIONS = new Set(["approve", "reject", "flag", "suspend"]);

function _buildModerationRecord({ itemId, itemType, action, reason = "" }) {
  if (!MOD_ACTIONS.has(action)) return null;
  return {
    id:       `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemId,
    itemType, // "workflow" | "plugin" | "template"
    action,
    reason:   reason.slice(0, 200), // bounded reason
    ts:       Date.now(),
  };
}

// ── Phase 1161: Safe extension delivery ──────────────────────────────────────

const INSTALL_LIMITS = {
  maxConcurrentInstalls: 3,
  replayGuardMins:       5,  // replay must be < 5 min old during install
  rollbackWindowDays:    7,
};

function _validateInstallSafety(plugin, replayAgeMs = null) {
  const issues = [];
  if (plugin.status !== "approved") {
    issues.push({ id: "not_approved", msg: "Plugin not yet approved for distribution" });
  }
  if (replayAgeMs !== null && replayAgeMs > INSTALL_LIMITS.replayGuardMins * 60 * 1000) {
    issues.push({ id: "stale_replay", msg: `Replay ${Math.round(replayAgeMs / 60000)}m old — refresh before install` });
  }
  return { safe: issues.length === 0, issues };
}

// ── Phase 1162: Marketplace analytics — privacy-safe ─────────────────────────

const MARKETPLACE_ANALYTICS_TYPES = new Set([
  "workflow_imported", "plugin_installed", "template_used",
  "item_approved", "item_rejected", "trust_improved",
  "marketplace_searched", "install_failed",
]);

function _buildMarketplaceAnalytic(type, meta = {}) {
  if (!MARKETPLACE_ANALYTICS_TYPES.has(type)) return null;
  return {
    id:   `manal_${Date.now()}`,
    type,
    ts:   Date.now(),
    ...(typeof meta.category    === "string"  ? { category:    meta.category    } : {}),
    ...(typeof meta.itemType    === "string"  ? { itemType:    meta.itemType    } : {}),
    ...(typeof meta.trustScore  === "number"  ? { trustScore:  meta.trustScore  } : {}),
    ...(typeof meta.success     === "boolean" ? { success:     meta.success     } : {}),
  };
}

// ── Phase 1163: Multi-tenant marketplace isolation ────────────────────────────

const MARKETPLACE_ISOLATED_PREFIXES = [
  "jarvis_marketplace_workflows_",
  "jarvis_marketplace_plugins_",
  "jarvis_marketplace_templates_",
];

function _scanMarketplaceIsolation(activeWsId) {
  if (!activeWsId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (MARKETPLACE_ISOLATED_PREFIXES.some(p => key.startsWith(p)) && !key.endsWith(activeWsId)) {
        violations.push({ key, reason: "Cross-tenant marketplace state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1164: Performance hardening ────────────────────────────────────────

const _marketplaceCache = new Map();
const MKT_CACHE_TTL = 60 * 1000; // 1 min

function _cachedMarketplace(key, compute) {
  const cached = _marketplaceCache.get(key);
  if (cached && Date.now() - cached.ts < MKT_CACHE_TTL) return cached.val;
  const val = compute();
  if (_marketplaceCache.size > 20) {
    const oldest = [..._marketplaceCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _marketplaceCache.delete(oldest[0]);
  }
  _marketplaceCache.set(key, { val, ts: Date.now() });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEcosystemMarketplace({
  replayAgeMs = null,
} = {}) {
  const [workflows,    setWorkflows]    = useState([]);
  const [plugins,      setPlugins]      = useState([]);
  const [templates,    setTemplates]    = useState([]);
  const [analytics,    setAnalytics]    = useState([]);
  const [moderation,   setModeration]   = useState([]);
  const [isoEvents,    setIsoEvents]    = useState([]);
  const [initialized,  setInitialized]  = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();
    setWorkflows(prev => { const next = prev.filter(w => now - (w.ts || 0) < MKT_TTL).slice(0, MKT_MAX);  _save(MKT_KEY,   next); return next; });
    setPlugins(  prev => { const next = prev.filter(p => now - (p.ts || 0) < PLUG_TTL).slice(0, PLUG_MAX); _save(PLUG_KEY,  next); return next; });
    setTemplates(prev => { const next = prev.filter(t => now - (t.ts || 0) < TMPL_TTL).slice(0, TMPL_MAX); _save(TMPL_KEY,  next); return next; });
    setAnalytics(prev => { const next = prev.filter(a => now - (a.ts || 0) < MANAL_TTL).slice(0, MANAL_MAX);_save(MANAL_KEY, next); return next; });
    setModeration(prev => { const next = prev.filter(m => now - (m.ts || 0) < MOD_TTL).slice(0, MOD_MAX);  _save(MOD_KEY,   next); return next; });

    const violations = _scanMarketplaceIsolation(activeWsId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev].filter(e => now - (e.ts || 0) < MISO_TTL).slice(0, MISO_MAX);
        _save(MISO_KEY, next);
        return next;
      });
    }
  }, [activeWsId]);

  useEffect(() => {
    const now = Date.now();
    setWorkflows( _load(MKT_KEY,   []).filter(w => now - (w.ts || 0) < MKT_TTL));
    setPlugins(   _load(PLUG_KEY,  []).filter(p => now - (p.ts || 0) < PLUG_TTL));
    setTemplates( _load(TMPL_KEY,  []).filter(t => now - (t.ts || 0) < TMPL_TTL));
    setAnalytics( _load(MANAL_KEY, []).filter(a => now - (a.ts || 0) < MANAL_TTL));
    setModeration(_load(MOD_KEY,   []).filter(m => now - (m.ts || 0) < MOD_TTL));
    setIsoEvents( _load(MISO_KEY,  []).filter(e => now - (e.ts || 0) < MISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Publish actions ───────────────────────────────────────────────────────

  const publishWorkflow = useCallback(({ name, category, version, stepCount } = {}) => {
    const wf = _buildMarketplaceWorkflow({ name, category, version, stepCount });
    if (!wf) return null;
    setWorkflows(prev => {
      const next = [wf, ...prev].slice(0, MKT_MAX);
      _save(MKT_KEY, next);
      return next;
    });
    return wf.id;
  }, []);

  const publishPlugin = useCallback(({ name, type, version, manifest } = {}) => {
    const plugin = _buildMarketplacePlugin({ name, type, version, manifest });
    if (!plugin) return null;
    setPlugins(prev => {
      const next = [plugin, ...prev].slice(0, PLUG_MAX);
      _save(PLUG_KEY, next);
      return next;
    });
    return plugin.id;
  }, []);

  const publishTemplate = useCallback(({ name, type, stepCount, replayRequired } = {}) => {
    const tmpl = _buildMarketplaceTemplate({ name, type, stepCount, replayRequired });
    if (!tmpl) return null;
    setTemplates(prev => {
      const next = [tmpl, ...prev].slice(0, TMPL_MAX);
      _save(TMPL_KEY, next);
      return next;
    });
    return tmpl.id;
  }, []);

  // ── Moderation actions (Phase 1160) ───────────────────────────────────────

  const moderateItem = useCallback((itemId, itemType, action, reason = "") => {
    const record = _buildModerationRecord({ itemId, itemType, action, reason });
    if (!record) return;

    // Apply moderation to the relevant collection
    const applyMod = (prev, setter, saveKey) => {
      const next = prev.map(item => {
        if (item.id !== itemId) return item;
        const newStatus = action === "approve" ? "approved"
          : action === "reject"  ? "rejected"
          : action === "suspend" ? "suspended"
          : item.status;
        const trustScore = action === "approve" ? _computeItemTrust({ successRate: 100, safetyPassed: true }) : item.trustScore;
        return { ...item, status: newStatus, trustScore, updatedAt: Date.now() };
      });
      _save(saveKey, next);
      setter(next);
    };

    if (itemType === "workflow") setWorkflows(prev => { applyMod(prev, setWorkflows, MKT_KEY); return prev; });
    if (itemType === "plugin")   setPlugins(  prev => { applyMod(prev, setPlugins,   PLUG_KEY); return prev; });
    if (itemType === "template") setTemplates(prev => { applyMod(prev, setTemplates, TMPL_KEY); return prev; });

    setModeration(prev => {
      const next = [record, ...prev].slice(0, MOD_MAX);
      _save(MOD_KEY, next);
      return next;
    });

    // Record analytics
    const evt = _buildMarketplaceAnalytic("item_approved", { itemType, success: action === "approve" });
    if (evt) {
      setAnalytics(prev => {
        const next = [evt, ...prev].filter(a => Date.now() - (a.ts || 0) < MANAL_TTL).slice(0, MANAL_MAX);
        _save(MANAL_KEY, next);
        return next;
      });
    }
  }, []);

  // ── Install validation (Phase 1161) ───────────────────────────────────────

  const validateInstall = useCallback((pluginId) => {
    const plugin = plugins.find(p => p.id === pluginId);
    if (!plugin) return { safe: false, issues: [{ id: "not_found", msg: "Plugin not found" }] };
    return _validateInstallSafety(plugin, replayAgeMs);
  }, [plugins, replayAgeMs]);

  const recordInstall = useCallback((pluginId, success = true) => {
    setPlugins(prev => {
      const next = prev.map(p =>
        p.id === pluginId ? { ...p, installs: (p.installs || 0) + 1, updatedAt: Date.now() } : p
      );
      _save(PLUG_KEY, next);
      return next;
    });
    const evt = _buildMarketplaceAnalytic(success ? "plugin_installed" : "install_failed", { itemType: "plugin", success });
    if (evt) {
      setAnalytics(prev => {
        const next = [evt, ...prev].filter(a => Date.now() - (a.ts || 0) < MANAL_TTL).slice(0, MANAL_MAX);
        _save(MANAL_KEY, next);
        return next;
      });
    }
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const approvedWorkflows = useMemo(() => workflows.filter(w => w.status === "approved"), [workflows]);
  const approvedPlugins   = useMemo(() => plugins.filter(p => p.status === "approved"),   [plugins]);
  const approvedTemplates = useMemo(() => templates.filter(t => t.status === "approved"), [templates]);
  const pendingReview     = useMemo(() => [
    ...workflows.filter(w => w.status === "pending_review").map(w => ({ ...w, itemType: "workflow" })),
    ...plugins.filter(p => p.status === "pending_review").map(p => ({ ...p, itemType: "plugin" })),
    ...templates.filter(t => t.status === "pending_review").map(t => ({ ...t, itemType: "template" })),
  ], [workflows, plugins, templates]);

  // Trust snapshot — coarse dep key to avoid burst re-renders
  const _approvedBucket = Math.floor((approvedWorkflows.length + approvedPlugins.length + approvedTemplates.length) / 3);
  const trustSnapshot = useMemo(() =>
    _cachedMarketplace(`trust_${_approvedBucket}`,
      () => _buildTrustSnapshot({ workflows, plugins, templates })
    ),
    [_approvedBucket, workflows, plugins, templates]
  );

  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return isoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [isoEvents]);

  // Calm marketplace bar — Phase 1166: shown only when actionable
  const marketplaceBar = useMemo(() => {
    const hasReview = pendingReview.length > 0;
    const hasTrustIssue = trustSnapshot && trustSnapshot.avgTrust < 70;
    const hasIso = recentIsoViolations > 0;
    if (!hasReview && !hasTrustIssue && !hasIso) return null;
    return {
      pendingCount:  pendingReview.length,
      trustLabel:    hasTrustIssue ? trustSnapshot.label : null,
      trustColor:    trustSnapshot?.color || "var(--op-text2)",
      isoViolations: hasIso ? recentIsoViolations : null,
      approvedTotal: approvedWorkflows.length + approvedPlugins.length + approvedTemplates.length,
    };
  }, [pendingReview.length, trustSnapshot, recentIsoViolations, approvedWorkflows.length, approvedPlugins.length, approvedTemplates.length]);

  return {
    initialized,
    workflows,
    plugins,
    templates,
    analytics,
    moderation,
    isoEvents,
    // Derived
    approvedWorkflows,
    approvedPlugins,
    approvedTemplates,
    pendingReview,
    trustSnapshot,
    marketplaceBar,
    // Actions
    publishWorkflow,
    publishPlugin,
    publishTemplate,
    moderateItem,
    validateInstall,
    recordInstall,
    evaluate,
  };
}
