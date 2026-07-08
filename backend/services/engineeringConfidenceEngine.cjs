"use strict";
/**
 * engineeringConfidenceEngine.cjs — Autonomous Engineering Sprint 5
 *
 * Explainable Engineering Confidence Engine.
 *
 * Every engineering decision must explain its confidence score.
 * No random values. No hidden heuristics. Every number is derived from
 * real evidence drawn from existing data sources.
 *
 * Evidence buckets and maximum weights:
 *   Rule Match          35 pts  — how strongly a rule matches the error
 *   Historical Success  25 pts  — prior fix success rate for this class
 *   Mission Similarity  15 pts  — prior missions with same error class
 *   Execution History   10 pts  — per-capability execution success rate
 *   Repository Pattern   8 pts  — intelligence layer pattern strength
 *   Operator History     4 pts  — operator-confirmed decisions in memory
 *   Unknown              3 pts  — residual / unclassified factors
 *
 * Total: 100 pts → 0–100% confidence score.
 *
 * Every score is reproducible: given the same inputs and data state it
 * produces the same output. All intermediate values are returned for
 * auditing.
 *
 * Public API:
 *   explain(error, context)   → ExplainedConfidence
 *   explainRule(ruleId)       → RuleStrengthReport
 *   explainRCA(problemClass)  → RCAConfidenceReport
 *   explainStrategy(decision) → StrategyConfidenceReport
 *   getStats()                → { explanations, avgConfidence, topEvidenceSource }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── Lazy service refs ─────────────────────────────────────────────────────
function _rules() { try { return require("./engineeringRuleRegistry.cjs");    } catch { return null; } }
function _rca()   { try { return require("./rootCauseAnalysisEngine.cjs");    } catch { return null; } }
function _sms()   { try { return require("./semanticMemorySearch.cjs");       } catch { return null; } }
function _intel() { try { return require("./intelligenceLayer.cjs");          } catch { return null; } }
function _cle()   { try { return require("./continuousLearningEngine.cjs");   } catch { return null; } }

// ── Static data readers ───────────────────────────────────────────────────
const DATA = path.join(__dirname, "../../data");
function _rj(name, fb = []) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); }
    catch { return fb; }
}
// execution-runtime.ndjson records carry an "artifacts" array that can embed
// multi-MB repo-status snapshots per line; this module never reads that field,
// so drop it during parse to avoid retaining it (see rootCauseAnalysisEngine.cjs
// for the OOM this caused when left unstripped).
function _dropArtifactsReviver(key, value) {
    return key === "artifacts" ? undefined : value;
}

function _rjLines(name) {
    try {
        return fs.readFileSync(path.join(DATA, name), "utf8")
            .split("\n").filter(Boolean)
            .map(l => { try { return JSON.parse(l, _dropArtifactsReviver); } catch { return null; } })
            .filter(Boolean);
    } catch { return []; }
}

// ── Evidence weight constants ─────────────────────────────────────────────
const MAX_WEIGHTS = {
    rule_match:          35,
    historical_success:  25,
    mission_similarity:  15,
    execution_history:   10,
    repository_pattern:   8,
    operator_history:     4,
    unknown:              3,
};
const WEIGHT_TOTAL = Object.values(MAX_WEIGHTS).reduce((a, b) => a + b, 0); // 100

// ── In-memory session cache (avoid re-reading files per call) ─────────────
let _execCache    = null;  // execution-runtime.ndjson parsed
let _lessonCache  = null;  // lessons.json
let _missionCache = null;  // missions.json
let _healCache    = null;  // healing-history.json (Sprint 4 records)
let _cacheTs      = 0;
const CACHE_TTL   = 30_000; // 30s

function _getExecRecords() {
    if (_execCache && Date.now() - _cacheTs < CACHE_TTL) return _execCache;
    _execCache   = _rjLines("execution-runtime.ndjson");
    _lessonCache = _rj("lessons.json");
    _missionCache = (() => {
        const d = _rj("missions.json");
        return Array.isArray(d) ? d : d.missions || [];
    })();
    _healCache = _rj("healing-history.json");
    _cacheTs   = Date.now();
    return _execCache;
}

// ── Evidence: Rule Match (max 35) ─────────────────────────────────────────
//
// Derived from:
//   patternMatchDensity  — what fraction of the rule's patterns fired
//   autoApply flag       — rule is confirmed for automated application
//   reusable flag        — rule has been validated across multiple cases
//   source               — built-in rules outweigh lesson-derived rules
//   patternCount         — more patterns = better-characterised rule

function _evidenceRuleMatch(errorMsg, context = {}) {
    const reg = _rules();
    if (!reg) return { score: 0, detail: "rule registry unavailable" };

    const { rule, confidence: rawConf } = reg.classifyError(errorMsg);
    if (!rule) {
        return {
            score:  0,
            max:    MAX_WEIGHTS.rule_match,
            detail: "no matching rule found",
            matchedRule: null,
            factors: { patternMatchDensity: 0, autoApply: false, reusable: false, isBuiltIn: false },
        };
    }

    // Pattern match density: fraction of rule patterns that fired
    const lower = (errorMsg || "").toLowerCase();
    const fired = (rule.errorPatterns || []).filter(p => {
        try { return new RegExp(p, "i").test(lower); } catch { return lower.includes(p.toLowerCase()); }
    }).length;
    const total = (rule.errorPatterns || []).length || 1;
    const patternMatchDensity = fired / total;

    // Source quality multiplier
    const isBuiltIn  = rule.ruleId?.startsWith("rule_builtin");
    const sourceBonus = isBuiltIn ? 1.0 : 0.8;  // lesson-derived rules slightly less certain

    // Confidence from registry (TF-IDF based)
    const regConfFactor = Math.min(rawConf / 100, 1.0);

    // Compose: density × source × auto × regConf
    const autoFactor  = rule.autoApply ? 1.0 : 0.85;
    const reuseFactor = rule.reusable  ? 1.0 : 0.9;

    const score = Math.round(
        MAX_WEIGHTS.rule_match *
        patternMatchDensity *
        sourceBonus *
        autoFactor *
        reuseFactor *
        Math.max(regConfFactor, 0.5)  // floor at 0.5 so a matched rule gives some signal
    );

    return {
        score:  Math.min(score, MAX_WEIGHTS.rule_match),
        max:    MAX_WEIGHTS.rule_match,
        detail: `Rule '${rule.ruleId}' matched ${fired}/${total} patterns (density=${Math.round(patternMatchDensity*100)}%)`,
        matchedRule: rule.ruleId,
        problemClass: rule.problemClass,
        factors: {
            patternMatchDensity: Math.round(patternMatchDensity * 100),
            autoApply:           rule.autoApply,
            reusable:            rule.reusable,
            isBuiltIn,
            registryConfidence:  rawConf,
        },
    };
}

// ── Evidence: Historical Success (max 25) ─────────────────────────────────
//
// Derived from:
//   priorFixCount        — count of engineering_rule + engineering_playbook lessons
//                          that address the same problem class
//   playbook status      — resolved playbooks add more weight than open ones
//   healing success rate — fraction of prior healing records that succeeded
//                          for this error class
//   sprint fix record    — if RCA status === resolved, a confirmed fix exists

function _evidenceHistoricalSuccess(errorMsg, problemClass, context = {}) {
    _getExecRecords(); // prime cache
    const lessons = _lessonCache || [];

    // Lessons that address this problem class
    const relatedLessons = lessons.filter(l => {
        const text = `${l.title || ""} ${l.detail || ""} ${l.sourcePattern || ""}`.toLowerCase();
        const cls  = (problemClass || "").toLowerCase();
        return cls && text.includes(cls.split("_")[0]);  // partial match on first word
    });
    const resolvedPlaybooks = relatedLessons.filter(l =>
        l.type === "engineering_playbook" && l.source === "root_cause_analysis"
    ).length;
    const openPlaybooks     = relatedLessons.filter(l =>
        l.type === "engineering_playbook"
    ).length - resolvedPlaybooks;
    const engRules          = relatedLessons.filter(l => l.type === "engineering_rule").length;

    // RCA resolution bonus
    let rcaResolved = false;
    try {
        const rca = _rca();
        if (rca && problemClass) {
            const analysis = rca.getAnalysis(problemClass);
            // Explicit null-check before status access — getAnalysis returns null for unknown classes
            if (analysis && typeof analysis.status === "string") {
                rcaResolved = analysis.status.startsWith("resolved");
            }
        }
    } catch { /* non-fatal */ }

    // Healing success rate for this error class
    const healing = _healCache || [];
    const relevantHeal = healing.filter(h => {
        const text = `${h.strategy || ""} ${h.reason || ""} ${h.rcaClass || ""}`.toLowerCase();
        return problemClass && text.includes((problemClass || "").split("_")[0]);
    });
    const healSuccessRate = relevantHeal.length
        ? Math.round(relevantHeal.filter(h => h.success).length / relevantHeal.length * 100)
        : 0;

    // Score composition
    const baseFromLessons   = Math.min((engRules * 8 + openPlaybooks * 5 + resolvedPlaybooks * 10), 15);
    const rcaBonus          = rcaResolved ? 8 : 0;
    const healBonus         = Math.round(healSuccessRate / 100 * 4);

    const score = Math.min(baseFromLessons + rcaBonus + healBonus, MAX_WEIGHTS.historical_success);

    return {
        score,
        max:    MAX_WEIGHTS.historical_success,
        detail: `${engRules} rule lesson(s), ${openPlaybooks} open + ${resolvedPlaybooks} resolved playbook(s)` +
                (rcaResolved ? ", RCA confirmed resolved" : "") +
                (healSuccessRate ? `, heal success rate ${healSuccessRate}%` : ""),
        factors: {
            engineeringRuleLessons: engRules,
            openPlaybooks,
            resolvedPlaybooks,
            rcaConfirmedResolved:   rcaResolved,
            healingSuccessRate:     healSuccessRate,
        },
    };
}

