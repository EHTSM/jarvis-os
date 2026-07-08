"use strict";
/**
 * knowledgeGraph.cjs — Phase Q1: Unified Knowledge Graph
 *
 * A logical relationship graph across all Ooplix domains.
 * NO new memory. NO new storage for node data.
 * ALL nodes reference existing IDs in existing stores.
 *
 * Storage model:
 *   data/knowledge-graph-edges.json  — edge index only (typed relationships)
 *   All node data stays in its canonical store.
 *
 * Node types:
 *   mission       → missionMemory.cjs           (id: msn_*)
 *   user          → data/local-accounts.json     (id: accountId)
 *   team          → organizationService (teamId: team_*)
 *   org           → organizationService (orgId: org_*)
 *   department    → organizationService (deptId: dept_*)
 *   lead          → businessDataService (id: lead_*)
 *   opportunity   → businessDataService (id: opp_*)
 *   campaign      → businessDataService (id: camp_*)
 *   lesson        → continuousLearningEngine (id: les_*)
 *   rca           → rootCauseAnalysisEngine (rcaId: rca_*)
 *   rule          → engineeringRuleRegistry (id: rule_*)
 *   artifact      → mission.artifacts[].id
 *   deployment    → data/deploy_meta.json (id: deploy_*)
 *   event         → businessEventAdapter (id: bevt_*)
 *   step          → hybridWorkforceService (stepId: step_*)
 *
 * Edge schema:
 *   { edgeId, fromType, fromId, toType, toId, relation, weight, createdAt, metadata }
 *
 * Core relations:
 *   mission  →[owns]→      user (ownerId)
 *   mission  →[belongs_to]→ org
 *   mission  →[assigned_to]→ team
 *   mission  →[references]→ lead / opportunity
 *   mission  →[produced]→  artifact
 *   mission  →[triggered_by]→ rca
 *   mission  →[governed_by]→ rule
 *   mission  →[learned]→   lesson
 *   rca      →[linked_to]→ rule
 *   rca      →[affected]→  mission
 *   lead     →[belongs_to]→ org
 *   lead     →[converted_to]→ opportunity
 *   opportunity →[owned_by]→ user
 *   user     →[member_of]→ team
 *   team     →[part_of]→  department
 *   department →[part_of]→ org
 *   event    →[created]→  lead / opportunity
 *   lesson   →[derived_from]→ mission
 *
 * Public API:
 *   addEdge(fromType, fromId, relation, toType, toId, opts)    → edge
 *   removeEdge(edgeId)                                         → { removed }
 *   getEdges(opts)                                             → edges[]
 *   getNode(type, id)                                          → { type, id, data, edges }
 *   traverse(startType, startId, opts)                         → subgraph
 *   findRelated(type, id, relation, depth)                     → related[]
 *   impactAnalysis(type, id)                                   → { affected, impact }
 *   indexMission(missionId)                                    → edges[]
 *   indexAll(opts)                                             → { indexed, edges }
 *   getStats()                                                 → stats
 *   NODE_TYPES, RELATIONS
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");

// ── Storage (edges only) ──────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, "../../data");
const EDGES_FILE  = path.join(DATA_DIR, "knowledge-graph-edges.json");

function _readEdges() {
    try { return JSON.parse(fs.readFileSync(EDGES_FILE, "utf8")); }
    catch { return { edges: [], meta: { version: 1, lastIndexed: null } }; }
}
function _writeEdges(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(EDGES_FILE, JSON.stringify(store, null, 2));
}

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _eid() { return `edge_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Lazy loaders (source-of-truth stores) ─────────────────────────────────────
function _mm()   { try { return require("./missionMemory.cjs");              } catch { return null; } }
function _bds()  { try { return require("./businessDataService.cjs");        } catch { return null; } }
function _org()  { try { return require("./organizationService.cjs");        } catch { return null; } }
function _rca()  { try { return require("./rootCauseAnalysisEngine.cjs");    } catch { return null; } }
function _reg()  { try { return require("./engineeringRuleRegistry.cjs");    } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");   } catch { return null; } }
function _bea()  { try { return require("./businessEventAdapter.cjs");       } catch { return null; } }
function _wf()   { try { return require("./hybridWorkforceService.cjs");     } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const NODE_TYPES = {
    MISSION:     "mission",
    USER:        "user",
    TEAM:        "team",
    ORG:         "org",
    DEPARTMENT:  "department",
    LEAD:        "lead",
    OPPORTUNITY: "opportunity",
    CAMPAIGN:    "campaign",
    LESSON:      "lesson",
    RCA:         "rca",
    RULE:        "rule",
    ARTIFACT:    "artifact",
    DEPLOYMENT:  "deployment",
    EVENT:       "event",
    STEP:        "step",
};

const RELATIONS = {
    OWNS:           "owns",             // mission → user
    BELONGS_TO:     "belongs_to",       // mission/lead → org
    ASSIGNED_TO:    "assigned_to",      // mission → team
    REFERENCES:     "references",       // mission → lead / opportunity
    PRODUCED:       "produced",         // mission → artifact
    TRIGGERED_BY:   "triggered_by",     // mission → rca
    GOVERNED_BY:    "governed_by",      // mission → rule
    LEARNED:        "learned",          // mission → lesson
    LINKED_TO:      "linked_to",        // rca → rule
    AFFECTED:       "affected",         // rca → mission
    CONVERTED_TO:   "converted_to",     // lead → opportunity
    OWNED_BY:       "owned_by",         // opportunity → user
    MEMBER_OF:      "member_of",        // user → team
    PART_OF:        "part_of",          // team → dept, dept → org
    CREATED:        "created",          // event → lead/opportunity
    DERIVED_FROM:   "derived_from",     // lesson → mission
    ASSIGNED_AGENT: "assigned_agent",   // step → user/agent
    DEPENDS_ON:     "depends_on",       // step → step
};

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CRUD
// ─────────────────────────────────────────────────────────────────────────────

function addEdge(fromType, fromId, relation, toType, toId, opts = {}) {
    if (!fromType || !fromId || !relation || !toType || !toId) {
        throw new Error("addEdge: fromType, fromId, relation, toType, toId are all required");
    }
    const store = _readEdges();

    // Deduplicate by (fromType, fromId, relation, toType, toId)
    const exists = store.edges.find(e =>
        e.fromType === fromType && e.fromId === fromId &&
        e.relation === relation && e.toType === toType && e.toId === toId
    );
    if (exists) return exists;

    const edge = {
        edgeId:    _eid(),
        fromType,
        fromId,
        relation,
        toType,
        toId,
        weight:    opts.weight || 1.0,
        createdAt: new Date().toISOString(),
        metadata:  opts.metadata || {},
    };
    store.edges.push(edge);
    // Called from nearly every tick (e.g. akoState.createItem indexing new
    // knowledge into the graph); with no cap, store.edges grew unboundedly
    // and every read/write in this file re-parses/re-serializes the whole
    // file, so both the transient per-call allocation and disk I/O scaled
    // up with total edges ever created, forever.
    if (store.edges.length > 20000) store.edges.splice(0, store.edges.length - 20000);
    _writeEdges(store);
    return edge;
}

function removeEdge(edgeId) {
    const store = _readEdges();
    const idx   = store.edges.findIndex(e => e.edgeId === edgeId);
    if (idx < 0) throw Object.assign(new Error("Edge not found"), { status: 404 });
    store.edges.splice(idx, 1);
    _writeEdges(store);
    return { removed: true, edgeId };
}

function getEdges({
    fromType, fromId, toType, toId, relation,
    limit = 200, offset = 0,
} = {}) {
    const store = _readEdges();
    let edges   = store.edges;
    if (fromType) edges = edges.filter(e => e.fromType === fromType);
    if (fromId)   edges = edges.filter(e => e.fromId   === fromId);
    if (toType)   edges = edges.filter(e => e.toType   === toType);
    if (toId)     edges = edges.filter(e => e.toId     === toId);
    if (relation) edges = edges.filter(e => e.relation === relation);
    return { edges: edges.slice(offset, offset + limit), total: edges.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE RESOLVER — fetch live data for a given (type, id) from its canonical store
// ─────────────────────────────────────────────────────────────────────────────

function _resolveNode(type, id) {
    try {
        switch (type) {
            case NODE_TYPES.MISSION: {
                const m = _mm()?.getMission(id);
                if (!m) return null;
                return { id: m.id, label: m.objective?.slice(0,80), status: m.status, priority: m.priority, createdAt: m.createdAt, ownerId: m.metadata?.ownerId, orgId: m.metadata?.orgId };
            }
            case NODE_TYPES.RCA: {
                const a = _rca()?.listAnalyses({ limit: 500 });
                const r = (a?.analyses || []).find(x => x.rcaId === id);
                if (!r) return null;
                return { id: r.rcaId, label: r.title?.slice(0,80), confidence: r.confidence, status: r.status, frequency: r.frequency };
            }
            case NODE_TYPES.LESSON: {
                const ls = _le()?.getLessons({ limit: 1000 });
                const l  = (ls?.lessons || []).find(x => x.id === id || x.lessonId === id);
                if (!l) return null;
                return { id: l.id || l.lessonId, label: l.title?.slice(0,80), type: l.type, severity: l.severity };
            }
            case NODE_TYPES.LEAD: {
                const ds = _bds()?.listLeads?.({ limit: 1000 });
                const l  = (ds?.items || []).find(x => x.id === id || x.leadId === id);
                if (!l) return null;
                return { id: l.id || l.leadId, label: l.name, status: l.status, email: l.email };
            }
            case NODE_TYPES.OPPORTUNITY: {
                const ds = _bds()?.listOpportunities?.({ limit: 1000 });
                const o  = (ds?.items || []).find(x => x.id === id);
                if (!o) return null;
                return { id: o.id, label: o.title || o.name, stage: o.stage, value: o.value };
            }
            case NODE_TYPES.ORG: {
                const o = _org()?.getOrg(id);
                return o ? { id: o.id, label: o.name, plan: o.plan } : null;
            }
            case NODE_TYPES.USER:
                return { id, label: id };
            case NODE_TYPES.TEAM:
            case NODE_TYPES.DEPARTMENT:
                return { id, label: id };
            case NODE_TYPES.RULE: {
                const rs = _reg()?.listRules({ limit: 200 });
                const r  = (rs?.rules || []).find(x => x.id === id);
                if (!r) return null;
                return { id: r.id, label: r.name || r.description?.slice(0,60) };
            }
            case NODE_TYPES.ARTIFACT:
                return { id, label: id };
            case NODE_TYPES.DEPLOYMENT:
                return { id, label: id };
            case NODE_TYPES.EVENT: {
                const log = _bea()?.getEventLog({ limit: 1000 });
                const ev  = (log?.events || []).find(x => x.eventId === id);
                if (!ev) return null;
                return { id: ev.eventId, label: `${ev.source}→${ev.entityType}`, source: ev.source, status: ev.status };
            }
            case NODE_TYPES.STEP:
                return { id, label: id };
            default:
                return { id, label: id };
        }
    } catch {
        return { id, label: id };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET NODE — type+id with its live data and all edges
// ─────────────────────────────────────────────────────────────────────────────

function getNode(type, id) {
    if (!type || !id) throw new Error("type and id required");
    const data     = _resolveNode(type, id);
    const outEdges = getEdges({ fromType: type, fromId: id }).edges;
    const inEdges  = getEdges({ toType:   type, toId:   id }).edges;
    return { type, id, data, outEdges, inEdges, edgeCount: outEdges.length + inEdges.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAVERSE — BFS/DFS from a start node up to maxDepth hops
// ─────────────────────────────────────────────────────────────────────────────

function traverse(startType, startId, opts = {}) {
    const { maxDepth = 2, maxNodes = 50, relation, direction = "both" } = opts;
    const store    = _readEdges();
    const visited  = new Set();
    const nodes    = [];
    const edges    = [];
    const queue    = [{ type: startType, id: startId, depth: 0 }];

    while (queue.length && nodes.length < maxNodes) {
        const { type, id, depth } = queue.shift();
        const key = `${type}:${id}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const data = _resolveNode(type, id);
        nodes.push({ type, id, data, depth });

        if (depth >= maxDepth) continue;

        // Find connected edges
        const connected = store.edges.filter(e => {
            if (relation && e.relation !== relation) return false;
            if (direction === "out")  return e.fromType === type && e.fromId === id;
            if (direction === "in")   return e.toType   === type && e.toId   === id;
            return (e.fromType === type && e.fromId === id) || (e.toType === type && e.toId === id);
        });

        for (const edge of connected) {
            edges.push(edge);
            const next = (edge.fromType === type && edge.fromId === id)
                ? { type: edge.toType,   id: edge.toId }
                : { type: edge.fromType, id: edge.fromId };
            if (!visited.has(`${next.type}:${next.id}`)) {
                queue.push({ ...next, depth: depth + 1 });
            }
        }
    }

    return { startType, startId, nodes, edges, depth: maxDepth };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIND RELATED — direct 1-hop neighbours filtered by relation
// ─────────────────────────────────────────────────────────────────────────────

function findRelated(type, id, relation, depth = 1) {
    if (depth < 1) return [];
    const store     = _readEdges();
    const related   = [];

    const connected = store.edges.filter(e =>
        (!relation || e.relation === relation) &&
        ((e.fromType === type && e.fromId === id) || (e.toType === type && e.toId === id))
    );

    for (const edge of connected) {
        const isForward = edge.fromType === type && edge.fromId === id;
        const neighbor  = isForward
            ? { type: edge.toType,   id: edge.toId }
            : { type: edge.fromType, id: edge.fromId };
        const data = _resolveNode(neighbor.type, neighbor.id);
        related.push({ ...neighbor, data, relation: edge.relation, direction: isForward ? "out" : "in", edgeId: edge.edgeId });

        if (depth > 1) {
            const deeper = findRelated(neighbor.type, neighbor.id, relation, depth - 1);
            related.push(...deeper.filter(n => !related.some(r => r.type === n.type && r.id === n.id)));
        }
    }
    return related;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPACT ANALYSIS — given a node, what else is affected?
// ─────────────────────────────────────────────────────────────────────────────

function impactAnalysis(type, id) {
    const subgraph = traverse(type, id, { maxDepth: 3, maxNodes: 100, direction: "out" });

    // Categorise affected nodes by type
    const affected = {};
    for (const node of subgraph.nodes) {
        if (node.type === type && node.id === id) continue; // skip root
        if (!affected[node.type]) affected[node.type] = [];
        affected[node.type].push({ id: node.id, data: node.data, depth: node.depth });
    }

    // Compute a simple impact score (0–100) based on breadth + depth
    const breadth  = subgraph.nodes.length - 1;
    const maxDepth = Math.max(0, ...subgraph.nodes.map(n => n.depth));
    const impact   = Math.min(100, Math.round((breadth * 10) + (maxDepth * 5)));

    const criticalTypes = [NODE_TYPES.MISSION, NODE_TYPES.OPPORTUNITY, NODE_TYPES.LEAD];
    const criticalCount = subgraph.nodes.filter(n => criticalTypes.includes(n.type)).length;

    return {
        rootType:     type,
        rootId:       id,
        rootData:     _resolveNode(type, id),
        affected,
        affectedCount: breadth,
        impactScore:   impact,
        criticalCount,
        severity:      impact >= 60 ? "critical" : impact >= 30 ? "warning" : "info",
        subgraph:      { nodes: subgraph.nodes.length, edges: subgraph.edges.length },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX MISSION — derive all edges for a mission from its existing data
// This is the key auto-indexing path: call after any mission event.
// ─────────────────────────────────────────────────────────────────────────────

function indexMission(missionId) {
    const mm      = _mm();
    if (!mm) return [];
    const mission = mm.getMission(missionId);
    if (!mission) return [];

    const added = [];
    const _add  = (fT, fI, rel, tT, tI, meta) => {
        if (!fI || !tI) return;
        try { added.push(addEdge(fT, fI, rel, tT, tI, { metadata: meta || {} })); } catch {}
    };

    const mid = mission.id;

    // mission → owner (user)
    if (mission.metadata?.ownerId) _add("mission", mid, RELATIONS.OWNS, "user", mission.metadata.ownerId);

    // mission → org
    if (mission.metadata?.orgId) _add("mission", mid, RELATIONS.BELONGS_TO, "org", mission.metadata.orgId);

    // mission → team
    if (mission.metadata?.teamId) _add("mission", mid, RELATIONS.ASSIGNED_TO, "team", mission.metadata.teamId);

    // mission → lead / opportunity (via metadata.entityType + entityId)
    if (mission.metadata?.entityType && mission.metadata?.entityId) {
        const tType = mission.metadata.entityType === "deal" ? "opportunity" : mission.metadata.entityType;
        _add("mission", mid, RELATIONS.REFERENCES, tType, mission.metadata.entityId);
    }

    // mission → artifacts
    for (const art of mission.artifacts || []) {
        if (art.id) _add("mission", mid, RELATIONS.PRODUCED, "artifact", art.id, { name: art.name });
    }

    // mission → lessons (learnings array)
    for (const l of mission.learnings || []) {
        if (l.id || l.lessonId) _add("mission", mid, RELATIONS.LEARNED, "lesson", l.id || l.lessonId);
    }

    // Subtasks → assigned agent (step)
    for (const sub of mission.subtasks || []) {
        if (sub.assignedAgent) {
            const workerType = sub.assignedAgent.startsWith("human:") ? "user" : "user";
            const workerId   = sub.assignedAgent.replace(/^human:/, "");
            _add("step", sub.id, RELATIONS.ASSIGNED_AGENT, workerType, workerId);
            _add("mission", mid, RELATIONS.ASSIGNED_TO, "step", sub.id, { description: sub.description });
        }
    }

    logger.debug(`[KnowledgeGraph] Indexed mission ${missionId}: +${added.length} edges`);
    return added;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX ALL — bulk-derive edges from all domains
// Safe to run repeatedly — addEdge() deduplicates.
// ─────────────────────────────────────────────────────────────────────────────

function indexAll(opts = {}) {
    const { dryRun = false } = opts;
    let indexed = 0;
    const allEdges = [];

    const _add = (fT, fI, rel, tT, tI, meta) => {
        if (!fI || !tI) return;
        if (dryRun) { allEdges.push({ fromType:fT, fromId:fI, relation:rel, toType:tT, toId:tI }); return; }
        try { const e = addEdge(fT, fI, rel, tT, tI, { metadata: meta||{} }); allEdges.push(e); indexed++; } catch {}
    };

    // ── Missions ──────────────────────────────────────────────────────────────
    try {
        const all = _mm()?.listMissions({ limit: 2000 }) || { missions: [] };
        for (const m of all.missions) {
            const mid = m.id;
            if (m.metadata?.ownerId) _add("mission", mid, RELATIONS.OWNS, "user", m.metadata.ownerId);
            if (m.metadata?.orgId)   _add("mission", mid, RELATIONS.BELONGS_TO, "org", m.metadata.orgId);
            if (m.metadata?.teamId)  _add("mission", mid, RELATIONS.ASSIGNED_TO, "team", m.metadata.teamId);
            if (m.metadata?.entityId) {
                const tt = m.metadata.entityType === "deal" ? "opportunity" : (m.metadata.entityType || "lead");
                _add("mission", mid, RELATIONS.REFERENCES, tt, m.metadata.entityId);
            }
            for (const art of m.artifacts || []) {
                if (art.id) _add("mission", mid, RELATIONS.PRODUCED, "artifact", art.id, { name: art.name });
            }
            for (const sub of m.subtasks || []) {
                if (sub.assignedAgent) {
                    const wid = sub.assignedAgent.replace(/^human:/, "");
                    _add("step", sub.id, RELATIONS.ASSIGNED_AGENT, "user", wid);
                    _add("mission", mid, RELATIONS.ASSIGNED_TO, "step", sub.id);
                }
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] mission index err: ${e.message}`); }

    // ── RCAs → Rules ─────────────────────────────────────────────────────────
    try {
        const all = _rca()?.listAnalyses({ limit: 500 }) || { analyses: [] };
        for (const r of all.analyses) {
            for (const ruleId of r.linkedRules || []) {
                _add("rca", r.rcaId, RELATIONS.LINKED_TO, "rule", ruleId);
            }
            for (const mid of r.affectedMissions || []) {
                _add("rca", r.rcaId, RELATIONS.AFFECTED, "mission", mid);
                _add("mission", mid, RELATIONS.TRIGGERED_BY, "rca", r.rcaId);
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] rca index err: ${e.message}`); }

    // ── Lessons → Missions ────────────────────────────────────────────────────
    try {
        const all = _le()?.getLessons({ limit: 2000 }) || { lessons: [] };
        for (const l of all.lessons) {
            const lid = l.id || l.lessonId;
            if (!lid) continue;
            if (l.missionId) {
                _add("lesson", lid, RELATIONS.DERIVED_FROM, "mission", l.missionId);
                _add("mission", l.missionId, RELATIONS.LEARNED, "lesson", lid);
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] lesson index err: ${e.message}`); }

    // ── Org hierarchy ─────────────────────────────────────────────────────────
    try {
        const orgs = _org()?.listOrgs() || { orgs: [] };
        for (const org of orgs.orgs) {
            const fullOrg = _org()?.getOrg(org.id);
            if (!fullOrg) continue;
            for (const member of fullOrg.members || []) {
                _add("user", member.accountId, RELATIONS.MEMBER_OF, "org", org.id);
                if (member.teamId) _add("user", member.accountId, RELATIONS.MEMBER_OF, "team", member.teamId);
                if (member.deptId) _add("user", member.accountId, RELATIONS.MEMBER_OF, "department", member.deptId);
            }
            for (const dept of fullOrg.departments || []) {
                _add("department", dept.id, RELATIONS.PART_OF, "org", org.id);
                for (const team of dept.teams || []) {
                    _add("team", team.id, RELATIONS.PART_OF, "department", dept.id);
                    for (const uid of team.memberIds || []) {
                        _add("user", uid, RELATIONS.MEMBER_OF, "team", team.id);
                    }
                }
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] org index err: ${e.message}`); }

    // ── Business events → leads/opportunities ─────────────────────────────────
    try {
        const log = _bea()?.getEventLog({ limit: 500 }) || { events: [] };
        for (const ev of log.events) {
            if (!ev.eventId) continue;
            if (ev.entityType && ev.entityId) {
                const tType = ev.entityType === "deal" ? "opportunity" : ev.entityType;
                _add("event", ev.eventId, RELATIONS.CREATED, tType, ev.entityId);
            }
            if (ev.missionId) {
                _add("event", ev.eventId, RELATIONS.CREATED, "mission", ev.missionId);
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] event index err: ${e.message}`); }

    // ── Workforce steps ───────────────────────────────────────────────────────
    try {
        const wfStore = _wf();
        // Read all plans from file directly to avoid requiring each mission
        const plansFile = path.join(DATA_DIR, "workforce-plans.json");
        if (fs.existsSync(plansFile)) {
            const plans = JSON.parse(fs.readFileSync(plansFile, "utf8")).plans || {};
            for (const [missionId, plan] of Object.entries(plans)) {
                for (const step of plan.steps || []) {
                    if (step.worker) {
                        const wid = step.worker.id;
                        const wType = step.worker.type === "ai" ? "user" : "user";
                        _add("step", step.stepId, RELATIONS.ASSIGNED_AGENT, wType, wid);
                    }
                    for (const dep of step.dependsOn || []) {
                        _add("step", step.stepId, RELATIONS.DEPENDS_ON, "step", dep);
                    }
                    _add("mission", missionId, RELATIONS.ASSIGNED_TO, "step", step.stepId);
                }
            }
        }
    } catch (e) { logger.warn(`[KnowledgeGraph] workforce index err: ${e.message}`); }

    const store = _readEdges();
    store.meta  = store.meta || {};
    if (!dryRun) {
        store.meta.lastIndexed = new Date().toISOString();
        _writeEdges(store);
    }

    logger.info(`[KnowledgeGraph] indexAll complete — ${indexed} edges (${allEdges.length} total, dryRun=${dryRun})`);
    return { indexed, edges: allEdges.length, dryRun, lastIndexed: store.meta.lastIndexed };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

function getStats() {
    const store = _readEdges();
    const byRelation = {};
    const byFromType = {};
    const byToType   = {};
    for (const e of store.edges) {
        byRelation[e.relation] = (byRelation[e.relation] || 0) + 1;
        byFromType[e.fromType] = (byFromType[e.fromType] || 0) + 1;
        byToType[e.toType]     = (byToType[e.toType]     || 0) + 1;
    }
    const nodeIds = new Set([...store.edges.map(e => `${e.fromType}:${e.fromId}`), ...store.edges.map(e => `${e.toType}:${e.toId}`)]);
    return {
        totalEdges:     store.edges.length,
        totalNodes:     nodeIds.size,
        byRelation,
        byFromType,
        byToType,
        lastIndexed:    store.meta?.lastIndexed || null,
    };
}

module.exports = {
    addEdge,
    removeEdge,
    getEdges,
    getNode,
    traverse,
    findRelated,
    impactAnalysis,
    indexMission,
    indexAll,
    getStats,
    NODE_TYPES,
    RELATIONS,
};
