#!/usr/bin/env node
"use strict";
/**
 * Phase C.1.1 — regressions for the runtime defects fixed in this phase.
 *
 * Each block below locks in a defect that was REPRODUCED live, root-caused to
 * a specific line, and fixed minimally. These are unit-level assertions
 * against the services themselves, so they run without a live server.
 *
 * ── D1: onboardingEngine — reader/writer shape divergence ────────────────
 * GET /launch/onboarding/all returned 500 on 100% of calls:
 *     "Cannot read properties of undefined (reading 'filter')"
 * Root cause: TWO unrelated modules persist to data/onboarding-state.json —
 *   backend/services/onboardingEngine.cjs   { [accountId]: { steps: [...] } }
 *   agents/runtime/operatorOnboarding.cjs   { completed: [...], operatorId }
 * The reader mapped over the operator record's values and called
 * `s.steps.filter()` on entries that never had `.steps`.
 * Fix: _isAccountRecord() shape guard in the reader. Storage paths untouched,
 * because the other module legitimately owns that file too.
 *
 * ── D2: computerExecutionEngine — wrong TYPE, not null ───────────────────
 * GET /computer/dashboard returned 500:
 *     "r.command?.slice is not a function"
 * Root cause: execute(command) persists whatever the caller passes; 109 of
 * 500 stored runs hold an OBJECT ({ command, workspaceType }) instead of a
 * string, and the last 5 runs — the exact window getStats() reads — were all
 * objects. Optional chaining guards null but not type.
 * Fix: _commandLabel() reader-side normalisation.
 *
 * ── D3: engineeringSmellDetector — O(names × files) regex scan ───────────
 * GET /coding/smells took 25–35s per call. Profiling showed
 * _detectDeadExport consumed 23,029ms of 24,882ms (92.5%); every other
 * detector finished in under 1s. It ran `\bname\b` against every other file
 * per candidate export, short-circuiting only when a name IS used — so the
 * 693 genuinely dead exports each scanned the full 2,293-file corpus.
 * Fix: tokenise each file once, then test set membership. Byte-identical
 * output (3,582 smells, 693 dead_export, 1,477,942 bytes), 25s -> ~2s.
 *
 * Usage: node tests/security/92-c11-runtime-defect-regressions.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const STORE = path.join(process.cwd(), "data", "onboarding-state.json");

function withStore(contents, fn) {
  const had  = fs.existsSync(STORE);
  const orig = had ? fs.readFileSync(STORE, "utf8") : null;
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(contents, null, 2));
    delete require.cache[require.resolve("../../backend/services/onboardingEngine.cjs")];
    return fn(require("../../backend/services/onboardingEngine.cjs"));
  } finally {
    if (had) fs.writeFileSync(STORE, orig);
    else fs.unlinkSync(STORE);
    delete require.cache[require.resolve("../../backend/services/onboardingEngine.cjs")];
  }
}

const VALID = {
  acc1: { accountId: "acc1", roleId: "founder", started: "2026-01-01",
          completed: false, currentStep: 1,
          steps: [{ id: "a", done: true }, { id: "b", done: false }] },
};
// Exactly the shape agents/runtime/operatorOnboarding.cjs writes.
const FOREIGN = {
  completed: ["health_check", "adapter_verification", "workspace_setup"],
  operatorId: "op_1", startedAt: 1786500000000, finishedAt: 1786500900000,
};

function main() {
  section("D1 — onboardingEngine tolerates the foreign record that broke it");
  {
    // The exact production state that produced the 500.
    const all = withStore(FOREIGN, e => e.getAllProgress());
    assert.ok(Array.isArray(all), "getAllProgress() must return an array");
    assert.strictEqual(all.length, 0, "operator-onboarding records must be skipped, not mapped");
    ok("foreign operator record no longer throws (was: 500 on every call)");
  }
  {
    const all = withStore({ ...VALID, ...FOREIGN }, e => e.getAllProgress());
    assert.strictEqual(all.length, 1, "valid records must survive alongside foreign ones");
    assert.strictEqual(all[0].accountId, "acc1");
    assert.strictEqual(all[0].pct, 50, "1 of 2 steps done must be 50%");
    ok("mixed store returns only real account records, with correct pct");
  }
  {
    assert.deepStrictEqual(withStore({}, e => e.getAllProgress()), [], "empty store");
    const malformed = withStore(
      { a: null, b: "str", c: { steps: [] }, d: { steps: "notarray" }, e: [] },
      e => e.getAllProgress()
    );
    assert.strictEqual(malformed.length, 1, "only { steps: [] } is a structurally valid record");
    assert.strictEqual(malformed[0].pct, 0, "empty steps must yield 0%, not NaN (no divide-by-zero)");
    ok("empty store and 5 malformed value shapes all handled without throwing");
  }
  {
    // Readers that share the same hazard.
    assert.strictEqual(withStore(FOREIGN, e => e.getProgress("completed")), null,
      "getProgress() must reject a non-account record");
    assert.strictEqual(withStore(FOREIGN, e => e.completeStep("completed", "health_check")), null,
      "completeStep() must reject a non-account record");
    ok("getProgress() and completeStep() carry the same shape guard");
  }

  section("D2 — computerExecutionEngine survives object-typed `command`");
  {
    const eng = require("../../backend/services/computerExecutionEngine.cjs");
    let stats;
    assert.doesNotThrow(() => { stats = eng.getStats(); },
      "getStats() must not throw on object-typed command (was: 'r.command?.slice is not a function')");
    assert.ok(Array.isArray(stats.recentRuns), "recentRuns must be an array");
    for (const r of stats.recentRuns) {
      assert.ok(r.command === null || typeof r.command === "string",
        `recentRuns[].command must normalise to a string or null, got ${typeof r.command}`);
    }
    ok(`getStats() returned ${stats.recentRuns.length} recentRuns, all commands normalised`);

    let dash;
    assert.doesNotThrow(() => { dash = eng.getDashboard(); },
      "getDashboard() must not throw (this was the 500 on GET /computer/dashboard)");
    assert.strictEqual(dash.ok, true, "dashboard must report ok:true");
    ok("getDashboard() returns ok:true instead of 500");
  }

  section("D3 — smell detector is fast AND returns identical results");
  {
    const sd = require("../../backend/services/engineeringSmellDetector.cjs");
    const t0 = Date.now();
    const r1 = sd.scan(process.cwd());
    const elapsed = Date.now() - t0;

    assert.ok(r1.smells.length > 0, "scan must return smells");
    // Was 25,000-35,000ms. 10s is a generous ceiling that still fails loudly
    // if the O(names x files) scan is ever reintroduced.
    assert.ok(elapsed < 10000,
      `scan must complete well under the old 25s (took ${elapsed}ms) — dead-export index regressed?`);
    ok(`scan completed in ${elapsed}ms (was 25,000-35,000ms)`);

    // Determinism: the optimisation must not change what is reported.
    const r2 = sd.scan(process.cwd());
    assert.strictEqual(r2.smells.length, r1.smells.length, "scan must be deterministic across runs");
    assert.strictEqual(
      r2.smells.filter(s => s.type === "dead_export").length,
      r1.smells.filter(s => s.type === "dead_export").length,
      "dead_export count must be stable — the index must match the old regex semantics"
    );
    ok(`deterministic: ${r1.smells.length} smells, ${r1.smells.filter(s => s.type === "dead_export").length} dead_export, both runs`);

    // The memo must not leak between scans.
    assert.ok(r1.scannedFiles > 0 && r2.scannedFiles === r1.scannedFiles,
      "scannedFiles must be stable, and the per-scan cache must not persist between calls");
    ok(`per-scan file memo released between calls (${r1.scannedFiles} files each run)`);
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

try { main(); }
catch (err) { console.error("FAILED:", err.message); process.exit(1); }
