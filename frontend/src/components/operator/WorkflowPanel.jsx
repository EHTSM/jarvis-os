import React, { useState, useCallback, useMemo } from "react";
import { dispatchTask, queueTask } from "../../api";

const HIST_KEY  = "jarvis_workflow_hist";
const HIST_MAX  = 20;

const DANGEROUS_CMDS = ["rm -rf", "drop table", "drop database", "shutdown", "reboot", "kill "];

function _loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function _saveHistory(hist) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, HIST_MAX))); }
  catch { /* storage full */ }
}

export default function WorkflowPanel({ onRefresh, addNotification, onAction, externalInput, onClearExternal }) {
  const [input,       setInput]       = useState("");
  const inputRef       = React.useRef(null);
  const wasActiveRef   = React.useRef(false);

  // Restore focus if operator was actively typing
  React.useEffect(() => {
    if (externalInput !== undefined && wasActiveRef.current) {
      inputRef.current?.focus();
      wasActiveRef.current = false;
    }
  }, [externalInput]);

  // Track if operator is actively typing
  const handleFocus = React.useCallback(() => {
    wasActiveRef.current = true;
  }, []);

  const handleBlur = React.useCallback(() => {
    wasActiveRef.current = false;
  }, []);
  const [priority,    setPriority]    = useState("1");
  const [timeout,     setTimeout_]    = useState("30");
  const [result,      setResult]      = useState(null);  // { ok, text }
  const [busy,        setBusy]        = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dispatchHist, setDispatchHist] = useState(_loadHistory);

  React.useEffect(() => {
    if (externalInput) {
      setInput(externalInput);
      onClearExternal?.();
    }
  }, [externalInput, onClearExternal]);

  const showResult = (ok, text) => {
    setResult({ ok, text });
    if (ok) setTimeout(() => setResult(null), 6000);
  };

  const _addToHistory = useCallback((cmd, ok, summary) => {
    setDispatchHist(prev => {
      const entry = { cmd, ok, summary, ts: Date.now() };
      const next  = [entry, ...prev.filter(h => h.cmd !== cmd)].slice(0, HIST_MAX);
      _saveHistory(next);
      return next;
    });
  }, []);

  const cmdAnalysis = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    const lower = trimmed.toLowerCase();
    const SHELL_PREFIXES = ["node ", "npm ", "git ", "pm2 ", "ls ", "cat ", "grep ", "mkdir ", "rm ", "cp ", "mv "];
    const isShell = trimmed.startsWith("./") || trimmed.startsWith("/") || SHELL_PREFIXES.some(p => trimmed.startsWith(p));
    
    // Risk Assessment
    let risk = { label: "SAFE", color: "var(--op-green)", level: 0 };
    if (DANGEROUS_CMDS.some(d => lower.includes(d))) {
      risk = { label: "DANGEROUS", color: "var(--op-red)", level: 3 };
    } else if (lower.includes("restart") || lower.includes("build") || lower.includes("install")) {
      risk = { label: "OPERATIONAL", color: "var(--op-blue)", level: 1 };
    } else if (lower.includes("push") || lower.includes("delete") || lower.includes("prune")) {
      risk = { label: "ELEVATED", color: "var(--op-amber)", level: 2 };
    }

    return {
      isShell,
      typeLabel: isShell ? "Direct Shell" : "AI Prompt",
      typeIcon: isShell ? "🐚" : "🧠",
      typeColor: isShell ? "var(--op-blue)" : "var(--op-purple)",
      risk
    };
  }, [input]);

  const lastBackup = useMemo(() => {
    const b = dispatchHist.find(h => h.cmd.includes("backup") && h.ok);
    if (!b) return null;
    return Math.floor((Date.now() - b.ts) / 60000);
  }, [dispatchHist]);

  const isDangerous = cmdAnalysis?.risk.level === 3;

  const handleDispatch = async () => {
    if (!input.trim() || busy) return;
    const cmd = input.trim();
    setBusy(true);
    setResult(null);
    try {
      const r = await dispatchTask(cmd, parseInt(timeout) * 1000);
      if (r.success === false) {
        showResult(false, r.error || "Dispatch failed");
        _addToHistory(cmd, false, r.error || "failed");
        addNotification?.(`Task failed: ${cmd.slice(0, 20)}`, "crit");
      } else {
        const out = r.output || r.result || r.reply || "Dispatched";
        const raw = typeof out === "string" ? out : JSON.stringify(out);
        showResult(true, raw.slice(0, 200) + (raw.length > 200 ? "… (truncated)" : ""));
        _addToHistory(cmd, true, raw.slice(0, 40));
        addNotification?.(`Task succeeded: ${cmd.slice(0, 20)}`, "ok");
        setInput("");
        onAction?.();
      }
    } catch (e) {
      showResult(false, e.message);
      _addToHistory(cmd, false, e.message.slice(0, 40));
      addNotification?.(`Dispatch error: ${e.message}`, "crit");
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  const handleQueue = async () => {
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

  const handleKey = (e) => {
    if (e.key === "Enter" && e.ctrlKey) handleDispatch();
  };

  return (
    <div className="op-panel">
      <div className="op-panel-header">
        <span className="op-panel-title">Workflow</span>
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
          <span className="op-panel-meta" style={{ display: "flex", gap: 8 }}>
            <span title="Command History">⌘+H</span>
            <span title="Dispatch Task">⌘+↵</span>
          </span>
        </div>
      </div>
      {showHistory && dispatchHist.length > 0 && (
        <div style={{
          maxHeight: 110,
          overflowY: "auto",
          borderBottom: "1px solid var(--op-border)",
          background: "var(--op-bg)",
        }}>
          {dispatchHist.map((h, i) => (
            <div
              key={i}
              onClick={() => { setInput(h.cmd); setShowHistory(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 10,
                borderBottom: "1px solid rgba(26,40,64,0.4)",
              }}
              title={h.cmd}
              className="op-hist-row"
            >
              <span style={{ color: h.ok ? "var(--op-green)" : "var(--op-red)", fontSize: 9 }}>{h.ok ? "✓" : "✗"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--op-text)" }}>
                {h.cmd.includes("backup") ? "📦 " : h.cmd.includes("restart") ? "🔄 " : ""}
                {h.cmd}
              </span>
              <span style={{ color: "var(--op-text2)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {Math.floor((Date.now() - h.ts) / 60000)}m ago
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="op-workflow-body">
        <div>
          <div className="op-field-label">Command / Task Input</div>
          <textarea
            ref={inputRef}
            className={`op-text-input ${isDangerous ? "dangerous-input" : ""}`}
            style={isDangerous ? { borderColor: "var(--op-amber)", background: "rgba(255, 179, 0, 0.05)" } : {}}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKey}
            placeholder="run git status  /  show me revenue  /  research topic…"
            disabled={busy}
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
          {cmdAnalysis && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 4, 
                fontSize: 9, 
                color: cmdAnalysis.typeColor,
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "0.05em"
              }}>
                <span>{cmdAnalysis.typeIcon} {cmdAnalysis.typeLabel} Mode</span>
              </div>
              <div style={{ 
                fontSize: 9, 
                color: cmdAnalysis.risk.color,
                fontWeight: "bold",
                textTransform: "uppercase",
                padding: "1px 4px",
                border: `1px solid ${cmdAnalysis.risk.color}`,
                borderRadius: "2px"
              }}>
                Risk: {cmdAnalysis.risk.label}
              </div>
            </div>
          )}
          {cmdAnalysis?.risk.level > 1 && (
            <div style={{ marginTop: 6, padding: "4px 8px", background: "rgba(0,0,0,0.2)", borderRadius: "4px", borderLeft: `2px solid ${cmdAnalysis.risk.color}` }}>
               <div style={{ fontSize: 9, color: "var(--op-text)", fontWeight: "bold" }}>
                 {isDangerous ? "⚠️ CRITICAL IMPACT WARNING" : "⚡ OPERATIONAL IMPACT"}
               </div>
               <div style={{ fontSize: 9, color: "var(--op-text2)", marginTop: 2 }}>
                 {lastBackup !== null 
                   ? `📦 Reversibility: Last safe backup verified ${lastBackup}m ago.` 
                   : "🚨 No recent backup found. This action may be irreversible."}
               </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          </div>
        </div>

        {/* ── Task Templates (Quick Actions) ────────────────────────────── */}
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

        <div className="op-btn-row">
          <button
            className={`op-btn ${isDangerous ? "danger" : "primary"}`}
            onClick={handleDispatch}
            disabled={!input.trim() || busy}
            title="Synchronous dispatch — waits for result"
          >
            {busy ? "…" : "⚡ Dispatch"}
          </button>
          <button
            className="op-btn secondary"
            onClick={handleQueue}
            disabled={!input.trim() || busy}
            title="Async queue — returns immediately"
          >
            {busy ? "…" : "📋 Queue"}
          </button>
        </div>

        {result && (
          <div className={`op-result-box ${result.ok ? "ok" : "err"}`} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
            <span style={{ flex: 1 }}>{result.ok ? "✓ " : "✗ "}{result.text}</span>
            {!result.ok && (
              <button
                onClick={() => setResult(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 2px", fontSize: 12, lineHeight: 1, opacity: 0.7 }}
                title="Dismiss"
              >×</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
