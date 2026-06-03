import React, { useEffect, useRef, useState, useMemo } from "react";
import TelemetryPanel from "./TelemetryPanel";
import { dispatchTask, emergencyStop } from "../../runtimeApi";
import { useProductivityAnalytics } from "../../hooks/useProductivityAnalytics";
import { useDebugSession } from "../../hooks/useDebugSession";
import { useEngineeringAssistant } from "../../hooks/useEngineeringAssistant";
import { useOperatorIntelligence } from "../../hooks/useOperatorIntelligence";
import { useCollaborativeWorkflows } from "../../hooks/useCollaborativeWorkflows";

const WORKFLOW_HIST_KEY = "jarvis_workflow_execution_hist";
const PINNED_CMDS_KEY   = "jarvis_pinned_cmds";
const PINNED_MAX        = 20;
const BOOKMARKS_KEY      = "jarvis_exec_bookmarks";
const SAVED_FILTERS_KEY  = "jarvis_exec_saved_filters";

function _loadBookmarks() {
  try { return new Set(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]")); }
  catch { return new Set(); }
}
function _saveBookmarks(set) {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...set].slice(0, 100))); } catch {}
}
function _loadSavedFilters() {
  try { return JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || "[]"); }
  catch { return []; }
}
function _saveSavedFilters(filters) {
  try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters.slice(0, 10))); } catch {}
}

function _loadPinned() {
  try { return new Set(JSON.parse(localStorage.getItem(PINNED_CMDS_KEY) || "[]")); }
  catch { return new Set(); }
}
function _savePinned(set) {
  try { localStorage.setItem(PINNED_CMDS_KEY, JSON.stringify([...set].slice(0, PINNED_MAX))); } catch {}
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDur(ms) {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getRecoveryHint(error) {
  if (!error) return null;
  const err = error.toLowerCase();
  // Network / connectivity
  if (err.includes("econnrefused"))  return "Connection refused — target service may be down. Check pm2 list or docker ps.";
  if (err.includes("econnreset"))    return "Connection reset mid-flight — retry or check network stability.";
  if (err.includes("etimedout") || err.includes("timeout")) return "Execution timed out — increase timeout or check if the process is stuck (pm2 logs).";
  if (err.includes("enotfound"))     return "Host not found — check DNS and network connectivity.";
  // File system
  if (err.includes("enoent") || err.includes("not found")) return "File or command not found — verify the path and that the file exists.";
  if (err.includes("eacces") || err.includes("permission denied") || err.includes("permission")) return "Permission denied — check file ownership or try with elevated privileges.";
  if (err.includes("enospc") || err.includes("no space left")) return "Disk full — run 'df -h' and clean up logs or tmp files.";
  if (err.includes("enomem") || err.includes("out of memory") || err.includes("killed")) return "Out of memory — check 'pm2 info' and consider restarting the process.";
  // Process / runtime
  if (err.includes("sigkill"))  return "Process was killed (SIGKILL) — likely OOM or force-quit. Check system memory.";
  if (err.includes("sigterm"))  return "Process terminated (SIGTERM) — likely a deliberate stop. Restart if needed.";
  if (err.includes("exit code 1")) return "Process exited with error — expand to see full output or check pm2 logs.";
  if (err.includes("spawn"))    return "Could not spawn process — verify the executable is installed and on PATH.";
  // PM2 / deployment
  if (err.includes("pm2"))      return "PM2 error — verify the process name with 'pm2 list' and check logs with 'pm2 logs'.";
  if (err.includes("npm err") || err.includes("npm warn")) return "npm error — try 'npm install' and ensure node_modules is intact.";
  // Version control
  if (err.includes("git"))      return "Git error — check repo state with 'git status' and ensure the branch is checked out.";
  // Docker
  if (err.includes("docker"))   return "Docker error — verify daemon is running with 'docker ps' or 'systemctl status docker'.";
  // Auth
  if (err.includes("401") || err.includes("unauthorized")) return "Authentication failed — session may have expired, reload to re-login.";
  if (err.includes("403") || err.includes("forbidden"))    return "Forbidden — operator lacks permission for this action.";
  return "Review the execution output above and check pm2 logs for details.";
}

function EntryRow({ entry, onPopulateInput, onRetry, onCancel, onTogglePin, isPinned, isBookmarked, onToggleBookmark, lastCheck, isInChain, chainProgress }) {
  const [expanded,   setExpanded]   = React.useState(false);
  const [elapsed,    setElapsed]    = React.useState(0);
  const [retrying,   setRetrying]   = React.useState(false);
  const [canceling,  setCanceling]  = React.useState(false);
  // Phase 131: optimistic flash states
  const [justDone,   setJustDone]   = React.useState(false);
  const [justFailed, setJustFailed] = React.useState(false);

  const ok      = entry.status === "success" || entry.status === "completed";
  const failed  = entry.status === "failed"  || entry.status === "error";
  const running = entry.status === "running" || entry.status === "pending";

  // Flash "done" highlight for 1.5s when status transitions to ok
  const prevStatusRef = React.useRef(entry.status);
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = entry.status;
    if (ok && (prev === "running" || prev === "pending")) {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1500);
      return () => clearTimeout(t);
    }
    if (failed && (prev === "running" || prev === "pending")) {
      setJustFailed(true);
      const t = setTimeout(() => setJustFailed(false), 2000);
      return () => clearTimeout(t);
    }
  }, [entry.status, ok, failed]);

  const icon = ok ? "✓" : failed ? "✗" : running ? "▶" : "·";
  const cls  = ok ? "ok" : failed ? "fail" : running ? "run" : "idle";

  const isStalled = running && elapsed > 60000;
  const isAbandoned = running && elapsed > (entry.timeoutMs || 30000) + 120000; // Timeout + 2min buffer
  const isNew     = (entry.timestamp || entry.ts || 0) > lastCheck;

  React.useEffect(() => {
    let timer;
    if (running) {
      timer = setInterval(() => {
        const start = entry.timestamp || entry.ts || Date.now();
        setElapsed(Date.now() - start);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [running, entry.timestamp, entry.ts]);

  const handleRetry = async (e) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await onRetry?.(entry);
    } finally {
      setRetrying(false);
    }
  };

  const handleCancel = async (e) => {
    e.stopPropagation();
    setCanceling(true);
    try {
      await onCancel?.(entry);
    } finally {
      setCanceling(false);
    }
  };

  const rawOut = entry.output || entry.result || entry.reply || "";
  const outRaw = typeof rawOut === "string" ? rawOut : JSON.stringify(rawOut, null, 2);
  const outStr = outRaw.length > 8192
    ? outRaw.slice(0, 8192) + `\n… [+${outRaw.length - 8192}B truncated]`
    : outRaw;
  const isLong = outStr.length > 200 || (entry.input && entry.input.length > 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Workflow chain progress indicator */}
      {isInChain && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: chainProgress?.complete ? 'var(--op-green)' : chainProgress?.active ? 'var(--op-blue)' : 'var(--op-border)',
          opacity: 0.6
        }} />
      )}
      <div
        className={`op-exec-entry${entry._new || isNew ? " new-entry" : ""}${justDone ? " entry-flash-ok" : ""}${justFailed ? " entry-flash-fail" : ""}`}
        onClick={() => isLong && setExpanded(!expanded)}
        style={{
          cursor: isLong ? "pointer" : "default",
          borderLeft: failed ? "2px solid var(--op-red)" : running ? "2px solid var(--op-blue)" : isBookmarked ? "2px solid var(--op-amber)" : ok && justDone ? "2px solid var(--op-green)" : undefined,
          paddingLeft: (failed || running || isBookmarked || justDone) ? "6px" : undefined,
          transition: "border-left-color 0.3s ease, background 0.4s ease"
        }}
      >
        <span className="op-exec-ts">
          {fmtTime(entry.timestamp || entry.ts)}
          {isNew && <span style={{ marginLeft: 4, color: "var(--op-blue)", fontWeight: "bold", fontSize: 7 }}>NEW</span>}
        </span>
        <span className={`op-exec-icon ${cls}${failed ? " pulse-fail" : ""}`}>{icon}</span>
        <span className="op-exec-agent" title={`${entry.agentId || entry.agent || "system"} · source:${entry.source || "user"}`}>
          {(entry.agentId || entry.agent || "system").slice(0, 10)}
          <span style={{ opacity: 0.4, fontSize: 8, marginLeft: 2 }}>[{entry.source || "usr"}]</span>
        </span>
        <span className="op-exec-input" title={entry.input || entry.task || ""}>
          {entry._groupCount && (
            <span style={{ 
              background: "var(--op-border)", 
              padding: "0 4px", 
              borderRadius: 2, 
              fontSize: 7, 
              marginRight: 6, 
              verticalAlign: "middle",
              fontWeight: "bold"
            }}>
              {entry._groupCount}×
            </span>
          )}
          {expanded 
            ? (entry.input || entry.task || "—") 
            : (entry.input || entry.task || "—").slice(0, 60) + ((entry.input?.length > 60) ? "…" : "")
          }
          {((entry.input || "").includes("rm ") || (entry.input || "").includes("drop ")) && (
            <span style={{ marginLeft: 6, color: "var(--op-red)", fontWeight: "bold", fontSize: 8 }}>⚠️ DANGEROUS</span>
          )}
        </span>
        <span className="op-exec-dur" style={{ color: isAbandoned ? "var(--op-red)" : undefined }}>
          {running ? fmtDur(elapsed) : fmtDur(entry.durationMs)}
          {isStalled && !isAbandoned && <span style={{ marginLeft: 4, color: "var(--op-amber)", fontWeight: "bold", fontSize: 8 }}>⚠ STALLED</span>}
          {isAbandoned && <span style={{ marginLeft: 4, color: "var(--op-red)", fontWeight: "bold", fontSize: 8 }}>☠ ABANDONED</span>}
        </span>
        
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {/* retry with spinner, cancel with clear state */}
          {failed && (
            <button
              className="op-btn secondary"
              style={{
                padding: "0 6px", fontSize: 8, height: 16,
                opacity: retrying ? 1 : 0.75,
                color: retrying ? "var(--op-amber)" : undefined,
                animation: retrying ? "op-pulse 0.8s infinite" : undefined
              }}
              onClick={handleRetry}
              title={retrying ? "Retrying…" : "Retry execution"}
              disabled={retrying}
              aria-label={retrying ? "Retrying" : "Retry"}
            >
              {retrying ? "⟳ …" : "⟳ Retry"}
            </button>
          )}
          {running && (
            <button
              className="op-btn secondary"
              style={{
                padding: "0 6px", fontSize: 8, height: 16,
                color: canceling ? "var(--op-amber)" : "var(--op-red)",
                opacity: canceling ? 1 : 0.8
              }}
              onClick={handleCancel}
              title={canceling ? "Cancelling…" : "Cancel execution"}
              disabled={canceling}
              aria-label={canceling ? "Cancelling" : "Cancel"}
            >
              {canceling ? "⏹ …" : "✕ Cancel"}
            </button>
          )}
          <button
            className="op-btn secondary"
            style={{ padding: "0 4px", fontSize: 8, height: 14, marginLeft: 2, opacity: 0.6 }}
            onClick={(e) => { e.stopPropagation(); onPopulateInput?.(entry.input || entry.task); }}
            title="Populate into Input"
          >
            ⤴
          </button>
          <button
            className="op-btn secondary"
            style={{ padding: "0 4px", fontSize: 8, height: 14, opacity: isPinned ? 1 : 0.4, color: isPinned ? "var(--op-amber)" : undefined }}
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(entry.input || entry.task); }}
            title={isPinned ? "Unpin" : "Pin command"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
          {/* bookmark toggle */}
          <button
            className="op-btn secondary"
            style={{ padding: "0 4px", fontSize: 8, height: 14, opacity: isBookmarked ? 1 : 0.35, color: isBookmarked ? "var(--op-amber)" : undefined }}
            onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(String(entry.id || entry.ts)); }}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this entry"}
          >
            {isBookmarked ? "🔖" : "🔖"}
          </button>
          {isLong && <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 2 }}>▾</span>}
        </div>
      </div>
      
      {expanded && (
        <div style={{
          padding: "8px 12px",
          fontSize: "10px",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid var(--op-border)",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--op-text2)"
        }}>
          {outStr}
        </div>
      )}
      {failed && (entry.error || entry.result?.error) && (
        <div style={{
          padding: "4px 8px 4px 76px",
          fontSize: "10px",
          color: "var(--op-red)",
          background: "rgba(255, 68, 68, 0.05)",
          borderBottom: "1px solid rgba(26,40,64,0.5)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap"
        }}>
          <div>↳ {entry.error || entry.result?.error}</div>
          <div style={{ marginTop: 4, fontStyle: "italic", opacity: 0.8, color: "var(--op-amber)" }}>
            💡 Hint: {getRecoveryHint(entry.error || entry.result?.error)}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }) {
  const cbClass = agent.cbState === "open" ? "open" : agent.cbState === "halfOpen" ? "half" : "closed";
  return (
    <div className="op-exec-entry">
      <span className="op-exec-ts" style={{ color: "var(--op-accent)" }}>{agent.id}</span>
      <span className={`op-exec-icon ${agent.active > 0 ? "run" : "ok"}`}>
        {agent.active > 0 ? "▶" : "●"}
      </span>
      <span className="op-exec-agent">{agent.capabilities?.[0] ?? "—"}</span>
      <span className="op-exec-input">
        active:{agent.active}/{agent.maxConcurrent}  ok:{agent.stats?.success}  fail:{agent.stats?.failure}
      </span>
      <span className={`op-adapter-cb ${cbClass}`}>{agent.cbState}</span>
    </div>
  );
}

