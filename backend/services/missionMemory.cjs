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
 * MASTER RECOVERY (2026-08-15, C10-004/C9 mission-context leak): this file
 * has 74 internal consumers across the codebase — autonomous engineering,
 * knowledge graphs, executive/platform/civilization state, business
 * automation, and more — the large majority of which use missions as
 * shared, cross-cutting platform infrastructure, NOT as tenant-owned
 * business objects. Making orgId a REQUIRED parameter (the pattern used for
 * Developer OS, C10-003) would break dozens of legitimate internal
 * integrations that were never meant to be org-scoped — exactly what the
 * recovery mandate warns against ("do not break legitimate shared
 * engineering knowledge").
 *
 * Instead: orgId is OPTIONAL everywhere in this file. createMission()
 * stores it if the caller supplies one (data.orgId); every existing caller
 * that doesn't pass one is completely unaffected — same behavior as before.
 * listMissions() gained an OPTIONAL opts.orgId filter: when supplied, it
 * returns ONLY missions with that exact orgId (never falls back to
 * unscoped/global missions, and never returns another org's missions) —
 * when omitted, behavior is byte-identical to before this change, which is
 * what the 74 platform-internal callers need to keep working.
 *
 * The actual tenant-facing leak this closes: codingAssistant.js's
 * _missionContext() (the function that injects "recent missions" into the
 * AI's prompt) now passes the caller's real orgId, so the AI's mission
 * context is scoped to the requesting tenant's own missions — proven live
 * in C.9 to previously inject an unrelated org's mission objective text.
 * Missions created with no orgId (the vast majority — genuine shared
 * platform/autonomous-engineering missions) are correctly EXCLUDED from an
 * orgId-filtered query, not incorrectly included as "everyone's".
 *
 * Public API:
 *   createMission(data)                  → mission   (data.orgId optional)
 *   getMission(missionId)                → mission | null
 *   listMissions(opts)                   → { missions[], total }   (opts.orgId optional filter)
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
// mtime-keyed so a genuinely different process's write (a real mtime
// change on disk) is still detected on the next read.
//
// Mission 67: this comment previously claimed renameSync "always produces
// a fresh mtime", which is not what POSIX rename() actually does —
// verified directly (Node fs.renameSync + fs.statSync): the destination
// inherits the SOURCE tmp file's mtime, it is not freshly stamped at
// rename time. On a filesystem/runner with coarser mtime resolution than
// this repo's usual dev machines (live-reproduced as the root cause of
// ERA-1's recurring "recoverStaleMissions must report at least the 1
// mission this test created" failure — mtimeMs identical across this
// SAME process's own createMission() -> updateMission() -> listMissions()
// sequence), two back-to-back writes from this SAME process can land on
// an identical mtime, making the second write's read return the FIRST
// write's now-stale cached store. _saveMissions() now updates this cache
// itself right after every successful write (see below), so this
// process never needs mtime detection for its own writes — mtime
// detection is only still relied on for a genuinely different process's
// write, which was always the real cross-process use case this comment
// described.
let _missionsCache = null; // { mtimeMs, store }

// ── Create-time dedup index ─────────────────────────────────────────────────
// JARVIS INCIDENT REPAIR (2026-09-03, P0-2): createMission() had no dedup of
// its own — the two dedup layers that existed sat entirely above this file
// (agentRuntimeSupervisor.cjs's _missionExists(), businessIntelligenceEngine
// .cjs's _recentlyTriggered()) and neither covered the ~20 org-level
// department modules (engineeringOrg/businessOrg/etc., each independently
// calling missionOrchestrator.createManual() -> this file) or any other
// direct caller. Confirmed live: 8,393 of 9,394 real missions sat permanently
// "planned", with duplicate-objective clusters up to 3,550 copies of the same
// text. This index is the final, storage-level safety boundary every caller
// passes through, regardless of which layer above did or didn't dedup first.
//
// Scope rules (deliberately narrow — see file header on orgId being optional
// platform-wide infrastructure for the large majority of the 74 existing
// consumers):
//   - Keyed on (orgId ?? "__unscoped__") + normalized objective — NEVER
//     compares across two different real orgIds. Two different real orgs
//     with the identical objective text always both get their own mission.
//     Unscoped (orgId: null) missions dedup only against other unscoped
//     missions, which is the correct behavior for shared platform/autonomous
//     -engineering missions (the vast majority of traffic).
//   - Only missions in a NON-TERMINAL status (planned/active/running) occupy
//     an index slot. A terminal mission (completed/failed/cancelled/paused)
//     is never matched against and never blocks a new, otherwise-identical
//     mission from being created — historical missions are fully preserved,
//     never touched, never reused.
//   - Normalization is deliberately conservative: trim + lowercase only, NO
//     digit-collapsing. agentRuntimeSupervisor.cjs's own _normalizeObjective()
//     (digit runs -> "#") was tried here first and reverted after it broke a
//     real, pre-existing test suite live: tests/runtime/mission-orchestrator-
//     nodetypes.test.cjs creates missions with `goal: "test goal " +
//     Date.now()` — every one of those objectives differs ONLY in its
//     embedded digits, so digit-collapsing correctly flags "Verify 169
//     missions" vs "Verify 220 missions" as the same recurring check (its
//     one intended, narrow use in agentRuntimeSupervisor._missionExists())
//     but WRONGLY flags every one of these genuinely-distinct test/CRM/RCA
//     missions (a per-lead follow-up, a per-RCA fix, a timestamped test
//     probe) as duplicates of each other. A storage-level safety boundary
//     that every caller passes through must not assume every embedded digit
//     is disposable — only exact, byte-identical (post-trim/case) objective
//     text is treated as a duplicate here. This still catches the incident's
//     actual worst offenders (3,550 byte-identical "[Auto] Follow up
//     immediately..." copies, one recommendation repeated 246 times) without
//     colliding on legitimately different text that merely shares a
//     template. The narrower digit-collapsing heuristic remains exactly
//     where it already was proven correct — agentRuntimeSupervisor.cjs's own
//     _missionExists(), scoped to its own auto-generated recurring checks —
//     untouched by this change.
//   - The index is an in-memory Map, rebuilt only when the underlying store
//     reference changes (same invalidation signal as _missionsCache's mtime
//     key) — a create-time dedup check is therefore an O(1) Map lookup, not
//     an O(N) re-scan of the whole mission list on every single create.
const _TERMINAL_STATUSES_FOR_DEDUP = new Set(["completed", "failed", "cancelled", "paused"]);

function _normalizeObjectiveForDedup(s) {
    return (s || "").trim().toLowerCase();
}

// Two different, real, pre-existing org-scoping conventions coexist in this
// codebase and must BOTH be recognized here, or org isolation silently
// breaks for whichever one is missed:
//   - the top-level mission.orgId field this file's own header comment
//     documents (used by phase27.js, codingAssistant.js, and listMissions's
//     own {orgId} filter)
//   - organizationService.cjs's createMissionForOrg(), which stamps org
//     ownership as metadata.orgId instead (its own listOrgMissions() filters
//     on m.metadata?.orgId, never m.orgId) — confirmed by direct inspection,
//     not assumed; a mission created through that path always has
//     mission.orgId === null.
// Without this fallback, every organizationService-created mission would
// fall into the same "__unscoped__" dedup bucket regardless of which real
// org created it — i.e. two different orgs' identical-objective missions
// would incorrectly dedup against each other, exactly the cross-org leak
// this dedup layer must never introduce.
function _effectiveOrgId(mission) {
    return (typeof mission.orgId === "string" && mission.orgId)
        ? mission.orgId
        : (typeof mission.metadata?.orgId === "string" && mission.metadata.orgId)
            ? mission.metadata.orgId
            : null;
}

function _dedupKey(orgId, objective) {
    return `${orgId || "__unscoped__"}::${_normalizeObjectiveForDedup(objective)}`;
}

// { forStore: <store object identity>, map: Map<dedupKey, missionId> }
let _dedupIndex = null;

function _getDedupIndex(store) {
    if (_dedupIndex && _dedupIndex.forStore === store) return _dedupIndex.map;
    const map = new Map();
    for (const m of store.missions) {
        if (_TERMINAL_STATUSES_FOR_DEDUP.has(m.status)) continue;
        map.set(_dedupKey(_effectiveOrgId(m), m.objective), m.id);
    }
    _dedupIndex = { forStore: store, map };
    return map;
}

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

// ── Cross-process write lock ─────────────────────────────────────────────────
// Mission 85 (82C reconciliation): the per-call unique tmp filename above
// (Final Production Integration mission, Blocker #6) made two writers'
// tmp files physically incapable of colliding, which eliminated the
// ENOENT/corruption crash class — but as that fix's own comment already
// documented, it does NOT fix the underlying lost-update race: two
// processes (the running server + a script/test/second worker) can each
// call _loadMissions(), read the same on-disk snapshot, mutate their own
// in-memory copy, and whichever calls _saveMissions() second silently
// overwrites the first's mutation. Each write individually succeeds and is
// individually valid JSON, so nothing crashes or logs an error — the loss
// is invisible without comparing intent to the final file.
//
// Fix: a real cross-process advisory file lock, held for the COMPLETE
// read-modify-write transaction (every public mutation function's entire
// body, from its own _loadMissions() call through _saveMissions()) — not
// just around the final write, since the race is between two reads, not
// two writes. This is the same file-lock primitive already proven in this
// codebase for the identical problem (businessDataService.cjs's
// _withLock()/_acquireLock()), reused here rather than inventing a new
// mechanism, plus same-process re-entrancy (a depth counter) so a future
// internal call from one mutation function into another can never
// self-deadlock on a lock this same process already holds — no current
// call site does this, but it costs nothing to make it safe.
//
// Design constraints:
//   - Cross-process safe: fs.openSync(lockPath, "wx") is an atomic
//     create-if-not-exists at the OS/filesystem level (POSIX O_EXCL) — two
//     processes racing to create the same lock file can never both "win".
//   - Bounded stale-lock recovery: a lock file older than _LOCK_STALE_MS is
//     presumed abandoned (holder crashed/was SIGKILLed before releasing)
//     and is force-broken by the next acquirer — the same grace-window
//     design _sweepOrphanedTmp() above already uses for tmp files, applied
//     to locks, so a crashed writer can never cause a permanent deadlock.
//   - Bounded acquisition wait: retries with a short backoff for at most
//     _LOCK_ACQUIRE_TIMEOUT_MS, then throws rather than blocking forever —
//     no unbounded wait.
//   - Exception-safe: release always runs in a `finally`, so a thrown error
//     inside the locked section can never leave the lock held.
const LOCK_FILE = `${MISSIONS_FILE}.lock`;
const _LOCK_STALE_MS          = 30_000; // older than this is presumed a crashed holder
const _LOCK_ACQUIRE_TIMEOUT_MS = 10_000; // give up (throw) rather than wait forever
const _LOCK_RETRY_MS          = 20;      // backoff between acquisition attempts

let _lockDepth = 0; // same-process re-entrancy only — cross-process exclusion is the lock file itself

function _acquireMissionsLock() {
    if (_lockDepth > 0) { _lockDepth++; return; } // already held by this process — safe re-entry
    const deadline = Date.now() + _LOCK_ACQUIRE_TIMEOUT_MS;
    for (;;) {
        try {
            const fd = fs.openSync(LOCK_FILE, "wx"); // atomic create-if-not-exists
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            _lockDepth = 1;
            return;
        } catch (err) {
            if (err.code !== "EEXIST") throw err; // a real filesystem error, not contention — propagate
            try {
                const st = fs.statSync(LOCK_FILE);
                if (Date.now() - st.mtimeMs > _LOCK_STALE_MS) {
                    // Presumed-abandoned lock — force-break it. unlinkSync can race
                    // with the real holder finishing normally at the exact same
                    // moment; either outcome (we remove a genuinely stale lock, or
                    // we raced a real release and unlinkSync throws) is safe — the
                    // next loop iteration simply retries acquisition.
                    try { fs.unlinkSync(LOCK_FILE); } catch { /* raced a real release, or already gone — fine */ }
                    logger.warn(`[MissionMemory] Broke stale lock file (older than ${_LOCK_STALE_MS}ms) — presumed crashed holder`);
                    continue;
                }
            } catch { /* stat raced the real holder's own release — just retry below */ }
            if (Date.now() >= deadline) {
                throw new Error(`[MissionMemory] Failed to acquire missions.json lock within ${_LOCK_ACQUIRE_TIMEOUT_MS}ms — another process is holding it`);
            }
            // Bounded synchronous backoff — this module's API is synchronous by
            // design (matches businessDataService.cjs's own _acquireLock()), so a
            // real async wait would require a larger refactor than this fix is
            // scoped for. _LOCK_RETRY_MS is short enough that real contention
            // (a write normally takes low single-digit ms) resolves in 1-2 iterations.
            const spinUntil = Date.now() + _LOCK_RETRY_MS;
            while (Date.now() < spinUntil) { /* bounded busy-wait */ }
        }
    }
}

function _releaseMissionsLock() {
    if (_lockDepth > 1) { _lockDepth--; return; } // still held by an outer re-entrant call
    _lockDepth = 0;
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone (e.g. broken as stale by another process) — fine */ }
}

/**
 * Runs `fn` (a synchronous, zero-argument function) with the cross-process
 * missions.json lock held for its entire duration. The correct unit of
 * atomicity is the WHOLE read-modify-write transaction, not just the final
 * write — every public mutation function below wraps its entire body in
 * this rather than only _saveMissions() acquiring a lock around the write
 * step alone.
 */
function _withMissionsLock(fn) {
    _acquireMissionsLock();
    try {
        return fn();
    } finally {
        _releaseMissionsLock();
    }
}

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
    // Mission 67: refresh the read-through cache with exactly what this
    // process just wrote, keyed on the real post-rename mtime — closes
    // the same-process stale-read window described above. If statSync
    // fails here (file removed by something else in the instant after
    // our own rename — pathological, but must never crash a successful
    // save), simply leave the cache uninitialized; the next _loadMissions()
    // falls back to reading from disk exactly as it always did before
    // this fix.
    try {
        const mtimeMs = fs.statSync(MISSIONS_FILE).mtimeMs;
        _missionsCache = { mtimeMs, store: updated };
    } catch { /* non-fatal — next read just re-reads from disk */ }
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
        // Optional — see file header comment. Most callers (74 internal
        // consumers) never pass this and get identical behavior to before
        // this field existed. When a real tenant-facing caller passes it,
        // listMissions({orgId}) can filter correctly.
        orgId:       typeof data.orgId === "string" && data.orgId ? data.orgId : null,
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

    return _withMissionsLock(() => {
        const store = _loadMissions();
        // _effectiveOrgId() also recognizes data.metadata.orgId (organizationService
        // .cjs's convention) so a caller through THAT path is scoped correctly too
        // — not just the top-level data.orgId this file's own _buildMission() persists.
        const orgId = _effectiveOrgId(data);

        // P0-2 dedup check — see _getDedupIndex() above for scope rules. A hit
        // means an equivalent NON-TERMINAL mission already exists for this exact
        // org (or this exact "unscoped" bucket) — return it as-is instead of
        // creating a duplicate. Nothing is mutated on this path: no write, no
        // subtask/timeline change to the existing mission, same guarantee as any
        // other read (getMission/listMissions). Running this check inside the
        // lock (Mission 85) closes the race where two processes could both pass
        // the dedup check against the same pre-write snapshot and both create
        // what was supposed to be a single deduped mission.
        const dedupIndex = _getDedupIndex(store);
        const existingId = dedupIndex.get(_dedupKey(orgId, data.objective));
        if (existingId) {
            const existing = _findMission(store, existingId);
            if (existing) {
                logger.info(`[MissionMemory] createMission: deduped against existing ${existing.id} (org=${orgId || "unscoped"}): "${existing.objective}"`);
                return { ...existing, deduped: true, dedupedAgainst: existing.id };
            }
        }

        const mission = _buildMission(data);
        store.missions.push(mission);
        _saveMissions(store);
        // _saveMissions() always replaces _missionsCache.store with a new object
        // (see its own `updated` literal below), so the next _loadMissions() call
        // returns a different reference and _getDedupIndex() naturally rebuilds
        // against post-write state — no separate index invalidation needed here.

        logger.info(`[MissionMemory] Created mission ${mission.id}: "${mission.objective}"`);
        return { ...mission };
    });
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
 * opts: { status, priority, limit, since, search, orgId }
 * orgId is OPTIONAL — see file header comment. When supplied, returns ONLY
 * missions whose own orgId exactly matches (never falls back to unscoped
 * missions, never returns another org's). When omitted, behavior is
 * unchanged from before this parameter existed — required for the 74
 * existing internal, non-tenant-scoped consumers of this function.
 * Returns { missions[], total }
 */
function listMissions(opts = {}) {
    const { status, priority, limit = 100, since, search, orgId } = opts;
    const store = _loadMissions();
    let   list  = store.missions;

    if (orgId) {
        list = list.filter(m => m.orgId === orgId);
    }
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
            (m.objective || "").toLowerCase().includes(q) ||
            (m.id || "").toLowerCase().includes(q) ||
            // Mission 64: same class of gap as the sort fix above — a
            // record missing subtasks (reachable the same way: a direct
            // out-of-band write bypassing createMission()/_buildMission(),
            // live-reproduced by this file's own Mission 63 regression
            // test) threw "Cannot read properties of undefined (reading
            // 'some')" here. (m.subtasks || []) matches the same
            // graceful-degradation approach as the sort fix — a malformed
            // record simply doesn't match on subtask text, it doesn't
            // crash the whole search for every other caller.
            (m.subtasks || []).some(s => (s.description || "").toLowerCase().includes(q))
        );
    }

    // Sort newest first
    // Mission 63: every mission created through this file's own
    // createMission()/_buildMission() always sets createdAt (confirmed —
    // it is the only production write path into store.missions). A
    // record missing createdAt can only reach here via a direct,
    // out-of-band write to the store bypassing this API — a real one was
    // found live-reproduced (a test fixture that pushed a raw record
    // without going through createMission()). One such malformed record
    // must not crash localeCompare() for every OTHER caller's listMissions()
    // — sort it as oldest (empty string sorts last against any real
    // ISO-8601 createdAt) rather than throwing, so a single bad record
    // degrades gracefully instead of taking down the whole list.
    list = list
        .slice()
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, limit);

    return { missions: list.map(m => ({ ...m })), total: list.length };
}

