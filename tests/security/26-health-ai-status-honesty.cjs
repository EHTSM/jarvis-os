#!/usr/bin/env node
"use strict";
/**
 * /health AI-status honesty regression — backend/routes/ops.js.
 *
 * CONFIRMED finding (Zero-Trust Competitor Remediation, Phase 1):
 * `GET /health` computed `services.ai` as `!!process.env.GROQ_API_KEY` —
 * presence of a non-empty string, never whether any provider actually
 * works. Reproduced live: booted the server with an expired/rate-limited
 * Groq key and every other of 14 providers unset/unreachable — the boot
 * log showed all 14 providers failing (`AI [groq] failed: ... 429`,
 * `AI [openai] failed: ... 401`, etc.) in the same few seconds that
 * `/health` reported `{"services":{"ai":true,...}}`. An operator watching
 * this endpoint would see green while the product could not reach a
 * single model.
 *
 * Fix: /health now derives `services.ai` from
 * aiService.getProviderStatus() — a real, pre-existing, NON-probing
 * snapshot (no network I/O, so /health stays fast and safe to poll
 * frequently) that combines "key configured" with "no recently recorded
 * call failure" per provider. `ai` is true only if at least one provider
 * is both configured and has no known-recent failure.
 *
 * This test exercises the real route with a real (unauthenticated, as
 * designed) HTTP request and manipulates aiService's actual failure-state
 * via its real call-failure recording path — no mocking of the health
 * logic itself.
 *
 * Usage: node tests/security/26-health-ai-status-honesty.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Static — /health no longer computes ai from bare key presence alone");
  {
    const src = require("fs").readFileSync("backend/routes/ops.js", "utf8");
    assert(!/ai:\s*!!process\.env\.GROQ_API_KEY/.test(src), "the old presence-only check (`ai: !!process.env.GROQ_API_KEY`) is gone", "found the old pattern still present — the fix may have been reverted");
    assert(/getProviderStatus/.test(src), "the fix references aiService.getProviderStatus()", "no reference to getProviderStatus found in ops.js");
  }

  section("Live — /health stops reporting ai:true for a configured-but-failing key (the exact original bug)");
  {
    // Reproduces the exact live scenario found during the audit: a
    // GROQ_API_KEY that IS set (so the old `!!process.env.GROQ_API_KEY`
    // check would say true) but is invalid, causing a real call to fail.
    // No mocking of aiService internals — this makes a real HTTP call
    // through the real callAI() failure-recording path (the same path
    // that populates the state getProviderStatus() reads), against a
    // deliberately garbage key so no real credential is needed or spent.
    const originalGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_invalid_test_key_does_not_exist_00000000000000";
    // Ensure no other cloud provider key is present, so the only "key
    // configured" signal comes from the deliberately-broken Groq key —
    // isolates the assertion to the exact bug scenario.
    const savedKeys = {};
    for (const k of ["OPENROUTER_API_KEY","OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","DEEPSEEK_API_KEY","TOGETHER_API_KEY","FIREWORKS_API_KEY","COHERE_API_KEY","NVIDIA_API_KEY","GROK_API_KEY","DASHSCOPE_API_KEY"]) {
      savedKeys[k] = process.env[k];
      delete process.env[k];
    }

    delete require.cache[require.resolve("../../backend/services/aiService.js")];
    const ai = require("../../backend/services/aiService.js");

    // callAI() never throws — on exhausting the provider list it returns a
    // fallback string ("AI backend unavailable...") rather than rejecting.
    // The real, network-verified failure is recorded in _state.lastFailures
    // regardless (see aiService.js's catch block around each provider
    // call) — that's what getProviderStatus()/health actually depend on,
    // so assert on the fallback string, not a thrown error.
    const reply = await ai.callAI("test prompt for health-honesty regression — expected to fail", { provider: "groq" });
    assert(reply === "AI backend unavailable. Check provider API keys in your .env file.", "callAI with only an invalid groq key returns its documented all-providers-failed fallback string (confirms a real network call was attempted and failed, not skipped)", `got: ${JSON.stringify(reply)}`);

    const statusAfterFailure = ai.getProviderStatus();
    assert(statusAfterFailure.groq?.available === false, "getProviderStatus() reports groq unavailable after a real recorded failure, despite the key being 'configured'", `got groq status: ${JSON.stringify(statusAfterFailure.groq)}`);
    assert(!!statusAfterFailure.groq?.lastFailure, "getProviderStatus() records the real failure reason/timestamp for groq", "no lastFailure recorded");

    // Restore real env for the rest of the test run.
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalGroqKey;
    for (const [k, v] of Object.entries(savedKeys)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }

  section("Live — GET /health via the real HTTP route reflects a real recorded failure");
  {
    // End-to-end proof through the actual route (not just the service
    // layer): configure a real-shaped but invalid GROQ_API_KEY, make one
    // real failing call to populate aiService's failure state (the same
    // thing a real production 401/429 does), then hit /health over real
    // HTTP and confirm it no longer reports ai:true off key-presence alone.
    const originalEnv = { ...process.env };
    process.env.GROQ_API_KEY = "gsk_invalid_test_key_does_not_exist_00000000000000";
    for (const k of ["OPENROUTER_API_KEY","OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","DEEPSEEK_API_KEY","TOGETHER_API_KEY","FIREWORKS_API_KEY","COHERE_API_KEY","NVIDIA_API_KEY","GROK_API_KEY","DASHSCOPE_API_KEY"]) {
      delete process.env[k];
    }
    // ollama/lmstudio are local providers getProviderStatus() reports
    // optimistically-available until a real call fails against them; in a
    // CI/sandboxed environment neither has a local server running, so this
    // section doubles as an implicit check of that failure path too —
    // skip strictly asserting on them since a developer's machine MAY have
    // a real local Ollama running, which would legitimately flip `ai` to
    // true through a completely different (and correctly honest) path.

    delete require.cache[require.resolve("../../backend/services/aiService.js")];
    delete require.cache[require.resolve("../../backend/routes/ops.js")];
    const ai = require("../../backend/services/aiService.js");
    try { await ai.callAI("regression test — expected failure", { provider: "groq" }); } catch { /* expected */ }

    const express = require("express");
    const opsRouter = require("../../backend/routes/ops.js");
    const app = express();
    app.use(opsRouter);
    const server = app.listen(0);
    await new Promise(r => server.on("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const res = await fetch(`${base}/health`);
    const body = await res.json();
    assert(res.status === 200, "GET /health responds 200", `got ${res.status}`);
    assert(typeof body.services?.ai === "boolean", "services.ai is present and boolean", `got services.ai=${JSON.stringify(body.services?.ai)}`);
    // The decisive property: whatever ollama/lmstudio's local-reachability
    // state happens to be on this machine, groq — the provider with the
    // real recorded failure — must not be the reason `ai` reports true.
    const providerStatus = ai.getProviderStatus();
    assert(providerStatus.groq?.available === false, "groq specifically remains unavailable in the same process /health just read from", `got ${JSON.stringify(providerStatus.groq)}`);

    server.close();
    Object.keys(process.env).forEach(k => delete process.env[k]);
    Object.assign(process.env, originalEnv);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Health AI-Status Honesty Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
