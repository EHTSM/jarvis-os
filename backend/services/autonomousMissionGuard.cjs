"use strict";
/**
 * autonomousMissionGuard.cjs — P0 autonomous feedback-loop fix
 *
 * JARVIS INCIDENT REPAIR (P0 — autonomous mission/task amplification):
 * live VPS evidence showed an unbounded autonomous mission-creation
 * cascade: engineeringOrg.cjs's _engManagerTick()/_perfEngTick() and
 * agentRuntimeSupervisor.cjs's _testerTick() each re-scan live state on
 * every tick and create a NEW mission whose objective embeds a volatile,
 * ever-changing count/measurement ("Unblock 389 stale mission(s)...",
 * "Performance: process memory at 621MB...", "Verify 169 recently
 * completed missions"). Two independently-diverged dedup guards already
 * exist in this codebase:
 *   - engineeringOrg.cjs's own _missionExists() (objective-prefix-only,
 *     NOT digit-normalized)
 *   - agentRuntimeSupervisor.cjs's own _missionExists()/_normalizeObjective()
 *     (digit-normalized, but local to that file only, and only guards
 *     non-terminal missions — a mission that goes terminal can be
 *     immediately re-created the very next tick)
 * Neither has org scoping, a cooldown window for terminal missions, or any
 * bound on how many autonomous missions/tasks can be in flight at once —
 * the real, live-reproduced mechanism behind sustained CPU exhaustion and
 * unresponsive server restarts.
 *
 * This module is the SINGLE shared guard both producer files now call
 * into, replacing their two divergent local implementations, so there is
 * exactly one place this policy lives — not a third divergent copy.
 *
 * Explicitly OUT of scope / untouched by this module:
 *   - Manual/user/operator-created missions never call this module at all
 *     (only the two autonomous producer helpers — engineeringOrg.cjs's
 *     _mission() and agentRuntimeSupervisor.cjs's _createMission() — do).
 *   - missionMemory.cjs's own P0-2 storage-level dedup index
 *     (_getDedupIndex/_dedupKey, exact-text + org-scoped, non-terminal
 *     only) is untouched — this module runs BEFORE that, as an earlier,
 *     coarser admission gate; P0-2 remains the final storage-level
 *     safety net exactly as before.
 *   - businessIntelligenceEngine.cjs's own Mission-81 entity-scoped
 *     hasMissionMatching() cooldown (_recentlyTriggered) is untouched —
 *     different producer, different signal shape (per-lead, not
 *     per-recurring-check), already correctly bounded.
 *   - Mission 82C's atomic-write lock implementation in missionMemory.cjs
 *     / taskQueue.cjs is not modified by this file at all.
 */

