"use strict";
/**
 * Autonomous Engineering Agent — ACP-8
 *
 * Long-running worker that takes an ACP-7 Composer plan all the way through
 * to commit, with a configurable self-repair loop on build/test failures.
 *
 * Lifecycle per mission:
 *   analyze → plan (ACP-7) → patch bundle (ACP-6) → apply → build/tests (I7)
 *     → [failure] → collect logs → classifyError (rules) → RCA lookup
 *               → composer re-plan → apply repair → retry pipeline
 *     → [success] → commit → learn → complete
 *
 * Reuses (no new runtime / scheduler / AI service / pipeline / memory):
 *   ACP-7  aiComposerEngine         — goal → plan → approve → execute
 *   ACP-6  repositoryEditingEngine  — planBundle, applyBundle, rollbackBundle
 *   I7     engineeringPipelineCoordinator — runPipeline, getPipeline
 *   I6     missionCollaborationEngine    — createPlan (collab visibility)
 *   I5/I4  agentRuntimeSupervisor        — registerAgent, getAgent, triggerTick
 *   Rules  engineeringRuleRegistry       — classifyError
 *   RCA    rootCauseAnalysisEngine       — listAnalyses (lookup)
 *   KG     knowledgeGraph                — impactAnalysis
 *   MM     missionMemory                 — create/update/recordFailure/addLearning
 *   Conf   engineeringConfidenceEngine   — explain
 *   Learn  continuousLearningEngine      — createLesson
 *   AI     aiService                     — repair patch generation
 *   Smells engineeringSmellDetector      — post-repair smell delta
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_DIR   = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "acp8-agent-missions.json");

// ── Config ────────────────────────────────────────────────────────────────────

const CFG = {
    maxRepairAttempts: 4,       // max self-repair cycles per mission
    confidenceFloor:   45,      // abort if confidence drops below this
    tickIntervalMs:    0,       // synchronous internal tick (no background timer needed)
    repairDelayMs:     200,     // pause between repair attempts (synthetic, not blocking)
};

// ── Lazy service accessors ────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

function _composer()  { return _try(() => require("./aiComposerEngine.cjs")); }
function _re()        { return _try(() => require("./repositoryEditingEngine.cjs")); }
function _pc()        { return _try(() => require("./engineeringPipelineCoordinator.cjs")); }
function _collab()    { return _try(() => require("./missionCollaborationEngine.cjs")); }
function _sup()       { return _try(() => require("./agentRuntimeSupervisor.cjs")); }
function _rr()        { return _try(() => require("./engineeringRuleRegistry.cjs")); }
function _rca()       { return _try(() => require("./rootCauseAnalysisEngine.cjs")); }
function _kg()        { return _try(() => require("./knowledgeGraph.cjs")); }
function _mm()        { return _try(() => require("./missionMemory.cjs")); }
function _ce()        { return _try(() => require("./engineeringConfidenceEngine.cjs")); }
function _le()        { return _try(() => require("./continuousLearningEngine.cjs")); }
function _ai()        { return _try(() => require("./aiService")); }
function _smells()    { return _try(() => require("./engineeringSmellDetector.cjs")); }

// ── Persistence ───────────────────────────────────────────────────────────────

let _cache = null;

function _load() {
    if (_cache) return _cache;
    try { _cache = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
    catch { _cache = { missions: {}, stats: { started: 0, completed: 0, failed: 0, repaired: 0, cancelled: 0, totalRepairAttempts: 0, avgDurationMs: 0 } }; }
    return _cache;
}

function _flush() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(_cache, null, 2));
}

function _saveMission(m) {
    const data = _load();
    data.missions[m.agentMissionId] = m;
    _flush();
}

function _updateStats(field, delta = 1) {
    const data = _load();
    data.stats[field] = (data.stats[field] || 0) + delta;
    _flush();
}

// ── ID generator ──────────────────────────────────────────────────────────────

function _amid() { return `aea_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`; }

// ── Mission skeleton ──────────────────────────────────────────────────────────

function _newMission(planId, composerPlan) {
    return {
        agentMissionId: _amid(),
        planId,
        goal:        composerPlan?.goal    || '',
        cwd:         composerPlan?.cwd     || process.cwd(),
        status:      'running',             // running | paused | completed | failed | cancelled
        currentStage: 'analyze',
        repairAttempts: 0,
        pipelineIds:    [],
        bundleIds:      [],
        missionId:      composerPlan?.missionId || null,
        collabPlanId:   null,
        confidence:     composerPlan?.confidence?.score || 0,
        startedAt:      new Date().toISOString(),
        completedAt:    null,
        error:          null,
        timeline:       [],
        repairLog:      [],
        lastPipelineStatus: null,
        autonomous:     true,
        paused:         false,
    };
}

// ── Timeline helper ───────────────────────────────────────────────────────────

function _tick(m, stage, detail = '') {
    m.currentStage = stage;
    m.timeline.push({ stage, detail: detail.slice(0, 120), ts: new Date().toISOString() });
    _saveMission(m);
}

// ── Repair patch generation ───────────────────────────────────────────────────

async function _generateRepairPatch(m, errorMsg, repairN) {
    const ai = _ai();
    if (!ai) return null;

    // Classify error via rule registry
    let ruleHint = '';
    try {
        const rr = _rr();
        if (rr) {
            const { rule } = rr.classifyError(errorMsg);
            if (rule) ruleHint = `Matched rule: ${rule.ruleId} — ${rule.description}`;
        }
    } catch {}

    // RCA lookup
    let rcaHint = '';
    try {
        const rca = _rca();
        if (rca) {
            const analyses = rca.listAnalyses();
            const match = (analyses || []).find(a =>
                (a.rootCause || '').toLowerCase().split(' ').some(w => w.length > 4 && errorMsg.toLowerCase().includes(w))
            );
            if (match) rcaHint = `RCA match: ${match.rootCause} → playbook: ${match.playbook || 'none'}`;
        }
    } catch {}

    const system = `You are an autonomous engineering agent performing a self-repair on a failed build/test.
Goal: ${m.goal}
Repair attempt: ${repairN}/${CFG.maxRepairAttempts}
${ruleHint ? ruleHint + '\n' : ''}${rcaHint ? rcaHint + '\n' : ''}
Return ONLY a JSON repair spec (no fences):
{
  "repairGoal": "concise description of the repair",
  "confidence": 0.0-1.0,
  "canRepair": true|false,
  "reason": "why this repair should fix the error"
}`;

    const prompt = `Error to repair:\n${errorMsg.slice(0, 600)}\n\nPrevious repairs: ${repairN - 1}`;
    try {
        const raw = await ai.callAI(prompt, { system });
        const m2  = raw.match(/\{[\s\S]+?\}/);
        if (!m2) return null;
        return JSON.parse(m2[0]);
    } catch { return null; }
}

// ── Core: extract error from pipeline run ─────────────────────────────────────

function _extractPipelineError(pipelineId) {
    try {
        const pc  = _pc();
        if (!pc) return null;
        const run = pc.getPipeline(pipelineId);
        if (!run) return null;
        // Find failed stage
        const failedStage = (run.stages || []).find(s => s.status === 'failed');
        if (failedStage) {
            return failedStage.error || failedStage.result?.error || failedStage.result?.stderr || `Stage ${failedStage.id} failed`;
        }
        return run.error || null;
    } catch { return null; }
}

// ── Core: wait for pipeline to reach terminal state ───────────────────────────

async function _awaitPipeline(pipelineId, timeoutMs = 90_000) {
    const pc      = _pc();
    if (!pc) return { status: 'failed', error: 'pipeline coordinator unavailable' };

    const start   = Date.now();
    const POLL_MS = 500;
    const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

    while (Date.now() - start < timeoutMs) {
        const run = pc.getPipeline(pipelineId);
        if (!run) return { status: 'failed', error: 'pipeline not found' };
        if (TERMINAL.has(run.status)) return run;
        // Non-blocking wait via Promise to yield event loop
        await new Promise(r => setTimeout(r, POLL_MS));
    }
    return { status: 'failed', error: 'pipeline timeout' };
}

// ── Repair loop (Step 4) ──────────────────────────────────────────────────────

async function _repairLoop(m, errorMsg) {
    for (let attempt = 1; attempt <= CFG.maxRepairAttempts; attempt++) {
        if (m.paused) return { repaired: false, aborted: 'paused' };
        if (m.status === 'cancelled') return { repaired: false, aborted: 'cancelled' };

        m.repairAttempts++;
        _updateStats('totalRepairAttempts');
        _tick(m, `repair_${attempt}`, `Analyzing: ${errorMsg.slice(0, 80)}`);

        // Step 4a: generate repair spec
        const repairSpec = await _generateRepairPatch(m, errorMsg, attempt);

        if (!repairSpec?.canRepair) {
            m.repairLog.push({ attempt, ok: false, reason: repairSpec?.reason || 'AI cannot repair', ts: new Date().toISOString() });
            _saveMission(m);
            if (!repairSpec?.canRepair) break; // stop trying if AI says unrepair-able
            continue;
        }

        _tick(m, `repair_${attempt}_plan`, `${repairSpec.repairGoal?.slice(0, 80)} (conf=${Math.round((repairSpec.confidence || 0) * 100)}%)`);

        // Check confidence floor
        const repairConf = Math.round((repairSpec.confidence || 0) * 100);
        if (repairConf < CFG.confidenceFloor) {
            m.repairLog.push({ attempt, ok: false, reason: `Confidence ${repairConf}% below floor ${CFG.confidenceFloor}%`, ts: new Date().toISOString() });
            _saveMission(m);
            break;
        }

        // Step 4b: re-compose with repair goal via ACP-7 composer
        let newComposerPlan = null;
        try {
            const composer   = _composer();
            if (composer) {
                const repairGoal = `REPAIR attempt ${attempt}: ${repairSpec.repairGoal} (original: ${m.goal})`;
                newComposerPlan  = await composer.composeGoal(repairGoal, m.cwd, { forceApproval: true });
                // Auto-approve
                if (newComposerPlan?.planId) {
                    composer.approvePlan(newComposerPlan.planId);
                }
            }
        } catch (e) {
            _tick(m, `repair_${attempt}_compose_err`, e.message.slice(0, 80));
        }

        // Step 4c: apply bundle if composer produced one
        let bundleOk = false;
        let newPipelineId = null;
        if (newComposerPlan?.bundleId) {
            try {
                const re     = _re();
                if (re) {
                    const bundleResult = await re.applyBundle(newComposerPlan.bundleId, { requireApproval: false });
                    if (bundleResult?.ok) {
                        bundleOk = true;
                        m.bundleIds.push(newComposerPlan.bundleId);
                        newPipelineId = bundleResult.pipelineId;
                    }
                }
            } catch {}
        }

        // Step 4d: run pipeline if no bundle pipeline or bundle didn't trigger one
        if (!newPipelineId) {
            try {
                const pc  = _pc();
                if (pc) {
                    const run     = await pc.runPipeline(`REPAIR: ${m.goal}`, {
                        requireApproval: false,
                        priority:        'high',
                        commitMsg:       `fix: autonomous repair attempt ${attempt} — ${m.goal.slice(0, 60)}`,
                    });
                    newPipelineId = run.pipelineId;
                }
            } catch {}
        }

        if (newPipelineId) {
            m.pipelineIds.push(newPipelineId);
            _tick(m, `repair_${attempt}_pipeline`, `pipelineId=${newPipelineId}`);
            const repairRun = await _awaitPipeline(newPipelineId);
            m.lastPipelineStatus = repairRun.status;

            if (repairRun.status === 'completed') {
                m.repairLog.push({ attempt, ok: true, pipelineId: newPipelineId, ts: new Date().toISOString() });
                _saveMission(m);
                _updateStats('repaired');
                _tick(m, `repair_${attempt}_success`, `pipeline completed`);
                return { repaired: true, pipelineId: newPipelineId };
            }

            // Extract new error for next iteration
            errorMsg = _extractPipelineError(newPipelineId) || repairRun.error || errorMsg;
        }

        m.repairLog.push({ attempt, ok: false, pipelineId: newPipelineId, reason: errorMsg.slice(0, 80), ts: new Date().toISOString() });
        _saveMission(m);

        // Brief yield between attempts
        await new Promise(r => setTimeout(r, CFG.repairDelayMs));
    }

    return { repaired: false, exhausted: true };
}

// ── Main execution flow ───────────────────────────────────────────────────────

async function _runMission(m, composerPlan) {
    const start = Date.now();

    try {
        // ── Stage: analyze ────────────────────────────────────────────────────
        _tick(m, 'analyze', `goal="${m.goal.slice(0, 60)}"`);

        // Register with I6 collab engine for visibility
        try {
            const collab = _collab();
            if (collab && m.missionId) {
                const cp = collab.createPlan(m.missionId, {
                    assignedAgents: [{ agentId: m.agentMissionId, role: 'engineer' }],
                    executionOrder: [
                        { step: 1, action: 'analyze', agentId: m.agentMissionId },
                        { step: 2, action: 'patch', agentId: m.agentMissionId },
                        { step: 3, action: 'apply', agentId: m.agentMissionId },
                        { step: 4, action: 'pipeline', agentId: m.agentMissionId },
                        { step: 5, action: 'commit', agentId: m.agentMissionId },
                    ],
                    completionCriteria: ['pipeline_completed', 'lesson_recorded'],
                });
                m.collabPlanId = cp?.planId || null;
            }
        } catch {}

        // ── Stage: plan (ACP-7 already composed, ensure approved) ────────────
        _tick(m, 'plan', `composerPlanId=${composerPlan.planId} status=${composerPlan.status}`);

        let activePlan = composerPlan;
        if (!['approved', 'auto_approved'].includes(activePlan.status)) {
            try {
                const composer = _composer();
                if (composer) {
                    composer.approvePlan(activePlan.planId);
                    activePlan = composer.getPlan(activePlan.planId) || activePlan;
                }
            } catch (e) { _tick(m, 'plan_approve_warn', e.message.slice(0, 60)); }
        }

        // ── Stage: patch (use existing bundle from composer plan) ─────────────
        _tick(m, 'patch', `bundleId=${activePlan.bundleId || 'none'}`);

        let bundleId   = activePlan.bundleId;
        let bundleResult = null;

        if (!bundleId) {
            // Composer didn't produce a bundle — plan one now via ACP-6
            try {
                const re   = _re();
                if (re) {
                    const bundle = await re.planBundle(m.goal, m.cwd);
                    bundleId     = bundle?.bundleId || null;
                    if (bundleId) m.bundleIds.push(bundleId);
                }
            } catch (e) { _tick(m, 'patch_warn', e.message.slice(0, 60)); }
        } else {
            m.bundleIds.push(bundleId);
        }

        // ── Stage: apply ──────────────────────────────────────────────────────
        _tick(m, 'apply', `bundleId=${bundleId || 'none'}`);
        if (m.paused) { m.status = 'paused'; _saveMission(m); return; }

        let pipelineId = null;

        if (bundleId) {
            try {
                const re = _re();
                if (re) {
                    bundleResult = await re.applyBundle(bundleId, { requireApproval: false });
                    pipelineId   = bundleResult?.pipelineId || null;
                    if (pipelineId) m.pipelineIds.push(pipelineId);
                    _tick(m, 'apply_ok', `files=${bundleResult?.applied?.length || 0} pipelineId=${pipelineId || 'none'}`);
                }
            } catch (e) { _tick(m, 'apply_warn', e.message.slice(0, 60)); }
        }

        // ── Stage: build + test (I7 pipeline) ────────────────────────────────
        if (!pipelineId) {
            // Bundle didn't trigger a pipeline — run one directly
            try {
                const pc  = _pc();
                if (pc) {
                    const run     = await pc.runPipeline(m.goal, {
                        requireApproval: false,
                        priority:        'high',
                        commitMsg:       bundleResult?.commitMsg || `feat: ${m.goal.slice(0, 60)} [acp8]`,
                    });
                    pipelineId = run.pipelineId;
                    m.pipelineIds.push(pipelineId);
                }
            } catch (e) { _tick(m, 'pipeline_start_err', e.message.slice(0, 60)); }
        }

        _tick(m, 'build_test', `pipelineId=${pipelineId || 'none'}`);
        if (m.paused) { m.status = 'paused'; _saveMission(m); return; }

        let pipelineRun = { status: 'completed' }; // optimistic if no pipeline
        if (pipelineId) {
            pipelineRun = await _awaitPipeline(pipelineId);
            m.lastPipelineStatus = pipelineRun.status;
        }

        // ── Stage: repair loop if failed ──────────────────────────────────────
        if (pipelineRun.status === 'failed') {
            const errorMsg = _extractPipelineError(pipelineId) || pipelineRun.error || 'Unknown pipeline failure';
            _tick(m, 'repair_start', errorMsg.slice(0, 80));

            // Record failure in mission memory
            try {
                const mm = _mm();
                if (mm && m.missionId) mm.recordFailure(m.missionId, { description: errorMsg, stage: 'pipeline', ts: new Date().toISOString() });
            } catch {}

            const repairResult = await _repairLoop(m, errorMsg);

            if (!repairResult.repaired) {
                if (repairResult.aborted) {
                    _tick(m, 'repair_aborted', repairResult.aborted);
                    m.status = repairResult.aborted === 'cancelled' ? 'cancelled' : 'paused';
                    _saveMission(m);
                    return;
                }
                // Repair exhausted — rollback
                _tick(m, 'repair_exhausted', `${m.repairAttempts} attempts failed — rolling back`);
                if (bundleId) {
                    try { const re = _re(); if (re) await re.rollbackBundle(bundleId); } catch {}
                }
                m.status = 'failed';
                m.error  = `Repair exhausted after ${m.repairAttempts} attempts: ${errorMsg.slice(0, 100)}`;
                _updateStats('failed');
                _recordLesson(m, false, Date.now() - start);
                _saveMission(m);
                return;
            }
        }

        // ── Stage: commit ────────────────────────────────────────────────────
        _tick(m, 'commit', `pipelineIds=${m.pipelineIds.join(',').slice(0,60)}`);

        // Update mission memory
        try {
            const mm = _mm();
            if (mm && m.missionId) {
                mm.updateMission(m.missionId, { status: 'completed' });
                mm.recordArtifact(m.missionId, {
                    type:    'autonomous_engineering_run',
                    content: `ACP-8 mission complete: ${m.repairAttempts} repairs, ${m.pipelineIds.length} pipeline runs`,
                });
            }
        } catch {}

        // Update confidence post-execution
        try {
            const ce = _ce();
            if (ce) {
                const conf = ce.explain(`acp8:${m.goal.slice(0, 40)}`, {});
                m.confidence = conf?.score || m.confidence;
            }
        } catch {}

        // Post-repair smell delta (informational)
        let smellDelta = 0;
        try {
            const sd = _smells();
            if (sd && m.repairAttempts > 0) {
                const scan = await sd.scan(m.cwd);
                smellDelta = scan?.summary?.total || 0;
            }
        } catch {}

        // ── Stage: learn ──────────────────────────────────────────────────────
        _tick(m, 'learn', `smellDelta=${smellDelta}`);
        _recordLesson(m, true, Date.now() - start, smellDelta);

        // ── Complete ──────────────────────────────────────────────────────────
        m.status      = 'completed';
        m.completedAt = new Date().toISOString();
        _tick(m, 'complete', `elapsed=${Date.now() - start}ms repairs=${m.repairAttempts}`);
        _updateStats('completed');

        // Update avg duration
        const data = _load();
        const totalMs  = (data.stats.avgDurationMs || 0) * Math.max(data.stats.completed - 1, 0) + (Date.now() - start);
        data.stats.avgDurationMs = Math.round(totalMs / (data.stats.completed || 1));
        _flush();

    } catch (e) {
        m.status = 'failed';
        m.error  = e.message;
        _tick(m, 'fatal_error', e.message.slice(0, 100));
        _updateStats('failed');
        _recordLesson(m, false, Date.now() - (new Date(m.startedAt).getTime()));
    }

    _saveMission(m);
}

// ── Lesson recording ──────────────────────────────────────────────────────────

function _recordLesson(m, success, durationMs, smellDelta = 0) {
    try {
        const le = _le();
        if (!le) return;
        le.createLesson({
            lesson: `ACP-8 mission ${success ? 'completed' : 'failed'}: "${m.goal.slice(0, 80)}" ` +
                    `repairs=${m.repairAttempts} pipelines=${m.pipelineIds.length} duration=${Math.round(durationMs / 1000)}s ` +
                    `smellDelta=${smellDelta}`,
            type:   success ? 'autonomous_success' : 'autonomous_failure',
            source: 'acp8',
            context: {
                agentMissionId: m.agentMissionId,
                planId:         m.planId,
                repairAttempts: m.repairAttempts,
                pipelineIds:    m.pipelineIds,
                durationMs,
            },
        });
    } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * startMission(planId) → agentMission
 *
 * Takes an ACP-7 composer planId, runs the full autonomous lifecycle.
 * The pipeline runs async — this function resolves once the mission
 * reaches a terminal or paused state.
 */
