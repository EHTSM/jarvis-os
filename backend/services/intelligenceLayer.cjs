"use strict";
/**
 * intelligenceLayer.cjs — J4 Cross-Domain Intelligence Integration Layer
 *
 * Correlates signals across existing services. No new storage, no new
 * indexing, no new observers. All data is read from existing sources and
 * correlated in-memory. Results are cached for 60 seconds.
 *
 * Correlation domains:
 *  1. Engineering failures ↔ deployment history
 *  2. Deployment history ↔ runtime health
 *  3. Runtime health ↔ mission outcomes
 *  4. Recommendations ↔ historical success rate
 *  5. Agent performance ↔ task categories
 *  6. Memory knowledge ↔ executive planning
 *
 * Public API:
 *   getCorrelations()           — all 6 correlation vectors
 *   getInsights()               — derived actionable insights
 *   getPatterns()               — recurring pattern clusters
 *   getTrends(windowDays)       — time-bucketed trend series
 *   getRecommendationConfidence() — per-recommendation confidence scoring
 */

const path   = require("path");
const fs     = require("fs");
const logger = require("../utils/logger");

// ── Lazy service refs ────────────────────────────────────────────────────────
let _mm  = null, _cls = null, _sms = null, _re  = null,
    _er  = null, _aee = null, _bg  = null, _ea  = null, _il  = null;

function _getMM()  { if (!_mm)  try { _mm  = require("./missionMemory.cjs");             } catch {} return _mm;  }
function _getCLS() { if (!_cls) try { _cls = require("./continuousLearningEngine.cjs");   } catch {} return _cls; }
function _getSMS() { if (!_sms) try { _sms = require("./semanticMemorySearch.cjs");       } catch {} return _sms; }
function _getRE()  { if (!_re)  try { _re  = require("./reasoningEngine.cjs");            } catch {} return _re;  }
function _getER()  { if (!_er)  try { _er  = require("./executiveReasoning.cjs");         } catch {} return _er;  }
function _getAEE() { if (!_aee) try { _aee = require("./agentExecutionEngine.cjs");       } catch {} return _aee; }
function _getBG()  { if (!_bg)  try { _bg  = require("./backgroundRuntime.cjs");          } catch {} return _bg;  }
function _getEA()  { if (!_ea)  try { _ea  = require("./errorAggregator.cjs");            } catch {} return _ea;  }
function _getIL()  { if (!_il)  try { _il  = require("./improvementLoop.cjs");            } catch {} return _il;  }

// ── In-memory result cache (60-second TTL) ───────────────────────────────────
const _cache = {};
const CACHE_TTL_MS = 60_000;

function _cached(key, fn) {
    const now = Date.now();
    if (_cache[key] && now - _cache[key].ts < CACHE_TTL_MS) return _cache[key].val;
    try {
        const val = fn();
        _cache[key] = { val, ts: now };
        return val;
    } catch (err) {
        logger.warn(`[IntelligenceLayer] ${key} failed: ${err.message}`);
        return _cache[key]?.val ?? null;
    }
}

// ── Data readers ─────────────────────────────────────────────────────────────

function _readMissions() {
    const mm = _getMM();
    if (!mm) return [];
    try {
        const { missions } = mm.listMissions({ limit: 200 });
        return missions || [];
    } catch { return []; }
}

function _readFailureClusters() {
    const cls = _getCLS();
    if (!cls) return [];
    try {
        const r = cls.analyzeFailures({ limit: 200 });
        return r.clusters || [];
    } catch { return []; }
}

function _readSuccessPatterns() {
    const cls = _getCLS();
    if (!cls) return [];
    try {
        const r = cls.analyzeSuccesses({ limit: 50 });
        return r.patterns || [];
    } catch { return []; }
}

function _readDeployments() {
    try {
        const f = path.join(__dirname, "../../data/deployments.json");
        const d = JSON.parse(fs.readFileSync(f, "utf8"));
        if (Array.isArray(d)) return d;
        const raw = d.deployments || [];
        // deployments.json stores an object map {id: deployment} — normalize to array
        return Array.isArray(raw) ? raw : Object.values(raw);
    } catch { return []; }
}

