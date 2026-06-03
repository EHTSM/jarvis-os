// Phase 243: Local AI workflow assistant — pattern-matching intelligence, no external calls.
// Explains workflows, summarizes failures, suggests recovery, generates safer variants.

import { getFrictionSummary } from "./useProductivityAnalytics";

// Phase 243: explain a command in plain English
export function explainCommand(cmd) {
  if (!cmd || !cmd.trim()) return null;
  const c = cmd.trim().toLowerCase();

  if (c.startsWith("pm2")) {
    if (c.includes("restart")) return "Restarts a process managed by PM2. Safe to run — won't lose data.";
    if (c.includes("list"))    return "Shows all PM2-managed processes and their status.";
    if (c.includes("logs"))    return "Streams recent log output. Use --lines N to limit output.";
    if (c.includes("stop"))    return "Stops a PM2 process. It stays in the process list but won't run.";
    if (c.includes("delete"))  return "Removes a PM2 process permanently. Needs pm2 start to re-add.";
    return "PM2 process manager command.";
  }
  if (c.startsWith("npm run")) return `Runs the '${cmd.replace(/npm run\s*/i, "").trim()}' script from package.json.`;
  if (c.startsWith("npm install") || c.startsWith("npm i ")) return "Installs Node.js dependencies. Safe to re-run; won't delete existing packages.";
  if (c.startsWith("npm test")) return "Runs the test suite. Safe to run any time — tests don't affect production.";
  if (c.startsWith("git status")) return "Shows uncommitted changes. Read-only — no side effects.";
  if (c.startsWith("git pull")) return "Downloads and merges remote changes. May create merge conflicts.";
  if (c.startsWith("git push")) return "Uploads local commits to the remote. Requires push access.";
  if (c.startsWith("rm -rf")) return "⚠ Permanently deletes files or directories. Cannot be undone.";
  if (c.startsWith("kill ")) return "⚠ Forcefully terminates a process by ID. Use with care.";
  if (c.startsWith("curl")) return "Makes an HTTP request. Check the URL before running in production.";
  if (c.startsWith("docker")) return "Docker container or image command.";
  if (c.startsWith("kubectl")) return "Kubernetes cluster management command.";
  if (c.startsWith("ls") || c.startsWith("dir")) return "Lists files in the current directory. Read-only.";
  if (c.startsWith("cat ")) return "Prints a file's contents to the terminal. Read-only.";
  if (c.startsWith("echo ")) return "Prints text to the terminal. Read-only.";

  return "Shell command. Review carefully before dispatching to production.";
}

// Phase 243: summarize recent execution failures in plain English
export function summarizeFailures() {
  try {
    const HIST_KEY = "jarvis_workflow_hist";
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const failures = hist.filter(h => !h.ok).slice(0, 10);
    if (!failures.length) return null;

    const msgCounts = {};
    failures.forEach(f => {
      const key = (f.output || "unknown").slice(0, 60);
      msgCounts[key] = (msgCounts[key] || 0) + 1;
    });

    const top = Object.entries(msgCounts).sort(([,a],[,b]) => b - a)[0];
    const count = failures.length;
    const recent = failures[0];
    const recency = recent?.ts ? _relTime(recent.ts) : "recently";

    return {
      count,
      topError: top?.[0] || "Unknown error",
      topErrorCount: top?.[1] || 1,
      lastCmd: recent?.cmd || null,
      recency,
      summary: `${count} failure${count > 1 ? "s" : ""} recorded. Most recent: "${recent?.cmd?.slice(0, 40) || "unknown"}" ${recency}.`,
    };
  } catch { return null; }
}

// Phase 243: suggest a safer variant of a command
export function suggestSaferVariant(cmd) {
  if (!cmd) return null;
  const c = cmd.trim();

  if (/rm -rf/i.test(c)) {
    const path = c.replace(/rm -rf\s*/i, "").trim();
    return { safer: `ls -la ${path}`, reason: "Preview what would be deleted before removing." };
  }
  if (/pm2 delete/i.test(c)) {
    const proc = c.replace(/pm2 delete\s*/i, "").trim();
    return { safer: `pm2 stop ${proc}`, reason: "Stop instead of delete — easier to restore." };
  }
  if (/git push.*--force/i.test(c)) {
    return { safer: c.replace(/--force/, "--force-with-lease"), reason: "force-with-lease aborts if remote has new commits." };
  }
  if (/npm install/i.test(c) && !/--save-dev|--save-exact/.test(c)) {
    return { safer: `${c} --save-exact`, reason: "Pin exact version to prevent unexpected upgrades." };
  }
  if (/kill -9/i.test(c)) {
    const pid = c.replace(/kill\s+-9\s*/i, "").trim();
    return { safer: `kill ${pid}`, reason: "SIGTERM first — allows graceful shutdown before SIGKILL." };
  }
  return null;
}

