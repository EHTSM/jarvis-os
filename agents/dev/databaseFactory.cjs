"use strict";
/**
 * Database Factory — converts blueprint database tables into a complete,
 * production-quality database layer executed through the existing projectRunner.
 *
 * Entry points:
 *   planDatabase(blueprintId)              — pure: blueprint → full DB task graph
 *   implementDatabase(blueprintId, opts)   — plan → execute via projectRunner
 *   getDatabaseManifest(blueprintId)       — retrieve stored manifest
 *   listDatabaseManifests(opts)            — list recent manifests
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()   (table + relationship source)
 *   - projectRunner.runProject({ plan })  (pre-built plan bypass)
 *   - wave scheduler                      (table dep graph → parallel table init)
 *   - specialist routing                  (all DB tasks → database-specialist)
 *
 * No new architecture. No agent army. No AI calls — pure derivation only.
 *
 * Task decomposition — 7 tasks per table, cross-table deps encoded in graph:
 *
 *   T1  [database]  Full migration  — backend/db/migrations/<N>_<table>.sql
 *                   CREATE TABLE with all constraints, CHECKs, NOT NULL, DEFAULT
 *
 *   T2  [database]  Index file      — backend/db/indexes/<table>.sql
 *                   CREATE INDEX on FK cols, status, email, commonly queried fields
 *
 *   T3  [database]  Seed file       — backend/db/seeds/<table>.js
 *                   10 realistic rows, auto-wires FK references
 *
 *   T4  [database]  FK checker      — backend/db/relationships/<table>.js
 *                   Runtime FK validation helper + relationship metadata
 *
 *   T5  [database]  DB tests        — tests/db/<table>.test.cjs
 *                   node:test: insert valid row, violate NOT NULL, violate FK,
 *                   verify CASCADE, query by index columns
 *
 *   T6  [database]  Health entry    — backend/db/health.js
 *                   Adds this table to the DB health check (runs on startup)
 *
 *   T7  [general]   DB manifest     — backend/db/schema/<table>.json
 *                   Machine-readable schema: columns, constraints, indexes, FK map
 *
 * Cross-table dependency rules (drives wave scheduler):
 *   Table with no FK columns              → wave 0 (no deps)
 *   Table whose FK col references table X → depends on all tasks of table X
 *   This mirrors the actual FK constraint order SQLite requires.
 *
 * Within-table dependency rules:
 *   T1 (migration) → no deps           — wave A
 *   T2 (indexes)   → T1               — wave A+1  ─┐
 *   T3 (seeds)     → T1               — wave A+1   │ parallel
 *   T4 (FK check)  → T1               — wave A+1  ─┘
 *   T5 (tests)     → T2, T3, T4       — wave A+2  ─┐ parallel
 *   T6 (health)    → T2               — wave A+2  ─┘
 *   T7 (manifest)  → T5, T6           — wave A+3
 *
 * Storage: data/db-manifests.json  (max 50, keyed blueprintId)
 */

const fs   = require("fs");
const path = require("path");