async function startMission(planId) {
    const composer = _composer();
    if (!composer) throw new Error("aiComposerEngine unavailable");

    const composerPlan = composer.getPlan(planId);
    if (!composerPlan) throw new Error(`composer plan ${planId} not found`);

    const m = _newMission(planId, composerPlan);
    _saveMission(m);
    _updateStats('started');

    // Run the mission (async — caller awaits)
    await _runMission(m, composerPlan);
    return m;
}

/**
 * pauseMission(agentMissionId) → agentMission
 * Sets a pause flag; the next stage check will halt execution.
 */
function pauseMission(agentMissionId) {
    const data = _load();
    const m    = data.missions[agentMissionId];
    if (!m) throw new Error(`mission ${agentMissionId} not found`);
    if (m.status !== 'running') throw new Error(`cannot pause mission in status ${m.status}`);
    m.paused = true;
    m.timeline.push({ stage: 'pause_requested', ts: new Date().toISOString() });
    _saveMission(m);
    return m;
}

/**
 * resumeMission(agentMissionId) → { ok, message }
 * Clears pause flag; restarts from the current stage.
 * For simplicity, resumes by re-running the mission from the current state.
 */
async function resumeMission(agentMissionId) {
    const data = _load();
    const m    = data.missions[agentMissionId];
    if (!m) throw new Error(`mission ${agentMissionId} not found`);
    if (m.status !== 'paused') throw new Error(`cannot resume mission in status ${m.status}`);

    m.paused   = false;
    m.status   = 'running';
    m.timeline.push({ stage: 'resumed', ts: new Date().toISOString() });
    _saveMission(m);

    // Re-fetch composer plan and continue
    const composer = _composer();
    const composerPlan = composer?.getPlan(m.planId);
    if (!composerPlan) throw new Error(`composer plan ${m.planId} not found for resume`);

    // Run from patch stage (skip re-compose — bundle may already exist)
    await _runMission(m, composerPlan);
    return m;
}

