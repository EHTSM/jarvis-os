"use strict";
/**
 * Product Assembly Engine — cross-links all V3 factory manifests into a
 * coherent, verifiable product model and executes the final assembly tasks
 * through the existing projectRunner pipeline.
 *
 * Entry points:
 *   readinessReport(blueprintId)           — pure: cross-link verify → structured report
 *   assembleProduct(blueprintId, opts)     — verify → assembly tasks → projectRunner → manifest
 *   getProductManifest(blueprintId)        — retrieve stored assembly result
 *   listProductManifests(opts)             — list recent assembly results
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()   (source of truth)
 *   - All factory manifest stores         (api-manifests, db-manifests, page-manifests,
 *                                          features, skeletons — read-only)
 *   - projectRunner.runProject({ plan })  (pre-built plan bypass for assembly tasks)
 *   - specialist routing                  (files determine domain automatically)
 *   - wave scheduler                      (T1‖T3‖T4‖T5 wave 0, T2 wave 1)
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Verification checks (readinessReport):
 *   ✓ Blueprint exists
 *   ✓ Skeleton generated (skeletons.json)
 *   ✓ Each feature has ≥1 API, ≥1 page, ≥1 table
 *   ✓ Each page is bound to ≥1 API (page.featureIds ∩ api.featureIds)
 *   ✓ Each API is backed by ≥1 DB table (api.featureIds ∩ table.featureIds)
 *   ✓ Each table has a DB manifest (db-manifests.json)
 *   ✓ Each API has an API manifest (api-manifests.json)
 *   ✓ Each page has a page manifest (page-manifests.json)
 *   ✓ Each feature has a feature manifest (features.json)
 *   ∼ Gap detection: unimplemented features/APIs/pages reported as warnings
 *
 * Assembly task graph (5 tasks, 2 waves):
 *
 *   Wave 0 (parallel):
 *   T1 [backend]  Route registry   — backend/routes/index.js
 *                 Requires and mounts every feature route under /api/<feature>
 *
 *   T2 [devops]   Env config       — .env.example (update)
 *                 Adds all env vars required by the assembled product
 *
 *   T3 [devops]   Start script     — scripts/start.sh
 *                 npm install → migrate → seed → start
 *
 *   T4 [general]  Product manifest — product.manifest.json
 *                 Cross-linked model: pages→APIs→tables, dep graph, gaps
 *
 *   Wave 1 (after T1):
 *   T5 [backend]  Server wiring    — backend/server.js (update)
 *                 Import route registry, mount /api, mount error handler
 *
 * Storage: data/product-manifests.json  (max 20, keyed blueprintId)
 */

const fs   = require("fs");
const path = require("path");

function _bp()     { return require("./blueprintGenerator.cjs"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Manifest store readers (all read-only) ───────────────────────
const DATA_DIR = path.join(__dirname, "../../data");

function _readJson(file) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")); } catch { return []; }
}

function _apiManifests()   { return _readJson("api-manifests.json"); }
function _dbManifests()    { return _readJson("db-manifests.json"); }
function _pageManifests()  { return _readJson("page-manifests.json"); }
function _featManifests()  { return _readJson("features.json"); }
function _skeletons()      { return _readJson("skeletons.json"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(DATA_DIR, "product-manifests.json");
const MAX_REC    = 20;

function _loadStore() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); } catch { return []; }
}

