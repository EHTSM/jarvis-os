"use strict";
/**
 * Engineering Decision Engine — ACP-4
 *
 * Transforms raw smell arrays from engineeringSmellDetector into ranked
 * Engineering Opportunities with full scoring:
 *   ROI, engineering debt, business impact, user impact, regression risk,
 *   estimated hours, suggested owner, dependencies, mission link.
 *
 * Clustering: smells in the same file or of the same type within N lines
 * are merged into a single Opportunity so the operator sees decisions,
 * not noise.
 *
 * Reuses: engineeringSmellDetector, knowledgeGraph, engineeringRuleRegistry,
 *         rootCauseAnalysisEngine, unifiedIntelligenceLayer, missionMemory.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data");

// ── Lazy service accessors ────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }
function _smellDetector()  { return _try(() => require("./engineeringSmellDetector.cjs")); }
function _ruleRegistry()   { return _try(() => require("./engineeringRuleRegistry.cjs")); }
function _rca()            { return _try(() => require("./rootCauseAnalysisEngine.cjs")); }
function _unified()        { return _try(() => require("./unifiedIntelligenceLayer.cjs")); }
function _kg()             { return _try(() => require("./knowledgeGraph.cjs")); }
function _mm()             { return _try(() => require("./missionMemory.cjs")); }

// ── Persistence ───────────────────────────────────────────────────────────────

const DECISIONS_FILE = path.join(DATA_DIR, "acp4-decisions.json");
const DEBT_HISTORY_FILE = path.join(DATA_DIR, "acp4-debt-history.json");

function _load(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}
function _save(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Smell type metadata: base weights ────────────────────────────────────────

const SMELL_WEIGHTS = {
    blocking_crypto:    { debt: 35, userImpact: 40, regression: 20, hours: 2  },
    sync_fs:            { debt: 25, userImpact: 30, regression: 15, hours: 1  },
    empty_catch:        { debt: 20, userImpact: 25, regression: 30, hours: 0.5},
    long_function:      { debt: 20, userImpact: 10, regression: 25, hours: 3  },
    build_failure:      { debt: 40, userImpact: 50, regression: 40, hours: 4  },
    stale_mission:      { debt: 30, userImpact: 15, regression: 10, hours: 1  },
    benchmark_decline:  { debt: 20, userImpact: 35, regression: 20, hours: 6  },
    console_log_prod:   { debt: 10, userImpact:  5, regression:  5, hours: 0.3},
    todo_fixme:         { debt: 15, userImpact:  5, regression: 10, hours: 1  },
    duplicate_literal:  { debt: 10, userImpact:  5, regression:  8, hours: 0.5},
    stale_feature_flag: { debt: 15, userImpact: 10, regression: 15, hours: 1  },
    dead_export:        { debt: 10, userImpact:  0, regression:  5, hours: 0.5},
};

const DEFAULT_W = { debt: 10, userImpact: 5, regression: 5, hours: 1 };

// ── Owner heuristics ──────────────────────────────────────────────────────────

const OWNER_HINTS = {
    blocking_crypto:  "Security / Backend",
    sync_fs:          "Backend / Platform",
    empty_catch:      "Backend",
    long_function:    "Engineering Lead",
    build_failure:    "DevOps / CI",
    stale_mission:    "Mission Owner / PM",
    benchmark_decline:"Performance Team",
    console_log_prod: "Backend",
    todo_fixme:       "Assignee in comment",
    duplicate_literal:"Any engineer",
    stale_feature_flag:"Product / Feature Team",
};

// ── Clustering ────────────────────────────────────────────────────────────────

/**
 * Group smells into clusters.
 * Strategy: same file → merge into one cluster.
 *           no file (runtime smells) → group by type.
 */
