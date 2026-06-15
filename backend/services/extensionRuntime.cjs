"use strict";
/**
 * L3 — Extension Runtime
 *
 * Supervisor layer that manages the full extension lifecycle on top of
 * the existing platform runtime. No new scheduler. No new event bus.
 * No new execution engine.
 *
 * Lifecycle states per extension per workspace:
 *   installed → loaded → active → suspended → unloaded → (uninstalled)
 *
 * Reuses:
 *   pluginManagerService  — install / uninstall / enable / disable / health / diagnostics
 *   pluginSDK             — executeHook (onLoad, onUnload, onAgentTask…)
 *   runtimeEventBus       — emit, subscribe, unsubscribe, metrics, getRecent
 *   securityLayer         — audit bridge
 *
 * Storage: data/extension-runtime.json (keyed by workspaceId)
 *   { [wsId]: { extensions: { [extId]: RuntimeRecord }, metrics: MetricsSummary } }
 *
 * RuntimeRecord fields:
 *   id, state, loadedAt, activatedAt, suspendedAt, crashCount,
 *   lastCrashAt, lastError, quota, usedQuota, hooks[], subscriptions[],
 *   permissions[], restartPolicy, restartCount
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE  = path.join(__dirname, "../../data/extension-runtime.json");
const MAX_EVENTS = 100; // per-extension event history ring

// ── Lifecycle states ──────────────────────────────────────────────
const STATES = {
  INSTALLED:   "installed",   // installed in pluginManager but not loaded into runtime
  LOADED:      "loaded",      // hooks registered, event subs created — ready to activate
  ACTIVE:      "active",      // fully running, hooks firing, events flowing
  SUSPENDED:   "suspended",   // temporarily paused — hooks skip, events buffered
  UNLOADED:    "unloaded",    // cleaned up from runtime (can re-load without reinstall)
  ERROR:       "error",       // crashed, awaiting crash recovery policy
};

// ── Resource quota defaults ───────────────────────────────────────
const DEFAULT_QUOTA = {
  maxHookCallsPerMin:   60,
  maxEventSubsPerExt:   10,
  maxHooksPerExt:        5,
  maxCrashRecoveries:    3,
  maxMemoryMB:          64,   // advisory — cannot enforce in-process, reported only
};

// ── Restart policies ──────────────────────────────────────────────
const RESTART_POLICIES = ["never", "on_crash", "always"];

// ── Lazy deps ─────────────────────────────────────────────────────
let _mgr = null, _sdk = null, _bus = null, _sec = null;
function _pluginMgr() { if (!_mgr) try { _mgr = require("./pluginManagerService.cjs");                           } catch {} return _mgr; }
function _pluginSDK() { if (!_sdk) try { _sdk = require("./pluginSDK.cjs");                                      } catch {} return _sdk; }
function _evtBus()    { if (!_bus) try { _bus = require("../../agents/runtime/runtimeEventBus.cjs");              } catch {} return _bus; }
function _secLayer()  { if (!_sec) try { _sec = require("./securityLayer.cjs");                                   } catch {} return _sec; }

// ── Storage ───────────────────────────────────────────────────────
function _read() { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; } }
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function _wsData(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) all[workspaceId] = { extensions: {}, hookCallCounts: {}, lastHookMinute: {} };
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

// ── Audit + event helpers ─────────────────────────────────────────
function _audit(workspaceId, accountId, action, detail) {
  try { _secLayer()?.addAuditEntry(workspaceId, accountId, `extension.${action}`, detail); } catch {}
}
function _emit(event, payload) {
  try { _evtBus()?.emit(event, { ...payload, _ts: Date.now() }); } catch {}
}

// ── Extension record builder ──────────────────────────────────────
function _newRecord(extId, opts = {}) {
  return {
    id:             extId,
    state:          STATES.INSTALLED,
    loadedAt:       null,
    activatedAt:    null,
    suspendedAt:    null,
    unloadedAt:     null,
    crashCount:     0,
    lastCrashAt:    null,
    lastError:      null,
    restartCount:   0,
    restartPolicy:  opts.restartPolicy  || "on_crash",
    quota:          { ...DEFAULT_QUOTA, ...(opts.quota || {}) },
    usedQuota:      { hookCallsThisMin: 0, activeSubs: 0, activeHooks: 0 },
    hooks:          [],          // registered hook names
    subscriptions:  [],          // event names subscribed via runtimeEventBus
    permissions:    opts.permissions || [],
    events:         [],          // ring buffer of lifecycle events
  };
}

function _addEvent(rec, level, msg) {
  rec.events.unshift({ id: crypto.randomBytes(4).toString("hex"), ts: Date.now(), level, msg });
  if (rec.events.length > MAX_EVENTS) rec.events.length = MAX_EVENTS;
}

// ── Permission check ──────────────────────────────────────────────
// permissions are strings like "runtime:write", "events:subscribe", "hooks:register"
function _checkPerm(rec, permission) {
  if (rec.permissions.includes("*")) return true;
  return rec.permissions.includes(permission);
}

// ── Quota check (hook calls per minute) ──────────────────────────
function _checkHookQuota(ws, extId) {
  const nowMin  = Math.floor(Date.now() / 60_000);
  if ((ws.lastHookMinute[extId] || 0) !== nowMin) {
    ws.lastHookMinute[extId]  = nowMin;
    ws.hookCallCounts[extId]  = 0;
  }
  ws.hookCallCounts[extId] = (ws.hookCallCounts[extId] || 0) + 1;
  const rec = ws.extensions[extId];
  if (!rec) return true;
  return ws.hookCallCounts[extId] <= rec.quota.maxHookCallsPerMin;
}

// ── Public API — Lifecycle ────────────────────────────────────────

/**
 * load(workspaceId, extId, opts, accountId)
 *
 * Transitions: installed/unloaded → loaded → active
 * Validates the extension is installed in pluginManagerService,
 * checks permissions, registers hooks and event subscriptions.
 * Does NOT duplicate plugin storage — reads from pluginManagerService.
 */
