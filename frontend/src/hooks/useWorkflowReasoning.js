// Phase 261: Workflow reasoning engine.
// Detects intent, infers goals, explains execution dependencies, predicts next actions.
// All inference is local — pattern matching over history and memory. No external calls.

const HIST_KEY   = "jarvis_workflow_hist";
const MEMORY_KEY = "jarvis_execution_memory";
const CHAINS_KEY = "jarvis_workflow_chains";

// Phase 261: intent taxonomy — maps command patterns to high-level operator goals
const INTENT_PATTERNS = [
  { pattern: /pm2 (restart|reload)/i,        intent: "recovery",     goal: "Restore a service to a healthy state" },
  { pattern: /pm2 (stop|delete)/i,            intent: "shutdown",     goal: "Stop a managed process" },
  { pattern: /pm2 (list|status|monit)/i,      intent: "observation",  goal: "Check process health" },
  { pattern: /pm2 logs/i,                     intent: "debugging",    goal: "Inspect recent process output" },
  { pattern: /npm (run build|build)/i,        intent: "deployment",   goal: "Build the application for release" },
  { pattern: /npm (test|run test)/i,          intent: "validation",   goal: "Verify code correctness" },
  { pattern: /npm (install|i\b)/i,            intent: "setup",        goal: "Install or update dependencies" },
  { pattern: /npm run (lint|format)/i,        intent: "quality",      goal: "Enforce code style and catch issues" },
  { pattern: /git (pull|fetch)/i,             intent: "sync",         goal: "Synchronize with remote changes" },
  { pattern: /git (push)/i,                   intent: "publish",      goal: "Publish local commits" },
  { pattern: /git (status|log|diff)/i,        intent: "observation",  goal: "Review current repository state" },
  { pattern: /git (commit)/i,                 intent: "checkpoint",   goal: "Save a snapshot of current work" },
  { pattern: /rm -rf/i,                       intent: "cleanup",      goal: "Permanently remove files or directories" },
  { pattern: /docker (build|run|up)/i,        intent: "deployment",   goal: "Build or start a Docker container" },
  { pattern: /docker (stop|rm|down)/i,        intent: "shutdown",     goal: "Stop and remove containers" },
  { pattern: /kubectl (apply|deploy)/i,       intent: "deployment",   goal: "Deploy to Kubernetes" },
  { pattern: /kubectl (get|describe)/i,       intent: "observation",  goal: "Inspect Kubernetes resources" },
  { pattern: /curl|wget/i,                    intent: "probe",        goal: "Test an HTTP endpoint or download" },
  { pattern: /node -e|node --eval/i,          intent: "debugging",    goal: "Run an inline Node.js expression" },
  { pattern: /npm run (dev|start)/i,          intent: "development",  goal: "Start the development server" },
  { pattern: /npm run check-health/i,         intent: "observation",  goal: "Verify system health" },
];

// Phase 303: command classification — separates read-only from mutating commands
const INFORMATIONAL_PATTERNS = [
  /^(pm2 list|pm2 status|pm2 monit)/i,
  /^(git status|git log|git diff|git show)/i,
  /^(df -h|du -sh|free -h|top|htop|ps aux)/i,
  /^(ls |cat |head |tail |less |more )/i,
  /^(curl.*-[sI]|wget --spider)/i,
  /^(npm run check-health|pm2 logs)/i,
  /^(kubectl get|kubectl describe)/i,
];

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-[rf]+/i,
  /drop\s+(table|database|schema)/i,
  /git\s+push.*--force/i,
  /git\s+reset\s+--hard/i,
  /kubectl\s+delete/i,
  /pm2\s+(delete|kill)/i,
  /docker\s+(rm|rmi|system prune)/i,
  /\btruncate\b/i,
];

