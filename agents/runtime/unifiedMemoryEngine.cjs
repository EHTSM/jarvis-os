"use strict";
/**
 * Unified Memory Engine — Jarvis remembers everything across products, workflows,
 * incidents, decisions, and operations.
 *
 * Design: read-through index.
 *   - No data is duplicated. All records live in their original files.
 *   - A lightweight cross-reference index (`data/unified-memory-index.json`) maps
 *     entity IDs to their source file and type.
 *   - Search queries the live files; the index accelerates cross-reference retrieval.
 *
 * Memory namespaces:
 *   project    — blueprints, features, product-manifests, api-manifests, db-manifests, page-manifests
 *   workflow   — task-queue, pipeline-runs, healing-runs, patch-history, workflow-execution-log
 *   incident   — incidents, rca-reports, fix-plans, learning-memory (incident patterns)
 *   decision   — context-history, sessions, deploy_meta
 *   knowledge  — learning-memory (fix/rca patterns), lifecycle-reports, telemetry-summary
 *
 * Entry points:
 *   index(opts)                    — rebuild the cross-reference index
 *   search(query, opts)            — full-text search across namespaces
 *   lookup(type, id)               — fetch one record by type+id
 *   crossRef(entityId)             — find all records that reference a given entity ID
 *   getSummary(opts)               — counts and freshness per namespace
 *   getProjectMemory(blueprintId)  — everything about a product
 *   getWorkflowMemory(opts)        — recent workflow/pipeline/task records
 *   getIncidentMemory(opts)        — incident + RCA + fix + learning linkage
 *   getDecisionMemory(opts)        — context history + sessions
 *   getKnowledgeMemory(opts)       — patterns, lifecycle reports, telemetry
 *
 * Cross-reference index (data/unified-memory-index.json):
 *   {
 *     version: number,
 *     builtAt: string,
 *     byId: {
 *       [entityId]: { type, source, title, blueprintId?, ts? }
 *     },
 *     byBlueprint: {
 *       [blueprintId]: string[]   — entity IDs linked to this blueprint
 *     },
 *     byType: {
 *       [type]: number           — count of indexed entities per type
 *     }
 *   }
 *
 * Record types:
 *   blueprint, feature, api, page, db_schema
 *   product_manifest, task, pipeline_run, healing_run, patch, workflow_exec
 *   incident, rca_report, fix_plan, incident_pattern, rca_pattern, fix_pattern
 *   context_entry, session, deploy_meta
 *   lifecycle_report, debt_item, telemetry_snapshot
 *
 * No new architecture. No agent army. No AI calls.
 * Reuses: learningMemoryEngine, projectRunner storage, incident storage, lifecycle storage.
 * Storage: data/unified-memory-index.json (rebuilt on demand, max 10MB)
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const INDEX_PATH = path.join(DATA_DIR, "unified-memory-index.json");

// ── Safe loaders ──────────────────────────────────────────────────
function _load(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const d = JSON.parse(raw);
        return d;
    } catch { return null; }
}

function _loadArr(filePath) {
    const d = _load(filePath);
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") {
        // Handle wrapped arrays like patch-history.json
        const keys = Object.keys(d);
        for (const k of keys) {
            if (Array.isArray(d[k])) return d[k];
        }
    }
    return [];
}

function _file(name) { return path.join(DATA_DIR, name); }
function _loadSessions() {
    try {
        const sessionDir = path.join(DATA_DIR, "sessions");
        return fs.readdirSync(sessionDir)
            .filter(f => f.endsWith(".json"))
            .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(sessionDir, f), "utf8")); }
                catch { return null; }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function _loadRecords(src) {
    if (typeof src.loader === "function") return src.loader();
    if (src.singleton) {
        const record = _load(_file(src.file));
        return record ? [record] : [];
    }
    if (src.isNested) {
        const raw = _load(_file(src.file));
        return raw?.[src.nestedKey] || [];
    }
    return _loadArr(_file(src.file));
}

function _learningMemory() {
    try { return require("./learningMemoryEngine.cjs"); } catch { return null; }
}

function _projectRunner() {
    try { return require("../dev/projectRunner.cjs"); } catch { return null; }
}
// ── Source definitions ─────────────────────────────────────────────
// Each source declares: type, file, idKey, titleKey (or titleFn), blueprintKey
const SOURCES = [
    // ── Project namespace ──────────────────────────────────────────
    {
        ns: "project", type: "blueprint",
        file: "blueprints.json",
        idKey: "blueprintId",
        titleFn: r => r.productName || r.blueprintId,
        blueprintKey: "blueprintId",
        tsKey: "createdAt",
        summaryFn: r => `${r.productName}: ${r.description || r.idea || ""}`.slice(0, 120),
    },
    {
        ns: "project", type: "feature",
        file: "features.json",
        idKey: "featureId",
        titleFn: r => `${r.featureName} (${r.productName || r.blueprintId})`,
        blueprintKey: "blueprintId",
        tsKey: "implementedAt",
        summaryFn: r => `Feature ${r.featureName}: ${r.status} — ${r.completed || 0}/${(r.completed || 0) + (r.failed || 0)} tasks`,
    },
    {
        ns: "project", type: "api",
        file: "api-manifests.json",
        idKey: "apiId",
        titleFn: r => `${r.apiMethod} ${r.apiPath}`,
        blueprintKey: "blueprintId",
        tsKey: "implementedAt",
        summaryFn: r => `${r.apiMethod} ${r.apiPath}: ${r.description || r.status}`,
    },
    {
        ns: "project", type: "page",
        file: "page-manifests.json",
        idKey: "pageId",
        titleFn: r => `${r.pageName} (${r.route})`,
        blueprintKey: "blueprintId",
        tsKey: null,
        summaryFn: r => `Page "${r.pageName}" at ${r.route}: ${r.status || ""}`,
    },
    {
        ns: "project", type: "db_schema",
        file: "db-manifests.json",
        idKey: r => `db_${r.blueprintId || r.projectId}`,
        titleFn: r => `DB schema for ${r.productName || r.blueprintId}`,
        blueprintKey: "blueprintId",
        tsKey: null,
        summaryFn: r => `${(r.tables || []).length} tables: ${(r.tables || []).map(t => t.name).join(", ")}`,
    },
    {
        ns: "project", type: "product_manifest",
        file: "product-manifests.json",
        idKey: r => `pm_${r.blueprintId || r.projectId}`,
        titleFn: r => `Product manifest: ${r.productName}`,
        blueprintKey: "blueprintId",
        tsKey: "assembledAt",
        summaryFn: r => `${r.productName} readiness: ${r.readiness?.readinessPct}% (${r.readiness?.passed}/${r.readiness?.total} checks)`,
    },
    {
        ns: "workflow", type: "project_run",
        file: "project-runs.json",
        idKey: "projectId",
        titleFn: r => r.projectName || r.projectId,
        blueprintKey: "blueprintId",
        tsKey: "startedAt",
        summaryFn: r => `${r.summary || `${r.taskCount} tasks`} status=${r.projectStatus}`,
    },

    // ── Workflow namespace ─────────────────────────────────────────
    {
        ns: "workflow", type: "task",
        file: "task-queue.json",
        idKey: "id",
        titleFn: r => (r.input || r.type || "task").slice(0, 80),
        blueprintKey: null,
        tsKey: "createdAt",
        summaryFn: r => `Task [${r.type}] "${(r.input || "").slice(0, 60)}" — ${r.status}`,
    },
    {
        ns: "workflow", type: "pipeline_run",
        file: "pipeline-runs.json",
        idKey: "id",
        titleFn: r => `Pipeline: ${r.pipeline} (${r.state})`,
        blueprintKey: null,
        tsKey: r => r.createdAt ? new Date(r.createdAt).toISOString() : null,
        summaryFn: r => `${r.pipeline} run ${r.id}: state=${r.state} approved=${r.approved}`,
    },
    {
        ns: "workflow", type: "healing_run",
        file: "healing-runs.json",
        idKey: "runId",
        titleFn: r => `Healing run ${r.runId} (${r.outcome})`,
        blueprintKey: null,
        tsKey: "createdAt",
        summaryFn: r => `Heal run ${r.runId}: mode=${r.mode} outcome=${r.outcome} plan=${r.planId}`,
    },
    {
        ns: "workflow", type: "patch",
        file: "patch-history.json",
        idKey: "id",
        titleFn: r => `Patch: ${path.basename(r.filePath || "unknown")}`,
        blueprintKey: null,
        tsKey: r => r.proposedAt ? new Date(r.proposedAt).toISOString() : null,
        summaryFn: r => `Patch ${r.id} on ${r.filePath}: ${r.status} — ${r.reason?.slice(0, 60)}`,
        isNested: true, nestedKey: "patches",
    },
    {
        ns: "workflow", type: "workflow_exec",
        file: "workflow-execution-log.json",
        idKey: r => `wfe_${r.ts || Date.now()}`,
        titleFn: r => `Workflow: ${r.taskType || r.label}`,
        blueprintKey: null,
        tsKey: r => r.ts ? new Date(r.ts).toISOString() : null,
        summaryFn: r => `Workflow exec "${r.taskType}": ok=${r.ok} attempts=${r.attempts}`,
    },

    // ── Incident namespace ─────────────────────────────────────────
    {
        ns: "incident", type: "incident",
        file: "incidents.json",
        idKey: "incidentId",
        titleFn: r => r.title || r.ruleId,
        blueprintKey: "blueprintId",
        tsKey: "openedAt",
        summaryFn: r => `[${r.severity}] ${r.title}: ${r.status} (${r.ruleId})`,
    },
    {
        ns: "incident", type: "rca_report",
        file: "rca-reports.json",
        idKey: "rcaId",
        titleFn: r => `RCA: ${r.cause?.category} — ${r.incident?.title || r.incidentId}`,
        blueprintKey: "blueprintId",
        tsKey: "analyzedAt",
        summaryFn: r => `RCA ${r.rcaId}: cause=${r.cause?.category} confidence=${r.confidence}`,
    },
    {
        ns: "incident", type: "fix_plan",
        file: "fix-plans.json",
        idKey: "planId",
        titleFn: r => `Fix plan: ${r.strategy?.category} (${r.status})`,
        blueprintKey: "blueprintId",
        tsKey: "createdAt",
        summaryFn: r => `Plan ${r.planId}: ${r.strategy?.approach} risk=${r.risk?.level} confidence=${r.confidence}`,
    },

    // ── Decision namespace ─────────────────────────────────────────
    {
        ns: "decision", type: "context_entry",
        file: "context-history.json",
        idKey: r => `ctx_${r.timestamp || r.ts || Date.now()}`,
        titleFn: r => (r.input || "context").slice(0, 60),
        blueprintKey: null,
        tsKey: r => r.timestamp ? new Date(r.timestamp).toISOString() : null,
        summaryFn: r => `Context: "${(r.input || "").slice(0, 60)}" → ${r.taskCount} tasks, ${r.resultCount} results`,
    },
    {
        ns: "decision", type: "session",
        file: "sessions",
        loader: _loadSessions,
        idKey: "id",
        titleFn: r => r.label || r.goal || r.id,
        blueprintKey: "blueprintId",
        tsKey: r => r.createdAt ? new Date(r.createdAt).toISOString() : null,
        summaryFn: r => `Session ${r.id}: ${r.state} — ${r.goal || "no goal"}`,
    },
    {
        ns: "decision", type: "deploy_meta",
        file: "deploy_meta.json",
        singleton: true,
        idKey: () => "deploy_meta",
        titleFn: () => "Deployment metadata",
        blueprintKey: null,
        tsKey: "updatedAt",
        summaryFn: r => `Node ${r.nodeVersion}, env=${r.nodeEnv}, port=${r.port}`,
    },

    // ── Knowledge namespace ────────────────────────────────────────
    {
        ns: "knowledge", type: "lifecycle_report",
        file: "lifecycle-reports.json",
        idKey: "reportId",
        titleFn: r => `Lifecycle: ${r.blueprintId || r.productName || "global"} — maturity=${r.maturity?.total}`,
        blueprintKey: "blueprintId",
        tsKey: "generatedAt",
        summaryFn: r => `Lifecycle ${r.reportId}: health=${r.health?.overall} maturity=${r.maturity?.total} debt=${r.debt?.open}`,
    },
    {
        ns: "knowledge", type: "debt_item",
        file: "lifecycle-debt.json",
        idKey: "debtId",
        titleFn: r => `[${r.type}] ${r.title}`,
        blueprintKey: "blueprintId",
        tsKey: "openedAt",
        summaryFn: r => `Debt ${r.debtId}: ${r.type} "${r.title}" — ${r.status} score=${r.score}`,
    },
];

// ── Index builder ─────────────────────────────────────────────────

/**
 * Rebuild the cross-reference index from all source files.
 * Returns { ok, indexed, byType, builtAt }
 */
