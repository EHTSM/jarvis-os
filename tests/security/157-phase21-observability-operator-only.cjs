#!/usr/bin/env node
"use strict";
/**
 * phase21.js — /p21/obs/* (21B Observability Engine) — operator-only gate.
 *
 * Monitoring Ecosystem mission. Discovery found every /p21/obs/* route
 * (metrics record/query, alert register/evaluate/list, structured log
 * write/query, health probe, full telemetry snapshot) was gated by
 * requireAuth alone. observabilityEngine.cjs has no orgId concept anywhere
 * — confirmed by direct inspection — meaning this is genuinely platform-
 * wide founder/operator telemetry, not per-org data. Any ordinary
 * signed-up (non-operator) user could read the whole platform's
 * operational log stream (including entries any OTHER authenticated user
 * had written via POST /p21/obs/log), register/evaluate alert rules
 * platform-wide, and pull a full telemetry snapshot.
 *
 * This is the exact same defect class already found and fixed for
 * revenueOS.js's platform-wide financial data in an earlier mission
 * ("Previously gated by requireAuth alone, so any signed-up customer could
 * read the whole platform's revenue numbers") — fixed here the identical
 * way: router.use("/p21/obs", requireAuth, operatorOnly), reusing the
 * existing gate rather than inventing a new authorization concept. Scoped
 * to exactly the /p21/obs prefix — 21A (OAuth) and 21C (Live Mode) in the
 * same file are outside this category's scope and confirmed untouched.
 *
 * This test spins up a real in-process Express server mounting the real
 * router (no mocking of the authorization logic itself) with two real
 * signed JWTs — one operator, one ordinary member — and proves the actual
 * HTTP behavior end-to-end.
 *
 * Usage: node tests/security/157-phase21-observability-operator-only.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-p21-obs-operator-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const phase21Router = require("../../backend/routes/phase21.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const suffix = Date.now();
  const memberCookie = `${COOKIE_NAME}=${signJWT({ sub: `member-${suffix}`, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const operatorCookie = `${COOKIE_NAME}=${signJWT({ sub: `operator-${suffix}`, role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

  const app = express();
  app.use(express.json());
  app.use(phase21Router);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(method, path, cookie, body) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch { /* non-JSON response, leave null */ }
    return { status: r.status, body: json };
  }

  try {
    section("An ordinary member cannot reach any /p21/obs/* route");
    {
      const cases = [
        ["GET",  "/p21/obs/metrics"],
        ["GET",  "/p21/obs/metrics/some-metric"],
        ["POST", "/p21/obs/metrics", { name: "x", value: 1 }],
        ["GET",  "/p21/obs/alerts"],
        ["POST", "/p21/obs/alerts", { name: "x" }],
        ["POST", "/p21/obs/alerts/evaluate"],
        ["POST", "/p21/obs/log", { msg: "hi" }],
        ["GET",  "/p21/obs/logs"],
        ["GET",  "/p21/obs/health"],
        ["GET",  "/p21/obs/snapshot"],
      ];
      for (const [method, path, body] of cases) {
        const r = await req(method, path, memberCookie, body);
        assert(r.status === 403, `${method} ${path} → 403 for a non-operator member`, `got ${r.status}: ${JSON.stringify(r.body)}`);
      }
    }

    section("No authentication at all — 401, not 403 (distinguishes missing session from insufficient role)");
    {
      const r = await req("GET", "/p21/obs/snapshot", null);
      assert(r.status === 401, "an unauthenticated request gets 401", `got ${r.status}`);
    }

    section("A real operator CAN reach every /p21/obs/* route");
    {
      const cases = [
        ["GET",  "/p21/obs/metrics"],
        ["GET",  "/p21/obs/alerts"],
        ["GET",  "/p21/obs/logs"],
        ["GET",  "/p21/obs/health"],
        ["GET",  "/p21/obs/snapshot"],
      ];
      for (const [method, path] of cases) {
        const r = await req(method, path, operatorCookie);
        assert(r.status === 200, `${method} ${path} → 200 for a real operator`, `got ${r.status}: ${JSON.stringify(r.body)}`);
      }
    }

    section("21A OAuth routes in the same file are unaffected (still requireAuth-only, no operatorOnly regression)");
    {
      // /oauth/status only needs requireAuth — a non-operator member must
      // still be able to reach it, proving the operatorOnly gate above was
      // scoped ONLY to /p21/obs and did not leak onto sibling sections.
      const r = await req("GET", "/oauth/status", memberCookie);
      assert(r.status === 200, "a non-operator member can still reach /oauth/status (21A untouched)", `got ${r.status}: ${JSON.stringify(r.body)}`);
    }

    section("Regression — the real observability functions still work correctly for an authorized operator");
    {
      const record = await req("POST", "/p21/obs/metrics", operatorCookie, { name: `test_metric_${suffix}`, value: 42 });
      assert(record.status === 200 && record.body?.success === true, "an operator can still record a real metric", JSON.stringify(record.body));

      const list = await req("GET", "/p21/obs/metrics", operatorCookie);
      assert(list.status === 200 && Array.isArray(list.body?.metrics), "an operator can still list metrics", JSON.stringify(list.body));

      const log = await req("POST", "/p21/obs/log", operatorCookie, { msg: `test log entry ${suffix}` });
      assert(log.status === 200 && log.body?.logged === true, "an operator can still write a structured log entry", JSON.stringify(log.body));
    }

    section("Wiring — source-shape check confirms the fix and its exact scope");
    {
      const fs = require("fs");
      const src = fs.readFileSync(require.resolve("../../backend/routes/phase21.js"), "utf8");
      assert(/router\.use\("\/p21\/obs",\s*requireAuth,\s*operatorOnly\)/.test(src),
        "the router-level gate exists exactly as router.use(\"/p21/obs\", requireAuth, operatorOnly)");
      const obsSection = src.slice(src.indexOf('router.post("/p21/obs/metrics"'), src.indexOf('21C Autonomous Company Live Mode'));
      assert(!/router\.\w+\("\/p21\/obs[^"]*",\s*requireAuth/.test(obsSection),
        "no individual /p21/obs/* route re-declares requireAuth — the router-level gate is the single source of truth, matching revenueOS.js's own established convention");
      const oauthSection = src.slice(src.indexOf('21A OAuth Integration Layer'), src.indexOf('21B Observability Engine'));
      assert(!/operatorOnly/.test(oauthSection),
        "the 21A OAuth section is untouched — no operatorOnly leaked onto it");
    }
  } finally {
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
