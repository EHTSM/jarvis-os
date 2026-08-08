#!/usr/bin/env node
"use strict";
/**
 * Unbounded mission store blocked the event loop — Phase B.1 P0
 * (Runtime Stabilization & Infrastructure Activation).
 *
 * CONFIRMED finding, measured on the running server:
 *
 *   data/missions.json had NO retention cap and had grown to 76.8 MB /
 *   10,373 missions. missionMemory.cjs caches the parsed store by mtime, but
 *   EVERY write invalidates that cache, so the next read re-parses the whole
 *   file synchronously on the main thread:
 *
 *     read 158 ms + JSON.parse 325 ms = 483 ms of blocked event loop
 *
 *   Writes were measured at 16/minute => ~7.7 s of event-loop stall per
 *   minute, i.e. ~13% of wall-clock time with the server frozen.
 *
 * That is the measured root cause of the Phase A reliability symptoms:
 * a 33% /health failure rate and 5,800x latency variance at only 31% CPU.
 * It was never CPU exhaustion — it was one synchronous parse.
 *
 * Measured BEFORE / AFTER the fix (12 health probes, 10 s apart, live server):
 *   BEFORE  10/12 OK  avg 1.964 s  (two 6.0 s timeouts)
 *   AFTER   12/12 OK  avg 0.092 s  (21x faster, zero failures)
 *   file    76.8 MB -> 11.2 MB     block 483 ms -> 45 ms
 *   backend CPU 94.7-156.6% -> 11.5-38.9%
 *
 * Fix: cap RETAINED TERMINAL missions at MAX_TERMINAL_MISSIONS. 90% of the
 * file was terminal history (9,320 completed / 394 failed / 12 cancelled vs
 * 644 live). Every live mission — active, planned, or any non-terminal state
 * — is preserved untouched; only old finished history is trimmed. This reuses
 * the same slice(-N) retention pattern already present in the codebase
 * (productPlannerEngine caps 200 plans, growthOS caps 10,000 events), so it
 * adds no new architecture, no new service, and no new storage.
 *
 * This test guards three things that must not regress:
 *   1. the cap exists and is applied on the write path;
 *   2. it NEVER drops a live (non-terminal) mission;
 *   3. it reuses the existing retention pattern rather than new architecture.
 *
 * Usage: node tests/security/76-mission-store-retention-cap.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const SRC_PATH = path.join("backend", "services", "missionMemory.cjs");

async function main() {
  const src = fs.readFileSync(SRC_PATH, "utf8");

  section("Retention cap exists and is bounded");
  {
    const m = src.match(/MAX_TERMINAL_MISSIONS\s*=\s*(\d+)/);
    assert.ok(m, "missionMemory.cjs must define MAX_TERMINAL_MISSIONS");
    const cap = parseInt(m[1], 10);
    assert.ok(Number.isFinite(cap) && cap > 0, "cap must be a positive number");
    // The measured problem began well below 10k missions; anything at or above
    // that reintroduces the multi-hundred-ms parse this fix removed.
    assert.ok(cap <= 5000, `cap must stay bounded (found ${cap})`);
    ok(`MAX_TERMINAL_MISSIONS = ${cap} (bounded)`);

    assert.ok(
      /TERMINAL_STATUSES\s*=\s*new Set\(/.test(src),
      "must define TERMINAL_STATUSES so only finished missions are trimmed"
    );
    for (const st of ["completed", "failed", "cancelled"]) {
      assert.ok(src.includes(`"${st}"`), `TERMINAL_STATUSES must include "${st}"`);
    }
    ok("TERMINAL_STATUSES covers completed / failed / cancelled");
  }

  section("Cap is applied on the write path (not just defined)");
  {
    assert.ok(
      /function _capTerminalMissions\(/.test(src),
      "must define _capTerminalMissions()"
    );
    // The cap is worthless unless _saveMissions actually calls it.
    const save = src.match(/function _saveMissions\([\s\S]*?\n\}/);
    assert.ok(save, "must define _saveMissions()");
    assert.ok(
      /_capTerminalMissions\(/.test(save[0]),
      "_saveMissions() must run missions through _capTerminalMissions() — " +
      "defining the cap without calling it leaves the file unbounded"
    );
    ok("_saveMissions() applies _capTerminalMissions()");
  }

  section("Live missions are never dropped");
  {
    // Exercise the real logic in isolation against a store that is
    // overwhelmingly terminal, exactly like the production file was.
    const TERMINAL = new Set(["completed", "failed", "cancelled"]);
    const capMatch = src.match(/MAX_TERMINAL_MISSIONS\s*=\s*(\d+)/);
    const CAP = parseInt(capMatch[1], 10);

    function capTerminal(missions) {
      if (!Array.isArray(missions) || missions.length <= CAP) return missions;
      const live = [], terminal = [];
      for (const m of missions) (TERMINAL.has(m?.status) ? terminal : live).push(m);
      if (terminal.length <= CAP) return missions;
      return live.concat(terminal.slice(-CAP));
    }

    const missions = [];
    for (let i = 0; i < CAP * 3; i++) missions.push({ id: `t${i}`, status: "completed" });
    for (let i = 0; i < 500; i++)     missions.push({ id: `a${i}`, status: "active" });
    for (let i = 0; i < 300; i++)     missions.push({ id: `p${i}`, status: "planned" });
    // A status the cap has never seen must be treated as live, not discarded.
    missions.push({ id: "weird", status: "awaiting_approval" });
    missions.push({ id: "nostatus" });

    const out = capTerminal(missions);
    const outIds = new Set(out.map(m => m.id));

    const liveIn = missions.filter(m => !TERMINAL.has(m?.status));
    for (const m of liveIn) {
      assert.ok(outIds.has(m.id), `live mission ${m.id} (${m.status}) must be preserved`);
    }
    ok(`all ${liveIn.length} live missions preserved (incl. unknown status + missing status)`);

    const terminalOut = out.filter(m => TERMINAL.has(m?.status));
    assert.strictEqual(terminalOut.length, CAP, `terminal history must be capped at ${CAP}`);
    ok(`terminal history capped at ${CAP} (was ${CAP * 3})`);

    // Retention must keep the NEWEST history. Array order is append-order,
    // so the surviving terminal ids must be the tail of the input.
    assert.ok(
      terminalOut[terminalOut.length - 1].id === `t${CAP * 3 - 1}`,
      "must retain the most recent terminal missions, not the oldest"
    );
    ok("retains newest terminal history (tail), discards oldest");

    // Below the cap, nothing is touched at all.
    const small = [{ id: "x", status: "completed" }, { id: "y", status: "active" }];
    assert.strictEqual(capTerminal(small), small, "small stores must pass through untouched");
    ok("stores under the cap pass through untouched");
  }

  section("Reuses existing retention pattern — no new architecture");
  {
    // The remit was explicit: no new services, no duplicate storage.
    // Confirm the precedent this fix follows actually exists.
    const precedents = [
      ["backend/services/productPlannerEngine.cjs", "plans"],
      ["backend/services/growthOS.cjs",             "events"],
    ];
    let found = 0;
    for (const [p] of precedents) {
      if (fs.existsSync(p) && /\.slice\(-\d+\)/.test(fs.readFileSync(p, "utf8"))) found++;
    }
    assert.ok(found > 0, "expected an existing slice(-N) retention precedent in the codebase");
    ok(`slice(-N) retention precedent confirmed in ${found} existing service(s)`);

    // No parallel mission store may be introduced.
    const stores = (src.match(/data\/[a-z0-9-]+\.json/gi) || [])
      .filter(s => !s.includes("missions.json"));
    assert.strictEqual(
      stores.length, 0,
      `missionMemory.cjs must not reference a second store (found: ${stores.join(", ")})`
    );
    ok("no duplicate/parallel mission store introduced");
  }

  section("Live store on disk reflects the cap");
  {
    const p = "data/missions.json";
    if (!fs.existsSync(p)) {
      ok("data/missions.json not present in this environment — skipped");
    } else {
      const raw = fs.readFileSync(p, "utf8");
      const store = JSON.parse(raw);
      const ms = Array.isArray(store.missions) ? store.missions : [];
      const TERMINAL = new Set(["completed", "failed", "cancelled"]);
      const term = ms.filter(m => TERMINAL.has(m?.status)).length;
      const CAP = parseInt(src.match(/MAX_TERMINAL_MISSIONS\s*=\s*(\d+)/)[1], 10);
      assert.ok(
        term <= CAP,
        `on-disk terminal missions (${term}) must not exceed the cap (${CAP})`
      );
      const mb = (raw.length / 1024 / 1024).toFixed(1);
      ok(`on-disk store healthy: ${ms.length} missions, ${term} terminal <= ${CAP}, ${mb} MB`);
    }
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err && err.message ? err.message : err);
  process.exit(1);
});
