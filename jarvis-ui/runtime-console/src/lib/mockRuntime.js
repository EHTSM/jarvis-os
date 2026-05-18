/**
 * mockRuntime — generates deterministic-ish runtime state that mirrors the
 * real orchestration + observability module schemas.
 * Used by the Zustand store to simulate live runtime data.
 */

const ADAPTER_TYPES   = ["terminal", "filesystem", "git", "vscode", "docker", "browser"];
const SUBSYSTEMS      = ["executor", "policy", "sandbox", "scheduler", "recovery", "audit"];
const AUTHORITY_LEVELS = ["observer", "operator", "controller", "governor", "root-runtime"];
const PRIORITY_CLASSES = ["low", "normal", "high", "critical", "emergency"];
const PRESSURE_STATES  = ["nominal", "elevated", "active", "critical"];
const EXEC_STAGES      = ["queued", "validated", "authorized", "sandboxed", "executing", "completed", "failed"];

let _seed = 42;
function rng() { _seed = (_seed * 1664525 + 1013904223) & 0xffffffff; return Math.abs(_seed) / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function ri(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function rf(min, max, dp = 2) { return parseFloat((rng() * (max - min) + min).toFixed(dp)); }

let _execCounter = 1000;
let _wfCounter   = 100;
let _agentCounter = 1;

// ── queue state ────────────────────────────────────────────────────────

export function generateQueueState() {
  return {
    default:  { depth: ri(0, 40),  capacity: 1000, utilization: 0, state: "healthy" },
    priority: { depth: ri(0, 15),  capacity: 1000, utilization: 0, state: "healthy" },
    recovery: { depth: ri(0, 8),   capacity: 1000, utilization: 0, state: "healthy" },
    retry:    { depth: ri(0, 12),  capacity: 1000, utilization: 0, state: "healthy" },
  };
}

// ── active executions ──────────────────────────────────────────────────

export function generateActiveExecutions(count = 8) {
  return Array.from({ length: count }, (_, i) => {
    const startMs = Date.now() - ri(100, 15000);
    return {
      executionId:    `ex-${_execCounter++}`,
      workflowId:     `wf-${ri(100, 120)}`,
      adapterType:    pick(ADAPTER_TYPES),
      capability:     pick(["execute_command", "read_file", "git_status", "navigate_url"]),
      subsystem:      pick(SUBSYSTEMS),
      authorityLevel: pick(AUTHORITY_LEVELS),
      priorityClass:  pick(PRIORITY_CLASSES),
      stage:          pick(["executing", "sandboxed", "authorized", "validated"]),
      elapsedMs:      Date.now() - startMs,
      startedAt:      new Date(startMs).toISOString(),
      riskScore:      rf(0, 0.8),
      retryCount:     ri(0, 3),
    };
  });
}

// ── timeline entries ───────────────────────────────────────────────────

export function generateTimelineEntries(count = 20) {
  return Array.from({ length: count }, (_, i) => {
    const stages = [];
    let ts = Date.now() - ri(2000, 60000);
    const stageList = ["queued", "validated", "authorized", "sandboxed", "executing",
      rng() > 0.2 ? "completed" : "failed"];
    for (const stage of stageList) {
      const dur = ri(10, stage === "executing" ? 3000 : 500);
      stages.push({ stage, timestamp: new Date(ts).toISOString(), durationMs: dur });
      ts += dur;
    }
    return {
      executionId:  `ex-${_execCounter++}`,
      workflowId:   `wf-${ri(100, 115)}`,
      adapterType:  pick(ADAPTER_TYPES),
      stages,
      terminalState: stages[stages.length - 1].stage,
      startedAt:    stages[0].timestamp,
      completedAt:  stages[stages.length - 1].timestamp,
      totalMs:      stages.reduce((s, st) => s + st.durationMs, 0),
    };
  });
}

// ── workflow dependency graph ──────────────────────────────────────────

export function generateWorkflowGraph() {
  const nodes = [
    { id: "ex-A", label: "git_status",       adapterType: "git",        status: "completed", x: 80,  y: 150 },
    { id: "ex-B", label: "read_file",         adapterType: "filesystem", status: "completed", x: 80,  y: 280 },
    { id: "ex-C", label: "execute_command",   adapterType: "terminal",   status: "executing", x: 280, y: 100 },
    { id: "ex-D", label: "edit_file",         adapterType: "vscode",     status: "executing", x: 280, y: 220 },
    { id: "ex-E", label: "docker inspect",    adapterType: "docker",     status: "queued",    x: 280, y: 340 },
    { id: "ex-F", label: "capture_screenshot",adapterType: "browser",    status: "queued",    x: 480, y: 160 },
    { id: "ex-G", label: "git_commit",        adapterType: "git",        status: "queued",    x: 480, y: 280 },
  ];
  const edges = [
    { from: "ex-A", to: "ex-C" }, { from: "ex-A", to: "ex-D" },
    { from: "ex-B", to: "ex-D" }, { from: "ex-B", to: "ex-E" },
    { from: "ex-C", to: "ex-F" }, { from: "ex-D", to: "ex-G" },
    { from: "ex-E", to: "ex-G" },
  ];
  return { nodes, edges };
}

// ── pressure state ─────────────────────────────────────────────────────

export function generatePressureState(tick = 0) {
  const rate = 0.05 + Math.abs(Math.sin(tick * 0.08)) * 0.35;
  const state = rate >= 0.5 ? "critical" : rate >= 0.3 ? "active" : rate >= 0.15 ? "elevated" : "nominal";
  return {
    state,
    errorRate:     parseFloat(rate.toFixed(3)),
    windowSignals: ri(20, 80),
    overridden:    false,
  };
}

export function generatePressureHistory(ticks = 40) {
  return Array.from({ length: ticks }, (_, i) => {
    const rate = 0.05 + Math.abs(Math.sin(i * 0.2)) * 0.4 + rf(-0.03, 0.03);
    return {
      t:         i,
      errorRate: Math.max(0, Math.min(1, parseFloat(rate.toFixed(3)))),
      label:     `-${(ticks - i) * 3}s`,
    };
  });
}

// ── agent activity feed ────────────────────────────────────────────────

const AGENT_EVENTS = [
  "execution_submitted", "execution_completed", "execution_failed",
  "workflow_started",    "workflow_completed",  "policy_event",
  "circuit_event",       "sandbox_event",       "recovery_event",
  "audit_event",
];

export function generateAgentEvent(seq) {
  const ts = new Date(Date.now() - ri(0, 5000)).toISOString();
  const eventType = pick(AGENT_EVENTS);
  const outcome   = eventType.includes("failed") ? "failed"
    : eventType.includes("completed") ? "completed"
    : "ok";
  return {
    id:         `evt-${seq}`,
    eventType,
    subsystem:  pick(SUBSYSTEMS),
    adapterType: pick(ADAPTER_TYPES),
    workflowId: `wf-${ri(100, 120)}`,
    outcome,
    timestamp:  ts,
  };
}

export function generateAgentFeed(count = 30) {
  return Array.from({ length: count }, (_, i) => generateAgentEvent(i + 1))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ── recovery / retry panel ─────────────────────────────────────────────

export function generateRetrySchedule(count = 8) {
  return Array.from({ length: count }, (_, i) => {
    const isRecovery = rng() > 0.5;
    const runAt      = new Date(Date.now() + ri(500, 60000)).toISOString();
    return {
      scheduleId:     `sched-${100 + i}`,
      workflowId:     `wf-${ri(100, 120)}`,
      type:           isRecovery ? "recovery" : "retry",
      retryCount:     isRecovery ? 0 : ri(1, 4),
      priorityScore:  ri(30, 90),
      scheduledAt:    runAt,
      sourceSubsystem: pick(SUBSYSTEMS),
      state:          rng() > 0.3 ? "scheduled" : "fired",
    };
  });
}

// ── orchestration health ───────────────────────────────────────────────

export function generateOrchestrationHealth(tick = 0) {
  const subsystems = SUBSYSTEMS.map(ss => {
    const noise  = Math.sin(tick * 0.1 + ss.charCodeAt(0)) * 0.15;
    const score  = Math.max(0.1, Math.min(1, 0.75 + noise + rf(-0.05, 0.05)));
    const state  = score >= 0.8 ? "healthy" : score >= 0.6 ? "warning" : score >= 0.4 ? "degraded" : "critical";
    return { subsystem: ss, score: parseFloat(score.toFixed(3)), state };
  });
  const avg = subsystems.reduce((s, v) => s + v.score, 0) / subsystems.length;
  const globalState = avg >= 0.8 ? "healthy" : avg >= 0.6 ? "warning" : avg >= 0.4 ? "degraded" : "critical";
  return { score: parseFloat(avg.toFixed(3)), state: globalState, subsystems };
}

// ── runtime metrics for Recharts ──────────────────────────────────────

export function generateThroughputHistory(ticks = 30) {
  return Array.from({ length: ticks }, (_, i) => ({
    t:           `-${(ticks - i) * 5}s`,
    completed:   ri(2, 18),
    failed:      ri(0, 4),
    throughput:  rf(0.5, 3.5),
  }));
}

export function generateLatencyHistory(ticks = 30) {
  return Array.from({ length: ticks }, (_, i) => ({
    t:   `-${(ticks - i) * 5}s`,
    p50: ri(50,  300),
    p95: ri(200, 900),
    p99: ri(500, 2000),
  }));
}

export function generateAdapterLoad() {
  return ADAPTER_TYPES.map(a => ({
    adapter:     a,
    active:      ri(0, 8),
    capacity:    10,
    utilization: rf(0, 0.85),
    completed:   ri(20, 200),
    failed:      ri(0, 15),
  }));
}

export function generateConcurrencyState() {
  const global = ri(5, 35);
  return {
    globalActive: global, globalLimit: 50,
    utilization:  parseFloat((global / 50).toFixed(3)),
    byAdapter:    Object.fromEntries(ADAPTER_TYPES.map(a => [a, ri(0, 6)])),
    bySubsystem:  Object.fromEntries(SUBSYSTEMS.map(s => [s, ri(0, 4)])),
  };
}
