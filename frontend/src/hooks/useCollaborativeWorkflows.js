// Phase 871-880: Engineering collaboration + team workflow maturity.
// Provides workflow export/import, debugging handoffs, deployment coordination,
// shared engineering memory, and workspace handoff support.
//
// Constraints:
//   - All local — no external network calls, no autonomous dispatch
//   - Export format: JSON blob copied to clipboard or downloaded; no server upload
//   - Bounded: EXPORT_MAX=10 workflows, SHARED_MEM_MAX=30 entries, 24h TTL
//   - Reconnect-safe: all state in jarvis_cw_ namespace
//   - Multi-project isolated: keys prefixed jarvis_cw_
//   - Stale guard: 6h handoff TTL, 24h shared memory TTL, 1h import validation

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY       = "jarvis_workflow_hist";
const DEBUG_KEY      = "jarvis_debug_sessions";
const WA_MEMORY_KEY  = "jarvis_wa_memory";
const OI_SESSION_KEY = "jarvis_oi_session";
const EA_SESSION_KEY = "jarvis_ea_session";
const SNAPSHOT_KEY   = "jarvis_health_snapshot";

const CW_EXPORTS_KEY = "jarvis_cw_exports";   // local export history
const CW_SHARED_KEY  = "jarvis_cw_shared";    // shared memory entries
const CW_HANDOFF_KEY = "jarvis_cw_handoff";   // active workspace handoff
const CW_IMPORT_KEY  = "jarvis_cw_imports";   // validated imports history

const EXPORT_MAX     = 10;
const SHARED_MEM_MAX = 30;
const CW_TTL         = 24 * 60 * 60 * 1000;
const HANDOFF_TTL    = 6  * 60 * 60 * 1000;
const IMPORT_STALE   = 60 * 60 * 1000;       // 1h — imported workflows older than this are stale

// ── Storage helpers ──────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function _loadHist()        { return _load(HIST_KEY, []); }
function _loadDebugSessions() {
  try {
    const raw = _load(DEBUG_KEY, []);
    return raw.filter(s => Date.now() - (s.startedAt || 0) < HANDOFF_TTL);
  } catch { return []; }
}

function _loadSharedMem() {
  try {
    return _load(CW_SHARED_KEY, []).filter(e => Date.now() - (e.ts || 0) < CW_TTL);
  } catch { return []; }
}

function _saveSharedMem(entries) {
  try { localStorage.setItem(CW_SHARED_KEY, JSON.stringify(entries.slice(0, SHARED_MEM_MAX))); } catch {}
}

function _loadExports() {
  return _load(CW_EXPORTS_KEY, []).filter(e => Date.now() - (e.exportedAt || 0) < CW_TTL);
}

function _saveExports(list) {
  try { localStorage.setItem(CW_EXPORTS_KEY, JSON.stringify(list.slice(0, EXPORT_MAX))); } catch {}
}

function _loadHandoff() {
  try {
    const raw = _load(CW_HANDOFF_KEY, null);
    if (!raw || Date.now() - (raw.createdAt || 0) > HANDOFF_TTL) return null;
    return raw;
  } catch { return null; }
}

function _saveHandoff(data) {
  try { localStorage.setItem(CW_HANDOFF_KEY, JSON.stringify({ ...data, createdAt: Date.now() })); } catch {}
}

// ── Phase 871: Workflow export builder ───────────────────────────────────────
// Generates a portable workflow bundle. Includes: steps, metadata, context snapshot.
// No secrets or auth tokens — only structural workflow data.

function _buildWorkflowExport(label, steps, category, context = {}) {
  const now = Date.now();
  return {
    version:     "1",
    id:          `wf-${now}`,
    label:       label || "Exported workflow",
    category:    category || "general",
    exportedAt:  now,
    exportedBy:  "jarvis-operator",
    steps:       steps.slice(0, 10).map(s => ({
      id:      s.id,
      label:   s.label,
      cmd:     s.cmd,
      safe:    s.safe,
      phase:   s.phase || "execute",
      requiresApproval: s.requiresApproval || false,
    })),
    context: {
      // Phase 871: attach non-sensitive context for replay-safe sharing
      failRate:    context.failRate ?? null,
      deployScore: context.deployScore ?? null,
      errorClass:  context.errorClass ?? null,
      ageMin:      context.ageMin ?? null,
    },
    // Phase 871: validation metadata — receiver can check freshness
    staleAfterMs: HANDOFF_TTL,
  };
}

