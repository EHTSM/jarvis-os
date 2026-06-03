// Phase 247: Adaptive execution intelligence.
// Auto-adjusts retry timing, detects unstable workflows, confidence-aware pacing.
// Reads execution history to learn; all state is localStorage-only.

const HIST_KEY   = "jarvis_workflow_hist";
const MEMORY_KEY = "jarvis_execution_memory";

// Phase 247: compute adaptive retry delay for a command based on its failure history
// Returns delay in ms — backs off longer for chronically failing commands
export function getAdaptiveRetryDelay(cmd, attemptNumber = 1) {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const cmdHist = hist.filter(h => h.cmd === cmd);
    if (!cmdHist.length) return 1000 * attemptNumber; // default linear backoff

    const failRate = cmdHist.filter(h => !h.ok).length / cmdHist.length;
    // High fail rate = longer base delay; low fail rate = shorter
    const baseMs = failRate > 0.5 ? 3000 : failRate > 0.25 ? 1500 : 800;
    const jitter  = Math.random() * 400 - 200; // ±200ms jitter
    return Math.round(Math.min(baseMs * attemptNumber + jitter, 30_000));
  } catch { return 1000 * attemptNumber; }
}

// Phase 247: detect unstable workflows — commands that fail more than 50% of the time
export function detectUnstableWorkflows() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const mem  = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");

    const cmdMap = {};
    hist.forEach(h => {
      if (!cmdMap[h.cmd]) cmdMap[h.cmd] = { total: 0, fails: 0 };
      cmdMap[h.cmd].total++;
      if (!h.ok) cmdMap[h.cmd].fails++;
    });

    return Object.entries(cmdMap)
      .filter(([, v]) => v.total >= 3 && v.fails / v.total > 0.5)
      .map(([cmd, v]) => ({
        cmd,
        failRate: Math.round((v.fails / v.total) * 100),
        runs: v.total,
        label: cmd.length > 50 ? cmd.slice(0, 47) + "…" : cmd,
        risk: v.fails / v.total > 0.8 ? "high" : "medium",
      }))
      .sort((a, b) => b.failRate - a.failRate)
      .slice(0, 5);
  } catch { return []; }
}

// Phase 247: compute execution confidence score for a command (0–100)
// Factors: historical success rate, recency, pattern from memory
export function getExecutionConfidence(cmd) {
  if (!cmd) return null;
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const cmdHist = hist.filter(h => h.cmd === cmd);
    if (!cmdHist.length) return null;

    const successRate = cmdHist.filter(h => h.ok).length / cmdHist.length;
    const recency = cmdHist[0]?.ts ? Math.min(1, (Date.now() - cmdHist[0].ts) / (7 * 86_400_000)) : 0.5;
    const recencyPenalty = recency * 10; // older = less confident
    const confidence = Math.max(0, Math.round(successRate * 90 - recencyPenalty));

    return {
      confidence,
      label: confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low",
      color: confidence >= 80 ? "var(--op-green)" : confidence >= 50 ? "var(--op-amber)" : "var(--op-red)",
      runs: cmdHist.length,
      successRate: Math.round(successRate * 100),
    };
  } catch { return null; }
}

// Phase 247: get recommended pacing delay between workflow steps based on runtime health
// degraded: runtimeDegraded boolean from useRuntimeStream
export function getStepPacingMs(degraded = false, queueSize = 0) {
  if (degraded) return 2000;        // slow way down if runtime is stressed
  if (queueSize > 10) return 1200;  // back off under queue pressure
  if (queueSize > 5)  return 900;
  return 600;                        // healthy: fast pacing
}

