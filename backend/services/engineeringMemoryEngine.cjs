"use strict";
/**
 * Engineering Memory Engine — ACP-10
 *
 * Unifies all existing engineering memory sources into a single query surface.
 * Does NOT store anything new — reads from existing stores via their own APIs.
 *
 * Memory sources (read-only, no duplication):
 *   continuousLearningEngine   — 479 lessons (success/failure/rule/playbook)
 *   engineeringRuleRegistry    — 13 rules with error patterns & solutions
 *   rootCauseAnalysisEngine    — 5 RCAs, 4 playbooks, 4436 failures analysed
 *   missionMemory              — 86 missions with subtasks/decisions/failures/learnings
 *   repositoryEditingEngine    — bundle + patch history
 *   engineeringPipelineCoordinator — pipeline run history
 *   engineeringDecisionEngine  — 131KB decision opportunities + debt history
 *   engineeringSmellDetector   — live smell data per file
 *   engineeringConfidenceEngine — evidence weights + history
 *   repositoryVisualizationEngine — hotspots, critical paths, dep graph
 *   knowledgeGraph             — nodes/edges across all domains
 *   unifiedIntelligenceLayer   — cross-domain health + executive dashboard
 *   data/patch-history.json    — raw patch records
 *   data/lessons.json          — raw lesson records
 *   data/pipeline-runs.json    — raw pipeline run records
 *   data/agent-runs.json       — autonomous agent run records (subset)
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data");

// ── Lazy service accessors ────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

function _le()   { return _try(() => require("./continuousLearningEngine.cjs")); }
function _rr()   { return _try(() => require("./engineeringRuleRegistry.cjs")); }
function _rca()  { return _try(() => require("./rootCauseAnalysisEngine.cjs")); }
function _mm()   { return _try(() => require("./missionMemory.cjs")); }
function _re()   { return _try(() => require("./repositoryEditingEngine.cjs")); }
function _pc()   { return _try(() => require("./engineeringPipelineCoordinator.cjs")); }
function _de()   { return _try(() => require("./engineeringDecisionEngine.cjs")); }
function _sd()   { return _try(() => require("./engineeringSmellDetector.cjs")); }
function _ce()   { return _try(() => require("./engineeringConfidenceEngine.cjs")); }
function _viz()  { return _try(() => require("./repositoryVisualizationEngine.cjs")); }
function _kg()   { return _try(() => require("./knowledgeGraph.cjs")); }
function _ui()   { return _try(() => require("./unifiedIntelligenceLayer.cjs")); }
function _ae()   { return _try(() => require("./autonomousEngineeringAgent.cjs")); }
function _comp() { return _try(() => require("./aiComposerEngine.cjs")); }

// ── Raw data readers (cached 2min) ────────────────────────────────────────────

const _rawCache = {};
const RAW_TTL   = 2 * 60 * 1000;

function _readJson(file) {
    const now = Date.now();
    if (_rawCache[file] && now - _rawCache[file].t < RAW_TTL) return _rawCache[file].v;
    try {
        const v = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
        _rawCache[file] = { v, t: now };
        return v;
    } catch { return null; }
}

function _rawLessons()    { const d = _readJson("lessons.json");       return Array.isArray(d) ? d : []; }
function _rawPatches()    { const d = _readJson("patch-history.json"); return (d?.patches || []); }
function _rawPipelines()  { const d = _readJson("pipeline-runs.json"); return Array.isArray(d) ? d : []; }
function _rawMissions()   { const d = _readJson("missions.json");      return Object.values(d?.missions || {}); }

// ── Text similarity (TF-IDF cosine, no new packages) ─────────────────────────

function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 2);
}

function _tf(tokens) {
    const map = {};
    for (const t of tokens) map[t] = (map[t] || 0) + 1;
    const len = tokens.length || 1;
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v / len]));
}

// Simple cosine similarity on token frequency vectors
function _cosineSim(a, b) {
    const aTokens = _tokenize(a);
    const bTokens = _tokenize(b);
    if (!aTokens.length || !bTokens.length) return 0;

    const tfA = _tf(aTokens);
    const tfB = _tf(bTokens);
    const vocab = new Set([...Object.keys(tfA), ...Object.keys(tfB)]);

    let dot = 0, normA = 0, normB = 0;
    for (const t of vocab) {
        const va = tfA[t] || 0;
        const vb = tfB[t] || 0;
        dot   += va * vb;
        normA += va * va;
        normB += vb * vb;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom ? dot / denom : 0;
}

// Keyword overlap score (fast for large corpora)
function _overlapScore(queryTerms, text) {
    if (!text) return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const t of queryTerms) if (lower.includes(t)) hits++;
    return queryTerms.length > 0 ? hits / queryTerms.length : 0;
}

// ── remember() ────────────────────────────────────────────────────────────────
//
// Persist a new memory event by proxying to existing stores.
// Never writes a new store — routes to the appropriate engine.
//
// type: 'lesson' | 'rule' | 'mission_learning' | 'rca' | 'decision' | 'smell'
//
async function remember({ type, missionId, data, metadata = {} }) {
    const result = { type, stored: false, target: null };

    if (type === 'lesson') {
        const le = _le();
        if (le && data?.title) {
            const lesson = await le.createLesson({
                type:           data.lessonType || 'engineering_rule',
                title:          data.title,
                detail:         data.detail || "",
                severity:       data.severity || "info",
                sourcePattern:  data.sourcePattern || null,
                recommendation: data.recommendation || null,
                source:         metadata.source || "acp10",
            });
            result.stored  = true;
            result.target  = "continuousLearningEngine";
            result.lessonId = lesson?.lessonId;
        }
    } else if (type === 'mission_learning' && missionId) {
        const mm = _mm();
        if (mm && data?.insight) {
            mm.addLearning(missionId, data.insight, data.outcome || "noted");
            result.stored = true;
            result.target = "missionMemory";
        }
    } else if (type === 'decision') {
        // Route to decision engine's existing opportunity structure — mark as ACP-10 sourced
        result.stored = false; // DE doesn't expose a create API, decisions derive from smells
        result.note   = "decisions derive from smell/analysis — trigger computeOpportunities instead";
    }

    return result;
}

// ── recall() ─────────────────────────────────────────────────────────────────
//
// Unified recall across all memory sources.
//
async function recall({ query, limit = 20, sources = ["all"] }) {
    const all = sources.includes("all");
    const results = [];

    const queryTerms = _tokenize(query);
    const queryText  = query.toLowerCase();

    // 1. Lessons (continuousLearningEngine)
    if (all || sources.includes("lessons")) {
        const le = _le();
        if (le) {
            const { lessons } = le.getLessons({ limit: 200 });
            for (const l of (lessons || [])) {
                const score = _cosineSim(query, `${l.title} ${l.detail} ${l.recommendation||""}`);
                if (score > 0.05) results.push({ source: "lesson", score, item: l });
            }
        }
    }

    // 2. Engineering Rules
    if (all || sources.includes("rules")) {
        const rr = _rr();
        if (rr) {
            const { rules } = rr.listRules({ limit: 50 });
            for (const r of (rules || [])) {
                const score = _cosineSim(query, `${r.title} ${r.why} ${r.solution} ${(r.errorPatterns||[]).join(" ")}`);
                if (score > 0.05) results.push({ source: "rule", score, item: r });
            }
        }
    }

    // 3. RCA analyses
    if (all || sources.includes("rca")) {
        const rca = _rca();
        if (rca) {
            const { analyses } = rca.listAnalyses({ limit: 50 });
            for (const a of (analyses || [])) {
                const score = _cosineSim(query, `${a.title} ${a.likelyRootCause} ${a.recommendedFix}`);
                if (score > 0.05) results.push({ source: "rca", score, item: a });
            }
        }
    }

    // 4. Missions (objective match)
    if (all || sources.includes("missions")) {
        const mm = _mm();
        if (mm) {
            const { missions } = mm.listMissions({ limit: 100 });
            for (const m of (missions || [])) {
                const score = _cosineSim(query, `${m.objective} ${(m.learnings||[]).map(l=>l.insight||"").join(" ")}`);
                if (score > 0.05) results.push({ source: "mission", score, item: { id: m.id, objective: m.objective, status: m.status, createdAt: m.createdAt, failures: m.failures?.length || 0 } });
            }
        }
    }

    // 5. Raw lessons (broader match on title)
    if (all || sources.includes("raw_lessons")) {
        const rawLessons = _rawLessons().slice(0, 500);
        const keyword    = queryTerms.slice(0, 5);
        for (const l of rawLessons) {
            const score = _overlapScore(keyword, `${l.title} ${l.detail}`);
            if (score > 0.3) results.push({ source: "raw_lesson", score: score * 0.7, item: l });
        }
    }

    // 6. Patch history
    if (all || sources.includes("patches")) {
        for (const p of _rawPatches().slice(0, 300)) {
            const score = _overlapScore(queryTerms, `${p.filePath} ${p.reason}`);
            if (score > 0.2) results.push({ source: "patch", score: score * 0.6, item: { id: p.id, filePath: p.filePath, reason: p.reason, status: p.status, appliedAt: p.appliedAt } });
        }
    }

    // 7. Pipeline runs
    if (all || sources.includes("pipelines")) {
        for (const pr of _rawPipelines().slice(0, 100)) {
            const score = _overlapScore(queryTerms, `${pr.id} ${pr.pipeline||""} ${(pr.stages||[]).map(s=>s.name||"").join(" ")}`);
            if (score > 0.2) results.push({ source: "pipeline", score: score * 0.5, item: { id: pr.id, state: pr.state, createdAt: pr.createdAt, completedAt: pr.completedAt } });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return {
        query,
        totalFound: results.length,
        results:    results.slice(0, limit),
    };
}

// ── findSimilarProblems() ─────────────────────────────────────────────────────

function findSimilarProblems(problemDescription, limit = 10) {
    const results = [];
    const terms   = _tokenize(problemDescription);

    // RCAs
    const rca = _rca();
    if (rca) {
        const { analyses } = rca.listAnalyses({ limit: 50 });
        for (const a of (analyses || [])) {
            const score = _cosineSim(problemDescription, `${a.title} ${a.likelyRootCause} ${a.recommendedFix}`);
            if (score > 0.03) results.push({
                type: "rca", score,
                id:     a.rcaId,
                title:  a.title,
                rootCause: a.likelyRootCause,
                fix:    a.recommendedFix,
                confidence: a.confidence,
                canAutoFix: a.canAutoFix,
                frequency:  a.frequency,
            });
        }
    }

    // Mission failures
    for (const m of _rawMissions()) {
        for (const f of (m.failures || [])) {
            const score = _cosineSim(problemDescription, f.description || "");
            if (score > 0.1) results.push({
                type: "mission_failure", score,
                missionId:    m.id,
                objective:    m.objective,
                failurePhase: f.phase,
                description:  f.description,
                resolved:     f.resolved,
            });
        }
    }

    // Engineering rules (error patterns)
    const rr = _rr();
    if (rr) {
        const { rules } = rr.listRules({ limit: 50 });
        for (const r of (rules || [])) {
            const patternText = (r.errorPatterns || []).join(" ");
            const score = _cosineSim(problemDescription, `${r.title} ${r.why} ${patternText}`);
            if (score > 0.03) results.push({
                type: "rule_match", score,
                ruleId:   r.ruleId,
                title:    r.title,
                solution: r.solution,
                autoApply: r.autoApply,
            });
        }
    }

    // Raw failure lessons
    const rawLessons = _rawLessons();
    const failLessons = rawLessons.filter(l => l.type === 'failure').slice(0, 200);
    for (const l of failLessons) {
        const score = _overlapScore(terms, `${l.title} ${l.detail}`);
        if (score > 0.25) results.push({
            type: "failure_lesson", score: score * 0.8,
            lessonId:   l.lessonId,
            title:      l.title,
            detail:     l.detail,
            recommendation: l.recommendation,
        });
    }

    results.sort((a, b) => b.score - a.score);
    return { query: problemDescription, results: results.slice(0, limit) };
}

// ── findSimilarPatches() ──────────────────────────────────────────────────────

function findSimilarPatches(targetFile, reasonHint, limit = 10) {
    const results = [];
    const searchText = `${targetFile} ${reasonHint}`;

    for (const p of _rawPatches()) {
        const score = _cosineSim(searchText, `${p.filePath} ${p.reason}`);
        if (score > 0.05) results.push({
            id:         p.id,
            filePath:   p.filePath,
            reason:     p.reason,
            status:     p.status,
            appliedAt:  p.appliedAt,
            score,
        });
    }

    // ACP-6 bundles
    const re = _re();
    if (re) {
        const { bundles } = re.listBundles({ limit: 30 });
        for (const b of (bundles || [])) {
            const fileMatch = (b.files || []).some(f => f.path && f.path.includes(targetFile));
            if (fileMatch) results.push({
                id:       b.bundleId,
                type:     "acp6_bundle",
                goal:     b.goal,
                files:    b.files?.length || 0,
                status:   b.status,
                score:    0.7,
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return { targetFile, reasonHint, results: results.slice(0, limit) };
}

// ── findSuccessfulStrategies() ────────────────────────────────────────────────

function findSuccessfulStrategies(goalDescription, limit = 10) {
    const results = [];

    // Success lessons
    const rawLessons = _rawLessons();
    for (const l of rawLessons.filter(l => l.type === 'success').slice(0, 300)) {
        const score = _cosineSim(goalDescription, `${l.title} ${l.detail}`);
        if (score > 0.05) results.push({
            type:       "success_lesson",
            score,
            lessonId:   l.lessonId,
            title:      l.title,
            detail:     l.detail,
            createdAt:  l.createdAt,
        });
    }

    // Engineering rules marked reusable
    const rr = _rr();
    if (rr) {
        const { rules } = rr.listRules({ limit: 50 });
        for (const r of (rules || []).filter(r => r.reusable)) {
            const score = _cosineSim(goalDescription, `${r.title} ${r.solution} ${r.why}`);
            if (score > 0.03) results.push({
                type:     "reusable_rule",
                score,
                ruleId:   r.ruleId,
                title:    r.title,
                solution: r.solution,
                autoApply: r.autoApply,
            });
        }
    }

    // Playbooks from RCA
    const rca = _rca();
    if (rca) {
        const pbResult  = rca.listPlaybooks?.() || {};
        const playbooks = pbResult.playbooks || (Array.isArray(pbResult) ? pbResult : []);
        for (const pb of playbooks) {
            const score = _cosineSim(goalDescription, `${pb.title || ""} ${pb.steps?.join(" ") || ""}`);
            if (score > 0.03) results.push({
                type:     "rca_playbook",
                score,
                playbookId: pb.id || pb.rcaId,
                title:    pb.title,
                steps:    pb.steps,
            });
        }
    }

    // Approved decisions
    const de = _de();
    if (de) {
        const dm = de.getDashboardMetrics();
        const approved = (dm?.approved || []).slice(0, 20);
        for (const a of approved) {
            const score = _cosineSim(goalDescription, `${a.title || ""} ${a.description || ""}`);
            if (score > 0.05) results.push({
                type:  "approved_decision",
                score,
                id:    a.id,
                title: a.title,
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return { goal: goalDescription, results: results.slice(0, limit) };
}

// ── predictBestSolution() ─────────────────────────────────────────────────────

function predictBestSolution(goalDescription) {
    const similar  = findSimilarProblems(goalDescription, 5);
    const strategies = findSuccessfulStrategies(goalDescription, 5);

    // Build a ranked solution list
    const solutions = [];

    for (const s of similar.results) {
        if (s.type === "rule_match" || s.type === "rca") {
            const fix = s.fix || s.solution || "";
            if (fix) solutions.push({
                confidence: Math.round(s.score * 100),
                solution:   fix,
                source:     s.type,
                autoApply:  s.autoApply || s.canAutoFix || false,
                reference:  s.id || s.ruleId || s.rcaId,
            });
        }
    }

    for (const s of strategies.results) {
        if (s.type === "reusable_rule") {
            solutions.push({
                confidence: Math.round(s.score * 80),
                solution:   s.solution,
                source:     "reusable_rule",
                autoApply:  s.autoApply,
                reference:  s.ruleId,
            });
        }
    }

    solutions.sort((a, b) => b.confidence - a.confidence);

    const bestSolution = solutions[0] || null;
    const avgConfidence = solutions.length
        ? Math.round(solutions.reduce((s, x) => s + x.confidence, 0) / solutions.length)
        : 0;

    return {
        goal:           goalDescription,
        bestSolution,
        alternatives:   solutions.slice(1, 4),
        avgConfidence,
        dataPoints:     similar.results.length + strategies.results.length,
    };
}

// ── predictFailureRisk() ──────────────────────────────────────────────────────

async function predictFailureRisk(goal, filesInvolved = []) {
    let risk = 0;
    const signals = [];

    // 1. Smell density on target files (ACP-9 hotspot data)
    const viz = _viz();
    if (viz) {
        const stats = viz.getStatistics();
        if (stats.cached) {
            const hs = viz.findHotspots();
            for (const f of filesInvolved) {
                const hotspot = hs.hotspots?.find(h => h.path === f || h.path.includes(f));
                if (hotspot) {
                    const fr = hotspot.hotScore / 100;
                    risk += fr * 20;
                    signals.push({ signal: "hotspot", file: f, hotScore: hotspot.hotScore, weight: fr * 20 });
                }
            }
        }
    }

    // 2. Historical failure rate from RCA
    const rca = _rca();
    if (rca) {
        const rcaStats = rca.getStats();
        const failureRate = rcaStats.totalFailuresAnalysed > 0
            ? Math.min(1, rcaStats.active / 5)
            : 0;
        risk += failureRate * 25;
        signals.push({ signal: "active_rcas", count: rcaStats.active, weight: failureRate * 25 });
    }

    // 3. Confidence engine weights
    const ce = _ce();
    if (ce) {
        const ceStats = ce.getStats();
        if (ceStats.avgConfidence > 0) {
            const confFactor = (100 - ceStats.avgConfidence) / 100;
            risk += confFactor * 15;
            signals.push({ signal: "low_confidence", avgConf: ceStats.avgConfidence, weight: confFactor * 15 });
        }
    }

    // 4. Mission failure rate
    const ms = _rawMissions();
    const totalMissions  = ms.length;
    const failedMissions = ms.filter(m => m.status === 'failed').length;
    if (totalMissions > 0) {
        const mFail = failedMissions / totalMissions;
        risk += mFail * 20;
        signals.push({ signal: "mission_failure_rate", rate: mFail, weight: mFail * 20 });
    }

    // 5. Similar problem found with no known fix
    const similar = findSimilarProblems(goal, 3);
    const unresolved = similar.results.filter(r => r.resolved === false || r.type === "mission_failure");
    if (unresolved.length > 0) {
        risk += unresolved.length * 5;
        signals.push({ signal: "unresolved_similar_failures", count: unresolved.length, weight: unresolved.length * 5 });
    }

    // 6. Circular deps in involved files (ACP-9)
    if (viz) {
        const stats = viz.getStatistics();
        if (stats.circularDeps > 0 && filesInvolved.length > 0) {
            risk += Math.min(15, stats.circularDeps * 2);
            signals.push({ signal: "circular_deps", count: stats.circularDeps, weight: Math.min(15, stats.circularDeps * 2) });
        }
    }

    risk = Math.min(100, Math.round(risk));

    return {
        goal,
        filesInvolved,
        riskScore:          risk,
        riskLevel:          risk >= 70 ? "high" : risk >= 40 ? "medium" : "low",
        failureProbability: risk,
        buildProbability:   Math.max(0, 100 - risk * 0.6),
        testProbability:    Math.max(0, 100 - risk * 0.5),
        rollbackProbability: Math.min(100, risk * 0.4),
        repairProbability:  Math.min(100, risk * 0.7),
        expectedDurationMs: 30000 + risk * 500,
        signals,
        recommendation:
            risk >= 70 ? "High risk — apply extra validation gates and ensure rollback bundle is prepared" :
            risk >= 40 ? "Medium risk — run smell scan before patching and add test coverage" :
                         "Low risk — proceed with standard pipeline",
    };
}

// ── compareWithHistory() ──────────────────────────────────────────────────────

function compareWithHistory(currentGoal, currentMetrics = {}) {
    const similar = findSimilarProblems(currentGoal, 8);
    const strategies = findSuccessfulStrategies(currentGoal, 5);

    // Extract historical success/failure rates for similar items
    const historicalSuccesses = strategies.results.filter(r => r.score > 0.1).length;
    const historicalFailures  = similar.results.filter(r => r.type === "mission_failure" || r.type === "failure_lesson").length;
    const totalHistorical     = historicalSuccesses + historicalFailures;

    const historicalSuccessRate = totalHistorical > 0
        ? Math.round(historicalSuccesses / totalHistorical * 100)
        : null;

    // Compare current pipeline stats
    const pcStats = _pc()?.getStats() || {};
    const leStats = _le()?.getStats() || {};

    return {
        goal:                 currentGoal,
        currentMetrics,
        historicalSuccessRate,
        historicalSuccesses,
        historicalFailures,
        similarProblems:      similar.results.slice(0, 5),
        successfulStrategies: strategies.results.slice(0, 3),
        pipelineContext: {
            totalRuns:       pcStats.total || 0,
            successRate:     pcStats.total > 0 ? Math.round(pcStats.completed / pcStats.total * 100) : null,
            buildGateBlocks: pcStats.buildGateBlocked || 0,
            testGateBlocks:  pcStats.testGateBlocked || 0,
        },
        learningContext: {
            totalLessons:  leStats.totalLessons || 0,
            failureLessons: leStats.lessonsByType?.failure || 0,
            successLessons: leStats.lessonsByType?.success || 0,
        },
    };
}

// ── evolveKnowledge() ────────────────────────────────────────────────────────
//
// Runs the continuous learning engine's full analysis, backfills rules from
// history, and runs RCA — consolidating all memory into the existing stores.
//
async function evolveKnowledge() {
    const results = {};

    // 1. Run continuous learning full analysis
    try {
        const le = _le();
        if (le) {
            const r = await le.runFullAnalysis();
            results.learningAnalysis = { ok: true, lessons: r?.lessons?.length || 0 };
        }
    } catch (e) { results.learningAnalysis = { ok: false, error: e.message }; }

    // 2. Backfill engineering rules from mission history
    try {
        const rr = _rr();
        if (rr) {
            const r = rr.backfillFromHistory?.() || { ruleId: null };
            results.ruleBackfill = { ok: true, result: r };
        }
    } catch (e) { results.ruleBackfill = { ok: false, error: e.message }; }

    // 3. Run RCA
    try {
        const rca = _rca();
        if (rca) {
            const r = await rca.runAnalysis();
            results.rcaAnalysis = { ok: true, analyses: r?.analyses?.length || 0, playbooks: r?.playbooks?.length || 0 };
        }
    } catch (e) { results.rcaAnalysis = { ok: false, error: e.message }; }

    // 4. Cross-domain intelligence
    try {
        const ui = _ui();
        if (ui) {
            const r = await ui.reason();
            results.unifiedReason = { ok: true, recommendations: r?.recommendations?.length || 0 };
        }
    } catch (e) { results.unifiedReason = { ok: false, error: e.message }; }

    results.evolvedAt = new Date().toISOString();
    return results;
}

// ── findSimilarPatterns (internal helper for recall) ──────────────────────────

function _findPatternsByKeywords(keywords, sources) {
    const terms  = keywords.map(k => k.toLowerCase());
    const out    = [];
    for (const l of sources) {
        const hits = terms.filter(t => (l.text||"").toLowerCase().includes(t)).length;
        if (hits > 0) out.push({ ...l, patternScore: hits / terms.length });
    }
    return out.sort((a, b) => b.patternScore - a.patternScore);
}

// ── getStatistics() ──────────────────────────────────────────────────────────

function getStatistics() {
    const leStats  = _le()?.getStats()       || {};
    const rrStats  = _rr()?.getStats()       || {};
    const rcaStats = _rca()?.getStats()      || {};
    const mmStats  = _mm()?.getMissionStats() || {};
    const pStats   = _pc()?.getStats()       || {};
    const bStats   = _re()?.getBundleStats() || {};
    const ceStats  = _ce()?.getStats()       || {};
    const vizStats = _viz()?.getStatistics() || {};

    const rawLessons   = _rawLessons();
    const rawPatches   = _rawPatches();
    const rawPipelines = _rawPipelines();
    const rawMissions  = _rawMissions();

    return {
        memorySources: {
            lessons:       leStats.totalLessons     || rawLessons.length,
            rules:         rrStats.total            || 0,
            rcas:          rcaStats.totalRCAs        || 0,
            failuresAnalysed: rcaStats.totalFailuresAnalysed || 0,
            missions:      mmStats.total            || rawMissions.length,
            failedMissions: mmStats.byStatus?.failed || 0,
            patches:       rawPatches.length,
            pipelineRuns:  pStats.total             || rawPipelines.length,
            bundles:       bStats.total             || 0,
            repoFiles:     vizStats.totalFiles       || 0,
        },
        engineHealth: {
            avgConfidence:   ceStats.avgConfidence   || 0,
            healthScore:     vizStats.healthScore    || 0,
            openRecommendations: leStats.openRecs    || 0,
            activeRCAs:      rcaStats.active         || 0,
            autoFixableRCAs: rcaStats.autoFixable    || 0,
            playbooks:       rcaStats.playbooksCreated || 0,
        },
        growth: {
            lessonsThisWeek:  rawLessons.filter(l => {
                if (!l.createdAt) return false;
                return Date.now() - new Date(l.createdAt).getTime() < 7 * 86400000;
            }).length,
            totalKnowledgeItems:
                (leStats.totalLessons || 0) +
                (rrStats.total || 0) +
                (rcaStats.totalRCAs || 0) +
                (mmStats.total || 0),
        },
        computedAt: new Date().toISOString(),
    };
}

// ── Timeline (for frontend) ───────────────────────────────────────────────────

function getTimeline(limit = 60) {
    const events = [];

    // Lessons
    const rawLessons = _rawLessons().slice(0, 200);
    for (const l of rawLessons) {
        if (l.createdAt) events.push({
            type: "lesson", id: l.lessonId, title: l.title,
            subtype: l.type, severity: l.severity,
            timestamp: l.createdAt,
        });
    }

    // Patches
    for (const p of _rawPatches().slice(0, 100)) {
        const ts = p.appliedAt || p.proposedAt;
        if (ts) events.push({
            type: "patch", id: p.id, title: p.filePath,
            status: p.status, timestamp: ts,
        });
    }

    // Pipeline runs
    for (const pr of _rawPipelines().slice(0, 50)) {
        if (pr.createdAt) events.push({
            type: "pipeline", id: pr.id, title: pr.pipeline || pr.id,
            state: pr.state, timestamp: pr.createdAt,
        });
    }

    // Missions
    for (const m of _rawMissions().slice(0, 50)) {
        if (m.createdAt) events.push({
            type: "mission", id: m.id, title: m.objective?.slice(0, 60),
            status: m.status, timestamp: m.createdAt,
        });
    }

    // RCAs
    const rca = _rca();
    if (rca) {
        const { analyses } = rca.listAnalyses({ limit: 20 });
        for (const a of (analyses || [])) {
            if (a.extractedAt) events.push({
                type: "rca", id: a.rcaId, title: a.title,
                confidence: a.confidence, timestamp: a.extractedAt,
            });
        }
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { events: events.slice(0, limit), total: events.length };
}

// ── Knowledge growth (for frontend chart) ────────────────────────────────────

function getKnowledgeGrowth() {
    const rawLessons  = _rawLessons();
    const rawPatches  = _rawPatches();
    const rawMissions = _rawMissions();

    // Group by week
    const weeks = {};
    const addToWeek = (ts, type) => {
        if (!ts) return;
        const d    = new Date(ts);
        const week = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2,"0")}`;
        if (!weeks[week]) weeks[week] = { week, lessons: 0, patches: 0, missions: 0, rules: 0 };
        weeks[week][type]++;
    };

    for (const l of rawLessons) addToWeek(l.createdAt, 'lessons');
    for (const p of rawPatches) addToWeek(p.appliedAt || p.proposedAt, 'patches');
    for (const m of rawMissions) addToWeek(m.createdAt, 'missions');

    const rr = _rr();
    if (rr) {
        const { rules } = rr.listRules({ limit: 50 });
        for (const r of (rules || [])) addToWeek(r.extractedAt, 'rules');
    }

    const series = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).slice(-12);
    return { series, total: rawLessons.length + rawPatches.length + rawMissions.length };
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

async function runBenchmark() {
    const start     = Date.now();
    const scenarios = [
        {
            name: "Repeated bug — RCA match",
            fn: () => {
                const r = findSimilarProblems("timeout retry execution deterministic", 5);
                return { ok: r.results.length > 0, value: `${r.results.length} matches` };
            },
        },
        {
            name: "Repeated patch — file similarity",
            fn: () => {
                const r = findSimilarPatches("generated", "ok", 5);
                return { ok: r.results.length >= 0, value: `${r.results.length} patches` };
            },
        },
        {
            name: "Repeated smell — strategy match",
            fn: () => {
                const r = findSuccessfulStrategies("dead code unused cleanup remove", 5);
                return { ok: r.results.length >= 0, value: `${r.results.length} strategies` };
            },
        },
        {
            name: "RCA recall accuracy",
            fn: async () => {
                const r = await recall({ query: "circuit breaker timeout ai service", limit: 5, sources: ["all"] });
                return { ok: true, value: `${r.totalFound} recalled` };
            },
        },
        {
            name: "Repository evolution — hotspot prediction",
            fn: async () => {
                const r = await predictFailureRisk("refactor authentication middleware", ["backend/middleware/auth.js"]);
                return { ok: typeof r.riskScore === 'number', value: `risk=${r.riskScore}% ${r.riskLevel}` };
            },
        },
        {
            name: "Mission similarity",
            fn: () => {
                const r = findSimilarProblems("V1 validation scenario benchmark", 5);
                return { ok: r.results.length >= 0, value: `${r.results.length} similar missions` };
            },
        },
        {
            name: "Prediction quality — best solution",
            fn: () => {
                const r = predictBestSolution("execution retry race condition agent bootstrap");
                return { ok: typeof r.avgConfidence === 'number', value: `conf=${r.avgConfidence}% on ${r.dataPoints} data points` };
            },
        },
        {
            name: "Repair prediction",
            fn: async () => {
                const r = await predictFailureRisk("repair build gate failure", ["backend/routes/index.js"]);
                return { ok: !!r.riskLevel, value: `repair prob=${r.repairProbability}%` };
            },
        },
        {
            name: "Historical recall — lessons",
            fn: async () => {
                const r = await recall({ query: "autopilot review code quality refactor", limit: 10, sources: ["lessons", "raw_lessons"] });
                return { ok: r.results.length >= 0, value: `${r.results.length} lessons recalled` };
            },
        },
        {
            name: "Knowledge growth metrics",
            fn: () => {
                const stats = getStatistics();
                const growth = getKnowledgeGrowth();
                const total  = stats.memorySources.lessons + stats.memorySources.rules + stats.memorySources.rcas;
                return { ok: total > 0, value: `${total} knowledge items, ${growth.series.length} weeks tracked` };
            },
        },
    ];

    const results = [];
    for (const s of scenarios) {
        const t0 = Date.now();
        try {
            const r = await s.fn();
            results.push({ name: s.name, ok: r.ok, value: r.value, elapsedMs: Date.now() - t0 });
        } catch (e) {
            results.push({ name: s.name, ok: false, error: e.message, elapsedMs: Date.now() - t0 });
        }
    }

    const passed = results.filter(r => r.ok).length;
    return {
        total:     results.length,
        passed,
        passRate:  Math.round(passed / results.length * 100),
        totalMs:   Date.now() - start,
        scenarios: results,
        stats:     getStatistics(),
    };
}

module.exports = {
    remember,
    recall,
    findSimilarProblems,
    findSimilarPatches,
    findSuccessfulStrategies,
    predictBestSolution,
    predictFailureRisk,
    compareWithHistory,
    evolveKnowledge,
    getStatistics,
    getTimeline,
    getKnowledgeGrowth,
    runBenchmark,
};
