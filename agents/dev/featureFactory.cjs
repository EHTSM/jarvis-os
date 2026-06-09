"use strict";
/**
 * Feature Factory — converts a blueprint feature into a full implementation
 * workflow executed through the existing projectRunner pipeline.
 *
 * Entry points:
 *   planFeature(featureId, blueprintId, opts) — AI: feature → implementation task graph
 *   implementFeature(featureId, blueprintId, opts) — plan → execute via projectRunner
 *   implementAllFeatures(blueprintId, opts)   — implement every feature sequentially
 *   getFeature(featureId, blueprintId)        — retrieve stored feature manifest
 *   listFeatures(blueprintId)                 — list features for a blueprint
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()     (feature source)
 *   - projectRunner.runProject({ plan })    (pre-built plan bypass — no re-decompose)
 *   - aiService.callAI()                    (Groq — one call per feature to plan tasks)
 *   - _classifySpecialist()                 (automatic via projectRunner — no changes needed)
 *   - wave scheduler, coordinator, deploy   (all inherited from projectRunner)
 *
 * No new architecture. No agent army.
 *
 * Feature implementation plan (per feature):
 *   Task 1  [database]  Full SQL migration — complete schema with constraints + indexes
 *   Task 2  [backend]   Route handlers    — complete CRUD with validation + error handling
 *   Task 3  [backend]   Service layer     — business logic extracted from routes
 *   Task 4  [frontend]  Page component    — complete React component with API calls + state
 *   Task 5  [backend]   Tests             — node:test suite covering the feature's routes
 *
 * Each task request includes the exact target file path so:
 *   (a) the pipeline planner extracts the correct targetFile
 *   (b) the specialist classifier routes it to the right domain
 *   (c) patchAssistant uses the skeleton stub as the base to modify
 *
 * Storage: data/features.json  (max 100 entries, newest-first, atomic write)
 */

const fs   = require("fs");
const path = require("path");

