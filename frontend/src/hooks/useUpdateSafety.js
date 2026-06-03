// Phase 192: Auto-update survivability.
// Detects interrupted updates, validates post-update state, supports rollback.
// All state is localStorage-based — no external calls.

const UPDATE_KEY      = "jarvis_update_state";
const SNAPSHOT_KEY    = "jarvis_pre_update_snapshot";
const BUILD_KEY       = "jarvis_build_id";

// Keys that must be preserved across updates
const CRITICAL_KEYS = [
  "jarvis_workflow_macros",
  "jarvis_workflow_hist",
  "jarvis_operator_workspace",
  "jarvis_sequential_workflows",
  "jarvis_productivity_analytics",
];

// Phase 192: record current build ID (set by build pipeline or heuristic)
function _getCurrentBuildId() {
  // Use hardcoded closed-beta identifier — build pipeline can inject via meta tag
  const meta = document.querySelector('meta[name="jarvis-build-id"]');
  return meta?.content || "v3.0-2026-05-24";
}

// Phase 192: snapshot critical state before an update begins
export function snapshotPreUpdateState() {
  try {
    const snap = {};
    for (const k of CRITICAL_KEYS) {
      const v = localStorage.getItem(k);
      if (v) snap[k] = v;
    }
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ snap, ts: Date.now(), buildId: _getCurrentBuildId() }));
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ status: "updating", ts: Date.now() }));
  } catch {}
}

// Phase 192: mark update as complete, clear update-in-progress state
export function markUpdateComplete() {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ status: "ok", ts: Date.now(), buildId: _getCurrentBuildId() }));
    localStorage.setItem(BUILD_KEY, _getCurrentBuildId());
  } catch {}
}

// Phase 192: detect interrupted update — update started but never completed
export function detectInterruptedUpdate() {
  try {
    const raw = localStorage.getItem(UPDATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state.status === "updating" && Date.now() - state.ts > 2 * 60 * 1000) {
      return { interrupted: true, since: state.ts };
    }
    return null;
  } catch { return null; }
}

// Phase 192: rollback — restore critical keys from pre-update snapshot
export function rollbackToPreUpdateSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return { ok: false, reason: "No snapshot available" };
    const { snap, ts, buildId } = JSON.parse(raw);
    let restored = 0;
    for (const [k, v] of Object.entries(snap)) {
      localStorage.setItem(k, v);
      restored++;
    }
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ status: "rolled_back", ts: Date.now(), fromBuild: buildId, snapshotTs: ts }));
    return { ok: true, restored, snapshotTs: ts };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// Phase 192: validate post-update integrity — all critical keys still parseable
export function validatePostUpdateIntegrity() {
  const results = {};
  let allOk = true;
  for (const k of CRITICAL_KEYS) {
    const v = localStorage.getItem(k);
    if (!v) { results[k] = "missing"; continue; }
    try { JSON.parse(v); results[k] = "ok"; }
    catch { results[k] = "corrupted"; allOk = false; }
  }
  return { allOk, results };
}

// Phase 223: update channel classification — reads channel from meta or localStorage
const CHANNEL_KEY = "jarvis_update_channel";
export function getUpdateChannel() {
  try {
    const meta = document.querySelector('meta[name="jarvis-channel"]');
    if (meta?.content) return meta.content; // "stable" | "beta" | "canary"
    return localStorage.getItem(CHANNEL_KEY) || "beta";
  } catch { return "beta"; }
}

// Phase 223: quarantine a corrupted update — marks it as quarantined and triggers rollback
export function quarantineCorruptedUpdate(reason) {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({
      status: "quarantined", ts: Date.now(), reason,
      buildId: localStorage.getItem(BUILD_KEY) || "unknown"
    }));
  } catch {}
}

// Phase 223: check if current build is quarantined
export function isUpdateQuarantined() {
  try {
    const raw = localStorage.getItem(UPDATE_KEY);
    if (!raw) return false;
    return JSON.parse(raw).status === "quarantined";
  } catch { return false; }
}