// ── Evidence: Mission Similarity (max 15) ─────────────────────────────────
//
// Derived from:
//   missionCount         — how many past missions were affected by this class
//   resolvedCount        — missions that completed after facing this class
//   affectedCapabilities — overlap between this error's capability and past missions

function _evidenceMissionSimilarity(errorMsg, problemClass, capability, context = {}) {
    _getExecRecords();
    const missions = _missionCache || [];

    // Missions that explicitly reference this problem class in their failures
    const classWord = (problemClass || "").split("_")[0].toLowerCase();
    const affected = missions.filter(m => {
        const failures = m.failures || [];
        return failures.some(f =>
            (f.description || "").toLowerCase().includes(classWord) ||
            (capability && (f.description || "").toLowerCase().includes(capability.toLowerCase()))
        );
    });

    // Also check via RCA linked missions
    let rcaAffectedMissions = 0;
    try {
        const rca = _rca();
        if (rca && problemClass) {
            const analysis = rca.getAnalysis(problemClass);
            rcaAffectedMissions = analysis?.affectedMissions?.length || 0;
        }
    } catch { /* non-fatal */ }

    const totalAffected  = affected.length + rcaAffectedMissions;
    const resolvedAffected = affected.filter(m => m.status === "completed").length;

    // Score: more affected missions = more evidence; resolved = high quality
    const baseScore = Math.min(totalAffected * 3, 9);  // up to 9 from frequency
    const resolutionBonus = Math.min(resolvedAffected * 2, 6); // up to 6 from resolution

    const score = Math.min(baseScore + resolutionBonus, MAX_WEIGHTS.mission_similarity);

    return {
        score,
        max:    MAX_WEIGHTS.mission_similarity,
        detail: `${totalAffected} mission(s) affected by similar class (${resolvedAffected} resolved)`,
        factors: {
            totalAffectedMissions:    totalAffected,
            resolvedMissions:         resolvedAffected,
            rcaLinkedMissions:        rcaAffectedMissions,
        },
    };
}

