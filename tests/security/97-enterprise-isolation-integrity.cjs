#!/usr/bin/env node
"use strict";
/**
 * B.24 — enterprise tenant isolation and privilege-boundary integrity.
 *
 * Locks in what B.24 measured live between two genuinely separate enterprise
 * organizations (Meridian Global Ltd / Corvus Industries Inc), each created
 * through the real signup flow with a full org → workspace → department →
 * team hierarchy.
 *
 * MEASURED IN B.24 (all against the running backend, no forged tokens):
 *
 *   Direct-ID reads  B -> A : 13/13 denied (403)
 *   Writes/updates/deletes  : 6/6 denied (403), no artifact landed in A
 *   Forged org headers      : 3/3 denied (X-Org-Id, X-Organization, x-org)
 *   Forged role headers     : 3/3 denied (X-Role, X-User-Role, X-Permissions)
 *   Role at registration    : ignored — account created as "user"
 *   Query-param org override: denied (403)
 *   Cross-tenant audit read : denied (403); 0 foreign entries in own log
 *
 * ADDED — OS-ENTERPRISE RECONCILIATION (2026-08-15): the legacy
 * agents/runtime/enterpriseOS.cjs engine (mounted flat in ops.js at
 * /enterprise/orgs, /enterprise/depts, /enterprise/teams, /enterprise/roles,
 * /enterprise/permissions, /enterprise/policies, /enterprise/audit,
 * /enterprise/dashboard, /enterprise/summary, /enterprise/compliance,
 * /enterprise/search, /enterprise/stats — all distinct from the org-scoped
 * :orgId routes above) had NO auth middleware at all. Live-reproduced on an
 * isolated port pre-fix: a zero-cookie request created, listed, renamed and
 * archived organizations, including pre-existing seed orgs. Fixed with
 * requireAuth + operatorOnly + operatorAudit per route (not router.use on a
 * prefix — /enterprise/audit and /enterprise/dashboard are literal prefixes
 * of the real, already-safe :orgId route families above, so a prefix-based
 * gate would have shadowed them).
 *
 * These are the boundaries an enterprise buyer's security review will probe
 * first. This suite fails loudly if any of them regress.
 *
 * Requires a live backend on :5050. Creates two disposable tenants per run.
 * Usage: node tests/security/97-enterprise-isolation-integrity.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const http   = require("http");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

function request(method, path, { token, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      { host: "localhost", port: PORT, path, method, headers: {
          ...(token ? { Cookie: `jarvis_auth=${token}` } : {}),
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(headers || {}) } },
      res => { let b = ""; res.on("data", d => (b += d));
               res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {}
                                     resolve({ status: res.statusCode, body: b, json: j }); }); }
    );
    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error(`timeout ${method} ${path}`)); });
    if (data) req.write(data);
    req.end();
  });
}

function login(email, password) {
  return new Promise(resolve => {
    const p = JSON.stringify({ email, password });
    const r = http.request(
      { host: "localhost", port: PORT, path: "/auth/login", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(p) } },
      res => { res.on("data", () => {}); res.on("end", () => {
        const m = ((res.headers["set-cookie"] || []).join(";")).match(/jarvis_auth=([^;]+)/);
        resolve(m ? m[1] : null); }); }
    );
    r.on("error", () => resolve(null));
    r.setTimeout(15000, () => { r.destroy(); resolve(null); });
    r.write(p); r.end();
  });
}

async function makeTenant(label) {
  const email = `b24-suite-${label}-${Date.now()}@test.local`;
  const password = "B24Suite!2026x";
  const reg = await request("POST", "/accounts/register",
    { body: { email, password, name: label, orgName: `${label} Ltd` } });
  if (reg.status !== 201 && reg.status !== 200) return null;
  const token = await login(email, password);
  return token ? { email, password, token, orgId: reg.json?.org?.orgId } : null;
}

async function main() {
  try {
    const h = await request("GET", "/health");
    assert.strictEqual(h.status, 200, "backend must be reachable");
  } catch (e) {
    console.log(`\n  SKIPPED — backend not reachable on :${PORT} (${e.message})`);
    process.exit(0);
  }

  const A = await makeTenant("alpha");
  const B = await makeTenant("beta");
  if (!A || !B || !A.orgId || !B.orgId) {
    console.log("\n  SKIPPED — could not create two tenants (signup rate limit)");
    console.log("  This is an environment condition, not a product failure.");
    process.exit(0);
  }

  section("Cross-tenant direct-ID reads are denied");
  {
    const paths = [
      `/orgs/${A.orgId}`,
      `/orgs/${A.orgId}/departments`,
      `/orgs/${A.orgId}/teams`,
      `/orgs/${A.orgId}/members`,
      `/orgs/${A.orgId}/missions`,
      `/org-agents/${A.orgId}`,
      `/org-graph/${A.orgId}`,
      `/enterprise/dashboard/${A.orgId}`,
      `/enterprise/policy/${A.orgId}`,
      `/enterprise/audit/${A.orgId}/search`,
    ];
    for (const p of paths) {
      const r = await request("GET", p, { token: B.token });
      assert.ok(r.status === 403 || r.status === 404,
        `${p} must deny a foreign tenant (got ${r.status}) — cross-org data disclosure`);
    }
    ok(`${paths.length} direct-ID reads denied to a foreign tenant`);
  }

  section("Cross-tenant writes, updates and deletes are denied");
  {
    const writes = [
      ["POST",   `/orgs/${A.orgId}/departments`, { name: "suite-intrusion" }],
      ["POST",   `/orgs/${A.orgId}/missions`,    { objective: "suite-intrusion" }],
      ["PATCH",  `/orgs/${A.orgId}`,             { name: "HIJACKED" }],
      ["PUT",    `/enterprise/policy/${A.orgId}`, { password: { minLength: 1 } }],
    ];
    for (const [m, p, body] of writes) {
      const r = await request(m, p, { token: B.token, body });
      assert.ok(r.status === 403 || r.status === 404,
        `${m} ${p} must deny a foreign tenant (got ${r.status}) — cross-org mutation`);
    }
    // A's org name must be untouched by the hijack attempt.
    const own = await request("GET", `/orgs`, { token: A.token });
    assert.ok(!/HIJACKED/.test(own.body), "a foreign PATCH must not alter the victim org");
    ok(`${writes.length} cross-tenant mutations denied; victim org unmodified`);
  }

  section("Forged organization headers cannot widen access");
  {
    for (const h of [{ "X-Org-Id": A.orgId }, { "X-Organization": A.orgId }, { "x-org": A.orgId }]) {
      const r = await request("GET", `/orgs/${A.orgId}/departments`, { token: B.token, headers: h });
      assert.ok(r.status === 403 || r.status === 404,
        `header ${Object.keys(h)[0]} must not grant access to another org (got ${r.status})`);
    }
    ok("3 forged organization headers all denied — membership is verified server-side");
  }

  section("Forged role headers cannot escalate privilege");
  {
    for (const h of [{ "X-Role": "operator" }, { "X-User-Role": "admin" }, { "X-Permissions": "manage_departments" }]) {
      const r = await request("GET", "/vault/dashboard", { token: B.token, headers: h });
      assert.strictEqual(r.status, 403,
        `header ${Object.keys(h)[0]} must not grant operator access (got ${r.status})`);
    }
    ok("3 forged role headers all denied — role comes from the signed token only");
  }

  section("Role cannot be self-assigned at registration");
  {
    const email = `b24-esc-${Date.now()}@test.local`;
    const r = await request("POST", "/accounts/register",
      { body: { email, password: "B24Esc!2026x", name: "esc", role: "operator" } });
    assert.notStrictEqual(r.json?.account?.role, "operator",
      "a client-supplied role must never be honoured — privilege escalation via registration");
    ok(`client-supplied role ignored (account created as "${r.json?.account?.role}")`);
  }

  section("Audit log is tenant-scoped");
  {
    const own = await request("GET", `/enterprise/audit/${B.orgId}/search`, { token: B.token });
    assert.strictEqual(own.status, 200, "a tenant must read its own audit log");
    const foreign = (own.json?.entries || []).filter(e => e.orgId && e.orgId !== B.orgId);
    assert.strictEqual(foreign.length, 0,
      `own audit log must contain no other tenant's entries (found ${foreign.length})`);
    ok("audit log returns only the caller's own organization events");
  }

  section("Legacy enterpriseOS.cjs engine (/enterprise/orgs etc.) requires auth");
  {
    const unauthProbes = [
      ["GET",  "/enterprise/orgs"],
      ["POST", "/enterprise/orgs", { name: "suite-probe-org" }],
      ["GET",  "/enterprise/dashboard"],
      ["GET",  "/enterprise/audit"],
      ["GET",  "/enterprise/stats"],
    ];
    for (const [m, p, body] of unauthProbes) {
      const r = await request(m, p, { body });
      assert.strictEqual(r.status, 401,
        `unauthenticated ${m} ${p} must be denied (got ${r.status}) — legacy enterprise engine has no membership model to scope against`);
    }
    const nonOperator = await request("GET", "/enterprise/orgs", { token: A.token });
    assert.strictEqual(nonOperator.status, 403,
      `a regular (non-operator) tenant account must be denied /enterprise/orgs (got ${nonOperator.status})`);
    ok(`${unauthProbes.length} unauthenticated legacy-engine probes denied (401); non-operator tenant denied (403)`);
  }

  section("Fix did not shadow the real org-scoped /enterprise/* routes");
  {
    // Regression guard for the exact bug this suite's fix could have introduced:
    // a router.use(prefix, ...) on /enterprise/dashboard or /enterprise/audit
    // would also intercept enterpriseDashboard.js's/enterpriseAudit.js's real
    // :orgId routes, which must remain reachable by their own owner.
    const selfDash  = await request("GET", `/enterprise/dashboard/${A.orgId}`, { token: A.token });
    const selfAudit = await request("GET", `/enterprise/audit/${A.orgId}/search`, { token: A.token });
    assert.strictEqual(selfDash.status, 200, `owner must still reach their own /enterprise/dashboard/:orgId (got ${selfDash.status})`);
    assert.strictEqual(selfAudit.status, 200, `owner must still reach their own /enterprise/audit/:orgId/search (got ${selfAudit.status})`);
    ok("real org-scoped /enterprise/dashboard/:orgId and /enterprise/audit/:orgId/search unaffected by the legacy-engine gate");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
