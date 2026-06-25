"use strict";
/**
 * mission.js — J1 Unified Mission Runtime routes
 *
 * Exposes the missionRuntime orchestration layer via HTTP.
 * Storage authority: missionMemory.cjs (data/missions.json)
 * Live events: runtimeEventBus.cjs (SSE — already at /runtime/stream)
 *
 * Routes:
 *   POST   /mission/runtime/start/:id        startMission
 *   POST   /mission/runtime/complete/:id     completeMission
 *   POST   /mission/runtime/fail/:id         failMission
 *   POST   /mission/runtime/cancel/:id       cancelMission
 *   PATCH  /mission/runtime/:id/subtask/:sid updateSubtaskStatus
 *   GET    /mission/runtime/status           runtimeStatus snapshot
 *   GET    /mission/runtime/active           active mission
 *
 *   GET    /mission/timeline/:id             getExecutionTimeline
 *   GET    /mission/graph/:id                getDependencyGraph
 *   GET    /mission/replay/:id               replayMission (from missionMemory)
 *   GET    /mission/state/:id                mission status + metrics
 */

const router  = require("express").Router();
const runtime = require("../../agents/runtime/missionRuntime.cjs");
const memory  = require("../services/missionMemory.cjs");
const logger  = require("../utils/logger");

function _send(res, fn) {
    try {
        const result = fn();
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404
                     : err.message.includes("Invalid transition") ? 409
                     : 500;
        logger.warn(`[Mission API] ${err.message}`);
        res.status(status).json({ success: false, error: err.message });
    }
}

async function _sendAsync(res, fn) {
    try {
        const result = await fn();
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404
                     : err.message.includes("Invalid transition") ? 409
                     : 500;
        logger.warn(`[Mission API] ${err.message}`);
        res.status(status).json({ success: false, error: err.message });
    }
}

// ── Mission Runtime API ───────────────────────────────────────────────────────

router.post("/mission/runtime/start/:id", (req, res) => {
    _send(res, () => ({ mission: runtime.startMission(req.params.id) }));
});

router.post("/mission/runtime/complete/:id", (req, res) => {
    const { summary } = req.body || {};
    _send(res, () => ({ mission: runtime.completeMission(req.params.id, { summary }) }));
});

router.post("/mission/runtime/fail/:id", (req, res) => {
    const { reason } = req.body || {};
    _send(res, () => ({ mission: runtime.failMission(req.params.id, reason) }));
});

router.post("/mission/runtime/cancel/:id", (req, res) => {
    const { reason } = req.body || {};
    _send(res, () => ({ mission: runtime.cancelMission(req.params.id, reason) }));
});

router.patch("/mission/runtime/:id/subtask/:sid", (req, res) => {
    const { status, output } = req.body || {};
    if (!status) return res.status(400).json({ success: false, error: "status required" });
    _send(res, () => ({
        mission: runtime.updateSubtaskStatus(req.params.id, req.params.sid, status, output ?? null),
    }));
});

router.get("/mission/runtime/status", (req, res) => {
    _send(res, () => ({ status: runtime.runtimeStatus() }));
});

router.get("/mission/runtime/active", (req, res) => {
    _send(res, () => ({ mission: runtime.getActiveMission() }));
});

// ── Mission Timeline API ──────────────────────────────────────────────────────

router.get("/mission/timeline/:id", (req, res) => {
    _send(res, () => ({ timeline: runtime.getExecutionTimeline(req.params.id) }));
});

// ── Mission Graph API ─────────────────────────────────────────────────────────

router.get("/mission/graph/:id", (req, res) => {
    _send(res, () => ({ graph: runtime.getDependencyGraph(req.params.id) }));
});

// ── Mission Replay API (delegates to missionMemory) ──────────────────────────

router.get("/mission/replay/:id", (req, res) => {
    _send(res, () => ({ replay: memory.replayMission(req.params.id) }));
});

// ── Mission State API ─────────────────────────────────────────────────────────

