import React, { useState, useCallback, useMemo, useEffect } from "react";
import { safeDispatch as _apiDispatch, queueTask } from "../../api";
import PatchApprovalPanel from "./PatchApprovalPanel";
import { useProductivityAnalytics, generateSessionNarrative } from "../../hooks/useProductivityAnalytics"; // Phase 329
import { useExecutionMemory } from "../../hooks/useExecutionMemory"; // Phase 242
import { useWorkflowAssistant } from "../../hooks/useWorkflowAssistant"; // Phase 243 + 266
import { useAdaptiveExecution } from "../../hooks/useAdaptiveExecution"; // Phase 247
import { useWorkflowReasoning } from "../../hooks/useWorkflowReasoning"; // Phase 261
import { useExecutionGraph } from "../../hooks/useExecutionGraph"; // Phase 262
import { useWorkflowCheckpoint } from "../../hooks/useWorkflowCheckpoint"; // Phase 269
import { useExecutionTrust } from "../../hooks/useExecutionTrust"; // Phase 341
import { useWorkflowContinuity } from "../../hooks/useWorkflowContinuity"; // Phase 341
import { useOperationalCalmness } from "../../hooks/useOperationalCalmness"; // Phase 341
import { useWorkflowExecutor } from "../../hooks/useWorkflowExecutor"; // Phase 344
import { useExecutionRuntime, useExecutionValidation, useRecoveryCoordinator, useAdapterCoordination, useOperatorTimeline, bus, runFullCompression } from "../../runtime/execution/index"; // Phase 366-375

const HIST_KEY  = "jarvis_workflow_hist";
const HIST_MAX  = 20;

// Phase 292: on-demand local state repair — call from UI to fix common stale-state issues
// Returns a summary of what was repaired so the operator gets actionable feedback.
// Phase 293: short-lived result cache for read-only observation commands.
// Avoids redundant backend calls for safe, idempotent commands within a 60s window.
const _CACHEABLE = /^(pm2 list|pm2 status|git status|git log|git diff|df -h|ls |cat |pwd|npm run check-health)/i;
const _CACHE_TTL_MS = 60_000;
const _execCache = new Map(); // cmd → { result, ts }

function _cacheGet(cmd) {
  const entry = _execCache.get(cmd);
  if (!entry) return null;
  if (Date.now() - entry.ts > _CACHE_TTL_MS) { _execCache.delete(cmd); return null; }
  return entry.result;
}

function _cacheSet(cmd, result) {
  if (!_CACHEABLE.test(cmd.trim())) return;
  _execCache.set(cmd, { result, ts: Date.now() });
  // Evict oldest entries when cache grows large — prevents unbounded memory in long sessions
  if (_execCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of _execCache) {
      if (now - v.ts > _CACHE_TTL_MS) _execCache.delete(k);
      if (_execCache.size <= 40) break;
    }
  }
}

function runLocalRepair() {
  const repairs = [];
  try {
    const now = Date.now();

    const _tryHeal = (key, check, fix, label) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const val = JSON.parse(raw);
        if (check(val)) { fix(val); repairs.push(label); }
      } catch { localStorage.removeItem(key); repairs.push(`Cleared corrupt ${key}`); }
    };

    _tryHeal("jarvis_install_state",
      s => s.status === "installing" && now - s.ts > 10 * 60 * 1000,
      () => localStorage.setItem("jarvis_install_state", JSON.stringify({ status: "healed", ts: now })),
      "Cleared stuck install state"
    );
    _tryHeal("jarvis_update_state",
      s => s.status === "updating" && now - s.ts > 10 * 60 * 1000,
      () => localStorage.setItem("jarvis_update_state", JSON.stringify({ status: "healed", ts: now })),
      "Cleared stuck update state"
    );
    _tryHeal("jarvis_workflow_chains",
      chains => { const v = chains.filter(c => c?.id && Array.isArray(c?.steps) && c.steps.length > 0); return v.length !== chains.length; },
      chains => { const v = chains.filter(c => c?.id && Array.isArray(c?.steps) && c.steps.length > 0); localStorage.setItem("jarvis_workflow_chains", JSON.stringify(v)); },
      "Removed malformed workflow chains"
    );
    _tryHeal("jarvis_execution_graph",
      edges => { const v = edges.filter(e => e?.from && e?.to && e?.relation); return v.length !== edges.length; },
      edges => { const v = edges.filter(e => e?.from && e?.to && e?.relation); localStorage.setItem("jarvis_execution_graph", JSON.stringify(v)); },
      "Pruned corrupt graph edges"
    );
    _tryHeal("jarvis_workflow_checkpoints",
      cps => { const v = cps.filter(c => c?.workflowId && now - (c.savedAt || 0) < 24 * 60 * 60 * 1000); return v.length !== cps.length; },
      cps => { const v = cps.filter(c => c?.workflowId && now - (c.savedAt || 0) < 24 * 60 * 60 * 1000); localStorage.setItem("jarvis_workflow_checkpoints", JSON.stringify(v)); },
      "Expired stale checkpoints"
    );
    _tryHeal("jarvis_execution_memory",
      mem => { const cutoff = now - 30 * 24 * 60 * 60 * 1000; const v = mem.filter(e => (e.lastTs || 0) > cutoff); return v.length !== mem.length; },
      mem => { const cutoff = now - 30 * 24 * 60 * 60 * 1000; const v = mem.filter(e => (e.lastTs || 0) > cutoff); localStorage.setItem("jarvis_execution_memory", JSON.stringify(v)); },
      "Pruned stale execution memory"
    );
    // Phase 311: prune oversized friction log — cap at 200 entries if it somehow grew past limit
    _tryHeal("jarvis_friction_signals",
      log => Array.isArray(log) && log.length > 200,
      log => localStorage.setItem("jarvis_friction_signals", JSON.stringify(log.slice(0, 200))),
      "Trimmed oversized friction log"
    );
    // Phase 311: clear stuck operator input older than 1 hour (orphaned draft from a previous session)
    const draftTs = (() => { try { return parseInt(localStorage.getItem("jarvis_operator_input_ts") || "0"); } catch { return 0; } })();
    if (draftTs && now - draftTs > 60 * 60 * 1000) {
      localStorage.removeItem("jarvis_operator_input");
      localStorage.removeItem("jarvis_operator_input_ts");
      repairs.push("Cleared stale draft command");
    }
  } catch { /* repair best-effort */ }
  return repairs;
}

const DANGEROUS_CMDS = ["rm -rf", "drop table", "drop database", "shutdown", "reboot", "kill "];


function _loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

// Phase 345: debounced write — coalesces rapid sequential saves (workflow steps) into one I/O op
let _histSaveTimer = null;
function _saveHistory(hist) {
  clearTimeout(_histSaveTimer);
  _histSaveTimer = setTimeout(() => {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, HIST_MAX))); } catch {}
  }, 200);
}
const MACROS_KEY    = "jarvis_workflow_macros";
const WORKFLOWS_KEY = "jarvis_sequential_workflows";
const CHAINS_KEY    = "jarvis_workflow_chains"; // Phase 241: conditional chains
const MACROS_MAX    = 15;