// Phase 276: workflow risk score — 0 (safe) to 100 (critical) for a sequence of commands
export function scoreWorkflowRisk(cmds) {
  if (!cmds || !cmds.length) return { score: 0, label: "safe", color: "var(--op-green)" };

  const DANGEROUS = /rm -rf|drop (table|database)|kill -9|git push.*--force|git reset --hard/i;
  const ELEVATED  = /pm2 (stop|delete)|docker (rm|down)|kubectl delete/i;

  let score = 0;
  cmds.forEach(cmd => {
    if (DANGEROUS.test(cmd)) score += 35;
    else if (ELEVATED.test(cmd)) score += 15;
    else score += 2;
  });
  score = Math.min(100, score);

  const label = score >= 70 ? "critical" : score >= 40 ? "elevated" : score >= 15 ? "moderate" : "safe";
  const color = score >= 70 ? "var(--op-red)" : score >= 40 ? "var(--op-amber)" : score >= 15 ? "var(--op-blue)" : "var(--op-green)";
  return { score, label, color };
}

// Phase 276: rollback probability — how likely is it that this dispatch will need to be undone?
export function estimateRollbackProbability(cmd) {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const cmdHist = hist.filter(h => h.cmd === cmd);
    if (!cmdHist.length) {
      // No history — estimate from command pattern
      if (/rm -rf|drop|kill -9/.test(cmd)) return { probability: 60, basis: "pattern" };
      if (/restart|stop/.test(cmd))         return { probability: 20, basis: "pattern" };
      return { probability: 5, basis: "pattern" };
    }
    const failRate = cmdHist.filter(h => !h.ok).length / cmdHist.length;
    return { probability: Math.round(failRate * 80), basis: "history", runs: cmdHist.length };
  } catch { return { probability: 10, basis: "unknown" }; }
}

// Phase 268: confidence-aware retry guard — should we retry at all given history?
export function shouldRetry(cmd, attempt, maxAttempts = 3) {
  if (attempt >= maxAttempts) return false;
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const cmdHist = hist.filter(h => h.cmd === cmd);
    if (cmdHist.length < 3) return true; // not enough data, allow retries
    const failRate = cmdHist.filter(h => !h.ok).length / cmdHist.length;
    // If command fails >80% historically, stop retrying after 1 attempt to avoid spam
    if (failRate > 0.8 && attempt >= 1) return false;
    return true;
  } catch { return attempt < maxAttempts; }
}

// Phase 268: compute dynamic max retries based on command confidence
export function getAdaptiveMaxRetries(cmd) {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const cmdHist = hist.filter(h => h.cmd === cmd);
    if (!cmdHist.length) return 2; // default
    const failRate = cmdHist.filter(h => !h.ok).length / cmdHist.length;
    if (failRate > 0.7) return 1;  // chronically failing — limit retries
    if (failRate < 0.2) return 3;  // reliable — allow more retries on transient failure
    return 2;
  } catch { return 2; }
}

// Phase 330: local AI routing — classify task complexity and select reasoning depth
// Routes are: "light" (pattern match only), "standard" (heuristic), "deep" (full analysis)
// Degraded runtime always falls back to "light" to avoid adding load.
export function selectLocalRoute(cmd, { degraded = false, queueSize = 0 } = {}) {
  if (degraded || queueSize > 15) return { route: "light", reason: "degraded runtime — minimal reasoning" };
  if (!cmd) return { route: "light", reason: "no command" };

  const c = cmd.trim().toLowerCase();

  // Destructive / high-risk → deep analysis before proceeding
  if (/rm -rf|drop (table|database)|git push.*--force|git reset --hard|kill -9/.test(c))
    return { route: "deep", reason: "destructive command — full analysis required" };

  // Build/deploy pipelines → standard analysis
  if (/npm run build|npm test|docker (build|up|compose)|kubectl (apply|deploy)/.test(c))
    return { route: "standard", reason: "operational command — heuristic analysis" };

  // Read-only observation → light (pattern match only, no overhead)
  if (/pm2 list|pm2 status|git status|git log|df -h|ls |cat |npm run check-health/.test(c))
    return { route: "light", reason: "informational command — pattern match only" };

  // Long commands with pipes/complex logic → standard
  if (cmd.length > 80 || /&&|\|{1,2}|;/.test(cmd))
    return { route: "standard", reason: "complex command — heuristic analysis" };

  return { route: "light", reason: "simple command — pattern match" };
}

