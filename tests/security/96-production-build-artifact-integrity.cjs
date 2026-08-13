#!/usr/bin/env node
"use strict";
/**
 * B.23 — production build artifact integrity gate.
 *
 * CONFIRMED finding (B.22, reproduced and root-caused in B.23):
 *
 *   The deployed frontend bundle had REACT_APP_API_URL compiled in as
 *   "http://127.0.0.1:5099" across 44 of 165 chunks. The server's CSP
 *   (connect-src 'self' https:) correctly refuses a plain-HTTP cross-origin
 *   call, so GET /auth/me never resolved and A FOUNDER COULD NOT LOG IN AT
 *   ALL — measured at 4 clicks / 7,487 ms with no progress and no visible
 *   error. A silent, total production blocker.
 *
 * ROOT CAUSE (proven in B.23, not inferred):
 *   Neither deploy.sh nor deploy/update.sh can cause it — both default
 *   BUILD_API_URL to "" and pass it explicitly. .env sets the var empty.
 *   frontend/build is gitignored and untracked, so no checkout restores it.
 *
 *   The mechanism is an EXPORTED SHELL VARIABLE. Reproduced directly:
 *     REACT_APP_API_URL="http://127.0.0.1:5099" npx react-scripts build
 *       -> 44 chunks contain the stale origin
 *     REACT_APP_API_URL= npm run build
 *       -> 0 chunks
 *   Any shell that exports the variable bakes it into the artifact, and the
 *   result is indistinguishable from a good build without inspecting it.
 *
 * This gate makes that failure loud instead of silent. It inspects the actual
 * built artifact — the thing users receive — not the source.
 *
 * Usage: node tests/security/96-production-build-artifact-integrity.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const BUILD = "frontend/build";
const JSDIR = path.join(BUILD, "static/js");

function main() {
  if (!fs.existsSync(path.join(BUILD, "index.html"))) {
    console.log("\n  SKIPPED — no production build present (frontend/build/index.html missing)");
    console.log("  Build it with: cd frontend && npm run build");
    process.exit(0);
  }

  const chunks = fs.readdirSync(JSDIR).filter(f => f.endsWith(".js"));
  const html   = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");

  section("No development or loopback API origin is compiled into the artifact");
  {
    // The exact value that shipped in B.22, plus the general class.
    const BAD = [
      /https?:\/\/127\.0\.0\.1:\d+/,
      /https?:\/\/localhost:\d+/,
      /https?:\/\/0\.0\.0\.0:\d+/,
    ];
    const offenders = [];
    for (const c of chunks) {
      const src = fs.readFileSync(path.join(JSDIR, c), "utf8");
      // Only flag it when it is bound to the API base, not incidental text
      // (e.g. a docs string). REACT_APP_API_URL is inlined by CRA verbatim.
      const m = src.match(/REACT_APP_API_URL:\s*"([^"]*)"/);
      if (m && m[1] && BAD.some(re => re.test(m[1]))) offenders.push(`${c} -> ${m[1]}`);
    }
    assert.strictEqual(
      offenders.length, 0,
      `REACT_APP_API_URL must not be a loopback/dev origin in the shipped bundle — ` +
      `CSP refuses cross-origin plain HTTP and login silently fails. Offenders: ${offenders.slice(0, 3).join(", ")}`
    );
    ok(`${chunks.length} chunks carry no loopback/dev API origin`);
  }

  section("index.html references only chunks that exist on disk");
  {
    // B.22 F-004: a rebuild changed hashes while the server served a cached
    // index.html, producing 404s and a completely blank app (0 buttons).
    const refs = [...html.matchAll(/(?:static\/js\/|static\/css\/)([a-zA-Z0-9._-]+)/g)].map(m => m[0]);
    const missing = refs.filter(r => !fs.existsSync(path.join(BUILD, r)));
    assert.strictEqual(
      missing.length, 0,
      `index.html references assets that do not exist: ${missing.slice(0, 3).join(", ")} — the app renders blank`
    );
    ok(`${refs.length} referenced assets all present on disk`);
  }

  section("No debug or development bypass flags in the artifact");
  {
    const FLAGS = [
      { re: /ALLOW_DEV_AUTH_BYPASS["':\s]+["']?1/, why: "dev auth bypass must never ship enabled" },
      { re: /NODE_ENV:\s*"development"/,           why: "artifact must be built in production mode" },
    ];
    const found = [];
    for (const c of chunks) {
      const src = fs.readFileSync(path.join(JSDIR, c), "utf8");
      for (const f of FLAGS) if (f.re.test(src)) found.push(`${c}: ${f.why}`);
    }
    assert.strictEqual(found.length, 0, `development flags present in build: ${found.slice(0, 2).join(" | ")}`);
    ok("no dev auth bypass and no development NODE_ENV in the artifact");
  }

  section("Build is internally consistent");
  {
    assert.ok(chunks.length > 0, "build must contain JS chunks");
    const mains = chunks.filter(c => /^main\.[a-z0-9]+\.js$/.test(c));
    assert.strictEqual(
      mains.length, 1,
      `exactly one main chunk expected, found ${mains.length}: ${mains.join(", ")} — stale artifacts left behind`
    );
    const referencedMain = (html.match(/static\/js\/(main\.[a-z0-9]+\.js)/) || [])[1];
    assert.strictEqual(
      referencedMain, mains[0],
      `index.html references ${referencedMain} but disk has ${mains[0]} — server would 404 the entry bundle`
    );
    ok(`single main chunk (${mains[0]}) and index.html agrees`);
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

try { main(); }
catch (err) { console.error("FAILED:", err.message); process.exit(1); }
