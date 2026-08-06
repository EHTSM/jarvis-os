#!/usr/bin/env node
"use strict";
/**
 * Duplicate boot-time recovery call regression — Phase A.5.3.
 *
 * CONFIRMED finding (reproduced live via 3 restart cycles): taskQueue.cjs's
 * recoverStale() was called TWICE on every backend boot — once inside
 * agents/autonomousLoop.cjs's start() (which runs earlier in server.js's
 * boot sequence), and again directly from backend/server.js's own
 * "Startup diagnostics" block. Both calls are individually idempotent
 * (recoverStale() only mutates tasks still in "running" state, and the
 * first call already resets every one of them to "pending"), so this
 * never caused incorrect recovery — but it did produce a duplicate
 * "[TaskQueue] recovered N stale running task(s) → pending" log line on
 * every single restart, confirmed live across 3 consecutive kill+restart
 * cycles before the fix (2 log lines each time) and exactly 1 after.
 *
 * This matters beyond log noise: it's the same class of finding as
 * A.5.2's no-op full-file-rewrite calls — redundant work fired from two
 * independent locations without either knowing about the other. At boot
 * time the cost is negligible (once per process lifetime, not per-tick),
 * but the mission brief for this pass explicitly asks to look for
 * "duplicate retries" — this is exactly that class of bug, just at boot
 * rather than in a hot loop.
 *
 * Usage: node tests/security/53-duplicate-recoverstale-boot-call.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Fix: server.js no longer calls taskQueue.recoverStale() directly");
  {
    const src = fs.readFileSync(require.resolve("../../backend/server.js"), "utf8");
    const liveCode = src.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    assert.ok(!/tq\.recoverStale\(\)/.test(liveCode),
      "server.js must not call tq.recoverStale() directly — it's already called once inside autonomousLoop.start()");
    ok("server.js source contains no direct tq.recoverStale() call (outside comments)");
  }

  section("Fix: autonomousLoop.cjs still calls recoverStale() exactly once, inside start()");
  {
    const src = fs.readFileSync(require.resolve("../../agents/autonomousLoop.cjs"), "utf8");
    const matches = src.match(/taskQueue\.recoverStale\(\)/g) || [];
    assert.strictEqual(matches.length, 1,
      `expected exactly 1 taskQueue.recoverStale() call in autonomousLoop.cjs, found ${matches.length}`);
    ok("autonomousLoop.cjs contains exactly one taskQueue.recoverStale() call");
  }

  section("Fix: server.js still prunes and reports queue state (unrelated behavior preserved)");
  {
    const src = fs.readFileSync(require.resolve("../../backend/server.js"), "utf8");
    assert.ok(/tq\.pruneOldTasks\(50\)/.test(src), "server.js must still call tq.pruneOldTasks(50) in startup diagnostics");
    assert.ok(/tq\.getAll\(\)/.test(src), "server.js must still call tq.getAll() to report queue state at startup");
    ok("server.js still prunes old tasks and reports queue length at startup — only the redundant recoverStale() call was removed");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