function _ai()     { return require("../../backend/services/aiService"); }
function _bp()     { return require("./blueprintGenerator.cjs"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/features.json");
const MAX_FEAT   = 100;

function _loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveStore(records) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(records.slice(0, MAX_FEAT), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persist(record) {
    const records = _loadStore();
    // Key: featureId + blueprintId
    const idx = records.findIndex(r => r.featureId === record.featureId && r.blueprintId === record.blueprintId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── File path deriver ─────────────────────────────────────────────
// Maps a blueprint feature + its associated blueprint items to the
// concrete file paths the skeleton wrote. Tasks reference these paths
// so the pipeline planner always finds the correct targetFile.
function _featureFilePaths(feature, blueprint) {
    const safeName  = feature.name.toLowerCase().replace(/\s+/g, "-");
    const featureId = feature.id;

    // Tables for this feature
    const tables = (blueprint.database?.tables ?? [])
        .filter(t => (t.featureIds || []).includes(featureId));

    // APIs for this feature
    const apis = (blueprint.apis ?? [])
        .filter(a => (a.featureIds || []).includes(featureId));

    // Pages for this feature
    const pages = (blueprint.pages ?? [])
        .filter(p => (p.featureIds || []).includes(featureId));

    const migrations = tables.map((t, i) => {
        const idx      = (blueprint.database?.tables ?? []).indexOf(t);
        const tableSeq = String(idx + 1).padStart(3, "0");
        const tSafe    = t.name.toLowerCase().replace(/\s+/g, "_");
        return `backend/db/migrations/${tableSeq}_${tSafe}.sql`;
    });

    const routeFile    = `backend/routes/${safeName}.js`;
    const serviceFile  = `backend/services/${safeName}.js`;
    const testFile     = `tests/features/${safeName}.test.cjs`;
    const pageFiles    = pages.map(p => {
        const pSafe = p.name.toLowerCase().replace(/\s+/g, "");
        return `frontend/src/pages/${pSafe}.jsx`;
    });

    return { migrations, routeFile, serviceFile, testFile, pageFiles, apis, tables, pages };
}

// ── Feature planner AI prompt ─────────────────────────────────────
const FEATURE_PLANNER_SYSTEM =
    "You are a senior full-stack engineer creating an implementation plan for a single product feature. " +
    "Given a feature description and its associated files, produce a focused task list. " +
    "Return ONLY valid JSON — an array of task objects, each with:\n" +
    '  "seq"         : integer starting at 1\n' +
    '  "filePath"    : exact relative file path to modify (string)\n' +
    '  "instruction" : precise, self-contained implementation instruction for that file (string)\n' +
    '  "description" : one-sentence summary (string)\n' +
    "Rules:\n" +
    "  - Maximum 6 tasks. Cover: DB schema, API routes, service layer, frontend page, tests.\n" +
    "  - Each instruction must be specific enough for a code generator to produce working code.\n" +
    "  - Include real column names, HTTP status codes, validation rules, and React hook names.\n" +
    "  - Do NOT invent new file paths — only use the paths provided in the context.\n" +
    "  - Return only the JSON array, no wrapper object, no markdown.";

async function _planTasksWithAI(feature, blueprint, filePaths) {
    const ai = _ai();

    // Build a rich context block so the AI produces specific instructions
    const tableBlock = filePaths.tables.map(t =>
        `  Table: ${t.name}  columns: [${t.columns.join(", ")}]  file: ${filePaths.migrations[filePaths.tables.indexOf(t)] || "N/A"}`
    ).join("\n");

    const apiBlock = filePaths.apis.map(a =>
        `  ${a.method} ${a.path} — ${a.description}`
    ).join("\n");

    const pageBlock = filePaths.pages.map((p, i) =>
        `  "${p.name}" at ${p.route}  file: ${filePaths.pageFiles[i] || "N/A"}`
    ).join("\n");

    const prompt =
        `FEATURE: ${feature.name} (${feature.priority} priority)\n` +
        `DESCRIPTION: ${feature.description}\n\n` +
        `FILES ALREADY CREATED (stubs — implement their full logic):\n` +
        `  Route file:   ${filePaths.routeFile}\n` +
        `  Service file: ${filePaths.serviceFile}  (create if missing)\n` +
        `  Test file:    ${filePaths.testFile}  (create if missing)\n` +
        (filePaths.migrations.length ? `  Migrations:\n${tableBlock}\n` : "") +
        (filePaths.pageFiles.length  ? `  Pages:\n${pageBlock}\n`       : "") +
        `\nAPI ENDPOINTS TO IMPLEMENT:\n${apiBlock}\n\n` +
        `Produce an ordered task list to implement this feature completely. ` +
        `Use only the file paths listed above. Return a JSON array of task objects.`;

    const raw     = await ai.callAI(prompt, { system: FEATURE_PLANNER_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    let tasks;
    try { tasks = JSON.parse(cleaned); } catch {
        throw new Error(`[FeatureFactory] AI returned invalid JSON: ${cleaned.slice(0, 120)}`);
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Error(`[FeatureFactory] No tasks returned for feature: ${feature.name}`);
    }

    // Normalise and cap
    return tasks.slice(0, 6).map((t, i) => ({
        seq:         typeof t.seq === "number" ? t.seq : i + 1,
        request:     `${t.instruction?.trim() || t.description?.trim()} in ${t.filePath}`,
        description: (t.description || t.instruction || "").slice(0, 120).trim(),
        dependsOn:   [],   // within a feature, tasks are sequential (no parallelism — same feature state)
        filePath:    t.filePath,
    }));
}

// ── Fallback: pure task builder (no AI) ──────────────────────────
// Used when AI planning is skipped (opts.skipAI = true) or as a
// reliable baseline. Generates standard 5-task implementation plan
// from the file path map — deterministic, instant, always valid.
function _planTasksPure(feature, blueprint, filePaths) {
    const tasks = [];
    let seq = 1;

    // Task 1: DB migration (if this feature has tables)
    if (filePaths.migrations.length > 0) {
        const t = filePaths.tables[0];
        const cols = t.columns.map((c, i) => {
            if (i === 0) return `${c} INTEGER PRIMARY KEY AUTOINCREMENT`;
            if (c.endsWith("_id")) return `${c} INTEGER NOT NULL REFERENCES ${c.replace("_id", "s")}(id) ON DELETE CASCADE`;
            if (c === "created_at" || c === "updated_at") return `${c} TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`;
            if (c.includes("email")) return `${c} TEXT NOT NULL UNIQUE`;
            if (c.includes("status")) return `${c} TEXT NOT NULL DEFAULT 'active' CHECK(${c} IN ('active','inactive','deleted'))`;
            if (c.includes("amount") || c.includes("price")) return `${c} REAL NOT NULL DEFAULT 0`;
            return `${c} TEXT NOT NULL`;
        }).join(", ");

        const indexCols = t.columns.filter(c => c.endsWith("_id") || c === "status" || c.includes("email"));
        const indexes = indexCols.map(c =>
            `CREATE INDEX IF NOT EXISTS idx_${t.name}_${c} ON ${t.name}(${c});`
        ).join("\n");

        tasks.push({
            seq: seq++,
            request: `Replace the stub in ${filePaths.migrations[0]} with a complete SQL migration: CREATE TABLE IF NOT EXISTS ${t.name} (${cols}); ${indexes} Add a rollback comment section at the bottom.`,
            description: `Full SQL migration for ${t.name} with constraints and indexes`,
            dependsOn: [],
            filePath: filePaths.migrations[0],
        });
    }

    // Task 2: Service layer
    const apiSummary = filePaths.apis.map(a => `${a.method} ${a.path}: ${a.description}`).join("; ");
    tasks.push({
        seq: seq++,
        request: `Replace the stub in ${filePaths.serviceFile} with a complete service module for ${feature.name}. Export async functions: ${filePaths.apis.map(a => a.description.toLowerCase().replace(/\s+/g, "_")).join(", ")}. Each function must accept validated input, query the SQLite database via require('../db/index').getDB(), and return structured results. APIs to cover: ${apiSummary}.`,
        description: `Service layer for ${feature.name} with database queries`,
        dependsOn: filePaths.migrations.length > 0 ? [1] : [],
        filePath: filePaths.serviceFile,
    });

    // Task 3: Route handlers
    const routeDeps = [tasks[tasks.length - 1].seq];
    tasks.push({
        seq: seq++,
        request: `Replace the stub in ${filePaths.routeFile} with complete Express route handlers for: ${apiSummary}. Import the service from ${filePaths.serviceFile}. Add input validation (check required fields, return 400 on missing). Return 201 for POST success, 200 for GET, 404 when not found, 500 on errors. Wrap every handler in try/catch.`,
        description: `Express route handlers for ${feature.name} with validation`,
        dependsOn: routeDeps,
        filePath: filePaths.routeFile,
    });

    // Task 4: Frontend page (first page only if multiple)
    if (filePaths.pageFiles.length > 0) {
        const page = filePaths.pages[0];
        tasks.push({
            seq: seq++,
            request: `Replace the stub in ${filePaths.pageFiles[0]} with a complete React component for the ${page.name} page. Use useState and useEffect hooks. Fetch data from the API using the axios client at ../api/client. Show a loading state while fetching. Display results in a table or list. Handle errors with an error message. Include a form for creating new entries if the feature has a POST endpoint.`,
            description: `React page component for ${page.name} with data fetching`,
            dependsOn: [tasks[tasks.length - 1].seq],
            filePath: filePaths.pageFiles[0],
        });
    }

    // Task 5: Tests
    const routeBase = filePaths.routeFile.replace(".js", "");
    tasks.push({
        seq: seq++,
        request: `Create ${filePaths.testFile} with a node:test suite for the ${feature.name} feature. Import the express app from backend/server.js. Use http.request to call each route: ${filePaths.apis.map(a => `${a.method} ${a.path}`).join(", ")}. Assert status codes and response shape. Include a beforeEach that resets test state.`,
        description: `Test suite for ${feature.name} routes`,
        dependsOn: [tasks[tasks.length - 1].seq],
        filePath: filePaths.testFile,
    });

    return tasks;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate an implementation plan for a single feature.
 * Returns the task graph without executing it.
 *
 * @param {string} featureId
 * @param {string} blueprintId
 * @param {object} opts
 * @param {boolean} opts.useAI   — use AI planner (default true); false = pure derivation
 * @returns {{ featureId, featureName, blueprintId, tasks, filePaths, plannedAt }}
 */
async function planFeature(featureId, blueprintId, { useAI = true } = {}) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    const feature = blueprint.features.find(f => f.id === featureId);
    if (!feature) throw new Error(`Feature ${featureId} not found in blueprint ${blueprintId}`);

    const filePaths = _featureFilePaths(feature, blueprint);

    const tasks = useAI
        ? await _planTasksWithAI(feature, blueprint, filePaths)
        : _planTasksPure(feature, blueprint, filePaths);

    console.log(`[FeatureFactory] plan: "${feature.name}" — ${tasks.length} tasks (${useAI ? "AI" : "pure"})`);
    tasks.forEach(t => console.log(`[FeatureFactory]   ${t.seq}. ${t.description}`));

    return {
        featureId,
        featureName:  feature.name,
        blueprintId,
        productName:  blueprint.productName,
        tasks,
        filePaths,
        plannedAt:    new Date().toISOString(),
    };
}

/**
 * Plan + execute implementation of a single feature through projectRunner.
 *
 * @param {string} featureId
 * @param {string} blueprintId
 * @param {object} opts
 * @param {boolean} opts.useAI        — use AI planner (default true)
 * @param {boolean} opts.autoApply    — write patches automatically (default true)
 * @param {boolean} opts.autoRollback — rollback on test failure (default true)
 * @param {boolean} opts.deployAtEnd  — deploy after implementation (default false)
 * @param {string}  opts.testCommand
 * @param {string}  opts.operatorId
 * @returns {{ featureManifest, projectRun }}
 */
async function implementFeature(featureId, blueprintId, opts = {}) {
    const plan       = await planFeature(featureId, blueprintId, { useAI: opts.useAI ?? true });
    const blueprint  = _bp().getBlueprint(blueprintId);
    const feature    = blueprint.features.find(f => f.id === featureId);
    const runner     = _runner();

    console.log(`[FeatureFactory] implementing "${feature.name}" — ${plan.tasks.length} tasks`);

    const projectRun = await runner.runProject(
        `Implement ${feature.name} feature for ${blueprint.productName}`,
        {
            plan:         plan.tasks,
            projectName:  `${blueprint.productName} — ${feature.name}`,
            blueprintId:  blueprintId,
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            deployAtEnd:  opts.deployAtEnd  ?? false,
            testCommand:  opts.testCommand,
            operatorId:   opts.operatorId   ?? "feature-factory",
        }
    );

    const manifest = {
        featureId,
        featureName:   feature.name,
        blueprintId,
        productName:   blueprint.productName,
        projectId:     projectRun.projectId,
        status:        projectRun.ok ? "implemented" : "partial",
        tasks:         plan.tasks,
        filePaths:     plan.filePaths,
        completed:     projectRun.completed,
        failed:        projectRun.failed,
        skipped:       projectRun.skipped,
        tests:         projectRun.tests,
        coordinator:   projectRun.coordinator,
        implementedAt: new Date().toISOString(),
    };

    _persist(manifest);
    console.log(`[FeatureFactory] "${feature.name}" — ${manifest.status} (${manifest.completed}/${plan.tasks.length} tasks)`);
    return { featureManifest: manifest, projectRun };
}

/**
 * Implement all features in a blueprint sequentially.
 * Each feature runs as its own projectRunner project.
 *
 * @param {string} blueprintId
 * @param {object} opts        — same as implementFeature opts
 * @returns {{ blueprintId, results: [{ featureId, featureName, status, projectId }] }}
 */
async function implementAllFeatures(blueprintId, opts = {}) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    console.log(`[FeatureFactory] implementing all ${blueprint.features.length} features for "${blueprint.productName}"`);

    const results = [];
    for (const feature of blueprint.features) {
        try {
            const { featureManifest } = await implementFeature(feature.id, blueprintId, opts);
            results.push({
                featureId:   feature.id,
                featureName: feature.name,
                status:      featureManifest.status,
                projectId:   featureManifest.projectId,
            });
        } catch (err) {
            console.log(`[FeatureFactory] "${feature.name}" failed: ${err.message}`);
            results.push({
                featureId:   feature.id,
                featureName: feature.name,
                status:      "error",
                error:       err.message,
            });
        }
    }

    return { blueprintId, productName: blueprint.productName, results };
}

/** Retrieve a feature manifest by featureId + blueprintId. */
function getFeature(featureId, blueprintId) {
    return _loadStore().find(r => r.featureId === featureId && r.blueprintId === blueprintId) || null;
}

/**
 * List feature manifests for a blueprint (or all if blueprintId omitted).
 * @param {string} [blueprintId]
 */
function listFeatures(blueprintId) {
    const records = _loadStore();
    const filtered = blueprintId ? records.filter(r => r.blueprintId === blueprintId) : records;
    return filtered.map(r => ({
        featureId:     r.featureId,
        featureName:   r.featureName,
        blueprintId:   r.blueprintId,
        productName:   r.productName,
        projectId:     r.projectId,
        status:        r.status,
        completed:     r.completed,
        failed:        r.failed,
        implementedAt: r.implementedAt,
    }));
}

module.exports = {
    planFeature,
    implementFeature,
    implementAllFeatures,
    getFeature,
    listFeatures,
};
