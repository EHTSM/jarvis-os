#!/usr/bin/env node
"use strict";
/**
 * Knowledge OS — cross-org IDOR in impact analysis — regression test.
 *
 * Knowledge OS pass (2026-08-15). orgKnowledgeGraph.cjs's getOrgImpact()
 * checked that the CALLER belongs to the orgId supplied in the path, but
 * never checked that the (type, id) resource being analyzed — a completely
 * separate, caller-controlled path-parameter pair — actually belongs to
 * that org at all. Its own doc comment described a "post-hoc org-membership
 * filter" that never actually existed in the code.
 *
 * Live-reproduced with two real orgs (see reports/OS-KNOWLEDGE-SECURITY.md
 * for the full HTTP-level reproduction): a genuine member of Org B, calling
 * GET /org-graph/<Org B's own orgId>/impact/lead/<Org A's real lead id>
 * (passing the membership check on Org B, since it's their own org),
 * received Org A's lead name, email, status, and Org A's organization name
 * in a 200 — a real, exploitable cross-tenant data leak.
 *
 * Fix: verify the root (type, id) node has a real belongs_to edge to the
 * requested org before running analysis at all (the same edge getOrgGraph's
 * own traversal already relies on for its correctly-isolated results); a
 * node with no such edge — including one that legitimately belongs to a
 * different org — is treated as not found for this org (404), never
 * disclosed. As defense in depth, any node the multi-hop traversal itself
 * walks OUT to that carries a resolvable, different orgId is also stripped
 * from the results.
 *
 * ── A second, more severe defect found in the same pass: graph.js's raw,
 * platform-wide routes (/graph/node/:type/:id, /graph/impact/:type/:id,
 * /graph/traverse/:type/:id, /graph/related/:type/:id, /graph/edges,
 * /graph/export, /graph/lookup/*, /graph/reasoning/impact|dependencies/:type/:id)
 * had ONLY requireAuth — no org or operator check at all. Since this route
 * has genuinely no per-org concept (it is the platform-wide graph every
 * org's data gets indexed into, by design), ANY authenticated account of
 * ANY org could query ANY other org's individual record content directly.
 * Live-reproduced: GET /graph/node/lead/<Org A's real lead id>, called by
 * an Org-B-only account with no relationship to Org A, returned Org A's
 * lead name/email/status with a 200. Fixed with the same operator-only gate
 * crm.js already uses for its own identical-shape "cross-org operator view"
 * routes (GET /crm, /crm-leads) — not a new authorization concept, applying
 * the existing one to routes that were missing it. Aggregate/statistical
 * routes (schema, stats, reasoning, reasoning/critical, reasoning/executive,
 * reasoning/recommendations — the only /graph/* endpoints any frontend
 * dashboard actually calls) keep their existing requireAuth-only gate since
 * they disclose counts/top-N summaries, not individual record content.
 *
 * Usage: node tests/security/111-knowledge-os-impact-analysis-cross-org-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function main() {
  const kg = require("../../backend/services/knowledgeGraph.cjs");
  const orgKg = require("../../backend/services/orgKnowledgeGraph.cjs");
  const orgSvc = require("../../backend/services/organizationService.cjs");

  const suffix = Date.now();
  const orgA = `test-know-org-a-${suffix}`;
  const orgB = `test-know-org-b-${suffix}`;
  const leadA = `test-know-lead-a-${suffix}`;
  const acctB = `test-know-acct-b-${suffix}`;

  section("Setup — real edge: leadA genuinely belongs to orgA only");
  kg.addEdge("lead", leadA, kg.RELATIONS.BELONGS_TO, "org", orgA, { metadata: { name: "KNOWLEDGE-SECRET-TEST" } });
  const edgeCheck = kg.getEdges({ fromType: "lead", fromId: leadA, toType: "org", toId: orgA, relation: kg.RELATIONS.BELONGS_TO });
  assert(edgeCheck.edges.length === 1, "the belongs_to edge was genuinely created");

  section("Fix — getOrgImpact() rejects a resource that doesn't belong to the requested org");
  {
    // Simulate a real org-B member: hasPermission would normally gate this,
    // but we exercise getOrgImpact() directly to isolate the ownership-check
    // logic from organizationService's own membership state (covered
    // separately by the live HTTP reproduction in the Security report).
    const origHasPermission = orgSvc.hasPermission;
    orgSvc.hasPermission = () => true; // simulate: caller IS a real member of orgB
    try {
      let threw = false, status = null;
      try {
        orgKg.getOrgImpact(orgB, acctB, "lead", leadA);
      } catch (e) {
        threw = true;
        status = e.status;
      }
      assert(threw, "getOrgImpact() throws instead of returning Org A's lead data to an Org B caller", "did not throw — the pre-fix leak would have returned 200 here");
      assert(status === 404, "the thrown error carries a 404 status (not-found, not a disclosure)", `got status ${status}`);
    } finally {
      orgSvc.hasPermission = origHasPermission;
    }
  }

  section("Fix — getOrgImpact() still works for the resource's REAL owning org");
  {
    const origHasPermission = orgSvc.hasPermission;
    orgSvc.hasPermission = () => true; // simulate: caller IS a real member of orgA
    try {
      const result = orgKg.getOrgImpact(orgA, "test-acct-a", "lead", leadA);
      assert(result.rootId === leadA, "impact analysis succeeds for the lead's real owning org", JSON.stringify(result));
      assert(result.rootData?.label === "KNOWLEDGE-SECRET-TEST" || result.rootData === undefined || result.rootData === null, "legitimate access still returns real data (or a benign resolver miss, never a false denial)");
    } finally {
      orgSvc.hasPermission = origHasPermission;
    }
  }

  section("Fix — a nonexistent resource is also a genuine 404, not a different error shape (no existence oracle)");
  {
    const origHasPermission = orgSvc.hasPermission;
    orgSvc.hasPermission = () => true;
    try {
      let status = null;
      try { orgKg.getOrgImpact(orgA, "test-acct-a", "lead", "nonexistent-lead-id-xyz"); }
      catch (e) { status = e.status; }
      assert(status === 404, "a genuinely nonexistent resource also 404s, same shape as a real-but-foreign one", `got status ${status}`);
    } finally {
      orgSvc.hasPermission = origHasPermission;
    }
  }

  section("graph.js — raw platform-wide routes are gated to operator-only (static check)");
  {
    const src = require("fs").readFileSync("backend/routes/graph.js", "utf8");
    const mustBeOperatorGated = [
      'router.get("/graph/export", _graphOperatorOnly,',
      'router.get("/graph/edges", _graphOperatorOnly,',
      'router.post("/graph/edges", _graphOperatorOnly,',
      'router.delete("/graph/edges/:edgeId", _graphOperatorOnly,',
      'router.get("/graph/node/:type/:id", _graphOperatorOnly,',
      'router.get("/graph/traverse/:type/:id", _graphOperatorOnly,',
      'router.get("/graph/related/:type/:id", _graphOperatorOnly,',
      'router.get("/graph/impact/:type/:id", _graphOperatorOnly,',
      'router.get("/graph/lookup/:type/:id/missions", _graphOperatorOnly,',
      'router.get("/graph/lookup/:type/:id/org", _graphOperatorOnly,',
      'router.get("/graph/lookup/mission/:missionId/team", _graphOperatorOnly,',
      'router.get("/graph/reasoning/impact/:type/:id", _graphOperatorOnly,',
      'router.get("/graph/reasoning/dependencies/:type/:id", _graphOperatorOnly,',
      // Mission 38 (2026-08-23): a later, independent security mission (see
      // backend/routes/graph.js's own inline comment above these 4 routes)
      // found these 4 reasoning routes were leaking cross-tenant data to
      // ordinary customers via genuinely tenant-facing dashboards and gated
      // them operatorOnly, explicitly flagging the resulting empty dashboard
      // sections as DECISION REQUIRED (not resolved). This test previously
      // asserted the OLD, now-superseded contract that these 4 stayed
      // reachable to any authenticated user — updated to match the current,
      // intentional, more secure behavior.
      'router.get("/graph/reasoning", _graphOperatorOnly,',
      'router.get("/graph/reasoning/critical", _graphOperatorOnly,',
      'router.get("/graph/reasoning/recommendations", _graphOperatorOnly,',
      'router.get("/graph/reasoning/executive", _graphOperatorOnly,',
    ];
    for (const line of mustBeOperatorGated) {
      assert(src.includes(line), `gated: ${line.split('"')[1]}`, "operator-only gate missing on this route");
    }
    // The routes real dashboards actually call must stay reachable to any
    // authenticated user — confirm the fix did NOT accidentally gate these.
    const mustStayAuthOnly = [
      'router.get("/graph/schema", (req, res)',
      'router.get("/graph/stats", (req, res)',
    ];
    for (const line of mustStayAuthOnly) {
      assert(src.includes(line), `still reachable to any authenticated user: ${line.split('"')[1]}`, "was unexpectedly gated — would break real dashboard callers");
    }
  }

  section("graph.js — operatorOnly middleware itself behaves correctly (unit-level, no server needed)");
  {
    const { operatorOnly } = require("../../backend/middleware/authMiddleware.js");
    let called = false;
    const resStub = () => { let code; return { status(c) { code = c; return this; }, json() { return this; }, _code: () => code }; };

    called = false;
    const r1 = resStub();
    operatorOnly({ user: { role: "operator" } }, r1, () => { called = true; });
    assert(called === true, "a real operator session passes through (next() called)");

    called = false;
    const r2 = resStub();
    operatorOnly({ user: { role: "user" } }, r2, () => { called = true; });
    assert(called === false && r2._code() === 403, "a regular user session is blocked with 403 (not silently allowed through)");
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main();