// ── Evidence: Execution History (max 10) ─────────────────────────────────
//
// Derived from:
//   capabilitySuccessRate — fraction of past executions for this capability
//                           that succeeded, from execution-runtime.ndjson
//   sampleSize            — larger sample = higher weight

function _evidenceExecutionHistory(capability, context = {}) {
    const records = _getExecRecords();

    if (!capability || !records.length) {
        return {
            score:  Math.round(MAX_WEIGHTS.execution_history * 0.5), // neutral
            max:    MAX_WEIGHTS.execution_history,
            detail: "no capability context or no execution records",
            factors: { capabilitySuccessRate: null, sampleSize: 0 },
        };
    }

    const capRecords = records.filter(r => r.capability === capability);
    if (!capRecords.length) {
        return {
            score:  Math.round(MAX_WEIGHTS.execution_history * 0.4),
            max:    MAX_WEIGHTS.execution_history,
            detail: `no execution records for capability '${capability}'`,
            factors: { capabilitySuccessRate: null, sampleSize: 0 },
        };
    }

    const ok            = capRecords.filter(r => r.status === "completed").length;
    const successRate   = ok / capRecords.length;
    const sampleSize    = capRecords.length;
    // Sample size weight: more samples = more reliable signal (cap at 20 for full weight)
    const sampleWeight  = Math.min(sampleSize / 20, 1.0);
    const score         = Math.round(MAX_WEIGHTS.execution_history * successRate * sampleWeight);

    return {
        score:  Math.min(score, MAX_WEIGHTS.execution_history),
        max:    MAX_WEIGHTS.execution_history,
        detail: `${capability}: ${ok}/${sampleSize} executions succeeded (${Math.round(successRate*100)}%)`,
        factors: {
            capabilitySuccessRate: Math.round(successRate * 100),
            ok,
            total: sampleSize,
            sampleSizeWeight: Math.round(sampleWeight * 100),
        },
    };
}

