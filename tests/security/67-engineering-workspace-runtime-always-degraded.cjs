#!/usr/bin/env node
"use strict";
/**
 * Engineering Workspace's Runtime tile always showed "Degraded" — Phase
 * A.8 (SaaS Builder Certification, Engineering Workspace section).
 *
 * CONFIRMED finding (reproduced live: real SaaS-founder account, Eng
 * Workspace's Observability panel): the "Runtime" indicator showed
 * "Degraded" every single time the page loaded, regardless of actual
 * backend health, and the "Queue" indicator always showed "—" even when
 * the real backend queue had items.
 *
 * Root cause: backend/routes/runtime.js's GET /runtime/status returns
 * `{ ...orchestrator.status(), sse, emergency, degraded, drift }`, and
 * orchestrator.status() (agents/runtime/runtimeOrchestrator.cjs) returns
 * `{ queue: { size, items }, agents, history, uptime, runaway, throttle,
 * governor, vitals }` — there is no `ok` or `healthy` field anywhere in
 * that shape, and queue depth lives at `queue.size`, not `queue.depth`.
 * EngineeringWorkspace.jsx's `runtimeStatus?.ok || runtimeStatus?.healthy`
 * check therefore always evaluated false whenever the call succeeded, so
 * the tile always showed "Degraded" — and worse, the same broken check
 * fed the Observe pipeline stage's own `healthy` flag, which the Heal
 * stage's decision-making depends on, a real functional defect beyond
 * just a cosmetic label. `runtimeStatus?.queue?.depth` was reading a field
 * that has never existed in the real response.
 *
 * Fix: added `_isRuntimeHealthy(runtimeStatus)`, deriving real health from
 * fields the backend actually returns — not `degraded`, no `runaway`
 * failure pattern, and (when there's history to judge) a reasonable
 * success rate — reused at both call sites (the Observe stage's healthy
 * flag and the Runtime tile's label/color). Queue now reads
 * `runtimeStatus.queue.size`, the real field.
 *
 * Usage: node tests/security/67-engineering-workspace-runtime-always-degraded.cjs
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
  const src = fs.readFileSync(require.resolve("../../frontend/src/components/EngineeringWorkspace.jsx"), "utf8");
  const svcSrc = fs.readFileSync(require.resolve("../../agents/runtime/runtimeOrchestrator.cjs"), "utf8");

  section("Backend: orchestrator.status() genuinely has no ok/healthy field (confirms the bug's premise)");
  {
    const fnMatch = svcSrc.match(/function status\(\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find orchestrator's status() function");
    assert.ok(!/\bok:\s*true|\bhealthy:\s*/.test(fnMatch[0]),
      "status() must not return an ok/healthy field — confirms the frontend's old check was always false");
    assert.ok(/queue:\s*\{\s*size:/.test(fnMatch[0]), "status() must return queue.size (not queue.depth)");
    ok("orchestrator.status()'s real shape confirmed: no ok/healthy field, queue.size not queue.depth");
  }

  section("Frontend: the old always-false ok/healthy check is removed");
  {
    assert.ok(!/runtimeStatus\?\.ok \|\| runtimeStatus\?\.healthy/.test(src),
      "the old broken runtimeStatus?.ok || runtimeStatus?.healthy check must be removed everywhere");
    ok("no remaining references to the non-existent ok/healthy fields");
  }

  section("Frontend: _isRuntimeHealthy derives health from real fields and is used at both call sites");
  {
    assert.ok(/function _isRuntimeHealthy\(runtimeStatus\)/.test(src), "_isRuntimeHealthy helper must exist");
    const fnMatch = src.match(/function _isRuntimeHealthy\(runtimeStatus\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find _isRuntimeHealthy's body");
    assert.ok(/runtimeStatus\.degraded/.test(fnMatch[0]), "_isRuntimeHealthy must check the real `degraded` field");
    assert.ok(/runtimeStatus\.runaway/.test(fnMatch[0]), "_isRuntimeHealthy must check the real `runaway` field");
    assert.ok(/const runtimeOk = _isRuntimeHealthy\(runtimeStatus\)/.test(src),
      "the Observe pipeline stage must use _isRuntimeHealthy for its healthy flag");
    assert.ok(/_isRuntimeHealthy\(runtimeStatus\) \? "OK" : runtimeStatus \? "Degraded"/.test(src),
      "the Runtime tile label must use _isRuntimeHealthy");
    ok("_isRuntimeHealthy is defined correctly and used at both the Observe stage and the Runtime tile");
  }

  section("Frontend: Queue tile reads the real queue.size field, not the nonexistent queue.depth");
  {
    assert.ok(/runtimeStatus\?\.queue\?\.size \?\? "—"/.test(src),
      "the Queue tile must read runtimeStatus.queue.size, matching the real backend shape");
    assert.ok(!/runtimeStatus\?\.queue\?\.depth/.test(src), "the old nonexistent queue.depth read must be removed");
    ok("Queue tile reads the real queue.size field");
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