function _readRuntimeHealth() {
    const bg = _getBG();
    if (!bg) return null;
    try { return bg.getStatus(); } catch { return null; }
}

function _readTopErrors() {
    const ea = _getEA();
    if (!ea) return [];
    try { return ea.getTopErrors(10); } catch { return []; }
}

function _readErrorTrend() {
    const ea = _getEA();
    if (!ea) return [];
    try { return ea.getErrorTrend(24); } catch { return []; }
}

function _readRecommendations() {
    const bg = _getBG();
    if (!bg) return [];
    try {
        const r = bg.getRecommendations({ limit: 100 });
        return r.recommendations || [];
    } catch { return []; }
}

function _readLessons() {
    const cls = _getCLS();
    if (!cls) return [];
    try {
        const r = cls.getLessons({ limit: 100 });
        // getLessons returns { lessons: [...] } — normalize to array
        return Array.isArray(r) ? r : (r?.lessons || []);
    } catch { return []; }
}

function _readAgentRuns() {
    const aee = _getAEE();
    if (!aee) return [];
    try {
        const { agents } = aee.listAgents();
        return agents || [];
    } catch { return []; }
}

function _readMemoryGraph() {
    const sms = _getSMS();
    if (!sms) return null;
    try { return sms.getKnowledgeGraph({ limit: 50 }); } catch { return null; }
}

function _readPlanningHorizons() {
    try {
        const f = path.join(__dirname, "../../data/planning-horizons.json");
        const d = JSON.parse(fs.readFileSync(f, "utf8"));
        return d.horizons || {};
    } catch { return {}; }
}

function _readImprovementMetrics() {
    const il = _getIL();
    if (!il) return null;
    try { return il.getMetrics ? il.getMetrics() : null; } catch { return null; }
}

// ── Correlation 1: Engineering failures ↔ deployment history ────────────────
function _correlateFailuresDeployments(clusters, deployments) {
    if (!clusters.length && !deployments.length) {
        return { strength: 0, label: "no_data", samples: 0, insight: "Insufficient data" };
    }

    const recentDeploys = deployments
        .filter(d => d.createdAt || d.startedAt || d.timestamp)
        .sort((a, b) => {
            const ta = new Date(a.createdAt || a.startedAt || a.timestamp);
            const tb = new Date(b.createdAt || b.startedAt || b.timestamp);
            return tb - ta;
        })
        .slice(0, 20);

    const failedDeploys = recentDeploys.filter(d =>
        d.status === "failed" || d.status === "error" || d.status === "rollback"
    );

    const highSeverityClusters = clusters.filter(c => c.severity === "high" || c.severity === "critical");
    const strength = Math.min(100, Math.round(
        (highSeverityClusters.length * 20) +
        (failedDeploys.length / Math.max(recentDeploys.length, 1)) * 80
    ));

    const label = strength > 70 ? "strong_positive"
                : strength > 40 ? "moderate"
                : strength > 10 ? "weak"
                : "none";

    return {
        strength,
        label,
        samples: clusters.length + deployments.length,
        failedDeployments: failedDeploys.length,
        totalDeployments:  recentDeploys.length,
        highSeverityFailures: highSeverityClusters.length,
        insight: strength > 70
            ? `Strong correlation: ${highSeverityClusters.length} high-severity failure cluster(s) co-occurring with ${failedDeploys.length} failed deployment(s)`
            : strength > 40
            ? `Moderate correlation between failures and deployments — review deployment gates`
            : `Failures appear independent of recent deployments`,
    };
}

// ── Correlation 2: Deployment history ↔ runtime health ──────────────────────
function _correlateDeploymentsHealth(deployments, health) {
    if (!health) return { strength: 0, label: "no_data", samples: 0, insight: "Runtime health unavailable" };

    const observers = health.observers || {};
    const obsArr    = Object.entries(observers);
    const errorObs  = obsArr.filter(([, o]) => o.lastError !== null).length;
    const totalObs  = obsArr.length;
    const healthPct = totalObs > 0 ? Math.round((totalObs - errorObs) / totalObs * 100) : 100;

    const recentFailed = deployments
        .filter(d => d.status === "failed" || d.status === "rollback")
        .slice(0, 10).length;

    const strength = Math.min(100, Math.round(
        (recentFailed * 15) + ((100 - healthPct) * 0.6)
    ));

    const label = strength > 60 ? "strong_negative"
                : strength > 30 ? "moderate_negative"
                : "healthy";

    return {
        strength,
        label,
        samples:         deployments.length + totalObs,
        observerHealth:  healthPct,
        errorObservers:  errorObs,
        failedDeploys:   recentFailed,
        insight: strength > 60
            ? `Degraded runtime health (${healthPct}% observers OK) correlates with ${recentFailed} recent failed deployments`
            : `Runtime health is ${healthPct}% — deployment history shows acceptable failure rate`,
    };
}