// Phase 261 + 303: detect workflow intent from a command string
// Returns intent + goal + informational + destructive classification
export function detectIntent(cmd) {
  if (!cmd) return null;
  const isInformational = INFORMATIONAL_PATTERNS.some(p => p.test(cmd.trim()));
  const isDestructive   = DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
  // Phase 303: rollback-awareness — destructive cmds with no sudo/dry-run guard
  const needsRollbackPlan = isDestructive && !/--dry-run|--no-execute|-n\b/i.test(cmd);

  for (const { pattern, intent, goal } of INTENT_PATTERNS) {
    if (pattern.test(cmd)) return { intent, goal, isInformational, isDestructive, needsRollbackPlan };
  }
  return { intent: "general", goal: "Execute a shell operation", isInformational, isDestructive, needsRollbackPlan };
}

// Phase 261: infer workflow goal from a sequence of commands
export function inferWorkflowGoal(cmds) {
  if (!cmds || !cmds.length) return null;
  const intents = cmds.map(c => detectIntent(c)?.intent).filter(Boolean);
  const freq = {};
  intents.forEach(i => { freq[i] = (freq[i] || 0) + 1; });
  const dominant = Object.entries(freq).sort(([,a],[,b]) => b - a)[0];
  if (!dominant) return null;

  const goalMap = {
    deployment:  "Deploy a new version of the application",
    recovery:    "Restore services to a healthy state",
    debugging:   "Investigate and diagnose an issue",
    validation:  "Verify correctness before shipping",
    observation: "Monitor system health and status",
    setup:       "Prepare the environment for development",
    sync:        "Synchronize with upstream changes",
    quality:     "Improve code quality and consistency",
    cleanup:     "Clean up resources or stale state",
  };
  return goalMap[dominant[0]] || "Execute a multi-step operational workflow";
}

// Phase 261: explain execution dependencies between commands
// Returns: which commands should run before this one for best results
export function explainDependencies(cmd) {
  if (!cmd) return [];
  const c = cmd.toLowerCase().trim();
  const deps = [];

  if (/npm run (build|test|lint)/.test(c))
    deps.push({ cmd: "npm install", reason: "Ensure dependencies are up-to-date before running scripts" });
  if (/npm run build/.test(c))
    deps.push({ cmd: "npm run lint", reason: "Catch syntax errors before the build step" });
  if (/git push/.test(c))
    deps.push({ cmd: "npm test", reason: "Verify tests pass before publishing" });
  if (/git push/.test(c))
    deps.push({ cmd: "git pull", reason: "Fetch remote changes to avoid conflicts" });
  if (/pm2 restart/.test(c))
    deps.push({ cmd: "npm run build", reason: "Ensure the latest build is deployed before restarting" });
  if (/docker run|docker up/.test(c))
    deps.push({ cmd: "docker build", reason: "Build the image before running it" });
  if (/kubectl apply/.test(c))
    deps.push({ cmd: "kubectl get nodes", reason: "Confirm cluster is reachable before deploying" });

  return deps;
}

// Phase 261: predict likely next actions from current command and history
export function predictNextFromHistory(cmd) {
  if (!cmd) return [];
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    // Find all commands that followed this one in history
    const followMap = {};
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i + 1].cmd === cmd && hist[i].ok) {
        followMap[hist[i].cmd] = (followMap[hist[i].cmd] || 0) + 1;
      }
    }
    return Object.entries(followMap)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 4)
      .map(([c, count]) => ({
        cmd: c,
        count,
        intent: detectIntent(c)?.intent || "general",
        label: c.length > 55 ? c.slice(0, 52) + "…" : c,
      }));
  } catch { return []; }
}

// Phase 283: workflow simplification — detect redundant/duplicated steps in a macro list
export function detectRedundantSteps(macros) {
  if (!macros || macros.length < 2) return [];
  const issues = [];
  const seen = new Set();

  macros.forEach((m, i) => {
    // Exact duplicate commands
    if (seen.has(m.cmd)) {
      issues.push({ idx: i, type: "duplicate", msg: `Step "${m.name}" runs the same command as an earlier step`, cmd: m.cmd });
    }
    seen.add(m.cmd);

    // Redundant install before install (two npm installs)
    if (i > 0 && /npm (install|i\b)/.test(m.cmd) && /npm (install|i\b)/.test(macros[i - 1].cmd)) {
      issues.push({ idx: i, type: "redundant", msg: "Two consecutive npm install steps — the second is unnecessary", cmd: m.cmd });
    }

    // Status check after restart (pm2 list right after pm2 restart is fine — but TWO restarts is waste)
    if (i > 0 && /pm2 restart/.test(m.cmd) && /pm2 restart/.test(macros[i - 1].cmd)) {
      issues.push({ idx: i, type: "redundant", msg: "Two consecutive pm2 restart steps — consider merging", cmd: m.cmd });
    }

    // Build without prior lint (higher risk)
    if (/npm run build/.test(m.cmd)) {
      const hasLint = macros.slice(0, i).some(prev => /npm run lint/.test(prev.cmd));
      if (!hasLint) issues.push({ idx: i, type: "suggestion", msg: "Build runs without a prior lint step — consider adding lint first", cmd: m.cmd });
    }
  });

  return issues;
}

