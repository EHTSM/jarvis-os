"use strict";
/**
 * ImprovementLoopEngine — propose recommended changes, gate them behind a
 * real human/policy approval, apply only once approved, measure outcomes,
 * keep or revert, record learning from every trial.
 *
 * Workflow (JARVIS Phase 5 / Mission 192-195 safety fix — see below):
 *   1. apply(recId, change)         — PROPOSE ONLY. Enqueues a real approval
 *                                      request via approvalQueue.cjs. Does
 *                                      NOT mutate anything yet.
 *   2. activateApprovedTrial(id)    — the ONLY function that ever calls
 *                                      _applyChange(). Refuses unless the
 *                                      approvalQueue request for this trial
 *                                      has status "approved" or
 *                                      "auto_approved" (auto-approval is
 *                                      itself a real, pre-existing,
 *                                      confidence/policy-gated decision made
 *                                      by approvalPolicy.cjs — not this
 *                                      file). A "pending"/"rejected"/
 *                                      "expired" request is refused.
 *   3. measure(trialId)             — collect outcome metrics after a trial
 *                                      window (only for an activated trial)
 *   4. keep(trialId)                — commit the change permanently
 *   5. revert(trialId)              — restore pre-change snapshot (rollback)
 *   6. record(trialId, notes)       — add manual learning note to the trial
 *
 * ── SAFETY FIX (Phase 5 audit, 2026-09) ─────────────────────────────────────
 * Before this fix, apply(recId, change) mutated real production state
 * IMMEDIATELY on call, with ZERO approval/policy/test/verification gate —
 * "keep"/"revert" only ever ran AFTER the mutation had already taken effect,
 * making them a post-hoc undo, not a pre-mutation gate. This was reachable
 * directly over HTTP: POST /p20/improve/apply is gated only by requireAuth
 * (backend/routes/phase20.js) — no operatorOnly, no approval check — so any
 * authenticated account could call agentFactoryAutomation.assignTools()/
 * setPermissions() on an arbitrary real agent, or overwrite a live entry in
 * data/system-params.json, with no human/policy decision ever required. Two
 * autonomous callers (backend/services/aeoState.cjs's applyEvolution() via
 * the 240s aeo_coordinator tick, and evolutionEvolutionEngine.cjs's EXECUTE
 * step) ALSO call apply() with a single-object argument, which — because
 * apply(recId, change) takes two positional args — leaves `change`
 * undefined and throws immediately, silently swallowed by their own
 * try/catch. That bug happened to prevent the autonomous tick from reaching
 * this path today, but is not a safety control: fixing that argument-shape
 * bug in isolation, without this gate, would have let a fully unattended
 * 240-second tick loop mutate real agent permissions/config with a
 * fabricated approvedBy ("aeo_coordinator", a hardcoded string, not a real
 * approval decision). This is exactly the "pattern/experience becomes a
 * live production mutation without a human/policy approval gate" scenario
 * this codebase's Phase 5 mission treats as a hard stop.
 *
 * Fix: apply() now only PROPOSES (enqueues via the existing, already-
 * battle-tested approvalQueue.cjs — the same primitive Phase 3/4 already
 * established as the correct composition point for this exact shape of
 * problem — no second approval mechanism invented). No mutation happens
 * until activateApprovedTrial() is called AND the queued request is
 * genuinely resolved "approved"/"auto_approved". The two AEO autonomous
 * call sites were left exactly as they already were (broken/no-op) — not
 * "fixed" to reach this path, since doing so was never this mission's job
 * and would only be safe once a caller-side decision synthesizes a real
 * approval, which does not exist today (see Phase 5 report §"Evolution
 * Safety").
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
 *   apply(recId, change)          → { trialId, status: "awaiting_approval", reqId }
 *   activateApprovedTrial(trialId)→ { trialId, status: "active" }  (throws if not approved)
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

const _try = fn => { try { return fn(); } catch { return null; } };
const _aq  = () => _try(() => require("./approvalQueue.cjs"));

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

/**
 * PROPOSE a change. Never mutates anything itself — enqueues a real
 * approval request via approvalQueue.cjs and returns a trial in
 * "awaiting_approval" status. The change only takes effect if/when
 * activateApprovedTrial(trialId) is later called AND the queued request
 * has genuinely resolved to "approved" or "auto_approved" (auto-approval
 * itself is a pre-existing, confidence/policy-gated decision made by
 * approvalPolicy.cjs at enqueue time — not a bypass introduced here).
 */
