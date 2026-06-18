"use strict";
/**
 * graphReasoningEngine.cjs — Phase Q2: Knowledge Graph Reasoning Engine
 *
 * Transforms the Q1 knowledge graph from a lookup engine into a reasoning
 * engine. All graph traversal delegates to knowledgeGraph.cjs (Q1).
 * No duplicate graph. No new memory. No new storage.
 *
 * Reused systems (unchanged):
 *   knowledgeGraph.cjs          → traverse, findRelated, impactAnalysis, getEdges, getStats, indexAll
 *   missionMemory.cjs           → listMissions, getMission
 *   businessDataService.cjs     → getDashboard, listLeads, listOpportunities
 *   organizationService.cjs     → listOrgs, getMemberRole
 *   unifiedIntelligenceLayer.cjs→ getExecutiveDashboard, correlate
 *   engineeringConfidenceEngine → explain (confidence scoring)
 *   rootCauseAnalysisEngine.cjs → listAnalyses, getStats
 *   engineeringRuleRegistry.cjs → listRules
 *   continuousLearningEngine.cjs→ getLessons, getRecommendations
 *   missionOrchestrator.cjs     → createManual (AutoMissionCandidate creation)
 *   runtimeEventBus.cjs         → emit("reasoning:*")
 *
 * Public API:
 *   Q2-1 Reasoning:
 *     findCriticalDependencies()    → nodes with most inbound edges
 *     findSinglePointsOfFailure()   → nodes whose removal disconnects graph
 *     findBlockedMissions()         → missions awaiting approvals or stuck
 *     findMissionClusters()         → connected components of missions
 *     findHighRiskOwners()          → users with most at-risk workload
 *     findHighRiskOrganizations()   → orgs with highest failure exposure
 *     findKnowledgeGaps()           → missions/teams with no lessons
 *     findDuplicateWork()           → missions with overlapping objectives
 *
 *   Q2-2 Impact Simulation:
 *     simulateImpact(type, id, opts) → affected entities + confidence + revenue
 *
 *   Q2-3 Mission Recommendations:
 *     generateRecommendations(opts)  → ranked AutoMissionCandidates
 *
 *   Q2-4 Dependency Analysis:
 *     analyzeDependencies(type, id)  → chain, critical path, circular detection
 *
 *   Q2-5 Executive Reasoning:
 *     executeReasoning()             → full executive report
 *
 *   getHealthScore()                 → 0-100 composite score
 */

const logger = require("../utils/logger");

