#!/usr/bin/env node
"use strict";
/**
 * Desktop controller command-injection regression — backend/services/desktopController.cjs.
 *
 * Confirmed finding (Zero-Trust Competitor Remediation, Phase 1): every
 * function in this file built a shell command string via template
 * interpolation of caller-supplied values (appName, filePath, clipboard
 * text) and ran it through execSync, which invokes `/bin/sh -c` on the full
 * string. Any authenticated user reaching POST /computer/desktop/launch,
 * /focus, /open, or /clipboard (gated only by requireAuth — no role check)
 * could pass a payload like `appName: 'Foo"; touch /tmp/pwned #'` and
 * achieve arbitrary command execution on the host.
 *
 * Fix: every _exec(shellString) call site was replaced with
 * execFileSync(bin, argvArray) — which never invokes a shell, so shell
 * metacharacters in the argument have no special meaning — plus an
 * allowlist regex on app/window names as defense in depth.
 *
 * This test proves the fix by attempting real injection payloads against
 * the real exported functions (no mocking of child_process) and asserting
 * no shell side effect occurs, on darwin/linux only (the vulnerable code
 * paths are platform-gated; win32 already no-ops).
 *
 * Usage: node tests/security/22-desktop-controller-injection.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const PLATFORM = process.platform;
if (PLATFORM !== "darwin" && PLATFORM !== "linux") {
  console.log(`Skipping — desktopController's shell-exec paths are darwin/linux-only (platform: ${PLATFORM}).`);
  process.exit(0);
}

const dc = require("../../backend/services/desktopController.cjs");

function freshMarker(tag) {
  return path.join(os.tmpdir(), `desktop-ctrl-poc-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
}
function markerExisted(marker) {
  const existed = fs.existsSync(marker);
  if (existed) { try { fs.unlinkSync(marker); } catch { /* best effort cleanup */ } }
  return existed;
}

section("launchApp — shell injection via appName");
{
  const marker = freshMarker("launch");
  const payload = `Foo"; touch ${marker} #`;
  const result = dc.launchApp(payload);
  assert(!markerExisted(marker), "malicious appName does not execute injected command",
    "marker file was created — shell metacharacters were interpreted");
  assert(result.ok === false, "malicious appName is rejected (ok:false)",
    `expected ok:false, got ${JSON.stringify(result)}`);
}

section("launchApp — command substitution / backticks");
{
  const marker = freshMarker("launch-subst");
  const payload = "Foo`touch " + marker + "`";
  dc.launchApp(payload);
  assert(!markerExisted(marker), "backtick command substitution in appName is inert",
    "marker file was created — backtick substitution was interpreted");
}

section("launchApp — pipe to shell");
{
  const marker = freshMarker("launch-pipe");
  const payload = `Foo | touch ${marker}`;
  dc.launchApp(payload);
  assert(!markerExisted(marker), "pipe character in appName is inert",
    "marker file was created — pipe was interpreted by a shell");
}

section("focusWindow — AppleScript/shell injection via appName");
if (PLATFORM === "darwin") {
  const marker = freshMarker("focus");
  const payload = `Foo"; touch ${marker} #`;
  const result = dc.focusWindow(payload);
  assert(!markerExisted(marker), "malicious appName does not execute injected command in focusWindow",
    "marker file was created");
  assert(result.ok === false, "malicious appName is rejected in focusWindow",
    `expected ok:false, got ${JSON.stringify(result)}`);
} else {
  ok("skipped on non-darwin (focusWindow is darwin-only)");
}

section("openPath — shell injection via filePath");
{
  const marker = freshMarker("openpath");
  const payload = `/tmp"; touch ${marker}; echo "`;
  const result = dc.openPath(payload);
  assert(!markerExisted(marker), "malicious filePath does not execute injected command",
    "marker file was created — shell metacharacters were interpreted");
  assert(result.ok === false, "nonexistent literal path is reported as failed, not executed",
    `expected ok:false, got ${JSON.stringify(result)}`);
}

section("clipboardWrite — shell injection via clipboard text");
{
  const marker = freshMarker("clip");
  const payload = `hello"; touch ${marker}; echo "`;
  const result = dc.clipboardWrite(payload);
  assert(!markerExisted(marker), "malicious clipboard text does not execute injected command",
    "marker file was created — clipboard text was interpreted as shell");
  // clipboardWrite is expected to succeed (the literal string IS the clipboard content) —
  // the safety property under test is "no side effect", not "operation rejected".
  assert(typeof result.ok === "boolean", "clipboardWrite returns a well-formed result",
    `expected {ok:boolean,...}, got ${JSON.stringify(result)}`);
}

section("switchWorkspace — direction argument cannot reach a shell string unsanitized");
{
  // direction is constrained to a binary choice inside the function itself
  // (only "right" maps to key 124, everything else — including hostile
  // input — maps to the "left" branch's key 123), so there is no injection
  // surface here; this assertion locks that invariant in place.
  const src = fs.readFileSync(path.join(__dirname, "../../backend/services/desktopController.cjs"), "utf8");
  assert(!/_exec\(`[^`]*\$\{direction/.test(src), "switchWorkspace never interpolates raw `direction` into a shell string",
    "found direct interpolation of `direction` into an exec'd string");
}

section("static analysis — no remaining shell-string exec calls in this file");
{
  const src = fs.readFileSync(path.join(__dirname, "../../backend/services/desktopController.cjs"), "utf8");
  assert(!/execSync\(`/.test(src), "no execSync(`...`) template-string shell invocation remains",
    "found execSync(`...`) — a shell-string call site was reintroduced");
  assert(!src.includes("require(\"child_process\").execSync") || !/execSync\(`/.test(src),
    "no indirect execSync template usage remains", "found an indirect execSync template call");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Desktop Controller Injection Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  process.exit(1);
}
process.exit(0);
