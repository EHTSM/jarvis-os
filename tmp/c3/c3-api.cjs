#!/usr/bin/env node
"use strict";
/**
 * C.3 — live API latency measurement.
 *
 * Populations are kept strictly separate (cold vs warm, auth vs unauth, serial
 * vs concurrent) because mixing them produces meaningless percentiles.
 *
 * Read-only endpoints only. No mutations, no destructive load testing.
 * Rate-limited responses (429) are counted separately from errors — a limiter
 * doing its job is not a performance failure.
 */

const http = require("http");
const fs = require("fs");

const PORT = 5050;
const OUT = process.argv[2] || "tmp/c3/c3-api.json";
const CREDS = { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" };

function req(method, path, { token, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ host: "localhost", port: PORT, path, method,
      headers: token ? { Cookie: `jarvis_auth=${token}` } : {} }, res => {
      let bytes = 0;
      res.on("data", d => { bytes += d.length; });
      res.on("end", () => resolve({
        status: res.statusCode,
        ms: Number(process.hrtime.bigint() - t0) / 1e6,
        bytes,
      }));
    });
    r.on("error", e => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: 0, err: e.message }));
    r.setTimeout(timeoutMs, () => { r.destroy(); resolve({ status: -1, ms: timeoutMs, bytes: 0, timeout: true }); });
    r.end();
  });
}

function login() {
  return new Promise(resolve => {
    const p = JSON.stringify(CREDS);
    const r = http.request({ host: "localhost", port: PORT, path: "/auth/login", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(p) } },
      res => { res.on("data", () => {}); res.on("end", () => {
        const m = ((res.headers["set-cookie"] || []).join(";")).match(/jarvis_auth=([^;]+)/);
        resolve(m ? m[1] : null); }); });
    r.on("error", () => resolve(null));
    r.write(p); r.end();
  });
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p / 100))].toFixed(1);
};
const stat = samples => {
  const ok = samples.filter(s => s.status >= 200 && s.status < 400);
  const rl = samples.filter(s => s.status === 429);
  const err = samples.filter(s => s.status >= 500 || s.status === 0);
  const to = samples.filter(s => s.timeout);
  const lat = ok.map(s => s.ms);
  return {
    n: samples.length, ok: ok.length, rateLimited: rl.length, errors: err.length, timeouts: to.length,
    p50: pct(lat, 50), p75: pct(lat, 75), p95: pct(lat, 95), p99: lat.length >= 20 ? pct(lat, 99) : null,
    min: lat.length ? +Math.min(...lat).toFixed(1) : null,
    max: lat.length ? +Math.max(...lat).toFixed(1) : null,
    bytes: ok.length ? Math.round(ok.reduce((s, x) => s + x.bytes, 0) / ok.length) : 0,
  };
};

// Representative read-only critical paths, one per domain (mission Step 2).
const ENDPOINTS = [
  ["health",       "/health"],
  ["business",     "/business/stats"],
  ["crm",          "/crm/leads"],
  ["growth",       "/growth/audiences"],
  ["finance",      "/cbeta/billing/invoices"],
  ["developer",    "/coding/smells"],
  ["memory",       "/p20/memory/rank"],
  ["mission",      "/p27/missions"],
  ["executive",    "/exec/dashboard"],
  ["organization", "/orgs"],
  ["support",      "/co3/feedback"],
  ["automation",   "/automation/templates"],
  ["ai",           "/ai-ecosystem/creative"],
  ["runtime",      "/runtime/tasks"],
  ["agent",        "/agents"],
  ["product",      "/product-factory/products"],
  ["enterprise",   "/security/sessions"],
];

(async () => {
  const token = await login();
  console.log(`auth: ${token ? "OK" : "FAILED"}`);
  if (!token) { fs.writeFileSync(OUT, JSON.stringify({ blocked: "login failed" }, null, 2)); process.exit(0); }

  const report = { generatedAt: new Date().toISOString(), cold: {}, warm: {}, unauth: {}, concurrency: {} };

  // ── COLD: first authenticated hit per endpoint (separate population) ──────
  console.log("\n[COLD — first authenticated request per endpoint]");
  for (const [name, path] of ENDPOINTS) {
    const s = await req("GET", path, { token });
    report.cold[name] = { path, status: s.status, ms: +s.ms.toFixed(1), bytes: s.bytes };
    console.log(`  ${name.padEnd(13)} ${String(s.status).padStart(3)}  ${String(s.ms.toFixed(1)).padStart(8)} ms  ${String(s.bytes).padStart(8)} B  ${path}`);
  }

  // ── WARM: serial repeats, authenticated ──────────────────────────────────
  console.log("\n[WARM — 12 serial authenticated requests per endpoint]");
  for (const [name, path] of ENDPOINTS) {
    const samples = [];
    for (let i = 0; i < 12; i++) samples.push(await req("GET", path, { token }));
    const st = stat(samples);
    report.warm[name] = { path, ...st };
    console.log(`  ${name.padEnd(13)} p50=${String(st.p50).padStart(7)} p95=${String(st.p95).padStart(7)} max=${String(st.max).padStart(7)} ok=${st.ok}/${st.n} rl=${st.rateLimited} err=${st.errors} ${Math.round(st.bytes / 1024)}KB`);
  }

  // ── UNAUTH: boundary cost (separate population) ──────────────────────────
  console.log("\n[UNAUTH — authorization rejection cost]");
  for (const [name, path] of ENDPOINTS.slice(1, 6)) {
    const samples = [];
    for (let i = 0; i < 6; i++) samples.push(await req("GET", path));
    const st = stat(samples);
    const s0 = samples[0];
    report.unauth[name] = { path, status: s0.status, p50: pct(samples.map(x => x.ms), 50) };
    console.log(`  ${name.padEnd(13)} ${String(s0.status).padStart(3)}  p50=${pct(samples.map(x => x.ms), 50)} ms`);
  }

  await new Promise(r => setTimeout(r, 500));

  // ── CONCURRENCY: read-only, escalating (mission Step 7) ──────────────────
  console.log("\n[CONCURRENCY — read-only /business/stats]");
  for (const level of [1, 5, 10, 25]) {
    const samples = await Promise.all(Array.from({ length: level }, () => req("GET", "/business/stats", { token })));
    const st = stat(samples);
    report.concurrency[level] = st;
    console.log(`  ${String(level).padStart(2)} concurrent  p50=${String(st.p50).padStart(7)} p95=${String(st.p95).padStart(7)} max=${String(st.max).padStart(7)} ok=${st.ok}/${st.n} rateLimited=${st.rateLimited} err=${st.errors} timeouts=${st.timeouts}`);
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
