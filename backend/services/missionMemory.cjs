"use strict";
/**
 * missionMemory.cjs — Track F, Priority F2 (Jarvis Brain)
 *
 * Every mission is a first-class object with full replay capability.
 * Persists to data/missions.json via atomic .tmp rename pattern.
 *
 * Intentionally does NOT duplicate storage primitives from
 * memoryPersistenceLayer.cjs — it borrows the atomic-write
 * pattern and uses its own dedicated file for mission objects.
 *
 * Public API:
 *   createMission(data)                  → mission
 *   getMission(missionId)                → mission | null
 *   listMissions(opts)                   → { missions[], total }
 *   updateMission(missionId, patch)      → mission
 *   addSubtask(missionId, subtask)       → mission
 *   recordDecision(missionId, decision)  → mission
 *   recordArtifact(missionId, artifact)  → mission
 *   recordFailure(missionId, failure)    → mission
 *   recordDeployment(missionId, deploy)  → mission
 *   recordApproval(missionId, approval)  → mission
 *   addLearning(missionId, learning)     → mission
 *   replayMission(missionId)             → { mission, timeline, replaySteps[] }
 *   getMissionStats()                    → aggregate stats object
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── File path ────────────────────────────────────────────────────────────────
const MISSIONS_FILE = path.join(__dirname, "../../data/missions.json");

// ── ID generation ────────────────────────────────────────────────────────────
function _uid(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

// ── Atomic I/O helpers ───────────────────────────────────────────────────────
// Read-through cache keyed on the file's mtime — missions.json grows large
// in real usage (10MB+/500+ missions observed live) and _loadMissions() is
// called from all 14 read/write sites in this file, meaning every single
// mission operation re-read and re-parsed the entire file even when
// nothing had changed since the last call (measured live: ~35ms/call).
// mtime is updated by every _saveMissions() call (via renameSync, which
// always produces a fresh mtime) whether the write came from this process
// or another one sharing the file, so a stale cache read is not possible —
// any real write anywhere invalidates it.
let _missionsCache = null; // { mtimeMs, store }

// B.20 chaos finding — orphaned tmp sweep.
//
// _saveMissions() writes `missions.json.<pid>.<rand>.tmp` then renames it, and
// cleans the tmp up in its catch block. That covers a *caught* write error, but
// not a process death between writeFileSync and renameSync: SIGKILL, OOM kill,
// or a host restart leaves the tmp behind with no code path that ever removes
// it. Measured on this repo: two orphans totalling ~11 MB of real disk, one of
// them from a pid that no longer exists. Nothing reads `.tmp`, so there is no
// correctness impact — it is unbounded disk growth across crash cycles.
//
// Swept once at module load (the same point the store is first used), and only
// for files matching this store's own `missions.json.<pid>.<hex>.tmp` shape, so
// it can never touch another service's tmp file or a real data file. A live
// tmp belonging to a *currently running* write is younger than the grace
// window, so a concurrent writer's file is never removed.
const _TMP_RE = /^missions\.json\.\d+\.[0-9a-f]+\.tmp$/;
const _TMP_GRACE_MS = 5 * 60 * 1000;

function _sweepOrphanedTmp() {
    try {
        const dir = path.dirname(MISSIONS_FILE);
        const now = Date.now();
        let removed = 0, bytes = 0;
        for (const name of fs.readdirSync(dir)) {
            if (!_TMP_RE.test(name)) continue;
            const full = path.join(dir, name);
            try {
                const st = fs.statSync(full);
                if (now - st.mtimeMs < _TMP_GRACE_MS) continue; // possibly an in-flight write
                bytes += st.size;
                fs.unlinkSync(full);
                removed++;
            } catch { /* raced with another sweep or a rename — fine either way */ }
        }
        if (removed) {
            logger.warn(`[MissionMemory] Swept ${removed} orphaned tmp file(s) (${Math.round(bytes / 1024)} KB) ` +
                `left by an interrupted write.`);
        }
    } catch { /* directory unreadable — never block startup on cleanup */ }
}

