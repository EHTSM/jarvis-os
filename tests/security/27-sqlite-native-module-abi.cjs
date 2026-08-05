#!/usr/bin/env node
"use strict";
/**
 * better-sqlite3 native module ABI regression — backend/db/sqlite.cjs.
 *
 * CONFIRMED finding (Zero-Trust Competitor Remediation, Phase 1):
 * node_modules/better-sqlite3's compiled native binary was built for
 * NODE_MODULE_VERSION 145 (Electron 41's Node runtime — this project runs
 * `electron-rebuild -f -w node-pty,better-sqlite3` per its own `rebuild`
 * npm script) while the plain Node.js process running backend/server.js
 * reports NODE_MODULE_VERSION 137. Reproduced live: every single call to
 * getDB() failed, meaning agents/taskQueue.cjs's SQLite "shadow write"
 * layer (a passive mirror of the JSON-authoritative task queue) failed on
 * every upsert/delete for the server's entire run, flooding logs with
 * repeated "[SQLite Shadow] Upsert/Delete failed" warnings.
 *
 * Fix: `npm rebuild better-sqlite3` recompiled the native binary against
 * the current plain-Node ABI (137). Verified via a fresh server boot: zero
 * shadow-write failures, and a real "[SQLite] Persistence recovered — WAL
 * mode active" log line, plus real pre-existing task data readable via
 * getStats() (1349 tasks across pending/completed/running/failed).
 *
 * IMPORTANT — this fix has a known limitation, documented rather than
 * silently left implicit: rebuilding for the plain-Node ABI (137) makes
 * the backend server work, but will break the SAME native binary for the
 * Electron desktop app (which needs ABI 145) if Electron ever loads this
 * same node_modules directory without its own separate
 * `electron-rebuild` pass first. This project runs two different
 * consumers (a plain-Node backend process and an Electron desktop shell)
 * against one shared node_modules/better-sqlite3 — that dual-runtime
 * packaging tension is a real, separate architectural risk this fix does
 * not (and, within this remediation's scope, should not) resolve. This
 * test asserts the fix property that was actually in scope: the plain
 * Node backend process must be able to open and use the database.
 *
 * Usage: node tests/security/27-sqlite-native-module-abi.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

section("better-sqlite3 native module loads and opens a real database under the current Node runtime");
{
  let getDB, getStats, closeDB;
  try {
    ({ getDB, getStats, closeDB } = require("../../backend/db/sqlite.cjs"));
    ok("backend/db/sqlite.cjs requires without throwing");
  } catch (e) {
    ko("backend/db/sqlite.cjs requires without throwing", e.message);
  }

  if (getDB) {
    try {
      const db = getDB();
      assert(!!db, "getDB() returns a real database handle (not null/undefined)", "getDB() returned a falsy value");

      const mode = db.pragma("journal_mode")[0]?.journal_mode;
      assert(mode === "wal", "database is in WAL mode as configured", `journal_mode=${mode}`);

      // Exercise a real write + read through the actual native binding —
      // the exact operation class (INSERT OR REPLACE / DELETE) that was
      // failing in the reproduced bug, run directly rather than only
      // checking that the module loaded.
      const testId = `abi-regression-test-${Date.now()}`;
      db.prepare(`
        INSERT OR REPLACE INTO tasks (id, input, type, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(testId, "abi regression probe", "auto", "pending", new Date().toISOString());
      const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(testId);
      assert(row && row.id === testId, "a real INSERT through the native binding is readable back", `expected row with id=${testId}, got ${JSON.stringify(row)}`);
      db.prepare("DELETE FROM tasks WHERE id = ?").run(testId);
      const rowAfterDelete = db.prepare("SELECT * FROM tasks WHERE id = ?").get(testId);
      assert(!rowAfterDelete, "a real DELETE through the native binding actually removes the row", `row still present after delete: ${JSON.stringify(rowAfterDelete)}`);
    } catch (e) {
      ko("getDB() opens a usable database (real read/write cycle)", e.message.includes("NODE_MODULE_VERSION")
        ? `NATIVE MODULE ABI MISMATCH — run 'npm rebuild better-sqlite3' for the current Node runtime. Raw error: ${e.message}`
        : e.message);
    }
  }
}

section("agents/taskQueue.cjs's shadow-write layer succeeds silently (no fallback warnings) under the current runtime");
{
  // Reproduces the exact reported symptom via the real call site, not a
  // reimplementation — requires taskQueue.cjs fresh so its lazy
  // require("../backend/db/sqlite.cjs") resolves against the current
  // (potentially just-rebuilt) native binary.
  delete require.cache[require.resolve("../../backend/db/sqlite.cjs")];
  delete require.cache[require.resolve("../../agents/taskQueue.cjs")];

  const logger = require("../../backend/utils/logger");
  const warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => { warnings.push(args.join(" ")); };

  try {
    const taskQueue = require("../../agents/taskQueue.cjs");
    const task = taskQueue.addTask({ input: "abi regression probe via real taskQueue API" });
    if (task?.id) taskQueue.deleteTask(task.id);
  } finally {
    logger.warn = originalWarn;
  }

  const shadowFailures = warnings.filter(w => w.includes("SQLite Shadow") && w.includes("failed"));
  assert(shadowFailures.length === 0, "no '[SQLite Shadow] ... failed' warnings were logged during a real taskQueue operation", `got ${shadowFailures.length} shadow-write failure warning(s): ${JSON.stringify(shadowFailures.slice(0,3))}`);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`SQLite Native Module ABI Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  console.log("\nIf this is failing after a fresh `npm install` or an `electron-rebuild` run,");
  console.log("the fix is: npm rebuild better-sqlite3");
  process.exit(1);
}
process.exit(0);