// ── Correlation 3: Runtime health ↔ mission outcomes ────────────────────────
function _correlateHealthMissions(health, missions) {
    const observers  = health?.observers || {};
    const obsArr     = Object.entries(observers);
    const errorObs   = obsArr.filter(([, o]) => o.lastError !== null).length;
    const healthPct  = obsArr.length > 0
        ? Math.round((obsArr.length - errorObs) / obsArr.length * 100) : 100;

    const completedM = missions.filter(m => m.status === "completed").length;
    const failedM    = missions.filter(m => m.status === "failed").length;
    const totalM     = missions.length;
    const successPct = totalM > 0 ? Math.round(completedM / totalM * 100) : 0;

    // Inverse correlation: low health → low mission success
    const strength = totalM === 0 ? 0 :
        Math.min(100, Math.abs(healthPct - successPct));

    const label = strength > 50 ? "inverse_correlation"
                : strength > 25 ? "weak_inverse"
                : "aligned";

    return {
        strength,
        label,
        samples:       totalM + obsArr.length,
        runtimeHealth: healthPct,
        missionSuccess: successPct,
        completedMissions: completedM,
        failedMissions:    failedM,
        insight: label === "inverse_correlation"
            ? `Runtime health (${healthPct}%) inversely correlated with mission success (${successPct}%) — address observer failures to improve outcomes`
            : label === "weak_inverse"
            ? `Slight divergence between runtime health (${healthPct}%) and mission outcomes (${successPct}%)`
            : `Runtime health (${healthPct}%) and mission success (${successPct}%) are aligned`,
    };
}

// ── Correlation 4: Recommendations ↔ historical success ─────────────────────
function _correlateRecommendationsSuccess(recs, lessons, missions) {
    const totalRecs  = recs.length;
    const successM   = missions.filter(m => m.status === "completed").length;
    const totalM     = missions.length;

    // Lessons from continuousLearning that are positive
    const posLessons = lessons.filter(l =>
        l.type === "success" || l.type === "win" || l.severity === "low"
    ).length;

    const recSuccessRate = totalRecs > 0 && totalM > 0
        ? Math.round((posLessons / Math.max(totalRecs, 1)) * 100)
        : 0;

    // Confidence distribution from backgroundRuntime recs
    const highConf   = recs.filter(r => r.confidence >= 80).length;
    const medConf    = recs.filter(r => r.confidence >= 50 && r.confidence < 80).length;
    const lowConf    = recs.filter(r => r.confidence < 50 || r.confidence == null).length;
    const avgConf    = totalRecs > 0
        ? Math.round(recs.reduce((s, r) => s + (r.confidence || 60), 0) / totalRecs)
        : 0;

    return {
        strength:       avgConf,
        label:          avgConf >= 75 ? "high_confidence" : avgConf >= 50 ? "moderate" : "low_confidence",
        samples:        totalRecs + lessons.length,
        totalRecs,
        avgConfidence:  avgConf,
        highConf, medConf, lowConf,
        positiveLessons: posLessons,
        missionSuccessRate: totalM > 0 ? Math.round(successM / totalM * 100) : 0,
        insight: avgConf >= 75
            ? `Recommendations averaging ${avgConf}% confidence — strongly correlated with mission success patterns`
            : avgConf >= 50
            ? `Moderate confidence recommendations (${avgConf}% avg) — validate against more mission outcomes`
            : `Low confidence recommendations — expand lesson corpus for better signal`,
    };
}