_sweepOrphanedTmp();

function _loadMissions() {
    let mtimeMs;
    try { mtimeMs = fs.statSync(MISSIONS_FILE).mtimeMs; }
    catch { mtimeMs = null; } // file doesn't exist yet — fall through to the empty-store path below

    if (mtimeMs !== null && _missionsCache && _missionsCache.mtimeMs === mtimeMs) {
        return _missionsCache.store;
    }

    try {
        const raw = fs.readFileSync(MISSIONS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        const store = (!parsed || !Array.isArray(parsed.missions))
            ? { missions: [], lastUpdated: new Date().toISOString() }
            : parsed;
        if (mtimeMs !== null) _missionsCache = { mtimeMs, store };
        return store;
    } catch (err) {
        if (err.code !== "ENOENT") {
            logger.warn(`[MissionMemory] Load failed: ${err.message} — starting empty`);
        }
        return { missions: [], lastUpdated: new Date().toISOString() };
    }
}

// Final Production Integration mission, Blocker #6 fix — the shared
// literal ".tmp" path collided across processes: a real, long-running
// server process and a second process (test/script/ops tool) writing
// missions.json around the same time could each write their own content
// to the SAME tmp path, then the first to rename() would consume it out
// from under the second, producing a reproducible ENOENT on renameSync
// and silently dropping that write. Same real fix already applied to
// organizationService.cjs and secretVault.cjs this session: a
// per-call-unique tmp filename (pid + random suffix) means two
// processes/calls can never share a tmp path, so rename() always finds
// its own file. This does not fix the underlying lost-update race for
// two writes based on the same stale read (a real lock/single-writer
// queue would be a larger architectural change, out of scope here) — it
// eliminates the file-corruption/ENOENT-crash class, which is what was
// actually observed and reproduced.
// B.1 runtime stabilization: missions.json had no retention cap and had
// grown to 76.8 MB / 10,370 missions. Measured consequences on the running
// server: every write invalidates the mtime cache above, so the next read
// re-parses the whole file — 483 ms of blocked event loop (158 ms read +
// 325 ms JSON.parse). Writes were measured at 16/minute, i.e. ~7.7 s of
// event-loop stall per minute (~13% of wall-clock frozen). That is the
// measured root cause of Phase A's 33% /health failure rate and 5,800x
// latency variance at only 31% CPU — it was never CPU exhaustion.
//
// 90% of the file is terminal history (9,320 completed / 394 failed /
// 12 cancelled vs 644 live). Capping retained TERMINAL missions bounds the
// file while preserving every active/planned mission untouched. Uses the
// same slice(-N) retention pattern already used by productPlannerEngine
// (200 plans) and growthOS (10,000 events) — no new architecture.
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_TERMINAL_MISSIONS = 1000;

function _capTerminalMissions(missions) {
    if (!Array.isArray(missions) || missions.length <= MAX_TERMINAL_MISSIONS) return missions;
    const live = [], terminal = [];
    for (const m of missions) (TERMINAL_STATUSES.has(m?.status) ? terminal : live).push(m);
    if (terminal.length <= MAX_TERMINAL_MISSIONS) return missions;
    // Keep every live mission plus the most recent terminal ones (array order
    // is append-order, so the tail is newest).
    return live.concat(terminal.slice(-MAX_TERMINAL_MISSIONS));
}

function _saveMissions(store) {
    const dir = path.dirname(MISSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const updated = { missions: _capTerminalMissions(store.missions), lastUpdated: new Date().toISOString() };
    const tmp = `${MISSIONS_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), "utf8");
        fs.renameSync(tmp, MISSIONS_FILE);
    } catch (err) {
        logger.error(`[MissionMemory] Save failed: ${err.message}`);
        // best-effort cleanup
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
    }
    return updated;
}

// ── Internal store helpers ───────────────────────────────────────────────────
function _findMission(store, missionId) {
    return store.missions.find(m => m.id === missionId) || null;
}

function _replaceMission(store, updated) {
    const idx = store.missions.findIndex(m => m.id === updated.id);
    if (idx === -1) throw new Error(`Mission ${updated.id} not found in store`);
    store.missions[idx] = updated;
}

// ── Metrics recompute ────────────────────────────────────────────────────────
function _recomputeMetrics(mission) {
    return {
        totalSubtasks:     mission.subtasks.length,
        completedSubtasks: mission.subtasks.filter(s => s.status === "completed").length,
        failureCount:      mission.failures.length,
        deploymentCount:   mission.deployments.length,
    };
}

// ── Timeline helper ──────────────────────────────────────────────────────────
function _appendTimeline(mission, event, details = {}) {
    mission.timeline.push({
        timestamp: new Date().toISOString(),
        event,
        details,
    });
}

// ── Mission factory ──────────────────────────────────────────────────────────
function _buildMission(data) {
    const now = new Date().toISOString();
    const mission = {
        id:          _uid("msn"),
        objective:   (data.objective || "").trim(),
        status:      "planned",
        priority:    data.priority || "medium",
        metadata:    (data.metadata && typeof data.metadata === "object") ? data.metadata : {},
        createdAt:   now,
        updatedAt:   now,
        completedAt: null,
        subtasks:    [],
        decisions:   [],
        artifacts:   [],
        failures:    [],
        deployments: [],
        approvals:   [],
        learnings:   [],
        timeline:    [],
        metrics:     { totalSubtasks: 0, completedSubtasks: 0, failureCount: 0, deploymentCount: 0 },
    };

    // Seed timeline
    _appendTimeline(mission, "mission_created", { objective: mission.objective, priority: mission.priority });

    // Optionally pre-populate subtasks
    if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
        for (const st of data.subtasks) {
            _ingestSubtask(mission, st, /* skipTimeline */ false);
        }
    }

    mission.metrics = _recomputeMetrics(mission);
    return mission;
}

// ── Subtask ingestion (shared by createMission + addSubtask) ─────────────────
function _ingestSubtask(mission, subtask, emitTimeline = true) {
    const now = new Date().toISOString();
    const st = {
        id:           subtask.id || _uid("sub"),
        description:  (subtask.description || "").trim(),
        status:       subtask.status || "pending",
        assignedAgent: subtask.assignedAgent || null,
        startedAt:    subtask.startedAt || null,
        completedAt:  subtask.completedAt || null,
        output:       subtask.output || null,
    };
    mission.subtasks.push(st);
    if (emitTimeline) {
        _appendTimeline(mission, "subtask_added", { subtaskId: st.id, description: st.description });
    }
    return st;
}

// ── Validation helpers ───────────────────────────────────────────────────────
// "running" is missionRuntime.cjs's status for an in-progress mission (its
// TRANSITIONS state machine uses this vocabulary throughout, and the real
// POST /mission/runtime/start/:id route depends on it) — every call to
// startMission() threw "invalid status \"running\"" here before this was
// added, because this set only had "active" for that same concept. Keeping
// both: "active" already has scattered lower-confidence external readers
// (e.g. backend/routes/engineering.js explicitly checks
// `status === "running" || status === "active"`, apparently defensively
// coded around this exact mismatch previously), so removing it risks a
// silent behavior change elsewhere; adding "running" is the minimal fix
// that makes the actually-used state machine work.
const VALID_STATUSES  = new Set(["planned", "active", "running", "paused", "completed", "failed", "cancelled"]);
const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

function _assertMission(mission, missionId) {
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════════

/**
 * createMission(data)
 * Required: data.objective (string)
 * Optional: data.priority, data.subtasks[]
 */
function createMission(data = {}) {
    if (!data.objective || typeof data.objective !== "string" || !data.objective.trim()) {
        throw new Error("createMission: `objective` is required and must be a non-empty string");
    }
    if (data.priority && !VALID_PRIORITIES.has(data.priority)) {
        throw new Error(`createMission: invalid priority "${data.priority}". Must be one of: ${[...VALID_PRIORITIES].join(", ")}`);
    }

    const store   = _loadMissions();
    const mission = _buildMission(data);
    store.missions.push(mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Created mission ${mission.id}: "${mission.objective}"`);
    return { ...mission };
}

/**
 * getMission(missionId)
 * Returns full mission object or null.
 */
function getMission(missionId) {
    if (!missionId) throw new Error("getMission: missionId is required");
    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    if (!mission) {
        logger.debug(`[MissionMemory] getMission: ${missionId} not found`);
        return null;
    }
    return { ...mission };
}

/**
 * listMissions(opts)
 * opts: { status, priority, limit, since, search }
 * Returns { missions[], total }
 */
function listMissions(opts = {}) {
    const { status, priority, limit = 100, since, search } = opts;
    const store = _loadMissions();
    let   list  = store.missions;

    if (status) {
        if (!VALID_STATUSES.has(status)) throw new Error(`listMissions: invalid status "${status}"`);
        list = list.filter(m => m.status === status);
    }
    if (priority) {
        if (!VALID_PRIORITIES.has(priority)) throw new Error(`listMissions: invalid priority "${priority}"`);
        list = list.filter(m => m.priority === priority);
    }
    if (since) {
        const sinceMs = new Date(since).getTime();
        if (isNaN(sinceMs)) throw new Error(`listMissions: invalid \`since\` value "${since}"`);
        list = list.filter(m => new Date(m.createdAt).getTime() >= sinceMs);
    }
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(m =>
            m.objective.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            m.subtasks.some(s => s.description.toLowerCase().includes(q))
        );
    }

    // Sort newest first
    list = list
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);

    return { missions: list.map(m => ({ ...m })), total: list.length };
}

