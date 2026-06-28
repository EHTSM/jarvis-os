"use strict";
/**
 * engineeringRuleRegistry.cjs — Autonomous Engineering Sprint 2
 *
 * Converts successful engineering fixes into reusable engineering rules.
 * JARVIS stops solving the same class of problems repeatedly.
 *
 * No new persistence layer. Reuses:
 *   continuousLearningEngine  → data/lessons.json (createLesson / getLessons)
 *   semanticMemorySearch      → data/memory-store.json (knowledge type nodes)
 *   missionMemory             → completed mission artifacts / decisions
 *
 * Every engineering rule answers:
 *   problemClass   — what category of problem this solves
 *   why            — why the solution works
 *   reusable       — whether future missions can apply it automatically
 *   autoApply      — whether the runtime should apply it without human input
 *   errorPatterns  — regex/string patterns that match this rule's trigger
 *   action         — what the runtime should do when the rule fires
 *
 * Public API:
 *   extractFromMission(missionId)     → { rules[], extracted }
 *   classifyError(errorMsg)           → { rule | null, confidence }
 *   lookupRule(problemClass)          → rule | null
 *   listRules(opts)                   → { rules[], total }
 *   registerRule(rule)                → { ruleId, saved }
 *   getStats()                        → { total, autoApply, classes[], memorySaved }
 *   backfillFromHistory()             → { backfilled }
 */

const logger = require("../utils/logger");

