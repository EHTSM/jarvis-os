#!/usr/bin/env node
"use strict";
/**
 * Credential bulk-import route — regression tests.
 *
 * Hidden-capability recovery: backend/services/credentialImportTool.cjs is a
 * real, security-conscious bulk env-var -> Vault import pipeline (dry-run
 * classification, structural no-secret-logging guarantee, explicit confirm
 * gate) that had zero route ever calling it. Confirmed via grep across the
 * repo before this fix: only the tool's own file and a mission-scoped test
 * referenced it.
 *
 * Fix: backend/routes/founderVault.js exposes the tool's existing
 * dryRun()/realImport() functions verbatim as
 * POST /vault/bulk-import/dry-run and POST /vault/bulk-import/run, gated the
 * same requireAuth+operatorOnly way as every other /vault/* route — no new
 * import/classification logic added.
 *
 * Usage: node tests/security/21-credential-bulk-import-route.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-credential-import-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const vaultRouter = require("../../backend/routes/founderVault.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  process.env.TEST_BULK_IMPORT_KEY = "sk-test-not-a-real-secret-0000000000";

  const app = express();
  app.use(express.json());
  app.use(vaultRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const memberJwt  = signJWT({ sub: "test-member",   role: "member",   exp: Math.floor(Date.now() / 1000) + 3600 });
  const operatorJwt = signJWT({ sub: "test-operator", role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 });
  const memberCookie   = `${COOKIE_NAME}=${memberJwt}`;
  const operatorCookie = `${COOKIE_NAME}=${operatorJwt}`;

  const row = {
    envVarName: "TEST_BULK_IMPORT_KEY",
    connectorId: "test:bulk-import-route",
    credentialType: "api_key",
    scope: "PLATFORM_SHARED",
  };

  section("RBAC gate");
  const noAuth = await fetch(`${base}/vault/bulk-import/dry-run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: [row] }) });
  assert(noAuth.status === 401, "POST /vault/bulk-import/dry-run without auth returns 401", `got ${noAuth.status}`);

  const memberDenied = await fetch(`${base}/vault/bulk-import/dry-run`, { method: "POST", headers: { "content-type": "application/json", cookie: memberCookie }, body: JSON.stringify({ rows: [row] }) });
  assert(memberDenied.status === 403, "POST /vault/bulk-import/dry-run as non-operator member returns 403", `got ${memberDenied.status}`);

  section("Dry run — real classification, zero writes");
  const dryRes = await fetch(`${base}/vault/bulk-import/dry-run`, { method: "POST", headers: { "content-type": "application/json", cookie: operatorCookie }, body: JSON.stringify({ rows: [row] }) });
  const dry = await dryRes.json();
  assert(dryRes.status === 200 && dry.ok, "POST /vault/bulk-import/dry-run returns 200 ok:true", `status=${dryRes.status} body=${JSON.stringify(dry)}`);
  assert(dry.totalRows === 1, "dry-run reports totalRows:1", JSON.stringify(dry));
  assert(dry.rows?.[0]?.classification === "WOULD_CREATE", "dry-run classifies a fresh row as WOULD_CREATE", JSON.stringify(dry.rows));
  assert(JSON.stringify(dry).indexOf(process.env.TEST_BULK_IMPORT_KEY) === -1, "dry-run response never contains the raw secret value", "leaked value found in response");

  section("Real import — confirm gate enforced");
  const noConfirm = await fetch(`${base}/vault/bulk-import/run`, { method: "POST", headers: { "content-type": "application/json", cookie: operatorCookie }, body: JSON.stringify({ rows: [row] }) });
  const noConfirmBody = await noConfirm.json();
  assert(noConfirm.status === 400 && noConfirmBody.ok === false, "POST /vault/bulk-import/run without confirm:true is rejected", `status=${noConfirm.status} body=${JSON.stringify(noConfirmBody)}`);

  section("Real import — confirmed write");
  const runRes = await fetch(`${base}/vault/bulk-import/run`, { method: "POST", headers: { "content-type": "application/json", cookie: operatorCookie }, body: JSON.stringify({ rows: [row], confirm: true }) });
  const run = await runRes.json();
  assert(runRes.status === 200 && run.ok, "POST /vault/bulk-import/run with confirm:true returns 200 ok:true", `status=${runRes.status} body=${JSON.stringify(run)}`);
  assert(run.imported === 1, "real import reports imported:1", JSON.stringify(run));
  assert(JSON.stringify(run).indexOf(process.env.TEST_BULK_IMPORT_KEY) === -1, "real-import response never contains the raw secret value", "leaked value found in response");

  section("Idempotency — second import of the same row is a safe no-op");
  const rerunRes = await fetch(`${base}/vault/bulk-import/run`, { method: "POST", headers: { "content-type": "application/json", cookie: operatorCookie }, body: JSON.stringify({ rows: [row], confirm: true }) });
  const rerun = await rerunRes.json();
  assert(rerunRes.status === 200 && rerun.skipped === 1 && rerun.imported === 0, "re-importing the same row without overwrite is skipped, not re-written", JSON.stringify(rerun));

  section("Cleanup");
  try {
    const vault = require("../../backend/services/secretVault.cjs");
    vault.deleteSecret(row.connectorId, row.credentialType, vault.GLOBAL_ORG);
    ok("test vault entry cleaned up");
  } catch (e) { ko("cleanup", e.message); }

  server.close();

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