// Phase 243: suggest recovery actions based on a failure message
export function suggestRecovery(errorMsg) {
  if (!errorMsg) return [];
  const m = errorMsg.toLowerCase();
  const suggestions = [];

  if (m.includes("econnrefused") || m.includes("connection refused"))
    suggestions.push("Check the backend is running: pm2 list", "Restart: pm2 restart jarvis-backend");
  if (m.includes("heap out of memory") || m.includes("enomem"))
    suggestions.push("Restart the backend to free memory: pm2 restart jarvis-backend", "Increase Node heap: NODE_OPTIONS=--max-old-space-size=4096");
  if (m.includes("eaddrinuse"))
    suggestions.push("Another process is on that port. Find it: lsof -i :<port>", "Or restart: pm2 restart all");
  if (m.includes("permission denied") || m.includes("eacces"))
    suggestions.push("Check file ownership: ls -la <path>", "Fix permissions: chmod 755 <path>");
  if (m.includes("timeout") || m.includes("etimedout"))
    suggestions.push("Increase the dispatch timeout in the workflow settings", "Check if the backend is overloaded: pm2 monit");
  if (m.includes("module not found") || m.includes("cannot find module"))
    suggestions.push("Install dependencies: npm install", "Check the module name for typos");
  if (!suggestions.length)
    suggestions.push("Export diagnostics (📦) and check the execution log for details");

  return suggestions;
}

// Phase 266: terminal intelligence — summarize raw output, explain consequences
export function summarizeTerminalOutput(raw, cmd) {
  if (!raw) return null;
  const r = raw.toLowerCase();
  const lines = raw.split("\n").filter(l => l.trim());

  // Error keywords → failure summary
  const errorLine = lines.find(l => /error:|fatal:|failed|exception|econnrefused|enoent|eacces/i.test(l));
  if (errorLine) {
    const category = _categorizeLine(errorLine);
    return { type: "error", headline: category, detail: errorLine.trim().slice(0, 120) };
  }

  // Success keywords → success summary
  if (r.includes("successfully") || r.includes("done") || r.includes("compiled") || r.includes("passed")) {
    return { type: "success", headline: "Completed successfully", detail: lines[lines.length - 1]?.trim().slice(0, 100) };
  }

  // PM2 list output → process status summary
  if (r.includes("app name") && r.includes("status")) {
    const online = (raw.match(/online/g) || []).length;
    const stopped = (raw.match(/stopped|errored/g) || []).length;
    return { type: "info", headline: `${online} online, ${stopped} stopped`, detail: "PM2 process list" };
  }

  // Generic: first meaningful line
  const headline = lines.find(l => l.trim().length > 5)?.trim().slice(0, 100);
  return headline ? { type: "info", headline, detail: `${lines.length} lines of output` } : null;
}

function _categorizeLine(line) {
  const l = line.toLowerCase();
  if (l.includes("econnrefused")) return "Connection refused — backend may be down";
  if (l.includes("enoent"))       return "File or path not found";
  if (l.includes("eacces"))       return "Permission denied";
  if (l.includes("heap"))         return "Memory exhaustion";
  if (l.includes("syntax"))       return "Syntax error";
  if (l.includes("module"))       return "Missing module — run npm install";
  return "Execution error";
}

// Phase 266: explain what a command will do to the system before running
export function explainConsequences(cmd) {
  if (!cmd) return null;
  const c = cmd.trim().toLowerCase();

  if (/rm -rf/.test(c))            return { severity: "critical", msg: "Permanently deletes files. Cannot be undone." };
  if (/pm2 delete/.test(c))        return { severity: "warn",     msg: "Removes the process from PM2 permanently. Needs pm2 start to restore." };
  if (/pm2 restart/.test(c))       return { severity: "safe",     msg: "Brief downtime while the process restarts. Usually under 5 seconds." };
  if (/pm2 stop/.test(c))          return { severity: "warn",     msg: "Stops the process — it won't restart automatically." };
  if (/npm run build/.test(c))     return { severity: "safe",     msg: "Writes compiled output to dist/. Existing build is overwritten." };
  if (/git push.*--force/.test(c)) return { severity: "critical", msg: "Rewrites remote history. Other developers' work may be lost." };
  if (/git reset --hard/.test(c))  return { severity: "critical", msg: "Discards all uncommitted changes permanently." };
  if (/drop (table|database)/i.test(c)) return { severity: "critical", msg: "Permanently destroys database structure and all data." };
  if (/kill -9/.test(c))           return { severity: "warn",     msg: "Forcefully kills a process — no cleanup, data may be lost." };
  if (/docker (rm|rmi|down)/.test(c)) return { severity: "warn", msg: "Removes containers or images. Data volumes may be preserved." };

  return null;
}

