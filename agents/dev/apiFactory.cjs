"use strict";
/**
 * API Factory — converts individual blueprint API endpoints into complete
 * backend implementations executed through the existing projectRunner pipeline.
 *
 * Entry points:
 *   planApi(apiId, blueprintId, opts)          — pure: api → implementation task graph
 *   implementApi(apiId, blueprintId, opts)     — plan → execute via projectRunner
 *   implementAllApis(blueprintId, opts)        — implement all APIs (grouped by route file)
 *   getApiManifest(apiId, blueprintId)         — retrieve stored API manifest
 *   listApiManifests(blueprintId)              — list manifests for a blueprint
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()    (API + table source)
 *   - projectRunner.runProject({ plan })   (pre-built plan bypass — no re-decompose)
 *   - specialist routing                   (automatic from file paths in task requests)
 *   - wave scheduler                       (parallel within a group, sequential across deps)
 *
 * No new architecture. No agent army. No AI call — pure derivation only.
 *
 * Task decomposition per API endpoint (6 tasks, all sequential within one API):
 *
 *   Task 1  [database]  Validation schema  — backend/validators/<feature>.js
 *                       Field-level rules: required, type, min/max, pattern
 *
 *   Task 2  [backend]   Route handler      — backend/routes/<feature>.js
 *                       Single endpoint: input validation call, service call, response
 *
 *   Task 3  [backend]   Service method     — backend/services/<feature>.js
 *                       Business logic: DB query, data transform, error throw
 *
 *   Task 4  [backend]   Error handler      — backend/middleware/errorHandler.js
 *                       Endpoint-aware error mapping: DB errors → HTTP codes
 *
 *   Task 5  [backend]   API test           — tests/api/<feature>/<method>_<path>.test.cjs
 *                       Focused contract test: happy path, 400 validation, 404, 500
 *
 *   Task 6  [backend]   API manifest doc   — backend/docs/<feature>.json
 *                       Machine-readable endpoint spec: params, responses, examples
 *
 * Dependency rules (within one API's task graph):
 *   Task 1 (validator) → no deps         — wave 0
 *   Task 2 (route)     → depends on T1   — wave 1
 *   Task 3 (service)   → depends on T1   — wave 1  (parallel with route)
 *   Task 4 (errors)    → depends on T2,T3 — wave 2
 *   Task 5 (tests)     → depends on T4   — wave 3
 *   Task 6 (docs)      → depends on T4   — wave 3  (parallel with tests)
 *
 * Cross-API grouping (implementAllApis):
 *   APIs sharing the same route file (same feature) are grouped.
 *   The group's tasks are merged into one projectRunner run so the
 *   wave scheduler can parallelise independent endpoints within a group.
 *
 * Storage: data/api-manifests.json  (max 200, keyed apiId+blueprintId)
 */

const fs   = require("fs");
const path = require("path");