// Phase 323: operator overload detection — too many dispatches in a short window
// Returns overload level and recommended action
export function detectOperatorOverload() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const fiveMinMs = 5 * 60 * 1000;
    const recent = hist.filter(h => Date.now() - h.ts < fiveMinMs);
    const failRate = recent.length > 0 ? recent.filter(h => !h.ok).length / recent.length : 0;

    if (recent.length >= 12 && failRate > 0.4)
      return { level: "high", msg: "Many failures in 5 minutes — consider pausing and reviewing logs", slowdownMs: 2000 };
    if (recent.length >= 8 && failRate > 0.25)
      return { level: "medium", msg: "Elevated failure rate — pacing retries", slowdownMs: 1000 };
    if (recent.length >= 15)
      return { level: "medium", msg: "High dispatch volume — consider queuing lower-priority tasks", slowdownMs: 500 };
    return null;
  } catch { return null; }
}

// Phase 305: queue congestion detection — returns congestion signal from queue size + recent retry rate
export function detectQueueCongestion(queueSize = 0, recentRetryRate = 0) {
  if (queueSize > 25 || recentRetryRate > 40)
    return { level: "high",   delay: 3000, msg: "Queue congested — slowing retry cadence" };
  if (queueSize > 10 || recentRetryRate > 20)
    return { level: "medium", delay: 1500, msg: "Queue pressure detected — pacing retries" };
  return { level: "none",   delay: 0,    msg: null };
}

// Phase 305: command priority classification — critical commands bypass delay gates
export function classifyCommandPriority(cmd) {
  if (!cmd) return "normal";
  const c = cmd.toLowerCase();
  if (/pm2 restart|pm2 list|npm run check-health/.test(c)) return "critical";
  if (/pm2 logs|git status|df -h/.test(c))                  return "observation";
  if (/npm run build|npm test|docker (build|up)/.test(c))   return "high";
  if (/rm -rf|drop (table|database)|kill -9/.test(c))       return "dangerous";
  return "normal";
}

// Phase 247: React hook
import { useState, useEffect, useCallback } from "react";

export function useAdaptiveExecution({ degraded = false, queueSize = 0 } = {}) {
  const [unstableWorkflows, setUnstableWorkflows] = useState([]);

  useEffect(() => {
    setUnstableWorkflows(detectUnstableWorkflows());
  }, []);

  const getRetryDelay  = useCallback((cmd, attempt) => getAdaptiveRetryDelay(cmd, attempt), []);
  const getConfidence  = useCallback((cmd) => getExecutionConfidence(cmd), []);
  const getPacing      = useCallback(() => getStepPacingMs(degraded, queueSize), [degraded, queueSize]);
  const checkRetry     = useCallback((cmd, attempt, max) => shouldRetry(cmd, attempt, max), []); // Phase 268
  const getMaxRetries  = useCallback((cmd) => getAdaptiveMaxRetries(cmd), []); // Phase 268

  const getCongestion    = useCallback((queueSize, retryRate) => detectQueueCongestion(queueSize, retryRate), []); // Phase 305
  const getPriority      = useCallback((cmd) => classifyCommandPriority(cmd), []); // Phase 305
  const getOverloadState = useCallback(() => detectOperatorOverload(), []);                           // Phase 323
  const getRoute         = useCallback((cmd, opts) => selectLocalRoute(cmd, opts), [degraded, queueSize]); // Phase 330

  return { unstableWorkflows, getRetryDelay, getConfidence, getPacing, checkRetry, getMaxRetries, getCongestion, getPriority, getOverloadState, getRoute };
}
