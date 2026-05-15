#!/usr/bin/env node
"use strict";
/**
 * Production health smoke test.
 *
 * Usage:
 *   node tests/smoke/production-smoke.cjs                  # tests localhost:5050
 *   node tests/smoke/production-smoke.cjs https://domain   # tests production URL
 *
 * Exits 0 if all critical checks pass, 1 if any fail.
 * Warns (non-fatal) on optional service checks.
 */

const https  = require("https");
const http   = require("http");

const BASE   = process.argv[2] || "http://localhost:5050";
const TIMEOUT_MS = 8000;

let passed = 0;
let failed = 0;
let warned = 0;

function pass(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function warn(label, detail) {
  console.warn(`  ! ${label}${detail ? ` — ${detail}` : ""}`);
  warned++;
}

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(`${BASE}${path}`);
    const lib     = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   opts.method || "GET",
      headers:  { "Content-Type": "application/json", ...(opts.headers || {}) },
      timeout:  TIMEOUT_MS,
      rejectUnauthorized: true,
    };

    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), raw: body });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body });
        }
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function runChecks() {
  console.log(`\nJARVIS OS — Production Smoke Tests`);
  console.log(`Target: ${BASE}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // ── 1. Health endpoint ─────────────────────────────────────────
  console.log("[ Core ]");
  try {
    const r = await request("/health");
    if (r.status === 200 && r.body?.status === "ok") {
      pass(`/health → ok (uptime: ${r.body.uptime_seconds ?? "?"}s)`);
    } else if (r.status === 200) {
      warn("/health returned 200 but status is not 'ok'", JSON.stringify(r.body).slice(0, 80));
    } else {
      fail("/health", `HTTP ${r.status}`);
    }
  } catch (e) {
    fail("/health", e.message);
  }

  // ── 2. Stats endpoint ──────────────────────────────────────────
  try {
    const r = await request("/stats");
    if (r.status === 200) pass("/stats → ok");
    else fail("/stats", `HTTP ${r.status}`);
  } catch (e) {
    fail("/stats", e.message);
  }

  // ── 3. Static frontend ─────────────────────────────────────────
  try {
    const r = await request("/");
    if (r.status === 200 && (r.raw.includes("<!DOCTYPE") || r.raw.includes("<html"))) {
      pass("/ → frontend HTML served");
    } else if (r.status === 200) {
      warn("/ → 200 but not HTML (API response?)", r.raw.slice(0, 60));
    } else {
      fail("/ → frontend not served", `HTTP ${r.status}`);
    }
  } catch (e) {
    fail("/ → frontend", e.message);
  }

  // ── 4. Auth endpoint ───────────────────────────────────────────
  console.log("\n[ Auth ]");
  try {
    const r = await request("/auth/me");
    // Expect 401 (unauthenticated) or 200 (dev passthrough); 404 = old deploy without auth
    if (r.status === 401) {
      pass("/auth/me → 401 (auth required, correct)");
    } else if (r.status === 200) {
      warn("/auth/me → 200 without token (JWT_SECRET not configured — dev passthrough active)");
    } else if (r.status === 404) {
      warn("/auth/me → 404 (auth routes not deployed — restart server to activate)");
    } else {
      fail("/auth/me", `unexpected HTTP ${r.status}`);
    }
  } catch (e) {
    fail("/auth/me", e.message);
  }

  // ── 5. Runtime routes require auth ────────────────────────────
  try {
    const r = await request("/runtime/status");
    if (r.status === 401) {
      pass("/runtime/status → 401 (protected)");
    } else if (r.status === 200) {
      warn("/runtime/status → 200 without token (auth not enforced — check JWT_SECRET)");
    } else if (r.status === 503) {
      warn("/runtime/status → 503 (JWT_SECRET missing in production)");
    } else {
      fail("/runtime/status", `unexpected HTTP ${r.status}`);
    }
  } catch (e) {
    fail("/runtime/status", e.message);
  }

  // ── 6. POST /jarvis basic response ────────────────────────────
  console.log("\n[ AI ]");
  try {
    const r = await request("/jarvis", {
      method: "POST",
      body: JSON.stringify({ input: "hello", mode: "smart" }),
    });
    if (r.status === 200 && r.body?.reply) {
      pass(`/jarvis → reply received (${r.body.reply.slice(0, 40)}…)`);
    } else if (r.status === 200) {
      warn("/jarvis → 200 but no reply field", JSON.stringify(r.body).slice(0, 80));
    } else {
      fail("/jarvis", `HTTP ${r.status}: ${r.raw.slice(0, 80)}`);
    }
  } catch (e) {
    fail("/jarvis", e.message);
  }

  // ── 7. Optional: ops endpoint ─────────────────────────────────
  console.log("\n[ Optional ]");
  try {
    const r = await request("/ops");
    if (r.status === 200) pass("/ops → ok");
    else warn("/ops", `HTTP ${r.status} (may require auth in production)`);
  } catch (e) {
    warn("/ops", e.message);
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${warned} warnings`);

  if (failed > 0) {
    console.error(`\n✗ SMOKE TEST FAILED — ${failed} critical check(s) did not pass\n`);
    process.exit(1);
  } else {
    console.log(`\n✓ All critical checks passed${warned > 0 ? ` (${warned} warning(s))` : ""}\n`);
    process.exit(0);
  }
}

runChecks().catch(e => {
  console.error("Smoke test runner crashed:", e.message);
  process.exit(1);
});