function index({ force = false } = {}) {
    const existing = _load(INDEX_PATH);
    if (!force && existing && existing.builtAt) {
        const ageMs = Date.now() - new Date(existing.builtAt).getTime();
        if (ageMs < 30_000) return { ok: true, fromCache: true, ...existing };
    }

    const idx = {
        version: 2,
        builtAt: new Date().toISOString(),
        byId: {},
        byBlueprint: {},
        byType: {},
        byNs: {},
    };

    let total = 0;

    for (const src of SOURCES) {
        const records = _loadRecords(src);
        if (!Array.isArray(records)) continue;

        idx.byType[src.type] = (idx.byType[src.type] || 0) + records.length;
        idx.byNs[src.ns] = (idx.byNs[src.ns] || 0) + records.length;

        for (const record of records) {
            if (!record || typeof record !== "object") continue;

            // Resolve ID
            let entityId;
            if (typeof src.idKey === "function") {
                entityId = src.idKey(record);
            } else {
                entityId = record[src.idKey];
            }
            if (!entityId) continue;

            // Resolve title
            const title = typeof src.titleFn === "function"
                ? src.titleFn(record)
                : (record[src.titleFn] || String(entityId));

            // Resolve timestamp
            let ts = null;
            if (typeof src.tsKey === "function") {
                ts = src.tsKey(record);
            } else if (src.tsKey) {
                ts = record[src.tsKey] || null;
            }

            // Resolve blueprintId
            const blueprintId = src.blueprintKey ? (record[src.blueprintKey] || null) : null;

            idx.byId[entityId] = {
                type: src.type,
                ns: src.ns,
                source: src.file,
                title: (title || "").slice(0, 120),
                blueprintId,
                ts,
            };

            if (blueprintId) {
                if (!idx.byBlueprint[blueprintId]) idx.byBlueprint[blueprintId] = [];
                if (!idx.byBlueprint[blueprintId].includes(entityId)) {
                    idx.byBlueprint[blueprintId].push(entityId);
                }
            }

            total++;
        }
    }

    // Also index learning memory patterns (not array-based)
    const lmData = _load(_file("learning-memory.json"));
    if (lmData) {
        const ipCount = Object.keys(lmData.incidentPatterns || {}).length;
        const rcaCount = Object.keys(lmData.rcaPatterns || {}).length;
        const fixCount = Object.keys(lmData.fixPatterns || {}).length;
        idx.byType["incident_pattern"] = ipCount;
        idx.byType["rca_pattern"] = rcaCount;
        idx.byType["fix_pattern"] = fixCount;
        idx.byNs["incident"] = (idx.byNs["incident"] || 0) + ipCount;
        idx.byNs["knowledge"] = (idx.byNs["knowledge"] || 0) + rcaCount + fixCount;
        total += ipCount + rcaCount + fixCount;
    }

    idx.totalIndexed = total;

    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = INDEX_PATH + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
        fs.renameSync(tmp, INDEX_PATH);
    } catch { /* non-fatal */ }

    logger.info(`[UnifiedMemory] index built: ${total} entities across ${Object.keys(idx.byNs).length} namespaces`);
    return { ok: true, indexed: total, byType: idx.byType, byNs: idx.byNs, builtAt: idx.builtAt };
}