function _cluster(smells) {
    const byFile  = {};
    const runtime = {};

    for (const s of smells) {
        if (s.file) {
            if (!byFile[s.file]) byFile[s.file] = [];
            byFile[s.file].push(s);
        } else {
            if (!runtime[s.type]) runtime[s.type] = [];
            runtime[s.type].push(s);
        }
    }

    const clusters = [];

    for (const [file, members] of Object.entries(byFile)) {
        // Within the file, sub-group by dominant type
        const typeGroups = {};
        for (const m of members) {
            if (!typeGroups[m.type]) typeGroups[m.type] = [];
            typeGroups[m.type].push(m);
        }
        for (const [type, group] of Object.entries(typeGroups)) {
            clusters.push({
                id:       crypto.createHash("sha1").update(`${file}:${type}`).digest("hex").slice(0, 12),
                type,
                file,
                members:  group,
                isRuntime: false,
            });
        }
    }

    for (const [type, group] of Object.entries(runtime)) {
        clusters.push({
            id:       crypto.createHash("sha1").update(`runtime:${type}`).digest("hex").slice(0, 12),
            type,
            file:     null,
            members:  group,
            isRuntime: true,
        });
    }

    return clusters;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _scoreSeverity(severity) {
    return severity === "high" ? 1.5 : severity === "medium" ? 1.0 : 0.6;
}

function _avgConfidence(members) {
    if (!members.length) return 0;
    return members.reduce((a, m) => a + (m.confidence || 0), 0) / members.length;
}

/**
 * Pull business context from unifiedIntelligenceLayer if available.
 * Returns { businessHealth, openDealValue, activeUsers }
 */
function _bizContext() {
    try {
        const ui = _unified();
        if (!ui) return {};
        const dash = ui.getExecutiveDashboard?.();
        if (!dash) return {};
        const biz   = dash.business || {};
        const eng   = dash.engineering || {};
        return {
            businessHealth: biz.health?.healthScore ?? 80,
            openDealValue:  (biz.deals || []).filter(d => !["closed-won","closed-lost"].includes(d.stage))
                                              .reduce((s, d) => s + (d.value || 0), 0),
            failureRate:    eng.failureRate || 0,
        };
    } catch { return {}; }
}

/**
 * Pull matching RCA playbooks for this smell type.
 */
function _rcaContext(type) {
    try {
        const rca = _rca();
        if (!rca) return [];
        const analyses = rca.listAnalyses?.({ limit: 50 })?.analyses || [];
        return analyses
            .filter(a => (a.category || "").toLowerCase().includes(type.replace(/_/g, " ").toLowerCase()))
            .slice(0, 2)
            .map(a => ({ id: a.id, title: a.rootCause, confidence: a.confidence }));
    } catch { return []; }
}

/**
 * Find existing mission linked to this type/file.
 */
function _linkedMission(type, file) {
    try {
        const mm = _mm();
        if (!mm) return null;
        const { missions } = mm.listMissions({ limit: 30 });
        const keyword = type.replace(/_/g, " ");
        const match = missions.find(m =>
            (m.objective || "").toLowerCase().includes(keyword) ||
            (m.metadata?.smellType === type) ||
            (file && (m.metadata?.affectedFiles || []).includes(file))
        );
        return match ? { id: match.id, objective: match.objective, status: match.status } : null;
    } catch { return null; }
}

/**
 * Check knowledge graph for file dependencies.
 */
function _kgDependencies(file) {
    try {
        const kg = _kg();
        if (!kg || !file) return [];
        const related = kg.findRelated?.({ node: `file:${file}`, depth: 1 });
        if (!related) return [];
        return (related.nodes || []).slice(0, 5).map(n => n.id || n);
    } catch { return []; }
}

/**
 * Score a single cluster and return a full Opportunity object.
 */
function _scoreCluster(cluster, bizCtx) {
    const w       = SMELL_WEIGHTS[cluster.type] || DEFAULT_W;
    const members = cluster.members;
    const count   = members.length;
    const sevMul  = _scoreSeverity(members[0]?.severity || "low");
    const conf    = _avgConfidence(members);
    const countBoost = Math.min(2.0, 1 + (count - 1) * 0.15);

    // Engineering debt score (0–100)
    const debtScore = Math.min(100, Math.round(w.debt * sevMul * countBoost));

    // User impact score (0–100) — boosted by business health deficit and open deals
    const bizPenalty = bizCtx.openDealValue ? Math.min(20, Math.log10(bizCtx.openDealValue + 1) * 2) : 0;
    const healthMul  = bizCtx.businessHealth ? (100 - bizCtx.businessHealth) / 100 + 0.5 : 1;
    const userImpact = Math.min(100, Math.round(w.userImpact * sevMul * healthMul + bizPenalty));

    // Regression risk (0–100)
    const failBoost  = Math.min(30, (bizCtx.failureRate || 0) * 0.5);
    const regression = Math.min(100, Math.round(w.regression * sevMul + failBoost));

    // Estimated hours
    const estHours   = Math.round(w.hours * count * 10) / 10;

    // ROI: (debtScore + userImpact) / (estHours + 0.5) — capped, normalized 0–100
    const rawROI  = (debtScore + userImpact) / (estHours + 0.5);
    const roiScore = Math.min(100, Math.round(rawROI * 2));

    // Business impact label
    const bizImpact = userImpact >= 60 ? "high"
                    : userImpact >= 30 ? "medium" : "low";

    // Priority: weight ROI + debt + regression, boost by confidence
    const rawPri = (roiScore * 0.4 + debtScore * 0.3 + regression * 0.3) * conf;
    const priority = Math.min(100, Math.round(rawPri));

    // Affected users estimate (heuristic based on type)
    const affectedUsers = cluster.type === "blocking_crypto"  ? "all concurrent"
                        : cluster.type === "benchmark_decline" ? "all"
                        : cluster.type === "build_failure"     ? "all (deploy blocked)"
                        : cluster.type === "empty_catch"       ? "some (silent failures)"
                        : "indirect";

    const rcaLinks = _rcaContext(cluster.type);
    const mission  = _linkedMission(cluster.type, cluster.file);
    const deps     = _kgDependencies(cluster.file);

    return {
        id:              cluster.id,
        type:            cluster.type,
        file:            cluster.file,
        isRuntime:       cluster.isRuntime,
        smellCount:      count,
        smells:          members.map(m => ({
            id: m.id, detail: m.detail, line: m.line,
            severity: m.severity, confidence: m.confidence,
            patchHint: m.patchHint, aiPatchSpec: m.aiPatchSpec || null,
        })),

        // Scoring
        priority,
        roiScore,
        debtScore,
        userImpact,
        affectedUsers,
        regressionRisk:   regression,
        estimatedHours:   estHours,
        confidence:       Math.round(conf * 100),
        businessImpact:   bizImpact,

        // Context
        suggestedOwner:  OWNER_HINTS[cluster.type] || "Engineering",
        dependencies:    deps,
        rcaLinks,
        missionLink:     mission,

        // Actions
        status: "open",   // open | approved | scheduled | ignored | merged
        createdAt: new Date().toISOString(),
    };
}

// ── Public: rank ──────────────────────────────────────────────────────────────

/**
 * computeOpportunities(repoPath, opts)
 * Returns { opportunities[], summary, debtMetrics, scannedFiles }
 * Caches result in acp4-decisions.json and records debt snapshot.
 */
function computeOpportunities(repoPath, opts = {}) {
    const root = repoPath || path.join(__dirname, "../../");
    const sd = _smellDetector();
    if (!sd) throw new Error("engineeringSmellDetector unavailable");

    const scanResult = sd.scan(root);
    const { smells, scannedFiles } = scanResult;

    const bizCtx = _bizContext();
    const clusters = _cluster(smells);

    const opportunities = clusters
        .map(c => _scoreCluster(c, bizCtx))
        .sort((a, b) => b.priority - a.priority || b.roiScore - a.roiScore);

    // Debt metrics
    const totalDebt       = opportunities.reduce((s, o) => s + o.debtScore, 0);
    const avgDebt         = opportunities.length ? Math.round(totalDebt / opportunities.length) : 0;
    const totalHours      = Math.round(opportunities.reduce((s, o) => s + o.estimatedHours, 0) * 10) / 10;
    const avgConfidence   = opportunities.length
        ? Math.round(opportunities.reduce((s, o) => s + o.confidence, 0) / opportunities.length)
        : 0;
    const criticalCount   = opportunities.filter(o => o.debtScore >= 60).length;
    const highROICount    = opportunities.filter(o => o.roiScore >= 70).length;
    const prodRisk        = opportunities.filter(o => o.regressionRisk >= 50).length > 0 ? "high"
                          : opportunities.filter(o => o.regressionRisk >= 30).length > 0 ? "medium" : "low";

    const debtMetrics = {
        totalOpportunities: opportunities.length,
        criticalCount,
        highROICount,
        avgDebt,
        avgConfidence,
        totalHours,
        productionRisk: prodRisk,
        hoursToGreen:   totalHours,
        smellCount:     smells.length,
        scannedFiles,
        computedAt:     new Date().toISOString(),
    };

    const summary = {
        top5: opportunities.slice(0, 5).map(o => ({
            id: o.id, type: o.type, file: o.file,
            priority: o.priority, roiScore: o.roiScore, estimatedHours: o.estimatedHours,
        })),
        debtMetrics,
        bizContext: {
            businessHealth: bizCtx.businessHealth,
            openDealValue:  bizCtx.openDealValue,
            failureRate:    bizCtx.failureRate,
        },
    };

    // Persist
    const existing  = _load(DECISIONS_FILE, { opportunities: [], lastRun: null });
    // Preserve status overrides from previous run
    const statusMap = {};
    for (const o of (existing.opportunities || [])) statusMap[o.id] = o.status;
    for (const o of opportunities) {
        if (statusMap[o.id] && statusMap[o.id] !== "open") o.status = statusMap[o.id];
    }
    _save(DECISIONS_FILE, { opportunities, summary, lastRun: new Date().toISOString() });

    // Append debt history snapshot
    _appendDebtSnapshot(debtMetrics);

    return { opportunities, summary, debtMetrics, scannedFiles };
}

function _appendDebtSnapshot(metrics) {
    try {
        const hist  = _load(DEBT_HISTORY_FILE, { snapshots: [] });
        const snaps = hist.snapshots || [];
        snaps.push({
            ts:              metrics.computedAt,
            totalHours:      metrics.totalHours,
            smellCount:      metrics.smellCount,
            criticalCount:   metrics.criticalCount,
            avgDebt:         metrics.avgDebt,
            avgConfidence:   metrics.avgConfidence,
            productionRisk:  metrics.productionRisk,
        });
        // Keep last 90 snapshots
        if (snaps.length > 90) snaps.splice(0, snaps.length - 90);
        _save(DEBT_HISTORY_FILE, { snapshots: snaps });
    } catch {}
}

// ── Public: load cached ───────────────────────────────────────────────────────

function loadOpportunities() {
    const data = _load(DECISIONS_FILE, null);
    if (!data) return null;
    return data;
}

// ── Public: actions ───────────────────────────────────────────────────────────

function _mutate(id, updater) {
    const data = _load(DECISIONS_FILE, { opportunities: [] });
    const opp  = (data.opportunities || []).find(o => o.id === id);
    if (!opp) throw new Error(`opportunity ${id} not found`);
    updater(opp);
    _save(DECISIONS_FILE, data);
    return opp;
}

function approve(id) {
    return _mutate(id, o => { o.status = "approved"; o.approvedAt = new Date().toISOString(); });
}

function scheduleLater(id, when) {
    return _mutate(id, o => { o.status = "scheduled"; o.scheduledFor = when || null; o.scheduledAt = new Date().toISOString(); });
}

function ignore(id) {
    return _mutate(id, o => { o.status = "ignored"; o.ignoredAt = new Date().toISOString(); });
}

/**
 * Merge multiple opportunity IDs into one.
 * Keeps the first as primary, removes the rest.
 */
function mergeOpportunities(ids) {
    if (!ids || ids.length < 2) throw new Error("need at least 2 ids to merge");
    const data = _load(DECISIONS_FILE, { opportunities: [] });
    const opps = data.opportunities || [];
    const targets = ids.map(id => opps.find(o => o.id === id)).filter(Boolean);
    if (targets.length < 2) throw new Error("one or more ids not found");

    const primary = targets[0];
    const rest    = targets.slice(1);

    // Merge smells
    for (const r of rest) {
        primary.smells.push(...r.smells);
        primary.smellCount += r.smellCount;
        primary.estimatedHours = Math.round((primary.estimatedHours + r.estimatedHours) * 10) / 10;
    }
    primary.status   = "merged";
    primary.mergedIds = ids.slice(1);
    primary.mergedAt  = new Date().toISOString();

    // Remove merged ones
    const merged = new Set(ids.slice(1));
    data.opportunities = opps.filter(o => !merged.has(o.id));
    _save(DECISIONS_FILE, data);
    return primary;
}

/**
 * Convert opportunity → Mission via missionMemory.
 */
function convertToMission(id) {
    const data = _load(DECISIONS_FILE, { opportunities: [] });
    const opp  = (data.opportunities || []).find(o => o.id === id);
    if (!opp) throw new Error(`opportunity ${id} not found`);

    const mm = _mm();
    if (!mm) throw new Error("missionMemory unavailable");

    const priority = opp.priority >= 70 ? "critical"
                   : opp.priority >= 50 ? "high"
                   : opp.priority >= 30 ? "medium" : "low";

    const subtasks = [
        { description: `Investigate: ${opp.type} in ${opp.file || "runtime"}` },
        ...opp.smells.slice(0, 5).map(s => ({ description: `Fix: ${s.detail.slice(0, 80)}` })),
        { description: `Test: validate fix does not introduce regressions` },
        { description: `Commit: through Engineering Pipeline (I7)` },
    ];

    const mission = mm.createMission({
        objective: `[ACP-4] Fix ${opp.smellCount} ${opp.type.replace(/_/g, " ")} smell(s)${opp.file ? ` in ${opp.file}` : ""}`,
        priority,
        subtasks,
        metadata: {
            source:         "acp4-decision-engine",
            opportunityId:  opp.id,
            smellType:      opp.type,
            affectedFiles:  opp.file ? [opp.file] : [],
            roiScore:       opp.roiScore,
            debtScore:      opp.debtScore,
            estimatedHours: opp.estimatedHours,
        },
    });

    // Link mission back to opportunity
    _mutate(id, o => { o.missionLink = { id: mission.id, objective: mission.objective, status: "in_progress" }; });
    return mission;
}

// ── Public: approve top N ─────────────────────────────────────────────────────

function approveTop(n = 5) {
    const data = _load(DECISIONS_FILE, { opportunities: [] });
    const open = (data.opportunities || []).filter(o => o.status === "open");
    const top  = open.slice(0, n);
    const approved = top.map(o => approve(o.id));
    return { approved: approved.map(o => ({ id: o.id, type: o.type, priority: o.priority })) };
}

// ── Public: debt history ──────────────────────────────────────────────────────

function getDebtHistory(limit = 30) {
    const hist  = _load(DEBT_HISTORY_FILE, { snapshots: [] });
    const snaps = (hist.snapshots || []).slice(-limit);
    return { snapshots: snaps };
}

// ── Metrics for dashboard ─────────────────────────────────────────────────────

function getDashboardMetrics() {
    const data = loadOpportunities();
    if (!data) return null;

    const opps   = data.opportunities || [];
    const hist   = getDebtHistory(30);
    const snaps  = hist.snapshots;

    const byStatus  = opps.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {});
    const byType    = opps.reduce((acc, o) => { acc[o.type] = (acc[o.type] || 0) + 1; return acc; }, {});
    const approved  = opps.filter(o => o.status === "approved");
    const top10     = opps.slice(0, 10);

    // Trend: last 2 snapshots
    let trend = "stable";
    if (snaps.length >= 2) {
        const last  = snaps[snaps.length - 1].smellCount || 0;
        const prev  = snaps[snaps.length - 2].smellCount || 0;
        trend = last < prev ? "improving" : last > prev ? "worsening" : "stable";
    }

    const dm = data.summary?.debtMetrics || {};

    return {
        summary: {
            total:           opps.length,
            open:            byStatus.open || 0,
            approved:        byStatus.approved || 0,
            scheduled:       byStatus.scheduled || 0,
            ignored:         byStatus.ignored || 0,
            merged:          byStatus.merged || 0,
            criticalCount:   dm.criticalCount || 0,
            avgDebt:         dm.avgDebt || 0,
            avgConfidence:   dm.avgConfidence || 0,
            totalHours:      dm.totalHours || 0,
            hoursToGreen:    dm.hoursToGreen || 0,
            productionRisk:  dm.productionRisk || "low",
            trend,
            lastRun:         data.lastRun,
        },
        byType,
        byStatus,
        top10,
        approved,
        debtHistory: snaps,
    };
}

module.exports = {
    computeOpportunities,
    loadOpportunities,
    getDashboardMetrics,
    getDebtHistory,
    approve,
    scheduleLater,
    ignore,
    mergeOpportunities,
    convertToMission,
    approveTop,
};
