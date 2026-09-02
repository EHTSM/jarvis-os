#!/usr/bin/env node
"use strict";
/**
 * FCM push send — real API wiring regression.
 *
 * Google Ecosystem mission. Discovery found pushNotificationEngine.cjs's
 * send() was an explicit, honestly-labeled stub — real token registration/
 * storage/readiness existed, but send() always returned "FCM send path
 * not yet implemented" regardless of configuration. This mission wired a
 * real firebase-admin messaging().send() call per registered device
 * token, with per-token error isolation and stale-token pruning
 * (messaging/registration-token-not-registered), using the same
 * optional-require pattern backend/routes/auth.js's _firebaseAdmin()
 * already established for firebase-admin (not installed in this
 * environment — a pre-existing, out-of-scope install gap, handled the
 * same graceful-degrade way, never fabricated).
 *
 * This test injects a minimal fake firebase-admin module via
 * require.cache (no real network call, no real dependency needed) to
 * verify the send loop's real logic: per-token success/failure isolation,
 * stale-token pruning, and that a real SDK call site actually exists —
 * without ever hitting Google's real servers.
 *
 * Usage: node tests/security/140-fcm-push-send-real-api.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function _installFakeFirebaseAdmin(sendImpl) {
  const fakeModulePath = require.resolve("path").replace("path.js", "") + "__fake_firebase_admin__";
  const Module = require("module");
  const apps = [];
  const fakeExports = {
    get apps() { return apps; },
    credential: { cert: (sa) => ({ _sa: sa }) },
    initializeApp: (cfg) => { const app = { _cfg: cfg }; apps.push(app); return app; },
    app: () => apps[0],
    messaging: () => ({ send: sendImpl }),
  };
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === "firebase-admin") return "firebase-admin";
    return origResolve.call(this, request, ...rest);
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "firebase-admin") return fakeExports;
    return origLoad.call(this, request, ...rest);
  };
  return () => { Module._resolveFilename = origResolve; Module._load = origLoad; };
}

async function main() {
  section("send() is a real call site, not the old stub message");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/pushNotificationEngine.cjs"), "utf8");
    assert(!/FCM send path not yet implemented/.test(src), "the old honest-stub message is gone — a real send call now exists");
    assert(/admin\.messaging\(app\)\.send\(/.test(src), "a real firebase-admin messaging().send() call site exists");
  }

  section("send() without Firebase configured — honest failure, unchanged from before");
  {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    const result = await svc.send({ accountId: "test", title: "Test", body: "hi" });
    assert(result.ok === false, "send() fails honestly when Firebase isn't configured", JSON.stringify(result));
    assert(result.sent === 0, "sent count is 0, never fabricated");
    assert(/not configured/i.test(result.error || ""), "error explains Firebase isn't configured", result.error);
  }

  section("send() with Firebase configured but firebase-admin unavailable — honest failure, no fabrication");
  {
    process.env.FIREBASE_PROJECT_ID = "test-project";
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "test-project", client_email: "x@x.iam.gserviceaccount.com", private_key: "fake" });
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    const result = await svc.send({ accountId: "test-acct-no-devices", title: "Test", body: "hi" });
    // firebase-admin genuinely isn't installed in this environment — expect a real, honest failure either way (SDK unavailable, or no tokens registered).
    assert(result.ok === false, "send() fails honestly (no real delivery fabricated)", JSON.stringify(result));
    assert(result.sent === 0, "sent count is 0");
  }

  section("send() with a fake firebase-admin injected — real per-token success/failure isolation + stale-token pruning");
  {
    const restore = _installFakeFirebaseAdmin(async ({ token }) => {
      if (token === "stale-device-token") {
        const e = new Error("Requested entity was not found.");
        e.errorInfo = { code: "messaging/registration-token-not-registered" };
        throw e;
      }
      return "projects/test/messages/fake-id";
    });
    try {
      delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
      const svc = require("../../backend/services/pushNotificationEngine.cjs");
      svc.registerToken({ accountId: "fcm-test-acct", token: "good-device-token", platform: "android" });
      svc.registerToken({ accountId: "fcm-test-acct", token: "stale-device-token", platform: "ios" });

      const before = svc.listTokens("fcm-test-acct");
      assert(before.length === 2, "2 tokens registered before send", `got ${before.length}`);

      const result = await svc.send({ accountId: "fcm-test-acct", title: "Test", body: "hi" });
      assert(result.ok === true, "send() reports ok:true when at least one token succeeds", JSON.stringify(result));
      assert(result.sent === 1, "exactly 1 real send succeeded", `sent=${result.sent}`);
      assert(result.pruned === 1, "exactly 1 stale token was pruned", `pruned=${result.pruned}`);
      assert(Array.isArray(result.errors) && result.errors.length === 1, "1 error recorded for the stale token");
      assert(!result.errors[0].token.includes("stale-device-token"), "the full token value is never included in the error record (truncated)", result.errors[0].token);

      const after = svc.listTokens("fcm-test-acct");
      assert(after.length === 1, "stale token was actually removed from storage", `got ${after.length}`);
      assert(after[0].token === "good-device-token", "the surviving token is the one that succeeded");

      // cleanup
      svc.unregisterToken("good-device-token");
    } finally {
      restore();
    }
  }

  section("send() requires title or body");
  {
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    const result = await svc.send({ accountId: "test" });
    assert(result.ok === false, "send() rejects a call with neither title nor body");
    assert(/title or body required/.test(result.error || ""), "error message is exact", result.error);
  }

  // Notifications Ecosystem mission: unregisterToken(token) previously took
  // no accountId at all — any authenticated caller could unregister ANY
  // other account's device token by knowing/guessing the token string.
  // POST /push/unregister is gated by requireAuth but had zero ownership
  // check of its own. Fixed by requiring the caller's own accountId (the
  // route now derives it from req.user, same as /push/register already
  // does) and matching it against the stored token's accountId before
  // deletion.
  section("unregisterToken — a caller cannot remove another account's token");
  {
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    svc.registerToken({ accountId: "owner-acct", token: "owner-token-1", platform: "android" });

    const stolen = svc.unregisterToken("owner-token-1", "attacker-acct");
    assert(stolen.removed === 0, "a different account's accountId cannot remove the token", JSON.stringify(stolen));
    assert(svc.listTokens("owner-acct").some(t => t.token === "owner-token-1"), "the token still exists, untouched, after the attempted cross-account removal");

    const real = svc.unregisterToken("owner-token-1", "owner-acct");
    assert(real.removed === 1, "the real owner CAN remove their own token", JSON.stringify(real));
    assert(!svc.listTokens("owner-acct").some(t => t.token === "owner-token-1"), "the token is actually gone after the real owner removes it");
  }

  section("unregisterToken — no accountId supplied (trusted internal caller, e.g. send()'s own stale-token pruning) is unaffected");
  {
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    svc.registerToken({ accountId: "internal-caller-acct", token: "internal-prune-token", platform: "ios" });
    const result = svc.unregisterToken("internal-prune-token"); // no accountId — matches send()'s own internal call shape
    assert(result.removed === 1, "an omitted accountId still removes the token (internal-caller trust, unchanged from before this fix)", JSON.stringify(result));
  }

  section("unregisterToken — removing a token that does not exist stays a safe no-op (unchanged)");
  {
    delete require.cache[require.resolve("../../backend/services/pushNotificationEngine.cjs")];
    const svc = require("../../backend/services/pushNotificationEngine.cjs");
    const result = svc.unregisterToken("token-that-was-never-registered", "any-acct");
    assert(result.ok === true && result.removed === 0, "an unknown token removes nothing and still reports ok:true, matching prior behavior", JSON.stringify(result));
  }

  section("Wiring — POST /push/unregister derives accountId server-side, never from the request body");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/pushNotifications.js"), "utf8");
    const unregisterSection = src.slice(src.indexOf('"/push/unregister"'), src.indexOf('"/push/readiness"'));
    assert(/const accountId = req\.user\.sub \|\| req\.user\.id;/.test(unregisterSection),
      "/push/unregister resolves accountId from req.user (the verified session), matching /push/register's own pattern");
    assert(/_svc\(\)\.unregisterToken\(token, accountId\)/.test(unregisterSection),
      "/push/unregister passes the server-resolved accountId into unregisterToken, not just the raw token");
    assert(!/_svc\(\)\.unregisterToken\(token\)\)/.test(unregisterSection),
      "the old unscoped call (token only, no ownership) is gone from the route");
  }

  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
