#!/usr/bin/env node
"use strict";
/**
 * AI Chat and Developer Copilot reported fake success when every AI
 * provider failed — Phase A.10 (AI Intelligence Certification).
 *
 * CONFIRMED finding (reproduced live against the real provider stack):
 * aiService.callAI() deliberately does NOT throw when every provider in
 * the failover chain fails — its final line resolves to the sentinel
 * string "AI backend unavailable. Check provider API keys in your .env
 * file." (aiService.js:597).
 *
 * Reproduced with the real .env: only 2 of 10 providers are configured,
 * and at the time of reproduction BOTH were failing for genuine
 * infrastructure reasons — OPENAI_API_KEY returned a real HTTP 401
 * (verified by direct curl to api.openai.com/v1/models), and GROQ_API_KEY
 * returned a real HTTP 429 with "tokens per day (TPD): Limit 100000, Used
 * 99967" (verified by direct curl to api.groq.com). callAI() correctly
 * logged each real failure and returned the sentinel.
 *
 * The bug was in the consumers, not aiService:
 *
 * 1. backend/routes/ai.js's POST /ai/chat — the primary AI Workspace
 *    endpoint — returned { success: true, reply: <sentinel> }, so a total
 *    provider outage was rendered to the founder as though the AI had
 *    replied with that sentence. It ALSO recorded success:true into
 *    usageMetering, corrupting AI usage/cost analytics with fake successes.
 *
 * 2. backend/routes/codingAssistant.js — the Developer Copilot, 12 call
 *    sites — returned { ok: true, reply: <sentinel> } for the same reason.
 *
 * Fix: detect the sentinel using the exact same check creativeStudio.js
 * already established in Phase A.7 (`raw.startsWith("AI backend
 * unavailable")`). ai.js now returns a real 502 and records success:false.
 * codingAssistant.js routes all call sites through one `_callAI` helper
 * that throws, so each handler's pre-existing catch block returns an
 * honest 500 — no per-call-site rewrites, no new architecture.
 *
 * Verified both directions live: with a working provider, callAI returned
 * a genuine AI response and the guard correctly did NOT fire (no false
 * positives); with all keys cleared, the guard correctly fired.
 * 144/144 regression passing.
 *
 * Usage: node tests/security/74-ai-chat-fake-success-on-provider-failure.cjs
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
  const svcSrc  = fs.readFileSync(require.resolve("../../backend/services/aiService.js"), "utf8");
  const aiSrc   = fs.readFileSync(require.resolve("../../backend/routes/ai.js"), "utf8");
  const codeSrc = fs.readFileSync(require.resolve("../../backend/routes/codingAssistant.js"), "utf8");

  section("aiService.callAI still resolves (not throws) to the sentinel — confirms the bug's premise");
  {
    assert.ok(/return "AI backend unavailable\. Check provider API keys in your \.env file\.";/.test(svcSrc),
      "callAI must still return the sentinel string — consumers are responsible for detecting it");
    ok("callAI's non-throwing sentinel contract confirmed");
  }

  section("POST /ai/chat detects the sentinel and returns a real error instead of success:true");
  {
    assert.ok(/reply\.startsWith\("AI backend unavailable"\)/.test(aiSrc),
      "/ai/chat must detect the sentinel");
    assert.ok(/return res\.status\(502\)\.json\(\{/.test(aiSrc),
      "/ai/chat must return a real error status, not 200 success");
    ok("/ai/chat surfaces total provider failure honestly");
  }

  section("POST /ai/chat records the failure as success:false in usage metering");
  {
    const guardBlock = aiSrc.match(/if \(typeof reply !== "string"[\s\S]*?return res\.status\(502\)/);
    assert.ok(guardBlock, "could not locate the /ai/chat sentinel guard block");
    assert.ok(/success: false, errorCode: "all_providers_failed"/.test(guardBlock[0]),
      "a failed AI call must be metered as success:false, not success:true");
    ok("failed AI calls no longer corrupt usage metering with fake successes");
  }

  section("codingAssistant routes every callAI through one guarded helper");
  {
    assert.ok(/async function _callAI\(prompt, opts\)/.test(codeSrc), "_callAI guard helper must exist");
    const helper = codeSrc.match(/async function _callAI\(prompt, opts\) \{[\s\S]*?\n\}/);
    assert.ok(helper, "could not read _callAI's body");
    assert.ok(/reply\.startsWith\("AI backend unavailable"\)/.test(helper[0]),
      "_callAI must detect the sentinel");
    assert.ok(/throw new Error\(/.test(helper[0]),
      "_callAI must throw so existing catch blocks return honest errors");

    // Exactly one raw ai.callAI should remain: the one inside the helper.
    const rawCalls = (codeSrc.match(/\bai\.callAI\(/g) || []).length;
    assert.strictEqual(rawCalls, 1,
      `every route must go through _callAI; found ${rawCalls} raw ai.callAI calls (expected exactly 1, inside the helper)`);
    const guarded = (codeSrc.match(/await _callAI\(/g) || []).length;
    assert.ok(guarded >= 10, `expected the Copilot's many call sites to be guarded, found ${guarded}`);
    ok(`all ${guarded} Copilot call sites guarded; only the helper calls ai.callAI directly`);
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
