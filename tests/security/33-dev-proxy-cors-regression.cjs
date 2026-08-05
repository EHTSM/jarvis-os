#!/usr/bin/env node
"use strict";
/**
 * Dev-proxy CORS regression — backend/server.js's CORS origin allowlist.
 *
 * CONFIRMED finding (Real Productivity & Operator Experience
 * Certification): `npm run dev` — this project's own documented local-dev
 * workflow (frontend on :3000 proxying to backend on :5050 via CRA's
 * "proxy" field in frontend/package.json) — was completely broken for
 * every state-changing request. A real operator following the README's
 * own quick-start instructions could not even create an account.
 *
 * Root cause, confirmed by reading the installed react-dev-utils source
 * directly (frontend/node_modules/react-dev-utils/WebpackDevServerUtils.js):
 * CRA's dev-server proxy rewrites the Origin header of every proxied
 * request to the proxy TARGET's own address — i.e. it sends
 * `Origin: http://localhost:5050` to this very server, specifically to
 * *avoid* CORS issues, per that file's own comment. This backend's strict
 * origin allowlist rejected that self-referential origin, so every
 * proxied POST failed with a 500 before ever reaching its route handler.
 *
 * Reproduced directly: curl straight to :5050 always succeeded (real 201
 * from POST /accounts/register); the IDENTICAL request through the :3000
 * proxy always failed with `CORS: origin 'http://localhost:5050' not
 * allowed`. Also discovered along the way: this repo's own checked-in
 * .env hardcodes NODE_ENV=production even for local development, so any
 * fix keyed off NODE_ENV would have been dead code in this project's
 * actual configuration — the fix below does not depend on NODE_ENV.
 *
 * Fix: the CORS origin check now also accepts an Origin that is
 * self-referential (Host matches this exact server's own configured
 * localhost:PORT) — the same trust boundary as the pre-existing `!origin`
 * same-origin allowance, just covering the one extra hop CRA's proxy
 * introduces. A real external forged Origin is still rejected.
 *
 * This test starts the real server as a child process (not a mock) and
 * makes real HTTP requests against it — the exact reproduction method
 * used to find and verify this bug.
 *
 * Usage: node tests/security/33-dev-proxy-cors-regression.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const { spawn } = require("child_process");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const TEST_PORT = 5087;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(TEST_PORT) };
    delete env.NODE_ENV; // matches the real `npm start`/`npm run dev` invocation — no explicit NODE_ENV on the command line
    const proc = spawn("node", ["backend/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("server did not become healthy within 20s")); }
    }, 20000);

    const tryHealth = async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const res = await fetch(`http://localhost:${TEST_PORT}/health`);
          if (res.ok) { clearTimeout(timer); if (!settled) { settled = true; resolve(proc); } return; }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
      }
    };
    proc.stdout.on("data", () => {});
    proc.stderr.on("data", () => {});
    tryHealth();
  });
}

async function main() {
  section("Setup — real server child process, no explicit NODE_ENV (matches npm start/npm run dev exactly)");
  let serverProc;
  try {
    serverProc = await startServer();
    ok("real server booted and became healthy");
  } catch (e) {
    ko("real server booted and became healthy", e.message);
    process.exit(1);
  }

  const base = `http://localhost:${TEST_PORT}`;
  const uniqueEmail = () => `regression-test-${Date.now()}-${Math.random().toString(36).slice(2)}@ooplix-test.local`;

  section("The exact CRA dev-proxy scenario: Origin equals this server's own address");
  {
    const res = await fetch(`${base}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": `http://localhost:${TEST_PORT}` },
      body: JSON.stringify({ name: "Regression Test", email: uniqueEmail(), password: "RegressionTest12345!" }),
    });
    const body = await res.json().catch(() => ({}));
    assert(res.status === 201, `POST /accounts/register with Origin=http://localhost:${TEST_PORT} (the CRA proxy's rewritten origin) succeeds`, `got status ${res.status}: ${JSON.stringify(body)}`);
    assert(body.success === true, "response reports success:true", `got ${JSON.stringify(body)}`);
  }

  section("127.0.0.1 variant of the self-referential origin also works");
  {
    const res = await fetch(`${base}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": `http://127.0.0.1:${TEST_PORT}` },
      body: JSON.stringify({ name: "Regression Test 2", email: uniqueEmail(), password: "RegressionTest12345!" }),
    });
    assert(res.status === 201, `POST /accounts/register with Origin=http://127.0.0.1:${TEST_PORT} succeeds`, `got status ${res.status}`);
  }

  section("Security boundary intact — a real external forged origin is still rejected");
  {
    const res = await fetch(`${base}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://evil-attacker.example.com" },
      body: JSON.stringify({ name: "Attacker", email: uniqueEmail(), password: "RegressionTest12345!" }),
    });
    assert(res.status !== 201, "a forged external Origin does not succeed", `got status ${res.status} — external origin was NOT rejected, this is a real security regression`);
  }

  section("Security boundary intact — a different port on localhost is still rejected (not a blanket localhost allowance)");
  {
    const res = await fetch(`${base}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "http://localhost:9999" },
      body: JSON.stringify({ name: "WrongPort", email: uniqueEmail(), password: "RegressionTest12345!" }),
    });
    assert(res.status !== 201, "an arbitrary localhost port that isn't this server's own port is still rejected", `got status ${res.status} — the fix may have become a blanket "any localhost origin" allowance instead of a self-referential-only one`);
  }

  section("Legitimate production origin still works (allowlist itself untouched)");
  {
    const res = await fetch(`${base}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://ooplix.com" },
      body: JSON.stringify({ name: "Prod Origin", email: uniqueEmail(), password: "RegressionTest12345!" }),
    });
    assert(res.status === 201, "the real production origin (https://ooplix.com) still succeeds", `got status ${res.status}`);
  }

  serverProc.kill();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Dev-Proxy CORS Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
