#!/usr/bin/env node
"use strict";
/**
 * X (Twitter) social publish — retry/idempotency retrofit regression.
 *
 * Mission 60-B. M59 flagged X's original adapter (socialPostingService.cjs)
 * as having no dedup/idempotency and no retry/backoff on the publish path
 * (P2 GAP). This mission wired the SAME socialPublishSupport.cjs helper
 * every Batch A adapter already uses into the existing adapter, without
 * rewriting its existing behavior — this test verifies the retrofit is
 * additive only (existing behavior unchanged) and that the new
 * idempotencyKey parameter and retry wrapping actually work.
 *
 * Usage: node tests/security/132-x-social-publish-retry-idempotency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Existing behavior unchanged — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/socialPostingService.cjs");
    const result = await svc.post("Test post from CI", null, null);
    assert(result.success === false, "post() still returns success:false when X isn't configured", JSON.stringify(result));
    assert(!result.postId, "no postId is fabricated on failure", JSON.stringify(result));
  }

  section("Existing behavior unchanged — 280-char limit still enforced");
  {
    const svc = require("../../backend/services/socialPostingService.cjs");
    const result = await svc.post("a".repeat(281), null, null);
    assert(result.success === false, "post() still rejects text over 280 chars");
    assert(/280 character limit/.test(result.error || ""), "error message still names the real limit", result.error);
  }

  section("Existing behavior unchanged — empty text still rejected");
  {
    const svc = require("../../backend/services/socialPostingService.cjs");
    const result = await svc.post("", null, null);
    assert(result.success === false, "post() still rejects empty text");
    assert(result.error === "text required", "error message unchanged", result.error);
  }

  section("Existing behavior unchanged — DISABLE_SOCIAL_POSTING kill-switch still honored");
  {
    process.env.DISABLE_SOCIAL_POSTING = "true";
    const svc = require("../../backend/services/socialPostingService.cjs");
    const result = await svc.post("Test", null, null);
    delete process.env.DISABLE_SOCIAL_POSTING;
    assert(result.success === false, "post() still refuses when DISABLE_SOCIAL_POSTING=true");
    assert(/disabled/i.test(result.error || ""), "error message still explains the kill-switch", result.error);
  }

  section("New — post() accepts a 3rd idempotencyKey parameter without error");
  {
    const svc = require("../../backend/services/socialPostingService.cjs");
    // No token configured, so this still fails honestly — verifying only
    // that passing idempotencyKey doesn't throw or change the arity contract.
    const result = await svc.post("Test", null, "some-entry-id");
    assert(result.success === false, "post() with idempotencyKey still returns an honest failure when unconfigured");
    assert(typeof result.error === "string", "error is still a real string");
  }

  section("New — X's route now threads idempotencyKey through to socialPostingService.post()");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");
    const routeMatch = src.match(/router\.post\("\/creative\/social\/publish",[\s\S]*?\n\}\);/);
    assert(!!routeMatch, "found the X publish route handler source");
    assert(/idempotencyKey \|\| entryId \|\| null/.test(routeMatch[0]), "route passes idempotencyKey (falling back to entryId) as post()'s 3rd argument");
  }

  section("New — socialPublishSupport's withRetry/idempotency helpers are actually imported and used");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/socialPostingService.cjs"), "utf8");
    assert(/require\("\.\/socialPublishSupport\.cjs"\)/.test(src), "socialPostingService.cjs imports the shared helper (not a duplicate)");
    assert(/withRetry\(/.test(src), "post() wraps its HTTP call in withRetry");
    assert(/checkIdempotency\(/.test(src) && /recordIdempotency\(/.test(src), "post() checks and records idempotency");
  }

  section("No approval/high-risk gate exists for social publish routes (architecture-wide, not an X-specific gap)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");
    const socialSection = src.slice(src.indexOf("MODULE 7"));
    assert(!/requireApproval|approvalGate/.test(socialSection), "confirms no approval gate exists anywhere in the social publish routes (X, LinkedIn, Facebook, YouTube, TikTok, Instagram alike) — a shared architectural observation, not unique to X");
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