/**
 * updateMission(missionId, patch)
 * Allowed patch keys: status, priority, objective, completedAt (plus arbitrary metadata).
 * Immutable keys (id, createdAt, subtasks, decisions, artifacts, failures,
 * deployments, approvals, learnings, timeline, metrics) are ignored in patch.
 */
function updateMission(missionId, patch = {}) {
    if (!missionId) throw new Error("updateMission: missionId is required");
    if (!patch || typeof patch !== "object") throw new Error("updateMission: patch must be an object");

    if (patch.status && !VALID_STATUSES.has(patch.status)) {
        throw new Error(`updateMission: invalid status "${patch.status}"`);
    }
    if (patch.priority && !VALID_PRIORITIES.has(patch.priority)) {
        throw new Error(`updateMission: invalid priority "${patch.priority}"`);
    }

    const IMMUTABLE = new Set([
        "id", "createdAt", "subtasks", "decisions", "artifacts",
        "failures", "deployments", "approvals", "learnings", "timeline", "metrics",
    ]);

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now     = new Date().toISOString();
    const changed = {};

    for (const [k, v] of Object.entries(patch)) {
        if (IMMUTABLE.has(k)) continue;
        if (mission[k] !== v) {
            changed[k] = { from: mission[k], to: v };
            mission[k] = v;
        }
    }

    // Auto-set completedAt when transitioning to terminal states
    if (patch.status === "completed" || patch.status === "failed" || patch.status === "cancelled") {
        if (!mission.completedAt) {
            mission.completedAt = now;
            changed.completedAt = { from: null, to: now };
        }
    }

    mission.updatedAt = now;
    _appendTimeline(mission, "mission_updated", { changes: changed });
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Updated mission ${missionId}`, Object.keys(changed));
    return { ...mission };
}

/**
 * addSubtask(missionId, subtask)
 * subtask: { description, status?, assignedAgent?, startedAt?, completedAt?, output? }
 */
function addSubtask(missionId, subtask = {}) {
    if (!missionId) throw new Error("addSubtask: missionId is required");
    if (!subtask.description || !subtask.description.trim()) {
        throw new Error("addSubtask: subtask.description is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const st = _ingestSubtask(mission, subtask, true);
    mission.metrics  = _recomputeMetrics(mission);
    mission.updatedAt = new Date().toISOString();
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Subtask ${st.id} added to mission ${missionId}`);
    return { ...mission };
}