router.get("/mission/state/:id", (req, res) => {
    _send(res, () => {
        const mission = memory.getMission(req.params.id);
        if (!mission) throw new Error(`Mission not found: ${req.params.id}`);
        return {
            state: {
                id:          mission.id,
                objective:   mission.objective,
                status:      mission.status,
                priority:    mission.priority,
                createdAt:   mission.createdAt,
                startedAt:   mission.startedAt  || null,
                completedAt: mission.completedAt || null,
                metrics:     mission.metrics,
                subtaskCount: mission.subtasks.length,
                failureCount: (mission.failures || []).length,
            },
        };
    });
});

// ── I3: Mission Orchestrator ──────────────────────────────────────────────────
const _orch = (() => { try { return require("../services/missionOrchestrator.cjs"); } catch { return null; } })();
const _orchErr = (res) => res.status(503).json({ success: false, error: "orchestrator_unavailable" });

// GET /missions/orchestrator
router.get("/missions/orchestrator", (req, res) => {
    if (!_orch) return _orchErr(res);
    const limit    = Math.min(parseInt(req.query.limit) || 100, 500);
    const status   = req.query.status   || null;
    const priority = req.query.priority || null;
    const since    = req.query.since    || null;
    return res.json({ success: true, ..._orch.listMissions({ status, priority, limit, since }) });
});

// GET /missions/orchestrator/statistics
router.get("/missions/orchestrator/statistics", (req, res) => {
    if (!_orch) return _orchErr(res);
    return res.json({ success: true, ..._orch.getStatistics() });
});