// ── Evidence: Repository Pattern (max 8) ─────────────────────────────────
//
// Derived from intelligenceLayer.getPatterns():
//   patternCount         — total known patterns about this codebase
//   matchingPatterns     — patterns whose label/rootCause mentions error class
//   successPatternRatio  — ratio of success to failure patterns

function _evidenceRepositoryPattern(problemClass, context = {}) {
    try {
        const intel = _intel();
        if (!intel) throw new Error("unavailable");

        const { patterns = [], summary = {} } = intel.getPatterns() || {};
        const total          = patterns.length || 0;
        const successCount   = summary.successPatterns || 0;
        const failureCount   = summary.failurePatterns || 0;

        // Find patterns that mention this problem class
        const classWord = (problemClass || "").split("_")[0].toLowerCase();
        const matching  = patterns.filter(p =>
            (p.label || "").toLowerCase().includes(classWord) ||
            (p.rootCause || "").toLowerCase().includes(classWord)
        );

        // Success pattern ratio: if more successes than failures, repo is healthy
        const totalSF       = successCount + failureCount;
        const successRatio  = totalSF ? successCount / totalSF : 0.5;

        // Score: matched patterns give direct evidence; overall success ratio gives repo health bonus
        const matchScore    = Math.min(matching.length * 2, 4);
        const ratioBonus    = Math.round(successRatio * 4);
        const score         = Math.min(matchScore + ratioBonus, MAX_WEIGHTS.repository_pattern);

        return {
            score,
            max:    MAX_WEIGHTS.repository_pattern,
            detail: `${matching.length} pattern(s) match class; repo success/failure ratio ${successCount}:${failureCount}`,
            factors: {
                totalPatterns:         total,
                matchingPatterns:      matching.length,
                successPatterns:       successCount,
                failurePatterns:       failureCount,
                successRatio:          Math.round(successRatio * 100),
            },
        };
    } catch {
        return {
            score:  Math.round(MAX_WEIGHTS.repository_pattern * 0.5),
            max:    MAX_WEIGHTS.repository_pattern,
            detail: "intelligence layer unavailable — using neutral score",
            factors: { totalPatterns: 0, matchingPatterns: 0 },
        };
    }
}

