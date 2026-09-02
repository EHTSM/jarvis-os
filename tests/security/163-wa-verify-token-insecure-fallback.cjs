#!/usr/bin/env node
"use strict";
/**
 * WA_VERIFY_TOKEN — insecure fallback closure (Mission 80, VPS decision
 * closure).
 *
 * Mission 79's deployment preflight found `.env.example` shipped
 * `WA_VERIFY_TOKEN=change_this_to_a_random_secret` — a non-random,
 * publicly-known literal committed to a template every clone of this repo
 * carries. If an operator copies `.env.example` to `.env` without editing
 * that one line, `WA_VERIFY_TOKEN` is *set* (not blank), so
 * `whatsappService.js`'s `verifyWebhook()` `if (!verifyToken)` fail-safe
 * never triggers — the webhook becomes verifiable by anyone who has ever
 * read this file, i.e. anyone at all, since it is public template text.
 *
 * A second, independently-introduced instance of the same defect class was
 * found live in `backend/routes/settings.js`'s in-app WhatsApp settings
 * save route: `POST /settings/whatsapp` fell back to a hardcoded
 * `"ooplix_verify"` constant whenever no `verifyToken` was supplied in the
 * request body and none was already set in `process.env` — silently
 * persisting and hot-loading a second guessable, undocumented constant into
 * `process.env.WA_VERIFY_TOKEN`, exactly the "missing secret -> known public
 * placeholder" shape this mission was told to close, not "missing secret ->
 * safe failure."
 *
 * Both are fixed narrowly:
 *   - `.env.example`'s `WA_VERIFY_TOKEN` default is now blank, matching
 *     every other secret-shaped variable in that file (e.g.
 *     RAZORPAY_WEBHOOK_SECRET=) — an operator who forgets to set it now
 *     gets the code's own existing fail-safe (verifyWebhook() logs an error
 *     and rejects), not a working public secret.
 *   - `POST /settings/whatsapp` now rejects the request (400) if no real
 *     verify token is supplied or already configured, instead of silently
 *     choosing "ooplix_verify" on the caller's behalf.
 *
 * This test proves both fixes at the source-shape level (the insecure
 * literals are gone) and exercises the real, unmodified
 * `whatsappService.verifyWebhook()` end-to-end to prove the existing
 * fail-safe behavior this fix now actually reaches is real, not assumed.
 *
 * Usage: node tests/security/163-wa-verify-token-insecure-fallback.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section(".env.example no longer ships a real, non-random WA_VERIFY_TOKEN default");
  {
    const src = fs.readFileSync(require.resolve("../../.env.example"), "utf8");
    assert(/^WA_VERIFY_TOKEN=\s*$/m.test(src),
      "WA_VERIFY_TOKEN= is blank in the template, matching every other secret-shaped variable's convention",
      "expected a blank default");
    assert(!src.includes("change_this_to_a_random_secret"),
      "the old public, guessable placeholder string is gone from the template entirely");
  }

  section("backend/routes/settings.js no longer has a hardcoded guessable verify-token fallback");
  {
    const src = fs.readFileSync(require.resolve("../../backend/routes/settings.js"), "utf8");
    // Only check for a LIVE literal assignment/fallback use (e.g. `|| "ooplix_verify"`),
    // not this fix's own explanatory comment referencing the old value as history —
    // matching this suite's own established convention (see 161-export-files-cross-tenant-idor.cjs).
    assert(!/["'`]ooplix_verify["'`]/.test(src.replace(/\/\/.*$/gm, "")),
      "the old hardcoded \"ooplix_verify\" fallback constant is gone from live code (not counting this fix's own explanatory comment)");
    assert(/if \(!resolvedVerifyToken\)/.test(src) && /return res\.status\(400\)/.test(src),
      "a missing verify token now fails the save request (400) instead of silently choosing a guessable default");
  }

  section("Live route behavior — POST /settings/whatsapp rejects a save with no verify token available");
  {
    const express = require("express");
    const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-wa-verify-token-secret";
    delete process.env.WA_VERIFY_TOKEN; // simulate a fresh install with nothing configured yet

    const app = express();
    app.use(express.json());
    app.use(require("../../backend/routes/settings.js"));
    const server = app.listen(0);
    await new Promise(r => server.on("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const jwt = signJWT({ sub: "test-operator", role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 });
    const cookie = `${COOKIE_NAME}=${jwt}`;

    try {
      const rNoToken = await fetch(`${base}/settings/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ token: "x".repeat(30), phoneId: "1234567890123" }),
      });
      assert(rNoToken.status === 400, "saving WhatsApp settings with no verifyToken and none configured is rejected (400)", `got ${rNoToken.status}`);
      const bodyNoToken = await rNoToken.json();
      assert(process.env.WA_VERIFY_TOKEN !== "ooplix_verify", "process.env.WA_VERIFY_TOKEN was never set to the old guessable constant as a side effect of the rejected request", `got ${JSON.stringify(bodyNoToken)}`);

      const rWithToken = await fetch(`${base}/settings/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ token: "x".repeat(30), phoneId: "1234567890123", verifyToken: "a-real-random-operator-chosen-value" }),
      });
      assert(rWithToken.status === 200, "saving with a real, explicit verifyToken still succeeds", `got ${rWithToken.status}`);
      assert(process.env.WA_VERIFY_TOKEN === "a-real-random-operator-chosen-value", "the real supplied value is the one actually stored, not any fallback");
    } finally {
      server.close();
      delete process.env.WA_VERIFY_TOKEN;
      try { fs.rmSync(path.join(__dirname, "../../data/settings.json"), { force: true }); } catch { /* best-effort cleanup */ }
    }
  }

  section("Regression — whatsappService.verifyWebhook() itself still fails safe on a missing token (unmodified, proves the reachable fail-safe is real)");
  {
    delete process.env.WA_VERIFY_TOKEN;
    delete process.env.VERIFY_TOKEN;
    delete require.cache[require.resolve("../../backend/services/whatsappService.js")];
    const wa = require("../../backend/services/whatsappService.js");
    const result = wa.verifyWebhook({ "hub.mode": "subscribe", "hub.verify_token": "anything", "hub.challenge": "123" });
    assert(result.valid === false, "with no WA_VERIFY_TOKEN configured at all, webhook verification is rejected regardless of what the caller sends", `got ${JSON.stringify(result)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
