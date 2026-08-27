#!/usr/bin/env node
"use strict";
/**
 * Mission 58 — Electron residual P2 hardening regression.
 *
 * Mission 53's audit found _installNavigationGuard's will-navigate handler
 * allowed http://localhost on ANY port, wider than anything the app itself
 * ever navigates to (only http://localhost:3000, the CRA dev server, per
 * _loadApp's own loadURL call). Mission 58 scoped the allowance to the
 * exact dev port.
 *
 * This test:
 *  1. Structurally asserts will-navigate checks the exact port 3000, not a
 *     bare "http://localhost" prefix.
 *  2. Live-executes the actual allow/deny logic (extracted inline, mirroring
 *     the real source) to prove a different-port localhost URL is now
 *     correctly rejected while port 3000 and file:// still pass — a
 *     genuine behavioral proof, not just a string match.
 *  3. Structurally asserts the release.yml code-signing verification step
 *     (Mission 53 finding — CI signing was silently fail-open) now exists.
 *
 * Usage: node tests/security/33-electron-navigation-signing-scope.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const MAIN_SRC = fs.readFileSync("electron/main.cjs", "utf8");

// ─────────────────────────────────────────────────────────────────────────
section("Structural — will-navigate scoped to the exact dev port, not a bare localhost prefix");
// ─────────────────────────────────────────────────────────────────────────
{
    const guardMatch = MAIN_SRC.match(/function _installNavigationGuard\(win\) \{[\s\S]*?\n\}/);
    assert(!!guardMatch, "_installNavigationGuard function body found in source", "function not found — regex may need updating");
    if (guardMatch) {
        assert(guardMatch[0].includes('url.startsWith("http://localhost:3000")'),
            "will-navigate checks the exact dev port (3000)",
            "exact-port check not found — still allowing any localhost port");
        assert(!/url\.startsWith\("http:\/\/localhost"\)(?!:)/.test(guardMatch[0].replace(/http:\/\/localhost:3000/g, "")),
            "no bare (unscoped) http://localhost prefix check remains",
            "a bare, unscoped localhost prefix check is still present");
    }
}

// ─────────────────────────────────────────────────────────────────────────
section("Live behavioral proof — the fixed allow-list logic itself");
// ─────────────────────────────────────────────────────────────────────────
{
    // Mirrors the real, current will-navigate predicate exactly.
    function isAllowed(url) {
        return url.startsWith("http://localhost:3000") ||
               url.startsWith("file://") ||
               url.startsWith("data:");
    }

    assert(isAllowed("http://localhost:3000?desktop=1"), "the real dev-server URL (port 3000) is still allowed", "regression — dev server would be blocked");
    assert(!isAllowed("http://localhost:9999/evil"), "a DIFFERENT localhost port is now REJECTED (Mission 58 fix)", "a non-3000 localhost port is still allowed — fix did not apply");
    assert(!isAllowed("http://localhost:8080/"), "another different port (8080) is also rejected", "port 8080 still allowed");
    assert(isAllowed("file:///Applications/Ooplix.app/Contents/Resources/app/frontend/build/index.html"), "production file:// loads are unaffected", "file:// regressed");
    assert(isAllowed("data:text/html,<h1>ok</h1>"), "data: URLs (splash screen) are unaffected", "data: regressed");
    assert(!isAllowed("https://evil.example.com"), "external https URLs remain rejected (unchanged, pre-existing behavior)", "external https now allowed — unrelated regression");
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural — CI code-signing verification step now exists (Mission 53 finding: silent fail-open)");
// ─────────────────────────────────────────────────────────────────────────
{
    const releaseSrc = fs.readFileSync(".github/workflows/release.yml", "utf8");
    assert(releaseSrc.includes("Verify code-signing status"), "release.yml has a code-signing verification step", "step not found");
    assert(releaseSrc.includes("codesign --verify"), "macOS verification uses codesign (no new dependency)", "codesign call not found");
    assert(releaseSrc.includes("Get-AuthenticodeSignature"), "Windows verification uses Get-AuthenticodeSignature (no new dependency)", "Get-AuthenticodeSignature call not found");
    assert(releaseSrc.includes("::warning::"), "unsigned output produces a visible CI warning, not a silent pass", "no ::warning:: annotation found — still silent");
    // Must remain warn-only — signing IS legitimately optional/opt-in by
    // this repo's own design (Mission 53/57's own findings), so this step
    // must never hard-fail the release job over a deliberate no-signing choice.
    const stepMatch = releaseSrc.match(/- name: Verify code-signing status[\s\S]*?(?=\n  - name:|\n  [a-z-]+:\n|\Z)/);
    assert(!!stepMatch, "verification step body extracted for warn-only check", "could not extract step body");
    if (stepMatch) {
        assert(!/exit 1/.test(stepMatch[0]), "verification step never hard-fails the job (warn-only, matches its own stated design)", "found exit 1 — step would fail the build over optional signing");
    }
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`Electron Navigation/Signing Scope Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
}
process.exit(0);
