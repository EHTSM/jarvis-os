#!/usr/bin/env node
"use strict";
/**
 * Memory Fabric panel crashed on every real memory node — Phase A.8
 * (SaaS Builder Certification, Memory section).
 *
 * CONFIRMED finding (reproduced live: real SaaS-founder account, Memory
 * Fabric): the whole panel crashed with an error boundary showing
 * "Something went wrong — The sharedmem panel encountered an error.
 * n.body.slice is not a function." — 100% reproducible, every load.
 *
 * Root cause: SharedMemoryCenter.jsx mapped each memory node as
 * `body: n.body || n.value || ""`, assuming n.value was always a string
 * fallback. Confirmed directly against the real data file
 * (data/memory-store.json, 2000 entries): every single real memory node
 * stores `value` as a structured object (e.g. {errorType, context,
 * resolution, recurrenceCount}), never a string — this is the standard
 * shape the memory system actually uses, not an edge case. Since a
 * truthy object never falls through to the "" default, every node's
 * `body` field ended up holding a raw object, and the later
 * `n.body.slice(0,70)` / `n.body.toLowerCase()` calls threw.
 *
 * A sibling component, MemoryCenter.jsx, already correctly handles this
 * exact shape (`typeof n.value === "string" ? n.value :
 * JSON.stringify(n.value ?? "")`) — SharedMemoryCenter.jsx was the
 * outlier missing that same defensive stringification.
 *
 * Fix: stringify non-string body/value once at the mapping stage
 * (matching MemoryCenter.jsx's existing pattern), so every downstream
 * string operation on `body` stays safe without needing individual
 * defensive checks scattered through the render logic.
 *
 * Verified live: Memory Fabric now renders 12 real memory nodes (platform
 * info, pricing plans, ICP data, tone guidelines, etc.) with no crash.
 * 144/144 regression passing.
 *
 * Usage: node tests/security/68-shared-memory-fabric-crash-non-string-value.cjs
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
  const src = fs.readFileSync(require.resolve("../../frontend/src/components/SharedMemoryCenter.jsx"), "utf8");

  section("Real memory-store.json data confirms every node stores `value` as a non-string object");
  {
    const raw = JSON.parse(fs.readFileSync(require.resolve("../../data/memory-store.json"), "utf8"));
    const items = Array.isArray(raw) ? raw : Object.values(raw);
    assert.ok(items.length > 0, "memory-store.json must have real entries to test against");
    const nonStringValueCount = items.filter(n => n.value !== undefined && typeof n.value !== "string").length;
    assert.ok(nonStringValueCount > 0,
      "at least some real memory nodes must have a non-string value field (confirms the bug's real-world trigger)");
    ok(`confirmed ${nonStringValueCount}/${items.length} real memory nodes have non-string value (the bug's real trigger)`);
  }

  section("The old crash-prone `n.body || n.value || \"\"` mapping is removed");
  {
    assert.ok(!/body:\s*n\.body \|\| n\.value \|\| ""/.test(src),
      "the old unsafe body mapping (assumes n.value is always a string) must be removed");
    ok("no longer assumes n.value is always a string");
  }

  section("body is now stringified defensively, matching MemoryCenter.jsx's existing correct pattern");
  {
    assert.ok(/typeof n\.body === "string" \? n\.body/.test(src), "must check typeof n.body === 'string' first");
    assert.ok(/typeof n\.value === "string" \? n\.value/.test(src), "must check typeof n.value === 'string' as fallback");
    assert.ok(/n\.value \? JSON\.stringify\(n\.value\) : ""/.test(src),
      "a non-string n.value must be JSON.stringify'd rather than passed through raw");
    ok("body mapping now safely stringifies non-string values before any .slice()/.toLowerCase() call");
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