// ── Phase 871: Workflow import validator ─────────────────────────────────────
// Validates imported workflow bundles. Rejects: unknown version, missing steps,
// expired bundles, unsafe commands.

const _BLOCKED_PATTERNS = [
  /rm\s+-rf/i, /:\(\)\{.*\}/,    // fork bomb
  /curl.*\|.*sh/i,               // pipe-to-shell
  /wget.*-O\s*-.*sh/i,           // download+execute
  /dd\s+if=/i,                   // disk wipe
  /mkfs/i,                       // format disk
  />\s*\/dev\/(sda|hda|vda)/i,   // direct disk write
];

function _validateImport(blob) {
  try {
    if (!blob || typeof blob !== "object") return { ok: false, reason: "Invalid format" };
    if (blob.version !== "1") return { ok: false, reason: `Unknown version: ${blob.version}` };
    if (!Array.isArray(blob.steps) || !blob.steps.length) return { ok: false, reason: "No steps found" };
    if (blob.steps.length > 10) return { ok: false, reason: "Too many steps (max 10)" };

    // Stale check — Phase 879
    const age = Date.now() - (blob.exportedAt || 0);
    if (age > CW_TTL) return { ok: false, reason: `Workflow is ${Math.floor(age / 3600000)}h old — too stale to import` };

    // Safety check each step
    for (const step of blob.steps) {
      if (!step.cmd || typeof step.cmd !== "string") return { ok: false, reason: `Step "${step.id}" has no command` };
      for (const pat of _BLOCKED_PATTERNS) {
        if (pat.test(step.cmd)) return { ok: false, reason: `Unsafe command blocked: ${step.cmd.slice(0, 40)}` };
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Parse error: ${e.message}` };
  }
}

// ── Phase 872: Debugging handoff builder ─────────────────────────────────────
// Builds a debugging context summary for handoff. All state from localStorage.

function _buildDebugHandoff(debugSessions, hist, eaSession) {
  const now = Date.now();
  const recentFails = hist.filter(h => !h.ok && (now - (h.ts || 0)) < 30 * 60 * 1000);
  const activeSession = debugSessions[0] || null;
  const rootCauses = eaSession?.rootCauses || [];

  if (!activeSession && !recentFails.length && !rootCauses.length) return null;

  return {
    createdAt:    now,
    activeSession: activeSession ? {
      label:      activeSession.label,
      errorClass: activeSession.errorClass,
      ageMin:     Math.round((now - (activeSession.startedAt || now)) / 60000),
    } : null,
    recentFailCount: recentFails.length,
    topRootCause: rootCauses[0] ? { label: rootCauses[0].label, confidence: rootCauses[0].confidence, fix: rootCauses[0].fix } : null,
    summary: activeSession
      ? `Active debug: "${activeSession.label}" (${activeSession.errorClass || "unknown"} error) — ${recentFails.length} recent failures`
      : `${recentFails.length} recent failures${rootCauses[0] ? ` — likely: ${rootCauses[0].label}` : ""}`,
  };
}

// ── Phase 873: Deployment coordination report ─────────────────────────────────
// Builds a deployment state summary for team coordination.

function _buildDeployCoordReport(hist, healthSnap, oiSession) {
  const now = Date.now();
  const W30 = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < W30);

  const lastDeploy = hist.find(h => /deploy|pm2 restart|pm2 start/i.test(h.cmd || ""));
  const lastBackup = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const failRate   = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100) : 0;
  const deployScore = oiSession?.deployReadiness?.score ?? 100;
  const trustScore  = healthSnap?.trust?.score ?? 100;
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;

  const rollback = backupAgeMin !== null && backupAgeMin <= 60
    ? { label: "READY", color: "var(--op-green)", ageMin: backupAgeMin }
    : backupAgeMin !== null
      ? { label: "STALE", color: "var(--op-amber)", ageMin: backupAgeMin }
      : { label: "NONE", color: "var(--op-red)", ageMin: null };

  return {
    deployScore,
    trustScore,
    failRate,
    rollback,
    lastDeployCmd:    lastDeploy ? (lastDeploy.cmd || "").slice(0, 60) : null,
    lastDeployOk:     lastDeploy?.ok ?? null,
    lastDeployAgeMin: lastDeploy ? Math.round((now - (lastDeploy.ts || 0)) / 60000) : null,
    readyToDeploy:    deployScore >= 70 && failRate < 25 && trustScore >= 60,
    summary:          deployScore >= 85
      ? `Deploy ready — ${failRate}% fail rate, rollback ${rollback.label}`
      : `Deploy caution — score ${deployScore}/100, ${failRate}% fail rate`,
  };
}

// ── Phase 874: Shared engineering memory ─────────────────────────────────────
// Merges workflow memory from multiple sources into a unified shared recall store.
// Deduplicates by command prefix, caps at SHARED_MEM_MAX.

function _buildSharedMemory(waMemory, pwMemory) {
  const combined = [
    ...(waMemory || []).map(e => ({ ...e, source: "automation" })),
    ...(pwMemory || []).map(e => ({ ...e, source: "productivity" })),
  ];

  const seen = new Set();
  return combined
    .filter(e => {
      const key = (e.cmd || e.chainId || e.bundleId || "").slice(0, 20);
      if (seen.has(key)) return false;
      seen.add(key);
      return Date.now() - (e.ts || 0) < CW_TTL;
    })
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, SHARED_MEM_MAX);
}

// ── Phase 875: Workspace handoff builder ─────────────────────────────────────
// Snapshots the current workspace state for handoff to another session/operator.

function _buildWorkspaceHandoff(hist, debugSessions, eaSession, oiSession) {
  const now = Date.now();
  const recentFails = hist.filter(h => !h.ok && (now - (h.ts || 0)) < 15 * 60 * 1000);
  const lastCmd = hist[0];

  return {
    createdAt:    now,
    staleAfter:   HANDOFF_TTL,
    mode:         debugSessions.length ? "debugging" : recentFails.length > 3 ? "incident" : "general",
    lastCmd:      lastCmd ? { cmd: (lastCmd.cmd || "").slice(0, 80), ok: lastCmd.ok } : null,
    failRate:     hist.slice(0, 20).length
      ? Math.round((hist.slice(0, 20).filter(h => !h.ok).length / hist.slice(0, 20).length) * 100) : 0,
    deployScore:  oiSession?.deployReadiness?.score ?? null,
    topRootCause: eaSession?.rootCauses?.[0]?.label ?? null,
    debugSession: debugSessions[0] ? {
      label:      debugSessions[0].label,
      errorClass: debugSessions[0].errorClass,
      ageMin:     Math.round((now - (debugSessions[0].startedAt || now)) / 60000),
    } : null,
    suggestedFirstStep: eaSession?.rootCauses?.[0]?.fix ?? "pm2 list",
  };
}

// ── Phase 878: Coarse dep-key for collaboration state ────────────────────────
// Recalculate collaboration signals only when debug session count changes
// or deploy score bucket shifts.

function _deployBucket(oiSession) {
  const s = oiSession?.deployReadiness?.score ?? 100;
  return s >= 85 ? 2 : s >= 60 ? 1 : 0;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useCollaborativeWorkflows() {
  const [debugHandoff,     setDebugHandoff]     = useState(null);
  const [deployReport,     setDeployReport]     = useState(null);
  const [sharedMemory,     setSharedMemory]     = useState([]);
  const [workspaceHandoff, setWorkspaceHandoff] = useState(null);
  const [exports,          setExports]          = useState([]);
  const [importError,      setImportError]      = useState(null);
  const [importedWorkflow, setImportedWorkflow] = useState(null);

  const evaluate = useCallback(() => {
    const hist         = _loadHist();
    const debugSess    = _loadDebugSessions();
    const eaSession    = _load(EA_SESSION_KEY, null);
    const oiSession    = _load(OI_SESSION_KEY, null);
    const healthSnap   = _load(SNAPSHOT_KEY, null);
    const waMemory     = _load(WA_MEMORY_KEY, []).filter(e => Date.now() - (e.ts || 0) < CW_TTL);
    const pwMemory     = _load("jarvis_pw_memory", []).filter(e => Date.now() - (e.ts || 0) < CW_TTL);

    setDebugHandoff(_buildDebugHandoff(debugSess, hist, eaSession));
    setDeployReport(_buildDeployCoordReport(hist, healthSnap, oiSession));
    setSharedMemory(_buildSharedMemory(waMemory, pwMemory));
    setWorkspaceHandoff(_buildWorkspaceHandoff(hist, debugSess, eaSession, oiSession));
    setExports(_loadExports());
  }, []);

  useEffect(() => {
    evaluate();
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Phase 878: coarse dep-key — re-evaluate when debug session count or deploy bucket changes
  const [debugCount, setDebugCount] = useState(() => _loadDebugSessions().length);
  useEffect(() => {
    const id = setInterval(() => {
      setDebugCount(_loadDebugSessions().length);
    }, 20_000);
    return () => clearInterval(id);
  }, []);
  const oiSession = _load(OI_SESSION_KEY, null);
  const deployBucket = _deployBucket(oiSession);
  useEffect(() => { evaluate(); }, [debugCount, deployBucket, evaluate]);

  // Phase 871: export a workflow chain to clipboard JSON
  const exportWorkflow = useCallback((label, steps, category, context = {}) => {
    const bundle = _buildWorkflowExport(label, steps, category, context);
    const json   = JSON.stringify(bundle, null, 2);

    // Copy to clipboard (non-blocking; graceful fallback)
    try { navigator.clipboard?.writeText(json); } catch {}

    // Persist to local export history
    const saved = _loadExports();
    saved.unshift({ id: bundle.id, label, category, exportedAt: bundle.exportedAt, stepCount: bundle.steps.length });
    _saveExports(saved);
    setExports(_loadExports());

    return bundle;
  }, []);

  // Phase 871: import a workflow from JSON string
  const importWorkflow = useCallback((jsonStr) => {
    setImportError(null);
    setImportedWorkflow(null);
    try {
      const blob = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      const result = _validateImport(blob);
      if (!result.ok) {
        setImportError(result.reason);
        return null;
      }
      // Record import
      try {
        const imports = _load(CW_IMPORT_KEY, []).filter(e => Date.now() - (e.importedAt || 0) < CW_TTL);
        imports.unshift({ id: blob.id, label: blob.label, importedAt: Date.now(), stepCount: blob.steps.length });
        localStorage.setItem(CW_IMPORT_KEY, JSON.stringify(imports.slice(0, 20)));
      } catch {}
      setImportedWorkflow(blob);
      return blob;
    } catch (e) {
      setImportError(`Invalid JSON: ${e.message}`);
      return null;
    }
  }, []);

  // Phase 875: save current workspace state as a handoff snapshot
  const saveHandoff = useCallback(() => {
    if (workspaceHandoff) _saveHandoff(workspaceHandoff);
    return workspaceHandoff;
  }, [workspaceHandoff]);

  // Phase 874: add a shared memory entry (e.g. a successful recovery pattern)
  const addSharedMemory = useCallback((entry) => {
    const mem = _loadSharedMem();
    const existing = mem.find(e => (e.cmd || e.chainId) === (entry.cmd || entry.chainId));
    if (existing) { existing.count = (existing.count || 1) + 1; existing.ts = Date.now(); }
    else { mem.unshift({ ...entry, count: 1, ts: Date.now() }); }
    _saveSharedMem(mem);
    setSharedMemory(_buildSharedMemory(mem, []));
  }, []);

  // Phase 876: deployment coordination summary string for display
  const deployCoordLabel = useMemo(() => {
    if (!deployReport) return null;
    return {
      label:   deployReport.readyToDeploy ? "READY TO DEPLOY" : "NOT READY",
      color:   deployReport.readyToDeploy ? "var(--op-green)" : deployReport.deployScore >= 60 ? "var(--op-amber)" : "var(--op-red)",
      summary: deployReport.summary,
      rollback: deployReport.rollback,
    };
  }, [deployReport]);

  // Phase 872: debug handoff label for compact display
  const debugHandoffLabel = useMemo(() => {
    if (!debugHandoff) return null;
    return {
      summary:  debugHandoff.summary,
      hasActive: !!debugHandoff.activeSession,
      ageMin:   debugHandoff.activeSession?.ageMin ?? null,
      topFix:   debugHandoff.topRootCause?.fix ?? null,
    };
  }, [debugHandoff]);

  // Phase 880: check if imported workflow is stale
  const importedWorkflowStale = useMemo(() => {
    if (!importedWorkflow) return false;
    return Date.now() - (importedWorkflow.exportedAt || 0) > IMPORT_STALE;
  }, [importedWorkflow]);

  return {
    // Phase 871: workflow export/import
    exportWorkflow,
    importWorkflow,
    importError,
    importedWorkflow,
    importedWorkflowStale,
    exports,
    // Phase 872: debugging handoff
    debugHandoff,
    debugHandoffLabel,
    // Phase 873: deployment coordination
    deployReport,
    deployCoordLabel,
    // Phase 874: shared engineering memory
    sharedMemory,
    addSharedMemory,
    // Phase 875: workspace handoff
    workspaceHandoff,
    saveHandoff,
    evaluate,
  };
}