// ── Correlation 5: Agent performance ↔ task categories ──────────────────────
function _correlateAgentPerformance(agents, successPatterns) {
    if (!agents.length) {
        return { strength: 0, label: "no_data", samples: 0, insight: "No agent run history", byAgent: [] };
    }

    const byAgent = agents.map(a => {
        const successRate = (a.stats?.successRate ?? a.successRate) || 0;
        const totalRuns   = (a.stats?.totalRuns  ?? a.totalRuns)   || 0;
        const pattern     = successPatterns.find(p => p.agentId === a.id);
        return {
            id:          a.id,
            name:        a.name || a.id,
            successRate,
            totalRuns,
            matchedPattern: pattern ? true : false,
            bestCategory:   pattern?.dominantType || null,
            strength:       Math.min(100, successRate),
        };
    }).sort((a, b) => b.successRate - a.successRate);

    const avgStrength = byAgent.length
        ? Math.round(byAgent.reduce((s, a) => s + a.strength, 0) / byAgent.length) : 0;

    const topAgent  = byAgent[0];
    const weakAgent = byAgent[byAgent.length - 1];

    return {
        strength:   avgStrength,
        label:      avgStrength >= 80 ? "high_performance" : avgStrength >= 60 ? "moderate" : "needs_attention",
        samples:    agents.length,
        byAgent:    byAgent.slice(0, 10),
        avgSuccessRate: avgStrength,
        insight: topAgent
            ? `Top agent: ${topAgent.name} (${topAgent.successRate}% success). ${
                weakAgent && weakAgent !== topAgent
                    ? `Lowest: ${weakAgent.name} (${weakAgent.successRate}%). `
                    : ''
              }Average across ${agents.length} agents: ${avgStrength}%`
            : "Agent performance data collected",
    };
}

// ── Correlation 6: Memory knowledge ↔ executive planning ────────────────────
function _correlateMemoryPlanning(memGraph, horizons) {
    const nodeCount = memGraph?.stats?.totalNodes ?? 0;
    const edgeCount = memGraph?.stats?.totalEdges ?? 0;
    const horizonKeys = Object.keys(horizons);

    const coveredHorizons = horizonKeys.filter(h => {
        const plan = horizons[h];
        return plan && Array.isArray(plan.objectives) && plan.objectives.length > 0;
    }).length;

    const coverage = horizonKeys.length > 0
        ? Math.round(coveredHorizons / horizonKeys.length * 100) : 0;

    // Correlation: richer memory → better horizon coverage
    const strength = Math.min(100, Math.round(
        (nodeCount > 0 ? Math.min(nodeCount / 10, 50) : 0) +
        coverage * 0.5
    ));

    return {
        strength,
        label:           strength >= 70 ? "well_integrated" : strength >= 40 ? "partial" : "sparse",
        samples:         nodeCount + horizonKeys.length,
        memoryNodes:     nodeCount,
        memoryEdges:     edgeCount,
        horizonCoverage: coverage,
        coveredHorizons,
        totalHorizons:   horizonKeys.length,
        insight: strength >= 70
            ? `Memory graph (${nodeCount} nodes) well-integrated with ${coveredHorizons}/${horizonKeys.length} planning horizons covered`
            : strength >= 40
            ? `Partial integration: ${coveredHorizons}/${horizonKeys.length} horizons have objectives derived from memory`
            : `Sparse memory-planning link — grow knowledge graph to improve planning quality`,
    };
}

// ── Pattern detection ─────────────────────────────────────────────────────────
function _detectPatterns(clusters, successPatterns, missions) {
    const patterns = [];

    // Failure patterns from continuousLearningEngine
    for (const c of clusters.slice(0, 5)) {
        patterns.push({
            id:         `fail_${c.pattern?.slice(0, 20).replace(/\W/g, '_')}`,
            type:       "failure",
            label:      c.pattern?.slice(0, 80) || "Error pattern",
            count:      c.count || 1,
            severity:   c.severity || "medium",
            rootCause:  c.rootCause || "unknown",
            lastSeen:   c.lastSeen || null,
        });
    }

    // Success patterns
    for (const p of successPatterns.slice(0, 5)) {
        patterns.push({
            id:         `succ_${(p.agentId || p.toolId || "agent").slice(0, 12)}`,
            type:       "success",
            label:      `${p.agentId || p.toolId || "Agent"} — ${p.dominantType || "task"} (${p.successRate?.toFixed(0) ?? "?"}% success)`,
            count:      p.totalRuns || 1,
            severity:   "none",
            rootCause:  null,
            successRate: p.successRate || 0,
        });
    }

    // Mission completion patterns
    const mByStatus = {};
    for (const m of missions) {
        mByStatus[m.status] = (mByStatus[m.status] || 0) + 1;
    }
    for (const [status, count] of Object.entries(mByStatus)) {
        patterns.push({
            id:       `mission_${status}`,
            type:     "mission",
            label:    `Mission ${status}`,
            count,
            severity: status === "failed" ? "high" : "none",
            rootCause: null,
        });
    }

    return patterns.sort((a, b) => (b.count || 0) - (a.count || 0));
}

