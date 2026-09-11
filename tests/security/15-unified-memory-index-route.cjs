#!/usr/bin/env node
"use strict";
/**
 * Unified memory index route — regression tests.
 *
 * Hidden-capability recovery: agents/runtime/unifiedMemoryEngine.cjs is a
 * real, ~300-line, fully-built cross-product memory index (search/lookup/
 * cross-reference over blueprints, features, pipeline runs, incidents, RCAs,
 * sessions, lifecycle reports — all read-through, no data duplication) that
 * had zero backend route exposing it. Confirmed via a require()-reachability
 * graph from backend/server.js and electron/main.cjs (954 files scanned, only
 * this file plus 16 others were genuinely unreached — most of those 16 are
 * proven superseded duplicates or trivial dead files; see
 * docs/audits/PRODUCTION-BLOCKER-ELIMINATION.md's Hidden Capability Recovery
 * section for the full classification).
 *
 * Fix: backend/routes/unifiedMemoryIndex.js exposes the engine's existing
 * public API directly (no new logic — every route is a thin requireAuth-gated
 * wrapper around an existing exported function), mounted at /memory-index/*.
 *
 * Usage: node tests/security/15-unified-memory-index-route.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-unified-memory-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const memRouter = require("../../backend/routes/unifiedMemoryIndex.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const app = express();
  app.use(express.json());
  app.use(memRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jwt = signJWT({ sub: "test-user", role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
  const cookie = `${COOKIE_NAME}=${jwt}`;

  section("Auth gate");
  const noAuth = await fetch(`${base}/memory-index/summary`);
  assert(noAuth.status === 401, "GET /memory-index/summary without auth returns 401", `got ${noAuth.status}`);

  section("Real data — summary reflects actual on-disk records");
  const summaryRes = await fetch(`${base}/memory-index/summary`, { headers: { cookie } });
  const summary = await summaryRes.json();
  assert(summaryRes.status === 200 && summary.ok, "GET /memory-index/summary returns 200 ok:true", `status=${summaryRes.status}`);
  assert(typeof summary.totalIndexed === "number" && summary.totalIndexed > 0, "summary reports a real non-zero totalIndexed count", `got ${summary.totalIndexed}`);

  section("Rebuild");
  const rebuildRes = await fetch(`${base}/memory-index/rebuild`, { method: "POST", headers: { cookie } });
  const rebuild = await rebuildRes.json();
  assert(rebuildRes.status === 200 && rebuild.ok, "POST /memory-index/rebuild returns 200 ok:true", `status=${rebuildRes.status}`);
  assert(typeof rebuild.indexed === "number", "rebuild reports an indexed count", JSON.stringify(rebuild));

  section("Search");
  const searchRes = await fetch(`${base}/memory-index/search?q=patch&limit=5`, { headers: { cookie } });
  const search = await searchRes.json();
  assert(searchRes.status === 200 && search.ok, "GET /memory-index/search returns 200 ok:true", `status=${searchRes.status}`);
  assert(Array.isArray(search.results), "search returns a results array", JSON.stringify(search));

  section("Namespace views");
  const wfRes = await fetch(`${base}/memory-index/workflow`, { headers: { cookie } });
  const wf = await wfRes.json();
  assert(wfRes.status === 200 && wf.ok && wf.memory, "GET /memory-index/workflow returns real workflow memory", `status=${wfRes.status}`);

  const decRes = await fetch(`${base}/memory-index/decisions`, { headers: { cookie } });
  const dec = await decRes.json();
  assert(decRes.status === 200 && dec.ok && dec.memory, "GET /memory-index/decisions returns real decision memory", `status=${decRes.status}`);

  section("Not-found handling");
  const lookupRes = await fetch(`${base}/memory-index/lookup/nonexistent_type/xyz`, { headers: { cookie } });
  assert(lookupRes.status === 404, "GET /memory-index/lookup/:type/:id for an unknown record returns 404", `got ${lookupRes.status}`);

  // getProjectMemory() is a cross-source filter (features/apis/pages/runs
  // matching this blueprintId), not a single-record lookup — it always
  // returns a shaped object with empty arrays/null fields for an unknown
  // id rather than null, so 200 with empty content is the correct
  // "not found" signal here, matching the underlying engine's real
  // contract (verified directly against unifiedMemoryEngine.cjs).
  const projRes = await fetch(`${base}/memory-index/project/nonexistent_blueprint`, { headers: { cookie } });
  const proj = await projRes.json();
  assert(projRes.status === 200 && proj.memory?.features?.length === 0 && proj.memory?.blueprint === null,
    "GET /memory-index/project/:blueprintId for an unknown blueprint returns 200 with empty content",
    `status=${projRes.status} body=${JSON.stringify(proj)}`);

  server.close();

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/unified-memory-index-route-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/unified-memory-index-route-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