function _bp()     { return require("./blueprintGenerator.cjs"); }
function _runner() { return require("./projectRunner.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/db-manifests.json");
const MAX_REC    = 50;

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
    const idx = records.findIndex(r => r.blueprintId === record.blueprintId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── Schema analyser ───────────────────────────────────────────────
// Inspects a table's columns to derive constraints and relationships.
// Pure — no I/O.

function _analyseColumn(colName, allTableNames) {
    const c = colName.toLowerCase();
    // Detect FK: ends with _id and the prefix matches a known table name (singular or plural)
    if (c.endsWith("_id")) {
        const prefix = c.slice(0, -3); // strip _id
        // Match: customer_id → customers, plan_id → plans, subscription_id → subscriptions
        const refTable = allTableNames.find(t =>
            t === prefix || t === prefix + "s" || t === prefix + "es" || prefix === t.replace(/s$/, "") || prefix === t.replace(/es$/, "")
        );
        return { type: "fk", refTable: refTable || null, notNull: true };
    }
    if (c === "id")                             return { type: "pk" };
    if (c === "created_at" || c === "updated_at") return { type: "timestamp", default: "CURRENT_TIMESTAMP", notNull: true };
    if (c.includes("email"))                    return { type: "text", notNull: true, unique: true };
    if (c.includes("amount") || c.includes("price")) return { type: "real", notNull: true, default: "0", check: `${c} >= 0` };
    if (c.includes("status"))                   return { type: "text", notNull: true, default: "'active'", check: `${c} IN ('active','inactive','pending','cancelled','deleted')` };
    if (c.includes("name") || c.includes("title")) return { type: "text", notNull: true };
    if (c.includes("count") || c.includes("qty") || c.includes("quantity")) return { type: "integer", notNull: true, default: "0", check: `${c} >= 0` };
    if (c.includes("flag") || c.includes("enabled") || c.includes("active")) return { type: "integer", notNull: true, default: "1", check: `${c} IN (0,1)` };
    if (c.includes("url") || c.includes("path") || c.includes("link")) return { type: "text" };
    if (c.includes("description") || c.includes("notes") || c.includes("body")) return { type: "text" };
    if (c.includes("date") || c.includes("_at"))  return { type: "text" };
    return { type: "text", notNull: false };
}

function _analyseTable(table, allTableNames) {
    const cols   = {};
    const fks    = [];
    const indexes = [];

    for (const col of table.columns) {
        const meta = _analyseColumn(col, allTableNames);
        cols[col]  = meta;
        if (meta.type === "fk" && meta.refTable) {
            fks.push({ col, refTable: meta.refTable, refCol: "id" });
        }
        // Index columns: FKs, status, email, name, date fields
        if (meta.type === "fk" || meta.unique || col.includes("status") ||
            col.includes("email") || col === "created_at") {
            indexes.push(col);
        }
    }

    return { cols, fks, indexes };
}

// ── SQL migration builder ─────────────────────────────────────────
function _buildMigrationSQL(table, analysis, allTableNames) {
    const colDefs = table.columns.map(col => {
        const m = analysis.cols[col];
        if (!m) return `    ${col} TEXT`;
        if (m.type === "pk")        return `    ${col} INTEGER PRIMARY KEY AUTOINCREMENT`;
        if (m.type === "fk") {
            const ref = m.refTable ? `REFERENCES ${m.refTable}(id) ON DELETE CASCADE` : "";
            return `    ${col} INTEGER NOT NULL ${ref}`.trim();
        }
        if (m.type === "timestamp") return `    ${col} TEXT NOT NULL DEFAULT ${m.default}`;

        const parts = [`    ${col}`, m.type.toUpperCase()];
        if (m.notNull) parts.push("NOT NULL");
        if (m.unique)  parts.push("UNIQUE");
        if (m.default !== undefined) parts.push(`DEFAULT ${m.default}`);
        return parts.join(" ");
    });

    const checkClauses = table.columns
        .map(col => analysis.cols[col]?.check)
        .filter(Boolean)
        .map(c => `    CHECK(${c})`);

    const allDefs = [...colDefs, ...checkClauses];

    const indexSQL = analysis.indexes.map(col =>
        `CREATE INDEX IF NOT EXISTS idx_${table.name}_${col} ON ${table.name}(${col});`
    ).join("\n");

    return (
        `-- Migration: create ${table.name} table\n` +
        `-- Generated by databaseFactory\n\n` +
        `CREATE TABLE IF NOT EXISTS ${table.name} (\n` +
        `${allDefs.join(",\n")}\n` +
        `);\n\n` +
        (indexSQL ? `${indexSQL}\n\n` : "") +
        `-- Rollback: DROP TABLE IF EXISTS ${table.name};\n`
    );
}

// ── Seed data builder ─────────────────────────────────────────────
function _buildSeedDescription(table, analysis, allTables) {
    const nonIdCols = table.columns.filter(c => c !== "id" && !c.endsWith("_at"));
    const sampleRow = nonIdCols.map(col => {
        const m = analysis.cols[col];
        if (m?.type === "fk") return `${col}: <id from ${m.refTable}>`;
        if (col.includes("email")) return `${col}: "user<N>@example.com"`;
        if (col.includes("name")) return `${col}: "Sample ${table.name.slice(0, -1)} <N>"`;
        if (col.includes("price") || col.includes("amount")) return `${col}: <random 9.99–499.99>`;
        if (col.includes("status")) return `${col}: "active"`;
        return `${col}: "sample_value_<N>"`;
    }).join(", ");

    return (
        `Create ${table.name} seed file at backend/db/seeds/${table.name}.js. ` +
        `Export an async function seed${table.name.charAt(0).toUpperCase() + table.name.slice(1)}(db) that: ` +
        `(1) Checks if the table already has rows (SELECT COUNT(*) — skip if >0). ` +
        `(2) Inserts 5–10 realistic rows using db.prepare(...).run(). ` +
        `Row shape: { ${sampleRow} }. ` +
        `(3) Returns { seeded: true, count: N } or { seeded: false, reason: "already_seeded" }. ` +
        (analysis.fks.length > 0
            ? `(4) FK columns must reference existing IDs — call the seed for [${analysis.fks.map(f => f.refTable).join(", ")}] first or query their IDs. `
            : "") +
        `Use only the sqlite3 db instance passed in — no direct require of db/index.js here.`
    );
}

// ── Relationship checker builder ──────────────────────────────────
function _buildRelationshipDescription(table, analysis) {
    if (analysis.fks.length === 0) {
        return (
            `Create backend/db/relationships/${table.name}.js. ` +
            `Export a const RELATIONSHIPS = [] (empty — this table has no foreign keys). ` +
            `Also export a function validateRelationships(db, row) that returns { valid: true }. ` +
            `This file is required by the DB health module for consistency.`
        );
    }

    const fkChecks = analysis.fks.map(fk =>
        `(${analysis.fks.indexOf(fk) + 1}) Verify ${fk.col} references a real row: db.prepare("SELECT id FROM ${fk.refTable} WHERE id = ?").get(row.${fk.col}) — throw { code: 'FK_VIOLATION', field: '${fk.col}', refTable: '${fk.refTable}' } if null`
    ).join(". ");

    const relMeta = analysis.fks.map(fk =>
        `{ col: "${fk.col}", refTable: "${fk.refTable}", refCol: "id", onDelete: "CASCADE" }`
    ).join(", ");

    return (
        `Create backend/db/relationships/${table.name}.js. ` +
        `Export const RELATIONSHIPS = [${relMeta}]. ` +
        `Export async function validateRelationships(db, row) that: ${fkChecks}. ` +
        `Returns { valid: true } when all checks pass. ` +
        `This is called by the service layer before INSERT/UPDATE to enforce FK integrity at the application level.`
    );
}

// ── DB test builder ───────────────────────────────────────────────
function _buildTestDescription(table, analysis) {
    const insertCols = table.columns.filter(c => c !== "id" && !c.endsWith("_at"));
    const validRow   = insertCols.map(col => {
        const m = analysis.cols[col];
        if (m?.type === "fk") return `${col}: 1`;
        if (col.includes("email")) return `${col}: "test@example.com"`;
        if (col.includes("name")) return `${col}: "Test Name"`;
        if (col.includes("price") || col.includes("amount")) return `${col}: 9.99`;
        if (col.includes("status")) return `${col}: "active"`;
        return `${col}: "test_value"`;
    }).join(", ");

    const notNullCol = insertCols.find(col => analysis.cols[col]?.notNull && analysis.cols[col]?.type !== "fk");
    const fkCol      = analysis.fks[0];

    return (
        `Create tests/db/${table.name}.test.cjs with a node:test suite for the ${table.name} table. ` +
        `Import getDB from backend/db/index.js. Use beforeEach to open a fresh in-memory DB (new Database(':memory:')). ` +
        `Run the migration SQL from backend/db/migrations/*_${table.name}.sql before each test. ` +
        `Test cases: ` +
        `(1) Valid insert succeeds — insert { ${validRow} }, verify SELECT COUNT(*) = 1. ` +
        (notNullCol
            ? `(2) NOT NULL violation — omit ${notNullCol}, expect SQLITE_CONSTRAINT error. `
            : "") +
        (fkCol
            ? `(3) FK violation — set ${fkCol.col} = 99999 (non-existent), expect SQLITE_CONSTRAINT error. `
            : "") +
        (analysis.fks.some(f => f.refTable)
            ? `(4) CASCADE delete — delete parent row, verify child ${table.name} row is also deleted. `
            : "") +
        `(${analysis.fks.length > 0 ? "5" : "3"}) Index query — SELECT * WHERE ${analysis.indexes[0] || "id"} = <value>, verify result shape. ` +
        `Use test() blocks with descriptive names. Assert using node:assert.`
    );
}

// ── Health check builder ──────────────────────────────────────────
function _buildHealthDescription(table, analysis) {
    const colList = table.columns.join(", ");
    return (
        `Update backend/db/health.js to add a health check for the ${table.name} table. ` +
        `Export or extend a function checkDatabaseHealth(db) that: ` +
        `(1) Runs PRAGMA table_info(${table.name}) — verifies the table exists and has columns [${colList}]. ` +
        `(2) Checks the row count: SELECT COUNT(*) as count FROM ${table.name}. ` +
        `(3) Verifies all indexes exist: SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${table.name}'. ` +
        `(4) Returns a status object: { table: "${table.name}", exists: bool, columnCount: N, rowCount: N, indexCount: N }. ` +
        `The function must be callable at startup without throwing — catch all errors and return { table: "${table.name}", error: err.message } on failure.`
    );
}

// ── Manifest doc builder ──────────────────────────────────────────
function _buildManifestDescription(table, analysis) {
    const colMeta = table.columns.map(col => {
        const m = analysis.cols[col] || {};
        return `"${col}": { "type": "${m.type || "text"}", "notNull": ${!!m.notNull}, "unique": ${!!m.unique}${m.default !== undefined ? `, "default": "${m.default}"` : ""}${m.check ? `, "check": "${m.check}"` : ""}${m.type === "fk" ? `, "references": "${m.refTable}(id)"` : ""} }`;
    }).join(", ");

    const fkMeta = analysis.fks.map(fk =>
        `{ "column": "${fk.col}", "refTable": "${fk.refTable}", "refCol": "id", "onDelete": "CASCADE" }`
    ).join(", ");

    return (
        `Create backend/db/schema/${table.name}.json as a valid JSON file documenting the ${table.name} table schema. ` +
        `Include fields: ` +
        `"table": "${table.name}", ` +
        `"migrationFile": "backend/db/migrations/*_${table.name}.sql", ` +
        `"seedFile": "backend/db/seeds/${table.name}.js", ` +
        `"testFile": "tests/db/${table.name}.test.cjs", ` +
        `"columns": { ${colMeta} }, ` +
        `"foreignKeys": [${fkMeta}], ` +
        `"indexes": [${analysis.indexes.map(i => `"idx_${table.name}_${i}"`).join(", ")}]. ` +
        `Write valid JSON only — no comments, no trailing commas.`
    );
}

// ── Cross-table dependency resolver ──────────────────────────────
// Determines which tables must be fully initialised before a given table
// can be created (based on FK column references).
// Returns a Map: tableId → Set of tableIds it depends on.
function _buildTableDeps(tables) {
    const nameToId = new Map(tables.map(t => [t.name, t.id]));
    const allNames = tables.map(t => t.name);
    const deps     = new Map(tables.map(t => [t.id, new Set()]));

    for (const table of tables) {
        for (const col of table.columns) {
            const meta = _analyseColumn(col, allNames);
            if (meta.type === "fk" && meta.refTable) {
                const refId = nameToId.get(meta.refTable);
                if (refId && refId !== table.id) deps.get(table.id).add(refId);
            }
        }
    }

    return deps;
}

// ── Full task graph builder ───────────────────────────────────────
// Builds the complete task graph for all tables in the blueprint.
// Each table gets 7 tasks. Tasks across tables have cross-table deps
// so the wave scheduler runs independent tables in parallel.
//
// @param {object} blueprint
// @returns {object[]} tasks — projectRunner-compatible task[]
function _buildDatabaseTaskGraph(blueprint) {
    const tables   = blueprint.database?.tables ?? [];
    if (tables.length === 0) return [];

    const allNames  = tables.map(t => t.name);
    const tableDeps = _buildTableDeps(tables);

    // Assign a block of 7 seq numbers per table, in table order
    // baseSeq for table[i] = i * 7 + 1
    const TASKS_PER_TABLE = 7;
    const tableBaseSeq = new Map(tables.map((t, i) => [t.id, i * TASKS_PER_TABLE + 1]));

    // For cross-table deps: table B depends on table A means
    // T1(B) depends on T7(A) (the last task of A — manifest doc, meaning A is fully done)
    function lastSeqOf(tableId) {
        return tableBaseSeq.get(tableId) + TASKS_PER_TABLE - 1;
    }

    const tasks = [];

    for (const table of tables) {
        const base     = tableBaseSeq.get(table.id);
        const analysis = _analyseTable(table, allNames);
        const safeName = table.name.toLowerCase().replace(/\s+/g, "_");
        const tableIdx = tables.indexOf(table);
        const migSeq   = String(tableIdx + 1).padStart(3, "0");

        // Cross-table: this table's T1 depends on T7 of every table it references
        const crossDeps = [...tableDeps.get(table.id)].map(refId => lastSeqOf(refId));

        // ── T1: Full migration ────────────────────────────────────────
        const migSQL = _buildMigrationSQL(table, analysis, allNames);
        tasks.push({
            seq:         base,
            request:     `Replace the stub in backend/db/migrations/${migSeq}_${safeName}.sql with this complete migration SQL:\n\n${migSQL}\n\nEnsure the file matches this content exactly.`,
            description: `Full migration for ${table.name} with constraints and indexes`,
            dependsOn:   crossDeps,
            filePath:    `backend/db/migrations/${migSeq}_${safeName}.sql`,
        });

        // ── T2: Index file ────────────────────────────────────────────
        const indexSQL = analysis.indexes.length > 0
            ? analysis.indexes.map(col =>
                `CREATE INDEX IF NOT EXISTS idx_${table.name}_${col} ON ${table.name}(${col});`
              ).join("\n")
            : `-- No composite indexes required for ${table.name}`;

        tasks.push({
            seq:         base + 1,
            request:     `Create backend/db/indexes/${safeName}.sql with the following index definitions:\n\n${indexSQL}\n\nThis file is loaded separately from the migration to allow index-only rebuilds. Include a comment header: "-- Indexes for ${table.name}"`,
            description: `Index definitions for ${table.name}`,
            dependsOn:   [base],
            filePath:    `backend/db/indexes/${safeName}.sql`,
        });

        // ── T3: Seed file ─────────────────────────────────────────────
        tasks.push({
            seq:         base + 2,
            request:     _buildSeedDescription(table, analysis, tables),
            description: `Seed data for ${table.name} (5–10 realistic rows)`,
            dependsOn:   [base],
            filePath:    `backend/db/seeds/${safeName}.js`,
        });

        // ── T4: Relationship checker ──────────────────────────────────
        tasks.push({
            seq:         base + 3,
            request:     _buildRelationshipDescription(table, analysis),
            description: `FK relationship checker for ${table.name}`,
            dependsOn:   [base],
            filePath:    `backend/db/relationships/${safeName}.js`,
        });

        // ── T5: DB tests ──────────────────────────────────────────────
        tasks.push({
            seq:         base + 4,
            request:     _buildTestDescription(table, analysis),
            description: `Database tests for ${table.name} (schema + FK + index)`,
            dependsOn:   [base + 1, base + 2, base + 3],
            filePath:    `tests/db/${safeName}.test.cjs`,
        });

        // ── T6: Health check entry ────────────────────────────────────
        tasks.push({
            seq:         base + 5,
            request:     _buildHealthDescription(table, analysis),
            description: `DB health check entry for ${table.name}`,
            dependsOn:   [base + 1],
            filePath:    `backend/db/health.js`,
        });

        // ── T7: Schema manifest ───────────────────────────────────────
        tasks.push({
            seq:         base + 6,
            request:     _buildManifestDescription(table, analysis),
            description: `Schema manifest JSON for ${table.name}`,
            dependsOn:   [base + 4, base + 5],
            filePath:    `backend/db/schema/${safeName}.json`,
        });
    }

    return tasks;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Build the full database implementation task graph for a blueprint.
 * Pure — no AI, no I/O.
 *
 * @param {string} blueprintId
 * @returns {{
 *   blueprintId, productName,
 *   tables: [{ id, name, columns, fks, indexes }],
 *   tasks: task[],
 *   tableDeps: { [tableId]: tableId[] },
 *   plannedAt: string
 * }}
 */
function planDatabase(blueprintId) {
    const blueprint = _bp().getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

    const tables    = blueprint.database?.tables ?? [];
    const allNames  = tables.map(t => t.name);
    const tableDeps = _buildTableDeps(tables);
    const tasks     = _buildDatabaseTaskGraph(blueprint);

    console.log(`[DatabaseFactory] plan: "${blueprint.productName}" — ${tables.length} tables, ${tasks.length} tasks`);
    tables.forEach(t => {
        const deps = [...tableDeps.get(t.id)];
        const analysis = _analyseTable(t, allNames);
        console.log(`[DatabaseFactory]   ${t.name}: fks=[${analysis.fks.map(f => f.col + "→" + f.refTable).join(", ") || "none"}] deps=[${deps.join(", ") || "none"}]`);
    });

    return {
        blueprintId,
        productName: blueprint.productName,
        tables: tables.map(t => {
            const a = _analyseTable(t, allNames);
            return { id: t.id, name: t.name, columns: t.columns, fks: a.fks, indexes: a.indexes };
        }),
        tasks,
        tableDeps: Object.fromEntries([...tableDeps.entries()].map(([k, v]) => [k, [...v]])),
        plannedAt: new Date().toISOString(),
    };
}

/**
 * Plan + execute the full database implementation through projectRunner.
 *
 * @param {string} blueprintId
 * @param {object} opts
 * @returns {{ dbManifest, projectRun }}
 */
async function implementDatabase(blueprintId, opts = {}) {
    const plan      = planDatabase(blueprintId);
    const blueprint = _bp().getBlueprint(blueprintId);
    const runner    = _runner();

    console.log(`[DatabaseFactory] implementing "${blueprint.productName}" DB — ${plan.tasks.length} tasks`);

    const projectRun = await runner.runProject(
        `Implement full database layer for ${blueprint.productName}`,
        {
            plan:         plan.tasks,
            projectName:  `${blueprint.productName} — Database`,
            blueprintId,
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            deployAtEnd:  opts.deployAtEnd  ?? false,
            testCommand:  opts.testCommand,
            operatorId:   opts.operatorId   ?? "database-factory",
        }
    );

    const manifest = {
        blueprintId,
        productName:     blueprint.productName,
        projectId:       projectRun.projectId,
        status:          projectRun.ok ? "implemented" : "partial",
        tables:          plan.tables,
        tableDeps:       plan.tableDeps,
        taskCount:       plan.tasks.length,
        completed:       projectRun.completed,
        failed:          projectRun.failed,
        skipped:         projectRun.skipped,
        tests:           projectRun.tests,
        coordinator:     projectRun.coordinator,
        waves:           projectRun.waves,
        implementedAt:   new Date().toISOString(),
    };

    _persist(manifest);
    console.log(`[DatabaseFactory] "${blueprint.productName}" — ${manifest.status} (${manifest.completed}/${plan.tasks.length})`);
    return { dbManifest: manifest, projectRun };
}

/** Retrieve a stored DB manifest by blueprintId. */
function getDatabaseManifest(blueprintId) {
    return _loadStore().find(r => r.blueprintId === blueprintId) || null;
}

/** List recent DB manifests. */
function listDatabaseManifests({ limit = 20 } = {}) {
    return _loadStore().slice(0, limit).map(r => ({
        blueprintId:   r.blueprintId,
        productName:   r.productName,
        projectId:     r.projectId,
        status:        r.status,
        tableCount:    r.tables?.length ?? 0,
        taskCount:     r.taskCount,
        completed:     r.completed,
        failed:        r.failed,
        implementedAt: r.implementedAt,
    }));
}

module.exports = {
    planDatabase,
    implementDatabase,
    getDatabaseManifest,
    listDatabaseManifests,
};
