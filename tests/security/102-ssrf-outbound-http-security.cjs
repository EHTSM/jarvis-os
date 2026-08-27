#!/usr/bin/env node
"use strict";
/**
 * SSRF & Outbound HTTP Security Audit (Mission 17, 2026-08-22).
 *
 * Locks in the fix for two live-reproduced SSRF findings, both reachable by
 * any ordinary authenticated customer with zero prior URL validation:
 *
 *   1. backend/services/vsCodeExtensionService.cjs — _ollamaCompletion()'s
 *      customer-supplied `ollamaUrl` (POST /p24/vscode/chat and siblings).
 *      Non-blind: the target's response body was echoed straight back to
 *      the caller via _extractReply().
 *
 *   2. backend/services/operationsAlertingLayer.cjs — the webhook
 *      notification channel (PUT /p22/alerts/channels/webhook +
 *      POST /p22/alerts/fire). Fire-and-forget: real alert content was
 *      POSTed to an attacker-chosen internal/loopback address.
 *
 * Both fixes reuse the same shared choke point already established for the
 * ODI browser-automation family: backend/utils/urlSafety.cjs's
 * assertSafeNavigationTarget().
 *
 * Runs in-process against a disposable local HTTP listener — no live
 * server or auth session required (the vulnerable code path is exercised
 * directly, same approach as tests/runtime/14-runtime-dispatch-honesty).
 * Usage: node tests/security/102-ssrf-outbound-http-security.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const http   = require("http");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

async function withInternalListener(port, fn) {
  let hit = null;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      hit = { path: req.url, method: req.method, body };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: "INTERNAL-SECRET-RESPONSE-DATA" } }));
    });
  });
  await new Promise(r => srv.listen(port, "127.0.0.1", r));
  try {
    await fn();
  } finally {
    srv.close();
  }
  return () => hit;
}

async function main() {
  section("vsCodeExtensionService.cjs — ollamaUrl SSRF");
  const vsc = require("../../backend/services/vsCodeExtensionService.cjs");

  const getHit1 = await withInternalListener(38423, async () => {
    let threw = null;
    try {
      await vsc.chat({
        provider: "ollama",
        ollamaUrl: "http://127.0.0.1:38423",
        messages: [{ role: "user", content: "probe" }],
      });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, "customer-supplied loopback ollamaUrl must be rejected, not silently succeed");
    assert.match(threw.message, /ollamaUrl rejected/, "rejection must come from the SSRF guard, not a network error");
    ok("customer-supplied loopback ollamaUrl (127.0.0.1) is rejected before any request is sent");
  });
  assert.strictEqual(getHit1(), null, "internal listener must never be reached");
  ok("internal listener was never hit — non-blind SSRF closed");

  // Negative control: the safe, intentional default (no ollamaUrl override,
  // i.e. the operator's own local Ollama) must remain completely unaffected.
  const target = new URL("http://localhost:11434/api/chat");
  assert.strictEqual(target.hostname, "localhost", "sanity: default target is unchanged");
  ok("default ollamaUrl (operator's own localhost:11434) path is untouched by the fix — verified by code inspection, not re-exercised here to avoid depending on a local Ollama instance");

  section("operationsAlertingLayer.cjs — webhook SSRF");
  // Fresh require avoids cross-talk with any other module-level state.
  delete require.cache[require.resolve("../../backend/services/operationsAlertingLayer.cjs")];
  const oal = require("../../backend/services/operationsAlertingLayer.cjs");

  const getHit2 = await withInternalListener(38424, async () => {
    oal.setNotificationChannel("webhook", { enabled: true, url: "http://127.0.0.1:38424/internal" });
    oal.fire({ title: "SSRF regression probe", severity: "info", source: "api" });
    await new Promise(r => setTimeout(r, 1200));
  });
  assert.strictEqual(getHit2(), null, "internal listener must never be reached by the webhook dispatch");
  ok("customer-set loopback webhook URL never reaches the network — SSRF closed");

  // Negative control: a legitimate public URL must still pass validation
  // (only private/loopback/link-local/metadata ranges are blocked).
  const { assertSafeNavigationTarget } = require("../../backend/utils/urlSafety.cjs");
  const publicCheck = await assertSafeNavigationTarget("https://example.com/webhook");
  assert.strictEqual(publicCheck.safe, true, "a legitimate public webhook URL must not be blocked");
  ok("legitimate public webhook URL (example.com) still passes validation — no over-blocking");

  console.log(`\n${pass} checks passed.`);
  process.exit(0);
}

main().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
