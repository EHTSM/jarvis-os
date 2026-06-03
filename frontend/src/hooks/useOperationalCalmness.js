// Phase 341: Operational calmness layer — extracted from WorkflowPanel.
// Owns: command analysis (risk/security/type), execution certainty messaging,
//       plain-English error translation, failure severity classification.
// Pure computation — no state, no effects, no localStorage. All functions are stable refs.

import { useCallback, useMemo } from "react";
import { classifyFailure } from "./useWorkflowAssistant";

// Phase 393: expanded dangerous command list
const DANGEROUS_CMDS = [
  "rm -rf", "drop table", "drop database", "shutdown", "reboot", "kill ",
  "mkfs", "dd if=", "> /dev/", "format c:", "truncate --size=0",
  "git push --force", "git push -f ", "git reset --hard",
  "chmod -R 777", "chmod 777 /", "chown -R root",
  "pkill -9", "killall -9",
];

const INFORMATIONAL_PATTERNS = [
  /^(pm2 list|pm2 status|pm2 monit|pm2 logs)/i,
  /^(git status|git log|git diff|git show)/i,
  /^(df -h|du -sh|free -h|top|htop|ps aux)/i,
  /^(ls |cat |head |tail )/i,
  /^(npm run check-health)/i,
];

const SHELL_PREFIXES = ["node ", "npm ", "git ", "pm2 ", "ls ", "cat ", "grep ", "mkdir ", "rm ", "cp ", "mv "];

// Stable — pure function, no deps
function _analyzeCmd(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const isShell = trimmed.startsWith("./") || trimmed.startsWith("/") || SHELL_PREFIXES.some(p => trimmed.startsWith(p));
  const isInformational = INFORMATIONAL_PATTERNS.some(p => p.test(trimmed));

  let risk = { label: "SAFE", color: "var(--op-green)", level: 0 };
  if (!isInformational && DANGEROUS_CMDS.some(d => lower.includes(d)))
    risk = { label: "DANGEROUS", color: "var(--op-red)", level: 3 };
  else if (!isInformational && (lower.includes("restart") || lower.includes("build") || lower.includes("install")))
    risk = { label: "OPERATIONAL", color: "var(--op-blue)", level: 1 };
  else if (!isInformational && (lower.includes("push") || lower.includes("delete") || lower.includes("prune")))
    risk = { label: "ELEVATED", color: "var(--op-amber)", level: 2 };

  const securityWarnings = [];
  if (/(?:key|token|secret|password|passwd|api[-_]?key)\s*[=:]\s*\S{16,}/i.test(trimmed))
    securityWarnings.push("Command appears to contain a credential — avoid embedding secrets in commands");
  if (/--force|--no-verify|--no-gpg-sign/i.test(trimmed))
    securityWarnings.push("Force flag detected — bypasses safety checks");
  if (/\bsudo\b/.test(lower))
    securityWarnings.push("sudo escalation — ensure you trust this command before running");
  // Phase 393: filesystem protection warnings
  if (/rm\s+(-[a-z]*f[a-z]*\s+)?\//.test(trimmed))
    securityWarnings.push("Deleting from root path — double-check target before running");
  if (/>\s*(\/etc|\/usr|\/bin|\/sbin|\/lib|\/boot)/.test(trimmed))
    securityWarnings.push("Writing to system directory — this could break the OS");
  if (/chmod\s+[0-7]*7[0-7][0-7]\s+\//.test(trimmed))
    securityWarnings.push("Setting world-writable permissions on system path");
  // Phase 393: runaway workflow detection
  if (/while\s+true|for.*in.*\$\(.*\$\(|>\&1.*2>\&1.*\|.*nohup/i.test(trimmed))
    securityWarnings.push("Command pattern may run indefinitely — ensure there is a termination condition");
  if ((trimmed.match(/&&/g) || []).length > 6)
    securityWarnings.push("Long command chain — consider breaking into separate steps for better error isolation");

  return {
    isShell, isInformational,
    typeLabel: isShell ? "Direct Shell" : "AI Prompt",
    typeIcon: isShell ? "🐚" : "🧠",
    typeColor: isShell ? "var(--op-blue)" : "var(--op-purple)",
    risk, securityWarnings,
  };
}

// Execution certainty: calm operator-facing message before dispatch
function _executionCertainty(cmd, busy, dryRun, riskLevel) {
  if (!cmd || busy) return null;
  if (dryRun)       return { text: "Preview only — nothing will run.", color: "var(--op-accent)" };
  if (riskLevel === 3) return { text: "This command can't be undone. Confirm before running.", color: "var(--op-amber)" };
  if (riskLevel === 2) return { text: "This command modifies the system. Results appear in the Execution Log.", color: "var(--op-blue)" };
  return null;
}

// Plain-English error translation — stable, no deps
function _humanizeError(raw) {
  if (!raw) return "Something went wrong. Try again.";
  const r = raw.toLowerCase();
  if (r.includes("econnrefused") || r.includes("network"))
    return "Can't reach the backend. Check that the server is running: pm2 list";
  if (r.includes("timeout") || r.includes("timed out"))
    return "The command took too long and was stopped. Try increasing the timeout, or check if the backend is overloaded.";
  if (r.includes("permission denied") || r.includes("eacces"))
    return "Permission denied. You may need elevated privileges — try prefixing with sudo, or check file ownership.";
  if (r.includes("not found") || r.includes("enoent"))
    return "File or command not found. Double-check the path or run npm install if it's a missing package.";
  if (r.includes("syntax") || r.includes("unexpected token"))
    return "Syntax error in the command. Check for typos, unmatched quotes, or missing semicolons.";
  if (r.includes("401") || r.includes("unauthorized"))
    return "Authentication failed — your session may have expired. Refresh the page and log in again.";
  if (r.includes("403") || r.includes("forbidden"))
    return "Access denied. You don't have permission for this operation.";
  if (r.includes("404"))
    return "Resource not found. Check the URL or file path.";
  if (r.includes("500") || r.includes("internal server"))
    return "Backend error. Check pm2 logs jarvis-backend for details.";
  if (r.includes("429") || r.includes("rate limit"))
    return "Too many requests — wait a moment and try again.";
  if (r.includes("dispatch flood"))
    return "Commands are being sent too quickly. Wait a moment before dispatching again.";
  if (r.includes("heap out of memory") || r.includes("enomem"))
    return "Out of memory. Restart the backend: pm2 restart jarvis-backend";
  if (r.includes("eaddrinuse"))
    return "Port is already in use. Another process may be running on the same port.";
  if (r.includes("cancelled"))
    return "Command was cancelled before completing.";
  return raw.slice(0, 140);
}

// Phase 341: hook — stable function refs + memoized analysis per input
// input: raw string (not debounced — cmdAnalysis must track live input for risk badge)
// debouncedCmd: debounced string — used for certainty (avoids flicker while typing)
export function useOperationalCalmness({ input = "", debouncedCmd = "", busy = false, dryRun = false } = {}) {
  const cmdAnalysis = useMemo(() => _analyzeCmd(input), [input]);

  const executionCertainty = useMemo(
    () => _executionCertainty(debouncedCmd, busy, dryRun, cmdAnalysis?.risk.level ?? 0),
    [debouncedCmd, busy, dryRun, cmdAnalysis?.risk.level]
  );

  // Stable callback refs — never change, safe to pass down without triggering rerenders
  const humanizeError = useCallback(_humanizeError, []);
  const classifyResultFailure = useCallback(classifyFailure, []);

  return { cmdAnalysis, executionCertainty, humanizeError, classifyResultFailure };
}