// Phase 312: generate a human-readable narrative for a completed workflow
// steps: [{ name, cmd }], results: [{ ok, durationMs }]
export function generateWorkflowNarrative(steps, results) {
  if (!steps || !steps.length || !results || !results.length) return null;
  const total   = Math.min(steps.length, results.length);
  const passed  = results.slice(0, total).filter(r => r.ok).length;
  const failed  = total - passed;
  const totalMs = results.slice(0, total).reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const durationStr = totalMs > 60_000
    ? `${Math.round(totalMs / 60_000)}m ${Math.round((totalMs % 60_000) / 1000)}s`
    : `${Math.round(totalMs / 1000)}s`;

  const failedSteps = results
    .slice(0, total)
    .map((r, i) => (!r.ok ? steps[i]?.name || `step ${i + 1}` : null))
    .filter(Boolean);

  if (failed === 0) {
    return `Workflow completed successfully — all ${total} step${total !== 1 ? "s" : ""} passed in ${durationStr}.`;
  }
  if (passed === 0) {
    return `Workflow failed — all ${total} step${total !== 1 ? "s" : ""} encountered errors. Check: ${failedSteps.join(", ")}.`;
  }
  return `Workflow ran ${total} step${total !== 1 ? "s" : ""} in ${durationStr}: ${passed} succeeded, ${failed} failed (${failedSteps.join(", ")}). Review failed steps before retrying.`;
}

// Phase 325: classify failure severity — distinguishes transient from critical failures
// Returns { severity, recoverable, action, calm } — calm = don't alarm the operator
export function classifyFailure(errorMsg = "") {
  const e = errorMsg.toLowerCase();

  // Transient — almost always self-resolves or retries safely
  if (/econnrefused|econnreset|socket hang up|network timeout/i.test(e))
    return { severity: "transient", recoverable: true,  action: "Retry in a moment — backend may be starting up", calm: true };
  if (/timeout|timed out/i.test(e))
    return { severity: "transient", recoverable: true,  action: "Increase timeout or check if backend is under load", calm: true };
  if (/rate.?limit|429/i.test(e))
    return { severity: "transient", recoverable: true,  action: "Wait a few seconds before retrying", calm: true };
  if (/dispatch.?flood/i.test(e))
    return { severity: "transient", recoverable: true,  action: "Slow down — commands are being sent too fast", calm: true };

  // Recoverable — needs operator action but state is not corrupted
  if (/permission denied|eacces|403/i.test(e))
    return { severity: "recoverable", recoverable: true,  action: "Check file permissions or re-authenticate", calm: false };
  if (/not found|enoent|404/i.test(e))
    return { severity: "recoverable", recoverable: true,  action: "Verify the path or run npm install", calm: false };
  if (/401|unauthorized/i.test(e))
    return { severity: "recoverable", recoverable: true,  action: "Refresh and log in again", calm: false };
  if (/syntax|unexpected token/i.test(e))
    return { severity: "recoverable", recoverable: true,  action: "Fix the syntax error and retry", calm: false };

  // Critical — data loss risk or unrecoverable state
  if (/heap out of memory|enomem/i.test(e))
    return { severity: "critical", recoverable: false, action: "Restart the backend: pm2 restart jarvis-backend", calm: false };
  if (/500|internal server/i.test(e))
    return { severity: "critical", recoverable: false, action: "Check pm2 logs jarvis-backend for the root cause", calm: false };
  if (/eaddrinuse/i.test(e))
    return { severity: "critical", recoverable: false, action: "Port conflict — another process is running on this port", calm: false };

  return { severity: "unknown", recoverable: true, action: "Check logs for details", calm: true };
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// Phase 307: explanation cache — avoids recomputing for identical commands during typing pauses
const _explanationCache = new Map();
const _CACHE_MAX = 30;

function _cachedAnalyze(cmd) {
  if (_explanationCache.has(cmd)) return _explanationCache.get(cmd);
  const result = {
    explanation:  explainCommand(cmd),
    saferVariant: suggestSaferVariant(cmd),
    consequences: explainConsequences(cmd),
  };
  if (_explanationCache.size >= _CACHE_MAX) {
    const firstKey = _explanationCache.keys().next().value;
    _explanationCache.delete(firstKey);
  }
  _explanationCache.set(cmd, result);
  return result;
}

// Phase 243: React hook — assistant state for current input
import { useState, useCallback } from "react";

export function useWorkflowAssistant() {
  const [explanation, setExplanation] = useState(null);
  const [saferVariant, setSaferVariant] = useState(null);
  const [recoverySuggestions, setRecoverySuggestions] = useState([]);
  const [consequences, setConsequences] = useState(null); // Phase 266

  const analyzeCommand = useCallback((cmd) => {
    if (!cmd.trim()) {
      setExplanation(null);
      setSaferVariant(null);
      setConsequences(null);
      return;
    }
    // Phase 307: use cache to avoid redundant recomputation
    const cached = _cachedAnalyze(cmd.trim());
    setExplanation(cached.explanation);
    setSaferVariant(cached.saferVariant);
    setConsequences(cached.consequences);
  }, []);

  const analyzeFailure = useCallback((errorMsg) => {
    setRecoverySuggestions(suggestRecovery(errorMsg));
  }, []);

  const clearAssistant = useCallback(() => {
    setExplanation(null);
    setSaferVariant(null);
    setRecoverySuggestions([]);
    setConsequences(null);
  }, []);

  return { explanation, saferVariant, recoverySuggestions, consequences, analyzeCommand, analyzeFailure, clearAssistant };
}