// Phase 270: AI-assisted workflow generation — generate dependency-aware workflow drafts
const WORKFLOW_TEMPLATES = {
  deployment: [
    { name: "Lint code",         cmd: "npm run lint",            timeout: "30",  priority: "1" },
    { name: "Run tests",         cmd: "npm test",                timeout: "90",  priority: "1" },
    { name: "Build app",         cmd: "npm run build",           timeout: "180", priority: "2" },
    { name: "Restart backend",   cmd: "pm2 restart jarvis-backend", timeout: "30", priority: "2" },
    { name: "Verify health",     cmd: "npm run check-health",    timeout: "15",  priority: "1" },
  ],
  recovery: [
    { name: "Check process list",  cmd: "pm2 list",              timeout: "10",  priority: "1" },
    { name: "Tail recent logs",    cmd: "pm2 logs jarvis-backend --lines 30 --noprefix", timeout: "15", priority: "1" },
    { name: "Restart backend",     cmd: "pm2 restart jarvis-backend", timeout: "30", priority: "2" },
    { name: "Verify health",       cmd: "npm run check-health",  timeout: "15",  priority: "1" },
  ],
  validation: [
    { name: "Install deps",      cmd: "npm install",             timeout: "120", priority: "2" },
    { name: "Lint",              cmd: "npm run lint",            timeout: "30",  priority: "1" },
    { name: "Test",              cmd: "npm test",                timeout: "90",  priority: "1" },
  ],
  sync: [
    { name: "Pull remote",       cmd: "git pull",                timeout: "30",  priority: "1" },
    { name: "Install deps",      cmd: "npm install",             timeout: "120", priority: "2" },
    { name: "Run tests",         cmd: "npm test",                timeout: "90",  priority: "1" },
  ],
  observation: [
    { name: "Process status",    cmd: "pm2 list",                timeout: "10",  priority: "1" },
    { name: "Recent logs",       cmd: "pm2 logs --lines 20 --noprefix", timeout: "15", priority: "1" },
    { name: "Health check",      cmd: "npm run check-health",    timeout: "15",  priority: "1" },
  ],
};

export function generateWorkflowDraft(goalIntent) {
  const template = WORKFLOW_TEMPLATES[goalIntent];
  if (!template) return null;
  return {
    id:     `draft-${goalIntent}-${Date.now()}`,
    name:   `Auto: ${goalIntent.charAt(0).toUpperCase() + goalIntent.slice(1)} Workflow`,
    macros: template,
    draft:  true,
    generatedAt: new Date().toISOString(),
  };
}

// Phase 327: workflow complexity estimator — returns complexity tier + estimated duration
const DURATION_HINTS = [
  { pattern: /npm run build/i,          minS: 30,  maxS: 180, label: "build" },
  { pattern: /npm test/i,               minS: 15,  maxS: 120, label: "tests" },
  { pattern: /npm install/i,            minS: 20,  maxS: 90,  label: "install" },
  { pattern: /npm run lint/i,           minS: 5,   maxS: 30,  label: "lint" },
  { pattern: /pm2 restart/i,            minS: 2,   maxS: 15,  label: "restart" },
  { pattern: /pm2 list|git status/i,    minS: 1,   maxS: 3,   label: "status" },
  { pattern: /git (push|pull)/i,        minS: 3,   maxS: 30,  label: "git sync" },
  { pattern: /docker (build|up)/i,      minS: 30,  maxS: 300, label: "docker" },
  { pattern: /kubectl (apply|deploy)/i, minS: 10,  maxS: 60,  label: "k8s deploy" },
];