// ── Evidence: Operator History (max 4) ───────────────────────────────────
//
// Derived from:
//   semantic memory knowledge nodes tagged with this problem class
//   healing records with operator_approval strategy that succeeded
//   engineering_rule lessons confirmed by operator (resolved RCA)

function _evidenceOperatorHistory(problemClass, context = {}) {
    _getExecRecords();
    let operatorNodes  = 0;
    let confirmedFixed = 0;

    // Search semantic memory for operator-confirmed decisions about this class
    try {
        const sms = _sms();
        if (sms) {
            const classWord = (problemClass || "").split("_").slice(0, 2).join("_");
            const { results } = sms.searchDecisions(classWord, { limit: 10 });
            operatorNodes = results.filter(r => r.score >= 0.2).length;
        }
    } catch { /* non-fatal */ }

    // Healing records where operator_approval strategy succeeded
    const healing = _healCache || [];
    confirmedFixed = healing.filter(h =>
        h.strategy === "operator_approval" && h.success &&
        h.rcaClass === problemClass
    ).length;

    // Engineering rules confirmed via RCA resolution
    let rcaConfirmed = 0;
    try {
        const rca = _rca();
        if (rca && problemClass) {
            const analysis = rca.getAnalysis(problemClass);
            if (analysis?.status?.startsWith("resolved")) rcaConfirmed = 1;
        }
    } catch { /* non-fatal */ }

    const score = Math.min(
        operatorNodes * 1 + confirmedFixed * 2 + rcaConfirmed * 2,
        MAX_WEIGHTS.operator_history
    );

    return {
        score,
        max:    MAX_WEIGHTS.operator_history,
        detail: `${operatorNodes} semantic decision node(s), ${confirmedFixed} confirmed fix(es), ${rcaConfirmed} RCA resolution(s)`,
        factors: {
            semanticDecisionNodes: operatorNodes,
            operatorConfirmedFixes: confirmedFixed,
            rcaConfirmed,
        },
    };
}

// ── Evidence: Unknown (max 3) ─────────────────────────────────────────────
//
// Residual: 3 points allocated to factors that can't be measured.
// Reduced if other evidence is strong (high other scores = less unknown).
// Always non-zero to signal that real-world systems are never fully certain.

function _evidenceUnknown(otherTotal) {
    // The stronger the other evidence, the less uncertainty remains
    const otherMax   = WEIGHT_TOTAL - MAX_WEIGHTS.unknown;
    const otherRatio = Math.min(otherTotal / otherMax, 1.0);
    // When evidence is strong (ratio → 1), unknown shrinks towards 1
    // When evidence is weak (ratio → 0), unknown stays at max 3
    const score = Math.max(1, Math.round(MAX_WEIGHTS.unknown * (1 - otherRatio * 0.67)));

    return {
        score,
        max:    MAX_WEIGHTS.unknown,
        detail: "residual uncertainty — real-world factors not captured by available data",
        factors: { otherEvidenceStrength: Math.round(otherRatio * 100) },
    };
}

// ── Telemetry ─────────────────────────────────────────────────────────────
let _explainCount = 0;
let _totalConfidence = 0;
const _sourceHits = {};  // evidence source → total contribution

// ── Public API ────────────────────────────────────────────────────────────

/**
 * explain — produce a full explainable confidence breakdown for any
 * engineering decision (classifyError, strategy selection, RCA lookup).
 *
 * @param {string} error     — error message or description
 * @param {object} context   — { capability, problemClass, strategy, retries, maxRetries }
 * @returns {ExplainedConfidence}
 */
