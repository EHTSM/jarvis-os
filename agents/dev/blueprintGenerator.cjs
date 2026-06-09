"use strict";
/**
 * Blueprint Generator — converts a business idea into a structured product blueprint
 * then into a projectRunner-compatible engineering task graph.
 *
 * Entry points:
 *   generateBlueprint(idea, opts)      — AI call: idea → blueprint document
 *   blueprintToTaskGraph(blueprint)    — pure:    blueprint → projectRunner task[]
 *   runBlueprint(blueprintId, opts)    — convenience: load blueprint → runProject()
 *   getBlueprint(blueprintId)          — retrieve stored blueprint
 *   listBlueprints(opts)               — list recent blueprints
 *
 * Reuses:
 *   - aiService.callAI()       (Groq — same provider as planner + coordinator)
 *   - projectRunner.runProject() (existing task execution chain)
 *
 * Blueprint shape:
 *   {
 *     blueprintId   : "bp_<timestamp>"
 *     idea          : original business idea string
 *     productName   : short product name
 *     description   : one-paragraph product description
 *     features      : [ { id, name, description, priority } ]
 *     pages         : [ { id, name, route, description, featureIds[] } ]
 *     apis          : [ { id, method, path, description, featureIds[] } ]
 *     database      : { tables: [ { id, name, columns[], featureIds[] } ] }
 *     taskGraph     : projectRunner task[] (added by blueprintToTaskGraph)
 *     createdAt     : ISO timestamp
 *   }
 *
 * Task graph conventions (for specialist classifier compatibility):
 *   - Database tasks:  "Create <table> table in backend/db/migrations/<name>.sql"
 *   - Backend tasks:   "Implement <METHOD> <path> in backend/routes/<feature>.js"
 *   - Frontend tasks:  "Build <page> page in frontend/pages/<name>.jsx"
 *   - DevOps tasks:    included if blueprint has infra requirements
 *
 *   dependsOn rules:
 *     pages       depend on   their api tasks
 *     api tasks   depend on   their db table tasks
 *     db tasks    have no deps (wave 0)
 *
 * Storage: data/blueprints.json  (max 30, newest-first, atomic write)
 */

const fs   = require("fs");
const path = require("path");