export function estimateWorkflowPlan(cmds = []) {
  if (!cmds.length) return null;

  let totalMinS = 0, totalMaxS = 0;
  const steps = cmds.map(cmd => {
    const hint = DURATION_HINTS.find(h => h.pattern.test(cmd));
    const minS = hint?.minS ?? 2;
    const maxS = hint?.maxS ?? 15;
    totalMinS += minS;
    totalMaxS += maxS;
    return { cmd: cmd.slice(0, 50), label: hint?.label || "general", minS, maxS };
  });

  const complexity = cmds.length >= 6 ? "high"
                   : cmds.length >= 3 ? "medium"
                   : "low";

  const fmtDur = (s) => s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;

  return {
    steps,
    complexity,
    estimatedMin: fmtDur(totalMinS),
    estimatedMax: fmtDur(totalMaxS),
    stepCount: cmds.length,
  };
}

// Phase 333: workflow quality scoring — rate a macro list 0–100 for maintainability
// Deducts points for: no timeouts, very long commands, missing names, redundant steps, dangerous ops
export function scoreWorkflowQuality(macros = []) {
  if (!macros.length) return { score: 0, label: "empty", issues: [] };

  let score = 100;
  const issues = [];

  const cmds = macros.map(m => m.cmd || "");
  const names = macros.map(m => m.name || "");

  // Missing names
  const unnamed = macros.filter(m => !m.name?.trim()).length;
  if (unnamed > 0) { score -= unnamed * 5; issues.push(`${unnamed} step(s) missing names`); }

  // Missing timeouts
  const noTimeout = macros.filter(m => !m.timeout || m.timeout === "0").length;
  if (noTimeout > 0) { score -= noTimeout * 4; issues.push(`${noTimeout} step(s) without timeout`); }

  // Duplicate commands
  const cmdSet = new Set();
  cmds.forEach((c, i) => {
    if (cmdSet.has(c)) { score -= 10; issues.push(`Duplicate command at step ${i + 1}`); }
    cmdSet.add(c);
  });

  // Very long commands (hard to audit)
  cmds.forEach((c, i) => {
    if (c.length > 150) { score -= 5; issues.push(`Step ${i + 1} command is very long — consider splitting`); }
  });

  // Dangerous ops without high priority
  cmds.forEach((c, i) => {
    if (/rm -rf|drop (table|database)|kill -9/.test(c) && macros[i].priority !== "0") {
      score -= 8; issues.push(`Step ${i + 1} is destructive — consider setting priority 0`);
    }
  });

  // Redundant consecutive patterns (from detectRedundantSteps)
  const redundant = detectRedundantSteps(macros);
  score -= redundant.filter(r => r.type === "redundant").length * 6;
  redundant.filter(r => r.type === "redundant").forEach(r => issues.push(r.msg));

  score = Math.max(0, Math.min(100, score));
  const label = score >= 85 ? "good" : score >= 65 ? "fair" : "needs work";
  return { score, label, issues };
}

// Phase 261: React hook
import { useState, useCallback, useMemo } from "react";

export function useWorkflowReasoning(currentCmd) {
  const intentInfo = useMemo(() => detectIntent(currentCmd), [currentCmd]);
  const dependencies = useMemo(() => explainDependencies(currentCmd), [currentCmd]);
  const predictions = useMemo(() => predictNextFromHistory(currentCmd), [currentCmd]);

  const inferGoalFromSequence = useCallback((cmds) => inferWorkflowGoal(cmds), []);
  const generateDraft         = useCallback((intent) => generateWorkflowDraft(intent), []); // Phase 270
  const planWorkflow          = useCallback((cmds) => estimateWorkflowPlan(cmds), []);      // Phase 327
  const qualityScore          = useCallback((macros) => scoreWorkflowQuality(macros), []);  // Phase 333

  return { intentInfo, dependencies, predictions, inferGoalFromSequence, generateDraft, planWorkflow, qualityScore };
}