// Phase 192: React hook — check update state on mount, expose rollback
import { useState, useEffect, useCallback, useMemo } from "react";
export function useUpdateSafety() {
  const [updateState, setUpdateState] = useState(null);

  useEffect(() => {
    const interrupted  = detectInterruptedUpdate();
    const integrity    = validatePostUpdateIntegrity();
    const buildId      = _getCurrentBuildId();
    const lastBuild    = localStorage.getItem(BUILD_KEY);
    const isNewBuild   = lastBuild && lastBuild !== buildId;
    const quarantined  = isUpdateQuarantined(); // Phase 223
    const channel      = getUpdateChannel();    // Phase 223

    const state = { interrupted, integrity, buildId, isNewBuild, quarantined, channel };
    setUpdateState(state);

    // Phase 223: auto-quarantine if integrity fails on new build
    if (isNewBuild && !integrity.allOk) {
      quarantineCorruptedUpdate("post-update integrity check failed");
    } else if (isNewBuild && !interrupted) {
      markUpdateComplete();
    }
  }, []);

  const doRollback = useCallback(() => {
    const result = rollbackToPreUpdateSnapshot();
    setUpdateState(s => ({ ...s, rollback: result }));
    return result;
  }, []);

  return { updateState, doRollback };
}

// ── Phase 889: Migration compatibility + replay safety ────────────────────────

const MIGRATION_LOG_KEY = "jarvis_migration_log";
const MIG_MAX_889       = 20;
const REPLAY_STALE_MS   = 6 * 60 * 60 * 1000; // 6h

const SCHEMA_VERSIONS_889 = {
  jarvis_workflow_hist:      2,
  jarvis_friction_signals:   1,
  jarvis_execution_memory:   1,
  jarvis_health_snapshot:    1,
  jarvis_operator_workspace: 1,
  jarvis_pw_memory:          1,
  jarvis_oi_memory:          2,
  jarvis_wa_chains:          1,
  jarvis_cw_exports:         1,
  jarvis_onboarding:         1,
  jarvis_crash_log:          1,
};

export function checkMigrationCompatibility() {
  const issues = [];
  const staleKeys = [];
  Object.entries(SCHEMA_VERSIONS_889).forEach(([key, expectedVer]) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const storedVer = parsed?._schemaVersion;
      if (storedVer && storedVer < expectedVer) {
        staleKeys.push({ key, storedVer, expectedVer });
        issues.push(`${key} schema v${storedVer} → needs v${expectedVer}`);
      }
    } catch { issues.push(`${key} is malformed`); }
  });
  return { compatible: staleKeys.length === 0, staleKeys, issues, checkedAt: Date.now() };
}

export function validateReplaySafety(snapshot) {
  if (!snapshot) return { safe: false, reason: "No snapshot" };
  const ageMs = Date.now() - (snapshot.ts || 0);
  if (ageMs > REPLAY_STALE_MS) {
    return { safe: false, reason: `Snapshot ${Math.round(ageMs / 3600000)}h old — too stale` };
  }
  return { safe: true, reason: null };
}

function _loadMigrationLog() {
  try { return JSON.parse(localStorage.getItem(MIGRATION_LOG_KEY) || "[]").slice(0, MIG_MAX_889); } catch { return []; }
}
function _saveMigrationLog(log) {
  try { localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify(log.slice(0, MIG_MAX_889))); } catch {}
}

export function recordMigration(version, success, reason = "") {
  const log = _loadMigrationLog();
  log.unshift({ ts: Date.now(), version, success, reason: reason.slice(0, 200) });
  _saveMigrationLog(log);
}

// Phase 889 extended hook — adds migration + replay safety on top of existing hook
export function useUpdateSafety889() {
  const base = useUpdateSafety();
  const [compatibility, setCompatibility] = useState(null);
  const [migrationLog,  setMigrationLog]  = useState([]);

  useEffect(() => {
    setCompatibility(checkMigrationCompatibility());
    setMigrationLog(_loadMigrationLog());
  }, []);

  const replaySafety = useMemo(() => {
    try {
      const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
      return validateReplaySafety(snap);
    } catch { return { safe: false, reason: "Snapshot unreadable" }; }
  }, []);

  const migrationHealth = useMemo(() => {
    const recent = migrationLog.slice(0, 5);
    const failed = recent.filter(m => !m.success).length;
    return {
      label: failed > 0 ? `${failed} migration failure(s)` : "Clean",
      color: failed > 0 ? "var(--op-amber)" : "var(--op-green)",
    };
  }, [migrationLog]);

  const recheck = useCallback(() => {
    setCompatibility(checkMigrationCompatibility());
    setMigrationLog(_loadMigrationLog());
  }, []);

  return { ...base, compatibility, migrationLog, migrationHealth, replaySafety, recheck };
}