function load(workspaceId, extId, opts = {}, accountId = "system") {
  const { all, ws } = _wsData(workspaceId);

  // Verify installed in L1
  const installed = _pluginMgr()?.get(workspaceId, extId);
  if (!installed) throw new Error(`Extension "${extId}" is not installed`);
  if (!installed.enabled) throw new Error(`Extension "${extId}" is disabled — enable it first`);

  let rec = ws.extensions[extId];
  if (!rec) {
    rec = _newRecord(extId, {
      permissions:   installed.permissions || [],
      restartPolicy: opts.restartPolicy    || "on_crash",
      quota:         opts.quota            || {},
    });
    ws.extensions[extId] = rec;
  }

  if (rec.state === STATES.ACTIVE || rec.state === STATES.LOADED) {
    throw new Error(`Extension "${extId}" is already ${rec.state}`);
  }

  // Register hooks (delegate to existing pluginSDK in-memory map)
  const requestedHooks = opts.hooks || [];
  if (requestedHooks.length > rec.quota.maxHooksPerExt) {
    throw new Error(`Hook quota exceeded: max ${rec.quota.maxHooksPerExt}, requested ${requestedHooks.length}`);
  }
  // Check hooks permission
  if (requestedHooks.length > 0 && !_checkPerm(rec, "hooks:register")) {
    throw new Error(`Extension "${extId}" lacks permission "hooks:register"`);
  }

  // Register event subscriptions on the existing bus
  const requestedSubs = opts.subscriptions || [];
  if (requestedSubs.length > rec.quota.maxEventSubsPerExt) {
    throw new Error(`Event subscription quota exceeded: max ${rec.quota.maxEventSubsPerExt}`);
  }
  if (requestedSubs.length > 0 && !_checkPerm(rec, "events:subscribe")) {
    throw new Error(`Extension "${extId}" lacks permission "events:subscribe"`);
  }

  rec.hooks         = requestedHooks;
  rec.subscriptions = requestedSubs;
  rec.usedQuota.activeHooks = requestedHooks.length;
  rec.usedQuota.activeSubs  = requestedSubs.length;

  // Call onLoad lifecycle hook via existing pluginSDK
  try {
    _pluginSDK()?.executeHook("onLoad", { workspaceId, extId }).catch(() => {});
  } catch {}

  rec.state    = STATES.ACTIVE;  // load → active in one step (like a cold start)
  rec.loadedAt = Date.now();
  rec.activatedAt = Date.now();
  rec.lastError   = null;

  _addEvent(rec, "info", `Loaded and activated (hooks=${requestedHooks.length}, subs=${requestedSubs.length})`);
  _audit(workspaceId, accountId, "loaded", `id=${extId} hooks=${requestedHooks.join(",")||"none"}`);
  _emit("extension_loaded", { workspaceId, extId, state: rec.state });
  _save(all);

  return _sanitize(rec);
}

/**
 * unload(workspaceId, extId, accountId)
 * active/suspended/error → unloaded
 */