function _mm() { try { return require("./missionMemory.cjs"); } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────
// A. STABLE AUTONOMOUS SIGNAL IDENTITY
// ─────────────────────────────────────────────────────────────────────────
//
// Named signals get an explicit, wording-independent identity (matches the
// mission brief's own named examples exactly) so "Unblock 389..." and
// "Unblock 390..." — or any future rewording of the same check — are
// always recognized as the same recurring signal. Every other producer
// call site (there are 53 total across the two files; most are one-off,
// lower-frequency checks, not part of the proven cascade) falls back to a
// digit-normalized objective SCOPED BY autoCreatedBy — never a bare global
// regex-over-everything, so two different producers' similarly-worded
// objectives can never collide into the same signal identity.
const NAMED_SIGNALS = [
    { type: "unblock_stale_missions",     re: /^Unblock \d+ stale mission/ },
    { type: "perf_memory_pressure",       re: /^Performance: process memory at \d+MB/ },
    { type: "perf_slow_metrics",          re: /^Performance: \d+ metric\(s\) with latency/ },
    { type: "perf_exec_latency",          re: /^Performance: avg execution time/ },
    { type: "verify_completed_missions",  re: /^Verify \d+ recently completed/ },
    { type: "qa_verification_gap",        re: /^QA: \d+ completed missions/ },
    { type: "docs_lesson_gap",            re: /^Docs: document lesson/ },
    { type: "docs_runbook_gap",           re: /^Docs: create runbook/ },
];

function _normalizeObjective(s) {
    return String(s || "").replace(/\d+/g, "#");
}

/**
 * classifySignal(objective, autoCreatedBy)
 * Returns a stable signalType (for the 7 named recurring checks) or a
 * producer-scoped fallback signalType for every other autonomous call
 * site. Never depends on volatile embedded counts/measurements.
 */
function classifySignal(objective, autoCreatedBy) {
    const obj = String(objective || "");
    for (const sig of NAMED_SIGNALS) {
        if (sig.re.test(obj)) return sig.type;
    }
    // Scoped fallback — never a bare global normalize: two different
    // producers (e.g. "backend_eng" vs "qa_eng") with superficially
    // similar wording never collide into the same signal.
    const scope = String(autoCreatedBy || "unknown_producer");
    return `${scope}::${_normalizeObjective(obj).slice(0, 80)}`;
}

/**
 * signalKey(signalType, orgId)
 * The identity a cooldown/admission check is actually keyed on —
 * signalType + org, matching this codebase's existing effectiveOrgId
 * convention (missionMemory.cjs's own _effectiveOrgId — unscoped
 * autonomous producers, which is all of them today, get orgId=null,
 * i.e. one shared unscoped bucket per signal, exactly matching
 * businessIntelligenceEngine.cjs's own current unscoped call shape).
 */
function _signalKey(signalType, orgId) {
    return `${orgId || "__unscoped__"}::${signalType}`;
}

// ─────────────────────────────────────────────────────────────────────────
// B. COOLDOWN / SINGLE-FLIGHT
// ─────────────────────────────────────────────────────────────────────────
//
// Two distinct rules, both required by the mission brief:
//   1. Single-flight: at most one NON-TERMINAL mission for a given
//      signal+org may exist at a time (mirrors P0-2's own non-terminal-only
//      dedup scope, applied at the signal-identity level instead of exact
//      objective text).
//   2. Cooldown window: even after a mission for this signal goes
//      terminal (completed/failed/cancelled), a NEW one cannot be created
//      again until COOLDOWN_MS has passed since that terminal mission's
//      completedAt/updatedAt — the gap Mission 81's own hasMissionMatching()
//      cooldown (businessIntelligenceEngine.cjs) does NOT cover, since that
//      one treats any terminal mission as a non-match with no time bound at
//      all. Not an infinite/permanent block — a bounded window per signal.
//
// Per-signal-type cooldown windows, chosen to match how often a real
// condition can meaningfully change:
//   - performance signals: 15 min (a memory/latency condition can
//     genuinely change quickly; must not spam faster than that)
//   - verification/QA/docs gaps: 1 hour (these re-scan a slowly-changing
//     backlog; re-announcing more than hourly adds no new information)
//   - unblock-stale: 30 min (a management action should have time to take
//     effect before being re-flagged)
//   - unscoped fallback (the other ~46 lower-frequency producer sites):
//     30 min default
const _SIGNAL_COOLDOWN_MS = {
    unblock_stale_missions:    30 * 60_000,
    perf_memory_pressure:      15 * 60_000,
    perf_slow_metrics:         15 * 60_000,
    perf_exec_latency:         15 * 60_000,
    verify_completed_missions: 60 * 60_000,
    qa_verification_gap:       60 * 60_000,
    docs_lesson_gap:           60 * 60_000,
    docs_runbook_gap:          60 * 60_000,
};
const _DEFAULT_COOLDOWN_MS = 30 * 60_000;

function _cooldownMsFor(signalType) {
    return _SIGNAL_COOLDOWN_MS[signalType] ?? _DEFAULT_COOLDOWN_MS;
}

const _TERMINAL = new Set(["completed", "failed", "cancelled"]);
// Epoch far enough in the past to mean "since the beginning of time" for
// hasMissionMatching()'s required `since` bound, without a magic sentinel.
const _EPOCH_SINCE = new Date(0).toISOString();

/**
 * checkCooldown({ objective, autoCreatedBy, orgId })
 * Returns { allowed: boolean, signalType, signalKey, reason }.
 *
 * Uses missionMemory.hasMissionMatching() — NOT a bounded listMissions()
 * scan — for both checks below. This matters on a real dataset (the real
 * VPS has 12,000+ missions): a naive `listMissions({ limit: N }).some(...)`
 * approach silently misses a match older than the newest N missions,
 * exactly the class of bug hasMissionMatching()'s own header warns against
 * (and exactly the class of bug Mission 81's businessIntelligenceEngine.cjs
 * fix replaced for the same reason). hasMissionMatching() short-circuits on
 * first match and never truncates, so correctness does not degrade as the
 * store grows. It also reads through missionMemory.cjs's own mtime-keyed
 * cache (Mission 82/82B/82C), so a fresh write is always visible on the
 * very next call — no separate cache is added in this module for exactly
 * that reason (a coarser cache here was tried and reproducibly proven to
 * let two producer calls within its window both see a pre-write snapshot
 * and both pass, defeating the guard for near-simultaneous ticks).
 */
function checkCooldown({ objective, autoCreatedBy, orgId = null } = {}) {
    const signalType = classifySignal(objective, autoCreatedBy);
    const key = _signalKey(signalType, orgId);
    const mm = _mm();

    if (!mm || typeof mm.hasMissionMatching !== "function") {
        return { allowed: true, signalType, signalKey: key, reason: "missionMemory_unavailable_fail_open" };
    }

    const matchesSignal = (m) =>
        m?.metadata?.autonomous === true &&
        m?.metadata?.signalType === signalType;

    try {
        // 1. Single-flight: any NON-TERMINAL mission for this signal+org.
        const hasActive = mm.hasMissionMatching({
            since: _EPOCH_SINCE,
            orgId: orgId || undefined,
            predicate: (m) => matchesSignal(m) && !_TERMINAL.has(m?.status),
        });
        if (hasActive) {
            return { allowed: false, signalType, signalKey: key, reason: `non-terminal mission already active for signal "${signalType}"` };
        }

        // 2. Cooldown: a TERMINAL mission for this signal+org whose
        // completedAt/updatedAt falls within the cooldown window.
        //
        // Deliberately uses _EPOCH_SINCE (not `since = now - cooldownMs`)
        // for hasMissionMatching()'s own required `since` bound:
        // hasMissionMatching() filters on `createdAt >= since` BEFORE ever
        // calling the predicate (see its own implementation) — but a
        // mission's relevant timestamp for cooldown purposes is when it
        // WENT TERMINAL (completedAt/updatedAt), which can be long after
        // its createdAt for a long-running mission. Passing a windowed
        // `since` here would wrongly exclude an old-but-recently-completed
        // mission from ever being considered. The window comparison
        // instead happens entirely inside this predicate, against the
        // correct timestamp.
        const cooldownMs = _cooldownMsFor(signalType);
        const cutoff = Date.now() - cooldownMs;
        const hasRecentTerminal = mm.hasMissionMatching({
            since: _EPOCH_SINCE,
            orgId: orgId || undefined,
            predicate: (m) => {
                if (!matchesSignal(m) || !_TERMINAL.has(m?.status)) return false;
                const terminalAt = new Date(m?.completedAt || m?.updatedAt || m?.createdAt || 0).getTime();
                return Number.isFinite(terminalAt) && terminalAt >= cutoff;
            },
        });
        if (hasRecentTerminal) {
            return { allowed: false, signalType, signalKey: key, reason: `cooldown active for signal "${signalType}"` };
        }
    } catch {
        return { allowed: true, signalType, signalKey: key, reason: "guard_scan_error_fail_open" };
    }

    return { allowed: true, signalType, signalKey: key, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────
// C. AUTONOMOUS ADMISSION CONTROL
// ─────────────────────────────────────────────────────────────────────────
//
// A bounded ceiling on how many autonomous missions may be in flight at
// once, independent of signal identity — the backstop for any signal this
// module doesn't yet know about, or any combination of signals that
// together still amount to unbounded fan-out. Manual/user missions never
// pass through this function at all (see module header) so they are
// structurally unaffected, satisfying "Manual/user/operator-approved
// missions MUST continue to work" without needing a bypass flag.
//
// taskQueue.cjs tasks carry no autonomous/autoCreatedBy metadata today
// (confirmed: addTask()'s task shape has no `metadata` field at all) — per
// the mission brief's own "pending/running autonomous tasks where
// available" wording, task-level backlog is not inspected here, since
// adding a new task-metadata concept purely for this check would be a
// second, incompatible architecture (explicitly against this mission's own
// constraint F/G). Mission-level backlog (already fully tagged via
// metadata.autonomous/autoCreatedBy) is the actual admission signal.
const MAX_ACTIVE_AUTONOMOUS_MISSIONS = 25;

/**
 * checkAdmission({ orgId })
 * Returns { allowed: boolean, activeCount, limit, reason }.
 * Counts non-terminal (planned/active/paused) missions tagged
 * metadata.autonomous === true, scoped to orgId when provided (unscoped
 * producers — all of them today — count against the shared unscoped
 * bucket, matching checkCooldown()'s own scoping).
 *
 * Unlike checkCooldown() (existence-only, so hasMissionMatching() applies
 * directly), this needs an actual COUNT — hasMissionMatching() is a
 * short-circuiting boolean and cannot provide one. listMissions() sorts
 * newest-first and truncates to `limit` (no hard cap on the value of
 * `limit` itself), so an explicitly large limit is passed here rather than
 * this module's own default elsewhere, to avoid undercounting non-terminal
 * autonomous missions on a large real dataset (12,000+ missions on the
 * real VPS) — the exact "naive N-item scan silently misses older matches"
 * class of bug called out throughout this codebase's dedup history.
 */
function checkAdmission({ orgId = null } = {}) {
    const mm = _mm();
    let missions;
    try {
        const all = mm?.listMissions({ limit: 50_000 }) || { missions: [] };
        missions = all.missions || [];
    } catch {
        return { allowed: true, activeCount: 0, limit: MAX_ACTIVE_AUTONOMOUS_MISSIONS, reason: "scan_unavailable_fail_open" };
    }

    let activeCount = 0;
    for (const m of missions) {
        if (!m || typeof m !== "object") continue;
        if (_TERMINAL.has(m.status)) continue;
        if (m.metadata?.autonomous !== true) continue;
        if (orgId) {
            const mOrgId = (typeof m.orgId === "string" && m.orgId) || (typeof m.metadata?.orgId === "string" && m.metadata.orgId) || null;
            if (mOrgId !== orgId) continue;
        }
        activeCount++;
    }

    if (activeCount >= MAX_ACTIVE_AUTONOMOUS_MISSIONS) {
        return {
            allowed: false, activeCount, limit: MAX_ACTIVE_AUTONOMOUS_MISSIONS,
            reason: `autonomous mission backlog at ${activeCount}/${MAX_ACTIVE_AUTONOMOUS_MISSIONS} — deferring new autonomous mission creation`,
        };
    }
    return { allowed: true, activeCount, limit: MAX_ACTIVE_AUTONOMOUS_MISSIONS, reason: null };
}

/**
 * admitAutonomousMission({ objective, autoCreatedBy, orgId })
 * The single combined entry point both producer files call before
 * creating an autonomous mission — runs the admission cap first (cheapest,
 * least specific), then the signal-scoped cooldown check.
 * Returns { allowed, signalType, signalKey, reason, activeCount, limit }.
 * Never throws — a failure in either check fails OPEN (allowed: true),
 * matching this codebase's established "a guard that cannot determine an
 * answer must never itself become an outage" posture (identical fail-open
 * behavior to missionMemory.cjs's own hasMissionMatching()).
 */
function admitAutonomousMission({ objective, autoCreatedBy, orgId = null } = {}) {
    try {
        const admission = checkAdmission({ orgId });
        if (!admission.allowed) {
            return { allowed: false, signalType: null, signalKey: null, ...admission };
        }
        const cooldown = checkCooldown({ objective, autoCreatedBy, orgId });
        return { allowed: cooldown.allowed, signalType: cooldown.signalType, signalKey: cooldown.signalKey, reason: cooldown.reason, activeCount: admission.activeCount, limit: admission.limit };
    } catch {
        return { allowed: true, signalType: null, signalKey: null, reason: "guard_error_fail_open", activeCount: null, limit: MAX_ACTIVE_AUTONOMOUS_MISSIONS };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// D. ATOMIC ADMISSION + CREATION (Mission 88 — TOCTOU close)
// ─────────────────────────────────────────────────────────────────────────
//
// Mission 88 Phase 2 reproduced, with real forked-process concurrency and
// deterministic 3/3 repeatability, two races in admitAutonomousMission()
// as used by both producer call sites (agentRuntimeSupervisor.cjs's
// _createMission(), engineeringOrg.cjs's _mission()):
//
//   1. Same-signal race: two concurrent calls for the same signalType but
//      digit-varying objective text (e.g. "Unblock 389..." vs "Unblock
//      390...") can BOTH pass checkCooldown()'s single-flight read before
//      either one's missionMemory.createMission() call lands — because
//      missionMemory's own P0-2 dedup index keys on EXACT objective text
//      (no digit-collapsing), it does not collapse them as a backstop.
//   2. Cap race: with activeCount already one below the 25 cap, multiple
//      concurrent calls can all read the same pre-write count and all
//      pass checkAdmission(), pushing the real count past 25.
//
// Both races share one root cause: checkAdmission()/checkCooldown() are
// unlocked reads that run BEFORE the single Mission-85-locked
// missionMemory.createMission() call — the lock protects createMission()'s
// own body (including P0-2's dedup), but not the admission DECISION that
// determines whether createMission() is even called. Two concurrent
// callers can each independently decide "allowed" against the same
// pre-write snapshot.
//
// Fix: admitAndCreateAutonomousMission() holds missionMemory's own
// cross-process lock (exposed via missionMemory.withMissionsLock() —
// Mission 85's existing, already-proven, already-tested primitive; NOT a
// second independent locking system) across the ENTIRE
// checkAdmission -> checkCooldown -> create sequence. This is the correct
// atomic unit: the decision and the state it produces must never be
// observable-then-actable by a second caller before the first caller's
// resulting mission (or lack of one) is durably persisted.
//
// `createFn` is a caller-supplied, zero-argument callback that performs
// the actual mission creation (each producer passes its own
// missionOrchestrator.createManual({...}) call, unchanged in shape) — this
// keeps createFn's non-mission-memory side effects (missionOrchestrator's
// stage-planning, subtask/decision registration) entirely the caller's
// business, while this function owns only the admission invariant. Nesting
// createFn's own missionMemory writes (createMission/addSubtask/
// recordDecision, all called internally by createManual()) inside this
// already-held lock is safe: missionMemory.cjs's lock has same-process
// re-entrancy (a depth counter, see its own _acquireMissionsLock()) built
// in specifically for this composition — a second, nested
// _acquireMissionsLock() call within the same process returns immediately
// rather than deadlocking on a lock this process already holds.
//
// Manual/non-autonomous mission creation is completely unaffected: it
// never calls this function (or any guard function) at all, exactly as
// before this fix — see module header.
//
// Crash/failure safety: if createFn() throws, the lock's own `finally`
// (inside withMissionsLock()) still releases it — no phantom reservation,
// since this function holds no state of its own beyond the lock itself,
// which missionMemory.cjs already guarantees is released on any error.
// Fails OPEN exactly like admitAutonomousMission() and every other guard
// function: an error acquiring the lock or evaluating admission never
// blocks legitimate autonomous work.
function admitAndCreateAutonomousMission({ objective, autoCreatedBy, orgId = null, createFn } = {}) {
    const mm = _mm();
    if (!mm || typeof mm.withMissionsLock !== "function" || typeof createFn !== "function") {
        // Fail-open path mirrors admitAutonomousMission()'s own contract:
        // if the atomic primitive isn't available, fall back to the
        // pre-Mission-88 sequential behavior rather than blocking
        // legitimate autonomous work outright.
        const decision = admitAutonomousMission({ objective, autoCreatedBy, orgId });
        const mission = decision.allowed && typeof createFn === "function" ? createFn(decision) : null;
        return { ...decision, mission };
    }

    try {
        return mm.withMissionsLock(() => {
            const decision = admitAutonomousMission({ objective, autoCreatedBy, orgId });
            if (!decision.allowed) {
                return { ...decision, mission: null };
            }
            const mission = createFn(decision);
            return { ...decision, mission };
        });
    } catch {
        // Lock acquisition itself failed (e.g. timed out because another
        // process genuinely holds it) — fail open rather than silently
        // dropping a legitimate autonomous signal forever; the caller's
        // own next tick will simply re-evaluate from scratch.
        return { allowed: true, signalType: null, signalKey: null, reason: "guard_lock_error_fail_open", activeCount: null, limit: MAX_ACTIVE_AUTONOMOUS_MISSIONS, mission: null };
    }
}

module.exports = {
    classifySignal,
    checkCooldown,
    checkAdmission,
    admitAutonomousMission,
    admitAndCreateAutonomousMission,
    MAX_ACTIVE_AUTONOMOUS_MISSIONS,
    // exported for tests only — not part of the stable public contract
    _normalizeObjective,
    _cooldownMsFor,
};