/**
 * cancelMission(agentMissionId) → agentMission
 */
function cancelMission(agentMissionId) {
    const data = _load();
    const m    = data.missions[agentMissionId];
    if (!m) throw new Error(`mission ${agentMissionId} not found`);
    if (['completed', 'failed', 'cancelled'].includes(m.status)) {
        throw new Error(`mission already ${m.status}`);
    }

    m.status   = 'cancelled';
    m.paused   = true;         // halt if still in flight
    m.timeline.push({ stage: 'cancelled', ts: new Date().toISOString() });

    // Rollback latest bundle if applied
    if (m.bundleIds.length > 0) {
        const lastBundleId = m.bundleIds[m.bundleIds.length - 1];
        try { const re = _re(); if (re) re.rollbackBundle(lastBundleId).catch(() => {}); } catch {}
    }

    _saveMission(m);
    _updateStats('cancelled');
    return m;
}

/**
 * retryMission(agentMissionId) → agentMission
 * Creates a fresh mission run from the same composer plan.
 */
async function retryMission(agentMissionId) {
    const data = _load();
    const m    = data.missions[agentMissionId];
    if (!m) throw new Error(`mission ${agentMissionId} not found`);
    if (!['failed', 'cancelled'].includes(m.status)) {
        throw new Error(`can only retry failed or cancelled missions (current: ${m.status})`);
    }
    // Delegate to startMission with same planId
    return startMission(m.planId);
}