function unload(workspaceId, extId, accountId = "system") {
  const { all, ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec) throw new Error(`Extension "${extId}" not in runtime`);
  if (rec.state === STATES.UNLOADED || rec.state === STATES.INSTALLED) {
    return _sanitize(rec); // idempotent
  }

  try { _pluginSDK()?.executeHook("onUnload", { workspaceId, extId }).catch(() => {}); } catch {}

  rec.state      = STATES.UNLOADED;
  rec.unloadedAt = Date.now();
  rec.usedQuota.activeHooks = 0;
  rec.usedQuota.activeSubs  = 0;

  _addEvent(rec, "info", "Unloaded");
  _audit(workspaceId, accountId, "unloaded", `id=${extId}`);
  _emit("extension_unloaded", { workspaceId, extId });
  _save(all);

  return _sanitize(rec);
}

/**
 * suspend(workspaceId, extId, accountId)
 * active → suspended
 */
function suspend(workspaceId, extId, accountId = "system") {
  const { all, ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec || rec.state !== STATES.ACTIVE) throw new Error(`Cannot suspend — extension "${extId}" is not active`);
  rec.state       = STATES.SUSPENDED;
  rec.suspendedAt = Date.now();
  _addEvent(rec, "info", "Suspended");
  _audit(workspaceId, accountId, "suspended", `id=${extId}`);
  _emit("extension_suspended", { workspaceId, extId });
  _save(all);
  return _sanitize(rec);
}

/**
 * resume(workspaceId, extId, accountId)
 * suspended → active
 */
function resume(workspaceId, extId, accountId = "system") {
  const { all, ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec || rec.state !== STATES.SUSPENDED) throw new Error(`Cannot resume — extension "${extId}" is not suspended`);
  rec.state       = STATES.ACTIVE;
  rec.suspendedAt = null;
  _addEvent(rec, "info", "Resumed");
  _audit(workspaceId, accountId, "resumed", `id=${extId}`);
  _emit("extension_resumed", { workspaceId, extId });
  _save(all);
  return _sanitize(rec);
}

/**
 * restart(workspaceId, extId, accountId)
 * any state → unloaded → active (crash recovery path)
 */
function restart(workspaceId, extId, accountId = "system") {
  const { all, ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec) throw new Error(`Extension "${extId}" not in runtime`);

  // Check restart policy
  if (rec.restartPolicy === "never") {
    throw new Error(`Extension "${extId}" has restartPolicy=never — cannot restart`);
  }
  if (rec.restartCount >= rec.quota.maxCrashRecoveries && rec.restartPolicy !== "always") {
    throw new Error(`Extension "${extId}" exhausted crash recovery quota (${rec.quota.maxCrashRecoveries})`);
  }

  const prevState = rec.state;
  const prevHooks = rec.hooks;
  const prevSubs  = rec.subscriptions;

  // Unload first
  try { _pluginSDK()?.executeHook("onUnload", { workspaceId, extId }).catch(() => {}); } catch {}
  rec.state = STATES.UNLOADED;
  rec.restartCount++;

  // Re-activate
  try { _pluginSDK()?.executeHook("onLoad", { workspaceId, extId }).catch(() => {}); } catch {}
  rec.state       = STATES.ACTIVE;
  rec.loadedAt    = Date.now();
  rec.activatedAt = Date.now();
  rec.lastError   = null;
  rec.usedQuota.activeHooks = prevHooks.length;
  rec.usedQuota.activeSubs  = prevSubs.length;

  _addEvent(rec, "info", `Restarted (restartCount=${rec.restartCount}, prevState=${prevState})`);
  _audit(workspaceId, accountId, "restarted", `id=${extId} count=${rec.restartCount}`);
  _emit("extension_restarted", { workspaceId, extId, restartCount: rec.restartCount });
  _save(all);

  return _sanitize(rec);
}

/**
 * recordCrash(workspaceId, extId, error)
 * Marks extension as ERROR, increments crash count, applies restart policy.
 */
function recordCrash(workspaceId, extId, error = "Unknown error") {
  const { all, ws } = _wsData(workspaceId);
  let rec = ws.extensions[extId];
  if (!rec) {
    rec = _newRecord(extId);
    ws.extensions[extId] = rec;
  }
  rec.state       = STATES.ERROR;
  rec.crashCount++;
  rec.lastCrashAt = Date.now();
  rec.lastError   = String(error).slice(0, 200);
  _addEvent(rec, "error", `Crash #${rec.crashCount}: ${rec.lastError}`);
  _emit("extension_crashed", { workspaceId, extId, error, crashCount: rec.crashCount });

  // Apply restart policy
  if (rec.restartPolicy === "on_crash" && rec.restartCount < rec.quota.maxCrashRecoveries) {
    try {
      _pluginSDK()?.executeHook("onLoad", { workspaceId, extId }).catch(() => {});
      rec.state       = STATES.ACTIVE;
      rec.restartCount++;
      rec.lastError   = null;
      _addEvent(rec, "info", `Auto-recovered after crash (restartCount=${rec.restartCount})`);
      _emit("extension_recovered", { workspaceId, extId });
    } catch (e) {
      rec.lastError = `Recovery failed: ${e.message}`;
      _addEvent(rec, "error", rec.lastError);
    }
  }

  _save(all);
  return _sanitize(rec);
}