/**
 * updateSubtask(missionId, subtaskId, patch)
 * patch: any subtask field except id (e.g. { status, startedAt, completedAt, output })
 *
 * A.5.2 runtime-stability finding: there was previously no dedicated way to
 * mutate a subtask in place — the only path (missionRuntime.cjs's
 * updateSubtaskStatus) went through updateMission(missionId, { subtasks }),
 * but "subtasks" is in updateMission()'s own IMMUTABLE set, so that patch
 * key was always silently dropped. Every subtask, on every mission, system
 * -wide, was permanently stuck at its initial status. This was silent (no
 * error, no log) and had real downstream effects beyond correctness: graphReasoningEngine.cjs's
 * findBlockedMissions() flags any active mission whose subtasks are ALL
 * still "pending" as stuck/blocked — which, because subtask status could
 * never persist, was true of essentially every active mission with
 * subtasks, including the very "Resolve blockers for mission: X" missions
 * created to address it. That produced unbounded self-referential mission
 * creation ("Resolve blockers for mission: Resolve blockers for mission:
 * ..." nesting deeper each cycle), confirmed live in this session. Fixed
 * at the actual source (real subtask persistence) rather than patched
 * downstream, since the missing capability is what every symptom traced
 * back to. Mirrors addSubtask's shape exactly — no new persistence
 * mechanism, same load/mutate/save pattern already used throughout this
 * file.
 */