async function apply(recId, change) {
    if (!change?.target || !change?.targetId) throw new Error("change.target and change.targetId required");
    const trialId = _tid();
    const baselineMetrics = _collectMetrics({ change });

    const aq = _aq();
    if (!aq) throw new Error("approvalQueue unavailable — cannot propose change (no unapproved self-modification permitted)");

    const { ok, reqId, autoApproved, error: aqError } = aq.enqueue({
        workflowId:      `wf_improvement_${change.target}`,
        action:          `improvement_loop:${change.target}:${change.targetId}`,
        reason:          `Proposed self-improvement change: ${change.target}/${change.targetId}`,
        approvalType:    "GENERIC",
        expectedOutcome: "Applies a bounded, reversible runtime/agent-config change; measured and kept only if it improves outcomes.",
        rollbackPlan:    "revert(trialId) restores the pre-change snapshot exactly.",
        context:         { trialId, recId: recId || null, change },
        triggeredBy:     "improvementLoopEngine",
    });
    if (!ok) throw new Error(`Failed to enqueue approval for proposed change: ${aqError || "unknown error"}`);

    const trial = {
        trialId, recId: recId || null, change,
        status:          "awaiting_approval",
        reqId,
        proposedAt:      new Date().toISOString(),
        appliedAt:       null,
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
    auditLog.append({ type: "improvement_propose", trialId, reqId, autoApproved: !!autoApproved, change });
    logger.info(`[ImprovLoop] Trial ${trialId} PROPOSED (${autoApproved ? "auto-approved" : "awaiting approval"}): ${change.target}/${change.targetId}, reqId=${reqId}`);
    return { trialId, status: "awaiting_approval", reqId, autoApproved: !!autoApproved, change };
}

/**
 * The ONLY function in this file that ever calls _applyChange() — i.e. the
 * only path that can make a proposed change take real effect. Refuses to
 * proceed unless the trial's approvalQueue request has genuinely resolved
 * to "approved" or "auto_approved". A "pending"/"rejected"/"expired"
 * request throws, and nothing is mutated.
 */
async function activateApprovedTrial(trialId) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== "awaiting_approval") throw new Error(`Trial is ${trial.status}, not awaiting_approval`);

    const aq = _aq();
    if (!aq) throw new Error("approvalQueue unavailable — cannot verify approval");
    const req = aq.getRequest ? aq.getRequest(trial.reqId) : null;
    if (!req) throw new Error(`Approval request ${trial.reqId} not found`);
    if (req.status !== "approved" && req.status !== "auto_approved") {
        throw new Error(`Change not approved — approval request status is "${req.status}"`);
    }

    const { applied, snapshot, error } = await _applyChange(trial.change);
    if (!applied) {
        trial.status = "activation_failed";
        trial.notes.push({ ts: new Date().toISOString(), text: `Activation failed: ${error}` });
        _save();
        throw new Error(`Failed to apply approved change: ${error}`);
    }

    _snapshotWrite(trialId, snapshot);
    trial.status    = "active";
    trial.appliedAt = new Date().toISOString();
    trial.approvedBy = req.approvedBy || null;
    _save();
    auditLog.append({ type: "improvement_activate", trialId, reqId: trial.reqId, approvedBy: trial.approvedBy, change: trial.change });
    logger.info(`[ImprovLoop] Trial ${trialId} ACTIVATED (approved by ${trial.approvedBy}): ${trial.change.target}/${trial.change.targetId}`);
    return { trialId, status: "active", change: trial.change };
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
    // A trial that was never activated (still awaiting approval, or whose
    // activation failed) has no real applied change to "keep" — refusing
    // here prevents a fabricated-success record (CLAUDE.md §18) where a
    // proposal that was never approved/applied could be marked "kept".
    if (trial.status !== "active") throw new Error(`Trial is ${trial.status}, not active — nothing to keep`);
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

/**
 * Cancel a trial that was never activated (still awaiting_approval, or
 * whose approval was rejected/expired upstream in approvalQueue). No
 * _applyChange() was ever run for such a trial, so there is nothing to
 * revert — this just closes the trial record honestly as "cancelled"
 * rather than routing it through revert()'s "snapshot not found" path,
 * which would otherwise misleadingly read as a failed rollback attempt.
 */
function rejectProposal(trialId, reason = "proposal not approved") {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== "awaiting_approval") throw new Error(`Trial is ${trial.status}, not awaiting_approval`);
    trial.status      = "cancelled";
    trial.kept        = false;
    trial.completedAt = new Date().toISOString();
    trial.notes.push({ ts: new Date().toISOString(), text: `Proposal cancelled: ${reason}` });
    _save();
    auditLog.append({ type: "improvement_reject_proposal", trialId, reason });
    logger.info(`[ImprovLoop] Trial ${trialId} CANCELLED (never activated): ${reason}`);
    return { ...trial };
}

async function revert(trialId) {
    const trial = _trials.find(t => t.trialId === trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status === "awaiting_approval") return rejectProposal(trialId, "reverted before activation");
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
        total:            _trials.length,
        awaitingApproval: _trials.filter(t => t.status === "awaiting_approval").length,
        cancelled:        _trials.filter(t => t.status === "cancelled").length,
        active:           _trials.filter(t => t.status === "active").length,
        kept:             _trials.filter(t => t.status === "kept").length,
        reverted:         _trials.filter(t => t.status === "reverted").length,
        improved:         _trials.filter(t => t.verdict === "improved").length,
        degraded:         _trials.filter(t => t.verdict === "degraded").length,
    };
    return { trials: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getStats() { return listTrials({}).stats; }

module.exports = {
    apply, activateApprovedTrial, rejectProposal,
    measure, keep, revert, record, getTrial, listTrials, getStats,
};
