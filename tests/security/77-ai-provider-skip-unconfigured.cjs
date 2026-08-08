#!/usr/bin/env node
"use strict";
/**
 * AI router attempted every provider even when no credential existed — Phase B.1 P1
 * (Runtime Stabilization & Infrastructure Activation).
 *
 * CONFIRMED finding, measured on the running server:
 *
 *   callAI() iterated all 14 providers on every request. Each key-based
 *   provider threw "X_API_KEY not set" only AFTER being entered, so a
 *   statically-knowable fact was rediscovered by attempting a call, 14 times
 *   per request. The autonomous AutoLoop drives this continuously.
 *
 * Measured BEFORE the fix (single session log):
 *   8,358 WARN lines out of 13,541 total  => 62% of ALL backend logging
 *   ten providers failing 592 times each, all "…_API_KEY not set"
 *
 * Measured AFTER the fix (120s of AutoLoop activity):
 *   "not set" WARNs: 8,358 -> 3   (the 3 are startup config checks)
 *   WARN share of log: 62% -> 32.7%
 *   remaining AI WARNs are exclusively REAL failures:
 *     openai 401 (invalid key), groq 429 (rate limited),
 *     ollama/lmstudio genuinely not reachable
 *
 * Fix: filter statically-unconfigured providers out of _providerOrder() —
 * the function that already owns provider selection. No new service, no new
 * routing layer, no change to callAI()'s failure contract. Extends the same
 * fail-fast reasoning already applied to local providers by
 * _assertLocalServerUp().
 *
 * ── THE CRITICAL GUARANTEE THIS TEST EXISTS TO PROTECT ────────────────────
 * Skipping must apply ONLY to providers with NO key configured. A provider
 * that HAS a key and fails (401 invalid, 429 rate-limited) must still be
 * attempted and still be reported. Credential failures must never be hidden
 * or converted into a generic message. If a future change makes this filter
 * skip a configured-but-failing provider, this test must fail.
 *
 * Usage: node tests/security/77-ai-provider-skip-unconfigured.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const SRC = fs.readFileSync("backend/services/aiService.js", "utf8");

/**
 * Rebuild the real _PROVIDER_KEY_ENV + _isUnconfigured + _providerOrder from
 * source and run them against a controlled env. Source extraction (rather
 * than require()) keeps the module's export surface unchanged — exporting
 * internals purely for a test would itself be an architecture change.
 */
function makeOrderFn() {
  const keyEnv = SRC.match(/const _PROVIDER_KEY_ENV\s*=\s*\{[\s\S]*?\n\};/);
  assert.ok(keyEnv, "aiService must define _PROVIDER_KEY_ENV");
  const isUnconf = SRC.match(/function _isUnconfigured\([\s\S]*?\n\}/);
  assert.ok(isUnconf, "aiService must define _isUnconfigured()");
  const order = SRC.match(/function _providerOrder\(\)[\s\S]*?\n\}/);
  assert.ok(order, "aiService must define _providerOrder()");

  const body = `${keyEnv[0]}\n${isUnconf[0]}\n${order[0]}\nreturn _providerOrder();`;
  return env => new Function("process", body)({ env });
}

async function main() {
  const orderWith = makeOrderFn();

  const ALL = ["groq", "openrouter", "openai", "claude", "gemini", "ollama",
               "deepseek", "together", "fireworks", "cohere", "nvidia",
               "lmstudio", "grok", "qwen"];
  const LOCAL = ["ollama", "lmstudio"];

  section("Unconfigured key-based providers are skipped");
  {
    const none = orderWith({});
    for (const p of ALL) {
      if (LOCAL.includes(p)) continue;
      assert.ok(!none.includes(p), `key-less provider "${p}" must not be attempted`);
    }
    ok(`with zero API keys, all 12 key-based providers skipped (was 14 attempts)`);
  }

  section("CRITICAL: configured-but-FAILING providers are still attempted");
  {
    // The measured production state: OpenAI key present but invalid (401),
    // Groq key present but rate-limited (429). Both MUST still be tried so
    // the real error surfaces to the operator.
    const invalidKey = orderWith({ OPENAI_API_KEY: "sk-invalid-401" });
    assert.ok(
      invalidKey.includes("openai"),
      "a provider WITH a key must be attempted even if that key is invalid — " +
      "otherwise a 401 would be silently hidden"
    );
    ok("openai with an invalid key is still attempted (401 surfaces)");

    const rateLimited = orderWith({ GROQ_API_KEY: "gsk-real-but-429" });
    assert.ok(
      rateLimited.includes("groq"),
      "a rate-limited provider must still be attempted so the 429 surfaces"
    );
    ok("groq with a rate-limited key is still attempted (429 surfaces)");

    // Whitespace-only must count as absent, not as a real key.
    const blank = orderWith({ OPENAI_API_KEY: "   " });
    assert.ok(!blank.includes("openai"), "whitespace-only key must count as unconfigured");
    ok("whitespace-only key treated as unconfigured");
  }

  section("Local providers are never key-gated");
  {
    const none = orderWith({});
    for (const p of LOCAL) {
      assert.ok(
        none.includes(p),
        `local provider "${p}" has no API key and must never be filtered out — ` +
        `it is already fail-fast guarded by _assertLocalServerUp()`
      );
    }
    ok("ollama + lmstudio always retained (guarded by port probe, not by key)");
  }

  section("Never returns an empty provider list");
  {
    // callAI() must still run and still return its honest
    // "AI backend unavailable" sentinel rather than silently doing nothing.
    const none = orderWith({});
    assert.ok(none.length > 0, "provider order must never be empty");
    ok(`empty-list guard holds (${none.length} provider(s) with zero keys configured)`);

    assert.ok(
      /AI backend unavailable\. Check provider API keys/.test(SRC),
      "callAI() must still return the honest unavailability sentinel"
    );
    ok("honest failure sentinel still present in callAI()");
  }

  section("Preferred-provider ordering still honoured");
  {
    const pref = orderWith({
      OPENAI_API_KEY: "k", GROQ_API_KEY: "k", LLM_PROVIDER: "openai",
    });
    assert.strictEqual(pref[0], "openai", "LLM_PROVIDER must still take priority");
    ok("LLM_PROVIDER preference preserved");

    const configured = orderWith({ OPENAI_API_KEY: "k", GROQ_API_KEY: "k" });
    for (const p of ["openai", "groq"]) {
      assert.ok(configured.includes(p), `configured provider "${p}" must be present`);
    }
    ok(`2 real keys => ${configured.length} attempts instead of ${ALL.length}`);
  }

  section("No new service or routing layer introduced");
  {
    // The remit forbids architecture expansion — the fix must live inside the
    // existing selection function.
    assert.ok(
      /const usable = ordered\.filter\(p => !_isUnconfigured\(p\)\)/.test(SRC),
      "filtering must happen inside the existing _providerOrder()"
    );
    ok("fix contained within existing _providerOrder() — no new module");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err && err.message ? err.message : err);
  process.exit(1);
});
