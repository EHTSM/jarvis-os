"use strict";
/**
 * Phase 663 — Adaptive Recovery Coordination
 *
 * Chooses safer recovery paths, compares rollback options, prioritizes stabilization,
 * avoids repeated failed recoveries, coordinates replay-safe restoration.
 * Confidence-aware. Replay-safe. Bounded retries.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/adaptive-recovery.json");
const MAX_HISTORY = 150;
const TTL_MS      = 48 * 60 * 60 * 1000;
const MAX_RETRIES = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { attempts: [], outcomes: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.attempts = (db.attempts || []).filter(a => a.ts > cutoff).slice(0, MAX_HISTORY);
    db.outcomes = (db.outcomes || []).slice(-MAX_HISTORY);
}

// ── Recovery attempt tracking ─────────────────────────────────────────────────

function recordRecoveryAttempt(path_, { errorContext = "", sessionId = null, success = null } = {}) {
    const db = _load(); _prune(db);
    db.attempts.unshift({ path: path_, errorContext: errorContext.slice(0, 200), sessionId, success, ts: Date.now() });
    _save(db);
    return { ok: true };
}

function getPathFailureCount(path_, { windowMs = 60 * 60 * 1000 } = {}) {
    const db     = _load();
    const cutoff = Date.now() - windowMs;
    return db.attempts.filter(a => a.path === path_ && a.ts > cutoff && a.success === false).length;
}

// ── Recovery path selection ───────────────────────────────────────────────────

function chooseRecoveryPath(errorContext = "", { sessionId = null } = {}) {
    // Get base recommendation from decision intelligence
    const edi = _tryRequire("./engineeringDecisionIntelligence.cjs");
    let base = null;
    if (edi) { try { base = edi.prioritizeRecovery(errorContext); } catch {} }

    // Also try the evolution layer
    const ede = _tryRequire("./engineeringDecisionEvolution.cjs");
    let ranked = null;
    if (ede) { try { ranked = ede.rankRecoveryStrategies(errorContext); } catch {} }

    const candidates = [];
    if (base?.ok) candidates.push({ path: base.path, confidence: base.confidence, source: "decision-intel" });
    if (ranked?.ok) candidates.push({ path: ranked.primary.id, confidence: ranked.primary.adjustedScore, source: "decision-evo" });

    // Filter out repeatedly-failed paths
    const viable = candidates.filter(c => getPathFailureCount(c.path) < MAX_RETRIES);
    const suppressed = candidates.filter(c => getPathFailureCount(c.path) >= MAX_RETRIES);

    const chosen = viable.length > 0
        ? viable.sort((a, b) => b.confidence - a.confidence)[0]
        : { path: "general-debug", confidence: 40, source: "fallback" };

    return {
        ok:         true,
        chosen,
        candidates: viable,
        suppressed: suppressed.map(c => ({ ...c, failCount: getPathFailureCount(c.path), reason: "max retries reached" })),
        explainer:  `Chose '${chosen.path}' (${chosen.confidence}% confidence, source: ${chosen.source})` + (suppressed.length > 0 ? ` — ${suppressed.length} path(s) suppressed` : ""),
        approvalRequired: chosen.path !== "general-debug",
    };
}

// ── Rollback option comparison ────────────────────────────────────────────────

function compareRollbackOptions(options = []) {
    if (!options.length) return { ok: false, error: "No options provided" };

    const scored = options.map(opt => {
        let score = 50;
        if (opt.hasSnapshot)        score += 20;
        if (opt.validatedRecently)  score += 15;
        if (opt.affectedServices > 3) score -= 15;
        if (opt.stale)              score -= 20;
        if (opt.tested)             score += 10;
        return { ...opt, score: Math.max(0, Math.min(100, score)) };
    }).sort((a, b) => b.score - a.score);

    return {
        ok:          true,
        ranked:      scored,
        recommended: scored[0],
        explainer:   `Best rollback: '${scored[0]?.id || "unknown"}' (score ${scored[0]?.score})`,
        approvalRequired: true,
    };
}

// ── Stabilization step prioritization ────────────────────────────────────────

function prioritizeStabilization(context = {}) {
    const { pressureLevel = "nominal", hasFailures = false, trustLow = false, deploymentActive = false } = context;

    const steps = [{ order: 0, step: "validate-health", priority: 100, autonomous: true }];

    if (pressureLevel === "critical")  steps.push({ order: 1, step: "reduce-load",          priority: 95,  autonomous: true  });
    if (hasFailures)                   steps.push({ order: 2, step: "run-recovery-path",     priority: 90,  autonomous: false, requiresApproval: true });
    if (trustLow)                      steps.push({ order: 3, step: "pause-new-deployments", priority: 85,  autonomous: false, requiresApproval: true });
    if (deploymentActive)              steps.push({ order: 4, step: "check-deploy-safety",   priority: 80,  autonomous: true  });
    steps.push({ order: 99, step: "re-validate-stability", priority: 50, autonomous: true });
    steps.sort((a, b) => b.priority - a.priority);

    return { ok: true, steps, approvalRequired: steps.some(s => s.requiresApproval) };
}

// ── Replay-safe restoration ───────────────────────────────────────────────────

function coordinateReplayRestoration(replayId, { approved = false } = {}) {
    if (!approved) return { ok: false, requiresApproval: true, error: "Replay restoration requires operator approval" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let replayState = null;
    if (lhec) {
        try { replayState = lhec.restoreReplayContinuity(replayId); } catch {}
    }

    // Check dedup
    let isDup = false;
    if (lhec) {
        try { isDup = lhec.isDuplicateRecovery(`replay-restore:${replayId}`); } catch {}
    }

    if (isDup) return { ok: false, duplicate: true, error: "Duplicate replay restoration blocked (dedup window)" };

    return {
        ok:         true,
        replayId,
        replayState,
        stale:      replayState?.stale || false,
        warning:    replayState?.stale ? "Replay state is stale — verify before execution" : null,
    };
}

// ── Recovery summary ──────────────────────────────────────────────────────────

function recoverySummary({ windowMs = 4 * 60 * 60 * 1000 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const recent = db.attempts.filter(a => a.ts > cutoff);

    const byPath = {};
    recent.forEach(a => {
        if (!byPath[a.path]) byPath[a.path] = { attempts: 0, failures: 0 };
        byPath[a.path].attempts++;
        if (a.success === false) byPath[a.path].failures++;
    });

    const problematic = Object.entries(byPath).filter(([, v]) => v.failures >= 2).map(([path_, v]) => ({ path: path_, ...v }));

    return {
        ok:          problematic.length === 0,
        total:       recent.length,
        byPath,
        problematic,
        warning:     problematic.length > 0 ? `Repeated failures on: ${problematic.map(p => p.path).join(", ")}` : null,
    };
}

module.exports = { recordRecoveryAttempt, chooseRecoveryPath, compareRollbackOptions, prioritizeStabilization, coordinateReplayRestoration, recoverySummary };