// ── Trend series ─────────────────────────────────────────────────────────────
function _buildTrends(errorTrend, missions, deployments, windowDays = 7) {
    const now      = Date.now();
    const buckets  = [];
    const bucketMs = 24 * 3600 * 1000;
    const count    = Math.min(windowDays, 30);

    for (let i = count - 1; i >= 0; i--) {
        const dayStart = now - (i + 1) * bucketMs;
        const dayEnd   = now - i * bucketMs;
        const label    = new Date(dayEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        // Count missions by day
        const mDay = missions.filter(m => {
            const t = new Date(m.createdAt || m.updatedAt).getTime();
            return t >= dayStart && t < dayEnd;
        });

        const dDay = deployments.filter(d => {
            const t = new Date(d.createdAt || d.startedAt || d.timestamp).getTime();
            return t >= dayStart && t < dayEnd;
        });

        // Error trend — if errorAggregator has hourly buckets, sum them
        const eDay = Array.isArray(errorTrend)
            ? errorTrend.filter(e => {
                const t = new Date(e.hour || e.ts || e.timestamp).getTime();
                return t >= dayStart && t < dayEnd;
            }).reduce((s, e) => s + (e.count || e.errors || 0), 0)
            : 0;

        buckets.push({
            label,
            dayStart: new Date(dayStart).toISOString(),
            dayEnd:   new Date(dayEnd).toISOString(),
            missions:     mDay.length,
            deployments:  dDay.length,
            errors:       eDay,
            completedMissions: mDay.filter(m => m.status === "completed").length,
            failedMissions:    mDay.filter(m => m.status === "failed").length,
            failedDeploys:     dDay.filter(d => d.status === "failed" || d.status === "rollback").length,
        });
    }

    return buckets;
}

// ── Recommendation confidence scoring ────────────────────────────────────────
function _scoreRecommendations(recs, missions, lessons) {
    const completedM = missions.filter(m => m.status === "completed").length;
    const totalM     = missions.length;
    const baseSuccess = totalM > 0 ? completedM / totalM : 0.5;

    return recs.slice(0, 20).map(r => {
        // Base confidence from the rec itself
        let conf = r.confidence ?? 60;

        // Boost if similar keyword appears in a positive lesson
        const keyWords = (r.title || r.description || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const lessonBoost = lessons.filter(l => {
            const text = (l.content || l.description || l.insight || "").toLowerCase();
            return keyWords.some(k => text.includes(k));
        }).length;

        conf = Math.min(100, Math.round(conf + lessonBoost * 5 + baseSuccess * 10));

        // Risk from reasoningEngine
        let risk = "low";
        const re = _getRE();
        if (re) {
            try {
                const riskResult = re.analyzeRisk(r, { missionSuccessRate: baseSuccess * 100 });
                risk = riskResult?.level || "low";
            } catch {}
        }

        return {
            id:           r.id || r.recId || null,
            title:        (r.title || "Recommendation").slice(0, 80),
            source:       r.source || "observer",
            priority:     r.priority || "MEDIUM",
            confidence:   conf,
            risk,
            lessonSupport: lessonBoost,
        };
    }).sort((a, b) => b.confidence - a.confidence);
}

// ── Public API ────────────────────────────────────────────────────────────────

function getCorrelations() {
    return _cached("correlations", () => {
        const missions   = _readMissions();
        const clusters   = _readFailureClusters();
        const deployments = _readDeployments();
        const health     = _readRuntimeHealth();
        const recs       = _readRecommendations();
        const lessons    = _readLessons();
        const agents     = _readAgentRuns();
        const successP   = _readSuccessPatterns();
        const memGraph   = _readMemoryGraph();
        const horizons   = _readPlanningHorizons();

        return {
            computed_at: new Date().toISOString(),
            correlations: {
                failures_deployments: _correlateFailuresDeployments(clusters, deployments),
                deployments_health:   _correlateDeploymentsHealth(deployments, health),
                health_missions:      _correlateHealthMissions(health, missions),
                recommendations_success: _correlateRecommendationsSuccess(recs, lessons, missions),
                agent_performance:    _correlateAgentPerformance(agents, successP),
                memory_planning:      _correlateMemoryPlanning(memGraph, horizons),
            },
        };
    });
}

function getInsights() {
    return _cached("insights", () => {
        const correlations = getCorrelations();
        const insights     = [];

        for (const [key, corr] of Object.entries(correlations.correlations || {})) {
            if (!corr || !corr.insight) continue;
            const severity = corr.strength >= 70 ? "high"
                           : corr.strength >= 40 ? "medium" : "low";
            insights.push({
                domain:   key,
                strength: corr.strength || 0,
                label:    corr.label,
                insight:  corr.insight,
                severity,
            });
        }

        insights.sort((a, b) => b.strength - a.strength);

        // Top-level summary
        const avgStrength = insights.length
            ? Math.round(insights.reduce((s, i) => s + i.strength, 0) / insights.length)
            : 0;

        return {
            computed_at: new Date().toISOString(),
            insights,
            summary: {
                totalDomains: insights.length,
                avgCorrelationStrength: avgStrength,
                highPriorityCount: insights.filter(i => i.severity === "high").length,
                topInsight: insights[0]?.insight || null,
            },
        };
    });
}

function getPatterns() {
    return _cached("patterns", () => {
        const clusters  = _readFailureClusters();
        const successP  = _readSuccessPatterns();
        const missions  = _readMissions();

        const patterns  = _detectPatterns(clusters, successP, missions);

        return {
            computed_at: new Date().toISOString(),
            patterns,
            summary: {
                total:           patterns.length,
                failurePatterns: patterns.filter(p => p.type === "failure").length,
                successPatterns: patterns.filter(p => p.type === "success").length,
                missionPatterns: patterns.filter(p => p.type === "mission").length,
            },
        };
    });
}

function getTrends(windowDays = 7) {
    const key = `trends_${windowDays}`;
    return _cached(key, () => {
        const missions    = _readMissions();
        const deployments = _readDeployments();
        const errorTrend  = _readErrorTrend();

        const buckets = _buildTrends(errorTrend, missions, deployments, windowDays);

        return {
            computed_at: new Date().toISOString(),
            windowDays,
            buckets,
            summary: {
                totalBuckets:    buckets.length,
                totalMissions:   buckets.reduce((s, b) => s + b.missions, 0),
                totalDeployments: buckets.reduce((s, b) => s + b.deployments, 0),
                totalErrors:     buckets.reduce((s, b) => s + b.errors, 0),
            },
        };
    });
}

function getRecommendationConfidence() {
    return _cached("rec_confidence", () => {
        const recs     = _readRecommendations();
        const missions = _readMissions();
        const lessons  = _readLessons();

        const scored   = _scoreRecommendations(recs, missions, lessons);
        const avgConf  = scored.length
            ? Math.round(scored.reduce((s, r) => s + r.confidence, 0) / scored.length) : 0;

        return {
            computed_at: new Date().toISOString(),
            recommendations: scored,
            summary: {
                total:           scored.length,
                avgConfidence:   avgConf,
                highConfidence:  scored.filter(r => r.confidence >= 80).length,
                medConfidence:   scored.filter(r => r.confidence >= 50 && r.confidence < 80).length,
                lowConfidence:   scored.filter(r => r.confidence < 50).length,
            },
        };
    });
}

// Invalidate cache (called after significant events)
function invalidateCache() {
    for (const key of Object.keys(_cache)) delete _cache[key];
}

module.exports = {
    getCorrelations,
    getInsights,
    getPatterns,
    getTrends,
    getRecommendationConfidence,
    invalidateCache,
};