function _bp()     { return require("./blueprintGenerator.cjs"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/api-manifests.json");
const MAX_REC    = 200;

function _loadStore() {
    try {
        const raw    = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveStore(records) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(records.slice(0, MAX_REC), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persistManifest(record) {
    const records = _loadStore();
    const idx = records.findIndex(r => r.apiId === record.apiId && r.blueprintId === record.blueprintId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── File path resolver ────────────────────────────────────────────
// Derives all file paths for one API endpoint from the blueprint.
// Pure — no I/O.
function _apiFilePaths(api, blueprint) {
    // The feature name drives the route and service file names
    const feature = blueprint.features?.find(f => (api.featureIds || []).includes(f.id));
    const featureName = (feature?.name || api.path.split("/")[1] || "api")
        .toLowerCase().replace(/\s+/g, "-");

    // The table(s) backing this API (via shared featureIds)
    const tables = (blueprint.database?.tables ?? [])
        .filter(t => (t.featureIds || []).some(fid => (api.featureIds || []).includes(fid)));

    const migrations = tables.map(t => {
        const idx      = (blueprint.database?.tables ?? []).indexOf(t);
        const tableSeq = String(idx + 1).padStart(3, "0");
        const tSafe    = t.name.toLowerCase().replace(/\s+/g, "_");
        return `backend/db/migrations/${tableSeq}_${tSafe}.sql`;
    });

    // Safe method+path for test file naming
    const safePath   = api.path.replace(/\//g, "_").replace(/^_/, "").replace(/[^a-z0-9_]/gi, "");
    const testName   = `${api.method.toLowerCase()}_${safePath}`;

    return {
        featureName,
        feature,
        tables,
        migrations,
        validatorFile:  `backend/validators/${featureName}.js`,
        routeFile:      `backend/routes/${featureName}.js`,
        serviceFile:    `backend/services/${featureName}.js`,
        errorFile:      `backend/middleware/errorHandler.js`,
        testFile:       `tests/api/${featureName}/${testName}.test.cjs`,
        docsFile:       `backend/docs/${featureName}.json`,
    };
}

// ── Validation schema builder ─────────────────────────────────────
// Derives field validation rules from table columns and HTTP method.
// Pure — produces a description string for the pipeline to implement.
function _validationSpec(api, tables) {
    if (api.method === "GET" || api.method === "DELETE") {
        // GET/DELETE: validate URL params, no body
        const paramCheck = api.path.includes(":") ? "Validate that URL params are numeric integers." : "";
        return paramCheck || "No body validation required for GET requests.";
    }

    // POST/PUT/PATCH: infer required fields from table columns
    const allColumns = tables.flatMap(t => t.columns);
    const bodyFields = allColumns
        .filter(c => c !== "id" && !c.endsWith("_at"))
        .map(c => {
            if (c.includes("email"))               return `${c}: required, valid email format`;
            if (c.includes("amount") || c.includes("price")) return `${c}: required, positive number`;
            if (c.endsWith("_id"))                 return `${c}: required, positive integer`;
            if (c.includes("status"))              return `${c}: optional, one of [active, inactive, deleted]`;
            return `${c}: required, non-empty string`;
        });

    return bodyFields.length
        ? `Validate request body fields: ${bodyFields.join("; ")}.`
        : `Validate that request body is a non-empty JSON object.`;
}

// ── HTTP status map ───────────────────────────────────────────────
// Returns the expected success status code for an HTTP method.
function _successStatus(method) {
    return { POST: 201, PUT: 200, PATCH: 200, GET: 200, DELETE: 204 }[method] ?? 200;
}

// ── Task graph builder (pure) ─────────────────────────────────────
// Builds the 6-task implementation graph for a single API endpoint.
// File paths target existing skeleton files so patchAssistant can
// apply diffs against known stubs.
//
// Dependency structure:
//   T1 (validator) — wave 0
//   T2 (route), T3 (service) — wave 1, parallel
//   T4 (errorHandler) — wave 2
//   T5 (tests), T6 (docs) — wave 3, parallel

function _buildApiTaskGraph(api, blueprint, fp, baseSeq = 1) {
    const validSpec   = _validationSpec(api, fp.tables);
    const successCode = _successStatus(api.method);
    const tableName   = fp.tables[0]?.name ?? "records";
    const colList     = fp.tables[0]?.columns.filter(c => c !== "id" && !c.endsWith("_at")).join(", ") ?? "fields";
    const featureName = fp.featureName;

    // Decide if this is a read or write operation
    const isWrite   = ["POST", "PUT", "PATCH"].includes(api.method);
    const isDelete  = api.method === "DELETE";

    // ── T1: Validation schema ─────────────────────────────────────
    const t1 = {
        seq:         baseSeq,
        request:     `Add or update the ${api.method} ${api.path} validation function in ${fp.validatorFile}. ` +
                     `Export a function validate${api.method}${featureName.replace(/-/g, "_")}(body) that: ` +
                     `(1) ${validSpec} ` +
                     `(2) Returns { valid: true } on success. ` +
                     `(3) Returns { valid: false, errors: [string] } listing all failures. ` +
                     `Use no external libraries — pure JS checks only.`,
        description: `Validation schema for ${api.method} ${api.path}`,
        dependsOn:   [],
        filePath:    fp.validatorFile,
    };

    // ── T2: Route handler ─────────────────────────────────────────
    const t2 = {
        seq:         baseSeq + 1,
        request:     `Add or update the ${api.method} ${api.path} route handler in ${fp.routeFile}. ` +
                     `The handler must: ` +
                     `(1) Call the validator from ${fp.validatorFile}; return 400 with { error, errors[] } if invalid. ` +
                     `(2) Call the corresponding service method from ${fp.serviceFile}. ` +
                     `(3) Return HTTP ${successCode} with { success: true, data: result } on success. ` +
                     `(4) Catch errors: if err.code === 'NOT_FOUND' return 404; if err.code === 'CONFLICT' return 409; else pass to next(err). ` +
                     `Wrap in try/catch. Register the route with router.${api.method.toLowerCase()}('${api.path.replace(/^\/api/, "")}', handler).`,
        description: `Route handler for ${api.method} ${api.path}`,
        dependsOn:   [baseSeq],          // depends on T1 (validator)
        filePath:    fp.routeFile,
    };

    // ── T3: Service method ────────────────────────────────────────
    const dbOp = isWrite
        ? `db.prepare("INSERT INTO ${tableName} (${colList}) VALUES (${colList.split(", ").map(() => "?").join(", ")})").run(...)`
        : isDelete
            ? `db.prepare("DELETE FROM ${tableName} WHERE id = ?").run(id)`
            : `db.prepare("SELECT * FROM ${tableName}${api.path.includes(":id") ? " WHERE id = ?" : ""}").${api.path.includes(":id") ? "get(id)" : "all()"}`;

    const t3 = {
        seq:         baseSeq + 2,
        request:     `Add or update the service method for ${api.method} ${api.path} in ${fp.serviceFile}. ` +
                     `Export an async function ${api.method.toLowerCase()}${tableName.charAt(0).toUpperCase() + tableName.slice(1)}(${isWrite ? "data" : api.path.includes(":id") ? "id" : ""}) that: ` +
                     `(1) Gets the database via require('../db/index').getDB(). ` +
                     `(2) Executes: ${dbOp}. ` +
                     `(3) ${isWrite ? `Throws { code: 'CONFLICT', message: '${tableName} already exists' } on SQLITE_CONSTRAINT errors.` : `Throws { code: 'NOT_FOUND', message: '${tableName} not found' } if result is null/undefined.`} ` +
                     `(4) Returns the result object or array.`,
        description: `Service method for ${api.method} ${api.path}`,
        dependsOn:   [baseSeq],          // depends on T1 (validator), parallel with T2
        filePath:    fp.serviceFile,
    };

    // ── T4: Error handler ─────────────────────────────────────────
    const t4 = {
        seq:         baseSeq + 3,
        request:     `Update ${fp.errorFile} to handle errors from the ${featureName} routes. ` +
                     `Ensure the error handler middleware (err, req, res, next) maps: ` +
                     `(1) err.code === 'NOT_FOUND' → 404 { error: err.message }. ` +
                     `(2) err.code === 'CONFLICT' → 409 { error: err.message }. ` +
                     `(3) err.code === 'VALIDATION' → 400 { error: err.message, errors: err.errors }. ` +
                     `(4) All other errors → 500 { error: 'Internal server error' } (never leak err.message in production). ` +
                     `Export the middleware as module.exports = errorHandler. Mount it last in backend/server.js.`,
        description: `Error handler for ${featureName} routes`,
        dependsOn:   [baseSeq + 1, baseSeq + 2],  // depends on T2 + T3
        filePath:    fp.errorFile,
    };

    // ── T5: API tests ─────────────────────────────────────────────
    const t5 = {
        seq:         baseSeq + 4,
        request:     `Create ${fp.testFile} with a focused node:test suite for ${api.method} ${api.path}. ` +
                     `Import the express app from backend/server.js. Use node:http to make requests. ` +
                     `Test cases: ` +
                     `(1) Happy path — valid ${isWrite ? "body" : "request"} returns ${successCode} with { success: true, data: ... }. ` +
                     (isWrite ? `(2) Missing required field returns 400 with { errors: [...] }. ` : "") +
                     (api.path.includes(":id") ? `(3) Unknown id returns 404. ` : "") +
                     `(${isWrite ? (api.path.includes(":id") ? "4" : "3") : "2"}) Server error → 500 (mock service to throw). ` +
                     `Use test() blocks with descriptive names. Assert statusCode and parsed response body.`,
        description: `API tests for ${api.method} ${api.path}`,
        dependsOn:   [baseSeq + 3],      // depends on T4
        filePath:    fp.testFile,
    };

    // ── T6: API manifest doc ──────────────────────────────────────
    const responseExample = isWrite
        ? `{ "id": 1, ${fp.tables[0]?.columns.filter(c => c !== "id").slice(0, 3).map(c => `"${c}": "..."`).join(", ")} }`
        : `[{ "id": 1, ${fp.tables[0]?.columns.filter(c => c !== "id").slice(0, 2).map(c => `"${c}": "..."`).join(", ")} }]`;

    const t6 = {
        seq:         baseSeq + 5,
        request:     `Create or update ${fp.docsFile} as a JSON file documenting the ${api.method} ${api.path} endpoint. ` +
                     `Include fields: ` +
                     `"method": "${api.method}", ` +
                     `"path": "${api.path}", ` +
                     `"description": "${api.description}", ` +
                     `"requestBody": ${isWrite ? `{ ${fp.tables[0]?.columns.filter(c => c !== "id" && !c.endsWith("_at")).map(c => `"${c}": "string"`).join(", ")} }` : "null"}, ` +
                     `"responses": { "${successCode}": { "description": "Success", "example": ${responseExample} }, "400": { "description": "Validation error" }, "500": { "description": "Server error" } }, ` +
                     `"validator": "${fp.validatorFile}", ` +
                     `"service": "${fp.serviceFile}". ` +
                     `Write valid JSON. Do not include comments.`,
        description: `API manifest doc for ${api.method} ${api.path}`,
        dependsOn:   [baseSeq + 3],      // depends on T4, parallel with T5
        filePath:    fp.docsFile,
    };

    return [t1, t2, t3, t4, t5, t6];
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Build the implementation task graph for a single API endpoint.
 * Pure — no AI, no I/O.
 *
 * @param {string} apiId
 * @param {string} blueprintId
 * @returns {{ apiId, apiMethod, apiPath, blueprintId, tasks[], filePaths, plannedAt }}
 */
function planApi(apiId, blueprintId) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    const api = blueprint.apis?.find(a => a.id === apiId);
    if (!api) throw new Error(`API ${apiId} not found in blueprint ${blueprintId}`);

    const fp    = _apiFilePaths(api, blueprint);
    const tasks = _buildApiTaskGraph(api, blueprint, fp, 1);

    console.log(`[ApiFactory] plan: ${api.method} ${api.path} — ${tasks.length} tasks`);
    tasks.forEach(t => console.log(`[ApiFactory]   T${t.seq} [deps=${t.dependsOn.join(",")||"∅"}] ${t.description}`));

    return {
        apiId,
        apiMethod:   api.method,
        apiPath:     api.path,
        description: api.description,
        featureIds:  api.featureIds || [],
        blueprintId,
        productName: blueprint.productName,
        tasks,
        filePaths:   fp,
        plannedAt:   new Date().toISOString(),
    };
}

/**
 * Plan + execute implementation of a single API endpoint.
 *
 * @param {string} apiId
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ apiManifest, projectRun }}
 */
async function implementApi(apiId, blueprintId, opts = {}) {
    const plan      = planApi(apiId, blueprintId);
    const blueprint = _bp().getBlueprint(blueprintId);
    const api       = blueprint.apis.find(a => a.id === apiId);
    const runner    = _runner();

    console.log(`[ApiFactory] implementing ${api.method} ${api.path}`);

    const projectRun = await runner.runProject(
        `Implement ${api.method} ${api.path} for ${blueprint.productName}`,
        {
            plan:         plan.tasks,
            projectName:  `${blueprint.productName} API — ${api.method} ${api.path}`,
            blueprintId,
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            deployAtEnd:  opts.deployAtEnd  ?? false,
            testCommand:  opts.testCommand,
            operatorId:   opts.operatorId   ?? "api-factory",
        }
    );

    const manifest = {
        apiId,
        apiMethod:     api.method,
        apiPath:       api.path,
        description:   api.description,
        featureIds:    api.featureIds || [],
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

    _persistManifest(manifest);
    console.log(`[ApiFactory] ${api.method} ${api.path} — ${manifest.status} (${manifest.completed}/${plan.tasks.length})`);
    return { apiManifest: manifest, projectRun };
}

/**
 * Implement all APIs in a blueprint.
 * APIs sharing the same route file are grouped and merged into one
 * projectRunner run so the wave scheduler can parallelise them.
 *
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ blueprintId, groups: [{ featureName, apis[], status }] }}
 */
async function implementAllApis(blueprintId, opts = {}) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    console.log(`[ApiFactory] implementing all ${blueprint.apis?.length ?? 0} APIs for "${blueprint.productName}"`);

    // Group APIs by their route file (= by feature name)
    const groups = new Map();   // featureName → { apis[], tasks[], baseSeq }
    let   seqCounter = 1;

    for (const api of (blueprint.apis ?? [])) {
        const fp          = _apiFilePaths(api, blueprint);
        const featureName = fp.featureName;

        if (!groups.has(featureName)) {
            groups.set(featureName, { featureName, apis: [], tasks: [] });
        }

        const group     = groups.get(featureName);
        const apiTasks  = _buildApiTaskGraph(api, blueprint, fp, seqCounter);

        // Re-number tasks sequentially across the whole group
        group.tasks.push(...apiTasks);
        group.apis.push({ id: api.id, method: api.method, path: api.path });
        seqCounter += apiTasks.length;
    }

    const results = [];
    for (const [featureName, group] of groups) {
        const apiList  = group.apis.map(a => `${a.method} ${a.path}`).join(", ");
        console.log(`[ApiFactory] group "${featureName}": ${group.apis.length} API(s), ${group.tasks.length} tasks — ${apiList}`);

        try {
            const runner = _runner();
            const projectRun = await runner.runProject(
                `Implement ${featureName} APIs for ${blueprint.productName}: ${apiList}`,
                {
                    plan:         group.tasks,
                    projectName:  `${blueprint.productName} API Group — ${featureName}`,
                    blueprintId,
                    autoApply:    opts.autoApply    ?? true,
                    autoRollback: opts.autoRollback ?? true,
                    autoDeploy:   opts.autoDeploy   ?? false,
                    deployAtEnd:  opts.deployAtEnd  ?? false,
                    testCommand:  opts.testCommand,
                    operatorId:   opts.operatorId   ?? "api-factory",
                }
            );

            // Persist individual manifest per API in the group
            for (const apiRef of group.apis) {
                const api = blueprint.apis.find(a => a.id === apiRef.id);
                const fp  = _apiFilePaths(api, blueprint);
                _persistManifest({
                    apiId:         api.id,
                    apiMethod:     api.method,
                    apiPath:       api.path,
                    description:   api.description,
                    featureIds:    api.featureIds || [],
                    blueprintId,
                    productName:   blueprint.productName,
                    projectId:     projectRun.projectId,
                    status:        projectRun.ok ? "implemented" : "partial",
                    filePaths:     fp,
                    completed:     projectRun.completed,
                    failed:        projectRun.failed,
                    tests:         projectRun.tests,
                    coordinator:   projectRun.coordinator,
                    implementedAt: new Date().toISOString(),
                });
            }

            results.push({
                featureName,
                apis:      group.apis,
                projectId: projectRun.projectId,
                status:    projectRun.ok ? "implemented" : "partial",
                completed: projectRun.completed,
                failed:    projectRun.failed,
            });
        } catch (err) {
            console.log(`[ApiFactory] group "${featureName}" failed: ${err.message}`);
            results.push({ featureName, apis: group.apis, status: "error", error: err.message });
        }
    }

    return { blueprintId, productName: blueprint.productName, groups: results };
}

/** Retrieve a stored API manifest by apiId + blueprintId. */
function getApiManifest(apiId, blueprintId) {
    return _loadStore().find(r => r.apiId === apiId && r.blueprintId === blueprintId) || null;
}

/**
 * List API manifests for a blueprint (or all if blueprintId omitted).
 * @param {string} [blueprintId]
 */
function listApiManifests(blueprintId) {
    const records  = _loadStore();
    const filtered = blueprintId ? records.filter(r => r.blueprintId === blueprintId) : records;
    return filtered.map(r => ({
        apiId:         r.apiId,
        apiMethod:     r.apiMethod,
        apiPath:       r.apiPath,
        description:   r.description,
        featureIds:    r.featureIds,
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
    planApi,
    implementApi,
    implementAllApis,
    getApiManifest,
    listApiManifests,
};