// ── Lazy loaders (all pre-existing services) ──────────────────────────────────
function _kg()    { try { return require("./knowledgeGraph.cjs");              } catch { return null; } }
function _mm()    { try { return require("./missionMemory.cjs");               } catch { return null; } }
function _bds()   { try { return require("./businessDataService.cjs");         } catch { return null; } }
function _org()   { try { return require("./organizationService.cjs");         } catch { return null; } }
function _uil()   { try { return require("./unifiedIntelligenceLayer.cjs");    } catch { return null; } }
function _ce()    { try { return require("./engineeringConfidenceEngine.cjs"); } catch { return null; } }
function _rca()   { try { return require("./rootCauseAnalysisEngine.cjs");     } catch { return null; } }
function _reg()   { try { return require("./engineeringRuleRegistry.cjs");     } catch { return null; } }
function _le()    { try { return require("./continuousLearningEngine.cjs");    } catch { return null; } }
function _orch()  { try { return require("./missionOrchestrator.cjs");         } catch { return null; } }
function _bus()   { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _scoreConfidence(label, problemClass) {
    try {
        const r = _ce()?.explain(label, { problemClass });
        return r?.confidence || 60;
    } catch { return 60; }
}

function _readEdgesAll() {
    try { return _kg()?.getEdges({ limit: 5000 }).edges || []; } catch { return []; }
}

// Build in-degree map (toId → count) and out-degree map (fromId → count)
function _degreeMap(edges) {
    const inDeg = {}, outDeg = {};
    for (const e of edges) {
        inDeg[`${e.toType}:${e.toId}`]     = (inDeg[`${e.toType}:${e.toId}`]     || 0) + 1;
        outDeg[`${e.fromType}:${e.fromId}`] = (outDeg[`${e.fromType}:${e.fromId}`] || 0) + 1;
    }
    return { inDeg, outDeg };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2-1 REASONING ALGORITHMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * findCriticalDependencies — nodes with highest in-degree (most depended-on).
 * A node many others point to is a critical dependency: removing it breaks many paths.
 */
function findCriticalDependencies({ limit = 10 } = {}) {
    const edges = _readEdgesAll();
    const { inDeg } = _degreeMap(edges);

    const entries = Object.entries(inDeg)
        .map(([key, count]) => {
            const [type, ...rest] = key.split(":");
            const id = rest.join(":");
            return { type, id, inDegree: count, key };
        })
        .sort((a, b) => b.inDegree - a.inDegree)
        .slice(0, limit);

    return {
        criticalDependencies: entries.map(e => ({
            ...e,
            risk: e.inDegree >= 5 ? "critical" : e.inDegree >= 3 ? "high" : "medium",
            explanation: `${e.inDegree} other nodes depend on this ${e.type}`,
        })),
        total: entries.length,
    };
}

/**
 * findSinglePointsOfFailure — nodes that are the sole connection between two
 * otherwise disconnected subgraphs. Approximated by: nodes that are the only
 * outbound path for their dependents.
 */
function findSinglePointsOfFailure({ limit = 10 } = {}) {
    const edges = _readEdgesAll();
    const { inDeg, outDeg } = _degreeMap(edges);

    // A SPOF is a node where: it has ≥2 nodes depending on it, AND it has
    // exactly 1 outbound connection itself (meaning there's no redundancy).
    const spofs = [];
    for (const [key, indegree] of Object.entries(inDeg)) {
        if (indegree < 2) continue;
        const outdegree = outDeg[key] || 0;
        if (outdegree === 0) continue; // terminal node, not a bridge
        const [type, ...rest] = key.split(":");
        const id = rest.join(":");
        spofs.push({
            type, id, inDegree: indegree, outDegree: outdegree,
            riskScore: Math.round((indegree / (outdegree + 1)) * 20),
            explanation: `${indegree} dependents, only ${outdegree} outbound path(s) — no redundancy`,
        });
    }

    spofs.sort((a, b) => b.riskScore - a.riskScore);
    return { singlePointsOfFailure: spofs.slice(0, limit), total: spofs.length };
}

/**
 * findBlockedMissions — missions in awaiting_approval or stuck (no subtask progress).
 */
function findBlockedMissions({ limit = 20 } = {}) {
    try {
        const all = _mm()?.listMissions({ limit: 1000 }) || { missions: [] };
        const blocked = [];
        for (const m of all.missions) {
            // Check if any approval is pending
            const hasPendingApproval = (m.approvals || []).some(a => a.status === "pending");
            // Check if all subtasks are stuck (none started, none completed, mission active)
            const subtasks = m.subtasks || [];
            const totalSubs = subtasks.length;
            const pendingSubs = subtasks.filter(s => s.status === "pending").length;
            const isStuck = m.status === "active" && totalSubs > 0 && pendingSubs === totalSubs;
            const isLong = m.status === "active" && m.createdAt &&
                (Date.now() - new Date(m.createdAt).getTime()) > 7 * 24 * 3600 * 1000;

            if (hasPendingApproval || isStuck || isLong) {
                blocked.push({
                    missionId:  m.id,
                    objective:  m.objective?.slice(0, 80),
                    status:     m.status,
                    priority:   m.priority,
                    blockers:   [
                        hasPendingApproval ? "pending_approval" : null,
                        isStuck            ? "all_subtasks_stuck" : null,
                        isLong             ? "overdue_7d" : null,
                    ].filter(Boolean),
                    createdAt:  m.createdAt,
                    ownerId:    m.metadata?.ownerId,
                    orgId:      m.metadata?.orgId,
                });
            }
        }
        blocked.sort((a, b) => a.blockers.length > b.blockers.length ? -1 : 1);
        return { blockedMissions: blocked.slice(0, limit), total: blocked.length };
    } catch (e) {
        logger.warn(`[GraphReasoning] findBlockedMissions: ${e.message}`);
        return { blockedMissions: [], total: 0 };
    }
}

/**
 * findMissionClusters — connected components of missions (missions that share
 * team/org/lead/rca connections). Uses edge adjacency via Q1 graph.
 */
function findMissionClusters({ limit = 10 } = {}) {
    const edges = _readEdgesAll();
    const missionEdges = edges.filter(e => e.fromType === "mission" || e.toType === "mission");

    // Build adjacency list of mission→mission (via shared nodes)
    const adj = {}; // missionId → Set of related missionIds
    const sharedNodes = {}; // nodeKey → [missionId]

    for (const e of missionEdges) {
        const mid  = e.fromType === "mission" ? e.fromId : e.toId;
        const nKey = e.fromType === "mission"
            ? `${e.toType}:${e.toId}`
            : `${e.fromType}:${e.fromId}`;
        if (!sharedNodes[nKey]) sharedNodes[nKey] = [];
        sharedNodes[nKey].push(mid);
    }

    // Missions sharing a node form a cluster
    for (const [, mids] of Object.entries(sharedNodes)) {
        if (mids.length < 2) continue;
        for (const a of mids) {
            for (const b of mids) {
                if (a === b) continue;
                if (!adj[a]) adj[a] = new Set();
                adj[a].add(b);
            }
        }
    }

    // BFS to find components
    const visited = new Set();
    const clusters = [];
    for (const mid of Object.keys(adj)) {
        if (visited.has(mid)) continue;
        const component = [];
        const queue = [mid];
        while (queue.length) {
            const cur = queue.shift();
            if (visited.has(cur)) continue;
            visited.add(cur);
            component.push(cur);
            for (const nb of (adj[cur] || [])) {
                if (!visited.has(nb)) queue.push(nb);
            }
        }
        if (component.length > 1) {
            clusters.push({ missions: component, size: component.length });
        }
    }

    clusters.sort((a, b) => b.size - a.size);
    return { clusters: clusters.slice(0, limit), total: clusters.length, isolated: 0 };
}

/**
 * findHighRiskOwners — users who own many active missions and have high failure rate.
 */
function findHighRiskOwners({ limit = 10 } = {}) {
    const edges  = _readEdgesAll();
    const ownsEdges = edges.filter(e => e.relation === "owns" && e.fromType === "mission" && e.toType === "user");
    const ownerMap = {}; // userId → missionIds[]
    for (const e of ownsEdges) {
        if (!ownerMap[e.toId]) ownerMap[e.toId] = [];
        ownerMap[e.toId].push(e.fromId);
    }

    const risky = [];
    for (const [userId, missionIds] of Object.entries(ownerMap)) {
        if (missionIds.length < 2) continue;
        try {
            const missions = missionIds.map(id => _mm()?.getMission(id)).filter(Boolean);
            const active   = missions.filter(m => m.status === "active").length;
            const failed   = missions.filter(m => m.status === "failed" || m.status === "cancelled").length;
            const failRate = missions.length > 0 ? Math.round(failed / missions.length * 100) : 0;
            const riskScore = Math.min(100, active * 10 + failRate);
            if (riskScore >= 20) {
                risky.push({ userId, missionCount: missionIds.length, active, failRate, riskScore,
                    severity: riskScore >= 60 ? "critical" : riskScore >= 30 ? "warning" : "info",
                    explanation: `${active} active missions, ${failRate}% historical failure rate` });
            }
        } catch {}
    }
    risky.sort((a, b) => b.riskScore - a.riskScore);
    return { highRiskOwners: risky.slice(0, limit), total: risky.length };
}

/**
 * findHighRiskOrganizations — orgs with most failed/blocked missions or RCAs.
 */
function findHighRiskOrganizations({ limit = 5 } = {}) {
    const edges     = _readEdgesAll();
    const orgEdges  = edges.filter(e => e.relation === "belongs_to" && e.toType === "org");
    const orgMissions = {}; // orgId → missionIds[]
    for (const e of orgEdges) {
        if (!orgMissions[e.toId]) orgMissions[e.toId] = [];
        orgMissions[e.toId].push(e.fromId);
    }

    const risky = [];
    for (const [orgId, missionIds] of Object.entries(orgMissions)) {
        try {
            const missions = missionIds.map(id => _mm()?.getMission(id)).filter(Boolean);
            const failed   = missions.filter(m => m.status === "failed").length;
            const active   = missions.filter(m => m.status === "active").length;
            const riskScore = Math.min(100, failed * 15 + active * 5);
            risky.push({ orgId, missionCount: missionIds.length, failed, active, riskScore,
                severity: riskScore >= 60 ? "critical" : riskScore >= 30 ? "warning" : "info" });
        } catch {}
    }
    risky.sort((a, b) => b.riskScore - a.riskScore);
    return { highRiskOrgs: risky.slice(0, limit), total: risky.length };
}

/**
 * findKnowledgeGaps — missions that produced no lessons, or teams with no lessons.
 */
function findKnowledgeGaps({ limit = 10 } = {}) {
    const edges = _readEdgesAll();
    const missionIds = [...new Set(edges.filter(e => e.fromType === "mission").map(e => e.fromId))];
    const lessonsEdges = edges.filter(e => e.relation === "learned" && e.fromType === "mission");
    const missionsWithLessons = new Set(lessonsEdges.map(e => e.fromId));

    const gaps = [];
    for (const mid of missionIds) {
        if (missionsWithLessons.has(mid)) continue;
        try {
            const m = _mm()?.getMission(mid);
            if (!m || m.status === "pending") continue;
            const ageDays = Math.floor((Date.now() - new Date(m.createdAt).getTime()) / (24 * 3600 * 1000));
            gaps.push({ missionId: mid, objective: m.objective?.slice(0, 80), status: m.status, ageDays,
                explanation: "Mission completed/active with no linked lessons — knowledge not captured" });
        } catch {}
    }
    gaps.sort((a, b) => b.ageDays - a.ageDays);
    return { knowledgeGaps: gaps.slice(0, limit), total: gaps.length };
}

/**
 * findDuplicateWork — missions with identical or highly similar objectives.
 * Uses simple token overlap (Jaccard similarity) — no new NLP engine.
 */
function findDuplicateWork({ limit = 10, threshold = 0.5 } = {}) {
    try {
        const all = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
        const active = all.missions.filter(m => m.status === "active" || m.status === "pending");

        const tokenise = s => new Set((s || "").toLowerCase().split(/\W+/).filter(t => t.length > 3));
        const jaccard  = (a, b) => {
            const inter = [...a].filter(x => b.has(x)).length;
            const union = new Set([...a, ...b]).size;
            return union === 0 ? 0 : inter / union;
        };

        const duplicates = [];
        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i], b = active[j];
                const sim = jaccard(tokenise(a.objective), tokenise(b.objective));
                if (sim >= threshold) {
                    duplicates.push({ missionA: { id: a.id, objective: a.objective?.slice(0,80) },
                        missionB: { id: b.id, objective: b.objective?.slice(0,80) }, similarity: parseFloat(sim.toFixed(3)),
                        explanation: `${Math.round(sim*100)}% token overlap in objectives` });
                }
            }
        }
        duplicates.sort((a, b) => b.similarity - a.similarity);
        return { duplicateWork: duplicates.slice(0, limit), total: duplicates.length };
    } catch (e) {
        return { duplicateWork: [], total: 0 };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2-2 IMPACT SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * simulateImpact(type, id, opts)
 * "If this RCA is fixed" / "If this rule is removed" / "If this mission fails"
 * Walks the graph downstream, annotates each affected node with its domain impact.
 */
function simulateImpact(type, id, opts = {}) {
    const kg  = _kg();
    if (!kg) return { error: "knowledge graph unavailable" };

    const subgraph = kg.traverse(type, id, { maxDepth: opts.maxDepth || 3, maxNodes: 100, direction: "out" });

    const affected = {
        missions:    [],
        teams:       [],
        customers:   [],
        rules:       [],
        lessons:     [],
        orgs:        [],
        revenue:     0,
    };

    for (const node of subgraph.nodes) {
        if (node.type === type && node.id === id) continue;
        switch (node.type) {
            case "mission":     affected.missions.push({ id: node.id, label: node.data?.label, depth: node.depth }); break;
            case "team":        affected.teams.push({ id: node.id, label: node.data?.label });    break;
            case "org":         affected.orgs.push({ id: node.id, label: node.data?.label });     break;
            case "rule":        affected.rules.push({ id: node.id, label: node.data?.label });    break;
            case "lesson":      affected.lessons.push({ id: node.id, label: node.data?.label }); break;
            case "opportunity": {
                const value = node.data?.value || 0;
                affected.revenue += value;
                affected.customers.push({ id: node.id, label: node.data?.label, value });
                break;
            }
            case "lead": {
                affected.customers.push({ id: node.id, label: node.data?.label, value: 0 });
                break;
            }
        }
    }

    // Confidence via existing confidence engine
    const confidence = _scoreConfidence(`fix_impact:${type}:${id}`, `${type}_resolution`);

    const impactScore = Math.min(100, Math.round(
        affected.missions.length * 10 +
        affected.teams.length * 5 +
        affected.customers.length * 8 +
        (affected.revenue > 0 ? Math.log10(affected.revenue + 1) * 5 : 0)
    ));

    // Emit on event bus for SSE subscribers
    try { _bus()?.emit("reasoning:impact_simulated", { type, id, impactScore, confidence }); } catch {}

    return {
        type, id,
        scenario:         opts.scenario || `If this ${type} is resolved`,
        affected,
        affectedCount:    subgraph.nodes.length - 1,
        impactScore,
        confidence,
        severity:         impactScore >= 60 ? "critical" : impactScore >= 30 ? "warning" : "info",
        revenueAtRisk:    affected.revenue,
        graphDepth:       subgraph.nodes.length > 0 ? Math.max(...subgraph.nodes.map(n => n.depth)) : 0,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2-3 MISSION RECOMMENDATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateRecommendations(opts)
 * Fuses: knowledge graph signals + business intelligence + engineering signals + unified intelligence.
 * Returns ranked AutoMissionCandidates.
 */
function generateRecommendations({ limit = 10, autoCreate = false } = {}) {
    const candidates = [];

    // Source 1: Unified intelligence cross-domain events
    try {
        const uil  = _uil();
        if (uil) {
            const { crossDomainEvents } = uil.correlate();
            for (const ev of crossDomainEvents) {
                if (!ev.missionTrigger) continue;
                const conf = _scoreConfidence(ev.description, ev.type);
                candidates.push({
                    id:           `rec_xdr_${ev.ruleId}`,
                    source:       "unified_intelligence",
                    title:        ev.ruleName,
                    description:  ev.recommendation,
                    priority:     ev.severity === "critical" ? "critical" : ev.severity === "warning" ? "high" : "medium",
                    confidence:   conf,
                    expectedROI:  ev.impact?.pipelineAtRisk || ev.impact?.dealCount * 1000 || 0,
                    expectedRisk: ev.severity === "critical" ? "high" : "medium",
                    dependencies: [],
                    autoMissionCandidate: {
                        objective: ev.recommendation,
                        priority:  ev.severity === "critical" ? "critical" : "high",
                        metadata:  { domain: "cross", ruleId: ev.ruleId, crossEvent: ev.type, autoCreated: true },
                    },
                });
            }
        }
    } catch {}

    // Source 2: Blocked missions → recommend unblocking missions
    try {
        const { blockedMissions } = findBlockedMissions({ limit: 5 });
        for (const bm of blockedMissions) {
            candidates.push({
                id:           `rec_unblock_${bm.missionId}`,
                source:       "graph_reasoning",
                title:        `Unblock: ${bm.objective}`,
                description:  `Mission blocked by: ${bm.blockers.join(", ")}`,
                priority:     bm.priority || "high",
                confidence:   75,
                expectedROI:  0,
                expectedRisk: "low",
                dependencies: [bm.missionId],
                autoMissionCandidate: {
                    objective: `Resolve blockers for mission: ${bm.objective}`,
                    priority:  "high",
                    metadata:  { domain: "ops", blockedMissionId: bm.missionId },
                },
            });
        }
    } catch {}

    // Source 3: Knowledge gaps → recommend knowledge capture missions
    try {
        const { knowledgeGaps } = findKnowledgeGaps({ limit: 3 });
        for (const gap of knowledgeGaps) {
            candidates.push({
                id:           `rec_knowledge_${gap.missionId}`,
                source:       "graph_reasoning",
                title:        `Capture learnings: ${gap.objective}`,
                description:  gap.explanation,
                priority:     "low",
                confidence:   65,
                expectedROI:  500,
                expectedRisk: "low",
                dependencies: [gap.missionId],
                autoMissionCandidate: {
                    objective: `Document and capture lessons from: ${gap.objective}`,
                    priority:  "low",
                    metadata:  { domain: "knowledge", sourceMissionId: gap.missionId },
                },
            });
        }
    } catch {}

    // Source 4: Continuous learning open recommendations
    try {
        const le   = _le();
        const recs = le?.getRecommendations({ status: "open", limit: 5 });
        for (const r of recs?.recommendations || []) {
            candidates.push({
                id:           `rec_le_${r.recId || r.id}`,
                source:       "continuous_learning",
                title:        r.title,
                description:  r.detail || r.description,
                priority:     r.priority === 1 ? "critical" : r.priority === 2 ? "high" : "medium",
                confidence:   r.confidence || 60,
                expectedROI:  0,
                expectedRisk: "medium",
                dependencies: [],
                autoMissionCandidate: null,
            });
        }
    } catch {}

    // Deduplicate by title prefix, rank by priority then confidence
    const seen = new Set();
    const unique = candidates.filter(c => {
        const key = (c.title || "").slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    unique.sort((a, b) =>
        (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3) ||
        (b.confidence || 0) - (a.confidence || 0)
    );

    const top = unique.slice(0, limit);

    // Auto-create missions if requested
    const created = [];
    if (autoCreate) {
        for (const c of top.filter(r => r.autoMissionCandidate && r.priority !== "low")) {
            try {
                const mission = _orch()?.createManual({
                    objective:  c.autoMissionCandidate.objective,
                    priority:   c.autoMissionCandidate.priority,
                    subtasks:   [{ description: c.description }, { description: "Verify completion and record lesson" }],
                    metadata:   { ...c.autoMissionCandidate.metadata, recommendationId: c.id, autoCreated: true },
                });
                if (mission) { c.createdMissionId = mission.missionId || mission.id; created.push(c.id); }
            } catch {}
        }
    }

    return { recommendations: top, total: unique.length, autoCreated: created.length, createdIds: created };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2-4 DEPENDENCY ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * analyzeDependencies(type, id)
 * Returns dependency chain, critical path, and circular dependency detection.
 */
function analyzeDependencies(type, id) {
    const kg = _kg();
    if (!kg) return { error: "knowledge graph unavailable" };

    // Full downstream chain
    const downstream = kg.traverse(type, id, { maxDepth: 5, maxNodes: 100, direction: "out" });

    // Full upstream chain (what does this depend on)
    const upstream   = kg.traverse(type, id, { maxDepth: 5, maxNodes: 100, direction: "in" });

    // Critical path — longest path from root to any leaf (BFS max depth per node)
    const depthMap = {};
    for (const node of downstream.nodes) depthMap[`${node.type}:${node.id}`] = node.depth;
    const maxPathDepth = Math.max(0, ...Object.values(depthMap));

    // Circular dependency detection — a node appears in both upstream and downstream
    const downIds = new Set(downstream.nodes.map(n => `${n.type}:${n.id}`));
    const upIds   = new Set(upstream.nodes.map(n => `${n.type}:${n.id}`));
    const selfKey = `${type}:${id}`;
    const circular = [...downIds].filter(k => upIds.has(k) && k !== selfKey);

    // Bottleneck nodes — nodes that appear on many paths (high in-degree in subgraph)
    const subEdges  = downstream.edges;
    const localInDeg = {};
    for (const e of subEdges) {
        const k = `${e.toType}:${e.toId}`;
        localInDeg[k] = (localInDeg[k] || 0) + 1;
    }
    const bottlenecks = Object.entries(localInDeg)
        .filter(([, c]) => c >= 2)
        .map(([key, count]) => { const [t, ...r] = key.split(":"); return { type: t, id: r.join(":"), pathCount: count }; })
        .sort((a, b) => b.pathCount - a.pathCount)
        .slice(0, 5);

    return {
        type, id,
        dependencyChain:  downstream.nodes.map(n => ({ type: n.type, id: n.id, depth: n.depth, data: n.data })),
        upstreamNodes:    upstream.nodes.map(n => ({ type: n.type, id: n.id, depth: n.depth })),
        criticalPath:     { depth: maxPathDepth, description: `Longest dependency chain: ${maxPathDepth} hops` },
        circularDeps:     circular.map(key => { const [t, ...r] = key.split(":"); return { type: t, id: r.join(":") }; }),
        hasCircularDeps:  circular.length > 0,
        bottlenecks,
        stats: {
            downstreamNodes: downstream.nodes.length,
            upstreamNodes:   upstream.nodes.length,
            totalEdges:      downstream.edges.length + upstream.edges.length,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2-5 EXECUTIVE REASONING
// ─────────────────────────────────────────────────────────────────────────────

function getHealthScore() {
    try {
        const uil = _uil();
        if (uil) return uil.getExecutiveDashboard().systemHealthScore;
    } catch {}
    // Fallback from graph stats
    const stats = _kg()?.getStats() || {};
    const score = Math.max(0, 100 - (stats.totalEdges > 200 ? 0 : 20));
    return score;
}

/**
 * executeReasoning() — full executive reasoning report.
 * Synthesizes all Q2 algorithms + existing unified intelligence.
 */
function executeReasoning() {
    const startedAt = new Date().toISOString();

    const results = {};
    const _safe = (fn, key) => { try { results[key] = fn(); } catch (e) { results[key] = { error: e.message }; } };

    _safe(() => findCriticalDependencies({ limit: 5 }),            "criticalDependencies");
    _safe(() => findSinglePointsOfFailure({ limit: 5 }),           "singlePointsOfFailure");
    _safe(() => findBlockedMissions({ limit: 5 }),                 "blockedMissions");
    _safe(() => findMissionClusters({ limit: 5 }),                 "missionClusters");
    _safe(() => findHighRiskOwners({ limit: 5 }),                  "highRiskOwners");
    _safe(() => findHighRiskOrganizations({ limit: 3 }),           "highRiskOrgs");
    _safe(() => findKnowledgeGaps({ limit: 5 }),                   "knowledgeGaps");
    _safe(() => findDuplicateWork({ limit: 5 }),                   "duplicateWork");
    _safe(() => generateRecommendations({ limit: 8 }),             "recommendations");

    // Pull executive dashboard from unified intelligence
    let executiveDashboard = null;
    try { executiveDashboard = _uil()?.getExecutiveDashboard(); } catch {}

    const healthScore = getHealthScore();

    // Top risks = critical deps + SPOFs + blocked missions
    const topRisks = [
        ...(results.criticalDependencies?.criticalDependencies || []).filter(d => d.risk === "critical").slice(0,2).map(d => ({ type: "critical_dependency", ...d })),
        ...(results.singlePointsOfFailure?.singlePointsOfFailure || []).slice(0,2).map(s => ({ type: "single_point_of_failure", ...s })),
        ...(results.blockedMissions?.blockedMissions || []).slice(0,2).map(b => ({ type: "blocked_mission", ...b })),
    ].slice(0, 5);

    // Top opportunities = high-priority recommendations
    const topOpportunities = (results.recommendations?.recommendations || []).filter(r => r.priority === "critical" || r.priority === "high").slice(0, 5);

    // Top bottlenecks = SPOFs + high risk owners
    const topBottlenecks = [
        ...(results.singlePointsOfFailure?.singlePointsOfFailure || []).slice(0,3).map(s => ({ source: "graph_spof", ...s })),
        ...(results.highRiskOwners?.highRiskOwners || []).slice(0,2).map(o => ({ source: "owner_overload", ...o })),
    ].slice(0, 5);

    // Top knowledge gaps
    const topKnowledgeGaps = (results.knowledgeGaps?.knowledgeGaps || []).slice(0, 5);

    // Top blockers = blocked missions
    const topBlockers = (results.blockedMissions?.blockedMissions || []).slice(0, 5);

    // Recommended missions
    const topRecommendedMissions = (results.recommendations?.recommendations || []).filter(r => r.autoMissionCandidate).slice(0, 5);

    // Reasoning summary
    const issues = [
        topRisks.length > 0 ? `${topRisks.length} critical risk(s) detected` : null,
        results.blockedMissions?.total > 0 ? `${results.blockedMissions.total} mission(s) blocked` : null,
        results.knowledgeGaps?.total > 0 ? `${results.knowledgeGaps.total} knowledge gap(s) identified` : null,
        results.duplicateWork?.total > 0 ? `${results.duplicateWork.total} potential duplicate work item(s)` : null,
    ].filter(Boolean);

    const summary = issues.length > 0
        ? `System health: ${healthScore}/100. Key issues: ${issues.join("; ")}.`
        : `System health: ${healthScore}/100. No critical issues detected.`;

    const completedAt = new Date().toISOString();
    try { _bus()?.emit("reasoning:executive_computed", { healthScore, topRisks: topRisks.length, summary }); } catch {}

    return {
        startedAt,
        completedAt,
        healthScore,
        topRisks,
        topOpportunities,
        topBottlenecks,
        topKnowledgeGaps,
        topBlockers,
        topRecommendedMissions,
        summary,
        executiveDashboard,
        detail: results,
    };
}

module.exports = {
    // Q2-1 Reasoning
    findCriticalDependencies,
    findSinglePointsOfFailure,
    findBlockedMissions,
    findMissionClusters,
    findHighRiskOwners,
    findHighRiskOrganizations,
    findKnowledgeGaps,
    findDuplicateWork,
    // Q2-2 Impact simulation
    simulateImpact,
    // Q2-3 Recommendations
    generateRecommendations,
    // Q2-4 Dependencies
    analyzeDependencies,
    // Q2-5 Executive reasoning
    executeReasoning,
    getHealthScore,
};
