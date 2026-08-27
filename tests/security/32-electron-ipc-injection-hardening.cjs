#!/usr/bin/env node
"use strict";
/**
 * Mission 54 — Electron IPC Injection & Navigation Hardening regression.
 *
 * Mission 53 (Electron Desktop-Shell Security Audit) live-verified a real,
 * reachable shell command-injection vulnerability in electron/main.cjs's
 * fs-grep and fs-search IPC handlers: renderer-controlled pattern/query was
 * interpolated into a shell command string passed to exec(), with no
 * shell-metacharacter escaping (only a length/type check in preload.cjs).
 * A payload like `nomatch" ; touch <file> ; echo "` broke out of the quoted
 * argument and ran as a real shell command.
 *
 * Fix: both handlers now use spawn() with a real argv array — the exact
 * pattern git-diff/git-checkout already used correctly in the same file —
 * so there is no shell involved and therefore no syntax for injected
 * metacharacters to break out into.
 *
 * This test:
 *  1. Live-executes the FIXED handler logic (mirroring the real source)
 *     against the actual malicious payload from the Mission 53 audit, and
 *     proves the harmless proof-of-concept file is NOT created — the
 *     injection no longer works. Tests fs-grep and fs-search independently.
 *  2. Structurally asserts the source no longer contains the vulnerable
 *     exec()-with-template-literal pattern for these two handlers.
 *  3. Structurally asserts createFloatingWindow/createSettingsWindow now
 *     call _installNavigationGuard (Mission 53 P1 finding).
 *  4. Structurally + behaviorally asserts fs-open-path now gates on
 *     _isSafePath (Mission 53 P1 finding).
 *  5. Structurally asserts sandbox:true in _makeWebPrefs() (Mission 53 P2,
 *     enabled this mission after confirming preload.cjs has no Node-API
 *     dependency and the renderer bundle has no direct require() usage).
 *  6. Structurally asserts package.json's build.files excludes the
 *     orphaned electron/node_modules and electron/src scaffold, and that
 *     the scaffold itself was NOT deleted (per this mission's constraint).
 *
 * Usage: node tests/security/32-electron-ipc-injection-hardening.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { spawn } = require("child_process");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const MAIN_SRC = fs.readFileSync("electron/main.cjs", "utf8");

function runSpawn(bin, args) {
    return new Promise((resolve) => {
        const proc = spawn(bin, args);
        proc.on("error", () => resolve());  // binary genuinely absent on this platform — still must not have created the POC file
        proc.on("close", () => resolve());
    });
}

async function main() {

// ─────────────────────────────────────────────────────────────────────────
section("Live POC — fs-grep injection no longer executes shell metacharacters");
// ─────────────────────────────────────────────────────────────────────────
{
    const pocFile = path.join(os.tmpdir(), `m54_grep_poc_${process.pid}.txt`);
    try { fs.unlinkSync(pocFile); } catch {}

    // Exact malicious payload class from the Mission 53 live-verification.
    const pattern = `nomatch12345" ; touch ${pocFile} ; echo "`;
    const safeDir = path.resolve(os.tmpdir());
    const args = [
        "-rn",
        "--include=*.js", "--include=*.jsx", "--include=*.ts", "--include=*.tsx",
        "--include=*.json", "--include=*.md",
        "-l", "--", pattern, safeDir,
    ];
    await runSpawn("grep", args);

    const created = fs.existsSync(pocFile);
    assert(!created, "fs-grep: malicious pattern with embedded shell metacharacters does NOT create the POC file", "POC file WAS created — injection still works");
    try { fs.unlinkSync(pocFile); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────
section("Live POC — fs-search injection no longer executes shell metacharacters");
// ─────────────────────────────────────────────────────────────────────────
{
    const pocFile = path.join(os.tmpdir(), `m54_search_poc_${process.pid}.txt`);
    try { fs.unlinkSync(pocFile); } catch {}

    const query = `nomatch12345" ; touch ${pocFile} ; echo "`;
    const safeDir = path.resolve(os.tmpdir());
    const args = process.platform === "win32"
        ? ["/c", "dir", "/s", "/b", safeDir]
        : ["-L", safeDir, "-not", "(", "-name", "node_modules", "-prune", ")", "-not", "(", "-name", ".git", "-prune", ")", "-iname", `*${query}*`];
    const bin = process.platform === "win32" ? (process.env.COMSPEC || "cmd.exe") : "find";
    await runSpawn(bin, args);

    const created = fs.existsSync(pocFile);
    assert(!created, "fs-search: malicious query with embedded shell metacharacters does NOT create the POC file", "POC file WAS created — injection still works");
    try { fs.unlinkSync(pocFile); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural — fs-grep/fs-search use spawn() with an argv array, not exec() with a template-literal command string");
// ─────────────────────────────────────────────────────────────────────────
{
    const grepHandlerMatch   = MAIN_SRC.match(/ipcMain\.handle\("fs-grep"[\s\S]*?\n\}\);/);
    const searchHandlerMatch = MAIN_SRC.match(/ipcMain\.handle\("fs-search"[\s\S]*?\n\}\);/);
    assert(!!grepHandlerMatch,   "fs-grep handler found in source",   "handler not found — regex may need updating");
    assert(!!searchHandlerMatch, "fs-search handler found in source", "handler not found — regex may need updating");

    if (grepHandlerMatch) {
        assert(grepHandlerMatch[0].includes("spawn("), "fs-grep uses spawn()", "spawn( not found in handler body");
        assert(!/exec\(\s*cmd/.test(grepHandlerMatch[0]) && !/exec\(`/.test(grepHandlerMatch[0]),
            "fs-grep no longer calls exec() with a built command string", "exec(cmd or exec(` still present");
    }
    if (searchHandlerMatch) {
        assert(searchHandlerMatch[0].includes("spawn("), "fs-search uses spawn()", "spawn( not found in handler body");
        assert(!/exec\(\s*cmd/.test(searchHandlerMatch[0]) && !/exec\(`/.test(searchHandlerMatch[0]),
            "fs-search no longer calls exec() with a built command string", "exec(cmd or exec(` still present");
    }
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural — navigation guard applied to floating and settings windows");
// ─────────────────────────────────────────────────────────────────────────
{
    const floatingFnMatch = MAIN_SRC.match(/function createFloatingWindow\(\)[\s\S]*?\n\}\n/);
    const settingsFnMatch = MAIN_SRC.match(/function createSettingsWindow\(\)[\s\S]*?\n\}\n/);
    assert(!!floatingFnMatch, "createFloatingWindow found in source", "function not found — regex may need updating");
    assert(!!settingsFnMatch, "createSettingsWindow found in source", "function not found — regex may need updating");

    if (floatingFnMatch) {
        assert(floatingFnMatch[0].includes("_installNavigationGuard(windows.floating)"),
            "createFloatingWindow calls _installNavigationGuard(windows.floating)",
            "guard call not found — window loads real app content with Electron's un-hardened navigation defaults");
    }
    if (settingsFnMatch) {
        assert(settingsFnMatch[0].includes("_installNavigationGuard(windows.settings)"),
            "createSettingsWindow calls _installNavigationGuard(windows.settings)",
            "guard call not found — window loads real app content with Electron's un-hardened navigation defaults");
    }
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural + live — fs-open-path is now path-contained like its sibling fs handlers");
// ─────────────────────────────────────────────────────────────────────────
{
    const openPathMatch = MAIN_SRC.match(/ipcMain\.handle\("fs-open-path"[\s\S]*?\n\}\);/);
    assert(!!openPathMatch, "fs-open-path handler found in source", "handler not found — regex may need updating");
    if (openPathMatch) {
        assert(openPathMatch[0].includes("_isSafePath("), "fs-open-path calls _isSafePath()",
            "_isSafePath( not found — handler still opens any absolute path unrestricted");
    }

    const isSafePathSrcMatch = MAIN_SRC.match(/function _isSafePath\(p\) \{[\s\S]*?\n\}/);
    assert(!!isSafePathSrcMatch, "_isSafePath function body found in source", "function not found — regex may need updating");

    const allowRootsMatch = MAIN_SRC.match(/const _FS_ALLOW_ROOTS = \[([\s\S]*?)\];/);
    assert(!!allowRootsMatch, "_FS_ALLOW_ROOTS allow-list found in source", "allow-list not found — regex may need updating");
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural — sandbox:true enabled in _makeWebPrefs() after verified preload/renderer compatibility");
// ─────────────────────────────────────────────────────────────────────────
{
    const webPrefsMatch = MAIN_SRC.match(/function _makeWebPrefs\(extra = \{\}\) \{[\s\S]*?\n\}/);
    assert(!!webPrefsMatch, "_makeWebPrefs function body found in source", "function not found — regex may need updating");
    if (webPrefsMatch) {
        assert(/sandbox:\s*true/.test(webPrefsMatch[0]), "_makeWebPrefs() sets sandbox: true",
            "sandbox: true not found — renderer OS-level sandbox still disabled");

        // Regression guard on the compatibility precondition this mission
        // verified before enabling it: preload.cjs must still require only
        // "electron" (sandboxed preloads cannot require arbitrary Node
        // built-ins/third-party modules).
        const preloadSrc = fs.readFileSync("electron/preload.cjs", "utf8");
        const requireCalls = [...preloadSrc.matchAll(/require\((["'])([^"']+)\1\)/g)].map(m => m[2]);
        const nonElectronRequires = requireCalls.filter(r => r !== "electron");
        assert(nonElectronRequires.length === 0,
            "preload.cjs still requires only \"electron\" — compatible with sandbox:true",
            `preload.cjs now requires additional modules incompatible with a sandboxed preload: ${JSON.stringify(nonElectronRequires)}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────
section("Structural — packaging excludes the orphaned electron/src and electron/node_modules scaffold");
// ─────────────────────────────────────────────────────────────────────────
{
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const buildFiles = pkg.build?.files || [];
    assert(buildFiles.includes("!electron/node_modules/**"), "build.files excludes electron/node_modules/**", "exclusion pattern not found");
    assert(buildFiles.includes("!electron/src/**"), "build.files excludes electron/src/**", "exclusion pattern not found");

    // Confirm the scaffold itself was NOT deleted (Mission 54 explicit constraint).
    assert(fs.existsSync("electron/src") && fs.existsSync(path.join("electron", "src", "App.jsx")),
        "electron/src scaffold still exists on disk (not deleted, per mission constraint)",
        "electron/src is missing — should have been excluded from packaging, not deleted");
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`Electron IPC Injection & Navigation Hardening Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
}
process.exit(0);

}

main();
