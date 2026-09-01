#!/usr/bin/env node
"use strict";
/**
 * Communication Ecosystem mission — /p19/tools/:toolId/execute cross-tenant
 * Slack-send (and general tool-execution) authorization fix.
 *
 * CONFIRMED finding, direct verification: backend/routes/phase19.js mounted
 * ONLY requireAuth on the entire /p19 router — zero tenant/org scoping, and
 * no operator restriction. toolExecutionLayer.cjs's TOOL_DEFS marks Slack's
 * chat.postMessage (post_message) as risk:"low", which _defaultPerms()
 * allows by default, and the route never passed opts.orgId, so the
 * existing (but until-now-dead-from-this-route's-perspective) org-scoped
 * resolvePermission()/setScopedPermission() overlay never activated. Net
 * effect: ANY authenticated user on the ENTIRE platform — any tenant, any
 * org — could call POST /p19/tools/slack/execute {"action":"post_message",
 * "params":{"channel":...,"text":...}} and it would genuinely call Slack's
 * real chat.postMessage using the founder's global SLACK_BOT_TOKEN, with
 * no tenant boundary whatsoever. The same generic route also reaches
 * github/gmail/gdrive/telegram/notion/openrouter/ollama/system:exec.
 *
 * Fix: every sub-module mounted under /p19 (19A tool execution — including
 * system:exec and GitHub repo access; 19B agent coordination; 19C
 * self-healing; 19D continuous learning) is founder/operator-facing
 * internal automation tooling with no tenant concept at all — restricted
 * the whole router to operatorOnly, the same gate already established and
 * audited for 15+ other platform-wide-surface route groups in this exact
 * codebase (revenueOS.js's financial routes, payment.js's gateway-refund
 * routes from this same mission chain's Payments Ecosystem pass).
 *
 * Usage: node tests/security/146-phase19-tools-operator-only-tenant-fix.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function resStub() {
  let code = null, body = null;
  return { status(c) { code = c; return this; }, json(b) { body = b; return this; }, _code: () => code, _body: () => body };
}

async function main() {
  section("Wiring — the entire /p19 router now composes requireAuth + operatorOnly");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/phase19.js"), "utf8");
    assert(/router\.use\("\/p19", requireAuth, operatorOnly\)/.test(src),
      "the router-level middleware mount includes operatorOnly, not just requireAuth");
    assert(/const \{ requireAuth, operatorOnly \} = require\("\.\.\/middleware\/authMiddleware"\)/.test(src),
      "operatorOnly is imported from the same authMiddleware module every other operator-gated route in this codebase uses");
  }

  section("Behavior — a non-operator authenticated user is rejected before any route handler runs");
  {
    const { operatorOnly } = require("../../backend/middleware/authMiddleware");
    let called = false;
    const res = resStub();
    const req = { user: { sub: "regular-customer", role: "user" } };
    operatorOnly(req, res, () => { called = true; });
    assert(called === false, "a non-operator never reaches the Slack/tool-execution handler");
    assert(res._code() === 403, "caller receives 403, not a silent pass-through", `got ${res._code()}`);
  }

  section("Behavior — an unauthenticated request is rejected (401), not silently allowed");
  {
    const { operatorOnly } = require("../../backend/middleware/authMiddleware");
    let called = false;
    const res = resStub();
    const req = {};
    operatorOnly(req, res, () => { called = true; });
    assert(called === false, "a request with no user at all never reaches the handler");
    assert(res._code() === 401, "caller receives 401", `got ${res._code()}`);
  }

  section("Behavior — a genuine operator still passes through to the handler");
  {
    const { operatorOnly } = require("../../backend/middleware/authMiddleware");
    let called = false;
    const req = { user: { sub: "founder-account", role: "operator" } };
    operatorOnly(req, resStub(), () => { called = true; });
    assert(called === true, "an operator reaches the handler normally, tool execution still works for its real purpose");
  }

  section("Regression — toolExecutionLayer.cjs's own internals (unaffected by the route-level fix) still pass");
  {
    const tel = require("../../backend/services/toolExecutionLayer.cjs");
    const result = await tel.execute("slack", "post_message", { channel: "test", text: "test" }, {});
    // Still unconfigured in this test env (no SLACK_BOT_TOKEN) — confirms
    // the service layer itself is untouched, only the route gained a gate.
    assert(result.success === false, "toolExecutionLayer.execute() for slack still returns an honest failure with no token configured", JSON.stringify(result));
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