function updateSubtask(missionId, subtaskId, patch = {}) {
    if (!missionId)  throw new Error("updateSubtask: missionId is required");
    if (!subtaskId)  throw new Error("updateSubtask: subtaskId is required");
    if (!patch || typeof patch !== "object") throw new Error("updateSubtask: patch must be an object");

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const st = (mission.subtasks || []).find(s => s.id === subtaskId);
    if (!st) throw new Error(`updateSubtask: subtask ${subtaskId} not found in mission ${missionId}`);

    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
        if (k === "id") continue;
        if (st[k] !== v) {
            changed[k] = { from: st[k], to: v };
            st[k] = v;
        }
    }

    if (Object.keys(changed).length === 0) return { ...mission };

    mission.metrics   = _recomputeMetrics(mission);
    mission.updatedAt = new Date().toISOString();
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Subtask ${subtaskId} updated on mission ${missionId}`, Object.keys(changed));
    return { ...mission };
}

/**
 * recordDecision(missionId, decision)
 * decision: { type, description, rationale, outcome }
 */
function recordDecision(missionId, decision = {}) {
    if (!missionId) throw new Error("recordDecision: missionId is required");
    if (!decision.description || !decision.description.trim()) {
        throw new Error("recordDecision: decision.description is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const dec = {
        id:          _uid("dec"),
        timestamp:   now,
        type:        decision.type        || "operational",
        description: (decision.description || "").trim(),
        rationale:   decision.rationale   || null,
        outcome:     decision.outcome     || null,
    };
    mission.decisions.push(dec);
    _appendTimeline(mission, "decision_recorded", { decisionId: dec.id, type: dec.type, description: dec.description });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Decision ${dec.id} recorded on mission ${missionId}`);
    return { ...mission };
}

/**
 * recordArtifact(missionId, artifact)
 * artifact: { type, name, path, description? }
 */
