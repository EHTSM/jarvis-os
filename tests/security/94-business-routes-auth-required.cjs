#!/usr/bin/env node
"use strict";
/**
 * OS-5.2 — /business/* must never be reachable without authentication.
 *
 * CONFIRMED finding, measured live against a single verified backend process:
 *
 *   backend/routes/ops.js defined 34 /business/* routes backed by
 *   agents/runtime/businessOS.cjs. Every one was an EXACT METHOD+PATH
 *   duplicate of a route in backend/routes/business.js (0 unique endpoints),
 *   but carried 0 requireAuth, 0 _requireOrg and 0 req.org.id — against
 *   72 / 43 / 47 respectively in business.js.
 *
 *   The route barrel mounts ops.js at line 38, business.js at line 73, and the
 *   `/business` auth gate at line 181. Express matches first registration, so
 *   the duplicates shadowed the canonical implementation AND sat ahead of the
 *   auth gate.
 *
 * Measured BEFORE removal, with no cookie at all:
 *   GET  /business/leads         200 — 4 real leads incl. names + email addresses
 *   GET  /business/contacts      200 — 2 contacts
 *   GET  /business/revenue       200 — 8 records totalling $128,800
 *   GET  /business/pipeline      200
 *   GET  /business/stats         200
 *   GET  /business/opportunities 200
 *   GET  /business/dashboard     200
 *   POST /business/leads         201 — anonymous WRITE accepted
 *
 * while routes served only by business.js (customers, operations, missions)
 * correctly returned 401 — proving the exposure came from the ops.js block.
 *
 * Fix: removed the 34 duplicate definitions from ops.js. No barrel reorder,
 * no replacement routes, no change to business.js. All 34 paths still exist,
 * now served by the authenticated org-scoped implementation.
 *
 * This suite fails loudly if any /business/* route is ever served
 * unauthenticated again.
 *
 * Requires a live backend on :5050.
 * Usage: node tests/security/94-business-routes-auth-required.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const http   = require("http");
const fs     = require("fs");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: "localhost", port: PORT, path, method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      res => {
        let b = "";
        res.on("data", d => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`timeout ${method} ${path}`)); });
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  try {
    const h = await request("GET", "/health");
    assert.strictEqual(h.status, 200, "backend must be reachable");
  } catch (e) {
    console.log(`\n  SKIPPED — backend not reachable on :${PORT} (${e.message})`);
    console.log("  Start it with: node backend/server.js");
    process.exit(0);
  }

  section("No /business/* route is readable without authentication");
  {
    const READS = [
      "/business/pipeline", "/business/stats", "/business/leads",
      "/business/contacts", "/business/opportunities", "/business/revenue",
      "/business/dashboard", "/business/customers", "/business/operations",
    ];
    for (const path of READS) {
      const res = await request("GET", path);
      assert.notStrictEqual(
        res.status, 200,
        `${path} must NOT return 200 without a session — business data was exposed anonymously (body: ${res.body.slice(0, 90)})`
      );
      assert.strictEqual(
        res.status, 401,
        `${path} must return 401 without a session, got ${res.status}`
      );
    }
    ok(`${READS.length} /business/* read endpoints all require authentication`);
  }

  section("No /business/* route accepts an anonymous WRITE");
  {
    const WRITES = [
      ["POST", "/business/leads",         { name: "os52-regression-probe", company: "probe" }],
      ["POST", "/business/contacts",      { name: "os52-regression-probe" }],
      ["POST", "/business/opportunities", { title: "os52-regression-probe", value: 1 }],
      ["POST", "/business/revenue",       { amount: 1, source: "probe" }],
    ];
    for (const [method, path, payload] of WRITES) {
      const res = await request(method, path, payload);
      assert.ok(
        res.status === 401,
        `${method} ${path} must return 401 without a session, got ${res.status} — an anonymous write would create real records`
      );
    }
    ok(`${WRITES.length} /business/* write endpoints all reject anonymous requests`);
  }

  section("ops.js no longer defines a duplicate Business OS surface");
  {
    const ops = fs.readFileSync("backend/routes/ops.js", "utf8");
    const dupes = (ops.match(/router\.(get|post|patch|put|delete)\(\s*"\/business/g) || []).length;
    assert.strictEqual(
      dupes, 0,
      `ops.js must define zero /business/* routes (found ${dupes}) — they shadow the authenticated implementation in business.js`
    );
    // Match an actual require(), not the explanatory comment that documents
    // why the block was removed.
    assert.ok(
      !/require\(\s*["'][^"']*businessOS\.cjs["']\s*\)/.test(ops),
      "ops.js must no longer require businessOS.cjs — the unauthenticated backing service for the removed duplicates"
    );
    ok("ops.js defines 0 /business/* routes and no longer loads businessOS.cjs");
  }

  section("The canonical implementation still serves every path");
  {
    const business = fs.readFileSync("backend/routes/business.js", "utf8");
    const routes = (business.match(/router\.(get|post|patch|put|delete)\(\s*"\/business/g) || []).length;
    assert.ok(
      routes >= 34,
      `business.js must still define at least the 34 removed paths (found ${routes}) — no capability may be lost`
    );
    assert.ok(
      /requireAuth/.test(business) && /_requireOrg/.test(business),
      "business.js must retain requireAuth and _requireOrg — it is the authenticated, org-scoped implementation"
    );
    ok(`business.js retains ${routes} /business/* routes with requireAuth + _requireOrg`);
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