function _ai()     { return require("../../backend/services/aiService"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/blueprints.json");
const MAX_BP     = 30;

function _loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveStore(bps) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(bps.slice(0, MAX_BP), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persist(bp) {
    const bps = _loadStore();
    const idx = bps.findIndex(b => b.blueprintId === bp.blueprintId);
    if (idx !== -1) bps[idx] = bp;
    else bps.unshift(bp);
    _saveStore(bps);
}

// ── Blueprint AI prompt ───────────────────────────────────────────
const BLUEPRINT_SYSTEM =
    "You are a senior product architect. The user describes a SaaS product idea. " +
    "Return ONLY a valid JSON object — no markdown, no prose. " +
    "Schema: {" +
    '"productName":string, ' +
    '"description":string, ' +
    '"features":[{"id":"f1","name":string,"description":string,"priority":"high"|"medium"|"low"}], ' +
    '"pages":[{"id":"p1","name":string,"route":string,"description":string,"featureIds":[]}], ' +
    '"apis":[{"id":"a1","method":"GET"|"POST"|"PUT"|"DELETE"|"PATCH","path":string,"description":string,"featureIds":[]}], ' +
    '"database":{"tables":[{"id":"t1","name":string,"columns":[string],"featureIds":[]}]}' +
    "}. " +
    "Rules: max 4 features, max 4 pages, max 6 APIs, max 4 tables. " +
    "Every page/api/table must reference at least one featureId. " +
    "ids must be unique: f1-f4, p1-p4, a1-a6, t1-t4.";

// ── Task graph builder ────────────────────────────────────────────
// Pure function — no AI, no I/O. Converts a blueprint into a flat task[]
// that projectRunner can execute directly.
//
// Dependency rules (ensures specialist wave ordering):
//   Wave 0: DB tasks (no deps) — database specialist
//   Wave 1: API tasks (depend on the DB tables their feature touches)
//   Wave 2: Page tasks (depend on the API endpoints their feature touches)
//
// Each task gets a file path that the specialist classifier can recognise,
// so routing is automatic — no extra configuration needed.

function blueprintToTaskGraph(blueprint) {
    const tasks = [];
    let   seq   = 1;

    // ── Index: featureId → table ids, api ids ────────────────────
    // Used to build dependsOn links between layers.
    const featureToTables = new Map();  // featureId → [tableSeq, …]
    const featureToApis   = new Map();  // featureId → [apiSeq, …]

    // ── Layer 1: Database tables (wave 0) ────────────────────────
    const tableTasks = [];
    for (const table of (blueprint.database?.tables ?? [])) {
        const safeName = table.name.toLowerCase().replace(/\s+/g, "_");
        const task = {
            seq,
            request:     `Create ${table.name} table with columns (${table.columns.join(", ")}) in backend/db/migrations/${String(seq).padStart(3, "0")}_${safeName}.sql`,
            description: `Database: create ${table.name} table`,
            dependsOn:   [],
            // specialist will be auto-classified as "database" from the .sql path
        };
        tableTasks.push({ task, tableId: table.id, featureIds: table.featureIds || [] });
        for (const fid of (table.featureIds || [])) {
            if (!featureToTables.has(fid)) featureToTables.set(fid, []);
            featureToTables.get(fid).push(seq);
        }
        tasks.push(task);
        seq++;
    }

    // ── Layer 2: API endpoints (wave 1, depend on their feature's tables) ──
    const apiTasks = [];
    for (const api of (blueprint.apis ?? [])) {
        // featureIds this API belongs to → find which table seqs they need
        const depTableSeqs = new Set();
        for (const fid of (api.featureIds || [])) {
            for (const tseq of (featureToTables.get(fid) ?? [])) {
                depTableSeqs.add(tseq);
            }
        }

        // Derive a route file name from the first feature or the API path
        const featureName = (blueprint.features?.find(f => (api.featureIds || []).includes(f.id))?.name || "api")
            .toLowerCase().replace(/\s+/g, "-");
        const task = {
            seq,
            request:     `Implement ${api.method} ${api.path} endpoint in backend/routes/${featureName}.js — ${api.description}`,
            description: `API: ${api.method} ${api.path} — ${api.description}`,
            dependsOn:   [...depTableSeqs],
        };
        apiTasks.push({ task, apiId: api.id, featureIds: api.featureIds || [] });
        for (const fid of (api.featureIds || [])) {
            if (!featureToApis.has(fid)) featureToApis.set(fid, []);
            featureToApis.get(fid).push(seq);
        }
        tasks.push(task);
        seq++;
    }

    // ── Layer 3: Frontend pages (wave 2, depend on their feature's APIs) ──
    for (const page of (blueprint.pages ?? [])) {
        const depApiSeqs = new Set();
        for (const fid of (page.featureIds || [])) {
            for (const aseq of (featureToApis.get(fid) ?? [])) {
                depApiSeqs.add(aseq);
            }
        }

        const safeName = page.name.toLowerCase().replace(/\s+/g, "");
        const task = {
            seq,
            request:     `Build ${page.name} page at route ${page.route} in frontend/pages/${safeName}.jsx — ${page.description}`,
            description: `Frontend: ${page.name} page (${page.route})`,
            dependsOn:   [...depApiSeqs],
        };
        tasks.push(task);
        seq++;
    }

    return tasks;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate a product blueprint from a business idea.
 *
 * @param {string} idea   — business idea description
 * @param {object} opts
 * @param {boolean} opts.buildTaskGraph  — also run blueprintToTaskGraph (default true)
 * @param {boolean} opts.buildSkeleton   — also generate repo skeleton on disk (default false)
 * @param {string}  opts.skeletonDir     — absolute path to write skeleton into (required if buildSkeleton)
 * @param {boolean} opts.overwrite       — overwrite existing skeleton files (default false)
 * @returns {Promise<Blueprint>}
 */
async function generateBlueprint(idea, { buildTaskGraph = true, buildSkeleton = false, skeletonDir, overwrite = false } = {}) {
    const blueprintId = `bp_${Date.now()}`;
    const createdAt   = new Date().toISOString();

    const ai  = _ai();
    const raw = await ai.callAI(idea, { system: BLUEPRINT_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); } catch {
        throw new Error(`[Blueprint] AI returned invalid JSON: ${cleaned.slice(0, 120)}`);
    }

    // Validate required top-level fields
    const required = ["productName", "description", "features", "pages", "apis", "database"];
    for (const field of required) {
        if (!parsed[field]) throw new Error(`[Blueprint] Missing field: ${field}`);
    }

    // Normalise + cap arrays
    parsed.features = (parsed.features || []).slice(0, 4);
    parsed.pages    = (parsed.pages    || []).slice(0, 4);
    parsed.apis     = (parsed.apis     || []).slice(0, 6);
    parsed.database = parsed.database || { tables: [] };
    parsed.database.tables = (parsed.database.tables || []).slice(0, 4);

    const blueprint = {
        blueprintId,
        idea,
        productName:  parsed.productName,
        description:  parsed.description,
        features:     parsed.features,
        pages:        parsed.pages,
        apis:         parsed.apis,
        database:     parsed.database,
        taskGraph:    buildTaskGraph ? blueprintToTaskGraph(parsed) : [],
        createdAt,
    };

    _persist(blueprint);

    console.log(`[Blueprint:${blueprintId}] "${blueprint.productName}" — ${blueprint.features.length} features, ${blueprint.apis.length} APIs, ${blueprint.pages.length} pages, ${blueprint.database.tables.length} tables, ${blueprint.taskGraph.length} tasks`);

    // Optional: generate repo skeleton immediately after blueprint
    if (buildSkeleton && skeletonDir) {
        try {
            const skelGen = require("./repoSkeletonGenerator.cjs");
            blueprint.skeleton = skelGen.generateSkeleton(blueprintId, skeletonDir, { overwrite });
        } catch (err) {
            blueprint.skeleton = { error: err.message };
            console.log(`[Blueprint:${blueprintId}] skeleton generation failed (non-fatal): ${err.message}`);
        }
    }

    return blueprint;
}

/**
 * Convert a stored blueprint into an engineering project and run it.
 * Passes the task graph directly to projectRunner — no re-decomposition.
 *
 * @param {string} blueprintId
 * @param {object} opts          — passed through to projectRunner.runProject()
 * @returns {Promise<ProjectRun>}
 */
async function runBlueprint(blueprintId, opts = {}) {
    const bp = getBlueprint(blueprintId);
    if (!bp) throw new Error(`Blueprint not found: ${blueprintId}`);
    if (!bp.taskGraph || bp.taskGraph.length === 0) throw new Error(`Blueprint ${blueprintId} has no task graph`);

    const runner = _runner();

    // Inject the pre-built task graph into projectRunner by using runProject
    // with a synthetic goal that encodes the blueprint — the decompose step
    // will be bypassed because we pass the tasks directly via opts.plan.
    const goal = `[Blueprint] ${bp.productName}: ${bp.description.slice(0, 120)}`;

    // runProject normally decomposes via AI. We bypass decompose by passing
    // the blueprint's task graph as opts.plan — projectRunner checks for this
    // and skips the AI decompose call when a pre-built plan is provided.
    return runner.runProject(goal, {
        ...opts,
        plan:        bp.taskGraph,        // pre-built task graph — skip decompose
        projectName: bp.productName,
        blueprintId: bp.blueprintId,
    });
}

/** Retrieve a blueprint by id. */
function getBlueprint(blueprintId) {
    return _loadStore().find(b => b.blueprintId === blueprintId) || null;
}

/**
 * List recent blueprints.
 * @param {object} opts
 * @param {number} opts.limit — max results (default 20)
 */
function listBlueprints({ limit = 20 } = {}) {
    return _loadStore().slice(0, limit).map(b => ({
        blueprintId:  b.blueprintId,
        productName:  b.productName,
        idea:         b.idea?.slice(0, 80),
        featureCount: b.features?.length ?? 0,
        pageCount:    b.pages?.length ?? 0,
        apiCount:     b.apis?.length ?? 0,
        tableCount:   b.database?.tables?.length ?? 0,
        taskCount:    b.taskGraph?.length ?? 0,
        createdAt:    b.createdAt,
    }));
}

module.exports = { generateBlueprint, blueprintToTaskGraph, runBlueprint, getBlueprint, listBlueprints };