function recordArtifact(missionId, artifact = {}) {
    if (!missionId) throw new Error("recordArtifact: missionId is required");
    if (!artifact.name || !artifact.name.trim()) {
        throw new Error("recordArtifact: artifact.name is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const art = {
        id:          _uid("art"),
        type:        artifact.type        || "file",
        name:        (artifact.name || "").trim(),
        path:        artifact.path        || null,
        createdAt:   now,
        description: artifact.description || null,
    };
    mission.artifacts.push(art);
    _appendTimeline(mission, "artifact_recorded", { artifactId: art.id, type: art.type, name: art.name });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Artifact ${art.id} recorded on mission ${missionId}`);
    return { ...mission };
}

/**
 * recordFailure(missionId, failure)
 * failure: { phase, description, rootCause?, resolved? }
 */
function recordFailure(missionId, failure = {}) {
    if (!missionId) throw new Error("recordFailure: missionId is required");
    if (!failure.description || !failure.description.trim()) {
        throw new Error("recordFailure: failure.description is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const fail = {
        id:          _uid("fail"),
        timestamp:   now,
        phase:       (failure.phase        || "unknown").trim(),
        description: (failure.description  || "").trim(),
        rootCause:   failure.rootCause     || null,
        resolved:    failure.resolved      ?? false,
    };
    mission.failures.push(fail);
    mission.metrics  = _recomputeMetrics(mission);
    _appendTimeline(mission, "failure_recorded", {
        failureId:   fail.id,
        phase:       fail.phase,
        description: fail.description,
        resolved:    fail.resolved,
    });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.warn(`[MissionMemory] Failure ${fail.id} recorded on mission ${missionId} — phase: ${fail.phase}`);
    return { ...mission };
}

/**
 * recordDeployment(missionId, deployment)
 * deployment: { environment, status, version?, rollbackAvailable? }
 */
function recordDeployment(missionId, deployment = {}) {
    if (!missionId) throw new Error("recordDeployment: missionId is required");
    if (!deployment.environment || !deployment.environment.trim()) {
        throw new Error("recordDeployment: deployment.environment is required");
    }
    if (!deployment.status || !deployment.status.trim()) {
        throw new Error("recordDeployment: deployment.status is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const dep = {
        id:                _uid("dep"),
        timestamp:         now,
        environment:       (deployment.environment        || "").trim(),
        status:            (deployment.status             || "").trim(),
        version:           deployment.version             || null,
        rollbackAvailable: deployment.rollbackAvailable   ?? false,
    };
    mission.deployments.push(dep);
    mission.metrics  = _recomputeMetrics(mission);
    _appendTimeline(mission, "deployment_recorded", {
        deploymentId: dep.id,
        environment:  dep.environment,
        status:       dep.status,
        version:      dep.version,
    });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Deployment ${dep.id} recorded on mission ${missionId} — env: ${dep.environment}, status: ${dep.status}`);
    return { ...mission };
}

/**
 * recordApproval(missionId, approval)
 * approval: { requestedBy, approvedBy?, type, status }
 */