/**
 * hasMissionMatching(opts)
 *
 * JARVIS INCIDENT REPAIR (2026-09-03, P0 dedup-window-truncation fix):
 * businessIntelligenceEngine.cjs's _recentlyTriggered() used
 * listMissions({since, limit: 500}) as a 24h duplicate-existence check. That
 * is correct only while the true number of missions inside the `since`
 * window stays under `limit` — listMissions() sorts newest-first and THEN
 * applies .slice(0, limit) (see above), so once the window's real row count
 * exceeds `limit`, the truncation silently drops older-but-still-in-window
 * rows before the caller's own .some() predicate ever sees them. Live-
 * reproduced: at the real Aug 27 incident's peak, ~3001 missions existed in
 * one trailing-24h window against a limit of 500 — 6x over — producing up
 * to 71 duplicate missions for a single lead (only 1 of 71 ever completed).
 * Root cause is structural (a bounded existence check built on top of a
 * capped listing primitive), not a wrong constant — raising `limit` further
 * would only raise the volume needed to reproduce the same defect again,
 * per this incident's own remediation instructions.
 *
 * This function is a SEPARATE, purpose-built existence check — it does NOT
 * change listMissions()'s own behavior, signature, or default in any way
 * (confirmed: listMissions() below is completely unmodified by this fix).
 * It reuses the exact same `since`/`orgId` filter semantics listMissions()
 * already has (same _effectiveOrgId()-free direct `m.orgId === orgId`
 * comparison listMissions() itself uses, same `since` ISO-parse + comparison
 * against `createdAt`), but:
 *   - takes NO `limit` — there is no row count this check is allowed to
 *     silently stop scanning at; correctness requires seeing every mission
 *     inside the time window, not a capped page of it.
 *   - takes a caller-supplied `predicate(mission) => boolean` instead of
 *     returning a list, and short-circuits (stops scanning) the moment the
 *     predicate first returns true — so the common case (a match exists and
 *     is found quickly) does no more work than a single Array.prototype.some()
 *     over the since-filtered set, same complexity class as the array the
 *     old capped call already produced for a typical (<500-row) window; it
 *     never behaves worse than the code it replaces for realistic loads, and
 *     is now also CORRECT for the >500-row loads that broke it.
 *   - never materializes a second full copy of every matched mission object
 *     (no `.map(m => ({...m}))` — this function returns only a boolean, the
 *     caller doesn't need mission objects, so no unnecessary allocation is
 *     introduced for a call site that never asked for one).
 *
 * @param {object} opts
 * @param {string} opts.since - ISO-8601 lower bound on createdAt (required — this
 *   function exists specifically for bounded-window checks; an unbounded
 *   scan of the entire mission store belongs to a real listMissions() call,
 *   not here)
 * @param {string} [opts.orgId] - same optional exact-match org filter as
 *   listMissions(); omitted = unscoped search across all missions (matches
 *   listMissions()'s own existing omitted-orgId behavior)
 * @param {(mission: object) => boolean} opts.predicate - required; return
 *   true for a match. Called with the raw stored mission object (NOT a
 *   shallow copy) — read-only use only, exactly as safe as listMissions()'s
 *   own per-row access before its `.map(m => ({...m}))` copy step, since
 *   this function itself never returns those objects to the caller.
 * @returns {boolean} true iff at least one mission satisfies since + orgId
 *   (if supplied) + predicate
 */