export default function ExecLogPanel({ history, rtStatus, ops, onPopulateInput, lastCheck, initialFilter = "all", initialSearch = "", onFilterChange, onSearchChange }) {
  const { recordRetry } = useProductivityAnalytics();
  const { activeLoop, dismissLoop, replayGuide } = useDebugSession();
  const {
    rootCauses, recoveryPaths, deployReadiness, recommendations,
    dismissRec, recordRecovery, pastRecoveries, sessionRestored,
    sessionStale, maturityScore, analyze,
  } = useEngineeringAssistant({ activeLoop, history });

  // Phase 841-852: operator intelligence — priority + debug sequence in exec log context
  const { urgencySummary, debugSequence, intelligentRecs, dismissRec: dismissIntelRec, recordAction: recordIntelAction, contextInsights } = useOperatorIntelligence();

  // Phase 871-877: collaborative workflows — export debug context, import workflows
  const { debugHandoffLabel, deployCoordLabel, exportWorkflow: exportCWWorkflow, importWorkflow: importCWWorkflow, importError: cwImportError, importedWorkflow: cwImportedWorkflow, importedWorkflowStale: cwImportStale } = useCollaborativeWorkflows();
  const [showImport, setShowImport] = React.useState(false);
  const [importInput, setImportInput] = React.useState("");

  // Phase 807: assistant panel visibility — collapsed by default, expands when there are recs
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Auto-open when high-priority recommendations appear (once per set)
  const lastHighPrioRef = React.useRef(0);
  React.useEffect(() => {
    const hasHigh = recommendations.some(r => r.priority === "high");
    const now = Date.now();
    if (hasHigh && now - lastHighPrioRef.current > 60000) {
      lastHighPrioRef.current = now;
      setAssistantOpen(true);
    }
  }, [recommendations]);
  // Persist execution history for long-running sessions — size-guarded write
  React.useEffect(() => {
    try {
      const trimmed = history.slice(0, 100).map(e => ({
        // Only persist fields needed for recovery — strip large output blobs
        id: e.id, ts: e.ts, timestamp: e.timestamp,
        input: (e.input || "").slice(0, 200),
        task: (e.task || "").slice(0, 200),
        status: e.status, agentId: e.agentId, source: e.source,
        durationMs: e.durationMs, timeoutMs: e.timeoutMs,
        error: (e.error || "").slice(0, 200)
      }));
      localStorage.setItem('jarvis_exec_history', JSON.stringify(trimmed));
    } catch {
      // Storage quota exceeded — continue silently
    }
  }, [history]);
  const [pinnedCmds, setPinnedCmds] = useState(_loadPinned);
  const togglePin = React.useCallback((cmd) => {
    if (!cmd) return;
    setPinnedCmds(prev => {
      const next = new Set(prev);
      next.has(cmd) ? next.delete(cmd) : next.add(cmd);
      _savePinned(next);
      return next;
    });
  }, []);

  // Phase 117: bookmarked entries (persisted by entry id/ts)
  const [bookmarks, setBookmarks] = useState(_loadBookmarks);
  const toggleBookmark = React.useCallback((entryId) => {
    if (!entryId) return;
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      _saveBookmarks(next);
      return next;
    });
  }, []);

  // Phase 133: saved filters + timeline collapse
  const [savedFilters, setSavedFilters] = useState(_loadSavedFilters);
  const [collapsed,    setCollapsed]    = useState(false); // timeline collapse
  const saveCurrentFilter = React.useCallback(() => {
    const q = search.trim();
    if (!q && filter === "all") return;
    setSavedFilters(prev => {
      const label = [filter !== "all" ? filter : "", q].filter(Boolean).join(" + ") || "filter";
      const entry = { label, filter, search: q, savedAt: Date.now() };
      const next  = [entry, ...prev.filter(f => f.label !== label)].slice(0, 10);
      _saveSavedFilters(next);
      return next;
    });
  }, [filter, search]);
  const deleteSavedFilter = React.useCallback((label) => {
    setSavedFilters(prev => {
      const next = prev.filter(f => f.label !== label);
      _saveSavedFilters(next);
      return next;
    });
  }, []);

  const logRef  = useRef(null);
  const prevLen = useRef(0);
  const [filter, _setFilter] = useState(initialFilter);
  const [search, _setSearch] = useState(initialSearch);

  const setFilter = React.useCallback((v) => { _setFilter(v); onFilterChange?.(v); }, [onFilterChange]);
  const setSearch = React.useCallback((v) => { _setSearch(v); onSearchChange?.(v); }, [onSearchChange]);
  const [workflowChains, setWorkflowChains] = useState({});
  const [activeChain, setActiveChain] = useState(null);

  // Persist workflow history and chain state
  useEffect(() => {
    try {
      const persisted = localStorage.getItem(WORKFLOW_HIST_KEY);
      if (persisted) {
        const data = JSON.parse(persisted);
        setWorkflowChains(data.chains || {});
        setActiveChain(data.activeChain || null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      // Cap persisted chains to 20 entries to prevent unbounded localStorage growth
      const chainEntries = Object.entries(workflowChains);
      const cappedChains = chainEntries.length > 20
        ? Object.fromEntries(chainEntries.slice(-20))
        : workflowChains;
      localStorage.setItem(WORKFLOW_HIST_KEY, JSON.stringify({
        chains: cappedChains,
        activeChain,
        restoredAt: Date.now()
      }));
    } catch {}
  }, [workflowChains, activeChain]);

  // Detect workflow chains (consecutive related tasks)
  useEffect(() => {
    const detectChains = () => {
      const chains = {};
      const last30 = history.slice(0, 30);
      
      for (let i = 0; i < last30.length; i++) {
        const curr = last30[i];
        const input = (curr.input || curr.task || "").toLowerCase();
        
        // Chain markers: backup → restore, build → test, deploy → verify
        const chainType = 
          input.includes("backup") ? "backup" :
          input.includes("restore") ? "restore" :
          input.includes("build") ? "build" :
          input.includes("test") ? "test" :
          input.includes("deploy") ? "deploy" :
          input.includes("verify") ? "verify" : null;
        
        if (chainType) {
          const chainKey = `${chainType}_${Math.floor(curr.timestamp / 60000)}`;
          if (!chains[chainKey]) chains[chainKey] = { type: chainType, tasks: [], start: curr.timestamp };
          chains[chainKey].tasks.push(curr.id || curr.ts);
        }
      }
      
      setWorkflowChains(chains);
      
      // Set active chain if there's a running one
      const activeChainKey = Object.keys(chains).find(key => 
        chains[key].tasks.some(id => last30.find(e => (e.id || e.ts) === id && (e.status === 'running' || e.status === 'pending')))
      );
      setActiveChain(activeChainKey || null);
    };

    if (history.length > 0) {
      detectChains();
    }
  }, [history]);

  // Stable refs — prevent all EntryRow re-renders when parent state changes
  const lastCancelRef = React.useRef(0);

  const handleRetry = React.useCallback(async (entry) => {
    const cmd = entry.input || entry.task;
    if (!cmd) return;
    recordRetry();
    try {
      const r = await dispatchTask(cmd, (entry.timeoutMs || 30000));
      if (r.success === false) console.error("Retry failed:", r.error);
    } catch (err) {
      console.error("Retry error:", err);
    }
  }, [recordRetry]);

  const handleCancel = React.useCallback(async (entry) => {
    const now = Date.now();
    if (now - lastCancelRef.current < 500) return; // debounce double-cancel
    lastCancelRef.current = now;
    try {
      const r = await emergencyStop("operator_cancelled_execution");
      if (r.success === false) console.error("Cancel failed:", r.error);
    } catch (err) {
      console.error("Cancel error:", err);
    }
  }, []);

  // Debounced search — avoid re-filtering on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const filteredHistory = useMemo(() => {
    // Cap history scan to 500 entries — prevents O(n) on multi-thousand-entry sessions
    const scannable = history.slice(0, 500);
    const q = debouncedSearch.toLowerCase().trim();

    // Parse special prefixes: status:failed  error:timeout  agent:terminal  ts:14:32
    let qStatus = null, qError = null, qAgent = null, qTs = null, qFree = "";
    if (q) {
      const tokens = q.split(/\s+/);
      const free = [];
      for (const tok of tokens) {
        if (tok.startsWith("status:"))  { qStatus = tok.slice(7); continue; }
        if (tok.startsWith("error:"))   { qError  = tok.slice(6); continue; }
        if (tok.startsWith("agent:"))   { qAgent  = tok.slice(6); continue; }
        if (tok.startsWith("ts:"))      { qTs     = tok.slice(3); continue; }
        free.push(tok);
      }
      qFree = free.join(" ");
    }

    let list = scannable.filter(e => {
      // Status filter (tab)
      if (filter === "running")    { if (e.status !== "running" && e.status !== "pending") return false; }
      else if (filter === "failed")     { if (e.status !== "failed"  && e.status !== "error")   return false; }
      else if (filter === "success")    { if (e.status !== "success" && e.status !== "completed") return false; }
      // Phase 117: bookmarked filter
      else if (filter === "bookmarked") { if (!bookmarks.has(String(e.id || e.ts))) return false; }

      if (!q) return true;

      // Prefix filters
      if (qStatus && !(e.status || "").includes(qStatus))         return false;
      if (qError  && !(e.error  || "").toLowerCase().includes(qError))  return false;
      if (qAgent  && !(e.agentId || e.agent || "").toLowerCase().includes(qAgent)) return false;
      if (qTs) {
        const timeStr = e.ts || e.timestamp
          ? new Date(e.ts || e.timestamp).toLocaleTimeString("en-US", { hour12: false })
          : "";
        if (!timeStr.includes(qTs)) return false;
      }

      // Free-text: match input, task, error, agentId
      if (qFree) {
        const hay = [e.input, e.task, e.error, e.agentId, e.agent].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(qFree)) return false;
      }

      return true;
    });

    // ── History Compression Logic ──────────────────────────────────────────
    // Group consecutive identical successful tasks to reduce entropy.
    const compressed = [];
    let group = null;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const isRepeatable = (e.status === "success" || e.status === "completed") && !e._new;
      
      if (isRepeatable && group && group.input === e.input && group.agentId === e.agentId) {
        group.count++;
        group.ids.push(e.id || e.ts);
      } else {
        if (group && group.count > 1) {
          compressed.push({ ...group.lead, _groupCount: group.count, _groupIds: group.ids });
        } else if (group) {
          compressed.push(group.lead);
        }
        
        if (isRepeatable) {
          group = { input: e.input, agentId: e.agentId, lead: e, count: 1, ids: [e.id || e.ts] };
        } else {
          compressed.push(e);
          group = null;
        }
      }
    }
    if (group && group.count > 1) {
      compressed.push({ ...group.lead, _groupCount: group.count, _groupIds: group.ids });
    } else if (group) {
      compressed.push(group.lead);
    }

    return compressed;
  }, [history, filter, search, bookmarks]);

  useEffect(() => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
    if (filteredHistory.length > prevLen.current && isNearBottom) {
      // Use requestAnimationFrame to batch scroll updates
      requestAnimationFrame(() => {
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      });
    }
    prevLen.current = filteredHistory.length;
  }, [filteredHistory]);

  const stats = useMemo(() => {
    const last20 = history.slice(0, 20);
    const failed = last20.filter(e => e.status === "failed" || e.status === "error");
    const success = last20.filter(e => e.status === "success" || e.status === "completed");
    
    // Find most failing command
    const counts = {};
    failed.forEach(e => {
      const cmd = (e.input || e.task || "unknown").slice(0, 20);
      counts[cmd] = (counts[cmd] || 0) + 1;
    });
    const topFail = Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0];

    return {
      rate: last20.length ? Math.round((success.length / last20.length) * 100) : 100,
      failCount: failed.length,
      topFail
    };
  }, [history]);

  const priorityTasks = useMemo(() => {
    const now = Date.now();
    const recent = history.slice(0, 200); // cap scan to prevent O(n) on huge sessions
    // 1. Running & Pending (Active)
    const active = recent.filter(e => e.status === "running" || e.status === "pending");

    // 2. Failed (Last 5)
    const failed = recent.filter(e => e.status === "failed" || e.status === "error").slice(0, 5);

    // 3. Dangerous & Recovery (Persistent for 2m)
    const persistent = recent.filter(e => {
      if (e.status === "running" || e.status === "pending") return false;
      const isDangerous = (e.input || "").includes("rm ") || (e.input || "").includes("drop ") || (e.input || "").includes("pm2 kill");
      const isRecovery = (e.input || "").includes("backup") || (e.input || "").includes("restart");
      if (!isDangerous && !isRecovery) return false;
      return (now - (e.timestamp || e.ts || now)) < 120000; // 2 minute persistence
    });

    // Deduplicate and Sort
    const combined = [...active, ...failed, ...persistent];
    const unique = Array.from(new Map(combined.map(t => [t.id || t.ts, t])).values());
    
    return unique.sort((a,b) => (b.timestamp || b.ts) - (a.timestamp || a.ts));
  }, [history]);

  const isIncident = stats.rate < 75;

  // Phase 786: deployment failure correlation — detect deploy→fail→rollback patterns in recent history
  const deploymentState = useMemo(() => {
    const now = Date.now();
    const recent = history.slice(0, 50);
    const WINDOW = 30 * 60 * 1000; // 30min window

    const deployEntries = recent.filter(e => {
      const cmd = (e.input || e.task || "").toLowerCase();
      return (cmd.includes("deploy") || cmd.includes("pm2 start") || cmd.includes("pm2 restart")) &&
             (now - (e.timestamp || e.ts || 0)) < WINDOW;
    });

    if (!deployEntries.length) return null;

    const lastDeploy = deployEntries[0];
    const afterDeploy = recent.filter(e => (e.timestamp || e.ts || 0) > (lastDeploy.timestamp || lastDeploy.ts || 0));

    const hasRollback = afterDeploy.some(e => (e.input || e.task || "").toLowerCase().includes("rollback") || (e.input || e.task || "").toLowerCase().includes("revert"));
    const hasVerifyFail = afterDeploy.some(e => {
      const cmd = (e.input || e.task || "").toLowerCase();
      return (cmd.includes("verify") || cmd.includes("health") || cmd.includes("test")) &&
             (e.status === "failed" || e.status === "error");
    });
    const deployFailed = lastDeploy.status === "failed" || lastDeploy.status === "error";
    const deployRunning = lastDeploy.status === "running" || lastDeploy.status === "pending";

    if (!deployFailed && !hasVerifyFail && !hasRollback && !deployRunning) return null;

    const ageMin = Math.round((now - (lastDeploy.timestamp || lastDeploy.ts || now)) / 60000);
    return {
      cmd: (lastDeploy.input || lastDeploy.task || "deploy").slice(0, 50),
      ageMin,
      deployFailed,
      hasVerifyFail,
      hasRollback,
      deployRunning,
      status: hasRollback ? "rolled_back" : deployFailed ? "failed" : hasVerifyFail ? "verify_failed" : "in_progress",
    };
  }, [history]);

  // Stable status lookup — keyed by task id/ts, updated only when history changes.
  // Decouples renderedRows from needing history in its dep array.
  const taskStatusMap = useMemo(() => {
    const map = new Map();
    history.slice(0, 500).forEach(h => map.set(h.id || h.ts, h.status));
    return map;
  }, [history]);

  // Phase 150: render page cap — prevents DOM thrash on 10k+ entry sessions
  const [renderLimit, setRenderLimit] = useState(60);
  useEffect(() => { setRenderLimit(60); }, [filter, search]); // reset on filter change

  const renderedRows = useMemo(() => {
    const toRender = filteredHistory.slice(0, renderLimit);
    return toRender.map((e, i) => {
      const entryId = e.id || e.ts || i;
      const chainId = Object.keys(workflowChains).find(key =>
        workflowChains[key].tasks.includes(e.id || e.ts)
      );
      const isInChain   = !!chainId;
      const isPinned    = pinnedCmds.has(e.input || e.task || "");
      const isBookmarked = bookmarks.has(String(entryId));
      const chainProgress = chainId ? {
        active: activeChain === chainId,
        complete: workflowChains[chainId]?.tasks.every(id => taskStatusMap.get(id) === 'success')
      } : null;
      return (
        <EntryRow
          key={entryId}
          entry={e}
          onPopulateInput={onPopulateInput}
          onRetry={handleRetry}
          onCancel={handleCancel}
          onTogglePin={togglePin}
          isPinned={isPinned}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          lastCheck={lastCheck}
          isInChain={isInChain}
          chainProgress={chainProgress}
        />
      );
    });
  }, [filteredHistory, renderLimit, workflowChains, activeChain, taskStatusMap, pinnedCmds, bookmarks, onPopulateInput, togglePin, toggleBookmark]);

  const agents   = rtStatus?.agents ?? [];
  const rtQueue  = rtStatus?.queue  ?? null;

  // Compact execution summary (low-noise badges)
  const execSummary = useMemo(() => {
    const last50 = history.slice(0, 50);
    let runningCount = 0;
    let failedCount = 0;
    let successCount = 0;

    // Safe iteration to prevent errors
    last50.forEach(e => {
      if (!e || !e.status) return;
      if (e.status === 'running' || e.status === 'pending') runningCount++;
      else if (e.status === 'failed' || e.status === 'error') failedCount++;
      else if (e.status === 'success' || e.status === 'completed') successCount++;
    });

    const successRate = last50.length ? Math.round((successCount / last50.length) * 100) : 100;

    return {
      running: runningCount,
      failed: failedCount,
      success: successCount,
      rate: successRate,
      hasAlert: failedCount > 3 || successRate < 70
    };
  }, [history]);

  const timelineSummary = useMemo(() => {
    const recent = history.slice(0, 10);
    const errors = recent.filter(e => e && (e.status === 'failed' || e.status === 'error')).length;
    const last = history[0];
    const label = last ? `${last.status === 'running' ? 'Running' : last.status === 'failed' || last.status === 'error' ? 'Failed' : 'Completed'} • ${last.agent || last.task || last.source || last.title || 'activity'}` : 'No recent activity';

    return {
      recent: recent.length,
      errors,
      lastEvent: label
    };
  }, [history]);

  const executionStory = useMemo(() => {
    if (!history || history.length === 0) return "Ready — run your first command from the Workflow panel to see results here.";
    const active = history.filter(e => e?.status === 'running' || e?.status === 'pending').length;
    const failed = history.filter(e => e?.status === 'failed' || e?.status === 'error').length;
    const done   = history.filter(e => e?.status === 'success' || e?.status === 'completed').length;
    const last = history[0];
    const action = (last.input || last.task || last.title || 'recent activity').slice(0, 48);
    if (active > 0) return `${active} running now · Last: ${action}${action.length === 48 ? '…' : ''}`;
    if (failed > 0 && failed > done) return `${failed} failed recently · Last: ${action}${action.length === 48 ? '…' : ''}`;
    return `${done} completed · Last: ${action}${action.length === 48 ? '…' : ''}`;
  }, [history]);

  return (
    <div className="op-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="op-panel-header">
        <span className="op-panel-title">Activity</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Compact status badges */}
          <div className="op-exec-count-row">
            {execSummary.running > 0 && <span className="op-exec-count run">▶ {execSummary.running}</span>}
            {execSummary.failed > 0  && <span className="op-exec-count fail">✕ {execSummary.failed}</span>}
            {execSummary.success > 0 && <span className="op-exec-count ok">✓ {execSummary.success}</span>}
          </div>

          <div style={{ display: "flex", gap: "4px" }}>
            <button className={`op-send-btn ${filter === "all" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("all")}>All</button>
            <button className={`op-send-btn ${filter === "success" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("success")}>Success</button>
            <button className={`op-send-btn ${filter === "failed" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("failed")}>Failed</button>
            {/* bookmark filter */}
            <button className={`op-send-btn ${filter === "bookmarked" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px", color: filter === "bookmarked" ? "var(--op-amber)" : undefined }} onClick={() => setFilter("bookmarked")} title="Show bookmarked entries only">🔖</button>
          </div>
          <span className="op-panel-meta">
            {history.length > 0 && `${history.length} entries`}
            {rtQueue && (
              <>
                {` · queue:${rtQueue.size}`}
                {rtQueue.pulse && (Date.now() - rtQueue.pulse > 10000) && (
                  <span style={{ color: "var(--op-red)", fontWeight: "bold", marginLeft: 4 }}>⚠ QUEUE STALLED?</span>
                )}
              </>
            )}
          </span>
        </div>
      </div>

      <div className="op-exec-story">{executionStory}</div>
      <div className="op-exec-timeline-summary">
        <div className="op-exec-timeline-pill">Recent events: {timelineSummary.recent}</div>
        <div className="op-exec-timeline-pill">Errors: {timelineSummary.errors}</div>
        <div className="op-exec-timeline-note">{timelineSummary.lastEvent}</div>
      </div>

      {/* Runtime agent overview */}
      {agents.length > 0 && (
        <div className="op-agents-section">
          <div className="op-agents-label">Agents</div>
          {agents.map(a => <AgentRow key={a.id} agent={a} />)}
        </div>
      )}

      {/* execution controls with saved filters + collapse toggle */}
      <div className="execlog-controls" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px', background: 'var(--op-bg)', borderBottom: '1px solid var(--op-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ fontSize: 10, padding: '1px 3px', background: 'var(--op-surface2)', color: 'var(--op-text)', border: '1px solid var(--op-border2)', borderRadius: 3 }}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="success">Success</option>
            <option value="bookmarked">🔖 Bookmarked</option>
          </select>
          <input
            type="text"
            placeholder="Search… (status: error: agent: ts:)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, fontSize: 10, padding: '2px 5px', background: 'var(--op-surface2)', color: 'var(--op-text)', border: '1px solid var(--op-border2)', borderRadius: 3, fontFamily: 'inherit' }}
            aria-label="Search execution history"
          />
          <button
            onClick={saveCurrentFilter}
            title="Save current filter"
            style={{ fontSize: 9, padding: '1px 5px', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)', whiteSpace: 'nowrap' }}
          >+ Save</button>
          {/* timeline collapse */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand timeline" : "Collapse timeline"}
            style={{ fontSize: 9, padding: '1px 5px', background: 'none', border: '1px solid var(--op-border2)', borderRadius: 3, cursor: 'pointer', color: 'var(--op-text2)' }}
            aria-expanded={!collapsed}
          >{collapsed ? "▶ Show" : "▼ Hide"}</button>
        </div>
        {/* Saved filter chips */}
        {savedFilters.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {savedFilters.map(f => (
              <span key={f.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <button
                  onClick={() => { setFilter(f.filter); setSearch(f.search); }}
                  style={{ fontSize: 8, padding: '1px 5px', background: 'rgba(68,162,255,0.1)', border: '1px solid rgba(68,162,255,0.25)', borderRadius: 10, cursor: 'pointer', color: 'var(--op-blue)' }}
                  title={`Apply: ${f.label}`}
                >{f.label}</button>
                <button
                  onClick={() => deleteSavedFilter(f.label)}
                  style={{ fontSize: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--op-text2)', padding: '0 2px', opacity: 0.5 }}
                  title="Delete saved filter"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Engineering assistant panel — debugging analysis, recovery paths, deployment readiness */}
      {(recommendations.length > 0 || deployReadiness) && (
        <div style={{ borderBottom: "1px solid var(--op-border)", flexShrink: 0 }}>
          {/* Collapsed header — always visible when there's something to show */}
          <div
            onClick={() => setAssistantOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 10px", cursor: "pointer",
              background: recommendations.some(r => r.priority === "high")
                ? "rgba(255,68,68,0.05)" : "rgba(68,162,255,0.04)",
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 9, fontWeight: "bold",
              color: recommendations.some(r => r.priority === "high") ? "var(--op-red)" : "var(--op-blue)"
            }}>
              {assistantOpen ? "▼" : "▶"} AI Insights
            </span>
            {recommendations.length > 0 && (
              <span style={{
                fontSize: 8, padding: "1px 5px", borderRadius: 10, fontWeight: "bold",
                background: recommendations.some(r => r.priority === "high")
                  ? "rgba(255,68,68,0.2)" : "rgba(68,162,255,0.15)",
                color: recommendations.some(r => r.priority === "high")
                  ? "var(--op-red)" : "var(--op-blue)",
              }}>
                {recommendations.length} rec{recommendations.length !== 1 ? "s" : ""}
              </span>
            )}
            {/* maturity score + deployment readiness inline badges */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {maturityScore && (
                <span style={{ fontSize: 7, fontWeight: "bold", color: maturityScore.color,
                  padding: "1px 5px", borderRadius: 2,
                  background: maturityScore.score >= 70 ? "rgba(68,204,68,0.1)" : maturityScore.score >= 50 ? "rgba(255,193,7,0.1)" : "rgba(255,68,68,0.1)"
                }}>
                  {maturityScore.label} {maturityScore.score}/100
                </span>
              )}
              {deployReadiness && (
                <span style={{ fontSize: 7, fontWeight: "bold", color: deployReadiness.color }}>
                  DEPLOY: {deployReadiness.label}
                </span>
              )}
              {sessionRestored && !sessionStale && (
                <span style={{ fontSize: 7, color: "var(--op-text2)", opacity: 0.6 }}>↩ restored</span>
              )}
              {/* stale session flag — nudges operator to re-analyze */}
              {sessionStale && (
                <span
                  style={{ fontSize: 7, color: "var(--op-amber)", opacity: 0.8, cursor: "pointer" }}
                  title="Analysis is >6h old — click to re-analyze"
                  onClick={e => { e.stopPropagation(); analyze?.(); }}
                >⟳ stale</span>
              )}
            </div>
          </div>

          {assistantOpen && (
            <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 6 }}>

              {/* Root-cause analysis */}
              {rootCauses.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Root Cause Analysis
                  </div>
                  {rootCauses.slice(0, 3).map((rc, i) => (
                    <div key={rc.id} style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "3px 0",
                      borderTop: i > 0 ? "1px solid var(--op-border)" : "none", fontSize: 9,
                    }}>
                      <span style={{
                        fontSize: 7, fontWeight: "bold", color: "var(--op-text2)",
                        background: "var(--op-surface2)", padding: "0 4px", borderRadius: 2,
                        flexShrink: 0,
                      }}>#{i + 1}</span>
                      <span style={{ flex: 1, color: "var(--op-text)", fontWeight: i === 0 ? "bold" : "normal" }}>
                        {rc.label}
                      </span>
                      <span style={{
                        fontSize: 7, color: rc.confidence >= 80 ? "var(--op-green)" : rc.confidence >= 60 ? "var(--op-amber)" : "var(--op-text2)",
                        flexShrink: 0,
                      }}>{rc.confidence}%</span>
                      {rc.fix && (
                        <button
                          onClick={() => onPopulateInput?.(rc.fix)}
                          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                            background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.25)",
                            color: "var(--op-blue)", fontFamily: "inherit", flexShrink: 0 }}
                          title={`Load: ${rc.fix}`}
                        >Load fix ⤴</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Recovery paths */}
              {recoveryPaths.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Recovery Paths
                  </div>
                  {recoveryPaths.map((rp, i) => (
                    <div key={rp.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0",
                      borderTop: i > 0 ? "1px solid var(--op-border)" : "none", fontSize: 9,
                    }}>
                      <span style={{
                        fontSize: 7, flexShrink: 0, marginTop: 1,
                        color: rp.safety === "safe" ? "var(--op-green)" : "var(--op-amber)",
                      }}>
                        {rp.safety === "safe" ? "●" : "◎"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--op-text)", fontWeight: "bold" }}>{rp.label}</div>
                        <div style={{ fontSize: 8, color: "var(--op-text2)", opacity: 0.8 }}>{rp.reason}</div>
                      </div>
                      <span style={{ fontSize: 7, color: "var(--op-text2)", flexShrink: 0 }}>{rp.confidence}%</span>
                      {rp.cmd && (
                        <button
                          onClick={() => { onPopulateInput?.(rp.cmd); recordRecovery(rp.cmd, { label: rp.label }); }}
                          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                            background: "rgba(0,255,163,0.08)", border: "1px solid rgba(0,255,163,0.2)",
                            color: "var(--op-green)", fontFamily: "inherit", flexShrink: 0 }}
                        >Load ⤴</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Deployment readiness checklist */}
              {deployReadiness && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Deployment Readiness — {deployReadiness.score}/100
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {deployReadiness.checklist.map((item, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8 }}>
                        <span style={{ color: item.ok ? "var(--op-green)" : "var(--op-red)" }}>
                          {item.ok ? "✓" : "✗"}
                        </span>
                        <span style={{ color: item.ok ? "var(--op-text)" : "var(--op-red)" }}>{item.item}</span>
                        {item.note && <span style={{ color: "var(--op-text2)", opacity: 0.7 }}>({item.note})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations with reasoning + confidence */}
              {recommendations.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Recommendations
                  </div>
                  {recommendations.map((rec) => (
                    <div key={rec.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 6,
                      padding: "4px 6px", borderRadius: 3, marginBottom: 3,
                      background: rec.priority === "high" ? "rgba(255,68,68,0.05)" : "rgba(68,162,255,0.04)",
                      border: `1px solid ${rec.priority === "high" ? "rgba(255,68,68,0.2)" : "rgba(68,162,255,0.15)"}`,
                      fontSize: 9,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                          <span style={{
                            fontSize: 7, padding: "0 4px", borderRadius: 2, fontWeight: "bold",
                            background: rec.category === "debugging" ? "rgba(255,68,68,0.15)"
                                      : rec.category === "recovery"  ? "rgba(0,255,163,0.1)"
                                      : "rgba(68,162,255,0.15)",
                            color: rec.category === "debugging" ? "var(--op-red)"
                                 : rec.category === "recovery"  ? "var(--op-green)"
                                 : "var(--op-blue)",
                          }}>{rec.category}</span>
                          <span style={{ fontWeight: "bold", color: "var(--op-text)" }}>{rec.label}</span>
                          <span style={{ marginLeft: "auto", fontSize: 7,
                            color: rec.confidence >= 80 ? "var(--op-green)" : rec.confidence >= 60 ? "var(--op-amber)" : "var(--op-text2)",
                          }}>{rec.confidence}%</span>
                        </div>
                        <div style={{ fontSize: 8, color: "var(--op-text2)", lineHeight: 1.4 }}>{rec.description}</div>
                        {/* reasoning + impact */}
                        <div style={{ fontSize: 7, color: "var(--op-text2)", opacity: 0.6, marginTop: 2, display: "flex", gap: 8 }}>
                          <span>Why: {rec.reason}</span>
                          {rec.impact && <span>· Impact: {rec.impact}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                        {rec.cmd && (
                          <button
                            onClick={() => { onPopulateInput?.(rec.cmd); recordRecovery(rec.cmd, { errorClass: rec.id, label: rec.label }); }}
                            style={{ fontSize: 7, padding: "2px 6px", borderRadius: 2, cursor: "pointer",
                              background: "rgba(68,162,255,0.12)", border: "1px solid rgba(68,162,255,0.3)",
                              color: "var(--op-blue)", fontFamily: "inherit" }}
                          >Load ⤴</button>
                        )}
                        <button
                          onClick={() => dismissRec(rec.id)}
                          style={{ fontSize: 7, padding: "2px 5px", borderRadius: 2, cursor: "pointer",
                            background: "none", border: "1px solid var(--op-border2)",
                            color: "var(--op-text2)", fontFamily: "inherit" }}
                          title="Dismiss recommendation"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Past successful recoveries for this error class */}
              {pastRecoveries.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Past Recoveries
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {pastRecoveries.map((pr, i) => (
                      <button key={i}
                        onClick={() => onPopulateInput?.(pr.cmd)}
                        title={`Worked ${pr.count}× — click to load`}
                        style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                          background: "rgba(0,255,163,0.06)", border: "1px solid rgba(0,255,163,0.18)",
                          color: "var(--op-green)", fontFamily: "monospace",
                          maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        ↩ {pr.label} <span style={{ opacity: 0.5 }}>×{pr.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Smart debug sequence — dependency-aware troubleshooting order */}
              {debugSequence.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Debug Sequence
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {debugSequence.slice(0, 5).map((step, i) => (
                      <button
                        key={step.id}
                        onClick={() => { onPopulateInput?.(step.cmd); recordIntelAction(`dbg_${step.id}`, step.cmd, "debugging"); }}
                        title={`${step.reason}${step.dependsOn?.length ? ` | after: ${step.dependsOn.join(", ")}` : ""}`}
                        style={{
                          fontSize: 8, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                          background: step.phase === "recover" ? "rgba(255,68,68,0.07)"
                            : step.phase === "verify" ? "rgba(0,255,163,0.06)"
                            : "rgba(68,162,255,0.07)",
                          border: `1px solid ${step.phase === "recover" ? "rgba(255,68,68,0.2)"
                            : step.phase === "verify" ? "rgba(0,255,163,0.18)"
                            : "rgba(68,162,255,0.18)"}`,
                          color: step.phase === "recover" ? "var(--op-red)"
                            : step.phase === "verify" ? "var(--op-green)"
                            : "var(--op-blue)",
                          fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 3,
                        }}
                      >
                        <span style={{ opacity: 0.5, fontFamily: "monospace" }}>{i + 1}</span>
                        {step.label}
                        {!step.safe && <span style={{ fontSize: 6, opacity: 0.7 }}>⚠</span>}
                      </button>
                    ))}
                  </div>
                  {/* top contextual insight inline */}
                  {contextInsights[0] && (
                    <div style={{ marginTop: 4, fontSize: 7, color: "var(--op-text2)", opacity: 0.65 }}>
                      ℹ {contextInsights[0].label}: {contextInsights[0].detail}
                    </div>
                  )}
                </div>
              )}

              {/* Intelligent recs from operator intelligence engine */}
              {intelligentRecs.length > 0 && (
                <div>
                  <div style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                    Priority Actions
                  </div>
                  {intelligentRecs.slice(0, 3).map(rec => (
                    <div key={rec.id} style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "3px 5px",
                      borderRadius: 3, marginBottom: 2, fontSize: 9,
                      background: rec.priority === "high" ? "rgba(255,193,7,0.05)" : "rgba(68,162,255,0.04)",
                      border: `1px solid ${rec.priority === "high" ? "rgba(255,193,7,0.18)" : "rgba(68,162,255,0.13)"}`,
                    }}>
                      <span style={{ flex: 1, color: "var(--op-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {rec.label}
                      </span>
                      <span style={{ fontSize: 7, color: "var(--op-text2)", flexShrink: 0 }}>{rec.confidence}%</span>
                      {rec.cmd && (
                        <button
                          onClick={() => { onPopulateInput?.(rec.cmd); recordIntelAction(rec.id, rec.cmd, rec.category); }}
                          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                            background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.25)",
                            color: "var(--op-blue)", fontFamily: "inherit", flexShrink: 0 }}
                        >Load ⤴</button>
                      )}
                      <button
                        onClick={() => dismissIntelRec(rec.id)}
                        style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, cursor: "pointer",
                          background: "none", border: "none", color: "var(--op-text2)", opacity: 0.5, flexShrink: 0 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Collaboration panel — debug handoff, deploy coord, export/import */}
              <div style={{ borderTop: "1px solid var(--op-border)", paddingTop: 6, marginTop: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 8, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Collaboration
                  </span>
                  {/* debug handoff badge */}
                  {debugHandoffLabel && (
                    <span style={{
                      fontSize: 7, padding: "0 5px", borderRadius: 2,
                      background: debugHandoffLabel.hasActive ? "rgba(255,193,7,0.1)" : "rgba(68,162,255,0.07)",
                      color: debugHandoffLabel.hasActive ? "var(--op-amber)" : "var(--op-text2)",
                      maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={debugHandoffLabel.summary}>
                      {debugHandoffLabel.hasActive ? "⚡" : "ℹ"} {debugHandoffLabel.summary.slice(0, 50)}
                    </span>
                  )}
                  {/* deploy coord label */}
                  {deployCoordLabel && (
                    <span style={{ fontSize: 7, fontWeight: "bold", color: deployCoordLabel.color, marginLeft: "auto", flexShrink: 0 }}>
                      {deployCoordLabel.label}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {/* export current debug context */}
                  {(rootCauses.length > 0 || recommendations.length > 0) && (
                    <button
                      onClick={() => {
                        const steps = [
                          ...rootCauses.slice(0, 3).filter(rc => rc.fix).map((rc, i) => ({
                            id: `rc_${i}`, label: `Fix: ${rc.label}`, cmd: rc.fix, safe: true, phase: "diagnose",
                          })),
                          ...recoveryPaths.slice(0, 2).filter(rp => rp.cmd).map((rp, i) => ({
                            id: `rp_${i}`, label: rp.label, cmd: rp.cmd, safe: rp.safety === "safe", phase: "recover",
                            requiresApproval: rp.safety !== "safe",
                          })),
                        ];
                        exportCWWorkflow("Debug context export", steps, "debugging", {
                          failRate: deployReadiness?.failRate,
                          deployScore: deployReadiness?.score,
                          errorClass: rootCauses[0]?.id,
                        });
                      }}
                      style={{ fontSize: 7, padding: "1px 6px", borderRadius: 2, cursor: "pointer",
                        background: "rgba(68,162,255,0.08)", border: "1px solid rgba(68,162,255,0.22)",
                        color: "var(--op-blue)", fontFamily: "inherit" }}
                      title="Export current debug context as a shareable workflow JSON"
                    >↑ Export debug</button>
                  )}
                  {/* import workflow toggle */}
                  <button
                    onClick={() => setShowImport(s => !s)}
                    style={{ fontSize: 7, padding: "1px 6px", borderRadius: 2, cursor: "pointer",
                      background: showImport ? "rgba(0,255,163,0.1)" : "none",
                      border: `1px solid ${showImport ? "rgba(0,255,163,0.3)" : "var(--op-border2)"}`,
                      color: showImport ? "var(--op-green)" : "var(--op-text2)", fontFamily: "inherit" }}
                  >↓ Import workflow</button>
                  {/* load top debug fix if handoff available */}
                  {debugHandoffLabel?.topFix && (
                    <button
                      onClick={() => onPopulateInput?.(debugHandoffLabel.topFix)}
                      style={{ fontSize: 7, padding: "1px 6px", borderRadius: 2, cursor: "pointer",
                        background: "rgba(255,193,7,0.08)", border: "1px solid rgba(255,193,7,0.22)",
                        color: "var(--op-amber)", fontFamily: "inherit" }}
                      title="Load top fix from debug handoff"
                    >↩ Load handoff fix</button>
                  )}
                </div>
                {/* import textarea */}
                {showImport && (
                  <div style={{ marginTop: 5 }}>
                    <textarea
                      value={importInput}
                      onChange={e => setImportInput(e.target.value)}
                      placeholder="Paste exported workflow JSON here…"
                      rows={3}
                      style={{ width: "100%", boxSizing: "border-box", fontSize: 8, padding: "4px 6px",
                        background: "var(--op-surface2)", color: "var(--op-text)", border: "1px solid var(--op-border2)",
                        borderRadius: 3, fontFamily: "var(--op-mono)", resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 5, marginTop: 3, alignItems: "center" }}>
                      <button
                        onClick={() => {
                          const wf = importCWWorkflow(importInput);
                          if (wf) { setShowImport(false); setImportInput(""); }
                        }}
                        style={{ fontSize: 7, padding: "1px 7px", borderRadius: 2, cursor: "pointer",
                          background: "rgba(0,255,163,0.1)", border: "1px solid rgba(0,255,163,0.3)",
                          color: "var(--op-green)", fontFamily: "inherit" }}
                      >Validate + Import</button>
                      <button
                        onClick={() => { setShowImport(false); setImportInput(""); }}
                        style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                          background: "none", border: "1px solid var(--op-border2)",
                          color: "var(--op-text2)", fontFamily: "inherit" }}
                      >Cancel</button>
                      {cwImportError && (
                        <span style={{ fontSize: 7, color: "var(--op-red)", flex: 1 }}>✕ {cwImportError}</span>
                      )}
                    </div>
                  </div>
                )}
                {/* imported workflow step runner */}
                {cwImportedWorkflow && !showImport && (
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 8, color: "var(--op-green)", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                      <span>✓ Imported: {cwImportedWorkflow.label}</span>
                      {cwImportStale && <span style={{ color: "var(--op-amber)", fontSize: 7 }}>⚠ stale</span>}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {cwImportedWorkflow.steps.map((step, i) => (
                        <button
                          key={step.id || i}
                          onClick={() => onPopulateInput?.(step.cmd)}
                          title={`${step.phase}${step.requiresApproval ? " — requires approval" : ""}`}
                          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                            background: step.requiresApproval ? "rgba(255,193,7,0.08)" : "rgba(68,162,255,0.07)",
                            border: `1px solid ${step.requiresApproval ? "rgba(255,193,7,0.2)" : "rgba(68,162,255,0.18)"}`,
                            color: step.requiresApproval ? "var(--op-amber)" : "var(--op-blue)",
                            fontFamily: "inherit", display: "flex", alignItems: "center", gap: 2 }}
                        >
                          <span style={{ opacity: 0.5, fontFamily: "monospace" }}>{i + 1}</span>
                          {step.label}
                          {step.requiresApproval && <span style={{ fontSize: 6 }}>⚠</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

      {/* Debug loop banner — surfaces when the same command fails repeatedly */}
      {activeLoop && (
        <div className="op-debug-loop-banner">
          <span className="op-debug-loop-icon">⚠</span>
          <div className="op-debug-loop-body">
            <div className="op-debug-loop-title">
              DEBUG LOOP DETECTED — {activeLoop.count} failures in {activeLoop.durationMin}m
              <span className="op-debug-loop-cmd">
                {(activeLoop.cmd || "").slice(0, 50)}{(activeLoop.cmd || "").length > 50 ? "…" : ""}
              </span>
            </div>
            <div className="op-debug-loop-hint">💡 {activeLoop.suggestion}</div>
          </div>
          <button
            onClick={dismissLoop}
            title="Dismiss this warning"
            className="op-bar-btn dismiss"
            aria-label="Dismiss debug loop warning"
          >×</button>
        </div>
      )}

      {/* deployment failure correlation banner */}
      {deploymentState && (() => {
        const depCls = deploymentState.status === "rolled_back" ? "ok"
                     : deploymentState.status === "in_progress" ? "progress"
                     : "fail";
        const depIcon = deploymentState.status === "rolled_back" ? "↩"
                      : deploymentState.status === "in_progress" ? "▶" : "⚠";
        const depLabel = deploymentState.status === "rolled_back" ? "ROLLED BACK"
                       : deploymentState.status === "in_progress" ? "IN PROGRESS"
                       : deploymentState.status === "verify_failed" ? "VERIFY FAILED"
                       : "FAILED";
        return (
          <div className={`op-deploy-banner ${depCls}`}>
            <span className="op-deploy-icon">{depIcon}</span>
            <div className="op-deploy-body">
              <div className="op-deploy-title">
                DEPLOYMENT {depLabel}
                <span className="op-deploy-age">{deploymentState.ageMin}m ago</span>
              </div>
              <div className="op-deploy-cmd">{deploymentState.cmd}</div>
              {deploymentState.hasVerifyFail && !deploymentState.hasRollback && (
                <div className="op-deploy-note warn">↳ Post-deploy verification failed — consider rollback or check pm2 logs</div>
              )}
              {deploymentState.hasRollback && (
                <div className="op-deploy-note ok">↳ Rollback executed — verify service health before resuming</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* replay guide — non-stale past debug pattern, only when no active loop */}
      {!activeLoop && replayGuide && !replayGuide.stale && (
        <div className="op-replay-bar">
          <span className="op-replay-label">↩ REPLAY</span>
          <span className="op-replay-body">
            {replayGuide.ageMin}m ago — {replayGuide.label}: {replayGuide.suggestion}
          </span>
        </div>
      )}

      <div
        ref={logRef}
        className="op-panel-body"
        style={{ padding: 0, flex: collapsed ? 0 : 1, overflow: collapsed ? "hidden" : undefined, maxHeight: collapsed ? 0 : undefined, transition: "max-height 0.25s ease, flex 0.25s ease" }}
      >
        {filteredHistory.length === 0 ? (
          <div className="op-exec-empty">
            <div className="op-exec-empty-icon">✦</div>
            <div className="op-exec-empty-title">
              {filter === "failed" ? "No failures — things are running clean." :
               filter === "success" ? "No completed tasks yet." :
               filter === "bookmarked" ? "No bookmarked entries yet." :
               search ? "No results match your search." :
               "No activity yet — Jarvis is ready."}
            </div>
            <div className="op-exec-empty-sub">
              {filter === "all" && !search
                ? "Send a command from the Workflow panel. Results appear here the moment execution completes."
                : filter === "bookmarked"
                ? "Click the bookmark icon on any entry to save it here for quick reference."
                : "Try a different filter or clear your search."}
            </div>
            {filter === "all" && !search && (
              <div className="op-exec-empty-guide">
                <span className="op-exec-empty-guide-label">Get started:</span>
                <span>Type a command in the Workflow panel below</span>
                <span>Press Dispatch — results appear here instantly</span>
                <span>Use ⌘K to search saved macros and shortcuts</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Workflow Progress Bar */}
            {activeChain && workflowChains[activeChain] && (
              <div className="op-chain-bar">
                <span className="op-chain-label">⛓ WORKFLOW CHAIN</span>
                <span className="op-chain-type">{workflowChains[activeChain].type.toUpperCase()}</span>
                <div className="op-chain-track">
                  <div className="op-chain-fill" style={{ width: `${(workflowChains[activeChain].tasks.length / 5) * 100}%` }} />
                </div>
                <span className="op-chain-count">{workflowChains[activeChain].tasks.length} tasks</span>
              </div>
            )}
            
            {renderedRows}
            {/* load-more sentinel */}
            {filteredHistory.length > renderLimit && (
              <div
                style={{ padding: "6px 10px", textAlign: "center", cursor: "pointer", fontSize: 9, color: "var(--op-text2)", borderTop: "1px solid var(--op-border)", userSelect: "none" }}
                onClick={() => setRenderLimit(l => l + 60)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" && setRenderLimit(l => l + 60)}
                aria-label={`Load more entries — ${filteredHistory.length - renderLimit} remaining`}
              >
                ▾ Load {Math.min(60, filteredHistory.length - renderLimit)} more ({filteredHistory.length - renderLimit} remaining)
              </div>
            )}
          </>
        )}
      </div>

      {/* Telemetry strip at bottom */}
      <div className="op-telemetry-strip">
        <div className="op-telemetry-label">Telemetry</div>
        <TelemetryPanel ops={ops} />
      </div>
    </div>
  );
}
