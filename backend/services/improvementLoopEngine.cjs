"use strict";
/**
 * ImprovementLoopEngine — apply recommendations, measure outcomes,
 * keep or revert changes, record learning from every trial.
 *
 * Workflow:
 *   1. apply(recId, change)   — apply a recommended change, snapshot current state
 *   2. measure(trialId)       — collect outcome metrics after a trial window
 *   3. keep(trialId)          — commit the change permanently
 *   4. revert(trialId)        — restore pre-change snapshot
 *   5. record(trialId, notes) — add manual learning note to the trial
 *
 * Change targets:
 *   agent_config    — modify an agent's tools/permissions/model
 *   memory_boost    — raise importance of a memory node
 *   task_template   — swap a goal-type task template
 *   system_param    — adjust a runtime parameter
 *
 * Persists all trials to data/improvement-trials.json.
 *
 * Public API:
 *   apply(recId, change)          → { trialId, status: "active" }
 *   measure(trialId)              → { trialId, metrics, verdict }
 *   keep(trialId)                 → TrialRecord
 *   revert(trialId)               → TrialRecord
 *   record(trialId, notes)        → TrialRecord
 *   getTrial(trialId)             → TrialRecord | null
 *   listTrials(opts)              → { trials[], stats }
 *   getStats()                    → aggregate stats
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const TRIAL_FILE  = path.join(__dirname, "../../data/improvement-trials.json");
const SNAP_DIR    = path.join(__dirname, "../../data/improvement-snapshots");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _trials = _rj(TRIAL_FILE, []);
let _seq    = _trials.length;
function _tid() { return `trial_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(TRIAL_FILE, _trials.slice(-500)); } catch { /* non-fatal */ } }

// ── Snapshot helpers ─────────────────────────────────────────────────────
function _snapshotWrite(trialId, data) {
    try {
        if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
        fs.writeFileSync(path.join(SNAP_DIR, `${trialId}.json`), JSON.stringify(data, null, 2));
    } catch { /* non-fatal */ }
}
function _snapshotRead(trialId) {
    try { return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, `${trialId}.json`), "utf8")); }
    catch { return null; }
}
function _snapshotDelete(trialId) {
    try { fs.unlinkSync(path.join(SNAP_DIR, `${trialId}.json`)); } catch { /* already gone */ }
}

// ── Change executors ─────────────────────────────────────────────────────
async function _applyChange(change) {
    const { target, targetId, params } = change;
    let snapshot = null;
    let applied  = false;

    try {
        switch (target) {
            case "agent_config": {
                const afa = require("./agentFactoryAutomation.cjs");
                const agent = afa.getAgent(targetId);
                if (!agent) throw new Error(`Agent ${targetId} not found`);
                snapshot = { ...agent };
                if (params.tools)       afa.assignTools(targetId, params.tools);
                if (params.permissions) afa.setPermissions(targetId, params.permissions);
                applied = true;
                break;
            }
            case "memory_boost": {
                const mpl = require("./memoryPersistenceLayer.cjs");
                const node = mpl.load(targetId);
                if (!node) throw new Error(`Memory node ${targetId} not found`);
                snapshot = { nodeId: node.nodeId, importance: node.importance, confidence: node.confidence };
                mpl.update(targetId, { importance: Math.min(100, (node.importance||50) + (params.delta||10)) });
                applied = true;
                break;
            }
            case "task_template": {
                // Swap a task template key in the AutonomousTaskLoop's in-memory map
                // (survives until next restart — sufficient for trial)
                try {
                    const atl = require("./autonomousTaskLoop.cjs");
                    snapshot = { target: "task_template", goalType: targetId, note: "template swapped in memory" };
                    // ATL exposes internal template swap if available; otherwise no-op
                    if (typeof atl.swapTemplate === "function") {
                        atl.swapTemplate(targetId, params.tasks);
                    }
                    applied = true;
                } catch { applied = false; }
                break;
            }
            case "system_param": {
                // Store as a flag in a param file — modules can read at runtime
                const PARAM_FILE = path.join(__dirname, "../../data/system-params.json");
                const current    = _rj(PARAM_FILE, {});
                snapshot = { [targetId]: current[targetId] };
                current[targetId] = params.value;
                _wj(PARAM_FILE, current);
                applied = true;
                break;
            }
            default:
                throw new Error(`Unknown change target: ${target}`);
        }
    } catch (e) {
        return { applied: false, snapshot: null, error: e.message };
    }
    return { applied, snapshot, error: null };
}

async function _revertChange(trial) {
    const snap = _snapshotRead(trial.trialId);
    if (!snap) return { reverted: false, reason: "snapshot not found" };
    const { target, targetId } = trial.change;
    try {
        switch (target) {
            case "agent_config": {
                const afa = require("./agentFactoryAutomation.cjs");
                if (snap.tools)       afa.assignTools(targetId, snap.tools);
                if (snap.permissions) afa.setPermissions(targetId, snap.permissions);
                break;
            }
            case "memory_boost": {
                const mpl = require("./memoryPersistenceLayer.cjs");
                mpl.update(targetId, { importance: snap.importance, confidence: snap.confidence });
                break;
            }
            case "system_param": {
                const PARAM_FILE = path.join(__dirname, "../../data/system-params.json");
                const current    = _rj(PARAM_FILE, {});
                current[targetId] = snap[targetId];
                _wj(PARAM_FILE, current);
                break;
            }
            default: break;
        }
        _snapshotDelete(trial.trialId);
        return { reverted: true };
    } catch (e) {
        return { reverted: false, reason: e.message };
    }
}

