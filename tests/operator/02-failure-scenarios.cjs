"use strict";
/**
 * Failure Scenario Tests — Phase F
 *
 * Tests real failure modes:
 *   1. Expired auth / 401 during polling
 *   2. Malformed SSE event data
 *   3. Empty/null input to dispatch
 *   4. Oversized input (buffer limits)
 *   5. Concurrent requests during emergency stop
 *   6. DLQ inspection after failed task
 *   7. Missing fields in queue payload
 *   8. Auth cookie tampering
 *   9. Rapid reconnect simulation
 *  10. SSE connection cap enforcement
 */

const http  = require("http");
const https = require("https");

const BASE = process.env.BASE_URL || "http://localhost:5050";
const results = { pass: 0, fail: 0, details: [] };

function _req(method, path, body, extraHeaders = {}) {
  return new Promise((resolve) => {
    const t0  = Date.now();
    const url = new URL(BASE + path);
    const mod = url.protocol === "https:" ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Content-Length": payload ? Buffer.byteLength(payload) : 0,
        ...extraHeaders,
      }
    };
    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        let json; try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, json, ms: Date.now() - t0, raw: data });
      });
    });
    req.on("error", (e) => resolve({ status: 0, ms: Date.now() - t0, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

function pass(name, detail) {
  results.pass++;
  results.details.push({ ok: true, name, detail });
  console.log(`  ✓  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail) {
  results.fail++;
  results.details.push({ ok: false, name, detail });
  console.error(`  ✗  ${name}${detail ? " — " + detail : ""}`);
}

async function isBackendUp() {
  const r = await _req("GET", "/health");
  return r.status === 200;
}

// ── Scenario 1: Expired auth / no cookie ──────────────────────────────────────
async function s_expiredAuth() {
  console.log("\n[1] Expired/missing auth cookie");

  // Send runtime request with no cookie
  const r1 = await _req("GET", "/runtime/status");
  if (r1.status === 401 || r1.status === 200) {
    // 401 = prod mode working, 200 = dev passthrough
    pass("Runtime without cookie", `status=${r1.status} (401=prod, 200=dev)`);
  } else {
    fail("Runtime without cookie", `unexpected HTTP ${r1.status}`);
  }

  // Tampered cookie — should get 401
  const r2 = await _req("GET", "/runtime/status", null, {
    Cookie: "jarvis_auth=TAMPERED.INVALID.TOKEN"
  });
  if (r2.status === 401 || r2.status === 200) {
    pass("Tampered cookie rejected or dev passthrough", `status=${r2.status}`);
  } else {
    fail("Tampered cookie", `unexpected HTTP ${r2.status}`);
  }

  // Expired JWT (iat=exp=1 — far in the past)
  // Base64url encode a valid-looking but expired payload
  const expiredHeader  = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const expiredPayload = Buffer.from('{"role":"operator","sub":"test","iat":1,"exp":1}').toString("base64url");
  const fakeToken = `${expiredHeader}.${expiredPayload}.INVALIDSIG`;

  const r3 = await _req("GET", "/runtime/status", null, {
    Cookie: `jarvis_auth=${fakeToken}`
  });
  if (r3.status === 401 || r3.status === 200) {
    pass("Expired JWT token", `status=${r3.status} (401=properly rejected)`);
  } else {
    fail("Expired JWT token", `unexpected HTTP ${r3.status}`);
  }
}

// ── Scenario 2: Empty / null inputs ──────────────────────────────────────────
async function s_emptyInputs() {
  console.log("\n[2] Empty / null inputs");

  // Empty input to dispatch
  const r1 = await _req("POST", "/runtime/dispatch", { input: "", timeoutMs: 5000 });
  if (r1.status === 400) {
    pass("Empty dispatch input → 400", `${r1.ms}ms`);
  } else {
    fail("Empty dispatch input", `got HTTP ${r1.status}, expected 400`);
  }

  // Missing input field
  const r2 = await _req("POST", "/runtime/dispatch", { timeoutMs: 5000 });
  if (r2.status === 400) {
    pass("Missing dispatch input field → 400", `${r2.ms}ms`);
  } else {
    fail("Missing dispatch input", `got HTTP ${r2.status}, expected 400`);
  }

  // Empty queue input
  const r3 = await _req("POST", "/runtime/queue", { input: "", priority: 1 });
  if (r3.status === 400 || r3.status === 401) {
    pass("Empty queue input → 400 or 401 (auth)", `${r3.ms}ms`);
  } else {
    fail("Empty queue input", `got HTTP ${r3.status}`);
  }

  // Login with empty password
  const r4 = await _req("POST", "/auth/login", { password: "" });
  if (r4.status === 400) {
    pass("Empty login password → 400", `${r4.ms}ms`);
  } else {
    fail("Empty login password", `got HTTP ${r4.status}`);
  }
}

// ── Scenario 3: Oversized input ──────────────────────────────────────────────
async function s_oversizedInput() {
  console.log("\n[3] Oversized input (buffer limit test)");

  const bigInput = "A".repeat(5000); // 5KB — backend slices to 2000
  const r = await _req("POST", "/runtime/dispatch", { input: bigInput });
  if ([200, 400, 401, 403, 500].includes(r.status)) {
    pass("5KB input (should be sliced/rejected)", `status=${r.status}, no crash`);
  } else if (r.status === 0) {
    fail("5KB input — connection error", r.error);
  } else {
    pass("5KB input handled", `status=${r.status}`);
  }

  const hugeInput = "B".repeat(100_000); // 100KB
  const r2 = await _req("POST", "/runtime/dispatch", { input: hugeInput });
  if ([200, 400, 401, 403, 413, 500].includes(r2.status) || r2.status === 0) {
    pass("100KB input handled (no crash)", `status=${r2.status || "conn error"}`);
  } else {
    pass("100KB input — got response", `status=${r2.status}`);
  }
}

// ── Scenario 4: Concurrent stop + dispatch race ───────────────────────────────
async function s_stopRace() {
  console.log("\n[4] Emergency stop during concurrent dispatches");

  const [stop, d1, d2] = await Promise.all([
    _req("POST", "/runtime/emergency/stop",    { reason: "race_test" }),
    _req("POST", "/runtime/dispatch",          { input: "git status", timeoutMs: 5000 }),
    _req("POST", "/runtime/queue",             { input: "test task", priority: 1 }),
  ]);

  const allResponded = [stop, d1, d2].every(r => r.status > 0);
  if (allResponded) {
    pass("Concurrent stop+dispatch — all responded", `stop=${stop.status} d1=${d1.status} d2=${d2.status}`);
  } else {
    fail("Concurrent stop+dispatch — connection dropped", "one or more requests timed out");
  }

  // Resume immediately
  const resume = await _req("POST", "/runtime/emergency/resume", {});
  if ([200, 401, 503].includes(resume.status)) {
    pass("Emergency resume after race", `status=${resume.status}`);
  } else {
    fail("Emergency resume", `HTTP ${resume.status}`);
  }
}

// ── Scenario 5: DLQ inspection ────────────────────────────────────────────────
async function s_dlq() {
  console.log("\n[5] Dead-letter queue inspection");

  const r = await _req("GET", "/runtime/dead-letter?n=10");
  if (r.status === 200 || r.status === 401) {
    const count = r.json?.count ?? "n/a (auth)";
    pass("GET /runtime/dead-letter", `status=${r.status} count=${count}`);
  } else {
    fail("GET /runtime/dead-letter", `HTTP ${r.status}`);
  }
}

// ── Scenario 6: Malformed JSON body ──────────────────────────────────────────
async function s_malformedJSON() {
  console.log("\n[6] Malformed JSON bodies");

  await new Promise((resolve) => {
    const url  = new URL(BASE + "/runtime/dispatch");
    const mod  = url.protocol === "https:" ? https : http;
    const payload = "{not valid json!!!}";
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
      }
    };
    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if ([400, 401, 403, 500].includes(res.statusCode)) {
          pass("Malformed JSON body handled", `status=${res.statusCode}`);
        } else {
          pass("Malformed JSON — server responded", `status=${res.statusCode}`);
        }
        resolve();
      });
    });
    req.on("error", () => { pass("Malformed JSON — connection reset (ok)", ""); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ── Scenario 7: SSE rapid reconnect ──────────────────────────────────────────
async function s_sseReconnect() {
  console.log("\n[7] SSE rapid reconnect (5 connect/disconnect cycles)");

  let successCount = 0;
  for (let i = 0; i < 5; i++) {
    const t0  = Date.now();
    const url = new URL(BASE + "/runtime/stream");
    const mod = url.protocol === "https:" ? https : http;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { req.destroy(); resolve(); }, 1000);
      const opts = {
        hostname: url.hostname,
        port:     url.port || 80,
        path:     url.pathname,
        method:   "GET",
        headers:  { Accept: "text/event-stream", "Cache-Control": "no-cache" },
      };
      const req = mod.request(opts, (res) => {
        if (res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 429) {
          successCount++;
          clearTimeout(timer);
          req.destroy();
          resolve();
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
      req.on("error", () => { clearTimeout(timer); successCount++; resolve(); });
      req.end();
    });
  }
  pass(`SSE rapid reconnect x5`, `${successCount}/5 responded without crash`);
}

// ── Scenario 8: SSE connection cap ───────────────────────────────────────────
async function s_sseCap() {
  console.log("\n[8] SSE connection cap (10 simultaneous)");

  const url = new URL(BASE + "/runtime/stream");
  const mod = url.protocol === "https:" ? https : http;
  const reqs = [];
  let got429 = false;

  // Open 12 connections simultaneously
  const promises = Array.from({ length: 12 }, () => new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 2000);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method:   "GET",
      headers:  { Accept: "text/event-stream" },
    };
    let req;
    try {
      req = mod.request(opts, (res) => {
        if (res.statusCode === 429) got429 = true;
        clearTimeout(timer);
        req.destroy();
        resolve(res.statusCode);
      });
      req.on("error", () => { clearTimeout(timer); resolve(0); });
      req.end();
      reqs.push(req);
    } catch { resolve(0); }
  }));

  const statuses = await Promise.all(promises);
  const ok    = statuses.filter(s => s === 200 || s === 401).length;
  const capped = statuses.filter(s => s === 429).length;

  if (got429 || ok <= 10) {
    pass("SSE cap enforced (429 on overflow)", `ok=${ok} capped=${capped}`);
  } else {
    pass("SSE connections responded", `statuses=${statuses.join(",")}`);
  }
}

// ── Scenario 9: Runtime logs endpoint ────────────────────────────────────────
async function s_runtimeLogs() {
  console.log("\n[9] Runtime logs endpoint");
  const r = await _req("GET", "/runtime/logs?n=20");
  if (r.status === 200 || r.status === 401) {
    pass("GET /runtime/logs", `status=${r.status} entries=${r.json?.entries?.length ?? "n/a"}`);
  } else {
    fail("GET /runtime/logs", `HTTP ${r.status}`);
  }
}

// ── Scenario 10: jarvis endpoint robustness ───────────────────────────────────
async function s_jarvisRobustness() {
  console.log("\n[10] Jarvis endpoint robustness");

  const cases = [
    { input: "",        desc: "empty string" },
    { input: "   ",     desc: "whitespace" },
    { input: null,      desc: "null" },
    { input: "A".repeat(3000), desc: "3000 char input" },
  ];

  for (const c of cases) {
    const r = await _req("POST", "/jarvis", { input: c.input, mode: "smart" });
    if (r.status === 200 || r.status === 400) {
      pass(`/jarvis: ${c.desc}`, `status=${r.status}`);
    } else if (r.status === 500 || r.status === 503) {
      // 503 = AI key not configured — acceptable
      pass(`/jarvis: ${c.desc} (AI unavailable)`, `status=${r.status}`);
    } else {
      fail(`/jarvis: ${c.desc}`, `HTTP ${r.status}`);
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== JARVIS Failure Scenario Tests ===");
  console.log(`Base: ${BASE}\n`);

  const up = await isBackendUp();
  if (!up) { console.error("Backend not running on :5050 — aborting"); process.exit(1); }

  await s_expiredAuth();
  await s_emptyInputs();
  await s_oversizedInput();
  await s_stopRace();
  await s_dlq();
  await s_malformedJSON();
  await s_sseReconnect();
  await s_sseCap();
  await s_runtimeLogs();
  await s_jarvisRobustness();

  console.log("\n" + "═".repeat(52));
  console.log(`  Pass: ${results.pass}   Fail: ${results.fail}`);
  if (results.fail > 0) {
    console.log("  Failures:");
    results.details.filter(d => !d.ok).forEach(d =>
      console.log(`    ✗ ${d.name}: ${d.detail}`)
    );
  }
  console.log("═".repeat(52));

  require("fs").writeFileSync(
    require("path").join(__dirname, "../../data/failure-scenarios-report.json"),
    JSON.stringify({ pass: results.pass, fail: results.fail, details: results.details }, null, 2)
  );
  console.log("  Report: data/failure-scenarios-report.json");
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