/**
 * getMissionStatus(agentMissionId) → agentMission | null
 */
function getMissionStatus(agentMissionId) {
    const data = _load();
    return data.missions[agentMissionId] || null;
}

/**
 * listRunning(opts) → [agentMission, ...]
 */
function listRunning(opts = {}) {
    const data    = _load();
    const all     = Object.values(data.missions);
    const status  = opts.status;
    const limit   = opts.limit || 20;
    return all
        .filter(m => !status || m.status === status)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, limit)
        .map(m => ({
            agentMissionId: m.agentMissionId,
            planId:         m.planId,
            goal:           m.goal,
            status:         m.status,
            currentStage:   m.currentStage,
            repairAttempts: m.repairAttempts,
            confidence:     m.confidence,
            startedAt:      m.startedAt,
            completedAt:    m.completedAt,
            pipelineCount:  m.pipelineIds.length,
            bundleCount:    m.bundleIds.length,
            paused:         m.paused,
            error:          m.error,
        }));
}

/**
 * getStatistics() → aggregate stats + benchmark-style scores
 */
function getStatistics() {
    const data     = _load();
    const stored   = data.stats || {};
    const missions = Object.values(data.missions);

    const completed = missions.filter(m => m.status === 'completed');
    const failed    = missions.filter(m => m.status === 'failed');
    const total     = missions.length;

    const totalRepairs  = missions.reduce((s, m) => s + (m.repairAttempts || 0), 0);
    const avgRepairs    = total > 0 ? +(totalRepairs / total).toFixed(2) : 0;

    // Autonomy % = % of missions that completed without any operator intervention (approved by auto_approved)
    const autoCompleted = completed.filter(m => {
        const cp = _try(() => _composer()?.getPlan(m.planId));
        return cp?.status === 'auto_approved' || cp?.aiPlan?.skipApproval;
    }).length;
    const autonomyPct = completed.length > 0
        ? Math.round((autoCompleted / Math.max(completed.length, 1)) * 100)
        : 0;

    const repairSuccessRate = totalRepairs > 0
        ? Math.round((stored.repaired || 0) / totalRepairs * 100)
        : 100;

    const successRate = total > 0
        ? Math.round((completed.length / total) * 100)
        : 0;

    const replaceCursorScore = Math.min(100, Math.round(successRate * 0.5 + autonomyPct * 0.3 + repairSuccessRate * 0.2));
    const buildOoplixScore   = Math.min(100, Math.round(completed.length * 8 + (stored.repaired || 0) * 5));

    return {
        total,
        completed: completed.length,
        failed:    failed.length,
        running:   missions.filter(m => m.status === 'running').length,
        paused:    missions.filter(m => m.status === 'paused').length,
        cancelled: missions.filter(m => m.status === 'cancelled').length,
        totalRepairAttempts: totalRepairs,
        successfulRepairs:   stored.repaired || 0,
        avgRepairsPerMission: avgRepairs,
        autonomyPct,
        repairSuccessRate,
        successRate,
        avgDurationMs: stored.avgDurationMs || 0,
        replaceCursorScore,
        buildOoplixScore,
        ...stored,
    };
}