function _saveStore(records) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(records.slice(0, MAX_REC), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persist(record) {
    const records = _loadStore();
    const idx = records.findIndex(r => r.blueprintId === record.blueprintId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── Cross-link verifier ───────────────────────────────────────────
// Pure — reads all manifest stores and the blueprint, builds a dependency
// graph, and returns a structured verification result.
//
// @returns {VerificationResult}
//   {
//     ok: boolean,
//     checks: [ { name, ok, detail } ],
//     gaps: [ { type, id, name, missing } ],
//     links: { pageToApis, apiToTables, featureCoverage },
//     stats: { features, pages, apis, tables, implemented: {...} }
//   }

function _verify(blueprint) {
    const checks = [];
    const gaps   = [];

    const features = blueprint.features || [];
    const pages    = blueprint.pages    || [];
    const apis     = blueprint.apis     || [];
    const tables   = (blueprint.database?.tables) || [];
    const bpId     = blueprint.blueprintId;

    // Load all manifest stores once
    const apiMans  = _apiManifests().filter(m => m.blueprintId === bpId);
    const dbMans   = _dbManifests().filter(m => m.blueprintId === bpId);
    const pageMans = _pageManifests().filter(m => m.blueprintId === bpId);
    const featMans = _featManifests().filter(m => m.blueprintId === bpId);
    const skelMans = _skeletons().filter(m => m.blueprintId === bpId);

    // ── Check 1: Skeleton ─────────────────────────────────────────
    const hasSkeleton = skelMans.length > 0;
    checks.push({ name: "skeleton_generated", ok: hasSkeleton, detail: hasSkeleton ? `${skelMans[0].stats?.total} files written` : "No skeleton found — run POST /runtime/skeleton/generate first" });

    // ── Check 2: Feature coverage ─────────────────────────────────
    // Each feature needs ≥1 page, ≥1 API, ≥1 table
    for (const f of features) {
        const fPages  = pages.filter(p => (p.featureIds || []).includes(f.id));
        const fApis   = apis.filter(a => (a.featureIds || []).includes(f.id));
        const fTables = tables.filter(t => (t.featureIds || []).includes(f.id));
        const ok = fPages.length > 0 && fApis.length > 0 && fTables.length > 0;
        checks.push({
            name:   `feature_${f.id}_coverage`,
            ok,
            detail: `${f.name}: ${fPages.length} page(s), ${fApis.length} API(s), ${fTables.length} table(s)`,
        });
        if (!ok) {
            if (fPages.length === 0)  gaps.push({ type: "missing_page",  featureId: f.id, featureName: f.name, missing: "no page bound to this feature" });
            if (fApis.length === 0)   gaps.push({ type: "missing_api",   featureId: f.id, featureName: f.name, missing: "no API bound to this feature" });
            if (fTables.length === 0) gaps.push({ type: "missing_table", featureId: f.id, featureName: f.name, missing: "no DB table bound to this feature" });
        }
    }

    // ── Check 3: Page → API links ─────────────────────────────────
    const pageToApis = {};
    for (const p of pages) {
        const boundApis = apis.filter(a => (a.featureIds || []).some(fid => (p.featureIds || []).includes(fid)));
        pageToApis[p.id] = boundApis.map(a => ({ id: a.id, method: a.method, path: a.path }));
        const ok = boundApis.length > 0;
        checks.push({ name: `page_${p.id}_api_link`, ok, detail: `${p.name} → [${boundApis.map(a => a.method + " " + a.path).join(", ") || "NONE"}]` });
        if (!ok) gaps.push({ type: "unlinked_page", pageId: p.id, pageName: p.name, missing: "no API bound to this page's features" });
    }

    // ── Check 4: API → Table links ────────────────────────────────
    const apiToTables = {};
    for (const a of apis) {
        const boundTables = tables.filter(t => (t.featureIds || []).some(fid => (a.featureIds || []).includes(fid)));
        apiToTables[a.id] = boundTables.map(t => ({ id: t.id, name: t.name }));
        const ok = boundTables.length > 0;
        checks.push({ name: `api_${a.id}_table_link`, ok, detail: `${a.method} ${a.path} → [${boundTables.map(t => t.name).join(", ") || "NONE"}]` });
        if (!ok) gaps.push({ type: "unlinked_api", apiId: a.id, apiPath: a.path, missing: "no DB table bound to this API's features" });
    }

    // ── Check 5: Implementation manifests ─────────────────────────
    // API manifests
    for (const a of apis) {
        const man = apiMans.find(m => m.apiId === a.id);
        const ok  = !!man;
        checks.push({ name: `api_${a.id}_manifest`, ok, detail: ok ? `${a.method} ${a.path} implemented (${man.status})` : `${a.method} ${a.path} — no API manifest (not yet implemented)` });
        if (!ok) gaps.push({ type: "unimplemented_api", apiId: a.id, method: a.method, path: a.path, missing: "run POST /runtime/api/implement" });
    }

    // DB manifests
    const dbMan = dbMans[0];
    checks.push({ name: "db_manifest", ok: !!dbMan, detail: dbMan ? `DB implemented (${dbMan.status}, ${dbMan.tables?.length} tables)` : "No DB manifest — run POST /runtime/db/implement" });
    if (!dbMan) gaps.push({ type: "unimplemented_db", missing: "run POST /runtime/db/implement" });

    // Page manifests
    for (const p of pages) {
        const man = pageMans.find(m => m.pageId === p.id);
        const ok  = !!man;
        checks.push({ name: `page_${p.id}_manifest`, ok, detail: ok ? `${p.name} implemented (${man.status})` : `${p.name} — no page manifest (not yet implemented)` });
        if (!ok) gaps.push({ type: "unimplemented_page", pageId: p.id, pageName: p.name, missing: "run POST /runtime/page/implement" });
    }

    // Feature manifests
    for (const f of features) {
        const man = featMans.find(m => m.featureId === f.id);
        const ok  = !!man;
        checks.push({ name: `feature_${f.id}_manifest`, ok, detail: ok ? `${f.name} implemented (${man.status})` : `${f.name} — no feature manifest` });
        if (!ok) gaps.push({ type: "unimplemented_feature", featureId: f.id, featureName: f.name, missing: "run POST /runtime/feature/implement" });
    }

    // ── Summary ───────────────────────────────────────────────────
    const allOk = checks.every(c => c.ok);
    const stats = {
        features:      features.length,
        pages:         pages.length,
        apis:          apis.length,
        tables:        tables.length,
        implemented: {
            apis:     apiMans.length,
            pages:    pageMans.length,
            features: featMans.length,
            db:       dbMans.length,
            skeleton: skelMans.length,
        },
    };

    // Feature coverage map: featureId → { pages[], apis[], tables[] }
    const featureCoverage = {};
    for (const f of features) {
        featureCoverage[f.id] = {
            name:   f.name,
            pages:  pages.filter(p => (p.featureIds || []).includes(f.id)).map(p => p.id),
            apis:   apis.filter(a => (a.featureIds || []).includes(f.id)).map(a => a.id),
            tables: tables.filter(t => (t.featureIds || []).includes(f.id)).map(t => t.id),
        };
    }

    return {
        ok:    allOk,
        checks,
        gaps,
        links: { pageToApis, apiToTables, featureCoverage },
        stats,
    };
}

// ── Assembly task builders ────────────────────────────────────────

function _buildRouteRegistryTask(blueprint, seq) {
    const features  = blueprint.features || [];
    const requireLines = features.map(f => {
        const safeName = f.name.toLowerCase().replace(/\s+/g, "-");
        return `const ${safeName.replace(/-/g, "_")}Router = require('./${safeName}');`;
    }).join(" ");
    const mountLines = features.map(f => {
        const safeName = f.name.toLowerCase().replace(/\s+/g, "-");
        return `router.use('/${safeName}', ${safeName.replace(/-/g, "_")}Router);`;
    }).join(" ");

    return {
        seq,
        request: `Create backend/routes/index.js as a central route registry for ${blueprint.productName}. ` +
            `The file must: ` +
            `(1) Require express and create const router = express.Router(). ` +
            `(2) Require each feature route: ${requireLines} ` +
            `(3) Mount each route under its feature path: ${mountLines} ` +
            `(4) Export router as module.exports = router. ` +
            `This file is the single entry point mounted at /api in backend/server.js. ` +
            `Include a comment header: "// Auto-assembled route registry for ${blueprint.productName}".`,
        description: `Route registry — mounts ${features.length} feature routes under /api`,
        dependsOn:   [],
        filePath:    "backend/routes/index.js",
    };
}

function _buildServerWiringTask(blueprint, seq, registrySeq) {
    return {
        seq,
        request: `Update backend/server.js for ${blueprint.productName} to wire the assembled route registry. ` +
            `The server must: ` +
            `(1) Require the route registry: const routes = require('./routes/index'). ` +
            `(2) Mount it: app.use('/api', routes) — placed after middleware, before the /health route. ` +
            `(3) Require and mount the error handler: const { errorHandler } = require('./middleware/errorHandler'); app.use(errorHandler) — placed last, after all routes. ` +
            `(4) Ensure process.send('ready') is called inside app.listen callback (PM2 wait_ready support). ` +
            `(5) Log startup: console.log('[${blueprint.productName}] server ready on port \${PORT}'). ` +
            `Do not remove existing code — only add the route registry mount and error handler if missing.`,
        description: `Server wiring — mounts route registry and error handler`,
        dependsOn:   [registrySeq],
        filePath:    "backend/server.js",
    };
}

function _buildEnvConfigTask(blueprint, seq) {
    const features   = blueprint.features || [];
    const tables     = (blueprint.database?.tables) || [];
    const hasPayment = features.some(f => f.name.toLowerCase().includes("payment"));
    const safeName   = blueprint.productName.toUpperCase().replace(/\s+/g, "_");

    const envVars = [
        `PORT=3000`,
        `NODE_ENV=development`,
        `JWT_SECRET=change_me_${safeName.toLowerCase()}_jwt_secret`,
        `DATABASE_URL=./data/${blueprint.productName.toLowerCase().replace(/\s+/g, "-")}.db`,
        ...(hasPayment ? [`STRIPE_SECRET_KEY=sk_test_your_stripe_key_here`, `STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret`] : []),
        `CORS_ORIGIN=http://localhost:3001`,
        `LOG_LEVEL=info`,
        `SEED_ON_START=false`,
    ].join("\n");

    return {
        seq,
        request: `Update .env.example with all environment variables required by ${blueprint.productName}. ` +
            `Replace the existing content with:\n\n# ${blueprint.productName} environment configuration\n${envVars}\n\n` +
            `Add a comment block at the top explaining each variable. ` +
            `Include a section "# Feature flags" with FEATURE_${safeName}_PAYMENTS_ENABLED=false for payment features. ` +
            `Do not include actual secret values — use descriptive placeholders.`,
        description: `Environment config — all vars for ${blueprint.productName}`,
        dependsOn:   [],
        filePath:    ".env.example",
    };
}

function _buildStartScriptTask(blueprint, seq) {
    const safeName = blueprint.productName.toLowerCase().replace(/\s+/g, "-");
    return {
        seq,
        request: `Create scripts/start.sh as the product startup script for ${blueprint.productName}. ` +
            `The script must: ` +
            `(1) Start with #!/bin/bash and set -e (exit on error). ` +
            `(2) Print a banner: echo "Starting ${blueprint.productName}...". ` +
            `(3) Check .env exists: if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; fi. ` +
            `(4) Install dependencies: echo "Installing dependencies..." && npm install --production. ` +
            `(5) Run migrations: echo "Running migrations..." && node backend/db/migrate.js (create this call — the migrate.js reads all SQL files from backend/db/migrations/ and executes them). ` +
            `(6) Optionally seed: if [ "\$SEED_ON_START" = "true" ]; then echo "Seeding..." && node backend/db/seed.js; fi. ` +
            `(7) Start server: echo "Starting server..." && node backend/server.js. ` +
            `Make the script executable (note this at the top: chmod +x scripts/start.sh). ` +
            `Product: ${blueprint.productName}.`,
        description: `Startup script — install, migrate, seed, start`,
        dependsOn:   [],
        filePath:    "scripts/start.sh",
    };
}

function _buildProductManifestTask(blueprint, verification, seq) {
    const { links, stats, gaps } = verification;

    // Build a compact cross-link summary for the manifest content
    const pageLinks = (blueprint.pages || []).map(p => ({
        pageId:   p.id,
        pageName: p.name,
        route:    p.route,
        apis:     (links.pageToApis[p.id] || []).map(a => `${a.method} ${a.path}`),
        tables:   [...new Set((links.pageToApis[p.id] || []).flatMap(a =>
            (links.apiToTables[a.id] || []).map(t => t.name)
        ))],
    }));

    const manifestContent = JSON.stringify({
        productName:  blueprint.productName,
        blueprintId:  blueprint.blueprintId,
        version:      "1.0.0",
        assembledAt:  new Date().toISOString(),
        stats,
        readiness: {
            totalChecks:  verification.checks.length,
            passed:       verification.checks.filter(c => c.ok).length,
            gaps:         gaps.length,
            runnable:     gaps.filter(g => ["unimplemented_api","unimplemented_page","unimplemented_db"].includes(g.type)).length === 0,
        },
        pageLinks,
        featureCoverage:  links.featureCoverage,
        gaps:             gaps.map(g => ({ type: g.type, id: g.featureId || g.pageId || g.apiId || "n/a", missing: g.missing })),
        entryPoints: {
            backend:   "backend/server.js",
            frontend:  "frontend/src/App.jsx",
            routes:    "backend/routes/index.js",
            migration: "backend/db/migrations/",
            startup:   "scripts/start.sh",
        },
    }, null, 2);

    return {
        seq,
        request: `Create product.manifest.json at the repo root with the following exact content:\n\n${manifestContent}\n\nWrite this as valid JSON only — do not add comments or modify the content.`,
        description: `Product manifest — cross-linked model with ${pageLinks.length} pages, ${stats.apis} APIs, ${stats.tables} tables`,
        dependsOn:   [],
        filePath:    "product.manifest.json",
    };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Pure verification — cross-links all factory manifests and returns a
 * structured readiness report. No I/O beyond reading manifest JSON files.
 *
 * @param {string} blueprintId
 * @returns {ReadinessReport}
 */
function readinessReport(blueprintId) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    const verification = _verify(blueprint);

    const passed = verification.checks.filter(c => c.ok).length;
    const total  = verification.checks.length;
    const pct    = Math.round((passed / total) * 100);

    console.log(`[ProductAssembly] readiness: "${blueprint.productName}" — ${passed}/${total} checks (${pct}%)`);
    verification.checks.forEach(c => {
        console.log(`[ProductAssembly]   [${c.ok ? "✓" : "✗"}] ${c.name}: ${c.detail}`);
    });
    if (verification.gaps.length > 0) {
        console.log(`[ProductAssembly] gaps (${verification.gaps.length}):`);
        verification.gaps.forEach(g => console.log(`[ProductAssembly]   ! ${g.type}: ${g.missing}`));
    }

    return {
        blueprintId,
        productName:  blueprint.productName,
        ok:           verification.ok,
        passed,
        total,
        readinessPct: pct,
        checks:       verification.checks,
        gaps:         verification.gaps,
        links:        verification.links,
        stats:        verification.stats,
        generatedAt:  new Date().toISOString(),
    };
}

/**
 * Verify + assemble the product — runs 5 assembly tasks through projectRunner
 * and stores the product manifest.
 *
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ productManifest, projectRun, readiness }}
 */
async function assembleProduct(blueprintId, opts = {}) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    // 1. Verify first — gaps are reported but don't block assembly
    const verification = _verify(blueprint);
    const passed = verification.checks.filter(c => c.ok).length;
    console.log(`[ProductAssembly] assembling "${blueprint.productName}" — readiness ${passed}/${verification.checks.length}`);
    if (verification.gaps.length > 0) {
        console.log(`[ProductAssembly] ${verification.gaps.length} gap(s) detected (assembly proceeds — gaps recorded in manifest)`);
    }

    // 2. Build assembly task graph (5 tasks)
    const tasks = [
        _buildRouteRegistryTask(blueprint, 1),                // T1 wave 0
        _buildEnvConfigTask(blueprint, 2),                    // T2 wave 0 (parallel with T1)
        _buildStartScriptTask(blueprint, 3),                  // T3 wave 0 (parallel with T1, T2)
        _buildProductManifestTask(blueprint, verification, 4),// T4 wave 0 (parallel with T1-T3)
        _buildServerWiringTask(blueprint, 5, 1),              // T5 wave 1 (depends on T1)
    ];

    console.log(`[ProductAssembly] ${tasks.length} assembly tasks:`);
    tasks.forEach(t => console.log(`[ProductAssembly]   T${t.seq} [deps=${t.dependsOn.join(",") || "∅"}] ${t.description}`));

    // 3. Execute through projectRunner
    const runner     = _runner();
    const projectRun = await runner.runProject(
        `Assemble ${blueprint.productName} into runnable product`,
        {
            plan:         tasks,
            projectName:  `${blueprint.productName} — Product Assembly`,
            blueprintId,
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            deployAtEnd:  opts.deployAtEnd  ?? false,
            testCommand:  opts.testCommand,
            operatorId:   opts.operatorId   ?? "product-assembly",
        }
    );

    // 4. Build and store the product manifest
    const manifest = {
        blueprintId,
        productName:    blueprint.productName,
        projectId:      projectRun.projectId,
        status:         projectRun.ok ? "assembled" : "partial",
        readiness: {
            passed,
            total:        verification.checks.length,
            readinessPct: Math.round((passed / verification.checks.length) * 100),
            gaps:         verification.gaps.length,
            runnable:     verification.gaps.filter(g =>
                ["unimplemented_api","unimplemented_page","unimplemented_db"].includes(g.type)
            ).length === 0,
        },
        checks:         verification.checks,
        gaps:           verification.gaps,
        links:          verification.links,
        stats:          verification.stats,
        assemblyTasks:  tasks.map(t => ({ seq: t.seq, description: t.description, filePath: t.filePath })),
        completed:      projectRun.completed,
        failed:         projectRun.failed,
        coordinator:    projectRun.coordinator,
        waves:          projectRun.waves,
        entryPoints: {
            backend:   "backend/server.js",
            frontend:  "frontend/src/App.jsx",
            routes:    "backend/routes/index.js",
            startup:   "scripts/start.sh",
            manifest:  "product.manifest.json",
        },
        assembledAt:    new Date().toISOString(),
    };

    _persist(manifest);
    console.log(`[ProductAssembly] "${blueprint.productName}" — ${manifest.status} | readiness ${manifest.readiness.readinessPct}% | runnable: ${manifest.readiness.runnable}`);
    return { productManifest: manifest, projectRun, readiness: verification };
}

/** Retrieve a stored product manifest by blueprintId. */
function getProductManifest(blueprintId) {
    return _loadStore().find(r => r.blueprintId === blueprintId) || null;
}

/** List recent product manifests. */
function listProductManifests({ limit = 20 } = {}) {
    return _loadStore().slice(0, limit).map(r => ({
        blueprintId:   r.blueprintId,
        productName:   r.productName,
        projectId:     r.projectId,
        status:        r.status,
        readiness:     r.readiness,
        assembledAt:   r.assembledAt,
    }));
}

module.exports = {
    readinessReport,
    assembleProduct,
    getProductManifest,
    listProductManifests,
};
