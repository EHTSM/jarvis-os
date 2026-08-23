#!/usr/bin/env node
"use strict";
/**
 * Mission memory concurrent-write verification — NOT a fix, a documented
 * negative result.
 *
 * missionMemory.cjs's own code comment (around _saveMissions(), added
 * during the Final Production Integration mission's Blocker #6 fix)
 * explicitly acknowledges "the underlying lost-update race for two writes
 * based on the same stale read" as a known, unfixed issue — only the
 * separate file-corruption/ENOENT-crash class (from two processes sharing
 * a literal ".tmp" path) was fixed there, not the read-modify-write race
 * itself.
 *
 * That comment is honest about what it fixed, but the audit that flagged it
 * as a live production blocker assumed the lost-update race is actually
 * reachable under real concurrency. Tested directly against the real
 * /mission/git/* routes and missionMemory service via genuine concurrent
 * HTTP requests targeting the SAME mission:
 *
 *   - 30 concurrent record-branch requests (same mutation type, same mission)
 *   - 40 concurrent MIXED mutation types (record-commit / record-branch /
 *     record-rollback / record-review) against the same mission
 *
 * Neither reproduced a single lost write. Root cause: every mutation
 * function in missionMemory.cjs (addSubtask, updateMission, recordDecision,
 * recordArtifact, recordFailure, recordApproval, ...) is fully synchronous
 * — no `await` inside their own bodies, and none of their route callers
 * insert an `await` between an earlier read and a later write to the same
 * mission (unlike the real race found in Module 3's creativeStudio.js,
 * which did have a genuine await gap). Under Node's single-threaded event
 * loop, a synchronous function can't be interrupted mid-execution by
 * another request's handler, so each call's load→modify→save completes
 * atomically before the next queued callback runs.
 *
 * This is the same conclusion as Module 4 (billingService.js) — see
 * docs/audits/PRODUCTION-BLOCKER-ELIMINATION.md Module 6 for the full
 * writeup. No code change was made to missionMemory.cjs.
 *
 * Mission 38 (2026-08-23) — KNOWN ENVIRONMENT PRECONDITION, not a
 * regression of the above: the "atomic under Node's single-threaded event
 * loop" reasoning above only covers concurrency WITHIN one process. It was
 * never a claim that a SEPARATE OS process (e.g. the real backend/server.js
 * dev server, if also running concurrently on :5050 and independently
 * writing its own missions to the same data/missions.json) can't interleave
 * with this test's own reads/writes at the OS file level — that cross-
 * process case is a real, different race, and this test's own HTTP-request
 * scenario runs its "concurrent" requests all through ONE server process,
 * so it never actually exercised that case either. Run this test with no
 * other JARVIS backend process holding data/missions.json for a
 * deterministic result.
 *
 * Usage: node tests/security/13-mission-memory-race-verification.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const express = require("express");
const memory = require("../../backend/services/missionMemory.cjs");
const missionRouter = require("../../backend/routes/mission.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use(missionRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  section("Same mutation type, same mission — 30 concurrent record-branch calls");
  {
    const mission = memory.createMission({ objective: "Race verify — same type", description: "test", priority: "medium" });
    const { server, base } = await startApp();

    const N = 30;
    const reqs = Array.from({ length: N }, (_, i) =>
      fetch(`${base}/mission/git/record-branch`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: mission.id, branchName: `branch-${i}`, action: "create" }),
      })
    );
    const results = await Promise.all(reqs);
    server.close();

    const okCount = results.filter(r => r.status === 200).length;
    assert(okCount === N, `all ${N} concurrent requests return 200`, `${okCount}/${N} returned 200`);

    const final = memory.getMission(mission.id);
    assert(final.decisions.length === N, `all ${N} decisions are recorded (no lost updates)`, `only ${final.decisions.length}/${N} recorded`);
  }

  section("Mixed mutation types, same mission — 40 concurrent commit/branch/rollback/review calls");
  {
    const mission = memory.createMission({ objective: "Race verify — mixed types", description: "test", priority: "medium" });
    const { server, base } = await startApp();

    const N = 40;
    const reqs = [];
    for (let i = 0; i < N; i++) {
      const kind = i % 4;
      if (kind === 0) {
        reqs.push(fetch(`${base}/mission/git/record-commit`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ missionId: mission.id, commitHash: `hash${i}`.padEnd(40, "0"), commitMessage: `commit ${i}`, branch: "main" }) }));
      } else if (kind === 1) {
        reqs.push(fetch(`${base}/mission/git/record-branch`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ missionId: mission.id, branchName: `branch-${i}`, action: "create" }) }));
      } else if (kind === 2) {
        reqs.push(fetch(`${base}/mission/git/record-rollback`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ missionId: mission.id, targetHash: `hash${i}`.padEnd(40, "0"), reason: `rollback ${i}` }) }));
      } else {
        reqs.push(fetch(`${base}/mission/git/record-review`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ missionId: mission.id, reviewType: "code-review", requestedBy: "test", summary: `review ${i}` }) }));
      }
    }
    const results = await Promise.all(reqs);
    server.close();

    const okCount = results.filter(r => r.status === 200).length;
    assert(okCount === N, `all ${N} concurrent mixed-type requests return 200`, `${okCount}/${N} returned 200`);

    const final = memory.getMission(mission.id);
    // 10 commits -> 10 artifacts + 10 decisions; 10 branches -> 10 decisions;
    // 10 rollbacks -> 10 failures + 10 decisions; 10 reviews -> 10 approvals + 10 artifacts
    assert(final.artifacts.length  === 20, "20 artifacts recorded (10 commits + 10 reviews)", `got ${final.artifacts.length}`);
    assert(final.decisions.length  === 30, "30 decisions recorded (10 commits + 10 branches + 10 rollbacks)", `got ${final.decisions.length}`);
    assert(final.failures.length   === 10, "10 failures recorded (10 rollbacks)", `got ${final.failures.length}`);
    assert(final.approvals.length  === 10, "10 approvals recorded (10 reviews)", `got ${final.approvals.length}`);
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
    console.log("\n  If this test now fails, the Module 6 'documented as false' conclusion in");
    console.log("  docs/audits/PRODUCTION-BLOCKER-ELIMINATION.md may no longer hold — investigate");
    console.log("  whether an await was introduced inside missionMemory.cjs's mutation functions");
    console.log("  or their route callers before assuming a fix is needed.");
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/mission-memory-race-verification-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/mission-memory-race-verification-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