function recordApproval(missionId, approval = {}) {
    if (!missionId) throw new Error("recordApproval: missionId is required");
    if (!approval.type || !approval.type.trim()) {
        throw new Error("recordApproval: approval.type is required");
    }
    if (!approval.status || !approval.status.trim()) {
        throw new Error("recordApproval: approval.status is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const apr = {
        id:          _uid("apr"),
        timestamp:   now,
        requestedBy: approval.requestedBy || null,
        approvedBy:  approval.approvedBy  || null,
        type:        (approval.type   || "").trim(),
        status:      (approval.status || "").trim(),
    };
    mission.approvals.push(apr);
    _appendTimeline(mission, "approval_recorded", {
        approvalId:  apr.id,
        type:        apr.type,
        status:      apr.status,
        requestedBy: apr.requestedBy,
        approvedBy:  apr.approvedBy,
    });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Approval ${apr.id} recorded on mission ${missionId} — type: ${apr.type}, status: ${apr.status}`);
    return { ...mission };
}

/**
 * addLearning(missionId, learning)
 * learning: { insight, source?, confidence? }
 */
function addLearning(missionId, learning = {}) {
    if (!missionId) throw new Error("addLearning: missionId is required");
    if (!learning.insight || !learning.insight.trim()) {
        throw new Error("addLearning: learning.insight is required");
    }

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    const now = new Date().toISOString();
    const confidence = Number.isFinite(learning.confidence)
        ? Math.min(100, Math.max(0, learning.confidence))
        : 80;

    const lrn = {
        id:         _uid("lrn"),
        timestamp:  now,
        insight:    (learning.insight || "").trim(),
        source:     learning.source   || null,
        confidence,
    };
    mission.learnings.push(lrn);
    _appendTimeline(mission, "learning_added", {
        learningId: lrn.id,
        insight:    lrn.insight,
        confidence: lrn.confidence,
    });
    mission.updatedAt = now;
    _replaceMission(store, mission);
    _saveMissions(store);

    logger.info(`[MissionMemory] Learning ${lrn.id} added to mission ${missionId}`);
    return { ...mission };
}

/**
 * replayMission(missionId)
 * Returns { mission, timeline, replaySteps[] }
 *
 * replaySteps is the timeline translated into structured, human+machine-readable
 * steps with enough context to re-execute or audit the mission from scratch.
 */
function replayMission(missionId) {
    if (!missionId) throw new Error("replayMission: missionId is required");

    const store   = _loadMissions();
    const mission = _findMission(store, missionId);
    _assertMission(mission, missionId);

    // Build an index of all sub-objects for O(1) lookup during step enrichment
    const subtaskIdx    = new Map(mission.subtasks.map(s    => [s.id,    s]));
    const decisionIdx   = new Map(mission.decisions.map(d   => [d.id,    d]));
    const artifactIdx   = new Map(mission.artifacts.map(a   => [a.id,    a]));
    const failureIdx    = new Map(mission.failures.map(f    => [f.id,    f]));
    const deploymentIdx = new Map(mission.deployments.map(d => [d.id,    d]));
    const approvalIdx   = new Map(mission.approvals.map(a   => [a.id,    a]));
    const learningIdx   = new Map(mission.learnings.map(l   => [l.id,    l]));

    const replaySteps = mission.timeline.map((entry, idx) => {
        const step = {
            step:      idx + 1,
            timestamp: entry.timestamp,
            event:     entry.event,
            summary:   _replaySummary(entry, mission),
            details:   entry.details,
            object:    null,  // enriched below
        };

        // Enrich step with the full related object for deeper replay
        switch (entry.event) {
            case "subtask_added":
                step.object = subtaskIdx.get(entry.details.subtaskId) || null;
                break;
            case "decision_recorded":
                step.object = decisionIdx.get(entry.details.decisionId) || null;
                break;
            case "artifact_recorded":
                step.object = artifactIdx.get(entry.details.artifactId) || null;
                break;
            case "failure_recorded":
                step.object = failureIdx.get(entry.details.failureId) || null;
                break;
            case "deployment_recorded":
                step.object = deploymentIdx.get(entry.details.deploymentId) || null;
                break;
            case "approval_recorded":
                step.object = approvalIdx.get(entry.details.approvalId) || null;
                break;
            case "learning_added":
                step.object = learningIdx.get(entry.details.learningId) || null;
                break;
            case "mission_created":
            case "mission_updated":
                step.object = null; // full mission is the top-level return
                break;
            default:
                step.object = null;
        }

        return step;
    });

    logger.debug(`[MissionMemory] Replaying mission ${missionId} — ${replaySteps.length} steps`);

    return {
        mission:     { ...mission },
        timeline:    mission.timeline.map(e => ({ ...e })),
        replaySteps,
    };
}

/** Produce a human-readable one-liner for each timeline event type. */
function _replaySummary(entry, mission) {
    const d = entry.details || {};
    switch (entry.event) {
        case "mission_created":
            return `Mission created with objective: "${d.objective}" (priority: ${d.priority})`;
        case "mission_updated": {
            const keys = Object.keys(d.changes || {});
            return keys.length
                ? `Mission fields updated: ${keys.join(", ")}`
                : "Mission updated (no field changes)";
        }
        case "subtask_added":
            return `Subtask added: "${d.description}" (id: ${d.subtaskId})`;
        case "decision_recorded":
            return `Decision recorded [${d.type}]: "${d.description}" (id: ${d.decisionId})`;
        case "artifact_recorded":
            return `Artifact recorded [${d.type}]: "${d.name}" (id: ${d.artifactId})`;
        case "failure_recorded":
            return `Failure recorded in phase "${d.phase}": "${d.description}" — resolved: ${d.resolved} (id: ${d.failureId})`;
        case "deployment_recorded":
            return `Deployment to ${d.environment} — status: ${d.status}${d.version ? `, version: ${d.version}` : ""} (id: ${d.deploymentId})`;
        case "approval_recorded":
            return `Approval [${d.type}] — status: ${d.status}, by: ${d.approvedBy || "pending"} (id: ${d.approvalId})`;
        case "learning_added":
            return `Learning captured (confidence: ${d.confidence}): "${d.insight}" (id: ${d.learningId})`;
        default:
            return `Event: ${entry.event}`;
    }
}

/**
 * getMissionStats()
 * Aggregate stats across all missions.
 */
function getMissionStats() {
    const store    = _loadMissions();
    const missions = store.missions;
    const total    = missions.length;

    if (total === 0) {
        return {
            total:              0,
            byStatus:           {},
            byPriority:         {},
            avgCompletionTimeMs: null,
            failureRate:        0,
            mostCommonFailurePhases: [],
            totalSubtasks:      0,
            totalDeployments:   0,
            totalLearnings:     0,
        };
    }

    // By status / priority
    const byStatus   = {};
    const byPriority = {};
    for (const m of missions) {
        byStatus[m.status]     = (byStatus[m.status]     || 0) + 1;
        byPriority[m.priority] = (byPriority[m.priority] || 0) + 1;
    }

    // Average completion time (only for completed missions with completedAt set)
    const completed = missions.filter(m => m.status === "completed" && m.completedAt && m.createdAt);
    const avgCompletionTimeMs = completed.length
        ? Math.round(
            completed.reduce((sum, m) => {
                return sum + (new Date(m.completedAt).getTime() - new Date(m.createdAt).getTime());
            }, 0) / completed.length
          )
        : null;

    // Failure rate (missions that hit at least one failure / total)
    const missionsWithFailures = missions.filter(m => m.failures.length > 0).length;
    const failureRate = total > 0 ? Number((missionsWithFailures / total).toFixed(4)) : 0;

    // Most common failure phases
    const phaseCounts = {};
    for (const m of missions) {
        for (const f of m.failures) {
            const ph = f.phase || "unknown";
            phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
        }
    }
    const mostCommonFailurePhases = Object.entries(phaseCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phase, count]) => ({ phase, count }));

    // Aggregated counts
    const totalSubtasks    = missions.reduce((s, m) => s + m.subtasks.length,    0);
    const totalDeployments = missions.reduce((s, m) => s + m.deployments.length, 0);
    const totalLearnings   = missions.reduce((s, m) => s + m.learnings.length,   0);

    return {
        total,
        byStatus,
        byPriority,
        avgCompletionTimeMs,
        failureRate,
        mostCommonFailurePhases,
        totalSubtasks,
        totalDeployments,
        totalLearnings,
    };
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
    createMission,
    getMission,
    listMissions,
    updateMission,
    addSubtask,
    updateSubtask,
    recordDecision,
    recordArtifact,
    recordFailure,
    recordDeployment,
    recordApproval,
    addLearning,
    replayMission,
    getMissionStats,
};
