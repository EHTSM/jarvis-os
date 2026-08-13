#!/usr/bin/env node
"use strict";
/**
 * B.20 — Chaos engineering driver.
 *
 * Exists because tests/chaos/01-controlled-chaos.cjs authenticates with an
 * `x-auth-token` HEADER, while backend/middleware/authMiddleware.js reads the
 * token ONLY from the httpOnly `jarvis_auth` cookie. Every request in that
 * suite therefore returns 401, and its "0/20 connects", "0/50 accepted",
 * "0/100 handled" results describe the harness, not the product. This driver
 * authenticates the way the application actually does.
 *
 * Design rules carried over from the B.19 phases:
 *
 *  • VALIDITY GATE. A run that never authenticates is refused outright. A
 *    failure count collected from 401s is meaningless, and a zero from it must
 *    never be reportable as a pass.
 *  • REAL TENANTS. Two genuinely separate accounts with disjoint workspace
 *    membership, taken from data/workspaces.json — not synthesized.
 *  • MEASURE, DON'T GUESS. Every scenario records status, latency, and body
 *    shape. No scenario asserts on a value it did not observe.
 *
 * Usage:  PORT=5050 node scripts/b20-chaos-driver.cjs [--only=NAME]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PORT = parseInt(process.env.B20_PORT || process.env.PORT || "5050", 10);
const HOST = "127.0.0.1";
const OUT = process.env.B20_OUT || "/tmp/b20-results.json";

const { signJWT, COOKIE_NAME } = require(path.join(__dirname, "..", "backend", "middleware", "authMiddleware.js"));

// ── Tenants ────────────────────────────────────────────────────────────────
/** Pick two workspaces owned by different accounts — real, disjoint tenants. */
function pickTenants() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "workspaces.json"), "utf8"));
  const all = Object.values(raw).filter((w) => w && w.id && Array.isArray(w.members) && w.members.length);
  const seen = new Set();
  const picked = [];
  for (const w of all) {
    const owner = w.members.find((m) => m.role === "Owner") || w.members[0];
    const acct = owner && (owner.accountId || owner.userId || owner.id);
    if (!acct || seen.has(acct)) continue;
    seen.add(acct);
    picked.push({ workspaceId: w.id, accountId: acct, name: String(w.name || "").slice(0, 40) });
    if (picked.length === 2) break;
  }
  if (picked.length < 2) throw new Error("could not find two disjoint tenants in data/workspaces.json");
  return picked;
}

const cookieFor = (accountId, role = "operator") =>
  `${COOKIE_NAME}=${signJWT({ role, sub: accountId })}`;

// ── HTTP ───────────────────────────────────────────────────────────────────
function request(opts) {
  const { method = "GET", path: p, cookie, workspaceId, body, timeout = 8000, headers = {} } = opts;
  const started = Date.now();
  return new Promise((resolve) => {
    const h = { "Content-Type": "application/json", ...headers };
    if (cookie) h.cookie = cookie;
    if (workspaceId) h["x-workspace-id"] = workspaceId;
    const req = http.request({ hostname: HOST, port: PORT, path: p, method, headers: h }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: d, ms: Date.now() - started, ok: res.statusCode >= 200 && res.statusCode < 300 }));
    });
    req.on("error", (e) => resolve({ status: 0, body: "", ms: Date.now() - started, ok: false, error: e.code }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, body: "", ms: Date.now() - started, ok: false, timedOut: true }); });
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

// ── Reporting ──────────────────────────────────────────────────────────────
const results = [];
function record(domain, name, classification, detail, measurements) {
  results.push({ domain, name, classification, detail, measurements: measurements || {} });
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`  ${pad(domain, 4)} ${pad(classification, 18)} ${pad(name, 44)} ${detail}`);
}

module.exports = { request, json, record, results, pickTenants, cookieFor, PORT, OUT };

// ── Validity gate + scenarios ──────────────────────────────────────────────
async function main() {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];

  const health = await request({ path: "/health", timeout: 4000 });
  if (health.status !== 200) {
    console.error(`INVALID RUN — backend not answering on ${HOST}:${PORT} (status ${health.status}). ` +
      `Start it with PORT=${PORT} before running this driver.`);
    process.exit(2);
  }

  const [A, B] = pickTenants();
  const cookieA = cookieFor(A.accountId);
  const cookieB = cookieFor(B.accountId);

  // The gate: an authenticated, in-workspace request must be served. /workspace
  // is genuinely tenant-scoped, so it proves the session AND the membership.
  // (/runtime/status is deliberately NOT used here — it is a global runtime
  // endpoint that ignores the workspace header, so it cannot prove scoping.)
  const gate = await request({ path: "/workspace", cookie: cookieA, workspaceId: A.workspaceId });
  if (!gate.ok) {
    console.error(`INVALID RUN — authenticated probe returned ${gate.status}. ` +
      `Chaos results collected from rejected requests describe the harness, not the product.`);
    console.error(`  tenant A: account=${A.accountId} workspace=${A.workspaceId}`);
    process.exit(2);
  }

  console.log(`B.20 chaos driver — backend ${HOST}:${PORT}, authenticated (gate ${gate.status}, ${gate.ms}ms)`);
  console.log(`  tenant A: ${A.accountId} / ${A.workspaceId}  "${A.name}"`);
  console.log(`  tenant B: ${B.accountId} / ${B.workspaceId}  "${B.name}"\n`);

  const scenarios = require("./b20-scenarios.cjs");
  for (const s of scenarios) {
    if (only && s.name !== only) continue;
    try {
      await s.run({ A, B, cookieA, cookieB, request, json, record });
    } catch (e) {
      record(s.domain, s.name, "UNKNOWN", `driver error: ${e.message}`, {});
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ port: PORT, tenants: [A, B], results }, null, 2));
  const tally = results.reduce((m, r) => ((m[r.classification] = (m[r.classification] || 0) + 1), m), {});
  console.log(`\n${results.length} scenarios: ` + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(`written to ${OUT}`);
}

if (require.main === module) main();
