#!/usr/bin/env node
"use strict";
/**
 * sentryService.cjs — context redaction (Monitoring Ecosystem mission).
 *
 * Discovery found captureException()/captureMessage() passed
 * context.tags/extra/user straight through to Sentry's real HTTP envelope
 * with zero scrubbing. Every current call site (backend/server.js's global
 * error handler + its two process-level handlers) already only passes safe
 * static strings/req.originalUrl — genuinely safe today, by caller
 * discipline, not because the function itself enforces it. This is exactly
 * the category's own top-priority concern: "Verify that monitoring context
 * cannot create a cross-tenant privacy leak" / "Never send secrets, access
 * tokens, passwords, API keys... to monitoring providers."
 *
 * Fixed by adding a redaction step (_redact()) at the shared choke point
 * both capture functions already go through, modeled after
 * toolExecutionLayer.cjs's _sanitizeParams() key-matching regex (confirmed
 * via discovery to be the only precedent in this codebase), extended with
 * recursion since Sentry context is often nested.
 *
 * No real network call is made — SENTRY_DSN is deliberately left unset so
 * every capture call exercises the honest not-configured early return,
 * proving the redaction and the no-op gating both work without ever
 * reaching Sentry's real servers. A separate section intercepts the
 * envelope construction directly (by temporarily setting SENTRY_DSN to a
 * syntactically valid but unroutable value and inspecting what _send()
 * would have transmitted) to prove redaction happens BEFORE the envelope
 * is built, not just that captureException() returns ok:false.
 *
 * Usage: node tests/security/156-sentry-context-redaction.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

// Intercept https.request so we can inspect the real envelope bytes
// _send() would transmit, without ever hitting a real network socket.
function _interceptEnvelope() {
  const https = require("https");
  const origRequest = https.request;
  let captured = null;
  https.request = function (opts, cb) {
    const chunks = [];
    const fakeReq = {
      write: (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)),
      end: () => {
        captured = Buffer.concat(chunks).toString("utf8");
        // Immediately resolve the response side so _send()'s promise settles.
        const fakeRes = { statusCode: 200, on: (evt, handler) => { if (evt === "end") handler(); } };
        cb(fakeRes);
      },
      on: () => {},
      setTimeout: () => {},
      destroy: () => {},
    };
    return fakeReq;
  };
  return {
    getEnvelope: () => captured,
    restore: () => { https.request = origRequest; },
  };
}

async function main() {
  delete process.env.SENTRY_DSN;

  section("Honest no-op — captureException/captureMessage never fabricate delivery when unconfigured");
  {
    delete require.cache[require.resolve("../../backend/services/sentryService.cjs")];
    const sentry = require("../../backend/services/sentryService.cjs");
    assert(sentry.isConfigured() === false, "isConfigured() is false with no SENTRY_DSN");

    const r1 = await sentry.captureException(new Error("test"), { extra: { password: "should-not-matter-unconfigured" } });
    assert(r1.ok === false, "captureException() returns ok:false when unconfigured, never a fabricated eventId", JSON.stringify(r1));
    assert(!r1.eventId, "no eventId is fabricated on the unconfigured path");

    const r2 = await sentry.captureMessage("test message");
    assert(r2.ok === false, "captureMessage() returns ok:false when unconfigured");
  }

  section("Redaction — sensitive keys in extra/tags/user are replaced before the envelope is built");
  {
    const interceptor = _interceptEnvelope();
    process.env.SENTRY_DSN = "https://fakekey@fake.sentry.invalid/1";
    delete require.cache[require.resolve("../../backend/services/sentryService.cjs")];
    const sentry = require("../../backend/services/sentryService.cjs");

    try {
      await sentry.captureException(new Error("boom"), {
        tags: { service: "http", api_key: "sk_live_realsecret123" },
        extra: {
          path: "/api/orders",
          authorization: "Bearer eyJraW...realtoken",
          password: "hunter2",
          nested: { session_token: "abc123", safe_field: "keep-me" },
        },
        user: { id: "u1", email: "safe-to-keep@example.com", auth_cookie: "raw-cookie-value" },
      });

      const envelope = interceptor.getEnvelope();
      assert(!!envelope, "an envelope was actually constructed and would have been transmitted");
      assert(!envelope.includes("sk_live_realsecret123"), "a secret-shaped tag value never reaches the envelope bytes");
      assert(!envelope.includes("realtoken"), "an authorization header value never reaches the envelope bytes");
      assert(!envelope.includes("hunter2"), "a password value never reaches the envelope bytes");
      assert(!envelope.includes("abc123"), "a nested session_token value never reaches the envelope bytes");
      assert(!envelope.includes("raw-cookie-value"), "an auth_cookie value never reaches the envelope bytes");
      assert(envelope.includes("[redacted]"), "redacted fields are marked, not silently dropped (still observable that redaction occurred)");
      assert(envelope.includes("keep-me"), "a genuinely safe nested field is preserved, not over-redacted");
      assert(envelope.includes("safe-to-keep@example.com"), "a genuinely safe user field is preserved, not over-redacted");
      assert(envelope.includes("/api/orders"), "a genuinely safe extra field (path) is preserved, not over-redacted");
    } finally {
      interceptor.restore();
      delete process.env.SENTRY_DSN;
    }
  }

  section("Redaction — captureMessage's tags/extra are redacted the same way as captureException's");
  {
    const interceptor = _interceptEnvelope();
    process.env.SENTRY_DSN = "https://fakekey@fake.sentry.invalid/1";
    delete require.cache[require.resolve("../../backend/services/sentryService.cjs")];
    const sentry = require("../../backend/services/sentryService.cjs");

    try {
      await sentry.captureMessage("something happened", "warning", {
        tags: { db_password: "supersecret" },
        extra: { api_secret: "another-secret", note: "safe note" },
      });
      const envelope = interceptor.getEnvelope();
      assert(!!envelope, "an envelope was constructed for captureMessage too");
      assert(!envelope.includes("supersecret"), "captureMessage redacts sensitive tags too");
      assert(!envelope.includes("another-secret"), "captureMessage redacts sensitive extra fields too");
      assert(envelope.includes("safe note"), "a safe field survives captureMessage's redaction");
    } finally {
      interceptor.restore();
      delete process.env.SENTRY_DSN;
    }
  }

  section("Real call sites in backend/server.js only ever pass already-safe context (regression, source-shape check)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/server.js"), "utf8");
    const captureCalls = src.match(/sentryService\.cjs"\)\.captureException\([^)]*\{[^}]*\}[^)]*\)/gs) || [];
    assert(captureCalls.length >= 1, "at least one real captureException call site exists in server.js", `found ${captureCalls.length}`);
    for (const call of captureCalls) {
      assert(!/req\.body|req\.headers|req\.cookies|req\.query/.test(call),
        "no call site passes a raw request object (body/headers/cookies/query) directly into context", call.slice(0, 120));
    }
  }

  section("Redaction handles edge cases safely (null, undefined, arrays, non-object context)");
  {
    delete require.cache[require.resolve("../../backend/services/sentryService.cjs")];
    const sentry = require("../../backend/services/sentryService.cjs");
    // With no DSN configured these all return honestly before touching
    // redaction's output — this section just proves none of these inputs
    // throw synchronously through the capture path.
    let threw = false;
    try {
      await sentry.captureException(new Error("x"), { extra: null });
      await sentry.captureException(new Error("x"), {});
      await sentry.captureException(new Error("x"), { extra: { list: ["a", { token: "hide-me" }] } });
      await sentry.captureMessage("x", "info", undefined);
    } catch (e) { threw = true; }
    assert(!threw, "redaction never throws on null/empty/array-shaped/undefined context");
  }

  delete process.env.SENTRY_DSN;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