function hasMissionMatching(opts = {}) {
    const { since, orgId, predicate } = opts;
    if (!since) throw new Error("hasMissionMatching: `since` is required");
    if (typeof predicate !== "function") throw new Error("hasMissionMatching: `predicate` function is required");

    const sinceMs = new Date(since).getTime();
    if (isNaN(sinceMs)) throw new Error(`hasMissionMatching: invalid \`since\` value "${since}"`);

    const store = _loadMissions();
    for (const m of store.missions) {
        // Same org-isolation guarantee as listMissions()'s own opts.orgId
        // filter: an exact match only, never a fallback to unscoped
        // missions, never another org's — see this file's header comment.
        if (orgId && m.orgId !== orgId) continue;
        if (new Date(m.createdAt).getTime() < sinceMs) continue;
        if (predicate(m)) return true;
    }
    return false;
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    return _withMissionsLock(() => {
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
    });
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

    // Mission 76 (2026-08-29) — same class of gap as the search-filter fix
    // above (Mission 64): a record missing subtasks/deployments/learnings/
    // failures (reachable the same way — a direct out-of-band write
    // bypassing createMission()/_buildMission(), live-reproduced via
    // post-omega-p10.test.cjs's getDashboard()/getStatistics() chain and
    // 4 real malformed records currently in data/missions.json) threw
    // "Cannot read properties of undefined (reading 'length')" on every
    // one of the 5 unguarded accesses below. (m.field || []) matches the
    // exact same graceful-degradation approach already proven for
    // listMissions()'s search filter — a malformed record simply
    // contributes 0 to these aggregates, it doesn't crash the whole
    // statistics call for every other caller.

    // Failure rate (missions that hit at least one failure / total)
    const missionsWithFailures = missions.filter(m => (m.failures || []).length > 0).length;
    const failureRate = total > 0 ? Number((missionsWithFailures / total).toFixed(4)) : 0;

    // Most common failure phases
    const phaseCounts = {};
    for (const m of missions) {
        for (const f of (m.failures || [])) {
            const ph = f.phase || "unknown";
            phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
        }
    }
    const mostCommonFailurePhases = Object.entries(phaseCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phase, count]) => ({ phase, count }));

    // Aggregated counts
    const totalSubtasks    = missions.reduce((s, m) => s + (m.subtasks    || []).length, 0);
    const totalDeployments = missions.reduce((s, m) => s + (m.deployments || []).length, 0);
    const totalLearnings   = missions.reduce((s, m) => s + (m.learnings   || []).length, 0);

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
    hasMissionMatching,
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