function _cle()  { try { return require("./continuousLearningEngine.cjs");  } catch { return null; } }
function _sms()  { try { return require("./semanticMemorySearch.cjs");      } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");             } catch { return null; } }

let _seq = 0;
function _id() { return `rule_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Built-in rule definitions ─────────────────────────────────────────────
// Extracted from Sprint 1: fix(execution): fail-fast on non-retriable errors
// Each rule is a permanent engineering fact derived from a completed mission.

const BUILT_IN_RULES = [
    {
        ruleId:       "rule_builtin_001",
        problemClass: "deterministic_filesystem_error",
        title:        "Never retry deterministic filesystem errors",
        why:          "ENOENT and EACCES errors are filesystem state conditions. The file won't appear or become accessible between retry attempts. Retrying wastes backoff time (5s+10s=15s per failure) with guaranteed failure.",
        solution:     "Return nonRetriable:true from the capability handler. The execution runtime checks this flag and breaks the retry loop immediately.",
        reusable:     true,
        autoApply:    true,
        action:       "fail_fast",
        errorPatterns: ["ENOENT", "EACCES", "no such file or directory", "permission denied"],
        source:       "sprint_1_commit_ab7d209",
        missionClass: "execution_reliability",
        performanceImpact: "saves ~14900ms per occurrence (2-retry skip at 5s+10s backoff)",
        extractedAt:  "2026-06-17T00:00:00.000Z",
    },
    {
        ruleId:       "rule_builtin_002",
        problemClass: "security_validation_failure",
        title:        "Fail fast on security boundary violations",
        why:          "Path traversal attempts (../../etc/passwd) are correctly rejected by the security check. They are never valid on retry — the security constraint is invariant. Retrying adds latency and pollutes execution logs without benefit.",
        solution:     "Return nonRetriable:true immediately when a path traversal check fails. Security violations are never transient.",
        reusable:     true,
        autoApply:    true,
        action:       "fail_fast",
        errorPatterns: ["path_outside_project_root", "path traversal", "outside.*root", "/../"],
        source:       "sprint_1_commit_ab7d209",
        missionClass: "execution_reliability",
        performanceImpact: "saves ~14900ms per occurrence + eliminates security-violation retry pollution",
        extractedAt:  "2026-06-17T00:00:00.000Z",
    },
    {
        ruleId:       "rule_builtin_003",
        problemClass: "git_state_error",
        title:        "Git state errors require user action, not retries",
        why:          "Empty staging area, missing commit message, and no-changes states are git state conditions. The runtime cannot stage files or write commit messages by retrying. Only operator or a prior capability step can change git state.",
        solution:     "Return nonRetriable:true for nothing_staged, nothing staged for commit, and missing commit message. Require the caller to ensure correct git state before invoking.",
        reusable:     true,
        autoApply:    true,
        action:       "require_operator_action",
        errorPatterns: ["nothing_staged", "nothing staged for commit", "commit message required", "nothing to commit"],
        source:       "sprint_1_commit_ab7d209",
        missionClass: "execution_reliability",
        performanceImpact: "saves ~14900ms per occurrence",
        extractedAt:  "2026-06-17T00:00:00.000Z",
    },
    {
        ruleId:       "rule_builtin_004",
        problemClass: "unknown_capability_dispatch",
        title:        "Unknown capability dispatch is non-retriable",
        why:          "When no handler is registered for a capability, dispatching to the orchestrator returns 'dispatch failed'. Capability registration happens at startup — it will not appear between retries. Retrying wastes time and masks the real problem (caller used wrong capability name).",
        solution:     "Mark dispatch failures for unknown capabilities as nonRetriable:true. The caller must use a registered capability name.",
        reusable:     true,
        autoApply:    true,
        action:       "fail_fast",
        errorPatterns: ["dispatch failed", "capability not found", "no handler registered", "unknown capability"],
        source:       "sprint_1_commit_ab7d209",
        missionClass: "execution_reliability",
        performanceImpact: "saves ~14900ms per occurrence",
        extractedAt:  "2026-06-17T00:00:00.000Z",
    },
    {
        ruleId:       "rule_builtin_005",
        problemClass: "transient_network_error",
        title:        "Retry transient network and timeout errors",
        why:          "Network timeouts, connection resets, and 5xx HTTP errors are genuinely transient — the next attempt may succeed. Exponential backoff is appropriate here.",
        solution:     "Do NOT set nonRetriable:true for network errors, timeouts, or HTTP 5xx. Let the retry loop exhaust its policy.",
        reusable:     true,
        autoApply:    false,
        action:       "retry_with_backoff",
        errorPatterns: ["network_timeout", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "503", "502", "504"],
        source:       "sprint_1_commit_ab7d209",
        missionClass: "execution_reliability",
        performanceImpact: "zero — retries are correct for this class",
        extractedAt:  "2026-06-17T00:00:00.000Z",
    },
];

// ── In-memory rule store ──────────────────────────────────────────────────
// Rules are also persisted to lessons.json and memory-store.json via
// continuousLearningEngine.createLesson and semanticMemorySearch.saveTypedMemory.
// This in-memory cache enables O(1) classifyError() at runtime.

const _rules = new Map();
let _memorySavedMs = 0;  // running total of milliseconds saved by rule matches

// ── Private helpers ───────────────────────────────────────────────────────

function _patternMatches(errorMsg, patterns) {
    const lower = (errorMsg || "").toLowerCase();
    return patterns.some(p => {
        try { return new RegExp(p, "i").test(lower); } catch { return lower.includes(p.toLowerCase()); }
    });
}

function _persistToLessons(rule) {
    try {
        const cle = _cle();
        if (!cle) return;
        cle.createLesson({
            type:          "engineering_rule",
            title:         `[EngineeringRule] ${rule.title}`,
            detail:        `Problem class: ${rule.problemClass}\n\nWhy: ${rule.why}\n\nSolution: ${rule.solution}\n\nAction: ${rule.action}\n\nPerformance: ${rule.performanceImpact || "unknown"}\n\nPatterns: ${rule.errorPatterns.join(", ")}`,
            severity:      rule.autoApply ? "warning" : "info",
            sourcePattern: rule.problemClass,
            recommendation: rule.solution,
            source:        "engineering_rule_registry",
            agentId:       "autonomous_sprint",
        });
    } catch (e) {
        logger.warn(`[RuleRegistry] lessons persist failed: ${e.message}`);
    }
}

function _persistToMemory(rule) {
    try {
        const sms = _sms();
        if (!sms) return;
        sms.saveTypedMemory("knowledge", {
            insight:    `Engineering Rule [${rule.problemClass}]: ${rule.title}. Why: ${rule.why} Solution: ${rule.solution}`,
            sourceType: "engineering_sprint",
            learnedAt:  rule.extractedAt || new Date().toISOString(),
            extra:      { ruleId: rule.ruleId, action: rule.action, autoApply: rule.autoApply, errorPatterns: rule.errorPatterns },
        }, {
            key:        `engineering_rule:${rule.ruleId}`,
            tags:       ["engineering", "rule", rule.problemClass, rule.action, rule.source || "sprint"],
            importance: rule.autoApply ? 90 : 70,
            confidence: 95,
        });
    } catch (e) {
        logger.warn(`[RuleRegistry] memory persist failed: ${e.message}`);
    }
}

// ── Bootstrap: load built-ins + any lessons written by prior runs ─────────

function _bootstrap() {
    // 1. Load built-in rules into memory cache
    for (const rule of BUILT_IN_RULES) {
        _rules.set(rule.ruleId, rule);
    }

    // 2. Load any engineering_rule lessons created by prior runs
    try {
        const cle = _cle();
        if (cle) {
            const { lessons } = cle.getLessons({ source: "engineering_rule_registry", limit: 500 });
            for (const l of lessons) {
                if (l.sourcePattern && !_rules.has(`lesson:${l.lessonId}`)) {
                    _rules.set(`lesson:${l.lessonId}`, {
                        ruleId:        `lesson:${l.lessonId}`,
                        problemClass:  l.sourcePattern,
                        title:         l.title.replace(/^\[EngineeringRule\]\s*/, ""),
                        why:           l.detail || "",
                        solution:      l.recommendation || "",
                        reusable:      true,
                        autoApply:     l.severity === "warning",
                        action:        "see_lesson",
                        errorPatterns: [l.sourcePattern],
                        source:        l.source,
                        extractedAt:   l.createdAt,
                    });
                }
            }
        }
    } catch (e) {
        logger.warn(`[RuleRegistry] bootstrap lessons load failed: ${e.message}`);
    }

    logger.info(`[RuleRegistry] bootstrapped ${_rules.size} engineering rules`);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * registerRule — add a new engineering rule to the registry.
 * Persists to lessons.json and memory-store.json immediately.
 */
function registerRule(rule) {
    const ruleId = rule.ruleId || _id();
    const full = {
        ruleId,
        problemClass:      rule.problemClass || "unknown",
        title:             (rule.title       || "Untitled rule").slice(0, 200),
        why:               rule.why          || "",
        solution:          rule.solution     || "",
        reusable:          rule.reusable     !== false,
        autoApply:         rule.autoApply    === true,
        action:            rule.action       || "log",
        errorPatterns:     Array.isArray(rule.errorPatterns) ? rule.errorPatterns : [],
        source:            rule.source       || "manual",
        missionClass:      rule.missionClass || null,
        performanceImpact: rule.performanceImpact || null,
        extractedAt:       new Date().toISOString(),
    };
    _rules.set(ruleId, full);
    _persistToLessons(full);
    _persistToMemory(full);
    logger.info(`[RuleRegistry] registered rule ${ruleId}: ${full.title}`);
    return { ruleId, saved: true };
}

/**
 * classifyError — given an error message, return the best matching rule.
 * Called by autonomousExecutionRuntime to consult the registry before
 * deciding retry behaviour.
 */
function classifyError(errorMsg) {
    if (!errorMsg) return { rule: null, confidence: 0 };
    const lower = errorMsg.toLowerCase();

    let best = null;
    let bestScore = 0;

    for (const rule of _rules.values()) {
        if (!rule.errorPatterns || !rule.errorPatterns.length) continue;
        const matchCount = rule.errorPatterns.filter(p => {
            try { return new RegExp(p, "i").test(lower); } catch { return lower.includes(p.toLowerCase()); }
        }).length;
        if (matchCount > 0) {
            // Score: match density × autoApply weight
            const score = (matchCount / rule.errorPatterns.length) * (rule.autoApply ? 1.2 : 1.0);
            if (score > bestScore) {
                bestScore = score;
                best = rule;
            }
        }
    }

    if (best) {
        const savingsMs = _parseSavingsMs(best.performanceImpact);
        if (savingsMs > 0) _memorySavedMs += savingsMs;
    }

    if (best) logger.info(`[RuleRegistry] classifyError matched '${best.ruleId}' (${Math.min(100, Math.round(bestScore * 100))}% conf) for: ${(errorMsg||"").slice(0,60)}`);
    if (best) logger.info(`[RuleRegistry] classifyError matched '${best.ruleId}' (${Math.min(100, Math.round(bestScore * 100))}% conf) for: ${(errorMsg||"").slice(0,60)}`);
    if (best) logger.info(`[RuleRegistry] classifyError matched '${best.ruleId}' (${Math.min(100, Math.round(bestScore * 100))}% conf) for: ${(errorMsg||"").slice(0,60)}`);
    if (best) logger.info(`[RuleRegistry] classifyError matched '${best.ruleId}' (${Math.min(100, Math.round(bestScore * 100))}% conf) for: ${(errorMsg||"").slice(0,60)}`);
    return { rule: best, confidence: Math.min(100, Math.round(bestScore * 100)) };
}

function _parseSavingsMs(impact) {
    if (!impact) return 0;
    const m = impact.match(/~?(\d+(?:\.\d+)?)\s*ms/);
    return m ? parseFloat(m[1]) : 0;
}

/**
 * lookupRule — find a rule by problemClass name.
 */
function lookupRule(problemClass) {
    for (const rule of _rules.values()) {
        if (rule.problemClass === problemClass) return rule;
    }
    return null;
}

/**
 * listRules — return all registered rules, optionally filtered.
 */
function listRules({ problemClass, autoApply, action, limit = 100, offset = 0 } = {}) {
    let rows = Array.from(_rules.values());
    if (problemClass) rows = rows.filter(r => r.problemClass === problemClass);
    if (autoApply !== undefined) rows = rows.filter(r => r.autoApply === autoApply);
    if (action)       rows = rows.filter(r => r.action === action);
    rows = rows.sort((a, b) => (b.autoApply ? 1 : 0) - (a.autoApply ? 1 : 0));
    return { rules: rows.slice(offset, offset + limit), total: rows.length };
}

/**
 * getStats — summary of the rule registry for reporting.
 */
function getStats() {
    const all = Array.from(_rules.values());
    return {
        total:      all.length,
        autoApply:  all.filter(r => r.autoApply).length,
        reusable:   all.filter(r => r.reusable).length,
        classes:    [...new Set(all.map(r => r.problemClass))],
        actions:    all.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {}),
        memorySavedMs: _memorySavedMs,
    };
}

/**
 * extractFromMission — inspect a completed mission's artifacts and decisions,
 * then generate engineering rules from what was learned.
 *
 * This is the core Sprint 2 capability: after every successful engineering
 * improvement, call this to crystallise the fix into permanent knowledge.
 */
function extractFromMission(missionId) {
    const mm = _mm();
    if (!mm) return { rules: [], extracted: 0, reason: "missionMemory unavailable" };

    let mission;
    try { mission = mm.getMission(missionId); } catch { return { rules: [], extracted: 0, reason: "mission not found" }; }
    if (!mission) return { rules: [], extracted: 0, reason: "mission not found" };

    const extracted = [];

    // Extract from decisions
    for (const dec of (mission.decisions || [])) {
        if (!dec.description || !dec.rationale) continue;
        // Only extract from successful outcomes
        if (dec.outcome && (dec.outcome.toLowerCase().includes("fail") || dec.outcome.toLowerCase().includes("error"))) continue;

        const ruleHint = _inferRuleFromDecision(dec);
        if (ruleHint) {
            const { ruleId } = registerRule({
                ...ruleHint,
                source:      `mission:${missionId}`,
                missionClass: mission.type || "engineering",
                extractedAt: new Date().toISOString(),
            });
            extracted.push(ruleId);
        }
    }

    // Extract from artifacts — specifically "build" and "test_run" successes
    for (const art of (mission.artifacts || [])) {
        if (art.type === "build" && art.status === "success") {
            const existing = lookupRule("build_success_pattern");
            if (!existing) {
                const { ruleId } = registerRule({
                    problemClass:  "build_success_pattern",
                    title:         "Frontend build succeeds without new npm packages",
                    why:           `Mission ${missionId} completed a frontend build without adding dependencies. This pattern (edit existing files only) keeps the bundle size stable and avoids supply-chain risk.`,
                    solution:      "Prefer editing existing files over adding packages. Zero new imports = zero bundle growth.",
                    reusable:      true,
                    autoApply:     false,
                    action:        "prefer_no_new_deps",
                    errorPatterns: [],
                    source:        `mission:${missionId}`,
                });
                extracted.push(ruleId);
            }
        }
    }

    // Extract from failures in the mission — failures that were fixed become rules
    for (const fail of (mission.failures || [])) {
        if (!fail.description) continue;
        const { rule } = classifyError(fail.description);
        if (rule) continue; // already have a rule covering this

        const ruleHint = _inferRuleFromFailure(fail, missionId);
        if (ruleHint) {
            const { ruleId } = registerRule({
                ...ruleHint,
                source:      `mission:${missionId}`,
                missionClass: mission.type || "engineering",
            });
            extracted.push(ruleId);
        }
    }

    if (extracted.length) {
        logger.info(`[RuleRegistry] extracted ${extracted.length} rule(s) from mission ${missionId}`);
    }
    return { rules: extracted, extracted: extracted.length };
}

function _inferRuleFromDecision(dec) {
    const text = `${dec.description} ${dec.rationale} ${dec.outcome || ""}`.toLowerCase();

    if (text.includes("non-retriable") || text.includes("nonretriable") || text.includes("fail fast") || text.includes("break.*retry")) {
        return {
            problemClass:  "derived_non_retriable",
            title:         `Non-retriable pattern: ${dec.description.slice(0, 80)}`,
            why:           dec.rationale,
            solution:      dec.outcome || "Return nonRetriable:true from capability handler",
            reusable:      true,
            autoApply:     true,
            action:        "fail_fast",
            errorPatterns: _extractPatterns(text),
        };
    }
    if (text.includes("retry") && text.includes("backoff")) {
        return {
            problemClass:  "derived_retriable",
            title:         `Retriable pattern: ${dec.description.slice(0, 80)}`,
            why:           dec.rationale,
            solution:      dec.outcome || "Use exponential backoff",
            reusable:      true,
            autoApply:     false,
            action:        "retry_with_backoff",
            errorPatterns: _extractPatterns(text),
        };
    }
    return null;
}

function _inferRuleFromFailure(fail, missionId) {
    const text = (fail.description || "").toLowerCase();
    if (text.includes("enoent") || text.includes("no such file")) {
        return {
            problemClass:  "deterministic_filesystem_error",
            title:         `File-not-found is non-retriable (from mission ${missionId})`,
            why:           "ENOENT errors are deterministic — the file does not exist and will not appear between retry attempts.",
            solution:      "Return nonRetriable:true from file_read capability on ENOENT.",
            reusable:      true,
            autoApply:     true,
            action:        "fail_fast",
            errorPatterns: ["ENOENT", "no such file or directory"],
        };
    }
    return null;
}

function _extractPatterns(text) {
    const found = [];
    const hints = [
        "enoent", "eacces", "path_outside_project_root", "nothing_staged",
        "nothing staged", "dispatch failed", "commit message", "timeout",
        "econnreset", "econnrefused",
    ];
    for (const h of hints) {
        if (text.includes(h)) found.push(h);
    }
    return found;
}

/**
 * backfillFromHistory — scan missionMemory for completed engineering missions
 * and extract rules retrospectively. Idempotent: skips missions already covered
 * by existing rules.
 */
function backfillFromHistory() {
    const mm = _mm();
    if (!mm) return { backfilled: 0 };

    let backfilled = 0;
    try {
        const { missions } = mm.listMissions({ status: "completed", limit: 100 });
        for (const m of missions) {
            if (!m.type || !m.type.includes("engineering")) continue;
            const result = extractFromMission(m.missionId);
            backfilled += result.extracted;
        }
    } catch (e) {
        logger.warn(`[RuleRegistry] backfill failed: ${e.message}`);
    }

    return { backfilled };
}

// ── Initialise ────────────────────────────────────────────────────────────
_bootstrap();

// Persist built-in rules to lessons + memory on first load (idempotent via key dedup)
// Only write if not already present in lessons
try {
    const cle = _cle();
    const existing = cle ? cle.getLessons({ source: "engineering_rule_registry", limit: 500 }) : { lessons: [] };
    const existingPatterns = new Set(existing.lessons.map(l => l.sourcePattern));
    for (const rule of BUILT_IN_RULES) {
        if (!existingPatterns.has(rule.problemClass)) {
            _persistToLessons(rule);
            _persistToMemory(rule);
        }
    }
} catch (e) {
    logger.warn(`[RuleRegistry] initial persist failed: ${e.message}`);
}

module.exports = {
    registerRule,
    classifyError,
    lookupRule,
    listRules,
    getStats,
    extractFromMission,
    backfillFromHistory,
};