// POST /missions/orchestrator/create
router.post("/missions/orchestrator/create", (req, res) => {
    if (!_orch) return _orchErr(res);
    const { goal, priority, requiresApproval, rollbackPlan, skipCapabilities } = req.body;
    try {
        const mission = _orch.createManual({ goal, priority, requiresApproval, rollbackPlan, skipCapabilities });
        return res.json({ success: true, mission });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

// POST /missions/orchestrator/pause
router.post("/missions/orchestrator/pause", (req, res) => {
    if (!_orch) return _orchErr(res);
    const { missionId, reason } = req.body;
    if (!missionId) return res.status(400).json({ success: false, error: "missionId required" });
    try {
        const mission = _orch.pause(missionId, reason);
        return res.json({ success: true, mission });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// POST /missions/orchestrator/resume
router.post("/missions/orchestrator/resume", (req, res) => {
    if (!_orch) return _orchErr(res);
    const { missionId } = req.body;
    if (!missionId) return res.status(400).json({ success: false, error: "missionId required" });
    try {
        const mission = _orch.resume(missionId);
        return res.json({ success: true, mission });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// POST /missions/orchestrator/cancel
router.post("/missions/orchestrator/cancel", (req, res) => {
    if (!_orch) return _orchErr(res);
    const { missionId, reason } = req.body;
    if (!missionId) return res.status(400).json({ success: false, error: "missionId required" });
    try {
        const mission = _orch.cancel(missionId, reason);
        return res.json({ success: true, mission });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// GET /missions/orchestrator/:id  — must come last
router.get("/missions/orchestrator/:id", (req, res) => {
    if (!_orch) return _orchErr(res);
    const mission = _orch.getMission(req.params.id);
    if (!mission) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, mission });
});

// ── J3: Mission-Aware Git Bridge ──────────────────────────────────────────────
// Records git operations (commits, branches, diffs, rollbacks) into mission
// timeline, approval queue, and memory. Uses existing missionMemory + runtime.

// POST /mission/git/record-commit
// Records a commit as a mission artifact + timeline event.
router.post("/mission/git/record-commit", (req, res) => {
    const { missionId, commitHash, commitMessage, branch, author, filesChanged, diff } = req.body || {};
    if (!missionId || !commitHash) {
        return res.status(400).json({ success: false, error: "missionId and commitHash required" });
    }
    _send(res, () => {
        const mission = memory.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        const artifact = memory.recordArtifact(missionId, {
            type:        "git-commit",
            name:        `commit:${commitHash.slice(0, 8)}`,
            path:        `${branch || "HEAD"}@${commitHash.slice(0, 8)}`,
            description: commitMessage,
            metadata:    { commitHash, branch, author, filesChanged: filesChanged || [], hasDiff: !!diff },
        });
        const decision = memory.recordDecision(missionId, {
            type:        "git-commit",
            description: `Commit on branch ${branch || "HEAD"}: ${commitMessage}`,
            rationale:   `${filesChanged?.length || 0} file(s) changed`,
            outcome:     "committed",
        });
        return { artifact, decision };
    });
});

// POST /mission/git/record-branch
// Records branch creation / checkout as a mission decision.
router.post("/mission/git/record-branch", (req, res) => {
    const { missionId, branchName, action, fromBranch } = req.body || {};
    if (!missionId || !branchName) {
        return res.status(400).json({ success: false, error: "missionId and branchName required" });
    }
    _send(res, () => {
        const mission = memory.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        const decision = memory.recordDecision(missionId, {
            type:        `git-branch-${action || "create"}`,
            description: `Branch ${action || "created"}: ${branchName}`,
            rationale:   fromBranch ? `From ${fromBranch}` : "New branch",
            outcome:     action || "created",
        });
        return { decision };
    });
});

// POST /mission/git/record-rollback
// Records a rollback operation as a mission failure + decision.
router.post("/mission/git/record-rollback", (req, res) => {
    const { missionId, targetHash, reason, phase } = req.body || {};
    if (!missionId || !targetHash) {
        return res.status(400).json({ success: false, error: "missionId and targetHash required" });
    }
    _send(res, () => {
        const mission = memory.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        const failure = memory.recordFailure(missionId, {
            phase:       phase || "commit",
            description: `Rolled back to ${targetHash.slice(0, 8)}`,
            rootCause:   reason || "Manual rollback",
            resolved:    true,
        });
        const decision = memory.recordDecision(missionId, {
            type:        "git-rollback",
            description: `Rolled back to ${targetHash.slice(0, 8)}: ${reason || "Manual rollback"}`,
            rationale:   reason || "Manual rollback triggered",
            outcome:     "rolled-back",
        });
        return { failure, decision };
    });
});

// POST /mission/git/record-review
// Records a code review request as a mission approval.
router.post("/mission/git/record-review", (req, res) => {
    const { missionId, reviewType, requestedBy, files, summary } = req.body || {};
    if (!missionId) {
        return res.status(400).json({ success: false, error: "missionId required" });
    }
    _send(res, () => {
        const mission = memory.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        const approval = memory.recordApproval(missionId, {
            requestedBy: requestedBy || "operator",
            approvedBy:  null,
            type:        reviewType || "code-review",
            status:      "pending",
        });
        const artifact = memory.recordArtifact(missionId, {
            type:        "review-request",
            name:        `review-${Date.now()}`,
            path:        null,
            description: summary || `Code review requested for ${files?.length || 0} files`,
            metadata:    { files: files || [], reviewType },
        });
        return { approval, artifact };
    });
});

// POST /mission/git/generate-summary
// Asks the AI (via capability registry) to summarize a diff into a commit message.
// Falls back to a structural summary if AI unavailable.
router.post("/mission/git/generate-summary", async (req, res) => {
    const { diff, filesChanged, branch, missionObjective } = req.body || {};
    if (!diff && !filesChanged?.length) {
        return res.status(400).json({ success: false, error: "diff or filesChanged required" });
    }

    try {
        // Structural fallback summary (always available)
        const changed  = filesChanged || [];
        const addLines = (diff || '').split('\n').filter(l => l.startsWith('+')).length;
        const delLines = (diff || '').split('\n').filter(l => l.startsWith('-')).length;
        const fileList = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` +${changed.length - 5} more` : '');

        let summary = '';
        if (missionObjective) {
            summary = `${missionObjective.slice(0, 60).replace(/\n/g, ' ')}: `;
        }

        if (changed.length === 1) {
            const f = changed[0].split('/').pop();
            summary += `update ${f} (+${addLines} -${delLines})`;
        } else {
            summary += `update ${changed.length} files (+${addLines} -${delLines})`;
        }

        const bullets = changed.slice(0, 5).map(f => `- ${f.split('/').pop()}`).join('\n');
        const body = `Files changed:\n${bullets}${changed.length > 5 ? `\n- ...${changed.length - 5} more` : ''}`;

        // Try AI if capability registry has an AI agent
        let aiSummary = null;
        try {
            const registry = require("../../agents/runtime/agentRegistry.cjs");
            const agent    = registry.findForCapability("commit.summarize") || registry.findForCapability("ai.complete");
            if (agent) {
                const prompt = [
                    "Write a concise git commit message (imperative, ≤72 chars subject) for:",
                    missionObjective ? `Mission: ${missionObjective}` : '',
                    `Branch: ${branch || 'main'}`,
                    `Files: ${fileList}`,
                    diff ? `Diff (first 2000 chars):\n${diff.slice(0, 2000)}` : '',
                ].filter(Boolean).join('\n');
                const result = await agent.handler({ type: "ai.complete", payload: { prompt } }, {});
                if (result?.text || result?.content) aiSummary = (result.text || result.content).trim().split('\n')[0];
            }
        } catch {}

        return res.json({
            success:  true,
            summary:  aiSummary || summary,
            body:     aiSummary ? '' : body,
            aiUsed:   !!aiSummary,
            fallback: summary,
        });
    } catch (err) {
        logger.warn(`[Mission Git] generate-summary error: ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /mission/git/complete-on-commit
// Marks a mission as completed when its final commit lands.
router.post("/mission/git/complete-on-commit", (req, res) => {
    const { missionId, commitHash, summary } = req.body || {};
    if (!missionId) return res.status(400).json({ success: false, error: "missionId required" });
    _send(res, () => {
        const mission = memory.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        if (mission.status !== "running") {
            return { skipped: true, reason: `Mission is ${mission.status}`, mission };
        }
        const artifact = memory.recordArtifact(missionId, {
            type:        "final-commit",
            name:        `final:${(commitHash || "").slice(0, 8)}`,
            path:        commitHash || null,
            description: summary || "Mission completed via commit",
        });
        const completed = runtime.completeMission(missionId, { summary: summary || `Completed via commit ${commitHash?.slice(0,8)}` });
        return { mission: completed, artifact };
    });
});

// GET /mission/git/context/:id
// Returns the git context for a mission: branch name suggestion, recent commits, related artifacts.
router.get("/mission/git/context/:id", (req, res) => {
    _send(res, () => {
        const mission = memory.getMission(req.params.id);
        if (!mission) throw new Error(`Mission not found: ${req.params.id}`);

        const gitArtifacts = (mission.artifacts || []).filter(a =>
            a.type === "git-commit" || a.type === "review-request" || a.type === "final-commit"
        );
        const gitDecisions = (mission.decisions || []).filter(d =>
            d.type?.startsWith("git-")
        );
        const objective = mission.objective || "";
        const slug = objective.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        const suggestedBranch = `feature/${slug || "mission-" + mission.id.slice(0, 8)}`;

        return {
            missionId:       mission.id,
            objective:       mission.objective,
            status:          mission.status,
            suggestedBranch,
            commitCount:     gitArtifacts.filter(a => a.type === "git-commit").length,
            gitArtifacts,
            gitDecisions,
            requiresApproval: mission.requiresApproval || false,
        };
    });
});

// GET /mission/git/history
// Returns recent mission-linked commits across all missions (timeline scan).
router.get("/mission/git/history", (req, res) => {
    _send(res, () => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const { missions } = memory.listMissions({ limit: 200 });
        const history = [];
        for (const m of missions) {
            for (const a of (m.artifacts || [])) {
                if (a.type === "git-commit" || a.type === "final-commit") {
                    history.push({
                        missionId:    m.id,
                        objective:    m.objective,
                        missionStatus: m.status,
                        commitHash:   a.metadata?.commitHash || a.path,
                        commitMessage: a.description,
                        branch:       a.metadata?.branch,
                        author:       a.metadata?.author,
                        recordedAt:   a.recordedAt,
                        isFinal:      a.type === "final-commit",
                    });
                }
            }
        }
        history.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
        return { history: history.slice(0, limit) };
    });
});

module.exports = router;
