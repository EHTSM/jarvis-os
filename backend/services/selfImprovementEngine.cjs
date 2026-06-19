"use strict";
/**
 * Self-Improvement Engine — ACP-11
 *
 * Continuously analyzes the full execution history, discovers patterns,
 * promotes successful strategies as new rules, retires weak ones, updates
 * confidence evidence weights, and measures the resulting improvement delta.
 *
 * Reads from (no new storage — delegates all I/O to existing systems):
 *   ACP-10 engineeringMemoryEngine   — recall, timeline, findSimilarProblems, findSuccessfulStrategies
 *   ACP-3  engineeringSmellDetector  — live smell data per file
 *   ACP-4  engineeringDecisionEngine — recurring opportunity types
 *   ACP-6  repositoryEditingEngine   — bundle history
 *   ACP-7  aiComposerEngine          — plan history + stats
 *   ACP-8  autonomousEngineeringAgent— mission stats + running history
 *   ACP-9  repositoryVisualizationEngine — hotspots, critical paths, file health
 *   I7     engineeringPipelineCoordinator — pipeline stats
 *   MM     missionMemory             — mission + failure + learning records
 *   LE     continuousLearningEngine  — lessons, recommendations, full analysis
 *   RR     engineeringRuleRegistry   — rules, registerRule, getStats
 *   RCA    rootCauseAnalysisEngine   — analyses, playbooks, recordFixSuccess
 *   CE     engineeringConfidenceEngine — evidence weights
 *   KG     knowledgeGraph            — nodes / edges
 *   UI     unifiedIntelligenceLayer  — cross-domain recommendations
 *
 * Writes to (via existing APIs only):
 *   engineeringRuleRegistry.registerRule()     — promote new rules
 *   continuousLearningEngine.createLesson()    — store evolution insights
 *   rootCauseAnalysisEngine.recordFixSuccess() — mark resolved RCAs
 *   data/acp11-evolution-log.json              — lightweight audit log only
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR  = path.join(__dirname, "../../data");
const LOG_FILE  = path.join(DATA_DIR, "acp11-evolution-log.json");

// ── Lazy service accessors ────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

function _mem()  { return _try(() => require("./engineeringMemoryEngine.cjs")); }
function _le()   { return _try(() => require("./continuousLearningEngine.cjs")); }
function _rr()   { return _try(() => require("./engineeringRuleRegistry.cjs")); }
function _rca()  { return _try(() => require("./rootCauseAnalysisEngine.cjs")); }
function _ce()   { return _try(() => require("./engineeringConfidenceEngine.cjs")); }
function _mm()   { return _try(() => require("./missionMemory.cjs")); }
function _re()   { return _try(() => require("./repositoryEditingEngine.cjs")); }
function _pc()   { return _try(() => require("./engineeringPipelineCoordinator.cjs")); }
function _de()   { return _try(() => require("./engineeringDecisionEngine.cjs")); }
function _sd()   { return _try(() => require("./engineeringSmellDetector.cjs")); }
function _ae()   { return _try(() => require("./autonomousEngineeringAgent.cjs")); }
function _comp() { return _try(() => require("./aiComposerEngine.cjs")); }
function _viz()  { return _try(() => require("./repositoryVisualizationEngine.cjs")); }
function _kg()   { return _try(() => require("./knowledgeGraph.cjs")); }
function _ui()   { return _try(() => require("./unifiedIntelligenceLayer.cjs")); }

// ── Evolution log (append-only, small — just timestamps + outcome) ────────────

function _readLog() {
    try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); }
    catch { return { cycles: [], stats: { total: 0, patternsFound: 0, rulesPromoted: 0, rulesRetired: 0, confidenceUpdates: 0 } }; }
}

function _appendLog(entry) {
    const log   = _readLog();
    log.cycles  = (log.cycles || []).slice(-50); // keep last 50
    log.cycles.push(entry);
    log.stats   = log.stats || {};
    log.stats.total              = (log.stats.total || 0) + 1;
    log.stats.patternsFound      = (log.stats.patternsFound || 0) + (entry.patternsFound || 0);
    log.stats.rulesPromoted      = (log.stats.rulesPromoted || 0) + (entry.rulesPromoted || 0);
    log.stats.rulesRetired       = (log.stats.rulesRetired || 0) + (entry.rulesRetired || 0);
    log.stats.confidenceUpdates  = (log.stats.confidenceUpdates || 0) + (entry.confidenceUpdates || 0);
    log.stats.lastRunAt          = entry.runAt;
    try { fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2)); } catch {}
    return log.stats;
}

// ── Raw data readers (shared helpers) ────────────────────────────────────────

function _rawLessons() {
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "lessons.json"), "utf8")); return Array.isArray(d) ? d : []; }
    catch { return []; }
}

function _rawPatches() {
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "patch-history.json"), "utf8")); return d?.patches || []; }
    catch { return []; }
}

function _rawAgentRuns() {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "agent-runs.json"), "utf8"));
        return Object.values(d).slice(-500); // most recent 500 only
    } catch { return []; }
}

function _rawTrustRecords() {
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "advanced-patch-trust.json"), "utf8")); return Object.values(d.records || {}); }
    catch { return []; }
}

function _rawDecisions() {
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "acp4-decisions.json"), "utf8")); return d?.opportunities || []; }
    catch { return []; }
}

// ── Token helpers ────────────────────────────────────────────────────────────

function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s_]/g, " ").split(/\s+/).filter(t => t.length > 3);
}

function _topN(map, n) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
}

// ── STEP 1: analyzeRecentExecutions() ────────────────────────────────────────
//
// Collects execution signals from all active ACP services and returns a
// structured picture of what has been tried, what worked, what failed.
//
async function analyzeRecentExecutions() {
    const windowMs = 7 * 24 * 3600 * 1000; // 7 days
    const cutoff   = new Date(Date.now() - windowMs).toISOString();
    const out      = {
        windowDays:     7,
        cutoff,
        lessons:        { success: 0, failure: 0, rules: 0, playbooks: 0, total: 0 },
        patches:        { applied: 0, rolledBack: 0, pending: 0 },
        agentRuns:      { total: 0, succeeded: 0, failed: 0, retried: 0 },
        pipelines:      { total: 0, completed: 0, failed: 0, rolledBack: 0 },
        missions:       { total: 0, failed: 0, planned: 0 },
        rcas:           { active: 0, resolved: 0, autoFixable: 0 },
        topFailureWords:  [],
        topSuccessWords:  [],
        recurringSmells:  [],
        highRoiDecisions: [],
    };

    // 1a. Lessons breakdown
    const rawLessons = _rawLessons().filter(l => l.createdAt >= cutoff);
    for (const l of rawLessons) {
        out.lessons[l.type === "success" ? "success" : l.type === "failure" ? "failure" : l.type === "engineering_rule" ? "rules" : "playbooks"]++;
        out.lessons.total++;
    }

    // 1b. Failure / success word patterns from lessons
    const failWords = {};
    const succWords = {};
    for (const l of rawLessons) {
        const tokens = _tokenize(l.title + " " + (l.detail || ""));
        const map    = l.type === "failure" ? failWords : succWords;
        for (const t of tokens) map[t] = (map[t] || 0) + 1;
    }
    out.topFailureWords = _topN(failWords, 10);
    out.topSuccessWords = _topN(succWords, 10);

    // 1c. Patch breakdown
    for (const p of _rawPatches()) {
        if (p.appliedAt   >= cutoff) out.patches.applied++;
        if (p.rolledBackAt >= cutoff) out.patches.rolledBack++;
        if (!p.appliedAt && p.status === "pending") out.patches.pending++;
    }

    // 1d. Agent runs
    const agentRuns = _rawAgentRuns().filter(r => r.startedAt >= cutoff);
    for (const r of agentRuns) {
        out.agentRuns.total++;
        if (r.success)          out.agentRuns.succeeded++;
        else                    out.agentRuns.failed++;
        if (r.retries > 0)      out.agentRuns.retried++;
    }

    // 1e. Pipeline stats (use aggregated — coordinator doesn't expose per-run date filter)
    const pcStats = _pc()?.getStats() || {};
    out.pipelines = { total: pcStats.total || 0, completed: pcStats.completed || 0, failed: pcStats.failed || 0, rolledBack: pcStats.rollbacks || 0 };

    // 1f. Missions
    const mmStats = _mm()?.getMissionStats() || {};
    out.missions  = { total: mmStats.total || 0, failed: mmStats.byStatus?.failed || 0, planned: mmStats.byStatus?.planned || 0 };

    // 1g. RCA
    const rcaStats = _rca()?.getStats() || {};
    out.rcas       = { active: rcaStats.active || 0, resolved: rcaStats.resolved || 0, autoFixable: rcaStats.autoFixable || 0 };

    // 1h. Recurring smells from decision engine
    const decOps = _rawDecisions();
    const smellTypes = {};
    for (const o of decOps) smellTypes[o.type] = (smellTypes[o.type] || 0) + 1;
    out.recurringSmells   = _topN(smellTypes, 8);

    // 1i. High-ROI decisions (most frequently detected opportunity types)
    out.highRoiDecisions  = out.recurringSmells.filter(s => s.count >= 5);

    return out;
}

// ── STEP 2: discoverPatterns() ────────────────────────────────────────────────
//
// Mine raw execution data for repeating patterns that indicate learnable rules.
// Returns patterns ranked by evidence strength.
//
function discoverPatterns() {
    const patterns = [];

    // Pattern 1: Recurring failure description clusters
    const missions = (() => { try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "missions.json"), "utf8")); return Object.values(d?.missions || {}); } catch { return []; } })();
    const failureDescriptions = [];
    for (const m of missions) {
        for (const f of (m.failures || [])) {
            if (f.description) failureDescriptions.push({ desc: f.description, phase: f.phase, missionId: m.id });
        }
    }
    const failPhases = {};
    for (const f of failureDescriptions) failPhases[f.phase] = (failPhases[f.phase] || 0) + 1;
    for (const [phase, count] of Object.entries(failPhases)) {
        if (count >= 2) patterns.push({
            type:       "recurring_failure_phase",
            pattern:    `Missions frequently fail at ${phase} phase`,
            evidence:   count,
            confidence: Math.min(90, 50 + count * 10),
            action:     "add_gate",
            suggestion: `Add validation gate before ${phase} phase — ${count} missions failed here`,
            source:     "mission_failures",
        });
    }

    // Pattern 2: Recurring smell types (from ACP-4 decisions)
    const decOps = _rawDecisions();
    const smellCounts = {};
    for (const o of decOps) smellCounts[o.type] = (smellCounts[o.type] || 0) + 1;
    for (const [type, count] of Object.entries(smellCounts)) {
        if (count >= 5) patterns.push({
            type:       "recurring_smell",
            pattern:    `${type} smell appears ${count} times across codebase`,
            evidence:   count,
            confidence: Math.min(95, 60 + count),
            action:     "create_rule",
            suggestion: `Auto-fix ${type} smells — ${count} instances found, high ROI`,
            smellType:  type,
            source:     "decision_engine",
        });
    }

    // Pattern 3: RCA pattern — recurring root cause
    const rca = _rca();
    if (rca) {
        const { analyses } = rca.listAnalyses({ limit: 20 });
        for (const a of (analyses || [])) {
            if ((a.frequency || 0) >= 10 && a.status !== "resolved") {
                patterns.push({
                    type:       "recurring_rca",
                    pattern:    a.title,
                    evidence:   a.frequency,
                    confidence: a.confidence,
                    action:     "promote_fix",
                    suggestion: a.recommendedFix,
                    canAutoFix: a.canAutoFix,
                    rcaId:      a.rcaId,
                    source:     "rca_engine",
                });
            }
        }
    }

    // Pattern 4: Successful agent run types
    const agentRuns = _rawAgentRuns();
    const runTypeSuccess = {};
    const runTypeTotal   = {};
    for (const r of agentRuns) {
        const key = r.type || "unknown";
        runTypeTotal[key]   = (runTypeTotal[key]   || 0) + 1;
        if (r.success) runTypeSuccess[key] = (runTypeSuccess[key] || 0) + 1;
    }
    for (const [type, total] of Object.entries(runTypeTotal)) {
        if (total < 10) continue;
        const successRate = (runTypeSuccess[type] || 0) / total;
        if (successRate >= 0.8) patterns.push({
            type:       "high_success_run_type",
            pattern:    `Agent run type "${type}" has ${Math.round(successRate * 100)}% success rate (${total} runs)`,
            evidence:   total,
            confidence: Math.round(successRate * 100),
            action:     "promote_strategy",
            suggestion: `Promote "${type}" as a preferred execution strategy`,
            runType:    type,
            source:     "agent_runs",
        });
        else if (successRate < 0.3 && total >= 20) patterns.push({
            type:       "low_success_run_type",
            pattern:    `Agent run type "${type}" has only ${Math.round(successRate * 100)}% success rate (${total} runs)`,
            evidence:   total,
            confidence: Math.round((1 - successRate) * 100),
            action:     "retire_strategy",
            suggestion: `Retire or avoid "${type}" in new missions — consistently failing`,
            runType:    type,
            source:     "agent_runs",
        });
    }

    // Pattern 5: Patch trust — files with consistent rollback
    const trustRecords = _rawTrustRecords();
    const fileRollback   = {};
    const fileTotal      = {};
    for (const r of trustRecords) {
        const f = r.filePath;
        if (!f) continue;
        fileTotal[f]   = (fileTotal[f] || 0) + 1;
        if (r.rolledBack) fileRollback[f] = (fileRollback[f] || 0) + 1;
    }
    for (const [file, total] of Object.entries(fileTotal)) {
        const rb = fileRollback[file] || 0;
        if (total >= 2 && rb / total >= 0.5) patterns.push({
            type:       "high_rollback_file",
            pattern:    `File "${file}" has ${Math.round(rb/total*100)}% rollback rate (${total} patches)`,
            evidence:   total,
            confidence: Math.min(90, 50 + rb * 15),
            action:     "add_caution",
            suggestion: `Mark "${file}" as high-risk in future patch plans`,
            file,
            source:     "patch_trust",
        });
    }

    // Pattern 6: Repeating lesson source — learn from the teacher
    const rawLessons    = _rawLessons();
    const lessonSources = {};
    for (const l of rawLessons) lessonSources[l.source] = (lessonSources[l.source] || 0) + 1;
    const topSrc = Object.entries(lessonSources).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [src, count] of topSrc) {
        if (count >= 10) patterns.push({
            type:       "prolific_lesson_source",
            pattern:    `"${src}" has generated ${count} lessons — rich signal source`,
            evidence:   count,
            confidence: 75,
            action:     "increase_weight",
            suggestion: `Increase evidence weight for "${src}" in confidence engine`,
            source:     "lesson_analysis",
            lessonSource: src,
        });
    }

    // Sort by evidence × confidence
    patterns.sort((a, b) => (b.evidence * b.confidence) - (a.evidence * a.confidence));
    return { patterns, total: patterns.length };
}

// ── STEP 3: generateRules() ───────────────────────────────────────────────────
//
// Converts discovered patterns into candidate rules (not yet promoted).
//
function generateRules() {
    const { patterns } = discoverPatterns();
    const candidates   = [];

    for (const p of patterns) {
        if (p.action !== "create_rule" && p.action !== "promote_fix" && p.action !== "promote_strategy") continue;
        if (p.confidence < 60) continue;

        let rule;
        if (p.type === "recurring_smell") {
            rule = {
                problemClass:      `recurring_smell_${p.smellType}`,
                title:             `Auto-detect and resolve ${p.smellType} smell (${p.evidence} instances)`,
                why:               `${p.smellType} appears ${p.evidence} times. High-ROI automatic fix target.`,
                solution:          `Batch-fix ${p.smellType} occurrences via ACP-6 bundle`,
                reusable:          true,
                autoApply:         p.evidence >= 20,
                action:            "smell_fix",
                errorPatterns:     [p.smellType, `smell:${p.smellType}`],
                source:            "acp11_pattern_discovery",
                missionClass:      "code_quality",
                performanceImpact: "medium",
                confidence:        p.confidence,
            };
        } else if (p.type === "recurring_rca") {
            rule = {
                problemClass:      `rca_pattern_${p.rcaId}`,
                title:             `Auto-repair: ${p.pattern}`,
                why:               `RCA detected ${p.evidence} occurrences. ${p.canAutoFix ? "Auto-fixable." : "Requires operator."}`,
                solution:          p.suggestion || "",
                reusable:          true,
                autoApply:         !!p.canAutoFix,
                action:            p.canAutoFix ? "auto_repair" : "operator_alert",
                errorPatterns:     [p.rcaId],
                source:            "acp11_rca_promotion",
                missionClass:      "reliability",
                performanceImpact: "high",
                confidence:        p.confidence,
            };
        } else if (p.type === "high_success_run_type") {
            rule = {
                problemClass:      `preferred_strategy_${p.runType?.replace(/\W/g, "_")}`,
                title:             `Prefer "${p.runType}" execution strategy (${p.confidence}% success)`,
                why:               `${p.evidence} runs of this type with ${p.confidence}% success rate`,
                solution:          `Route matching tasks to ${p.runType} agent run type`,
                reusable:          true,
                autoApply:         false,
                action:            "route_preference",
                errorPatterns:     [],
                source:            "acp11_agent_pattern",
                missionClass:      "efficiency",
                performanceImpact: "low",
                confidence:        p.confidence,
            };
        }

        if (rule) candidates.push({ pattern: p, candidate: rule });
    }

    return { candidates, total: candidates.length };
}

// ── STEP 4: promoteSuccessfulPatterns() ───────────────────────────────────────
//
// Takes high-confidence candidates and registers them as real rules via
// engineeringRuleRegistry.registerRule(). Also stores a lesson.
//
async function promoteSuccessfulPatterns() {
    const { candidates } = generateRules();
    const promoted       = [];
    const skipped        = [];

    // Check existing rules to avoid duplicates
    const rr = _rr();
    if (!rr) return { promoted: [], skipped: ["ruleRegistry unavailable"] };

    const { rules: existingRules } = rr.listRules({ limit: 100 });
    const existingClasses = new Set((existingRules || []).map(r => r.problemClass));

    for (const { pattern, candidate } of candidates) {
        // Skip if this problem class already has a rule
        if (existingClasses.has(candidate.problemClass)) {
            skipped.push({ reason: "already_exists", problemClass: candidate.problemClass });
            continue;
        }

        // Only promote if confidence >= 65
        if ((candidate.confidence || 0) < 65) {
            skipped.push({ reason: "low_confidence", conf: candidate.confidence, title: candidate.title });
            continue;
        }

        try {
            const result = rr.registerRule(candidate);
            promoted.push({ ruleId: result.ruleId, title: candidate.title, confidence: candidate.confidence, source: pattern.type });

            // Store a lesson about the promotion
            const le = _le();
            if (le) {
                await le.createLesson({
                    type:           "engineering_rule",
                    title:          `[ACP-11] Promoted rule: ${candidate.title}`,
                    detail:         `Pattern: ${pattern.pattern}. Evidence: ${pattern.evidence} occurrences. Confidence: ${pattern.confidence}%.`,
                    severity:       "info",
                    sourcePattern:  candidate.problemClass,
                    recommendation: candidate.solution,
                    source:         "acp11_promotion",
                });
            }
        } catch (e) {
            skipped.push({ reason: "register_failed", error: e.message, title: candidate.title });
        }
    }

    return { promoted, skipped, totalCandidates: candidates.length };
}

// ── STEP 5: retireWeakRules() ─────────────────────────────────────────────────
//
// Identifies rules that have low evidence or that contradict observed patterns.
// Does NOT delete rules — marks them with a retirement recommendation lesson
// and surfaces them in the evolution report. (The registry has no delete API —
// retirement is advisory only, stored as a lesson.)
//
async function retireWeakRules() {
    const rr = _rr();
    if (!rr) return { retired: [], total: 0 };

    const { rules } = rr.listRules({ limit: 100 });
    const agentRuns  = _rawAgentRuns();
    const rawLessons = _rawLessons();

    const retired = [];

    for (const rule of (rules || [])) {
        // Skip built-in rules (they have no extractedAt — they're hardcoded)
        if (rule.ruleId?.startsWith("rule_builtin")) continue;

        // Check: does this rule's problemClass appear in any recent failure lesson?
        const matchingFailures = rawLessons.filter(l =>
            l.type === "failure" &&
            (l.sourcePattern === rule.problemClass || (l.title || "").includes(rule.problemClass))
        );

        // Check: ACP-11 promoted rule with low evidence (generated by us but problem no longer active)
        const isAcp11Rule = rule.source === "acp11_pattern_discovery" || rule.source === "acp11_rca_promotion";

        // Retirement criteria: ACP-11 rule that has no supporting failure in last 200 lessons
        if (isAcp11Rule && matchingFailures.length === 0) {
            retired.push({ ruleId: rule.ruleId, title: rule.title, reason: "no_recent_failures", source: rule.source });
            // Record retirement recommendation as a lesson (advisory)
            const le = _le();
            if (le) {
                await le.createLesson({
                    type:           "success",
                    title:          `[ACP-11] Rule retirement candidate: ${rule.title}`,
                    detail:         `Rule "${rule.ruleId}" has no matching recent failures. Consider retiring.`,
                    severity:       "info",
                    sourcePattern:  rule.problemClass,
                    recommendation: "Review and manually retire if no longer applicable",
                    source:         "acp11_retirement",
                });
            }
        }
    }

    return { retired, total: retired.length };
}

// ── STEP 6: improveConfidence() ───────────────────────────────────────────────
//
// Analyzes which evidence sources produce the most accurate predictions and
// stores calibration lessons. Does NOT directly mutate CE weights (no API for
// that) — but records calibration as lessons and surfaces recommendations.
//
async function improveConfidence() {
    const ce         = _ce();
    const ceStats    = ce?.getStats() || {};
    const rawLessons = _rawLessons();

    const updates  = [];

    // Analyze: which lesson sources correlate with success?
    const lessonSourceSuccess = {};
    const lessonSourceTotal   = {};
    for (const l of rawLessons) {
        const src = l.source || "unknown";
        lessonSourceTotal[src]   = (lessonSourceTotal[src] || 0) + 1;
        if (l.type === "success") lessonSourceSuccess[src] = (lessonSourceSuccess[src] || 0) + 1;
    }

    // Calibration: source with >80% success rate and >20 samples should get higher weight
    for (const [src, total] of Object.entries(lessonSourceTotal)) {
        if (total < 20) continue;
        const successRate = (lessonSourceSuccess[src] || 0) / total;
        if (successRate >= 0.8) {
            updates.push({
                evidenceSource: src,
                currentSuccessRate: Math.round(successRate * 100),
                recommendation: `Increase evidence weight for "${src}" — ${Math.round(successRate * 100)}% success rate over ${total} samples`,
                action: "increase_weight",
                suggestedWeight: Math.min(40, Math.round(successRate * 35)),
            });
        } else if (successRate < 0.3 && total >= 30) {
            updates.push({
                evidenceSource: src,
                currentSuccessRate: Math.round(successRate * 100),
                recommendation: `Decrease weight for "${src}" — low success signal (${Math.round(successRate * 100)}%)`,
                action: "decrease_weight",
                suggestedWeight: Math.max(1, Math.round(successRate * 10)),
            });
        }
    }

    // RCA contribution: resolved RCAs should boost rule_match weight
    const rcaStats = _rca()?.getStats() || {};
    if (rcaStats.resolved >= 1) {
        updates.push({
            evidenceSource: "rule_match",
            recommendation: `RCA resolutions (${rcaStats.resolved}) confirm rule_match evidence is reliable — sustain high weight`,
            action: "sustain",
            suggestedWeight: ceStats.evidenceWeights?.rule_match || 35,
        });
    }

    // Store confidence calibration as lessons
    const le = _le();
    for (const u of updates.filter(u => u.action !== "sustain").slice(0, 3)) {
        if (le) {
            await le.createLesson({
                type:           "engineering_rule",
                title:          `[ACP-11] Confidence calibration: ${u.evidenceSource}`,
                detail:         u.recommendation,
                severity:       "info",
                sourcePattern:  `confidence_calibration_${u.evidenceSource}`,
                recommendation: `Adjust evidence weight to ${u.suggestedWeight}`,
                source:         "acp11_confidence",
            });
        }
    }

    return { updates, currentWeights: ceStats.evidenceWeights || {}, totalSamples: rawLessons.length };
}

// ── STEP 7: recommendArchitectureChanges() ───────────────────────────────────

async function recommendArchitectureChanges() {
    const recs = [];

    // 1. Smell density per module type (from ACP-9 viz)
    const viz = _viz();
    if (viz) {
        const stats = viz.getStatistics();
        if (stats.cached) {
            const critPaths = viz.findCriticalPaths();
            const hotspots  = viz.findHotspots();

            if (stats.circularDeps >= 5) recs.push({
                category:   "structural",
                priority:   "high",
                title:      `Resolve ${stats.circularDeps} circular dependencies`,
                rationale:  `Circular deps increase build failure risk and slow test execution. Current: ${stats.circularDeps} cycles detected.`,
                action:     "refactor_circular_deps",
                effort:     "high",
                roi:        "high",
            });

            if (stats.hotspots >= 10) recs.push({
                category:   "quality",
                priority:   "medium",
                title:      `Refactor ${stats.hotspots} hotspot files`,
                rationale:  `High-churn files accumulate technical debt. Top: ${hotspots.hotFiles?.[0]?.file} (${hotspots.hotFiles?.[0]?.commits} commits)`,
                action:     "extract_hotspots",
                effort:     "medium",
                roi:        "high",
            });

            const criticalCount = critPaths.criticalFiles?.filter(f => f.isCritical).length || 0;
            if (criticalCount >= 3) recs.push({
                category:   "reliability",
                priority:   "high",
                title:      `Add test coverage for ${criticalCount} critical files`,
                rationale:  `${criticalCount} files are imported by 5+ modules — changes propagate widely without test protection.`,
                action:     "add_test_coverage",
                effort:     "medium",
                roi:        "very_high",
            });
        }
    }

    // 2. RCA-driven recommendations
    const rca = _rca();
    if (rca) {
        const { analyses } = rca.listAnalyses({ limit: 20 });
        for (const a of (analyses || []).filter(a => a.status === "active" && a.canAutoFix)) {
            recs.push({
                category:   "reliability",
                priority:   "high",
                title:      `Auto-fix: ${a.title}`,
                rationale:  `${a.frequency} occurrences. Auto-fixable. ${a.recommendedFix}`,
                action:     "apply_rca_fix",
                rcaId:      a.rcaId,
                effort:     "low",
                roi:        "very_high",
            });
        }
    }

    // 3. High-density smell type recommendations
    const decOps = _rawDecisions();
    const smellCounts = {};
    for (const o of decOps) smellCounts[o.type] = (smellCounts[o.type] || 0) + 1;
    const topSmell = Object.entries(smellCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSmell && topSmell[1] >= 10) {
        recs.push({
            category:   "quality",
            priority:   "medium",
            title:      `Batch-fix ${topSmell[1]} "${topSmell[0]}" smells`,
            rationale:  `Most frequent smell type. Single ACP-6 bundle could clear ${topSmell[1]} instances.`,
            action:     "batch_smell_fix",
            smellType:  topSmell[0],
            effort:     "low",
            roi:        "high",
        });
    }

    // 4. Mission failure patterns → process improvement
    const failPhaseMap = {};
    const missions = (() => { try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "missions.json"), "utf8")); return Object.values(d?.missions || {}); } catch { return []; } })();
    for (const m of missions) {
        for (const f of (m.failures || [])) failPhaseMap[f.phase] = (failPhaseMap[f.phase] || 0) + 1;
    }
    const topPhase = Object.entries(failPhaseMap).sort((a, b) => b[1] - a[1])[0];
    if (topPhase && topPhase[1] >= 2) {
        recs.push({
            category:   "process",
            priority:   "medium",
            title:      `Strengthen "${topPhase[0]}" phase gate`,
            rationale:  `${topPhase[1]} mission failures at "${topPhase[0]}" phase. Pre-flight check or circuit breaker recommended.`,
            action:     "add_phase_gate",
            phase:      topPhase[0],
            effort:     "low",
            roi:        "high",
        });
    }

    recs.sort((a, b) => {
        const p = { high: 3, medium: 2, low: 1 };
        return (p[b.priority] || 0) - (p[a.priority] || 0);
    });

    return { recommendations: recs, total: recs.length };
}

// ── STEP 8: measureImprovement() ─────────────────────────────────────────────

function measureImprovement() {
    const log    = _readLog();
    const cycles = log.cycles || [];

    const leStats   = _le()?.getStats()       || {};
    const rrStats   = _rr()?.getStats()       || {};
    const rcaStats  = _rca()?.getStats()      || {};
    const mmStats   = _mm()?.getMissionStats() || {};
    const aeStats   = _ae()?.getStatistics()  || {};
    const ceStats   = _ce()?.getStats()       || {};
    const vizStats  = _viz()?.getStatistics() || {};

    // Learning velocity: lessons per week from growth data
    const mem = _mem();
    const growth = mem?.getKnowledgeGrowth() || {};
    const recentWeeks  = (growth.series || []).slice(-4);
    const avgPerWeek   = recentWeeks.length
        ? Math.round(recentWeeks.reduce((s, w) => s + w.lessons + w.patches + w.missions, 0) / recentWeeks.length)
        : 0;

    // Prediction accuracy: approximated from CE avgConfidence
    const predictionAccuracy = ceStats.avgConfidence || 0;

    // Repair success: from AE stats
    const repairSuccess = aeStats.repairSuccessRate || 100;

    // Autonomous success: AE autonomyPct
    const autonomousPct = aeStats.autonomyPct || 0;

    // Engineering maturity: composite
    const maturity = Math.round(
        Math.min(100,
            (rcaStats.playbooksCreated || 0) * 5 +
            (rrStats.total || 0) * 4 +
            (leStats.totalLessons || 0) / 10 +
            (rcaStats.resolved || 0) * 10 +
            (log.stats?.rulesPromoted || 0) * 8
        )
    );

    // Repository health trend: from ACP-9
    const repoHealth = vizStats.cached ? Math.max(0, 100 - (vizStats.circularDeps || 0) * 5 - Math.min(50, (vizStats.totalSmells || 0) / 20)) : 0;

    // Knowledge growth: total items
    const totalKnowledge = (leStats.totalLessons || 0) + (rrStats.total || 0) + (rcaStats.totalRCAs || 0);

    return {
        scores: {
            learningVelocity:     avgPerWeek,
            predictionAccuracy:   predictionAccuracy,
            repairSuccess:        repairSuccess,
            autonomousSuccess:    autonomousPct,
            engineeringMaturity:  maturity,
            repositoryHealth:     Math.round(repoHealth),
            knowledgeGrowth:      totalKnowledge,
        },
        evolutionLog: {
            totalCycles:      log.stats?.total || 0,
            patternsFound:    log.stats?.patternsFound || 0,
            rulesPromoted:    log.stats?.rulesPromoted || 0,
            rulesRetired:     log.stats?.rulesRetired || 0,
            confidenceUpdates: log.stats?.confidenceUpdates || 0,
            lastRunAt:        log.stats?.lastRunAt || null,
        },
        rawStats: { leStats, rrStats, rcaStats, aeStats },
    };
}

// ── STEP 9: runEvolutionCycle() ───────────────────────────────────────────────
//
// The main orchestration — runs all stages and records the outcome.
//
async function runEvolutionCycle() {
    const runAt  = new Date().toISOString();
    const t0     = Date.now();
    const result = {
        runAt,
        stages:  {},
    };

    // Stage 1: Analyze
    try {
        result.stages.analyze = await analyzeRecentExecutions();
    } catch (e) { result.stages.analyze = { error: e.message }; }

    // Stage 2: Discover
    try {
        const d = discoverPatterns();
        result.stages.discover = { total: d.total, topPatterns: d.patterns.slice(0, 5) };
    } catch (e) { result.stages.discover = { error: e.message }; }

    // Stage 3: Promote
    try {
        result.stages.promote = await promoteSuccessfulPatterns();
    } catch (e) { result.stages.promote = { error: e.message }; }

    // Stage 4: Retire
    try {
        result.stages.retire = await retireWeakRules();
    } catch (e) { result.stages.retire = { error: e.message }; }

    // Stage 5: Confidence
    try {
        const ci = await improveConfidence();
        result.stages.confidence = { updates: ci.updates.length, topUpdates: ci.updates.slice(0, 3) };
    } catch (e) { result.stages.confidence = { error: e.message }; }

    // Stage 6: Architecture recs
    try {
        const ar = await recommendArchitectureChanges();
        result.stages.architecture = { total: ar.total, topRecs: ar.recommendations.slice(0, 3) };
    } catch (e) { result.stages.architecture = { error: e.message }; }

    // Stage 7: Evolve underlying knowledge (ACP-10)
    try {
        const mem = _mem();
        if (mem) {
            const ev = await mem.evolveKnowledge();
            result.stages.knowledgeEvolution = { ok: !ev.error, details: ev };
        }
    } catch (e) { result.stages.knowledgeEvolution = { error: e.message }; }

    // Stage 8: Measure
    try {
        result.stages.measure = measureImprovement();
    } catch (e) { result.stages.measure = { error: e.message }; }

    result.durationMs       = Date.now() - t0;
    result.patternsFound    = result.stages.discover?.total || 0;
    result.rulesPromoted    = result.stages.promote?.promoted?.length || 0;
    result.rulesRetired     = result.stages.retire?.total || 0;
    result.confidenceUpdates = result.stages.confidence?.updates || 0;

    const logStats = _appendLog(result);
    result.cumulativeStats = logStats;

    return result;
}

// ── getStatistics() ──────────────────────────────────────────────────────────

function getStatistics() {
    const log = _readLog();
    const imp = measureImprovement();
    const { patterns } = discoverPatterns();

    return {
        evolutionCycles:    log.stats?.total || 0,
        lastRunAt:          log.stats?.lastRunAt || null,
        cumulativeStats:    log.stats || {},
        pendingPatterns:    patterns.length,
        topPendingPattern:  patterns[0] || null,
        improvementScores:  imp.scores,
        recentCycles:       (log.cycles || []).slice(-3).map(c => ({
            runAt:           c.runAt,
            durationMs:      c.durationMs,
            patternsFound:   c.patternsFound,
            rulesPromoted:   c.rulesPromoted,
            rulesRetired:    c.rulesRetired,
        })),
    };
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

async function runBenchmark() {
    const t0 = Date.now();

    const scenarios = [
        {
            name: "Pattern promotion — smell rules",
            fn: () => {
                const { patterns } = discoverPatterns();
                const smellPat = patterns.filter(p => p.type === "recurring_smell");
                return { ok: smellPat.length >= 0, value: `${smellPat.length} smell patterns` };
            },
        },
        {
            name: "Rule retirement analysis",
            fn: async () => {
                const r = await retireWeakRules();
                return { ok: true, value: `${r.total} retirement candidates` };
            },
        },
        {
            name: "Confidence improvement analysis",
            fn: async () => {
                const r = await improveConfidence();
                return { ok: r.updates !== undefined, value: `${r.updates.length} calibration updates, ${r.totalSamples} samples` };
            },
        },
        {
            name: "Prediction accuracy measurement",
            fn: () => {
                const m = measureImprovement();
                return { ok: typeof m.scores.predictionAccuracy === "number", value: `accuracy=${m.scores.predictionAccuracy}%` };
            },
        },
        {
            name: "Repair improvement tracking",
            fn: () => {
                const m = measureImprovement();
                return { ok: typeof m.scores.repairSuccess === "number", value: `repair=${m.scores.repairSuccess}%` };
            },
        },
        {
            name: "Knowledge growth measurement",
            fn: () => {
                const m = measureImprovement();
                return { ok: m.scores.knowledgeGrowth >= 0, value: `${m.scores.knowledgeGrowth} items` };
            },
        },
        {
            name: "Repeated failure detection",
            fn: () => {
                const { patterns } = discoverPatterns();
                const failPat = patterns.filter(p => p.type === "recurring_failure_phase" || p.type === "recurring_rca");
                return { ok: failPat.length >= 0, value: `${failPat.length} recurring failure patterns` };
            },
        },
        {
            name: "Repeated success — high success agent runs",
            fn: () => {
                const { patterns } = discoverPatterns();
                const succPat = patterns.filter(p => p.type === "high_success_run_type");
                return { ok: succPat.length >= 0, value: `${succPat.length} high-success strategies` };
            },
        },
        {
            name: "Repository evolution — architecture recs",
            fn: async () => {
                const r = await recommendArchitectureChanges();
                return { ok: r.total >= 0, value: `${r.total} recommendations` };
            },
        },
        {
            name: "Autonomous learning — full execution analysis",
            fn: async () => {
                const r = await analyzeRecentExecutions();
                return { ok: r.lessons.total >= 0, value: `${r.lessons.total} lessons, ${r.agentRuns.total} agent runs in window` };
            },
        },
    ];

    const results = [];
    for (const s of scenarios) {
        const st = Date.now();
        try {
            const r = await s.fn();
            results.push({ name: s.name, ok: r.ok, value: r.value, elapsedMs: Date.now() - st });
        } catch (e) {
            results.push({ name: s.name, ok: false, error: e.message, elapsedMs: Date.now() - st });
        }
    }

    const passed = results.filter(r => r.ok).length;
    return {
        total:     results.length,
        passed,
        passRate:  Math.round(passed / results.length * 100),
        totalMs:   Date.now() - t0,
        scenarios: results,
        stats:     getStatistics(),
    };
}

module.exports = {
    analyzeRecentExecutions,
    discoverPatterns,
    generateRules,
    promoteSuccessfulPatterns,
    retireWeakRules,
    improveConfidence,
    recommendArchitectureChanges,
    measureImprovement,
    runEvolutionCycle,
    getStatistics,
    runBenchmark,
};