// ── Search ────────────────────────────────────────────────────────

/**
 * Full-text search across memory namespaces.
 *
 * @param {string}   query           — search string (case-insensitive, matches title + summary)
 * @param {object}   opts
 * @param {string[]} [opts.ns]       — restrict to namespaces ["project","workflow","incident","decision","knowledge"]
 * @param {string[]} [opts.types]    — restrict to record types
 * @param {string}   [opts.blueprintId]  — restrict to one product
 * @param {number}   [opts.limit=20]
 * @returns {SearchResult[]}
 */
function search(query, { ns, types, blueprintId, limit = 20 } = {}) {
    if (!query || typeof query !== "string") return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results = [];

    for (const src of SOURCES) {
        // Namespace filter
        if (ns && !ns.includes(src.ns)) continue;
        if (types && !types.includes(src.type)) continue;

        const records = _loadRecords(src);
        if (!Array.isArray(records)) continue;

        for (const record of records) {
            if (!record || typeof record !== "object") continue;

            // Blueprint filter
            if (blueprintId && src.blueprintKey) {
                if (record[src.blueprintKey] !== blueprintId) continue;
            }

            // Build searchable text
            const title = typeof src.titleFn === "function" ? src.titleFn(record) : "";
            const summary = typeof src.summaryFn === "function" ? src.summaryFn(record) : "";
            const text = `${title} ${summary}`.toLowerCase();

            if (!text.includes(q)) continue;

            // Resolve ID
            let entityId;
            if (typeof src.idKey === "function") entityId = src.idKey(record);
            else entityId = record[src.idKey];

            let ts = null;
            if (typeof src.tsKey === "function") ts = src.tsKey(record);
            else if (src.tsKey) ts = record[src.tsKey] || null;

            results.push({
                entityId: entityId || null,
                type: src.type,
                ns: src.ns,
                title: title.slice(0, 120),
                summary: summary.slice(0, 200),
                blueprintId: src.blueprintKey ? record[src.blueprintKey] || null : null,
                ts,
                score: _scoreMatch(q, text),
            });
        }
    }

    // Also search learning memory patterns
    if (!ns || ns.includes("incident") || ns.includes("knowledge")) {
        const lm = _learningMemory();
        const lmData = lm ? lm.getMemory() : _load(_file("learning-memory.json"));
        if (lmData) {
            for (const [fp, pat] of Object.entries(lmData.incidentPatterns || {})) {
                if (!types || types.includes("incident_pattern")) {
                    const text = `${fp} ${pat.ruleId} ${pat.causeCategory}`.toLowerCase();
                    if (text.includes(q)) {
                        results.push({
                            entityId: fp,
                            type: "incident_pattern",
                            ns: "incident",
                            title: `Pattern: ${pat.ruleId} (${pat.causeCategory})`,
                            summary: `Seen ${pat.count}x — success=${pat.outcomes?.success} rolled_back=${pat.outcomes?.rolled_back}`,
                            blueprintId: null,
                            ts: pat.lastSeenAt,
                            score: _scoreMatch(q, text),
                        });
                    }
                }
            }
            for (const [cat, pat] of Object.entries(lmData.fixPatterns || {})) {
                if (!types || types.includes("fix_pattern")) {
                    const text = `${cat} fix pattern approach`.toLowerCase();
                    if (text.includes(q)) {
                        results.push({
                            entityId: `fix_${cat}`,
                            type: "fix_pattern",
                            ns: "knowledge",
                            title: `Fix pattern: ${cat}`,
                            summary: `${pat.attempts} attempts, ${Math.round(pat.successRate * 100)}% success rate`,
                            blueprintId: null,
                            ts: pat.lastSeenAt,
                            score: _scoreMatch(q, text),
                        });
                    }
                }
            }
        }
    }

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function _scoreMatch(q, text) {
    // Simple relevance: count occurrences + position bonus
    let score = 0;
    let pos = 0;
    while ((pos = text.indexOf(q, pos)) !== -1) { score++; pos++; }
    if (text.startsWith(q)) score += 3;
    return score;
}

// ── Lookup ────────────────────────────────────────────────────────

/**
 * Fetch one record by type + id.
 * Returns the full record object or null.
 */
function lookup(type, id) {
    const src = SOURCES.find(s => s.type === type);
    if (!src) return null;

    const records = _loadRecords(src);

    for (const record of records) {
        if (!record) continue;
        let entityId;
        if (typeof src.idKey === "function") entityId = src.idKey(record);
        else entityId = record[src.idKey];
        if (entityId === id) return record;
    }

    // Also check learning memory patterns
    if (type === "incident_pattern") {
        const lm = _learningMemory();
        const lmData = lm ? lm.getMemory() : _load(_file("learning-memory.json"));
        return lmData?.incidentPatterns?.[id] || null;
    }
    if (type === "fix_pattern") {
        const lm = _learningMemory();
        const lmData = lm ? lm.getMemory() : _load(_file("learning-memory.json"));
        const key = id.startsWith("fix_") ? id.slice(4) : id;
        return lmData?.fixPatterns?.[key] || null;
    }
    if (type === "rca_pattern") {
        const lm = _learningMemory();
        const lmData = lm ? lm.getMemory() : _load(_file("learning-memory.json"));
        return lmData?.rcaPatterns?.[id] || null;
    }

    return null;
}

// ── Cross-reference ───────────────────────────────────────────────

/**
 * Find all indexed records that reference a given entity ID.
 *
 * @param {string} entityId  — e.g. an incidentId, blueprintId, planId, rcaId
 * @returns {CrossRefResult[]}
 */
function crossRef(entityId) {
    if (!entityId) return [];
    const idx = _load(INDEX_PATH);
    const results = [];

    // Direct ID match
    if (idx?.byId?.[entityId]) {
        results.push({ ...idx.byId[entityId], entityId, relation: "self" });
    }

    // Blueprint linkage
    if (idx?.byBlueprint?.[entityId]) {
        for (const linkedId of idx.byBlueprint[entityId]) {
            const entry = idx.byId?.[linkedId];
            if (entry) results.push({ ...entry, entityId: linkedId, relation: "blueprint_member" });
        }
    }

    // Deep search: scan live files for any field containing this ID
    const idStr = String(entityId);
    const scanFn = (record) => JSON.stringify(record).includes(idStr);

    for (const src of SOURCES) {
        const records = _loadRecords(src);

        for (const record of records) {
            if (!record) continue;
            if (!scanFn(record)) continue;

            let recId;
            if (typeof src.idKey === "function") recId = src.idKey(record);
            else recId = record[src.idKey];

            if (recId === entityId) continue; // already added as self

            const title = typeof src.titleFn === "function" ? src.titleFn(record) : String(recId);
            const alreadyAdded = results.some(r => r.entityId === recId);
            if (!alreadyAdded) {
                results.push({
                    entityId: recId,
                    type: src.type,
                    ns: src.ns,
                    source: src.file,
                    title: title.slice(0, 100),
                    relation: "references",
                });
            }
        }
    }

    return results;
}

// ── Summary ───────────────────────────────────────────────────────

/**
 * Return counts and freshness per namespace.
 */
function getSummary({ force = false } = {}) {
    const idx = _load(INDEX_PATH);
    const now = new Date().toISOString();

    // Count live records from each namespace (re-read to get fresh counts)
    const nsCounts = {};
    const freshness = {};

    for (const src of SOURCES) {
        const records = _loadRecords(src);
        const n = Array.isArray(records) ? records.length : 0;
        nsCounts[src.ns] = (nsCounts[src.ns] || 0) + n;

        // Track most recent timestamp
        if (src.tsKey && Array.isArray(records)) {
            for (const r of records) {
                let ts;
                if (typeof src.tsKey === "function") ts = src.tsKey(r);
                else ts = r?.[src.tsKey];
                if (ts && (!freshness[src.ns] || ts > freshness[src.ns])) {
                    freshness[src.ns] = ts;
                }
            }
        }
    }

    // Learning memory counts
    const lmData = _load(_file("learning-memory.json"));
    if (lmData) {
        nsCounts["incident"] = (nsCounts["incident"] || 0) +
            Object.keys(lmData.incidentPatterns || {}).length;
        nsCounts["knowledge"] = (nsCounts["knowledge"] || 0) +
            Object.keys(lmData.rcaPatterns || {}).length +
            Object.keys(lmData.fixPatterns || {}).length;
    }

    const totalIndexed = idx?.totalIndexed || Object.values(nsCounts).reduce((a, b) => a + b, 0);

    return {
        generatedAt: now,
        totalIndexed,
        indexAge: idx ? Math.round((Date.now() - new Date(idx.builtAt || now).getTime()) / 1000) + "s" : "not built",
        namespaces: nsCounts,
        freshness,
        byType: idx?.byType || {},
    };
}

// ── Namespace views ───────────────────────────────────────────────

/**
 * Everything known about a product (by blueprintId).
 */
function getProjectMemory(blueprintId) {
    if (!blueprintId) return null;

    const projectRunner = _projectRunner();
    const blueprint = _loadArr(_file("blueprints.json"))
        .find(b => b.blueprintId === blueprintId) || null;
    const features = _loadArr(_file("features.json"))
        .filter(f => f.blueprintId === blueprintId);
    const apis = _loadArr(_file("api-manifests.json"))
        .filter(a => a.blueprintId === blueprintId);
    const pages = _loadArr(_file("page-manifests.json"))
        .filter(p => p.blueprintId === blueprintId);
    const dbSchema = _loadArr(_file("db-manifests.json"))
        .find(d => d.blueprintId === blueprintId) || null;
    const productManifest = _loadArr(_file("product-manifests.json"))
        .find(p => p.blueprintId === blueprintId) || null;
    const projectRuns = projectRunner
        ? projectRunner.listProjects({ limit: 100 }).filter(r => r.blueprintId === blueprintId)
        : _loadArr(_file("project-runs.json")).filter(r => r.blueprintId === blueprintId);

    return {
        blueprintId,
        productName: blueprint?.productName || productManifest?.productName || null,
        blueprint,
        features,
        apis,
        pages,
        dbSchema,
        productManifest,
        projectRuns,
        summary: `${blueprint?.productName || blueprintId}: ${features.length} features, ${apis.length} APIs, ${pages.length} pages, ${projectRuns.length} runs`,
    };
}

/**
 * Recent workflow activity.
 */
function getWorkflowMemory({ limit = 20 } = {}) {
    const tasks = _loadArr(_file("task-queue.json")).slice(0, limit);
    const pipelines = _loadArr(_file("pipeline-runs.json")).slice(0, limit);
    const heals = _loadArr(_file("healing-runs.json")).slice(0, limit);
    const ph = _load(_file("patch-history.json"));
    const patches = (ph?.patches || []).slice(0, limit);
    const wfLog = _loadArr(_file("workflow-execution-log.json")).slice(0, limit);
    const projectRuns = _loadArr(_file("project-runs.json")).slice(0, limit);

    return { tasks, pipelines, healingRuns: heals, patches, workflowLog: wfLog, projectRuns };
}

/**
 * Incident memory chain: incident → RCA → fix → learning.
 */
function getIncidentMemory({ incidentId, blueprintId, limit = 20 } = {}) {
    let incidents = _loadArr(_file("incidents.json")).slice(0, limit);
    let rcaReports = _loadArr(_file("rca-reports.json")).slice(0, limit);
    let fixPlans = _loadArr(_file("fix-plans.json")).slice(0, limit);
    let healRuns = _loadArr(_file("healing-runs.json")).slice(0, limit);

    if (incidentId) {
        incidents = incidents.filter(i => i.incidentId === incidentId);
        rcaReports = rcaReports.filter(r => r.incidentId === incidentId);
        fixPlans = fixPlans.filter(p => p.incidentId === incidentId);
        healRuns = healRuns.filter(r => r.incidentId === incidentId);
    } else if (blueprintId) {
        incidents = incidents.filter(i => !i.blueprintId || i.blueprintId === blueprintId);
        rcaReports = rcaReports.filter(r => !r.blueprintId || r.blueprintId === blueprintId);
        fixPlans = fixPlans.filter(p => !p.blueprintId || p.blueprintId === blueprintId);
    }

    const lm = _learningMemory();
    const lmData = lm ? lm.getMemory() : _load(_file("learning-memory.json"));
    const patterns = lmData ? {
        incidentPatterns: Object.values(lmData.incidentPatterns || {}),
        repeatAlerts: lmData.repeatAlerts || [],
    } : null;

    return { incidents, rcaReports, fixPlans, healingRuns: healRuns, patterns };
}

/**
 * Decision memory: context history + sessions.
 */
function getDecisionMemory({ limit = 20 } = {}) {
    const contextHistory = _loadArr(_file("context-history.json")).slice(0, limit);
    const deployMeta = _load(_file("deploy_meta.json")) || {};
    const sessions = _loadSessions().slice(0, limit);

    return { contextHistory, sessions, deployMeta };
}

/**
 * Knowledge memory: patterns, lifecycle reports, telemetry.
 */
function getKnowledgeMemory({ blueprintId, limit = 10 } = {}) {
    let lifecycleReports = _loadArr(_file("lifecycle-reports.json")).slice(0, limit);
    let debtItems = _loadArr(_file("lifecycle-debt.json")).filter(d => d.status === "open").slice(0, limit);

    if (blueprintId) {
        lifecycleReports = lifecycleReports.filter(r => !r.blueprintId || r.blueprintId === blueprintId);
        debtItems = debtItems.filter(d => !d.blueprintId || d.blueprintId === blueprintId);
    }

    const telSummary = _load(_file("telemetry-summary.json")) || null;
    const lm = _learningMemory();
    const lmSummarySource = lm ? lm.getSummary() : _load(_file("learning-memory.json"));
    const lmSummary = lmSummarySource ? {
        incidentPatternCount: Object.keys(lmSummarySource.incidentPatterns || {}).length,
        fixPatternCount: Object.keys(lmSummarySource.fixPatterns || {}).length,
        repeatAlerts: lmSummarySource.repeatAlerts?.length || 0,
        topFixes: Object.values(lmSummarySource.fixPatterns || {})
            .sort((a, b) => b.successRate - a.successRate)
            .slice(0, 3)
            .map(f => ({ approach: f.approach, successRate: Math.round(f.successRate * 100), attempts: f.attempts })),
    } : null;

    return { lifecycleReports, debtItems, telemetrySummary: telSummary, learningMemory: lmSummary };
}

module.exports = {
    index,
    search,
    lookup,
    crossRef,
    getSummary,
    getProjectMemory,
    getWorkflowMemory,
    getIncidentMemory,
    getDecisionMemory,
    getKnowledgeMemory,
};
