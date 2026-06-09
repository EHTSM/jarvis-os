"use strict";
/**
 * Phase 646 — Smart Debug Intelligence
 *
 * Correlates runtime failures, identifies repeated patterns, prioritizes root causes,
 * recommends recovery sequences. Validation-first. Explainable. Confidence-aware.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/smart-debug-intel.json");
const MAX_EVENTS  = 300;
const TTL_MS      = 7 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { failures: [], patterns: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.failures = (db.failures || []).filter(f => f.ts > cutoff).slice(0, MAX_EVENTS);
    db.patterns = (db.patterns || []).slice(0, 50);
}
function _fp(text) { return crypto.createHash("md5").update(text).digest("hex").slice(0, 10); }

// ── Failure recording ─────────────────────────────────────────────────────────

function recordFailure(opts = {}) {
    const { errorText = "", context = "", sessionId = null, recovered = false } = opts;
    if (!errorText) return { ok: false, error: "errorText required" };
    const db = _load(); _prune(db);
    const fp = _fp(errorText.slice(0, 100));
    db.failures.unshift({ fp, errorText: errorText.slice(0, 300), context: context.slice(0, 200), sessionId, recovered, ts: Date.now() });
    _save(db);
    return { ok: true, fp };
}

// ── Pattern clustering ────────────────────────────────────────────────────────

const FAILURE_SIGNATURES = [
    { id: "econnrefused",  pattern: /econnrefused|connection refused|socket hang up/i,    label: "Connection refused",     recovery: "restart-server",    confidence: 82 },
    { id: "enoent",        pattern: /enoent|no such file|cannot find module/i,             label: "Missing file/module",    recovery: "dep-repair",        confidence: 85 },
    { id: "syntax",        pattern: /syntaxerror|unexpected token|parse error/i,           label: "Syntax error",           recovery: "code-fix",          confidence: 88 },
    { id: "auth",          pattern: /jwt|unauthorized|403|invalid token|expired/i,         label: "Auth failure",           recovery: "auth-reset",        confidence: 76 },
    { id: "oom",           pattern: /heap|out of memory|oom|javascript heap/i,             label: "Memory exhaustion",      recovery: "memory-recovery",   confidence: 70 },
    { id: "timeout",       pattern: /timeout|timed out|504|etimedout/i,                    label: "Request timeout",        recovery: "performance-check", confidence: 65 },
    { id: "disk",          pattern: /enospc|no space|disk full/i,                          label: "Disk full",              recovery: "disk-cleanup",       confidence: 78 },
    { id: "port",          pattern: /eaddrinuse|port.*in use/i,                            label: "Port conflict",          recovery: "port-conflict",     confidence: 85 },
    { id: "deploy-fail",   pattern: /deployment failed|deploy fail|rollback/i,             label: "Deployment failure",     recovery: "deploy-rollback",   confidence: 80 },
    { id: "test-fail",     pattern: /test.*fail|assertion.*error|expect.*received/i,       label: "Test failure",           recovery: "code-fix",          confidence: 72 },
];

function identifyPattern(errorText = "") {
    const matches = FAILURE_SIGNATURES.filter(s => s.pattern.test(errorText))
        .sort((a, b) => b.confidence - a.confidence);
    if (matches.length === 0) return { matched: false, id: "unknown", label: "Unknown failure", recovery: "general-debug", confidence: 40 };
    return { matched: true, ...matches[0], alternatives: matches.slice(1, 3).map(m => ({ id: m.id, label: m.label, confidence: m.confidence })) };
}

// ── Repeated failure detection ────────────────────────────────────────────────

function detectRepeatedFailures({ windowMs = 60 * 60 * 1000, minCount = 3 } = {}) {
    const db = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const recent = db.failures.filter(f => f.ts > cutoff);

    const counts = {};
    recent.forEach(f => { counts[f.fp] = (counts[f.fp] || { fp: f.fp, errorText: f.errorText, count: 0 }); counts[f.fp].count++; });

    const repeated = Object.values(counts)
        .filter(c => c.count >= minCount)
        .sort((a, b) => b.count - a.count)
        .map(c => ({ ...c, pattern: identifyPattern(c.errorText) }));

    return { ok: true, repeated, count: repeated.length, windowMs };
}

// ── Root cause prioritization ─────────────────────────────────────────────────

function prioritizeRootCauses(errorText = "", { sessionId = null } = {}) {
    const pattern = identifyPattern(errorText);

    // Check recent failure history for correlation
    const db = _load();
    const cutoff = Date.now() - 30 * 60 * 1000;
    const recent = db.failures.filter(f => f.ts > cutoff && f.sessionId === sessionId);
    const relatedFails = recent.filter(f => identifyPattern(f.errorText).id === pattern.id).length;

    const adjustedConf = Math.min(95, pattern.confidence + (relatedFails >= 2 ? 8 : 0));

    const causes = [
        {
            rank: 1,
            cause: pattern.label,
            patternId: pattern.id,
            confidence: adjustedConf,
            recovery: pattern.recovery,
            evidence: relatedFails > 0 ? `Seen ${relatedFails} time(s) in last 30min` : "Pattern match",
        },
    ];

    if (pattern.alternatives) {
        pattern.alternatives.forEach((a, i) => causes.push({
            rank: i + 2, cause: a.label, patternId: a.id, confidence: a.confidence, recovery: a.recovery || "general-debug", evidence: "Alternative pattern",
        }));
    }

    return { ok: true, causes, primaryRecovery: pattern.recovery, confidence: adjustedConf, explainer: `Matched '${pattern.label}' with ${adjustedConf}% confidence` };
}

// ── Recovery sequence recommendation ─────────────────────────────────────────

const RECOVERY_SEQUENCES = {
    "restart-server":    ["check-dashboard", "verify-env", "restart-service", "validate-health"],
    "dep-repair":        ["check-package-json", "run-npm-install", "verify-node-modules", "validate-imports"],
    "code-fix":          ["identify-syntax-location", "apply-fix", "run-linter", "validate-tests"],
    "auth-reset":        ["check-jwt-config", "verify-env-vars", "restart-auth-service", "test-auth-endpoint"],
    "memory-recovery":   ["check-heap-usage", "restart-with-limit", "profile-memory", "validate-stability"],
    "performance-check": ["profile-slow-endpoints", "check-db-pool", "add-timeouts", "validate-latency"],
    "disk-cleanup":      ["check-disk-usage", "clean-logs", "clean-tmp", "validate-space"],
    "port-conflict":     ["identify-conflict", "kill-process", "restart-server", "validate-port"],
    "deploy-rollback":   ["capture-state", "trigger-rollback", "verify-previous-version", "validate-health"],
    "general-debug":     ["check-dashboard", "scan-environment", "review-logs", "isolate-failure"],
};

function recommendRecoverySequence(recoveryPath = "") {
    const steps = RECOVERY_SEQUENCES[recoveryPath] || RECOVERY_SEQUENCES["general-debug"];
    return {
        ok:       true,
        path:     recoveryPath,
        steps:    steps.map((s, i) => ({ order: i, step: s, safe: !["restart-service", "kill-process", "trigger-rollback"].includes(s) })),
        validation: steps[steps.length - 1],
        approvalRequired: ["restart-service", "kill-process", "trigger-rollback", "apply-fix"].some(s => steps.includes(s)),
    };
}

// ── Validation-first debug plan ───────────────────────────────────────────────

function buildDebugPlan(errorText = "", { sessionId = null } = {}) {
    const causes   = prioritizeRootCauses(errorText, { sessionId });
    const sequence = recommendRecoverySequence(causes.primaryRecovery);

    return {
        ok:          true,
        errorText:   errorText.slice(0, 200),
        causes:      causes.causes.slice(0, 3),
        primaryPath: causes.primaryRecovery,
        confidence:  causes.confidence,
        plan: [
            { order: 0, step: "check-runtime-dashboard",  safe: true,  autonomous: true,  label: "Verify runtime health first" },
            { order: 1, step: "check-env-health",          safe: true,  autonomous: true,  label: "Scan environment" },
            { order: 2, step: "identify-failure-pattern",  safe: true,  autonomous: true,  label: `Pattern: ${causes.causes[0]?.cause || "unknown"}` },
            ...sequence.steps.slice(0, 4).map((s, i) => ({
                order: i + 3, step: s.step, safe: s.safe, autonomous: s.safe, label: s.step,
            })),
            { order: 7, step: "validate-recovery",         safe: true,  autonomous: true,  label: "Confirm resolution" },
        ],
        approvalRequired: sequence.approvalRequired,
        explainer: causes.explainer,
    };
}

// ── Failure correlation ───────────────────────────────────────────────────────

function correlateFailures({ windowMs = 30 * 60 * 1000 } = {}) {
    const db = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const recent = db.failures.filter(f => f.ts > cutoff);

    const byPattern = {};
    recent.forEach(f => {
        const pat = identifyPattern(f.errorText).id;
        byPattern[pat] = (byPattern[pat] || 0) + 1;
    });

    const correlations = Object.entries(byPattern)
        .map(([id, count]) => ({ id, count, label: FAILURE_SIGNATURES.find(s => s.id === id)?.label || id }))
        .sort((a, b) => b.count - a.count);

    const dominant = correlations[0] || null;
    return {
        ok:           true,
        windowMs,
        totalFailures: recent.length,
        correlations,
        dominant,
        insight:      dominant ? `Most frequent: ${dominant.label} (${dominant.count}x)` : "No dominant failure pattern",
    };
}

module.exports = { recordFailure, identifyPattern, detectRepeatedFailures, prioritizeRootCauses, recommendRecoverySequence, buildDebugPlan, correlateFailures };