// Phase 241: intelligent workflow chain — conditional execution with retry branching
// Chain step schema: { cmd, label?, onSuccess?, onFailure?, retries?, fallback? }
// onSuccess/onFailure: index of next step (null = end), -1 = abort
// fallback: cmd to run if all retries exhausted
function _loadChains() {
  try {
    const raw = localStorage.getItem(CHAINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function _saveChain(chain) {
  try {
    const chains = _loadChains().filter(c => c.id !== chain.id);
    chains.unshift(chain);
    localStorage.setItem(CHAINS_KEY, JSON.stringify(chains.slice(0, 20)));
  } catch {}
}


// Phase 162: Workflow template ecosystem — beginner, developer, automation, browser, productivity packs
// Phase 179: featured flag + verification label for trust indicators
const TEMPLATE_PACKS = [
  {
    id: "beginner",
    label: "Beginner Starter",
    icon: "🌱",
    desc: "Safe first commands for new users",
    featured: true,
    verified: true,
    macros: [
      { name: "Check System Health",  cmd: "npm run check-health",                     priority: "1", timeout: "15" },
      { name: "View Runtime Status",  cmd: "pm2 list",                                 priority: "1", timeout: "10" },
      { name: "See Recent Logs",      cmd: "pm2 logs --lines 20",                      priority: "1", timeout: "10" },
      { name: "Restart Services",     cmd: "pm2 restart all",                          priority: "2", timeout: "30" },
    ],
  },
  {
    id: "developer",
    label: "Developer Pack",
    icon: "🛠",
    desc: "Build, test, and deploy workflows",
    featured: true,
    verified: true,
    macros: [
      { name: "Start Frontend Dev",   cmd: "npm run dev",                              priority: "1", timeout: "60" },
      { name: "Start Backend",        cmd: "npm run server",                           priority: "1", timeout: "60" },
      { name: "Run Tests",            cmd: "npm test",                                 priority: "1", timeout: "90" },
      { name: "Build App",            cmd: "npm run build",                            priority: "2", timeout: "180" },
      { name: "Install Dependencies", cmd: "npm install",                              priority: "2", timeout: "120" },
      { name: "Lint Code",            cmd: "npm run lint",                             priority: "1", timeout: "30" },
    ],
  },
  {
    id: "automation",
    label: "Automation Pack",
    icon: "⚡",
    desc: "Ops and maintenance automation",
    verified: true,
    macros: [
      { name: "Quick Restart",        cmd: "pm2 restart all && sleep 2 && pm2 list",  priority: "2", timeout: "30" },
      { name: "Backup Data",          cmd: "npm run backup && echo 'Backup complete'", priority: "2", timeout: "60" },
      { name: "Cleanup Old Logs",     cmd: "find logs -mtime +7 -delete && echo done", priority: "1", timeout: "30" },
      { name: "Check Disk Space",     cmd: "df -h",                                   priority: "1", timeout: "10" },
      { name: "View Queue Status",    cmd: "npm run check-health",                    priority: "1", timeout: "15" },
    ],
  },
  {
    id: "browser",
    label: "Browser Automation",
    icon: "🌐",
    desc: "Web scraping and data extraction",
    macros: [
      { name: "Scrape Page Data",     cmd: "scrape-page-data",                        priority: "1", timeout: "30" },
      { name: "Export to CSV",        cmd: "export-to-csv",                           priority: "1", timeout: "20" },
      { name: "Save Structured Data", cmd: "save-structured-output",                  priority: "1", timeout: "15" },
      { name: "Screenshot Page",      cmd: "screenshot-current-page",                 priority: "1", timeout: "15" },
    ],
  },
  {
    id: "productivity",
    label: "Productivity Pack",
    icon: "🚀",
    desc: "Daily operator efficiency shortcuts",
    macros: [
      { name: "Morning Health Check", cmd: "npm run check-health && pm2 list",        priority: "1", timeout: "20" },
      { name: "End-of-Day Backup",    cmd: "npm run backup",                          priority: "2", timeout: "60" },
      { name: "Weekly Log Cleanup",   cmd: "find logs -mtime +7 -delete",             priority: "1", timeout: "30" },
      { name: "Summarize Errors",     cmd: "summarize-error-logs",                    priority: "1", timeout: "30" },
    ],
  },
  // Phase 198: recovery / safe-mode pack
  {
    id: "recovery",
    label: "Recovery Pack",
    icon: "🛟",
    desc: "Safe-mode and crash recovery commands",
    verified: true,
    macros: [
      { name: "Check All Services",   cmd: "pm2 list",                                priority: "1", timeout: "10" },
      { name: "View Error Logs",      cmd: "pm2 logs jarvis-backend --lines 30",      priority: "1", timeout: "15" },
      { name: "Restart Backend",      cmd: "pm2 restart jarvis-backend",              priority: "2", timeout: "30" },
      { name: "Full Restart",         cmd: "pm2 restart all",                         priority: "2", timeout: "30" },
      { name: "Check Disk Space",     cmd: "df -h",                                   priority: "1", timeout: "10" },
      { name: "Kill Stale Processes", cmd: "pm2 delete all && pm2 start ecosystem.config.js", priority: "3", timeout: "30" },
    ],
  },
];

// Productivity Workflow Presets (legacy — kept for backwards compat with preset buttons)
const WORKFLOW_PRESETS = {
  DEVELOPMENT: [
    { label: "▶ Start Frontend", cmd: "npm run dev", timeout: "60" },
    { label: "▶ Start Backend", cmd: "npm run server", timeout: "60" },
    { label: "📦 Install Dependencies", cmd: "npm install", timeout: "120" },
    { label: "🧪 Run Tests", cmd: "npm test", timeout: "90" },
    { label: "🏗️ Build App", cmd: "npm run build", timeout: "180" },
    { label: "⚙️ Package Electron", cmd: "npm run electron:build", timeout: "300" }
  ],
  AI_CODING: [
    { label: "💭 Explain File", cmd: "explain-current-file", timeout: "30" },
    { label: "✨ Generate Function", cmd: "generate-function", timeout: "45" },
    { label: "🔧 Patch Failing Code", cmd: "patch-failing-code", timeout: "60" },
    { label: "📊 Summarize Errors", cmd: "summarize-error-logs", timeout: "30" },
    { label: "⚡ Generate CRUD", cmd: "generate-crud-module", timeout: "90" }
  ],
  TERMINAL_MACROS: [
    { label: "⚡ Quick Restart", cmd: "pm2 restart all && sleep 2 && pm2 list", timeout: "30" },
    { label: "📋 View Queue", cmd: "node -e \"console.log(JSON.stringify(require('./agents/taskQueue.cjs').getQueueStatus(), null, 2))\"", timeout: "10" },
    { label: "🔍 Check Health", cmd: "npm run check-health", timeout: "15" },
    { label: "💾 Quick Backup", cmd: "npm run backup && echo 'Backup complete'", timeout: "60" },
    { label: "🧹 Cleanup Logs", cmd: "find logs -mtime +7 -delete && echo 'Cleanup complete'", timeout: "30" }
  ],
  VSCODE_PRODUCTIVITY: [
    { label: "🔴 Open Last Error", cmd: "open-failing-file", timeout: "10" },
    { label: "⬆️ Jump to Error Line", cmd: "jump-to-error-line", timeout: "10" },
    { label: "✅ Apply Generated Patch", cmd: "apply-generated-patch", timeout: "20" },
    { label: "📂 Open Workspace", cmd: "open-workspace", timeout: "10" }
  ],
  BROWSER_PRODUCTIVITY: [
    { label: "🌐 Scrape Page Data", cmd: "scrape-page-data", timeout: "30" },
    { label: "📊 Export CSV", cmd: "export-to-csv", timeout: "20" },
    { label: "💾 Save Structure", cmd: "save-structured-output", timeout: "15" }
  ]
};

function _loadMacros() {
  try {
    const raw = localStorage.getItem(MACROS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function _saveMacros(macros) {
  try { localStorage.setItem(MACROS_KEY, JSON.stringify(macros.slice(0, MACROS_MAX))); }
  catch { /* storage full */ }
}

function _loadWorkflows() {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { localStorage.removeItem(WORKFLOWS_KEY); return []; }
    return parsed;
  } catch {
    // Corrupted — back up and reset
    try { localStorage.setItem(WORKFLOWS_KEY + ".bak", localStorage.getItem(WORKFLOWS_KEY)); } catch {}
    localStorage.removeItem(WORKFLOWS_KEY);
    return [];
  }
}

let _wfSaveTimer = null;
function _saveWorkflows(workflows) {
  if (!Array.isArray(workflows)) return;
  // Deduplicate by name before persisting
  const seen = new Set();
  const deduped = workflows.filter(w => {
    if (!w?.name || seen.has(w.name)) return false;
    seen.add(w.name);
    return true;
  });
  clearTimeout(_wfSaveTimer);
  _wfSaveTimer = setTimeout(() => {
    try { localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(deduped)); } catch { /* quota */ }
  }, 500);
}
export default function WorkflowPanel({ onRefresh, addNotification, onAction, externalInput, onClearExternal, repoSearch }) {
  const {
    recordDispatchStart, recordDispatchEnd, recordRetry, recordAbandonment,
    recordHesitationStart, recordHesitationCancel, recordReconnectConfusion,
  } = useProductivityAnalytics();
  const { patterns: memoryPatterns, recordFlow: recordMemoryFlow, suggest: suggestFromMem, flowAcceleration } = useExecutionMemory(); // Phase 242 + 302
  const { explanation: assistantExplanation, saferVariant: assistantSafer, recoverySuggestions: assistantRecovery, consequences: assistantConsequences, analyzeCommand: assistantAnalyze, analyzeFailure: assistantAnalyzeFailure, clearAssistant } = useWorkflowAssistant(); // Phase 243 + 266
  const { unstableWorkflows, getRetryDelay, getPacing } = useAdaptiveExecution(); // Phase 247
  const { intentInfo, dependencies, predictions: reasoningPredictions, generateDraft, planWorkflow, qualityScore } = useWorkflowReasoning(debouncedInput); // Phase 261 + 270 + 327 + 333
  const { addEdge: addGraphEdge, successorsOf } = useExecutionGraph(); // Phase 262
  const { resumable: resumableWorkflows, checkpoint: saveWfCheckpoint, resume: resumeWfCheckpoint, clear: clearWfCheckpoint } = useWorkflowCheckpoint(); // Phase 269
  // Phase 341: _recentCmds — stable slice, feeds continuity hook below
  const _recentCmds = useMemo(() => dispatchHist.slice(0, 8).map(h => h.cmd), [dispatchHist]);
  // Phase 304: focus mode — collapses non-essential UI during active execution
  const [focusMode, setFocusMode] = useState(false);
  const [focusModeManual, setFocusModeManual] = useState(false); // operator can pin it on

  const [input, setInput] = useState("");
  const inputRef = React.useRef(null);
  const wasActiveRef = React.useRef(false);
  const lastSuccessfulCmdRef = React.useRef(null); // Phase 262: for graph edge recording

  // Phase 304: auto focus mode — activates when dispatch starts, deactivates on completion
  React.useEffect(() => {
    if (busy) setFocusMode(true);
    else if (!focusModeManual) setFocusMode(false);
  }, [busy, focusModeManual]);

  // Phase 281: debounced input for expensive reasoning/analysis hooks — 300ms prevents per-keystroke recompute
  const [debouncedInput, setDebouncedInput] = useState("");
  const _debounceRef = React.useRef(null);
  useEffect(() => {
    clearTimeout(_debounceRef.current);
    _debounceRef.current = setTimeout(() => setDebouncedInput(input), 300);
    return () => clearTimeout(_debounceRef.current);
  }, [input]);

  // Phase 310: stable external-input focus debounce — uses ref to avoid timer leaks across re-renders
  const _extInputTimerRef = React.useRef(null);
  React.useEffect(() => {
    clearTimeout(_extInputTimerRef.current);
    _extInputTimerRef.current = setTimeout(() => {
      if (externalInput !== undefined && wasActiveRef.current) {
        inputRef.current?.focus();
        wasActiveRef.current = false;
      }
    }, 200);
    return () => clearTimeout(_extInputTimerRef.current);
  }, [externalInput]);

  // Track typing activity – persists across page hides (e.g. tab switch) for long sessions
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wasActiveRef.current) {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const handleFocus = React.useCallback(() => {
    wasActiveRef.current = true;
  }, []);

  const handleBlur = React.useCallback(() => {
    wasActiveRef.current = false;
  }, []);

  // Persist unsent command across reloads / long idle periods (low‑memory safety)
  React.useEffect(() => {
    const saved = localStorage.getItem("jarvis_operator_input");
    if (saved && !input) setInput(saved);
    return () => {
      if (input) {
        localStorage.setItem("jarvis_operator_input", input);
        localStorage.setItem("jarvis_operator_input_ts", Date.now().toString()); // Phase 311
      }
    };
  }, []);
  const [priority,    setPriority]    = useState("1");
  const [timeout,     setTimeout_]    = useState("30");
  const [result,      setResult]      = useState(null);  // { ok, text }
  const [pendingPatch, setPendingPatch] = useState(null); // { patchId, targetFile }
  // Flood protection: debounce rapid dispatches
  const lastDispatchRef = React.useRef(0);
  const safeDispatch = async (cmd, t) => {
    const now = Date.now();
    if (now - lastDispatchRef.current < 300) { // 300ms cooldown
      addNotification?.('Dispatch flood detected – suppressed', 'warn');
      return null;
    }
    lastDispatchRef.current = now;
    return await _apiDispatch(cmd, t);
  };
  const [busy,           setBusy]          = useState(false);
  const [execStart,      setExecStart]     = useState(null);
  const [elapsed,        setElapsed]       = useState(0);
  const [showHistory,    setShowHistory]   = useState(false);
  // Phase 146: completion summary — brief digest after each dispatch
  const [lastCompletion, setLastCompletion] = useState(null); // { ok, cmd, durationMs, ts }
  const completionTimerRef = React.useRef(null);
  const showCompletion = React.useCallback((ok, cmd, durationMs) => {
    clearTimeout(completionTimerRef.current);
    setLastCompletion({ ok, cmd: cmd.slice(0, 40), durationMs, ts: Date.now() });
    completionTimerRef.current = setTimeout(() => setLastCompletion(null), ok ? 5000 : 10000);
  }, []);
  React.useEffect(() => () => clearTimeout(completionTimerRef.current), []);
  const [dispatchHist, setDispatchHist] = useState(_loadHistory);
  const [savedMacros, setSavedMacros] = useState(_loadMacros);
  const [workflowProgressPct, setWorkflowProgressPct] = useState(0);
  const [showMacroEditor, setShowMacroEditor] = useState(false);
  const [macroName, setMacroName] = useState("");
  // Phase 83: dangerous op confirmation state
  const [pendingDangerCmd, setPendingDangerCmd] = useState(null);
  // Phase 89: workflow search/filter
  const [macroSearch, setMacroSearch] = useState("");

  // Phase 332: track external input source for cross-tool continuity clarity
  const [lastExternalSource, setLastExternalSource] = useState(null);
  const _extSourceTimerRef = React.useRef(null);

  React.useEffect(() => {
    if (externalInput) {
      setInput(externalInput);
      // Phase 332: infer source from command pattern for display label
      const src = /npm|node|git|pm2|docker/.test(externalInput) ? "terminal" : "editor";
      setLastExternalSource(src);
      clearTimeout(_extSourceTimerRef.current);
      _extSourceTimerRef.current = setTimeout(() => setLastExternalSource(null), 4000);
      onClearExternal?.();
    }
    return () => clearTimeout(_extSourceTimerRef.current);
  }, [externalInput, onClearExternal]);

  const resultTimerRef = React.useRef(null);
  React.useEffect(() => () => { if (resultTimerRef.current) clearTimeout(resultTimerRef.current); }, []);

  // Phase 103 + 337: elapsed timer — 100ms ticks for sub-second readability on fast commands
  const elapsedIntervalRef = React.useRef(null);
  React.useEffect(() => {
    if (busy && execStart) {
      elapsedIntervalRef.current = setInterval(() => {
        const ms = Date.now() - execStart;
        // Phase 337: show tenths of a second for first 3s, then whole seconds
        setElapsed(ms < 3000 ? parseFloat((ms / 1000).toFixed(1)) : Math.floor(ms / 1000));
      }, 100);
    } else {
      clearInterval(elapsedIntervalRef.current);
      setElapsed(0);
    }
    return () => clearInterval(elapsedIntervalRef.current);
  }, [busy, execStart]);

  const showResult = (ok, text) => {
    setResult({ ok, text });
    if (ok) {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => { resultTimerRef.current = null; setResult(null); }, 6000);
    }
  };

  const _addToHistory = useCallback((cmd, ok, summary) => {
    setDispatchHist(prev => {
      const entry = { cmd, ok, summary, ts: Date.now() };
      const next  = [entry, ...prev.filter(h => h.cmd !== cmd)].slice(0, HIST_MAX);
      _saveHistory(next);
      return next;
    });
  }, []);

  // Save macro (localStorage persistence)
  const _lastSaveRef = React.useRef(0);
  const saveMacro = useCallback(() => {
    if (!macroName.trim() || !input.trim()) {
      addNotification?.('Macro name and command required', 'warn');
      return;
    }
    // Duplicate-save guard: 1s debounce
    const now = Date.now();
    if (now - _lastSaveRef.current < 1000) return;
    _lastSaveRef.current = now;

    setSavedMacros(prev => {
      // Replace existing macro with same name rather than duplicating
      const filtered = prev.filter(m => m.name !== macroName.trim());
      const newMacros = [
        { name: macroName.trim(), cmd: input.trim(), priority, timeout, createdAt: now },
        ...filtered
      ].slice(0, MACROS_MAX);
      _saveMacros(newMacros);
      addNotification?.(`✓ Macro saved: ${macroName}`, 'ok');
      setMacroName('');
      setShowMacroEditor(false);
      return newMacros;
    });
  }, [macroName, input, priority, timeout, addNotification]);

  // Delete macro
  const deleteMacro = useCallback((name) => {
    setSavedMacros(prev => {
      const filtered = prev.filter(m => m.name !== name);
      _saveMacros(filtered);
      addNotification?.(`Macro deleted: ${name}`, 'ok');
      return filtered;
    });
  }, [addNotification]);

  // Phase 89: Duplicate macro
  const duplicateMacro = useCallback((macro) => {
    setSavedMacros(prev => {
      const newName = `${macro.name} (copy)`;
      if (prev.find(m => m.name === newName)) return prev;
      const duped = [{ ...macro, name: newName, createdAt: Date.now() }, ...prev].slice(0, MACROS_MAX);
      _saveMacros(duped);
      addNotification?.(`Duplicated: ${newName}`, 'ok');
      return duped;
    });
  }, [addNotification]);

  // Phase 137: workflow metadata + batch actions
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const cloneAllMacros = useCallback(() => {
    const snap = savedMacros.map(m => ({ ...m, name: `[clone] ${m.name}`, createdAt: Date.now() }));
    const key = `jarvis_macro_snapshot_${Date.now()}`;
    try { localStorage.setItem(key, JSON.stringify(snap)); addNotification?.(`Macro snapshot saved (${snap.length} items)`, 'ok'); }
    catch { addNotification?.('Snapshot save failed', 'warn'); }
  }, [savedMacros, addNotification]);
  const clearAllMacros = useCallback(() => {
    setSavedMacros([]);
    _saveMacros([]);
    setShowBatchConfirm(false);
    addNotification?.('All macros cleared', 'warn');
  }, [addNotification]);

  // Phase 116: inline macro rename
  const [renamingMacro, setRenamingMacro] = useState(null); // macro.name being renamed
  const [renameValue, setRenameValue] = useState("");
  const commitRename = useCallback(() => {
    const newName = renameValue.trim();
    if (!newName || !renamingMacro) { setRenamingMacro(null); return; }
    setSavedMacros(prev => {
      if (prev.find(m => m.name === newName && m.name !== renamingMacro)) {
        addNotification?.(`Macro name "${newName}" already exists`, 'warn');
        return prev;
      }
      const updated = prev.map(m => m.name === renamingMacro ? { ...m, name: newName } : m);
      _saveMacros(updated);
      addNotification?.(`Renamed to: ${newName}`, 'ok');
      return updated;
    });
    setRenamingMacro(null);
  }, [renamingMacro, renameValue, addNotification]);

  // Phase 162: template pack install
  const [showTemplatePacks, setShowTemplatePacks] = useState(false);
  const installTemplatePack = useCallback((pack) => {
    setSavedMacros(prev => {
      const existing = new Map(prev.map(m => [m.name, m]));
      let added = 0;
      for (const m of pack.macros) {
        if (!existing.has(m.name)) { existing.set(m.name, { ...m, createdAt: Date.now() }); added++; }
      }
      const merged = [...existing.values()].slice(0, MACROS_MAX);
      _saveMacros(merged);
      addNotification?.(added > 0 ? `✓ Installed ${added} macro(s) from "${pack.label}"` : `All macros from "${pack.label}" already installed`, added > 0 ? "ok" : "info");
      return merged;
    });
    setShowTemplatePacks(false);
  }, [addNotification]);

  // Phase 163: export macros as data-URL share link (no server needed)
  const exportMacrosAsLink = useCallback(() => {
    if (savedMacros.length === 0) { addNotification?.("No macros to share", "warn"); return; }
    const payload = JSON.stringify({ v: 1, macros: savedMacros, exportedAt: new Date().toISOString() });
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const shareStr = `jarvis://macros/${encoded}`;
    try {
      navigator.clipboard.writeText(shareStr);
      addNotification?.(`✓ Share link copied (${savedMacros.length} macros)`, "ok");
    } catch {
      addNotification?.(`Share link: ${shareStr.slice(0, 60)}…`, "info");
    }
  }, [savedMacros, addNotification]);

  // Phase 163: import-from-link with preview — detect jarvis:// links
  const [importPreview, setImportPreview] = useState(null); // { macros, source }
  const parseShareLink = useCallback((text) => {
    if (!text.startsWith("jarvis://macros/")) return false;
    try {
      const encoded = text.slice("jarvis://macros/".length);
      const decoded = JSON.parse(decodeURIComponent(escape(atob(encoded))));
      if (!decoded?.macros?.length) return false;
      setImportPreview({ macros: decoded.macros, source: "share link" });
      return true;
    } catch { return false; }
  }, []);

  const confirmImportPreview = useCallback(() => {
    if (!importPreview) return;
    setSavedMacros(prev => {
      const existing = new Map(prev.map(m => [m.name, m]));
      let added = 0;
      for (const m of importPreview.macros) {
        if (m?.name && m?.cmd) { existing.set(m.name, { ...m, createdAt: Date.now() }); added++; }
      }
      const merged = [...existing.values()].slice(0, MACROS_MAX);
      _saveMacros(merged);
      addNotification?.(`✓ Imported ${added} macro(s) from ${importPreview.source}`, "ok");
      return merged;
    });
    setImportPreview(null);
  }, [importPreview, addNotification]);

  // ── Phase 92: Scheduled backup prompt ────────────────────────────
  const EXPORT_TRACK_KEY = "jarvis_last_wf_export";
  const EXPORT_PROMPT_DAYS = 7;
  React.useEffect(() => {
    const macros = _loadMacros();
    if (macros.length === 0) return;
    const lastExport = (() => { try { return parseInt(localStorage.getItem(EXPORT_TRACK_KEY) || "0"); } catch { return 0; } })();
    const daysSince = (Date.now() - lastExport) / (1000 * 60 * 60 * 24);
    if (daysSince > EXPORT_PROMPT_DAYS) {
      addNotification?.(`Your ${macros.length} macro(s) haven't been exported in ${Math.floor(daysSince)} days. Use Export to back them up.`, "warn", 8000);
    }
  }, []);

  // ── Phase 75: Workflow import/export ─────────────────────────────
  const exportWorkflows = useCallback(() => {
    try {
      const wfs = JSON.parse(localStorage.getItem(WORKFLOWS_KEY) || "[]");
      try { localStorage.setItem(EXPORT_TRACK_KEY, Date.now().toString()); } catch {}
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), workflows: wfs }, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `jarvis_workflows_${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
      addNotification?.(`Exported ${wfs.length} workflow(s)`, "ok");
    } catch { addNotification?.("Export failed", "warn"); }
  }, [addNotification]);

  const importWorkflowsRef = React.useRef(null);
  const importWorkflows = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Schema validation — must have workflows array with name + cmd fields
        if (!parsed?.workflows || !Array.isArray(parsed.workflows))
          throw new Error("invalid schema: missing workflows array");
        const valid = parsed.workflows.filter(w => w?.name && w?.cmd);
        if (valid.length === 0) throw new Error("no valid workflow entries found");

        // Merge with existing (dedup by name — import wins)
        const existing = JSON.parse(localStorage.getItem(WORKFLOWS_KEY) || "[]");
        const existingMap = new Map(existing.map(w => [w.name, w]));
        for (const w of valid) existingMap.set(w.name, w);
        const merged = [...existingMap.values()].slice(0, 50);
        localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(merged));
        addNotification?.(`Imported ${valid.length} workflow(s)`, "ok");
        if (valid.length < parsed.workflows.length)
          addNotification?.(`${parsed.workflows.length - valid.length} entries skipped (invalid)`, "warn");
      } catch (err) {
        addNotification?.(`Import failed: ${err.message.slice(0, 60)}`, "warn");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }, [addNotification]);

  // Phase 344: workflow execution runtime — extracted to useWorkflowExecutor
  const {
    activeWorkflow, workflowProgress, cancelRequested, lastFailedStep,
    chainLog, chainRunning,
    executeWorkflow, runChain, cancelWorkflow, cancelChain, clearChainLog,
  } = useWorkflowExecutor({ addNotification, onAction, getPacing, saveCheckpoint: saveWfCheckpoint, clearCheckpoint: clearWfCheckpoint });

  const lastBackup = useMemo(() => {
    const b = dispatchHist.find(h => h.cmd.includes("backup") && h.ok);
    if (!b) return null;
    return Math.floor((Date.now() - b.ts) / 60000);
  }, [dispatchHist]);

  // Phase 142: rollback confidence — if last backup is recent, show safe badge
  const rollbackConfidence = useMemo(() => {
    if (lastBackup === null) return { label: "No backup", cls: "risky" };
    if (lastBackup < 30)    return { label: `Backed up ${lastBackup}m ago`, cls: "safe" };
    if (lastBackup < 120)   return { label: `Backed up ${lastBackup}m ago`, cls: "caution" };
    return { label: `Backup ${Math.floor(lastBackup / 60)}h ago`, cls: "risky" };
  }, [lastBackup]);

  // Phase 341: trust intelligence — extracted to useExecutionTrust
  const { executionTrust, workflowReliability, overloadState } = useExecutionTrust({
    debouncedCmd: debouncedInput, busy, isInformational: intentInfo?.isInformational, dispatchHist,
  });

  // Phase 142: stale macro warning — macros not used in 30+ days
  const staleMacroNames = useMemo(() => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    return savedMacros
      .filter(m => m.createdAt && Date.now() - m.createdAt > thirtyDaysMs)
      .map(m => m.name);
  }, [savedMacros]);

  // Phase 168: adaptive shortcut hint — shows the most contextually relevant shortcut
  const adaptiveShortcut = useMemo(() => {
    if (busy)                                         return null;
    if (input.trim() && !busy)                        return { key: "Ctrl+D", action: "to dispatch" };
    if (dispatchHist.length > 0 && !input.trim())     return { key: "↑ Arrow", action: "to recall last command" };
    if (savedMacros.length > 0 && !input.trim())      return { key: "Ctrl+1–9", action: "to run a macro" };
    if (!input.trim())                                return { key: "⌘K", action: "to open command palette" };
    return null;
  }, [busy, input, dispatchHist.length, savedMacros.length]);

// Debounced dispatch to prevent rapid repeats (spam protection)
const handleDispatch = async (confirmedCmd = null) => {
    const cmd = confirmedCmd ?? input.trim();
    if (!cmd || busy) return;
    // Phase 83: block dangerous commands until operator explicitly confirms
    if (!confirmedCmd && DANGEROUS_CMDS.some(d => cmd.toLowerCase().includes(d))) {
      setPendingDangerCmd(cmd);
      return;
    }
    // Phase 284: reliability gate — require confirmation for chronically unreliable commands
    if (!confirmedCmd && workflowReliability && workflowReliability.rate < 50 && workflowReliability.runs >= 5) {
      setPendingDangerCmd(cmd); // reuse dangerous confirmation UI with reliability context
      return;
    }
    // Phase 121: dry-run short-circuit
    if (dryRun) {
      const analysis = cmdAnalysis;
      showResult(true, `[DRY RUN] Would dispatch: ${cmd.slice(0, 80)} | Priority: ${priority} | Timeout: ${timeout}s | Risk: ${analysis?.risk.label || "SAFE"}`);
      addNotification?.(`Dry run preview: ${cmd.slice(0, 30)}`, 'info');
      return;
    }
    // Phase 293: return cached result for repeated read-only commands within 60s
    const cached = _cacheGet(cmd);
    if (cached) {
      showResult(true, `[cached] ${cached.slice(0, 200)}`);
      return;
    }
    setBusy(true);
    setExecStart(Date.now());
    setResult(null);
    recordHesitationCancel();
    recordDispatchStart();
    bus.executionStarted(cmd, { priority, timeout }); // Phase 370
    try {
      const r = await safeDispatch(cmd, parseInt(timeout) * 1000);
      if (!r || r.success === false) {
        const friendly = humanizeError(r?.error || "Dispatch failed");
        showResult(false, friendly);
        _addToHistory(cmd, false, friendly.slice(0, 40));
        addNotification?.(`Task failed: ${cmd.slice(0, 20)}`, "crit");
        showCompletion(false, cmd, Date.now() - (execStart || Date.now()));
        bus.executionFailed(cmd, r?.error || "Dispatch failed"); // Phase 370
        assistantAnalyzeFailure(r?.error || "Dispatch failed"); // Phase 243
        recordDispatchEnd(false);
      } else {
        const out = r.output || r.result || r.reply || "Dispatched";
        const raw = typeof out === "string" ? out : JSON.stringify(out);
        _cacheSet(cmd, raw); // Phase 293: cache read-only results for 60s
        // Patch approval gate — devAgent returns requiresApproval + patchId
        if (r.requiresApproval && r.patchId) {
          setPendingPatch({ patchId: r.patchId, targetFile: r.targetFile || "" });
        }
        showResult(true, raw.slice(0, 200) + (raw.length > 200 ? "… (truncated)" : ""));
        _addToHistory(cmd, true, raw.slice(0, 40));
        addNotification?.(`Task succeeded: ${cmd.slice(0, 20)}`, "ok");
        const durationMs = Date.now() - (execStart || Date.now());
        showCompletion(true, cmd, durationMs);
        if (isDangerous) lastDangerousDispatch.current = Date.now();
        recordMemoryFlow(cmd, { durationMs }); // Phase 242: record successful flow
        // Phase 262: record execution graph edge from previous successful cmd
        if (lastSuccessfulCmdRef.current && lastSuccessfulCmdRef.current !== cmd) {
          addGraphEdge(lastSuccessfulCmdRef.current, cmd, "followed_by", { ok: true });
        }
        lastSuccessfulCmdRef.current = cmd;
        bus.executionCompleted(cmd, true, { durationMs: Date.now() - (execStart || Date.now()) }); // Phase 370
        setInput("");
        onAction?.();
        recordDispatchEnd(true);
      }
    } catch (e) {
      const friendly = humanizeError(e.message);
      showResult(false, friendly);
      _addToHistory(cmd, false, friendly.slice(0, 40));
      bus.executionFailed(cmd, e.message); // Phase 370
      addNotification?.(`Dispatch error: ${e.message.slice(0, 40)}`, "crit");
      recordDispatchEnd(false);
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  // Debounce wrapper — must be declared after handleDispatch so closure captures live reference
  const dispatchDebounced = React.useMemo(() => {
    let timeoutRef;
    return () => {
      clearTimeout(timeoutRef);
      timeoutRef = setTimeout(() => handleDispatch(), 300);
    };
  }, []);

  // Queue flood protection – rate limit to 1 call per 500 ms
const lastQueueRef = React.useRef(0);
const handleQueue = async () => {
  const now = Date.now();
  if (now - lastQueueRef.current < 500) return; // ignore rapid repeats
  lastQueueRef.current = now;
    if (!input.trim() || busy) return;
    const cmd = input.trim();
    setBusy(true);
    setResult(null);
    try {
      const r = await queueTask(cmd, parseInt(priority));
      if (r.success === false || (!r.success && !r.queueId)) {
        showResult(false, r.error || "Queue failed");
        _addToHistory(cmd, false, "queue failed");
        addNotification?.(`Failed to queue: ${cmd.slice(0, 20)}`, "warn");
      } else {
        showResult(true, `Queued → ${r.queueId || "ok"}`);
        _addToHistory(cmd, true, `queued ${r.queueId || ""}`);
        addNotification?.(`Task queued (Priority ${priority})`, "info");
        setInput("");
        onAction?.();
      }
    } catch (e) {
      showResult(false, e.message);
      addNotification?.(`Queue error: ${e.message}`, "warn");
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  // Phase 121: dry-run toggle
  const [dryRun, setDryRun] = useState(false);

  // Phase 341: operational calmness + continuity — placed after dryRun + busy + input are declared
  const { cmdAnalysis, executionCertainty, humanizeError, classifyResultFailure } = useOperationalCalmness({ input, debouncedCmd: debouncedInput, busy, dryRun });
  const { activeGoal, contextShift, interruptedIntent, workflowContinuation, incompleteSequence } = useWorkflowContinuity(_recentCmds);

  // Derived from cmdAnalysis — must be after useOperationalCalmness
  const isDangerous = cmdAnalysis?.risk.level === 3;

  // Phase 366: execution runtime — replaces inline dispatch + elapsed timer logic
  const executionRuntime = useExecutionRuntime({
    addNotification, onAction, onRefresh,
    addToHistory: _addToHistory,
    addGraphEdge: addGraphEdge,
    recordMemoryFlow, assistantAnalyzeFailure,
    recordHesitationCancel, recordDispatchStart, recordDispatchEnd,
    humanizeError, dryRun, priority, timeout, cmdAnalysis,
  });

  // Phase 366: post-execution validation
  const { lastValidation, verify: verifyExecution } = useExecutionValidation({ addNotification });

  // Phase 366: recovery coordinator
  const { recoveryState, recoveryTarget, recover: triggerRecovery, clearRecovery } = useRecoveryCoordinator({ addNotification });

  // Phase 369: adapter coordination (30s poll) — informational, never blocks execution
  const { adapterProblems, hasHighSeverityProblem } = useAdapterCoordination({ enabled: true });

  // Phase 371: operator timeline
  const { completionDigest, recoverySummaries, sessionStats } = useOperatorTimeline(dispatchHist);

  // Phase 138: adaptive contextual hint — surfaces relevant tip based on current state
  const contextualHint = useMemo(() => {
    if (busy) return null;
    if (dryRun) return { text: "Dry-run mode is ON. Press ⚡ Dispatch to preview — no execution will occur.", type: "info" };
    if (isDangerous) return { text: "Dangerous command detected. A confirmation gate will appear before execution.", type: "warn" };
    if (savedMacros.length === 0 && dispatchHist.length > 2)
      return { text: "Tip: Save frequent commands as macros using 💾 SAVE MACRO.", type: "tip" };
    if (lastBackup !== null && lastBackup > 120)
      return { text: `Last backup was ${Math.floor(lastBackup / 60)}h ago. Consider running a backup.`, type: "warn" };
    if (input.length > 100 && !input.includes("\n"))
      return { text: "Long command — consider saving it as a macro for quick reuse.", type: "tip" };
    return null;
  }, [busy, dryRun, isDangerous, savedMacros.length, dispatchHist.length, lastBackup, input]);

  // Phase 152: execution readiness badge
  const readinessBadge = useMemo(() => {
    if (busy)         return { label: "EXECUTING", cls: "caution" };
    if (dryRun)       return { label: "DRY RUN", cls: "caution" };
    if (isDangerous)  return { label: "CONFIRM REQ.", cls: "blocked" };
    if (activeWorkflow !== null) return { label: `WORKFLOW ${workflowProgress + 1}/${activeWorkflow}`, cls: "caution" };
    return { label: "READY", cls: "ready" };
  }, [busy, dryRun, isDangerous, activeWorkflow, workflowProgress]);

  // Phase 164: safer execution defaults — cooldown prevents accidental re-dispatch
  const DANGEROUS_COOLDOWN_MS = 5000;
  const lastDangerousDispatch = React.useRef(0);
  const dangerousCooldownActive = useMemo(() => {
    return isDangerous && (Date.now() - lastDangerousDispatch.current < DANGEROUS_COOLDOWN_MS);
  }, [isDangerous, busy]);

  // Phase 132 + 147: panel-level keyboard shortcuts
  React.useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (inInput && document.activeElement !== inputRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); dispatchDebounced(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "l") { e.preventDefault(); if (input.trim()) { recordAbandonment(); recordHesitationCancel(); } setInput(""); historyNavRef.current = -1; }
      if ((e.ctrlKey || e.metaKey) && e.key === "h") { e.preventDefault(); setShowHistory(h => !h); }
      if ((e.ctrlKey || e.metaKey) && e.key === "m") { e.preventDefault(); setShowMacroEditor(m => !m); }
      // Phase 147: Ctrl+R = repeat last dispatch
      if ((e.ctrlKey || e.metaKey) && e.key === "r" && !inInput) {
        e.preventDefault();
        const last = _loadHistory()[0];
        if (last?.cmd) { setInput(last.cmd); inputRef.current?.focus(); }
      }
      // Phase 147: Ctrl+1..9 = quick-execute macro by index
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        const macros = _loadMacros();
        if (macros[idx]) {
          e.preventDefault();
          setInput(macros[idx].cmd);
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Phase 107: command history navigation with ↑/↓ arrows
  const historyNavRef = React.useRef(-1);
  const handleKey = (e) => {
    if (e.key === "Enter" && e.ctrlKey) { handleDispatch(); return; }
    if (e.key === "ArrowUp" && !e.shiftKey && dispatchHist.length > 0) {
      e.preventDefault();
      const next = Math.min(historyNavRef.current + 1, dispatchHist.length - 1);
      historyNavRef.current = next;
      setInput(dispatchHist[next]?.cmd || "");
    }
    if (e.key === "ArrowDown" && !e.shiftKey) {
      e.preventDefault();
      const next = Math.max(historyNavRef.current - 1, -1);
      historyNavRef.current = next;
      setInput(next >= 0 ? (dispatchHist[next]?.cmd || "") : "");
    }
    if (e.key === "Escape") { setPendingDangerCmd(null); historyNavRef.current = -1; }
  };

  return (
    <div className="op-panel" role="region" aria-label="Workflow control">
      <div className="op-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="op-panel-title">Run</span>
          <span className={`op-readiness-badge ${readinessBadge.cls}`} aria-live="polite">{readinessBadge.label}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {dispatchHist.length > 0 && (
            <button
              className="op-send-btn"
              onClick={() => setShowHistory(h => !h)}
              title="Dispatch history"
              aria-label="Toggle dispatch history"
              style={{ fontSize: 9 }}
            >
              {showHistory ? "▲ hist" : `▼ hist (${dispatchHist.length})`}
            </button>
          )}
                   {savedMacros.length > 0 && (() => {
                     // Phase 333: quality badge in header
                     const qs = qualityScore(savedMacros);
                     const qsColor = qs.label === "good" ? "var(--op-green)" : qs.label === "fair" ? "var(--op-amber)" : "var(--op-red)";
                     return (
                     <button
                       className="op-send-btn"
                       onClick={() => setShowMacroEditor(m => !m)}
                       title={qs.issues.length ? `Quality issues: ${qs.issues.join("; ")}` : "Workflow quality: good"}
                       style={{ fontSize: 9 }}
                     >
                       {showMacroEditor ? "▲ macros" : `▼ macros (${savedMacros.length})`}
                       {qs.label !== "good" && <span style={{ marginLeft: 4, color: qsColor, fontWeight: "bold" }}>Q{qs.score}</span>}
                     </button>
                     );
                   })()}
          <span className="op-panel-meta" style={{ display: "flex", gap: 8 }}>
            <span title="Command History">⌘+H</span>
            <span title="Dispatch Task">⌘+↵</span>
          </span>
        </div>
      </div>

      {completionDigest.length > 0 && (
        <div className="op-workflow-intel">
          <div className="op-workflow-intel-card">
            <div className="op-workflow-intel-title">Today's session</div>
            <div className="op-workflow-intel-grid">
              <div className="op-workflow-intel-stat">
                <div className="op-workflow-intel-value">{sessionStats?.rate ?? "—"}<span className="op-workflow-intel-unit">%</span></div>
                <div className="op-workflow-intel-label">Success rate</div>
              </div>
              <div className="op-workflow-intel-stat">
                <div className="op-workflow-intel-value">{sessionStats?.ok ?? 0}/{sessionStats?.total ?? 0}</div>
                <div className="op-workflow-intel-label">Recent tasks</div>
              </div>
              <div className="op-workflow-intel-stat">
                <div className="op-workflow-intel-value">{recoverySummaries?.length ?? 0}</div>
                <div className="op-workflow-intel-label">Recovery events</div>
              </div>
            </div>
            <div className="op-workflow-timeline" aria-label="Recent workflow execution timeline">
              {completionDigest.map((item, idx) => (
                <div
                  key={idx}
                  className={`op-workflow-timeline-step ${item.ok ? "ok" : "fail"}`}
                  title={`${item.cmd} · ${item.ageMin}m ago`}
                >
                  <span className="op-workflow-timeline-dot" />
                </div>
              ))}
            </div>
          </div>

          <div className="op-workflow-intel-card op-workflow-story-card">
            <div className="op-workflow-intel-title">What ran recently</div>
            <div className="op-workflow-activity-list">
              {completionDigest.slice(0, 3).map((item, idx) => (
                <div key={idx} className="op-workflow-activity-pill">
                  <span className={`op-workflow-activity-icon ${item.ok ? "ok" : "fail"}`}>{item.ok ? "✓" : "✗"}</span>
                  <span className="op-workflow-activity-text">{item.cmd}</span>
                </div>
              ))}
              {!completionDigest.length && (
                <div className="op-workflow-activity-pill empty">Your recent commands will appear here.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* resumable workflow banner — surfaces interrupted workflows on panel load */}
      {resumableWorkflows.length > 0 && !activeWorkflow && (
        <div className="op-wf-resumable">
          <div className="op-wf-resumable-title">
            ↩ Interrupted workflow{resumableWorkflows.length > 1 ? "s" : ""} — resume or discard
          </div>
          {resumableWorkflows.map(cp => {
            const ageMin = Math.round((Date.now() - cp.savedAt) / 60000);
            return (
              <div key={cp.workflowId} className="op-wf-resumable-row">
                <span className={`op-wf-resumable-name ${cp.stale ? "stale" : "fresh"}`}>
                  {cp.label} · {ageMin}m ago{cp.stale ? " · may be stale" : ""}
                </span>
                <button
                  onClick={() => {
                    if (activeWorkflow !== null) return;
                    const data = resumeWfCheckpoint(cp.workflowId);
                    if (data?.remainingSteps?.length) {
                      clearWfCheckpoint(cp.workflowId);
                      executeWorkflow(data.remainingSteps, 0);
                    }
                  }}
                  disabled={activeWorkflow !== null}
                  className="op-bar-btn blue"
                  style={{ opacity: activeWorkflow !== null ? 0.5 : 1, cursor: activeWorkflow !== null ? "not-allowed" : "pointer" }}
                >▶ Resume</button>
                <button onClick={() => clearWfCheckpoint(cp.workflowId)} className="op-bar-btn ghost">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* active goal inference — shown when goal confidence is medium/high */}
      {activeGoal && activeGoal.confidence !== "low" && !focusMode && (
        <div className="op-goal-bar">
          <span className="op-goal-dot">◎</span>
          <span>Goal: <strong style={{ color: "var(--op-text)" }}>{activeGoal.goal}</strong></span>
          {contextShift && <span className="op-goal-shift">· context shifted from {contextShift.from}</span>}
        </div>
      )}

      {/* interrupted intent recovery — surfaces failed command from recent session */}
      {interruptedIntent && !focusMode && (
        <div className="op-intent-bar">
          <span className="op-intent-icon">⚠</span>
          <span className="op-intent-body">
            Interrupted {interruptedIntent.ageMin}m ago:
            <code className="op-intent-cmd">{interruptedIntent.cmd.slice(0, 45)}</code>
          </span>
          <button onClick={() => setInput(interruptedIntent.cmd)} className="op-bar-btn amber">Retry</button>
        </div>
      )}

      {showHistory && dispatchHist.length > 0 && (
        <div className="op-hist-list">
          {dispatchHist.map((h, i) => (
            <div
              key={i}
              onClick={() => { setInput(h.cmd); setShowHistory(false); }}
              title={h.cmd}
              className="op-hist-entry"
            >
              <span className={`op-hist-status ${h.ok ? "ok" : "fail"}`}>{h.ok ? "✓" : "✗"}</span>
              <span className="op-hist-cmd">
                {h.cmd.includes("backup") ? "📦 " : h.cmd.includes("restart") ? "🔄 " : ""}
                {h.cmd}
              </span>
              <span className="op-hist-age">{Math.floor((Date.now() - h.ts) / 60000)}m ago</span>
            </div>
          ))}
        </div>
      )}

     {/* Saved Macros / Quick Workflows */}
     {showMacroEditor && (
       <div style={{
         maxHeight: 200,
         overflowY: "auto",
         borderBottom: "1px solid var(--op-border)",
         background: "rgba(0,0,0,0.15)",
         padding: "6px 8px"
       }}>
         {/* macro search */}
         {savedMacros.length > 3 && (
           <input
             type="text"
             value={macroSearch}
             onChange={e => setMacroSearch(e.target.value)}
             placeholder="Search macros…"
             style={{
               width: "100%", boxSizing: "border-box", marginBottom: 6,
               padding: "3px 7px", fontSize: 9, background: "var(--op-surface2)",
               color: "var(--op-text)", border: "1px solid var(--op-border2)",
               borderRadius: 3, fontFamily: "inherit"
             }}
           />
         )}
         <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
           {savedMacros
             .filter(m => !macroSearch || m.name.toLowerCase().includes(macroSearch.toLowerCase()) || m.cmd.toLowerCase().includes(macroSearch.toLowerCase()))
             .map((macro) => (
             <div key={macro.name} className="op-macro-chip">
               {renamingMacro === macro.name ? (
                 <input
                   autoFocus
                   value={renameValue}
                   onChange={e => setRenameValue(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingMacro(null); }}
                   onBlur={commitRename}
                   style={{ fontSize: 9, padding: '1px 4px', width: 80, background: 'var(--op-surface2)', color: 'var(--op-text)', border: '1px solid var(--op-blue)', borderRadius: 2 }}
                 />
               ) : (
                 <button
                   onClick={() => setInput(macro.cmd)}
                   style={{ background: 'none', border: 'none', color: 'var(--op-blue)', cursor: 'pointer', fontWeight: 'bold', padding: 0 }}
                   title={`Load: ${macro.cmd.slice(0, 40)}…`}
                 >
                   📌 {macro.name}
                 </button>
               )}
               {/* rename button */}
               <button
                 onClick={() => { setRenamingMacro(macro.name); setRenameValue(macro.name); }}
                 style={{ background: 'none', border: 'none', color: 'var(--op-text2)', cursor: 'pointer', padding: 0, opacity: 0.5, fontSize: 8 }}
                 title="Rename macro"
               >✎</button>
               {/* duplicate button */}
               <button
                 onClick={() => duplicateMacro(macro)}
                 style={{ background: 'none', border: 'none', color: 'var(--op-text2)', cursor: 'pointer', padding: 0, opacity: 0.6, fontSize: 8 }}
                 title="Duplicate macro"
               >⧉</button>
               <button
                 onClick={() => deleteMacro(macro.name)}
                 style={{ background: 'none', border: 'none', color: 'var(--op-red)', cursor: 'pointer', padding: 0, opacity: 0.6, fontSize: 8 }}
                 title="Delete macro"
               >✕</button>
             </div>
           ))}
         </div>
         {savedMacros.length > 1 && (() => {
           // Phase 327: compute workflow plan estimate before showing run button
           const plan = planWorkflow(savedMacros.map(m => m.cmd));
           return (
           <div>
             {plan && !activeWorkflow && (
               <div style={{ fontSize: 7, color: "var(--op-text2)", opacity: 0.65, padding: "1px 0 3px", display: "flex", gap: 8 }}>
                 <span>{plan.stepCount} steps</span>
                 <span>est. {plan.estimatedMin}–{plan.estimatedMax}</span>
                 <span style={{ color: plan.complexity === "high" ? "var(--op-amber)" : "var(--op-text2)" }}>
                   {plan.complexity} complexity
                 </span>
               </div>
             )}
             <button
               onClick={() => executeWorkflow(savedMacros)}
               disabled={activeWorkflow !== null}
               style={{
                 width: '100%', padding: '4px 6px', fontSize: 9, fontWeight: 'bold',
                 background: activeWorkflow ? 'rgba(0,0,0,0.2)' : 'rgba(68,162,255,0.2)',
                 border: '1px solid rgba(68,162,255,0.4)', borderRadius: 3,
                 color: 'var(--op-blue)', cursor: activeWorkflow ? 'not-allowed' : 'pointer',
                 opacity: activeWorkflow ? 0.5 : 1
               }}
               title="Execute all macros sequentially"
               aria-label={activeWorkflow ? `Workflow running step ${workflowProgress + 1}` : "Run all macros as workflow"}
             >
               {activeWorkflow ? `⛓ WORKFLOW ${workflowProgress + 1}/${activeWorkflow}` : '⛓ RUN WORKFLOW'}
             </button>
           </div>
           );
         })()}
         {/* batch actions row */}
         {savedMacros.length > 0 && (
           <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
             <button
               onClick={cloneAllMacros}
               style={{ flex: 1, fontSize: 8, padding: '2px 0', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)' }}
               title="Snapshot all macros to localStorage"
             >⊞ Snapshot</button>
             {/* share link export */}
             <button
               onClick={exportMacrosAsLink}
               style={{ flex: 1, fontSize: 8, padding: '2px 0', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)' }}
               title="Copy macros as shareable link"
             >🔗 Share</button>
             {!showBatchConfirm ? (
               <button
                 onClick={() => setShowBatchConfirm(true)}
                 style={{ flex: 1, fontSize: 8, padding: '2px 0', background: 'none', border: '1px solid rgba(255,45,85,0.3)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-red)', opacity: 0.7 }}
                 title="Clear all macros"
               >⊠ Clear all</button>
             ) : (
               <button
                 onClick={clearAllMacros}
                 style={{ flex: 1, fontSize: 8, padding: '2px 0', background: 'rgba(255,45,85,0.15)', border: '1px solid var(--op-red)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-red)', fontWeight: 'bold' }}
               >Confirm clear?</button>
             )}
           </div>
         )}
         {/* template pack install button */}
         <button
           onClick={() => setShowTemplatePacks(t => !t)}
           style={{ width: '100%', marginTop: 5, fontSize: 8, padding: '3px 0', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)' }}
         >{showTemplatePacks ? "▲ Hide Templates" : "▼ Install Template Pack"}</button>
         {showTemplatePacks && (
           <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
             {/* featured section header */}
             {TEMPLATE_PACKS.some(p => p.featured) && (
               <div style={{ fontSize: 7, color: 'var(--op-accent)', opacity: 0.7, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 2px' }}>Featured</div>
             )}
             {TEMPLATE_PACKS.map(pack => {
               // Phase 222: workflow quality score — verified + all macros have timeout + count ≥ 4
               const qs = Math.min(100, Math.round(
                 (pack.verified ? 30 : 0) +
                 (pack.macros.length >= 4 ? 30 : pack.macros.length * 7) +
                 (pack.macros.every(m => m.timeout) ? 20 : 0) +
                 (pack.featured ? 20 : 0)
               ));
               const qsColor = qs >= 80 ? 'var(--op-green)' : qs >= 55 ? 'var(--op-amber)' : 'var(--op-text2)';
               return (
               <div key={pack.id} style={{
                 display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                 border: `1px solid ${pack.featured ? 'rgba(0,210,255,0.25)' : 'var(--op-border2)'}`,
                 borderRadius: 3, background: pack.featured ? 'rgba(0,210,255,0.04)' : 'rgba(255,255,255,0.02)'
               }}>
                 <span style={{ fontSize: 13 }}>{pack.icon}</span>
                 <div style={{ flex: 1, minWidth: 0 }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                     <span style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--op-text)' }}>{pack.label}</span>
                     {pack.verified && <span style={{ fontSize: 7, color: 'var(--op-green)', opacity: 0.8, border: '1px solid rgba(0,255,163,0.25)', borderRadius: 2, padding: '0 3px' }}>✓ verified</span>}
                     {/* quality score badge */}
                     <span style={{ fontSize: 7, color: qsColor, opacity: 0.8, marginLeft: 1 }} title="Workflow quality score">Q{qs}</span>
                   </div>
                   <div style={{ fontSize: 8, color: 'var(--op-text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pack.desc} — {pack.macros.length} macros</div>
                 </div>
                 <button
                   onClick={() => installTemplatePack(pack)}
                   style={{ fontSize: 8, padding: '2px 7px', background: 'var(--op-accent)', color: '#06080a', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 'bold', flexShrink: 0 }}
                 >Install</button>
               </div>
               );
             })}
           </div>
         )}
         {/* import preview with confidence indicator */}
         {importPreview && (
           <div style={{ marginTop: 5, padding: '6px 8px', background: 'rgba(0,210,255,0.06)', border: '1px solid rgba(0,210,255,0.25)', borderRadius: 4 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
               <span style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--op-accent)' }}>Import Preview — {importPreview.macros.length} macro(s)</span>
               {/* import confidence indicator */}
               <span style={{ fontSize: 7, color: 'var(--op-green)', border: '1px solid rgba(0,255,163,0.25)', borderRadius: 2, padding: '0 3px' }}>
                 {importPreview.macros.every(m => m.name && m.cmd) ? '✓ valid' : '⚠ partial'}
               </span>
             </div>
             <div style={{ fontSize: 8, color: 'var(--op-text2)', opacity: 0.6, marginBottom: 3 }}>Source: {importPreview.source}</div>
             {importPreview.macros.slice(0, 4).map((m, i) => (
               <div key={i} style={{ fontSize: 8, color: 'var(--op-text2)', padding: '1px 0', borderTop: i > 0 ? '1px solid var(--op-border)' : 'none' }}>{m.name}: <span style={{ opacity: 0.7 }}>{m.cmd?.slice(0, 40)}</span></div>
             ))}
             {importPreview.macros.length > 4 && <div style={{ fontSize: 8, color: 'var(--op-text2)', opacity: 0.6 }}>…and {importPreview.macros.length - 4} more</div>}
             <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
               <button onClick={confirmImportPreview} style={{ flex: 1, fontSize: 8, padding: '3px 0', background: 'var(--op-accent)', color: '#06080a', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 'bold' }}>✓ Import</button>
               <button onClick={() => setImportPreview(null)} style={{ flex: 1, fontSize: 8, padding: '3px 0', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)' }}>Cancel</button>
             </div>
           </div>
         )}
       </div>
     )}

      <div className="op-workflow-body">
        <div>
          <div className="op-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            What do you want to do?
            {/* cross-tool source label — fades after 4s */}
            {lastExternalSource && (
              <span style={{ fontSize: 7, color: "var(--op-accent)", opacity: 0.7, fontWeight: "normal" }}>
                ← from {lastExternalSource}
              </span>
            )}
          </div>
          <textarea
            ref={inputRef}
            className={`op-text-input ${isDangerous ? "dangerous-input" : ""}`}
            style={isDangerous ? { borderColor: "var(--op-amber)", background: "rgba(255, 179, 0, 0.05)" } : {}}
            rows={2}
            value={input}
            onChange={e => {
              const val = e.target.value;
              if (val.startsWith("jarvis://macros/") && parseShareLink(val)) { setInput(""); return; }
              setInput(val);
              recordHesitationStart(val.length);
              assistantAnalyze(val); // Phase 243: explain command as operator types
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKey}
            placeholder="Type a command, question, or task — Ooplix will handle it…"
            disabled={busy}
            aria-label="Command or task input"
            aria-describedby="cmd-risk-hint"
          />
          {isDangerous && (
            <div style={{
              position: "absolute",
              right: 8,
              top: 32,
              fontSize: 10,
              color: "var(--op-red)",
              fontWeight: "bold",
              background: "rgba(0,0,0,0.6)",
              padding: "2px 6px",
              borderRadius: 2,
              border: "1px solid var(--op-red)"
            }}>
              🚨 DANGER
            </div>
          )}
          {/* inline repo path suggestions — surfaces when input contains a path-like token */}
          {(() => {
            if (!repoSearch || !debouncedInput.trim()) return null;
            const tokens = debouncedInput.trim().split(/\s+/);
            const pathToken = tokens.find(t => /[./]/.test(t) && !t.startsWith("-") && t.length > 3 && !t.startsWith("http"));
            if (!pathToken) return null;
            const suggestions = repoSearch(pathToken).slice(0, 4);
            if (!suggestions.length) return null;
            return (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(prev => prev.replace(pathToken, s.path))}
                    title={s.desc || s.path}
                    style={{
                      fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                      background: "rgba(255,193,7,0.08)", border: "1px solid rgba(255,193,7,0.2)",
                      color: "var(--op-amber)", fontFamily: "monospace", maxWidth: 200,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }}
                  >
                    📄 {s.path}
                  </button>
                ))}
              </div>
            );
          })()}
          {cmdAnalysis && (
            <div className="op-cmd-analysis-row">
              <div className="op-cmd-type-badge" style={{ color: cmdAnalysis.typeColor }}>
                <span>{cmdAnalysis.typeIcon} {cmdAnalysis.typeLabel} Mode</span>
              </div>
              <div className="op-cmd-risk-badge" style={{ color: cmdAnalysis.risk.color }}>
                Risk: {cmdAnalysis.risk.label}
              </div>
            </div>
          )}
          {cmdAnalysis?.risk.level > 1 && (
            <div className="op-impact-block" style={{ color: cmdAnalysis.risk.color }}>
              <div className="op-impact-title">
                {isDangerous ? "⚠️ CRITICAL IMPACT WARNING" : "⚡ OPERATIONAL IMPACT"}
              </div>
              <div className="op-impact-backup">
                {lastBackup !== null
                  ? `📦 Reversibility: Last safe backup verified ${lastBackup}m ago.`
                  : "🚨 No recent backup found. This action may be irreversible."}
              </div>
            </div>
          )}
          {/* security warnings — secret leak, force flags, sudo escalation */}
          {cmdAnalysis?.securityWarnings?.length > 0 && (
            <div className="op-security-warnings">
              {cmdAnalysis.securityWarnings.map((w, i) => (
                <div key={i} className="op-security-warn-line">🔒 {w}</div>
              ))}
            </div>
          )}
        </div>

        <div className="op-toolbar-row">
          <div className="op-toolbar-field">
            <div className="op-field-label" style={{ marginBottom: 0 }}>Priority:</div>
            <select
              className="op-select"
              style={{ padding: "2px 4px", fontSize: "10px" }}
              value={priority}
              onChange={e => setPriority(e.target.value)}
            >
              <option value="0">High (0)</option>
              <option value="1">Normal (1)</option>
              <option value="2">Low (2)</option>
            </select>
          </div>
          <div className="op-toolbar-field">
            <div className="op-field-label" style={{ marginBottom: 0 }}>Timeout(s):</div>
            <input
              className="op-text-input"
              type="number"
              min={5}
              max={300}
              value={timeout}
              onChange={e => setTimeout_(e.target.value)}
              style={{ width: "50px", padding: "2px 4px", fontSize: "10px", boxSizing: "border-box" }}
            />
            <button
              className="op-save-macro-btn"
              onClick={() => setShowMacroEditor(true)}
              title="Save current command as reusable macro"
            >
              💾 SAVE MACRO
            </button>
          </div>
        </div>

       {/* Macro Save Dialog */}
       {showMacroEditor && (
         <div style={{
           padding: "6px 8px",
           background: "rgba(68,162,255,0.08)",
           borderBottom: "1px solid var(--op-border)",
           display: 'flex',
           gap: 4,
           alignItems: 'center'
         }}>
           <input
             type="text"
             placeholder="Macro name (e.g., 'daily-backup')"
             value={macroName}
             onChange={e => setMacroName(e.target.value)}
             style={{
               flex: 1,
               padding: '3px 6px',
               fontSize: 9,
               borderRadius: 3,
               border: '1px solid rgba(68,162,255,0.3)',
               background: 'rgba(0,0,0,0.2)',
               color: 'var(--op-text)'
             }}
             onKeyDown={(e) => {
               if (e.key === 'Enter') saveMacro();
             }}
           />
           <button
             onClick={saveMacro}
             disabled={!macroName.trim() || !input.trim()}
             style={{
               padding: '3px 8px',
               fontSize: 9,
               fontWeight: 'bold',
               background: 'var(--op-blue)',
               color: 'white',
               border: 'none',
               borderRadius: 3,
               cursor: 'pointer',
               opacity: macroName.trim() && input.trim() ? 1 : 0.5
             }}
           >
             ✓ Save
           </button>
           <button
             onClick={() => setShowMacroEditor(false)}
             style={{
               padding: '3px 6px',
               fontSize: 9,
               background: 'rgba(0,0,0,0.2)',
               border: '1px solid var(--op-border)',
               borderRadius: 3,
               cursor: 'pointer'
             }}
           >
             ✕
           </button>
         </div>
       )}

        {/* non-essential sections hidden during focus mode */}
        {!focusMode && (
        <>
        <div className="op-field-label" style={{ marginBottom: 4, opacity: 0.7, fontSize: 8 }}>Filesystem Actions</div>
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[
              { label: "📄 Read File", cmd: () => {
                const path = window.prompt('Enter file path to read');
                return path ? `cat ${path}` : '';
              } },
              { label: "🆕 Create File", cmd: () => {
                const path = window.prompt('Enter new file path');
                const content = window.prompt('Enter initial content (optional)');
                return path ? `echo "${content ?? ''}" > ${path}` : '';
              } },
              { label: "✏️ Patch File", cmd: () => {
                const path = window.prompt('Enter file path to patch');
                const patch = window.prompt('Enter sed pattern (e.g., s/old/new/g)');
                return path && patch ? `sed -i '' '${patch}' ${path}` : '';
              } },
              { label: "📂 List Dir", cmd: () => {
                const dir = window.prompt('Enter directory to list') || '.';
                return `ls -la ${dir}`;
              } }
            ].map(qa => (
              <button
                key={qa.label}
                className="op-btn secondary"
                style={{ padding: "2px 6px", fontSize: "9px", flex: "1 1 auto", minWidth: "60px" }}
                onClick={() => { const generated = qa.cmd(); if (generated) setInput(generated); }}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>
        </>
        )}
        {!focusMode && (
        <>
        <div className="op-field-label" style={{ marginBottom: 4, opacity: 0.7, fontSize: 8 }}>Operational Templates</div>
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[
              { label: "📦 Backup", cmd: "node scripts/safe-backup.cjs", color: "var(--op-blue)" },
              { label: "⚖️ Audit",  cmd: "node scripts/check-persistence-divergence.cjs", color: "var(--op-blue)" },
              { label: "🔄 Reboot", cmd: "pm2 restart all", color: "var(--op-red)" },
              { label: "🧹 Clean",  cmd: "node -e \"require('./agents/taskQueue.cjs').pruneOldTasks()\"", color: "var(--op-amber)" }
            ].map(qa => (
              <button
                key={qa.label}
                className="op-btn secondary"
                style={{ padding: "2px 6px", fontSize: "9px", flex: "1 1 auto", minWidth: "60px", borderLeft: `2px solid ${qa.color}` }}
                onClick={() => { setInput(qa.cmd); }}
              >
                {qa.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
             {[
              { label: "📡 Status", cmd: "pm2 list", color: "var(--op-text2)" },
              { label: "📜 Logs",   cmd: "pm2 logs --lines 20 --noprefix", color: "var(--op-text2)" },
              { label: "🏗️ Build",  cmd: "npm run build", color: "var(--op-purple)" },
              { label: "🏥 Health", cmd: "node -e \"console.log(JSON.stringify(require('./agents/taskQueue.cjs').getHealthReport(), null, 2))\"", color: "var(--op-green)" }
            ].map(qa => (
              <button
                key={qa.label}
                className="op-btn secondary"
                style={{ padding: "2px 6px", fontSize: "9px", flex: "1 1 auto", minWidth: "60px", borderLeft: `2px solid ${qa.color}` }}
                onClick={() => { setInput(qa.cmd); }}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>
        </>
        )}

        {/* rollback confidence badge + stale macro warning */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span className={`op-rollback-badge ${rollbackConfidence.cls}`} title="Rollback readiness based on last backup age">
            ⏪ {rollbackConfidence.label}
          </span>
          {staleMacroNames.length > 0 && (
            <span style={{ fontSize: 8, color: "var(--op-text2)", opacity: 0.7 }}
              title={`Stale: ${staleMacroNames.join(", ")}`}>
              ⚠ {staleMacroNames.length} stale macro{staleMacroNames.length > 1 ? "s" : ""}
            </span>
          )}
          {/* unstable workflow indicator */}
          {unstableWorkflows.length > 0 && (
            <span style={{ fontSize: 8, color: "var(--op-amber)", opacity: 0.8 }}
              title={unstableWorkflows.map(w => `${w.label} — ${w.failRate}% fail rate`).join("\n")}>
              ⚡ {unstableWorkflows.length} unreliable workflow{unstableWorkflows.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* contextual hint — suppressed when overload advisory is active (critical > informational) */}
        {contextualHint && !(overloadState?.level === "high") && (
          <div className="op-contextual-hint" style={{
            borderLeftColor: contextualHint.type === "warn" ? "rgba(255,193,7,0.5)" :
                             contextualHint.type === "tip"  ? "rgba(0,255,163,0.35)" :
                             "rgba(0,210,255,0.3)"
          }}>
            {contextualHint.type === "warn" ? "⚠ " : contextualHint.type === "tip" ? "💡 " : "ℹ "}
            {contextualHint.text}
          </div>
        )}

        {/* memory-based suggestions — shown only when no acceleration chips visible */}
        {!input.trim() && !busy && memoryPatterns.length > 0 && !flowAcceleration?.frequentPairs?.length && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "2px 0" }}>
            {memoryPatterns.slice(0, 4).map((p, i) => (
              <button
                key={i}
                onClick={() => setInput(p.cmd)}
                title={`Used ${p.count}× — click to load`}
                style={{
                  fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                  background: "rgba(68,162,255,0.08)", border: "1px solid rgba(68,162,255,0.2)",
                  color: "var(--op-text2)", fontFamily: "inherit", maxWidth: 160,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}
              >
                ↩ {p.label} <span style={{ opacity: 0.5 }}>×{p.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* predictive workflow continuation — graph-inferred next steps */}
        {!input.trim() && !busy && workflowContinuation.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "2px 0" }}>
            {workflowContinuation.map((c, i) => (
              <button
                key={i}
                onClick={() => setInput(c.cmd)}
                title={`Continue workflow — observed ${Math.round(c.score)} times after your last command`}
                style={{
                  fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                  background: "rgba(0,210,255,0.07)", border: "1px solid rgba(0,210,255,0.2)",
                  color: "var(--op-accent)", fontFamily: "inherit",
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}
              >
                → {c.label}
              </button>
            ))}
          </div>
        )}

        {/* incomplete sequence detector — suppressed if suggestion was recently run */}
        {!input.trim() && !busy && incompleteSequence && !_recentCmds.includes(incompleteSequence.suggestion) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: 8 }}>
            <span style={{ color: "var(--op-amber)", opacity: 0.8 }}>↻ Incomplete sequence:</span>
            <button
              onClick={() => setInput(incompleteSequence.suggestion)}
              style={{
                fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                background: "rgba(255,193,7,0.09)", border: "1px solid rgba(255,193,7,0.25)",
                color: "var(--op-amber)", fontFamily: "inherit"
              }}
            >{incompleteSequence.suggestion}</button>
          </div>
        )}

        {/* workflow acceleration — frequent sequential pairs, suggested as one-click workflow */}
        {!input.trim() && !busy && flowAcceleration?.frequentPairs?.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "2px 0" }}>
            {flowAcceleration.frequentPairs.slice(0, 2).map((pair, i) => (
              <button
                key={i}
                onClick={() => setInput(pair.combined)}
                title={`Frequently run together (${pair.count}×) — click to load as combined command`}
                style={{
                  fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                  background: "rgba(160,100,255,0.07)", border: "1px solid rgba(160,100,255,0.2)",
                  color: "var(--op-purple, #a064ff)", fontFamily: "inherit",
                  maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}
              >
                ⚡ {pair.cmdA.slice(0, 18)}… + {pair.cmdB.slice(0, 18)} <span style={{ opacity: 0.5 }}>×{pair.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* adaptive shortcut hint — only when no contextual hint active */}
        {!contextualHint && adaptiveShortcut && (
          <div style={{ fontSize: 8, color: "var(--op-text2)", opacity: 0.5, padding: "1px 0", display: "flex", alignItems: "center", gap: 4 }}>
            <kbd style={{ fontFamily: "inherit", fontSize: 8, background: "rgba(255,255,255,0.06)", border: "1px solid var(--op-border2)", borderRadius: 2, padding: "0 3px" }}>{adaptiveShortcut.key}</kbd>
            <span>{adaptiveShortcut.action}</span>
          </div>
        )}

        {/* execution certainty indicator */}
        {executionCertainty && (
          <div style={{ fontSize: 9, color: executionCertainty.color, padding: "2px 0", opacity: 0.85 }}
            aria-live="polite"
          >
            {executionCertainty.text}
          </div>
        )}

        {/* AI workflow assistant — suppress for obvious read-only commands and generic fallback */}
        {assistantExplanation && input.trim() && !intentInfo?.isInformational
          && assistantExplanation !== "Shell command. Review carefully before dispatching to production." && (
          <div style={{ fontSize: 8, color: "var(--op-text2)", padding: "2px 0", opacity: 0.8, lineHeight: 1.5 }}>
            ℹ {assistantExplanation}
          </div>
        )}
        {/* consequence explanation — critical/warn severity only */}
        {assistantConsequences && assistantConsequences.severity !== "safe" && input.trim() && (
          <div style={{
            fontSize: 8, padding: "2px 6px", borderRadius: 3,
            background: assistantConsequences.severity === "critical" ? "rgba(255,45,85,0.08)" : "rgba(255,193,7,0.07)",
            border: `1px solid ${assistantConsequences.severity === "critical" ? "rgba(255,45,85,0.25)" : "rgba(255,193,7,0.2)"}`,
            color: assistantConsequences.severity === "critical" ? "var(--op-red)" : "var(--op-amber)",
          }}>
            {assistantConsequences.severity === "critical" ? "⚠ " : "ℹ "}{assistantConsequences.msg}
          </div>
        )}

        {/* informational command badge — calms operator for read-only commands */}
        {intentInfo?.isInformational && input.trim() && (
          <div style={{ fontSize: 8, color: "var(--op-green)", opacity: 0.75, padding: "1px 0" }}>
            ✓ Read-only — no system state will change
          </div>
        )}

        {/* workflow reasoning — intent, dependency hints, draft generation */}
        {/* suppress goal row when assistant explanation is already shown (avoids duplication) */}
        {intentInfo && input.trim() && intentInfo.intent !== "general" && !assistantExplanation && (
          <div style={{ fontSize: 8, color: "var(--op-accent)", opacity: 0.75, padding: "1px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>✦ Goal: {intentInfo.goal}</span>
            {dependencies.length > 0 && (
              <span style={{ color: "var(--op-text2)" }}>
                depends on: {dependencies.map(d => d.cmd).join(" → ")}
              </span>
            )}
            {/* generate full workflow draft for this intent */}
            <button
              onClick={() => {
                const draft = generateDraft(intentInfo.intent);
                if (draft) {
                  const existing = _loadMacros();
                  // Don't duplicate — only add macros not already present
                  const newMacros = draft.macros.filter(m => !existing.find(e => e.cmd === m.cmd));
                  if (newMacros.length) {
                    _saveMacros([...existing, ...newMacros].slice(0, MACROS_MAX));
                    setSavedMacros(_loadMacros());
                    addNotification?.(`Generated ${newMacros.length} workflow steps for "${intentInfo.intent}"`, "ok");
                  } else {
                    addNotification?.("Workflow steps already exist for this intent", "info");
                  }
                }
              }}
              style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer", background: "rgba(160,100,255,0.1)", border: "1px solid rgba(160,100,255,0.25)", color: "var(--op-purple, #a064ff)", fontFamily: "inherit" }}
            >✦ Generate workflow</button>
          </div>
        )}

        {/* safer variant suggestion */}
        {assistantSafer && (
          <div style={{ fontSize: 8, color: "var(--op-amber)", padding: "2px 0", display: "flex", gap: 6, alignItems: "baseline" }}>
            <span>💡 Safer:</span>
            <button
              onClick={() => setInput(assistantSafer.safer)}
              style={{ fontSize: 8, background: "none", border: "none", cursor: "pointer", color: "var(--op-accent)", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}
            >{assistantSafer.safer}</button>
            <span style={{ opacity: 0.6 }}>— {assistantSafer.reason}</span>
          </div>
        )}
        {/* recovery suggestions + grouped diagnostic summary after failure */}
        {assistantRecovery.length > 0 && (
          <div style={{ padding: "4px 6px", background: "rgba(255,193,7,0.06)", border: "1px solid rgba(255,193,7,0.2)", borderRadius: 3, fontSize: 8 }}>
            <div style={{ color: "var(--op-amber)", fontWeight: "bold", marginBottom: 2 }}>Recovery suggestions</div>
            {assistantRecovery.map((s, i) => <div key={i} style={{ color: "var(--op-text2)", padding: "1px 0" }}>• {s}</div>)}
          </div>
        )}
        {/* ranked root-cause diagnostics — shown after a failed dispatch */}
        {result && !result.ok && (() => {
          const failText = result.text || "";
          const causes = [];
          if (/can't reach|econnrefused|network/i.test(failText))
            causes.push({ rank: 1, cause: "Backend not running", fix: "pm2 list — check if jarvis-backend is active" });
          if (/permission|eacces/i.test(failText))
            causes.push({ rank: 2, cause: "Insufficient permissions", fix: "Check file ownership or try with sudo" });
          if (/timeout|timed out/i.test(failText))
            causes.push({ rank: 1, cause: "Command timed out", fix: "Increase the Timeout(s) value or reduce workload" });
          if (/not found|enoent/i.test(failText))
            causes.push({ rank: 2, cause: "Missing file or command", fix: "Check the path or run npm install" });
          if (/syntax|unexpected token/i.test(failText))
            causes.push({ rank: 1, cause: "Syntax error", fix: "Check for typos or unmatched quotes" });
          if (/401|unauthorized/i.test(failText))
            causes.push({ rank: 1, cause: "Session expired", fix: "Refresh the page and log in again" });
          if (/heap|enomem|out of memory/i.test(failText))
            causes.push({ rank: 1, cause: "Out of memory", fix: "pm2 restart jarvis-backend" });
          // Phase 314: dependency failure detection
          if (/cannot find module|module not found/i.test(failText))
            causes.push({ rank: 1, cause: "Missing dependency", fix: "Run npm install to restore node_modules" });
          if (/eslint|jest|webpack.*not found/i.test(failText))
            causes.push({ rank: 1, cause: "Dev tool missing", fix: "Run npm install — dev dependencies may be missing" });
          if (causes.length === 0) return null;
          causes.sort((a, b) => a.rank - b.rank);
          return (
            <div style={{ padding: "4px 6px", background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.2)", borderRadius: 3, fontSize: 8, marginTop: 2 }}>
              <div style={{ color: "var(--op-red)", fontWeight: "bold", marginBottom: 3 }}>Probable cause{causes.length > 1 ? "s" : ""}</div>
              {causes.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 5, padding: "1px 0", borderTop: i > 0 ? "1px solid rgba(255,45,85,0.1)" : "none" }}>
                  <span style={{ color: "var(--op-red)", opacity: 0.7, flexShrink: 0 }}>#{i + 1}</span>
                  <div>
                    <span style={{ color: "var(--op-text)", fontWeight: "bold" }}>{c.cause}</span>
                    <span style={{ color: "var(--op-text2)", opacity: 0.7 }}> — {c.fix}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* workflow reliability — suppressed when executionTrust already covers it (priority: actionable > informational) */}
        {workflowReliability && (workflowReliability.rate < 90 || workflowReliability.retryRisk !== "low") && !executionTrust && (
          <div style={{ fontSize: 8, color: workflowReliability.color, opacity: 0.75, display: "flex", gap: 6, alignItems: "center" }}>
            <span title={`${workflowReliability.runs} runs in history`}>
              Reliability: {workflowReliability.rate}%
            </span>
            {workflowReliability.retryRisk !== "low" && (
              <span style={{ opacity: 0.7 }}>· retry risk {workflowReliability.retryRisk}</span>
            )}
            {workflowReliability.lastRun && (
              <span style={{ opacity: 0.5 }}>· last ran {workflowReliability.lastRun}</span>
            )}
          </div>
        )}

        {/* operator overload advisory — shown when dispatch rate + failure rate signal stress */}
        {overloadState && overloadState.level === "high" && (
          <div style={{
            padding: "3px 7px", borderRadius: 3, fontSize: 8, marginBottom: 2,
            background: "rgba(255,193,7,0.07)", border: "1px solid rgba(255,193,7,0.2)",
            color: "var(--op-amber)"
          }}>
            ⚡ {overloadState.msg}
          </div>
        )}

        {/* patch preview confidence — surfaces target file, risk, and backup status for edit commands */}
        {(() => {
          const cmd = debouncedInput.trim();
          if (!cmd) return null;
          const isPatch = /\bsed\b|\bpatch\b|>\s*\S+\.(js|ts|json|cjs|mjs|md|yaml|yml|sh|env)|echo\s.+>|tee\s+\S+\.\w+/.test(cmd);
          if (!isPatch) return null;
          // Extract target file from common patterns
          let targetFile = null;
          const sedMatch = cmd.match(/sed -i[^ ]* '[^']+' ([^\s]+)/);
          const redirectMatch = cmd.match(/>\s*([^\s;|]+)/);
          const teeMatch = cmd.match(/\btee\s+([^\s;|]+)/);
          const patchMatch = cmd.match(/\bpatch\s+([^\s]+)/);
          if (sedMatch)      targetFile = sedMatch[1];
          else if (teeMatch) targetFile = teeMatch[1];
          else if (patchMatch) targetFile = patchMatch[1];
          else if (redirectMatch) targetFile = redirectMatch[1];

          const hasBackup = lastBackup !== null && lastBackup < 120;
          const isDestructive = cmd.includes("> ") && !cmd.includes(">>"); // overwrite vs append
          const confidence = hasBackup ? (isDestructive ? "medium" : "high") : "low";
          const confColor = confidence === "high" ? "var(--op-green)" : confidence === "medium" ? "var(--op-amber)" : "var(--op-red)";

          return (
            <div style={{
              padding: "5px 8px", borderRadius: 3, fontSize: 9, marginBottom: 2,
              background: "rgba(68,162,255,0.05)", border: "1px solid rgba(68,162,255,0.2)",
              display: "flex", flexDirection: "column", gap: 3
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: "bold", color: "var(--op-blue)" }}>✎ PATCH PREVIEW</span>
                <span style={{ color: confColor, fontWeight: "bold", fontSize: 8 }}>{confidence.toUpperCase()} CONFIDENCE</span>
                {isDestructive && <span style={{ color: "var(--op-red)", fontSize: 8, fontWeight: "bold" }}>OVERWRITES</span>}
                {!isDestructive && cmd.includes(">>") && <span style={{ color: "var(--op-green)", fontSize: 8 }}>APPENDS</span>}
              </div>
              {targetFile && (() => {
                // Phase 814: dependency-aware critical file detection
                const CRITICAL = [
                  "backend/server.js", "backend/routes/index.js", "backend/routes/runtime.js",
                  "agents/runtime/runtimeOrchestrator.cjs", "agents/runtime/executionEngine.cjs",
                  "agents/runtime/bootstrapRuntime.cjs", "backend/db/sqlite.cjs",
                  "ecosystem.config.cjs", ".env",
                ];
                const isCritical = CRITICAL.some(cf => targetFile.endsWith(cf) || targetFile.includes(cf));
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ color: "var(--op-text2)", fontFamily: "monospace", fontSize: 8 }}>
                      Target: <span style={{ color: isCritical ? "var(--op-red)" : "var(--op-text)", fontWeight: isCritical ? "bold" : "normal" }}>{targetFile}</span>
                      {isCritical && <span style={{ marginLeft: 6, color: "var(--op-red)", fontSize: 7, fontWeight: "bold" }}>CRITICAL FILE — backend may restart</span>}
                    </div>
                  </div>
                );
              })()}
              <div style={{ color: hasBackup ? "var(--op-green)" : "var(--op-amber)", fontSize: 8 }}>
                {hasBackup
                  ? `✓ Backup available (${lastBackup}m ago) — rollback possible`
                  : "⚠ No recent backup — consider running a backup before patching"}
              </div>
            </div>
          );
        })()}

        {/* execution trust overlay — rollback likelihood + execution safety label */}
        {executionTrust && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "2px 0", fontSize: 8,
            borderTop: "1px solid var(--op-border)", paddingTop: 4, marginTop: 2,
            opacity: executionTrust.degraded ? 0.65 : 1,
          }}>
            <span style={{ color: executionTrust.rbColor, fontWeight: "bold" }}
              title={executionTrust.rollback.basis === "history"
                ? `Rollback risk based on ${executionTrust.rollback.runs} historical run${executionTrust.rollback.runs !== 1 ? "s" : ""}`
                : "Rollback risk estimated from command pattern — no run history yet"}
            >
              ⏪ {executionTrust.rollback.probability}% rollback risk
            </span>
            <span style={{ color: "var(--op-border)", opacity: 0.5 }}>·</span>
            <span style={{ color: executionTrust.riskScore.color, fontWeight: "bold" }}>
              {executionTrust.safetyLabel}
            </span>
            {/* show data basis — history vs pattern — for transparency */}
            {executionTrust.rollback.basis === "history" ? (
              <span style={{ color: "var(--op-text2)", opacity: 0.55, marginLeft: "auto" }}>
                {executionTrust.rollback.runs} run{executionTrust.rollback.runs !== 1 ? "s" : ""} observed
              </span>
            ) : (
              <span style={{ color: "var(--op-text2)", opacity: 0.45, marginLeft: "auto" }}>
                pattern est.
              </span>
            )}
            {/* degraded-runtime notice — soften trust confidence under operator overload */}
            {executionTrust.degraded && (
              <span style={{ color: "var(--op-amber)", opacity: 0.75, marginLeft: 4 }}>
                · runtime stressed
              </span>
            )}
          </div>
        )}

        <div className="op-btn-row">
          <button
            className={`op-btn ${isDangerous ? "danger" : "primary"}`}
            onClick={dispatchDebounced}
            disabled={!input.trim() || busy}
            title="Synchronous dispatch — waits for result"
            aria-label={busy ? "Dispatching…" : isDangerous ? "Dispatch dangerous command" : "Dispatch command"}
          >
            {busy ? `Running… ${elapsed}s` : isDangerous ? "⚡ Run (careful)" : "⚡ Run"}
          </button>
          <button
            className="op-btn secondary"
            onClick={handleQueue}
            disabled={!input.trim() || busy}
            title="Add to queue and continue"
            aria-label="Add to queue"
          >
            {busy ? "…" : "Add to Queue"}
          </button>
          {/* dry-run toggle */}
          <button
            className={`op-btn secondary`}
            onClick={() => setDryRun(d => !d)}
            title="Dry-run mode: preview without executing"
            style={{
              fontSize: 9, borderColor: dryRun ? "var(--op-amber)" : undefined,
              color: dryRun ? "var(--op-amber)" : undefined,
              background: dryRun ? "rgba(255,193,7,0.08)" : undefined
            }}
          >
            {dryRun ? "🔬 DRY RUN ON" : "🔬 Dry Run"}
          </button>
        </div>

        {/* Dangerous dispatch confirmation gate */}
        {/* calmer dangerous-command confirmation language */}
        {pendingDangerCmd && (
          <div style={{
            padding: "8px 10px", background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.3)",
            borderRadius: 4, marginTop: 4, fontSize: 10
          }}>
            <div style={{ color: "var(--op-amber)", fontWeight: "bold", marginBottom: 4 }}>
              ⚠ This command can't be undone — are you sure?
            </div>
            <div style={{ color: "var(--op-text2)", wordBreak: "break-all", marginBottom: 6, fontSize: 9 }}>
              {pendingDangerCmd.slice(0, 120)}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="op-btn danger"
                style={{ padding: "3px 10px", fontSize: 10 }}
                onClick={() => { const c = pendingDangerCmd; setPendingDangerCmd(null); handleDispatch(c); }}
              >Yes, run it</button>
              <button
                className="op-btn secondary"
                style={{ padding: "3px 10px", fontSize: 10 }}
                onClick={() => setPendingDangerCmd(null)}
              >Cancel</button>
            </div>
          </div>
        )}

        {result && (
          <div className={`op-result-box ${result.ok ? "ok" : "err"}`} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
            <span style={{ flex: 1 }}>
              {result.ok ? "✓ " : (() => {
                // Phase 325: severity-aware failure label — avoids panic for transient errors
                const cls = classifyResultFailure(result.text);
                return cls.calm ? "~ " : "✗ ";
              })()}
              {result.text}
            </span>
            <button
              onClick={() => setResult(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 2px", fontSize: 12, lineHeight: 1, opacity: 0.7 }}
              title="Dismiss"
              aria-label="Dismiss result"
            >×</button>
          </div>
        )}

        {/* Patch approval gate — shown when devAgent proposes a patch */}
        {pendingPatch && (
          <PatchApprovalPanel
            patchId={pendingPatch.patchId}
            targetFile={pendingPatch.targetFile}
            addNotification={addNotification}
            onDone={(outcome) => {
              setPendingPatch(null);
              if (outcome === "applied") {
                showResult(true, `Patch applied to ${pendingPatch.targetFile || "file"}`);
              } else if (outcome === "rejected") {
                showResult(false, "Patch rejected.");
              }
            }}
          />
        )}

        {/* completion summary digest — improved readability */}
        {lastCompletion && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "3px 8px", borderRadius: 3, fontSize: 9,
            background: lastCompletion.ok ? "rgba(0,255,163,0.06)" : "rgba(255,45,85,0.06)",
            border: `1px solid ${lastCompletion.ok ? "rgba(0,255,163,0.2)" : "rgba(255,45,85,0.2)"}`,
            color: lastCompletion.ok ? "var(--op-green)" : "var(--op-red)",
            animation: "op-row-fadein 0.2s ease-out"
          }}
            role="status"
            aria-live="polite"
          >
            <span>{lastCompletion.ok ? "✓ Done" : "✗ Failed"}</span>
            <span style={{ flex: 1, color: "var(--op-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastCompletion.cmd}</span>
            <span style={{ color: "var(--op-text2)", flexShrink: 0 }}>
              {lastCompletion.durationMs < 1000
                ? `${lastCompletion.durationMs}ms`
                : `${Math.round(lastCompletion.durationMs / 1000)}s`}
            </span>
            <button onClick={() => setLastCompletion(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 11, padding: "0 2px", opacity: 0.5 }} aria-label="Dismiss">×</button>
          </div>
        )}

        {/* chain execution trace — compact, readable step log */}
        {chainLog.length > 0 && !chainRunning && (
          <div style={{ marginTop: 4, border: "1px solid var(--op-border)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ fontSize: 7, color: "var(--op-text2)", padding: "2px 6px", background: "rgba(0,0,0,0.15)", display: "flex", justifyContent: "space-between" }}>
              <span>Chain trace — {chainLog.length} step{chainLog.length !== 1 ? "s" : ""}</span>
              <button onClick={clearChainLog} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 10, padding: 0, opacity: 0.5 }}>×</button>
            </div>
            {chainLog.slice(-8).map((entry, i) => (
              <div
                key={i}
                className={`op-chain-log-entry ${entry.result?.ok ? "ok" : entry.fallbackUsed ? "fallback" : "fail"}`}
              >
                <span style={{ flexShrink: 0, width: 14 }}>{entry.result?.ok ? "✓" : entry.fallbackUsed ? "↪" : "✗"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.85 }}>
                  {(entry.step?.label || entry.step?.cmd || "step").slice(0, 55)}
                </span>
                {entry.fallbackUsed && <span style={{ fontSize: 7, opacity: 0.6, flexShrink: 0 }}>fallback</span>}
                {entry.attempts > 1 && <span style={{ fontSize: 7, opacity: 0.6, flexShrink: 0 }}>×{entry.attempts}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Workflow import/export controls + local repair trigger */}
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
          {/* session narrative — concise story of what was accomplished */}
          {dispatchHist.length >= 3 && (
            <button
              className="op-btn secondary"
              style={{ padding: "2px 8px", fontSize: 9 }}
              onClick={() => {
                const narrative = generateSessionNarrative();
                if (narrative) addNotification?.(narrative, "info", 10000);
                else addNotification?.("Not enough session data yet", "info");
              }}
              title="Generate a plain-English summary of this session's activity"
            >📋 Summary</button>
          )}
          {/* on-demand self-repair — surfaces actionable fix summary */}
          <button
            className="op-btn secondary"
            style={{ padding: "2px 8px", fontSize: 9 }}
            onClick={() => {
              const repairs = runLocalRepair();
              if (repairs.length === 0) {
                addNotification?.("Local state is clean — nothing to repair", "ok");
              } else {
                addNotification?.(`✓ Repaired: ${repairs.join(", ")}`, "ok");
              }
            }}
            title="Scan and repair common local state issues (stuck installs, corrupt chains, expired checkpoints)"
          >🔧 Repair</button>
          <button
            className="op-btn secondary"
            style={{ padding: "2px 8px", fontSize: 9 }}
            onClick={exportWorkflows}
            title="Export all saved workflows to JSON"
          >📤 Export</button>
          <label
            className="op-btn secondary"
            style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", margin: 0 }}
            title="Import workflows from a JSON file"
          >
            📥 Import
            <input
              ref={importWorkflowsRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={importWorkflows}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
