"use strict";
/**
 * executionEvidence.cjs — POST-Ω Sprint P3
 *
 * Collects, stores, and retrieves measurable evidence for every autonomous
 * execution. Evidence is the audit trail that proves automation worked.
 *
 * Evidence record structure:
 *   evidenceId, workflowId, executionId, ts, domain, outcome,
 *   stepsExecuted, filesChanged, validationResults, minutesSaved,
 *   gitCommit, servicesInvoked, healthSnapshot
 *
 * All evidence is stored in data/execution-evidence.ndjson
 * (newline-delimited JSON for append-only durability).
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT      = path.join(__dirname, "../..");
const DATA_FILE = path.join(ROOT, "data", "execution-evidence.ndjson");
const INDEX     = path.join(ROOT, "data", "execution-evidence-index.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _kg  = () => _try(() => require("./knowledgeGraph.cjs"));
const _ast = () => _try(() => require("./autonomousState.cjs"));
const _pbe = () => _try(() => require("./productionBibleEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _exec(cmd, timeout = 5000) {
  try   { return execSync(cmd, { cwd: ROOT, timeout, stdio: ["ignore","pipe","pipe"] }).toString().trim(); }
  catch { return ""; }
}

// ── Git snapshot ───────────────────────────────────────────────────────────────
function _gitSnapshot() {
  return {
    commit:   _exec("git rev-parse --short HEAD", 5000) || "unknown",
    branch:   _exec("git rev-parse --abbrev-ref HEAD", 5000) || "unknown",
    dirty:    _exec("git status --porcelain", 5000).length > 0,
    filesChanged: _exec("git diff --name-only HEAD", 5000).split("\n").filter(Boolean),
  };
}

// ── Append to NDJSON ──────────────────────────────────────────────────────────
function _append(record) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + "\n");
}

// ── Update index ──────────────────────────────────────────────────────────────
function _updateIndex(record) {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  idx.push({
    evidenceId:   record.evidenceId,
    workflowId:   record.workflowId,
    executionId:  record.executionId,
    ts:           record.ts,
    outcome:      record.outcome,
    minutesSaved: record.minutesSaved,
    domain:       record.domain,
  });
  if (idx.length > 500) idx = idx.slice(-500);
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2));
}

// ── Core: Collect evidence ─────────────────────────────────────────────────────

function collect({
  workflowId,
  executionId,
  domain,
  outcome,           // "success" | "partial" | "failed" | "rolled_back"
  stepsExecuted = [],
  validationResults = {},
  minutesSaved = 0,
  servicesInvoked = [],
  executionDurationMs = 0,
  notes = "",
}) {
  const git       = _gitSnapshot();
  const evidenceId = _id();

  const record = {
    evidenceId,
    workflowId,
    executionId,
    domain,
    outcome,
    ts:               _ts(),
    minutesSaved,
    executionDurationMs,
    stepsExecuted:    stepsExecuted.length,
    stepDetails:      stepsExecuted.map(s => ({ name: s.name, type: s.type, completed: s.completed, error: s.error || null })),
    validationResults,
    servicesInvoked,
    gitSnapshot:      git,
    filesChanged:     git.filesChanged,
    healthSnapshot: {
      nodeModulesPresent: fs.existsSync(path.join(ROOT, "node_modules", "express")),
      serverPresent:      fs.existsSync(path.join(ROOT, "backend", "server.js")) || fs.existsSync(path.join(ROOT, "backend", "server.cjs")),
      dataDir:            fs.existsSync(path.join(ROOT, "data")),
    },
    notes,
  };

  _append(record);
  _updateIndex(record);

  // Cross-update engineering memory
  _try(() => _le()?.createLesson?.({
    type:       "execution_evidence",
    title:      `Evidence: ${workflowId} — ${outcome} (${minutesSaved}min saved)`,
    source:     "executionEvidence",
    confidence: outcome === "success" ? 0.95 : 0.5,
    tags:       ["execution_evidence", domain, outcome],
    data:       { evidenceId, workflowId, executionId, outcome, minutesSaved, domain },
  }));

  // Cross-update knowledge graph
  _try(() => {
    const kg = _kg();
    if (kg?.addNode) {
      kg.addNode({ type: "execution_evidence", id: evidenceId, label: `Evidence: ${workflowId}`,
        data: { workflowId, executionId, outcome, minutesSaved, ts: record.ts } });
    }
    if (kg?.addEdge) {
      kg.addEdge({ from: evidenceId, fromType: "execution_evidence",
        to: workflowId, toType: "founder_workflow", relation: "proves", weight: 1 });
    }
  });

  // Mark bible workflow completed
  _try(() => _pbe()?.executeWorkflow?.(`pbw_fwr_${workflowId}`, { triggeredBy: "executionEvidence" }));

  return { ok: true, evidenceId, record };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function getEvidence(evidenceId) {
  try {
    const lines = fs.readFileSync(DATA_FILE, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const r = JSON.parse(line);
        if (r.evidenceId === evidenceId) return r;
      } catch {}
    }
  } catch {}
  return null;
}

function listEvidence({ workflowId, domain, outcome, limit = 50 } = {}) {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  if (workflowId) idx = idx.filter(e => e.workflowId === workflowId);
  if (domain)     idx = idx.filter(e => e.domain === domain);
  if (outcome)    idx = idx.filter(e => e.outcome === outcome);
  return idx.slice(-limit).reverse();
}

function getSummary() {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  const total         = idx.length;
  const successes     = idx.filter(e => e.outcome === "success").length;
  const failures      = idx.filter(e => e.outcome === "failed").length;
  const minutesSaved  = idx.filter(e => e.outcome === "success").reduce((s, e) => s + (e.minutesSaved || 0), 0);
  const uniqueWFs     = new Set(idx.map(e => e.workflowId)).size;

  return {
    totalExecutions:  total,
    successes,
    failures,
    successRate:      total > 0 ? Math.round(successes / total * 100) : 0,
    minutesSaved,
    hoursSaved:       Math.round(minutesSaved / 60 * 10) / 10,
    uniqueWorkflows:  uniqueWFs,
    latestAt:         idx[idx.length - 1]?.ts || null,
  };
}

module.exports = { collect, getEvidence, listEvidence, getSummary };