function explain(error, context = {}) {
    const { capability, problemClass: ctxClass } = context;

    // 1. Rule match (provides problemClass if not given)
    const eRule       = _evidenceRuleMatch(error, context);
    const problemClass = ctxClass || eRule.problemClass || null;

    // 2. Historical success
    const eHistory    = _evidenceHistoricalSuccess(error, problemClass, context);

    // 3. Mission similarity
    const eMission    = _evidenceMissionSimilarity(error, problemClass, capability, context);

    // 4. Execution history
    const eExecution  = _evidenceExecutionHistory(capability, context);

    // 5. Repository pattern
    const eRepo       = _evidenceRepositoryPattern(problemClass, context);

    // 6. Operator history
    const eOperator   = _evidenceOperatorHistory(problemClass, context);

    // 7. Unknown (residual)
    const otherTotal  = eRule.score + eHistory.score + eMission.score + eExecution.score + eRepo.score + eOperator.score;
    const eUnknown    = _evidenceUnknown(otherTotal);

    const totalScore  = otherTotal + eUnknown.score;
    // Floor at 1 — a matched rule with sparse evidence is still evidence.
    const confidence  = Math.max(1, Math.min(totalScore, 100));

    // Evidence map (for display)
    const evidence = {
        rule_match:          eRule,
        historical_success:  eHistory,
        mission_similarity:  eMission,
        execution_history:   eExecution,
        repository_pattern:  eRepo,
        operator_history:    eOperator,
        unknown:             eUnknown,
    };

    // Telemetry
    _explainCount++;
    _totalConfidence += confidence;
    for (const [k, v] of Object.entries(evidence)) {
        _sourceHits[k] = (_sourceHits[k] || 0) + v.score;
    }

    // Breakdown table (as percentages of max for display)
    const breakdown = Object.entries(evidence).map(([key, ev]) => ({
        source: key.replace(/_/g, " "),
        score:  ev.score,
        max:    ev.max,
        pct:    ev.max > 0 ? Math.round(ev.score / ev.max * 100) : 0,
        detail: ev.detail,
    }));

    logger.info(`[ConfEngine] confidence=${confidence}% for error='${(error||"").slice(0,50)}' class=${problemClass || "?"}`);

    return {
        confidence,
        maxPossible:    100,
        error:          (error || "").slice(0, 120),
        problemClass,
        matchedRule:    eRule.matchedRule,
        breakdown,
        evidence,
        reproducible:   true,  // same inputs → same output
        computedAt:     new Date().toISOString(),
    };
}

/**
 * explainRule — explain the confidence strength of a specific engineering rule.
 */
function explainRule(ruleId) {
    const reg = _rules();
    if (!reg) return { error: "rule registry unavailable" };

    const { rules } = reg.listRules({ limit: 100 });
    const rule = rules.find(r => r.ruleId === ruleId);
    if (!rule) return { error: `rule ${ruleId} not found` };

    const isBuiltIn = rule.ruleId.startsWith("rule_builtin");
    const patternCount = (rule.errorPatterns || []).length;

    // Rule age factor: built-in rules are from Sprint 1 (oldest = most validated)
    const ageScore = isBuiltIn ? 100 : 70;

    // Pattern coverage: more patterns = better discrimination
    const coverageScore = Math.min(patternCount * 15, 60);

    // Validation: autoApply + reusable = confirmed by engineering judgement
    const validationScore = (rule.autoApply ? 25 : 0) + (rule.reusable ? 15 : 0);

    const strength = Math.min(Math.round((ageScore * 0.3 + coverageScore * 0.4 + validationScore * 0.3)), 100);

    return {
        ruleId:           rule.ruleId,
        problemClass:     rule.problemClass,
        strength,
        factors: {
            isBuiltIn,
            patternCount,
            autoApply:     rule.autoApply,
            reusable:      rule.reusable,
            ageScore,
            coverageScore,
            validationScore,
        },
        interpretation: strength >= 80 ? "high confidence — battle-tested rule"
            : strength >= 55 ? "medium confidence — validated but limited sample"
            : "low confidence — new or unvalidated rule",
    };
}