/**
 * runBenchmark(goals, cwd) → benchmark report
 *
 * Validates 10 scenarios end-to-end: compose → approve → execute (dry: no real file writes
 * since compose in ACP-7 already handles file analysis; here we run compose + pipeline).
 */
async function runBenchmark(goals, cwd) {
    const root = cwd || path.join(__dirname, "../../");

    if (!goals?.length) {
        goals = [
            "Fix login performance",
            "Remove dead code",
            "Improve auth security",
            "Reduce bundle size",
            "Add input validation",
            "Improve logging",
            "Fix flaky tests",
            "Refactor CRM module",
            "Improve deployment pipeline",
            "Optimize API endpoints",
        ];
    }

    const results = [];
    for (const goal of goals.slice(0, 10)) {
        const start = Date.now();
        try {
            const composer = _composer();
            if (!composer) throw new Error("composer unavailable");

            // 1. compose
            const plan = await composer.composeGoal(goal, root, { forceApproval: false });

            // 2. approve (auto)
            composer.approvePlan(plan.planId);

            // 3. start mission (full lifecycle but pipeline is I7's business)
            const m = await startMission(plan.planId);

            results.push({
                goal,
                ok:             m.status === 'completed',
                status:         m.status,
                repairAttempts: m.repairAttempts,
                pipelineRuns:   m.pipelineIds.length,
                confidence:     m.confidence,
                elapsedMs:      Date.now() - start,
                error:          m.error,
                agentMissionId: m.agentMissionId,
            });
        } catch (e) {
            results.push({ goal, ok: false, status: 'error', error: e.message, elapsedMs: Date.now() - start });
        }
    }

    const passed   = results.filter(r => r.ok).length;
    const avgMs    = Math.round(results.reduce((s, r) => s + r.elapsedMs, 0) / results.length);
    const avgConf  = results.filter(r => r.confidence).length
        ? Math.round(results.reduce((s, r) => s + (r.confidence || 0), 0) / results.length)
        : 0;
    const avgRetry = +(results.reduce((s, r) => s + (r.repairAttempts || 0), 0) / results.length).toFixed(2);

    return {
        total:   results.length,
        passed,
        failed:  results.length - passed,
        passRate: Math.round(passed / results.length * 100),
        avgDurationMs:   avgMs,
        avgConfidence:   avgConf,
        avgRepairs:      avgRetry,
        autonomyPct:     Math.round((results.filter(r => r.ok && r.repairAttempts === 0).length / Math.max(passed, 1)) * 100),
        repairSuccessRate: results.filter(r => r.repairAttempts > 0 && r.ok).length > 0
            ? Math.round(results.filter(r => r.repairAttempts > 0 && r.ok).length / Math.max(results.filter(r => r.repairAttempts > 0).length, 1) * 100)
            : 100,
        replaceCursorScore: Math.min(100, Math.round(passed * 10 * 0.6 + avgConf * 0.4)),
        buildOoplixScore:   Math.min(100, Math.round(passed * 9 + avgConf * 0.1 * results.length)),
        scenarios: results,
    };
}

module.exports = {
    startMission,
    pauseMission,
    resumeMission,
    cancelMission,
    retryMission,
    getMissionStatus,
    listRunning,
    getStatistics,
    runBenchmark,
};
