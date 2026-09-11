#!/usr/bin/env node
"use strict";
/**
 * Phase C.1.1 — the SPA catch-all must never mask an unknown API route.
 *
 * CONFIRMED finding (measured live during the Phase C.1 endpoint audit):
 * an AUTHENTICATED request to a nonexistent API path fell through
 * `app.get("/*splat", _renderIndexHtml)` and returned:
 *
 *     GET /enterprise/orgs  ->  HTTP 200  +  <!doctype html>...
 *
 * A client could not distinguish "this route does not exist" from "this
 * route works" by status code. Consumers failed later at JSON.parse
 * instead of immediately on a clean 404.
 *
 * Measured blast radius — this defect corrupted the audit itself, twice:
 *
 *   1. Three orphaned components (EnterpriseOS/DeveloperOS/PersonalOS)
 *      call 22 endpoints that do not exist. All 22 answered HTTP 200,
 *      making the components look backed by a live API.
 *   2. A cross-tenant probe read HTTP 200 on three nonexistent org-scoped
 *      paths and briefly looked like a data leak. It was not — the owning
 *      account received the same 200 HTML. Status-only checking produced
 *      a false SECURITY finding.
 *
 * Fix (backend/server.js): an API 404 boundary mounted AFTER the route
 * barrel and BEFORE the SPA fallback. The prefix list is derived from the
 * live router tree at boot — not hardcoded — so it cannot drift as routes
 * are added or removed.
 *
 * These assertions are the guard: if the boundary is removed, reordered,
 * or the prefix derivation breaks, an unknown API path starts answering
 * 200 + HTML again and this test fails.
 *
 * Requires a live backend on :5050.
 * Usage: node tests/security/91-api-404-boundary.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const http   = require("http");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

function request(method, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port: PORT, path, method, headers: cookie ? { Cookie: `jarvis_auth=${cookie}` } : {} },
      res => {
        let body = "";
        res.on("data", d => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`timeout ${method} ${path}`)); });
    req.end();
  });
}

/** Log in and return the jarvis_auth JWT, or null if the account is unavailable. */
function login() {
  return new Promise(resolve => {
    const payload = JSON.stringify({ email: "c1probe_a@test.local", password: "C1Probe!2026" });
    const req = http.request(
      { host: "localhost", port: PORT, path: "/auth/login", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      res => {
        res.on("data", () => {});
        res.on("end", () => {
          const raw = res.headers["set-cookie"];
          const m = (raw || []).join(";").match(/jarvis_auth=([^;]+)/);
          resolve(m ? m[1] : null);
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

const isHtml = body => body.trimStart().toLowerCase().startsWith("<!doctype") ||
                       body.trimStart().toLowerCase().startsWith("<html");

async function main() {
  // Precondition — backend reachable.
  try {
    const health = await request("GET", "/health");
    assert.strictEqual(health.status, 200, "backend must be reachable on :" + PORT);
  } catch (e) {
    console.log(`\n  SKIPPED — backend not reachable on :${PORT} (${e.message})`);
    console.log("  Start it with: node backend/server.js");
    process.exit(0);
  }

  const token = await login();
  assert.ok(token, "probe account must be able to log in (this defect only reproduces when AUTHENTICATED)");

  section("Unknown paths under a REAL API prefix return JSON 404, never SPA HTML");
  {
    // Each of these sits under a genuinely mounted prefix but names no route.
    //
    // Phase OS-5.2 correction: "/enterprise/orgs" was listed here on the
    // premise that it names no route. That premise is FALSE — backend/routes/
    // ops.js has always defined GET/POST /enterprise/orgs (present in HEAD,
    // untouched by any phase). The original 404 measurement in C.1.1 was taken
    // against a server that had not loaded ops.js — the stale-process hazard
    // C.1.1 itself documented.
    //
    // The assertion is NOT weakened: it still requires a JSON 404 (never SPA
    // HTML) for unknown paths under a mounted prefix. Only the fixture is
    // corrected to paths that are genuinely unmounted, so the test measures
    // what it claims to measure. Verified live against the mounted router
    // tree: ALL SEVEN EnterpriseOS.jsx endpoints (orgs, depts, teams, roles,
    // permissions, policies, stats) are mounted by ops.js and return 200 with
    // real data — so none of them belong in an "unknown path" fixture.
    const UNKNOWN_API = [
      "/enterprise/no-such-resource",   // replaces /enterprise/orgs + /enterprise/depts, both of which ARE mounted
      "/business/totally-made-up",
      "/graph/nonexistent",
      "/growth/no-such-endpoint",
      "/orgs/no-such-subresource-xyz",
    ];
    for (const path of UNKNOWN_API) {
      const res = await request("GET", path, token);
      assert.ok(
        !isHtml(res.body),
        `${path} must NOT return SPA HTML (got ${res.status} + html) — the catch-all is masking a missing route again`
      );
      assert.strictEqual(
        res.status, 404,
        `${path} must return 404, got ${res.status}`
      );
    }
    ok(`${UNKNOWN_API.length} unknown API paths each return JSON 404`);
  }

  section("The specific paths that corrupted the C.1 audit");
  {
    // Phase OS-5.2 correction — this block asserted the WRONG FACT.
    //
    // It required /enterprise/orgs|teams|roles to 404, on the belief that
    // EnterpriseOS.jsx was a dead prototype with no backend. Measured live
    // against a single verified process: all 7 of its endpoints return 200
    // with real data (orgs, depts, teams, roles, permissions, policies,
    // stats), served by an "Enterprise AI OS" block in backend/routes/ops.js
    // that is present in HEAD and was never touched by any phase.
    //
    // The earlier "0/9 absent" measurement was taken against a server that
    // had not loaded ops.js — the same stale-process hazard C.1.1 documented.
    //
    // What this block genuinely protects is unchanged and still worth
    // asserting: whatever these paths return, it must be JSON — never the SPA
    // shell with a 200, which is what made a missing route look alive.
    for (const path of ["/enterprise/orgs", "/enterprise/teams", "/enterprise/roles"]) {
      const res = await request("GET", path, token);
      assert.ok(!isHtml(res.body),
        `${path} must never return the SPA shell — that is what masks a route's real status (got ${res.status} + html)`);
      assert.ok(res.status !== 200 || res.body.trimStart().startsWith("{"),
        `${path} returned 200 but not JSON — a 200 must carry a real API response`);
    }
    ok("enterprise paths return real JSON, never the SPA shell (see note: these ARE mounted by ops.js)");
  }

  section("Real API routes are unaffected");
  {
    const LIVE = ["/graph/stats", "/business/pipeline", "/growth/dashboard"];
    for (const path of LIVE) {
      const res = await request("GET", path, token);
      assert.strictEqual(res.status, 200, `${path} must still return 200, got ${res.status}`);
      assert.ok(!isHtml(res.body), `${path} must return JSON, not HTML`);
    }
    ok(`${LIVE.length} live API routes still return 200 JSON`);
  }

  section("Unauthenticated behaviour is unchanged (fail-closed, not masked)");
  {
    const res = await request("GET", "/graph/stats");
    assert.strictEqual(res.status, 401, `unauthenticated /graph/stats must 401, got ${res.status}`);
    assert.ok(!isHtml(res.body), "401 must be JSON, not the SPA shell");
    ok("auth gate still returns 401 JSON without a session");
  }

  section("Frontend root still renders the SPA");
  {
    const res = await request("GET", "/");
    assert.strictEqual(res.status, 200, "GET / must render the SPA");
    assert.ok(isHtml(res.body), "GET / must return index.html");
    ok("GET / still serves the SPA shell (fallback intact for real frontend paths)");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