/**
 * explainRCA — explain the confidence score of an RCA problem class.
 */
function explainRCA(problemClass) {
    const rca = _rca();
    if (!rca) return { error: "RCA engine unavailable" };

    const analysis = rca.getAnalysis(problemClass);
    if (!analysis) return { error: `RCA not found: ${problemClass}` };

    // Evidence for the RCA's own confidence
    const frequencyEvidence  = Math.min(Math.round(Math.log10(analysis.frequency + 1) * 25), 40);
    const statusEvidence     = analysis.status?.startsWith("resolved") ? 30 : analysis.status === "monitoring" ? 15 : 20;
    const linkedRulesEvidence = Math.min((analysis.linkedRules?.length || 0) * 8, 20);
    const breakdownEvidence  = Object.keys(analysis.errorBreakdown || {}).length >= 2 ? 10 : 5;

    const derivedConfidence  = Math.min(frequencyEvidence + statusEvidence + linkedRulesEvidence + breakdownEvidence, 100);

    return {
        problemClass:     analysis.problemClass,
        reportedConfidence: analysis.confidence,
        derivedConfidence,
        factors: {
            frequency:       analysis.frequency,
            frequencyEvidence,
            status:          analysis.status,
            statusEvidence,
            linkedRules:     analysis.linkedRules?.length || 0,
            linkedRulesEvidence,
            errorBreakdownKeys: Object.keys(analysis.errorBreakdown || {}).length,
            breakdownEvidence,
        },
        consistent: Math.abs(derivedConfidence - analysis.confidence) <= 15,
        note: Math.abs(derivedConfidence - analysis.confidence) > 15
            ? `Reported ${analysis.confidence}% vs derived ${derivedConfidence}% — manual review recommended`
            : `Reported and derived confidence within 15% of each other — consistent`,
    };
}

/**
 * explainStrategy — explain the confidence of a strategy decision produced
 * by selfHealingRuntime.selectStrategy().
 *
 * @param {object} decision — result of selectStrategy()
 * @param {string} error    — original error message
 * @param {object} context  — execution context (capability, retries, etc.)
 */
function explainStrategy(decision, error, context = {}) {
    if (!decision) return { error: "no decision provided" };

    // Full evidence breakdown for the error
    const base = explain(error, { ...context, problemClass: decision.rcaClass });

    // Strategy confidence modifier: some strategies are inherently more certain
    const strategyCertainty = {
        fail_fast:           1.0,   // deterministic — always certain
        park_task:           1.0,
        dead_letter:         0.95,
        retry_with_backoff:  0.85,
        circuit_reset_rec:   0.90,
        operator_approval:   0.88,
        delay_until_ready:   0.80,
        reroute_capability:  0.72,
    }[decision.strategy] ?? 0.75;

    const strategyAdjusted = Math.round(base.confidence * strategyCertainty);

    return {
        ...base,
        strategy:             decision.strategy,
        strategyReason:       decision.strategyReason,
        alternativesRejected: decision.alternativesRejected,
        expectedRecoveryProb: decision.expectedRecoveryProb,
        strategyConfidence:   strategyAdjusted,
        strategyCertaintyFactor: Math.round(strategyCertainty * 100),
        ruleId:               decision.ruleId,
        rcaClass:             decision.rcaClass,
    };
}

/**
 * getStats — aggregate telemetry across all explain() calls this session.
 */
function getStats() {
    const avgConfidence = _explainCount > 0
        ? Math.round(_totalConfidence / _explainCount)
        : 0;

    // Top evidence source by total contribution
    const topSource = Object.entries(_sourceHits)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ source: k, totalContribution: v }))[0]?.source || null;

    return {
        explanations:     _explainCount,
        avgConfidence,
        topEvidenceSource: topSource,
        sourceHits:       { ..._sourceHits },
        evidenceWeights:  { ...MAX_WEIGHTS },
        reproducible:     true,
    };
}

module.exports = { explain, explainRule, explainRCA, explainStrategy, getStats };
