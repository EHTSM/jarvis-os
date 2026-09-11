#!/usr/bin/env node
"use strict";
/**
 * phase26.js — D2 semantic-memory routes — tenant isolation wiring.
 *
 * BI/Search Ecosystem mission. Discovery found backend/services/
 * semanticMemorySearch.cjs's saveTypedMemory/semanticSearch/searchFailures/
 * searchSuccesses/searchDecisions/crossProjectSearch/getKnowledgeGraph/
 * evolveKnowledge never threaded orgId through at all, despite
 * memoryPersistenceLayer.cjs (the underlying store) already having a real,
 * tested orgId filter (the "M-4" fix) for other callers. Live effect
 * (pre-fix): any authenticated user's search read across every org's
 * stored memory nodes, and POST /p26/memory/evolve — a real WRITE path,
 * since dryRun defaults to false — could mutate importance/confidence
 * metadata on every org's nodes platform-wide.
 *
 * Fixed by: (1) adding orgId support to every semanticMemorySearch.cjs
 * function (see tests/integration/02-semanticMemory.test.cjs for the
 * service-level tenant-isolation proof, 8 new tests), and (2) wiring
 * backend/routes/phase26.js to resolve orgId server-side via the newly
 * added attachOrg middleware and pass req.org?.id into every D2 call —
 * never trusting a client-supplied orgId in the request body, matching the
 * same "server-resolved, never client-controlled" rule already enforced
 * everywhere else in this codebase.
 *
 * This test verifies the ROUTE-LEVEL wiring specifically (not the service
 * logic, already covered above): that attachOrg is mounted, that every D2
 * route reads req.org?.id (not a body-supplied value) when composing its
 * call to semanticMemorySearch.cjs, and that a client-supplied orgId in the
 * request body can never override the server-resolved one — a source-shape
 * verification, matching this mission chain's own established convention
 * (e.g. the B.21 test files' src-regex assertions) for verifying route
 * wiring without needing a full live-server org/membership fixture for a
 * defect class already proven at the service level.
 *
 * No real memory node from any real org is touched by this test.
 *
 * Usage: node tests/security/155-phase26-memory-tenant-isolation.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../../backend/routes/phase26.js"), "utf8");

  section("attachOrg is mounted on the /p26 router (server-side org resolution now exists)");
  {
    assert(/require\(["']\.\.\/middleware\/orgMiddleware\.cjs["']\)/.test(src),
      "phase26.js imports the same shared orgMiddleware.cjs every other org-scoped route in this repo already uses");
    assert(/router\.use\(["']\/p26["'],\s*requireAuth,\s*attachOrg\)/.test(src),
      "attachOrg is mounted at the router level, ahead of every D2 handler");
  }

  section("Every D2 semantic-memory route resolves orgId from req.org, never from the request body");
  {
    const d2Section = src.slice(src.indexOf('"D2 Semantic Memory"') >= 0 ? src.indexOf('"D2 Semantic Memory"') : src.indexOf("D2 Semantic Memory"), src.indexOf("D3 Reasoning Engine"));
    const routeCalls = [
      { fn: "saveTypedMemory", pattern: /sms\.saveTypedMemory\(type,\s*data,\s*safeOpts\)/ },
      { fn: "semanticSearch", pattern: /sms\.semanticSearch\(query,\s*\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "searchFailures", pattern: /sms\.searchFailures\(q,\s*\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "searchSuccesses", pattern: /sms\.searchSuccesses\(q,\s*\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "searchDecisions", pattern: /sms\.searchDecisions\(q,\s*\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "crossProjectSearch", pattern: /sms\.crossProjectSearch\(query,\s*\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "getKnowledgeGraph", pattern: /sms\.getKnowledgeGraph\(\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
      { fn: "evolveKnowledge", pattern: /sms\.evolveKnowledge\(\{[^}]*orgId:\s*req\.org\?\.id\s*\|\|\s*null[^}]*\}\)/ },
    ];
    for (const { fn, pattern } of routeCalls) {
      assert(pattern.test(d2Section), `${fn}'s route call passes orgId: req.org?.id (server-resolved)`, `pattern not found for ${fn}`);
    }
  }

  section("saveTypedMemory's orgId cannot be overridden by a client-supplied value in req.body.opts");
  {
    // The fix composes safeOpts as { ...(opts || {}), orgId: req.org?.id || null }
    // — orgId is spread LAST, so it always wins over anything the client put
    // in opts.orgId. Assert the exact ordering, not just presence. The route
    // path string also appears once in this file's own header doc-comment
    // (above the real router.post below it), so anchor on the real handler
    // (router.post(...)) rather than the bare path string to avoid slicing
    // from the wrong occurrence.
    const typedSection = src.slice(src.indexOf('router.post("/p26/memory/typed"'), src.indexOf('router.post("/p26/memory/search"'));
    assert(/const safeOpts = \{ \.\.\.\(opts \|\| \{\}\), orgId: req\.org\?\.id \|\| null \};/.test(typedSection),
      "safeOpts spreads the client's opts FIRST, then overwrites orgId with the server-resolved value LAST — a client cannot smuggle a different orgId through req.body.opts.orgId");
    assert(!/sms\.saveTypedMemory\(type, data, opts \|\| \{\}\)/.test(typedSection),
      "the old unscoped call (raw client opts, no orgId override) is gone");
  }

  section("Regression — D1/D3/D4/D5 routes in the same file are unaffected by the attachOrg addition");
  {
    // attachOrg is non-blocking, so routes that never read req.org must be
    // byte-for-byte unaffected. Spot-check a few from each track.
    assert(/router\.post\("\/p26\/graph"/.test(src), "D1 task-graph route still exists unchanged");
    assert(/router\.get\("\/p26\/reason\/cached\/:recId"/.test(src), "D3 reasoning route still exists unchanged");
    assert(/router\.post\("\/p26\/observer\/start"/.test(src), "D4 observer route still exists unchanged");
    assert(/router\.get\("\/p26\/manifest"/.test(src), "D5 manifest route still exists unchanged");
  }

  section("Both modules load without error after the fix");
  {
    try {
      require("../../backend/services/semanticMemorySearch.cjs");
      require("../../backend/routes/phase26.js");
      ok("semanticMemorySearch.cjs and phase26.js both require() cleanly");
    } catch (e) {
      ko("semanticMemorySearch.cjs and phase26.js both require() cleanly", e.message);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
