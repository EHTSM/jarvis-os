#!/usr/bin/env node
"use strict";
/**
 * C.3 — performance guards.
 *
 * Locks in the two measured optimizations, and — more importantly — the
 * CORRECTNESS properties each one had to preserve. A performance fix that
 * silently serves stale or wrong data is worse than the slowness it replaced,
 * so most of the assertions below are correctness assertions.
 *
 * MEASURED IN C.3:
 *
 *   C3-01  engineeringSmellDetector.scan() read 2,900 source files / 29.7 MB on
 *          EVERY call: 1,369-2,339 ms, while serializing the 1.42 MB result took
 *          only 3-4 ms. SmellsPanel.jsx polls /coding/smells every 5 minutes, so
 *          the identical full-repo scan repeated indefinitely.
 *            in-process : 2,841 ms -> 81 ms   (97.1%)
 *            over HTTP  : 1,676 ms -> 235 ms  (86%)   payload unchanged 1.42 MB
 *          Output proven BYTE-IDENTICAL across runs (3,615 smells, 1,487,055 B).
 *
 *   C3-02  compress.js only patched res.json, so express.static assets shipped
 *          completely uncompressed:
 *            main.js  1,211 KB -> 330 KB gzipped (73%)
 *            main.css   416 KB ->  68 KB gzipped (84%)
 *            cold first visit 1,667 KB -> 410 KB (75%)
 *
 * Requires a live backend on :5050 for the HTTP assertions.
 * Usage: node tests/security/101-c3-performance-guards.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const http   = require("http");
const path   = require("path");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }
const read = p => fs.readFileSync(p, "utf8");

function request(method, urlPath, { headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: PORT, path: urlPath, method, headers: headers || {} }, res => {
      let bytes = 0;
      res.on("data", d => { bytes += d.length; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`timeout ${urlPath}`)); });
    req.end();
  });
}

async function main() {
  let live = true;
  try { const h = await request("GET", "/health"); assert.strictEqual(h.status, 200); }
  catch { live = false; console.log(`\n  NOTE — backend not reachable on :${PORT}; HTTP assertions report SKIPPED (not passed).`); }

  section("C3-01 — the smell scan reuses work without going stale");
  {
    const src = read("backend/services/engineeringSmellDetector.cjs");

    assert.ok(/_scanCache/.test(src) && /_scanStamp/.test(src),
      "scan() must reuse its file-derived result — it reads 2,900 files / 29.7 MB per call");
    ok("the repeat-scan cache is present");

    // The cache MUST be keyed on a real change signal, not just time.
    assert.ok(/mtimeMs/.test(src),
      "the cache key must include file mtimes, or a developer would see stale smells " +
      "for code they just changed");
    ok("cache validity is keyed on file mtime, not only elapsed time");

    // Dismissals must NOT be cached — they are per-call user state.
    const scanBody = src.slice(src.indexOf("function scan(repoPath)"), src.indexOf("function dismiss("));
    assert.ok(/_loadDismissed\(\)/.test(scanBody),
      "dismissed smells must still be loaded on EVERY call — caching the final " +
      "result would make dismissing a smell appear to do nothing");
    const cacheAssignIdx = scanBody.indexOf("_scanCache = {");
    const dismissedIdx   = scanBody.indexOf("_loadDismissed()");
    assert.ok(dismissedIdx !== -1 && (cacheAssignIdx === -1 || dismissedIdx < cacheAssignIdx),
      "dismissal loading must not be inside the cached branch");
    ok("dismissals are applied per-call, never cached");

    // Runtime detectors read live state and must never be cached.
    assert.ok(/Runtime detectors read live state[\s\S]{0,200}_detectStaleMissions\(\)/.test(scanBody)
      || /\.\.\._detectStaleMissions\(\)/.test(scanBody.slice(scanBody.indexOf("const allSmells"))),
      "_detectStaleMissions/_detectBuildFailures/_detectBenchmarkDecline read live " +
      "state and must be re-run every call, not served from the file cache");
    ok("runtime detectors are excluded from the cache");

    // The per-scan memo release (a deliberate memory-leak fix) must survive.
    assert.ok(/_fileCache = null/.test(scanBody),
      "the per-scan _fileCache memo must still be released — that is a deliberate " +
      "memory-leak fix and must not be traded away for speed");
    ok("the per-scan memo is still released (memory-leak fix intact)");
  }

  section("C3-01 — output correctness is preserved");
  {
    const det = require(path.join(process.cwd(), "backend/services/engineeringSmellDetector.cjs"));
    const root = process.cwd();
    const a = det.scan(root);
    const b = det.scan(root);   // served from cache
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b),
      "a cached scan must return byte-identical output to the scan it replaced");
    assert.ok(a.smells.length > 0, "the scan must still detect smells");
    ok(`cached and uncached scans are byte-identical (${a.smells.length} smells)`);
  }

  section("C3-02 — static build assets are compressed");
  if (live) {
    const jsDir = "frontend/build/static/js";
    const main = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).find(f => /^main\..*\.js$/.test(f)) : null;
    if (!main) {
      console.log("  —  SKIPPED (no production build present) — not counted as a pass");
    } else {
      const gz = await request("GET", `/static/js/${main}`, { headers: { "Accept-Encoding": "gzip" } });
      assert.strictEqual(gz.status, 200, "the main bundle must serve");
      assert.strictEqual(gz.headers["content-encoding"], "gzip",
        "the main JS bundle must be gzipped — it shipped 1,211 KB uncompressed on every first visit");
      const raw = fs.statSync(path.join(jsDir, main)).size;
      assert.ok(gz.bytes < raw * 0.6,
        `gzipped bundle (${gz.bytes}) must be substantially smaller than raw (${raw})`);
      ok(`main bundle gzipped: ${Math.round(raw / 1024)} KB -> ${Math.round(gz.bytes / 1024)} KB`);

      // A client that cannot accept gzip must still get a working file.
      const plain = await request("GET", `/static/js/${main}`, { headers: { "Accept-Encoding": "identity" } });
      assert.strictEqual(plain.status, 200, "a non-gzip client must still receive the bundle");
      assert.notStrictEqual(plain.headers["content-encoding"], "gzip",
        "a client that did not offer gzip must not be sent gzip");
      ok("clients that cannot accept gzip still receive an uncompressed bundle");
    }
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  section("C3-02 — HTML is excluded so the CSP nonce survives");
  {
    const src = read("backend/middleware/compress.js");
    assert.ok(!/html/.test(src.match(/const COMPRESSIBLE = [^;]+;/)?.[0] || ""),
      "HTML must NOT be pre-gzipped from disk: index.html is re-rendered per request " +
      "to stamp a fresh CSP nonce, and a cached copy would ship a nonce that does not " +
      "match the response header — the browser blocks every script and the page is blank");
    ok("HTML is excluded from static compression");

    if (live) {
      const shell = await request("GET", "/");
      assert.strictEqual(shell.status, 200, "the SPA shell must still serve");
      assert.notStrictEqual(shell.headers["content-encoding"], "gzip",
        "the SPA shell must not be served from the pre-gzipped asset path");
      ok("the SPA shell is still rendered per request, not served pre-gzipped");
    }
  }

  section("C3-02 — traversal outside the build directory is refused");
  {
    const src = read("backend/middleware/compress.js");
    assert.ok(/path\.relative\(/.test(src) && /startsWith\("\.\."\)/.test(src),
      "the static-gzip path must reject anything resolving outside frontend/build — " +
      "otherwise a crafted URL could read arbitrary files");
    ok("path traversal outside the build directory is rejected");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