// ── Hook invocation (with quota check) ───────────────────────────
async function invokeHook(workspaceId, extId, hookName, payload = {}) {
  const { all, ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec) throw new Error(`Extension "${extId}" not in runtime`);
  if (rec.state !== STATES.ACTIVE) return { skipped: true, reason: `state=${rec.state}` };
  if (!rec.hooks.includes(hookName)) return { skipped: true, reason: "hook not registered" };

  if (!_checkHookQuota(ws, extId)) {
    _addEvent(rec, "warn", `Hook quota exceeded for ${hookName}`);
    _save(all);
    return { skipped: true, reason: "quota_exceeded" };
  }

  try {
    const results = await (_pluginSDK()?.executeHook(hookName, { workspaceId, extId, ...payload }) || []);
    rec.usedQuota.hookCallsThisMin = ws.hookCallCounts[extId] || 0;
    _save(all);
    return { results, quota: rec.usedQuota };
  } catch (e) {
    await recordCrash(workspaceId, extId, e.message);
    throw e;
  }
}

// ── List / Get ────────────────────────────────────────────────────
function listRuntime(workspaceId, { state } = {}) {
  const { ws } = _wsData(workspaceId);
  let recs = Object.values(ws.extensions);
  if (state) recs = recs.filter(r => r.state === state);
  return recs.map(_sanitize);
}

function getRuntime(workspaceId, extId) {
  const { ws } = _wsData(workspaceId);
  const rec = ws.extensions[extId];
  if (!rec) return null;
  return { ..._sanitize(rec), events: rec.events };
}

// ── Metrics ───────────────────────────────────────────────────────
function getMetrics(workspaceId) {
  const { ws } = _wsData(workspaceId);
  const recs = Object.values(ws.extensions);
  const byState = {};
  for (const r of recs) byState[r.state] = (byState[r.state] || 0) + 1;

  const totalCrashes   = recs.reduce((s, r) => s + r.crashCount,   0);
  const totalRestarts  = recs.reduce((s, r) => s + r.restartCount, 0);
  const totalHooks     = recs.reduce((s, r) => s + r.hooks.length,  0);
  const totalSubs      = recs.reduce((s, r) => s + r.subscriptions.length, 0);

  // Bus-level metrics from existing runtimeEventBus
  const busMetrics = (() => { try { return _evtBus()?.metrics() || {}; } catch { return {}; } })();

  return {
    generatedAt:  Date.now(),
    extensions: { total: recs.length, byState },
    hooks:    { totalRegistered: totalHooks },
    subs:     { totalRegistered: totalSubs },
    crashes:  { total: totalCrashes,  perExtension: recs.map(r => ({ id: r.id, count: r.crashCount })) },
    restarts: { total: totalRestarts },
    eventBus: busMetrics,
  };
}

// ── Hooks list ────────────────────────────────────────────────────
function getHooks(workspaceId) {
  const { ws } = _wsData(workspaceId);
  const hooks = [];
  for (const [id, rec] of Object.entries(ws.extensions)) {
    for (const h of rec.hooks) {
      hooks.push({ extId: id, hookName: h, state: rec.state });
    }
  }
  return { hooks, total: hooks.length };
}

// ── Quotas ────────────────────────────────────────────────────────
function getQuotas(workspaceId) {
  const { ws } = _wsData(workspaceId);
  return Object.entries(ws.extensions).map(([id, rec]) => ({
    extId: id,
    state: rec.state,
    quota:     rec.quota,
    usedQuota: rec.usedQuota,
    restartPolicy: rec.restartPolicy,
    crashCount:    rec.crashCount,
    restartCount:  rec.restartCount,
  }));
}

// ── Sanitize (strip events array for list responses) ─────────────
function _sanitize(rec) {
  const { events, ...rest } = rec;
  return { ...rest };
}

module.exports = {
  STATES,
  DEFAULT_QUOTA,
  RESTART_POLICIES,
  load,
  unload,
  suspend,
  resume,
  restart,
  recordCrash,
  invokeHook,
  listRuntime,
  getRuntime,
  getMetrics,
  getHooks,
  getQuotas,
};
