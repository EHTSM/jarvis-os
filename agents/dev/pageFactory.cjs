"use strict";
/**
 * Page Factory — converts blueprint pages into complete frontend implementations
 * executed through the existing projectRunner pipeline.
 *
 * Entry points:
 *   planPage(pageId, blueprintId)             — pure: page → implementation task graph
 *   implementPage(pageId, blueprintId, opts)  — plan → execute via projectRunner
 *   implementAllPages(blueprintId, opts)      — implement every page sequentially
 *   getPageManifest(pageId, blueprintId)      — retrieve stored manifest
 *   listPageManifests(blueprintId)            — list manifests for a blueprint
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()   (page + API + feature source)
 *   - projectRunner.runProject({ plan })  (pre-built plan bypass)
 *   - specialist routing                  (frontend/* → frontend-specialist)
 *   - wave scheduler                      (T1‖T2 wave 0, T3‖T4 wave 1, T6‖T7 wave 3)
 *
 * No new architecture. No agent army. No AI calls — pure derivation only.
 *
 * Page type classification (pure, from feature + API analysis):
 *   "dashboard"  — multiple features, mixed GET/POST → summary cards + data table
 *   "crud"       — single feature with GET + POST    → data table + create form
 *   "form-only"  — single feature, POST only          → standalone form
 *   "read-only"  — GET only                           → data table or list
 *   "analytics"  — analytics feature                  → chart + metrics cards
 *
 * Task decomposition per page (7 tasks):
 *
 *   T1  [frontend]  Page shell         — frontend/src/pages/<name>.jsx
 *                   Import declarations, component layout skeleton, route export
 *
 *   T2  [frontend]  API hook           — frontend/src/hooks/use<Name>.js
 *                   Custom React hook: useData() + useMutation() bound to page's APIs
 *                   Handles loading, error, refetch, optimistic update
 *
 *   T3  [frontend]  Display component  — frontend/src/components/<name>/DataView.jsx
 *                   Table/list/chart/cards based on page type and fetched data shape
 *
 *   T4  [frontend]  Form component     — frontend/src/components/<name>/ActionForm.jsx
 *                   Controlled form for write APIs; empty-state component for read-only
 *
 *   T5  [frontend]  Full integration   — frontend/src/pages/<name>.jsx (update)
 *                   Wire hook + DataView + ActionForm into page with complete state flow
 *
 *   T6  [frontend]  Page tests         — tests/pages/<name>.test.cjs
 *                   node:test: render assertion, data fetch mock, form submit mock
 *
 *   T7  [general]   Page manifest      — frontend/src/pages/<name>.manifest.json
 *                   Component tree, API bindings, state shape, prop interfaces
 *
 * Dependency structure (drives wave scheduler):
 *   T1, T2   — wave 0  (parallel — both are leaf tasks)
 *   T3, T4   — wave 1  (parallel — both depend only on T1)
 *   T5       — wave 2  (depends on T2 + T3 + T4)
 *   T6, T7   — wave 3  (parallel — both depend on T5)
 *
 * Storage: data/page-manifests.json  (max 100, keyed pageId+blueprintId)
 */

const fs   = require("fs");
const path = require("path");