// ── Metrics collection ────────────────────────────────────────────────────
function _collectMetrics(trial) {
    // Collect runtime metrics to measure trial outcome
    const metrics = {};
    try {
        const aee = require("./agentExecutionEngine.cjs");
        const { stats } = aee.getHistory(trial.change?.targetId, { limit: 50 });
        metrics.agentSuccessRate = stats?.successRate ?? null;
        metrics.agentAvgMs       = stats?.avgMs       ?? null;
    } catch { /* optional */ }
    try {
        const mpl    = require("./memoryPersistenceLayer.cjs");
        const mstats = mpl.stats();
        metrics.memoryTotal      = mstats.total;
        metrics.memoryAvgConf    = mstats.avgConfidence;
    } catch { /* optional */ }
    try {
        const tel = require("./toolExecutionLayer.cjs");
        const ts  = tel.toolStatus();
        metrics.toolFailRates = Object.fromEntries(Object.entries(ts).map(([k, v]) => [k, v.failRate]));
    } catch { /* optional */ }
    return metrics;
}

function _verdict(trial, metrics) {
    // Simple heuristic: if agent success rate improved or no worse than baseline
    const baseline = trial.baselineMetrics?.agentSuccessRate;
    const current  = metrics.agentSuccessRate;
    if (baseline !== null && current !== null) {
        if (current > baseline + 2) return "improved";
        if (current < baseline - 5) return "degraded";
    }
    return "neutral";
}

// ── Public API ────────────────────────────────────────────────────────────
async function apply(recId, change) {
    if (!change?.target || !change?.targetId) throw new Error("change.target and change.targetId required");
    const trialId = _tid();
    const baselineMetrics = _collectMetrics({ change });

    const { applied, snapshot, error } = await _applyChange(change);
    if (!applied) throw new Error(`Failed to apply change: ${error}`);

    _snapshotWrite(trialId, snapshot);

    const trial = {
        trialId, recId: recId || null, change,
        status:          "active",
        appliedAt:       new Date().toISOString(),
        measuredAt:      null,
        completedAt:     null,
        baselineMetrics,
        outcomeMetrics:  null,
        verdict:         null,
        notes:           [],
        kept:            null,
    };
    _trials.push(trial);
    _save();
    auditLog.append({ type: "improvement_apply", trialId, change });
    logger.info(`[ImprovLoop] Trial ${trialId} started: ${change.target}/${change.targetId}`);
    return { trialId, status: "active", change };
}

function measure(trialId) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== "active") throw new Error(`Trial is ${trial.status}, not active`);

    const metrics = _collectMetrics(trial);
    const verdict = _verdict(trial, metrics);

    trial.outcomeMetrics = metrics;
    trial.measuredAt     = new Date().toISOString();
    trial.verdict        = verdict;
    _save();
    auditLog.append({ type: "improvement_measure", trialId, verdict });
    return { trialId, metrics, verdict, baselineMetrics: trial.baselineMetrics };
}

async function keep(trialId) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    // Delete snapshot — change is permanent
    _snapshotDelete(trialId);
    trial.status      = "kept";
    trial.kept        = true;
    trial.completedAt = new Date().toISOString();
    _save();
    auditLog.append({ type: "improvement_keep", trialId });
    // Auto-create a lesson
    try {
        const cle = require("./continuousLearningEngine.cjs");
        cle.createLesson({ type: "success", title: `Improvement kept: ${trial.change.target}/${trial.change.targetId}`, detail: `Trial ${trialId} — verdict: ${trial.verdict || "n/a"}. Change committed permanently.`, source: "improvement_loop" });
    } catch { /* non-critical */ }
    logger.info(`[ImprovLoop] Trial ${trialId} KEPT`);
    return { ...trial };
}

async function revert(trialId) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    const { reverted, reason } = await _revertChange(trial);
    trial.status      = reverted ? "reverted" : "revert_failed";
    trial.kept        = false;
    trial.completedAt = new Date().toISOString();
    if (!reverted) trial.notes.push({ ts: new Date().toISOString(), text: `Revert failed: ${reason}` });
    _save();
    auditLog.append({ type: "improvement_revert", trialId, reverted, reason });
    // Auto-create a failure lesson
    try {
        const cle = require("./continuousLearningEngine.cjs");
        cle.createLesson({ type: "failure", title: `Improvement reverted: ${trial.change.target}/${trial.change.targetId}`, detail: `Trial ${trialId} — verdict: ${trial.verdict || "n/a"}. Change reverted.`, recommendation: `Avoid this change pattern for ${trial.change.targetId}.`, source: "improvement_loop" });
    } catch { /* non-critical */ }
    logger.info(`[ImprovLoop] Trial ${trialId} REVERTED${reverted ? "" : " (failed: " + reason + ")"}`);
    return { ...trial };
}

function record(trialId, notes) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    trial.notes.push({ ts: new Date().toISOString(), text: String(notes).slice(0, 500) });
    _save();
    return { ...trial };
}

function getTrial(trialId) {
    return _trials.find(t => t.trialId === trialId) || null;
}

function listTrials({ status, target, limit = 50, offset = 0 } = {}) {
    let rows = [..._trials].reverse();
    if (status) rows = rows.filter(t => t.status === status);
    if (target) rows = rows.filter(t => t.change?.target === target);
    const stats = {
        total:    _trials.length,
        active:   _trials.filter(t => t.status === "active").length,
        kept:     _trials.filter(t => t.status === "kept").length,
        reverted: _trials.filter(t => t.status === "reverted").length,
        improved: _trials.filter(t => t.verdict === "improved").length,
        degraded: _trials.filter(t => t.verdict === "degraded").length,
    };
    return { trials: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getStats() { return listTrials({}).stats; }

module.exports = { apply, measure, keep, revert, record, getTrial, listTrials, getStats };
