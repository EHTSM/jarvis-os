#!/usr/bin/env node
"use strict";
/**
 * Mission runtime lifecycle + restart recovery — regression tests.
 *
 * Production Operations Certification finding: missionRuntime.cjs's state
 * machine used "running" as its in-progress status throughout (TRANSITIONS
 * map, startMission/completeMission/failMission), but missionMemory.cjs's
 * VALID_STATUSES only accepted "active" for that concept — a vocabulary
 * mismatch that meant POST /mission/runtime/start/:id (the real, mounted,
 * live route) threw a 500 error on every single call, unconditionally.
 * This meant the entire mission execution flow was unusable in production.
 * Confirmed via direct HTTP request: status 500,
 * error: 'updateMission: invalid status "running"'.
 *
 * Fix: added "running" to missionMemory.cjs's VALID_STATUSES (kept
 * "active" too — it has other, unrelated external readers defensively
 * coded around this exact ambiguity, e.g. backend/routes/engineering.js
 * checks `status === "running" || status === "active"`).
 *
 * Second finding, only reachable once the first fix landed: missions
 * stuck in "running" after a crash had no restart-recovery path —
 * missionRuntime.cjs had no equivalent to taskQueue.recoverStale(). Added
 * recoverStaleMissions(), wired into backend/server.js's startup sequence
 * alongside the existing tq.recoverStale() call.
 *
 * Mission 90 Phase 2: this test previously required the real
 * missionMemory.cjs/missionRuntime.cjs/mission.js directly, so every
 * createMission()/startMission()/etc. call here wrote real records into
 * the actual data/missions.json — the exact cross-process lost-update race
 * this file's own prior header comment documented as a known environment
 * precondition. Migrated to an isolated missionMemory.cjs copy (Mission-82
 * pattern): missionRuntime.cjs and backend/routes/mission.js both require
 * missionMemory.cjs via a relative path that resolves to the same absolute
 * path everywhere in this process, so pre-populating require.cache at that
 * exact absolute path with the isolated instance's exports (BEFORE
 * missionRuntime.cjs/mission.js are ever required) makes every one of
 * their own internal missionMemory calls transparently hit the isolated
 * copy — without needing to also copy missionRuntime.cjs's much larger
 * transitive dependency tree (runtimeOrchestrator.cjs alone pulls in 7+
 * further modules, none of which touch data/missions.json at all). This
 * is the same class of technique as Mission 83's own guard integration,
 * applied to module resolution instead of to a specific function.
 *
 * Usage: node tests/security/18-mission-runtime-lifecycle.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m18-iso-"));
fs.mkdirSync(path.join(isoRoot, "backend", "services"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "backend", "utils"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "data"), { recursive: true });
fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"), path.join(isoRoot, "backend", "services", "missionMemory.cjs"));
fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(isoRoot, "backend", "utils", "logger.js"));
const isolatedMissionMemoryPath = path.join(isoRoot, "backend", "services", "missionMemory.cjs");
const memory = require(isolatedMissionMemoryPath);

// Pre-populate the require cache at the REAL absolute path, before
// missionRuntime.cjs/mission.js (which both require it via a relative
// path resolving to this exact absolute path) are ever required — every
// subsequent require() of the real path anywhere in this process now
// transparently returns the isolated instance instead.
const realMissionMemoryAbsPath = require.resolve("../../backend/services/missionMemory.cjs");
require.cache[realMissionMemoryAbsPath] = {
  id: realMissionMemoryAbsPath,
  filename: realMissionMemoryAbsPath,
  loaded: true,
  exports: memory,
};

const express = require("express");
const runtime = require("../../agents/runtime/missionRuntime.cjs");
const missionRouter = require("../../backend/routes/mission.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const app = express();
  app.use(express.json());
  app.use(missionRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  section("POST /mission/runtime/start/:id — the previously-broken route");
  {
    const m = memory.createMission({ objective: "Regression: start route", description: "test", priority: "medium" });
    const res = await fetch(`${base}/mission/runtime/start/${m.id}`, { method: "POST" });
    const body = await res.json();
    assert(res.status === 200, "POST /mission/runtime/start/:id returns 200 (was 500 before the fix)", `status=${res.status} body=${JSON.stringify(body)}`);
    assert(body.mission?.status === "running", "mission transitions to status=running", `got status=${body.mission?.status}`);
  }

  section("Full lifecycle — start → complete");
  {
    const m = memory.createMission({ objective: "Regression: lifecycle complete", description: "test", priority: "medium" });
    const startRes = await fetch(`${base}/mission/runtime/start/${m.id}`, { method: "POST" });
    const completeRes = await fetch(`${base}/mission/runtime/complete/${m.id}`, { method: "POST" });
    const completeBody = await completeRes.json();
    assert(startRes.status === 200 && completeRes.status === 200, "start then complete both succeed", `start=${startRes.status} complete=${completeRes.status}`);
    assert(completeBody.mission?.status === "completed", "mission ends in status=completed", `got ${completeBody.mission?.status}`);
  }

  section("Full lifecycle — start → fail → retry (running again) → complete");
  {
    const m = memory.createMission({ objective: "Regression: lifecycle retry", description: "test", priority: "medium" });
    await fetch(`${base}/mission/runtime/start/${m.id}`, { method: "POST" });
    const failRes = await fetch(`${base}/mission/runtime/fail/${m.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test failure" }) });
    const retryRes = await fetch(`${base}/mission/runtime/start/${m.id}`, { method: "POST" });
    const completeRes = await fetch(`${base}/mission/runtime/complete/${m.id}`, { method: "POST" });
    assert(failRes.status === 200 && retryRes.status === 200 && completeRes.status === 200, "fail then retry (failed→running) then complete all succeed", `fail=${failRes.status} retry=${retryRes.status} complete=${completeRes.status}`);
  }

  section("Full lifecycle — start → cancel");
  {
    const m = memory.createMission({ objective: "Regression: lifecycle cancel", description: "test", priority: "medium" });
    await fetch(`${base}/mission/runtime/start/${m.id}`, { method: "POST" });
    const cancelRes = await fetch(`${base}/mission/runtime/cancel/${m.id}`, { method: "POST" });
    const cancelBody = await cancelRes.json();
    assert(cancelRes.status === 200 && cancelBody.mission?.status === "cancelled", "start then cancel succeeds, ends in status=cancelled", `status=${cancelRes.status} got=${cancelBody.mission?.status}`);
  }

  server.close();

  section("Restart recovery — recoverStaleMissions() resets stuck 'running' missions");
  {
    const stuck1 = memory.createMission({ objective: "Regression: stuck mission 1", description: "test", priority: "medium" });
    const stuck2 = memory.createMission({ objective: "Regression: stuck mission 2", description: "test", priority: "medium" });
    const notStuck = memory.createMission({ objective: "Regression: not stuck (planned)", description: "test", priority: "medium" });

    runtime.startMission(stuck1.id);
    runtime.startMission(stuck2.id);
    // notStuck is left planned — never started, simulating a mission that
    // never got picked up before the crash, which should be untouched.

    const result = runtime.recoverStaleMissions();
    assert(result.missionIds.includes(stuck1.id) && result.missionIds.includes(stuck2.id), "both stuck missions are included in the recovery result", JSON.stringify(result.missionIds));

    const after1 = memory.getMission(stuck1.id);
    const after2 = memory.getMission(stuck2.id);
    const afterNotStuck = memory.getMission(notStuck.id);
    assert(after1.status === "planned" && after2.status === "planned", "both stuck missions are reset to status=planned", `got ${after1.status}, ${after2.status}`);
    assert(afterNotStuck.status === "planned", "a mission that was never started is unaffected by recovery", `got ${afterNotStuck.status}`);
    assert(after1.decisions.some(d => d.outcome === "reset_to_planned"), "the recovery is recorded in the mission's own decision log (audit trail)", "no reset_to_planned decision found");

    // Recovery is idempotent — running it again with nothing stuck should
    // be a no-op, not an error and not re-recovering already-planned missions.
    const secondRun = runtime.recoverStaleMissions();
    assert(!secondRun.missionIds.includes(stuck1.id), "running recovery again does not re-touch an already-recovered (now planned) mission", JSON.stringify(secondRun.missionIds));
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/mission-runtime-lifecycle-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/mission-runtime-lifecycle-test-report.json\n");
  } catch { /* non-critical */ }

  delete require.cache[realMissionMemoryAbsPath];
  try { fs.rmSync(isoRoot, { recursive: true, force: true }); } catch { /* best effort */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
