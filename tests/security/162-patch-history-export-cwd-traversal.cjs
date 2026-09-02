#!/usr/bin/env node
"use strict";
/**
 * backend/routes/codingAssistant.js — GET /coding/patch-history/:histId/export
 * cwd/path-traversal fix (Mission 78, final pre-VPS audit).
 *
 * This route was added after this same file's own documented 2026-08-21
 * "Command Injection & Process Execution Deep Security Sweep," which
 * established the rule (enforced by a router-level middleware, see
 * backend/routes/codingAssistant.js:250-253) that every route reading a
 * query-string `cwd` must use the already-sanitized `req.safeQueryCwd`,
 * never the raw `req.query.cwd` — because Express 5's `req.query` is a
 * read-derived getter, so `req.query.cwd = _safeCwd(...)` would silently
 * no-op, and reading the raw value bypasses the operator-only +
 * sensitive-root gate `cwdSafety.cjs`'s `safeCwd()` provides. This route
 * read `req.query.cwd` directly, missing that fix entirely. Live impact:
 * any authenticated org member who owns a patch record could set
 * `?cwd=/etc` (or any host directory readable by the server process) and
 * have this route's `path.join(ROOT, rel)` read arbitrary files into the
 * exported ZIP. A second, independent fix in the same route also rejects
 * an absolute or `..`-containing `appliedFiles` entry, since those values
 * originate from AI-generated patch content, not a trusted internal
 * identifier.
 *
 * This test verifies the fix at the source-shape level (matching this
 * exact regression suite's own established convention in
 * tests/runtime/10-c10-cross-system-closure.test.cjs for the same
 * cwdSafety.cjs invariant on this file's other routes) and directly
 * exercises the underlying `cwdSafety.safeCwd()` helper this route now
 * correctly routes through, proving the helper itself rejects exactly the
 * kind of value (`/etc`, an operator-required directory) this route was
 * previously vulnerable to.
 *
 * Usage: node tests/security/162-patch-history-export-cwd-traversal.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Source-shape — the export route uses req.safeQueryCwd, not the raw req.query.cwd");
  {
    const src = fs.readFileSync(require.resolve("../../backend/routes/codingAssistant.js"), "utf8");
    const exportSection = src.slice(
      src.indexOf('router.get("/coding/patch-history/:histId/export"'),
      src.indexOf('router.get("/coding/patch-history/:histId/export"') + 4000
    );
    assert(/const ROOT = req\.safeQueryCwd \|\| path\.join\(__dirname, "\.\.\/\.\.\/"\);/.test(exportSection),
      "the export route derives ROOT from req.safeQueryCwd (the sanitized value), matching every other query-cwd route in this file");
    assert(!/const ROOT = req\.query\.cwd/.test(exportSection),
      "the old, unsanitized req.query.cwd read is gone from this route");
  }

  section("Source-shape — a stored appliedFiles entry can no longer escape ROOT via an absolute path or '..'");
  {
    const src = fs.readFileSync(require.resolve("../../backend/routes/codingAssistant.js"), "utf8");
    const exportSection = src.slice(
      src.indexOf('router.get("/coding/patch-history/:histId/export"'),
      src.indexOf('router.get("/coding/patch-history/:histId/export"') + 4000
    );
    assert(/path\.isAbsolute\(rel\)/.test(exportSection) && /rel\.split\(\/\[\\\\\/\]\/\)\.includes\(["']\.\.["']\)/.test(exportSection),
      "the export loop now rejects an absolute or '..'-containing appliedFiles entry (checked per path segment) rather than trusting it as a literal path");
    assert(!/path\.isAbsolute\(rel\) \? rel : path\.join\(ROOT, rel\)/.test(exportSection),
      "the old ternary that let an absolute rel bypass ROOT entirely is gone");
  }

  section("The underlying cwdSafety.safeCwd() helper this route now routes through correctly rejects a sensitive root for a non-operator");
  {
    const { safeCwd } = require("../../backend/utils/cwdSafety.cjs");
    const nonOperatorReq = { user: { role: "member" } };
    const operatorReq    = { user: { role: "operator" } };

    assert(safeCwd("/etc", nonOperatorReq) === null,
      "a non-operator's cwd is rejected outright — exactly the value this route's vulnerability would have allowed through unchecked");
    assert(safeCwd("/etc", operatorReq) === null,
      "even an operator cannot use a hardcoded sensitive root like /etc");
    assert(safeCwd(undefined, nonOperatorReq) === undefined,
      "an absent cwd is passed through as absent (falls back to the route's own default project root), not rejected");
  }

  section("Regression — the router-level middleware that stashes req.safeQueryCwd for every route is unaffected");
  {
    const src = fs.readFileSync(require.resolve("../../backend/routes/codingAssistant.js"), "utf8");
    assert(/req\.safeQueryCwd = _safeCwd\(req\.query\.cwd, req\);/.test(src),
      "the shared middleware that populates req.safeQueryCwd for every route in this file is unchanged");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