function _bp()     { return require("./blueprintGenerator.cjs"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/page-manifests.json");
const MAX_REC    = 100;

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

function _persist(record) {
    const records = _loadStore();
    const idx = records.findIndex(r => r.pageId === record.pageId && r.blueprintId === record.blueprintId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── Page analyser ─────────────────────────────────────────────────
// Classifies the page type and extracts its API bindings.
// Pure — no I/O.

function _classifyPageType(page, apis) {
    const pageApis    = apis.filter(a => (a.featureIds || []).some(fid => (page.featureIds || []).includes(fid)));
    const hasManyFeat = (page.featureIds || []).length > 1;
    const hasPOST     = pageApis.some(a => ["POST", "PUT", "PATCH"].includes(a.method));
    const hasGET      = pageApis.some(a => a.method === "GET");
    const isAnalytics = (page.featureIds || []).some(fid => {
        // analytics if any bound feature name contains "analytic" or "revenue" or "mrr"
        return false; // resolved via feature name below in _analysePage
    });
    const pageName    = page.name.toLowerCase();

    if (pageName.includes("analytic") || pageName.includes("dashboard") && !hasPOST) return "analytics";
    if (pageName.includes("dashboard")) return "dashboard";
    if (hasManyFeat && hasGET)          return "dashboard";
    if (hasGET && hasPOST)              return "crud";
    if (hasPOST && !hasGET)             return "form-only";
    return "read-only";
}

function _analysePage(page, blueprint) {
    const allApis   = blueprint.apis || [];
    const allFeat   = blueprint.features || [];
    const allTables = blueprint.database?.tables || [];

    // APIs bound to this page (via shared featureIds)
    const pageApis = allApis.filter(a =>
        (a.featureIds || []).some(fid => (page.featureIds || []).includes(fid))
    );

    // GET APIs → data sources; POST/PUT/PATCH APIs → mutation endpoints
    const getApis  = pageApis.filter(a => a.method === "GET");
    const postApis = pageApis.filter(a => ["POST", "PUT", "PATCH"].includes(a.method));

    // Features bound to this page
    const features = allFeat.filter(f => (page.featureIds || []).includes(f.id));

    // Tables relevant to this page (via shared featureIds)
    const tables = allTables.filter(t =>
        (t.featureIds || []).some(fid => (page.featureIds || []).includes(fid))
    );

    // Resolve page type (override analytics if feature name matches)
    let pageType = _classifyPageType(page, allApis);
    if (features.some(f => f.name.toLowerCase().includes("analytic") || f.name.toLowerCase().includes("mrr"))) {
        pageType = "analytics";
    }

    // Safe component name (PascalCase)
    const compName = page.name.replace(/\s+/g, "");
    // Safe hook name (camelCase)
    const hookName = `use${compName}`;
    // Safe file name (lowercase, no spaces)
    const fileName = page.name.toLowerCase().replace(/\s+/g, "");

    return {
        page, pageType, compName, hookName, fileName,
        pageApis, getApis, postApis, features, tables,
        // Primary GET endpoint (the main data source)
        primaryGet:  getApis[0]  || null,
        // Primary POST endpoint (the main mutation)
        primaryPost: postApis[0] || null,
    };
}

// ── File path deriver ─────────────────────────────────────────────
function _pageFilePaths(info) {
    const { fileName, compName } = info;
    return {
        shellFile:     `frontend/src/pages/${fileName}.jsx`,
        hookFile:      `frontend/src/hooks/${info.hookName}.js`,
        displayFile:   `frontend/src/components/${fileName}/DataView.jsx`,
        formFile:      `frontend/src/components/${fileName}/ActionForm.jsx`,
        stylesFile:    `frontend/src/components/${fileName}/styles.css`,
        testFile:      `tests/pages/${fileName}.test.cjs`,
        manifestFile:  `frontend/src/pages/${fileName}.manifest.json`,
    };
}

// ── Task builders ─────────────────────────────────────────────────

// T1: Page shell — layout skeleton with import stubs
function _buildShellDesc(info, fp) {
    const { page, compName, pageType, features, pageApis } = info;
    const importList = [
        `import { use${compName} } from '../hooks/${info.hookName}'`,
        `import DataView from '../components/${info.fileName}/DataView'`,
        `import ActionForm from '../components/${info.fileName}/ActionForm'`,
    ].join("; ");

    return (
        `Create the page shell in ${fp.shellFile}. ` +
        `Export default function ${compName}() that: ` +
        `(1) Imports: ${importList}. ` +
        `(2) Calls const { data, loading, error, mutate } = ${info.hookName}(). ` +
        `(3) Returns JSX with: a <header> containing an <h1>${page.name}</h1>; ` +
        `a <main> containing {loading && <p>Loading...</p>}, ` +
        `{error && <p className="error">{error}</p>}, ` +
        `{data && <DataView data={data} />}` +
        (info.primaryPost ? `, and <ActionForm onSubmit={mutate} />` : "") +
        `. ` +
        `(4) Import and apply styles from ../components/${info.fileName}/styles.css. ` +
        `Page type: ${pageType}. Features: ${features.map(f => f.name).join(", ")}. ` +
        `Keep state management minimal in the shell — delegate to the hook.`
    );
}

// T2: API hook — custom React hook binding page's APIs
function _buildHookDesc(info, fp) {
    const { hookName, getApis, postApis, primaryGet, primaryPost, pageType } = info;

    const fetchCall = primaryGet
        ? `api.get('${primaryGet.path}').then(r => setData(r.data.data))`
        : "/* no GET endpoint — data loaded elsewhere */";

    const mutateCall = primaryPost
        ? `api.post('${primaryPost.path}', formData).then(r => { setData(prev => [...prev, r.data.data]); })`
        : "/* read-only page — no mutation */";

    const extraGets = getApis.slice(1).map(a =>
        `const [${a.path.split("/").pop()}Data, set${a.path.split("/").pop().charAt(0).toUpperCase() + a.path.split("/").pop().slice(1)}Data] = useState([]); useEffect(() => { api.get('${a.path}').then(r => set${a.path.split("/").pop().charAt(0).toUpperCase() + a.path.split("/").pop().slice(1)}Data(r.data.data || [])).catch(() => {}); }, []);`
    ).join(" ");

    return (
        `Create ${fp.hookFile}. Export default function ${hookName}() that: ` +
        `(1) Imports useState, useEffect, useCallback from 'react' and api from '../api/client'. ` +
        `(2) Declares: const [data, setData] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null). ` +
        `(3) useEffect on mount: setLoading(true); ${fetchCall}.catch(e => setError(e.message)).finally(() => setLoading(false)). ` +
        (primaryPost
            ? `(4) const mutate = useCallback(async (formData) => { ${mutateCall} }, []). `
            : "(4) const mutate = null. ") +
        (extraGets ? `(5) Additional data sources: ${extraGets} ` : "") +
        `Returns { data, loading, error, mutate${getApis.length > 1 ? ", ...extraData" : ""} }. ` +
        `Page type: ${pageType}. Bound GET APIs: ${getApis.map(a => a.method + " " + a.path).join(", ") || "none"}. ` +
        `Bound POST APIs: ${postApis.map(a => a.method + " " + a.path).join(", ") || "none"}.`
    );
}

// T3: Display component — renders fetched data based on page type
function _buildDisplayDesc(info, fp) {
    const { pageType, compName, tables, features, primaryGet } = info;
    const tableName   = tables[0]?.name || "items";
    const cols        = tables[0]?.columns.filter(c => c !== "id") || ["name"];
    const colHeaders  = cols.map(c => `<th>${c}</th>`).join("");
    const colCells    = cols.map(c => `<td>{row.${c}}</td>`).join("");

    if (pageType === "analytics") {
        const metricCols = cols.filter(c => c.includes("amount") || c.includes("price") || c.includes("count") || c.includes("revenue") || c.includes("mrr"));
        return (
            `Create ${fp.displayFile}. Export default function DataView({ data }) that: ` +
            `(1) Renders a <div className="analytics-view"> containing: ` +
            `a <div className="metric-cards"> with one <div className="metric-card"> per item in data showing key=value pairs; ` +
            `a <div className="data-table"> with a <table> showing all data rows with columns [${cols.join(", ")}]; ` +
            `a <p className="summary">Total records: {data?.length || 0}</p>. ` +
            `(2) Handle empty data: show <p className="empty">No analytics data available.</p>. ` +
            `(3) Accepts prop: data (array). PropTypes optional. ` +
            `This is the analytics/read-only display for ${compName}.`
        );
    }

    if (pageType === "dashboard") {
        return (
            `Create ${fp.displayFile}. Export default function DataView({ data }) that: ` +
            `(1) Renders a <div className="dashboard-view"> containing: ` +
            `a <div className="summary-cards"> with summary cards: one card per feature area (${features.map(f => f.name).join(", ")}) showing count badges; ` +
            `a <div className="data-table"> with a <table> for the primary data list (${tableName}) with headers [${cols.join(", ")}] ` +
            `and rows: {data?.map(row => <tr key={row.id}>${colCells}</tr>)}. ` +
            `(2) Handle empty data: show <p className="empty">No ${tableName} found.</p>. ` +
            `(3) Accepts props: data (array). ` +
            `This is the dashboard overview for ${compName}.`
        );
    }

    // crud / read-only: data table
    return (
        `Create ${fp.displayFile}. Export default function DataView({ data, onSelect }) that: ` +
        `(1) Renders a <div className="data-view"> containing a <table> with: ` +
        `<thead><tr>${colHeaders}<th>Actions</th></tr></thead> and ` +
        `<tbody>{data?.map(row => <tr key={row.id}>${colCells}<td><button onClick={() => onSelect?.(row)}>Edit</button></td></tr>)}</tbody>. ` +
        `(2) Shows <p className="empty">No ${tableName} yet.</p> when data is empty or null. ` +
        `(3) Accepts props: data (array), onSelect (function, optional). ` +
        `Add a simple <input placeholder="Search..." onChange={e => ...} /> above the table for client-side filtering on the ${cols[0]} column.`
    );
}

// T4: Form component — controlled form for write APIs (or empty state for read-only)
function _buildFormDesc(info, fp) {
    const { pageType, compName, primaryPost, tables, postApis } = info;

    if (!primaryPost || pageType === "read-only" || pageType === "analytics") {
        return (
            `Create ${fp.formFile}. Export default function ActionForm() that: ` +
            `(1) Returns a <div className="empty-action"><p>No actions available for this view.</p></div>. ` +
            `This page is read-only — no mutation form is required.`
        );
    }

    const cols   = tables[0]?.columns.filter(c => c !== "id" && !c.endsWith("_at")) || ["name"];
    const fields = cols.map(col => {
        if (col.includes("email")) return `<label>${col}: <input type="email" name="${col}" value={form.${col}} onChange={handleChange} required /></label>`;
        if (col.includes("amount") || col.includes("price")) return `<label>${col}: <input type="number" name="${col}" min="0" step="0.01" value={form.${col}} onChange={handleChange} required /></label>`;
        if (col.includes("status")) return `<label>${col}: <select name="${col}" value={form.${col}} onChange={handleChange}><option value="active">active</option><option value="inactive">inactive</option></select></label>`;
        if (col.endsWith("_id")) return `<label>${col}: <input type="number" name="${col}" value={form.${col}} onChange={handleChange} required /></label>`;
        return `<label>${col}: <input type="text" name="${col}" value={form.${col}} onChange={handleChange} required /></label>`;
    }).join(" ");

    const initialState = "{" + cols.map(c => `${c}: ""`).join(", ") + "}";

    return (
        `Create ${fp.formFile}. Export default function ActionForm({ onSubmit }) that: ` +
        `(1) Declares const [form, setForm] = useState(${initialState}); const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState(null). ` +
        `(2) const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value })). ` +
        `(3) const handleSubmit = async e => { e.preventDefault(); setSubmitting(true); setFormError(null); try { await onSubmit?.(form); setForm(${initialState}); } catch(err) { setFormError(err.message); } finally { setSubmitting(false); } }. ` +
        `(4) Returns a <form onSubmit={handleSubmit} className="action-form"> containing: ` +
        `${fields} ` +
        `{formError && <p className="form-error">{formError}</p>} ` +
        `<button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</button>. ` +
        `This form submits to: ${primaryPost.method} ${primaryPost.path}. ` +
        `Page: ${compName}. ` +
        `Imports: useState from 'react'.`
    );
}

// T5: Full integration — wire all parts into the page shell
function _buildIntegrationDesc(info, fp) {
    const { compName, pageType, hookName, primaryPost, getApis, postApis, features } = info;
    return (
        `Update ${fp.shellFile} to wire all components together with full state flow. ` +
        `The page must: ` +
        `(1) Call const { data, loading, error, mutate } = ${hookName}(). ` +
        `(2) Manage local UI state: const [selected, setSelected] = useState(null); const [showForm, setShowForm] = useState(false). ` +
        (primaryPost
            ? `(3) Handle form submission: const handleSubmit = async (formData) => { await mutate(formData); setShowForm(false); }. `
            : "(3) No form submission handler needed (read-only page). ") +
        `(4) Render the full page: ` +
        `<div className="${info.fileName}-page"> ` +
        `<header><h1>${info.page.name}</h1>` +
        (primaryPost ? `<button onClick={() => setShowForm(s => !s)}>+ New</button>` : "") +
        `</header> ` +
        `{loading && <div className="loading-spinner">Loading...</div>} ` +
        `{error && <div className="error-banner">{error}</div>} ` +
        `{!loading && <DataView data={data} onSelect={setSelected} />} ` +
        (primaryPost ? `{showForm && <ActionForm onSubmit={handleSubmit} />}` : "") +
        `</div>. ` +
        `(5) The component must be fully self-contained — no props required. ` +
        `Page type: ${pageType}. ` +
        `Data sources: ${getApis.map(a => a.path).join(", ") || "none"}. ` +
        `Mutations: ${postApis.map(a => a.path).join(", ") || "none"}.`
    );
}

// T6: Page tests
function _buildTestDesc(info, fp) {
    const { compName, pageType, hookName, primaryGet, primaryPost, features } = info;
    const dataShape = `[{ id: 1, ${(info.tables[0]?.columns.filter(c => c !== "id").slice(0, 2) || ["name"]).map(c => `${c}: "test"`).join(", ")} }]`;

    return (
        `Create ${fp.testFile} with a node:test suite for the ${compName} page. ` +
        `Import the page component from ${fp.shellFile}. ` +
        `Mock the API client at frontend/src/api/client.js to return controlled data. ` +
        `Test cases: ` +
        `(1) Renders without crashing — import ${compName} and verify it is a function. ` +
        `(2) Hook data loading — mock api.get('${primaryGet?.path || "/api/data"}') to return { data: { data: ${dataShape} } }; verify the hook resolves loading=false and data has the expected shape. ` +
        (primaryPost
            ? `(3) Form submission — mock api.post('${primaryPost.path}') to return { data: { data: { id: 99 } } }; call mutate({ ${(info.tables[0]?.columns.filter(c => c !== "id").slice(0, 2) || ["name"]).map(c => `${c}: "test"`).join(", ")} }); verify data array length increases. `
            : "") +
        `(${primaryPost ? "4" : "3"}) Error handling — mock api.get to reject with 'Network error'; verify error state is set. ` +
        `Use node:assert for assertions. Use async test() blocks. No React rendering framework required — test the hook and data logic directly.`
    );
}

// T7: Page manifest
function _buildManifestDesc(info, fp) {
    const { compName, pageType, hookName, getApis, postApis, features, tables } = info;
    const componentTree = JSON.stringify({
        page:       compName,
        shell:      fp.shellFile,
        hook:       fp.hookFile,
        components: [fp.displayFile, fp.formFile],
    });
    const apiBindings = JSON.stringify(
        [...getApis.map(a => ({ method: a.method, path: a.path, role: "data-source" })),
         ...postApis.map(a => ({ method: a.method, path: a.path, role: "mutation" }))]
    );
    const stateShape = JSON.stringify({
        data: "array", loading: "boolean", error: "string|null", mutate: "function|null", selected: "object|null", showForm: "boolean"
    });

    return (
        `Create ${fp.manifestFile} as a valid JSON file documenting the ${compName} page. ` +
        `Include: ` +
        `"pageId": "${info.page.id}", ` +
        `"pageName": "${info.page.name}", ` +
        `"route": "${info.page.route}", ` +
        `"pageType": "${pageType}", ` +
        `"componentTree": ${componentTree}, ` +
        `"apiBindings": ${apiBindings}, ` +
        `"stateShape": ${stateShape}, ` +
        `"features": [${features.map(f => `"${f.name}"`).join(", ")}], ` +
        `"tables": [${tables.map(t => `"${t.name}"`).join(", ")}]. ` +
        `Write valid JSON only — no comments.`
    );
}

// ── Full task graph builder ───────────────────────────────────────
function _buildPageTaskGraph(page, blueprint, base = 1) {
    const info = _analysePage(page, blueprint);
    const fp   = _pageFilePaths(info);

    const t1 = { seq: base,     request: _buildShellDesc(info, fp),       description: `Page shell for ${page.name}`,          dependsOn: [],                           filePath: fp.shellFile    };
    const t2 = { seq: base + 1, request: _buildHookDesc(info, fp),        description: `API hook ${info.hookName}`,            dependsOn: [],                           filePath: fp.hookFile     };
    const t3 = { seq: base + 2, request: _buildDisplayDesc(info, fp),     description: `DataView component for ${page.name}`, dependsOn: [base],                       filePath: fp.displayFile  };
    const t4 = { seq: base + 3, request: _buildFormDesc(info, fp),        description: `ActionForm component for ${page.name}`,dependsOn: [base],                       filePath: fp.formFile     };
    const t5 = { seq: base + 4, request: _buildIntegrationDesc(info, fp), description: `Full integration for ${page.name}`,   dependsOn: [base + 1, base + 2, base + 3], filePath: fp.shellFile  };
    const t6 = { seq: base + 5, request: _buildTestDesc(info, fp),        description: `Page tests for ${page.name}`,          dependsOn: [base + 4],                   filePath: fp.testFile     };
    const t7 = { seq: base + 6, request: _buildManifestDesc(info, fp),    description: `Page manifest for ${page.name}`,       dependsOn: [base + 4],                   filePath: fp.manifestFile };

    return { tasks: [t1, t2, t3, t4, t5, t6, t7], info, fp };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Build the implementation task graph for a single page. Pure — no AI, no I/O.
 *
 * @param {string} pageId
 * @param {string} blueprintId
 * @returns {{ pageId, pageName, pageType, blueprintId, tasks[], filePaths, info, plannedAt }}
 */
function planPage(pageId, blueprintId) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    const page = blueprint.pages?.find(p => p.id === pageId);
    if (!page) throw new Error(`Page ${pageId} not found in blueprint ${blueprintId}`);

    const { tasks, info, fp } = _buildPageTaskGraph(page, blueprint, 1);

    console.log(`[PageFactory] plan: "${page.name}" [${info.pageType}] — ${tasks.length} tasks`);
    tasks.forEach(t => console.log(`[PageFactory]   T${t.seq} [deps=${t.dependsOn.join(",") || "∅"}] ${t.description}`));

    return {
        pageId,
        pageName:   page.name,
        pageType:   info.pageType,
        route:      page.route,
        blueprintId,
        productName: blueprint.productName,
        apiBindings: { get: info.getApis, post: info.postApis },
        features:    info.features.map(f => ({ id: f.id, name: f.name })),
        tasks,
        filePaths:   fp,
        plannedAt:   new Date().toISOString(),
    };
}

/**
 * Plan + execute implementation of a single page through projectRunner.
 *
 * @param {string} pageId
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ pageManifest, projectRun }}
 */
async function implementPage(pageId, blueprintId, opts = {}) {
    const plan      = planPage(pageId, blueprintId);
    const blueprint = _bp().getBlueprint(blueprintId);
    const page      = blueprint.pages.find(p => p.id === pageId);
    const runner    = _runner();

    console.log(`[PageFactory] implementing "${page.name}" [${plan.pageType}]`);

    const projectRun = await runner.runProject(
        `Implement ${page.name} page for ${blueprint.productName}`,
        {
            plan:         plan.tasks,
            projectName:  `${blueprint.productName} — ${page.name} Page`,
            blueprintId,
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            deployAtEnd:  opts.deployAtEnd  ?? false,
            testCommand:  opts.testCommand,
            operatorId:   opts.operatorId   ?? "page-factory",
        }
    );

    const manifest = {
        pageId,
        pageName:      page.name,
        pageType:      plan.pageType,
        route:         page.route,
        blueprintId,
        productName:   blueprint.productName,
        projectId:     projectRun.projectId,
        status:        projectRun.ok ? "implemented" : "partial",
        apiBindings:   plan.apiBindings,
        features:      plan.features,
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
    console.log(`[PageFactory] "${page.name}" — ${manifest.status} (${manifest.completed}/${plan.tasks.length})`);
    return { pageManifest: manifest, projectRun };
}

/**
 * Implement all pages in a blueprint sequentially.
 *
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ blueprintId, results[] }}
 */
async function implementAllPages(blueprintId, opts = {}) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    console.log(`[PageFactory] implementing all ${blueprint.pages?.length ?? 0} pages for "${blueprint.productName}"`);

    const results = [];
    for (const page of (blueprint.pages ?? [])) {
        try {
            const { pageManifest } = await implementPage(page.id, blueprintId, opts);
            results.push({ pageId: page.id, pageName: page.name, pageType: pageManifest.pageType, status: pageManifest.status, projectId: pageManifest.projectId });
        } catch (err) {
            console.log(`[PageFactory] "${page.name}" failed: ${err.message}`);
            results.push({ pageId: page.id, pageName: page.name, status: "error", error: err.message });
        }
    }

    return { blueprintId, productName: blueprint.productName, results };
}

/** Retrieve a page manifest by pageId + blueprintId. */
function getPageManifest(pageId, blueprintId) {
    return _loadStore().find(r => r.pageId === pageId && r.blueprintId === blueprintId) || null;
}

/** List page manifests for a blueprint. */
function listPageManifests(blueprintId) {
    const records  = _loadStore();
    const filtered = blueprintId ? records.filter(r => r.blueprintId === blueprintId) : records;
    return filtered.map(r => ({
        pageId:        r.pageId,
        pageName:      r.pageName,
        pageType:      r.pageType,
        route:         r.route,
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
    planPage,
    implementPage,
    implementAllPages,
    getPageManifest,
    listPageManifests,
};
