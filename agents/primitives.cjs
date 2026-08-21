"use strict";
/**
 * Execution primitives — single canonical implementation of all OS-level actions.
 *
 * Both pipelines delegate here:
 *   Execution: jarvisController → toolAgent.js      → primitives
 *   Execution: commandParser    → tool.cjs           → primitives
 *   Intel:     executor.cjs     → browserAgent.cjs   → primitives
 *   Intel:     executor.cjs     → desktopAgent.cjs   → primitives
 *
 * terminalAgent.cjs is its own canonical primitive (security whitelist, not here).
 */

const { exec, spawn } = require("child_process");

// Lazy-load robotjs — system works without it
let _robot = null;
try { _robot = require("robotjs"); } catch { /* unavailable */ }

const MAX_TYPE_CHARS = 500;

// Validates any http/https URL before passing to `open`
const SAFE_URL_REGEX = /^https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+$/i;

// Unified key name normalisation for robotjs keyTap
const KEY_MAP = {
    enter: "enter", return: "enter",
    space: "space",
    tab: "tab",
    esc: "escape", escape: "escape",
    delete: "delete", backspace: "backspace",
    up: "up", down: "down", left: "left", right: "right",
    cmd: "command", command: "command",
    ctrl: "control", control: "control",
    alt: "alt", option: "alt",
    shift: "shift",
};

// ── Internal exec helper ─────────────────────────────────────────
function _exec(cmd, timeoutMs = 8000) {
    return new Promise(resolve => {
        exec(cmd, { timeout: timeoutMs }, (err) => {
            if (err) resolve({ success: false, error: err.message });
            else     resolve({ success: true });
        });
    });
}

// Remaining Execution & Tool Authorization Boundary Sweep (2026-08-21):
// openURL/openApp used to build a shell command STRING (`open "${safe}"`,
// interpolated into exec()) — SAFE_URL_REGEX's allowed charset includes
// "$", "(", ")" (needed for legitimate URL characters), which together
// permit real shell command substitution (`$(...)`) that the regex never
// accounted for. Live-reproduced, non-destructively: a url of
// `https://example.com/$(touch$IFS/tmp/PROOF)` passed SAFE_URL_REGEX
// (every individual character is allowed) and genuinely executed `touch`
// via /bin/sh's command substitution when exec() ran the interpolated
// string — $IFS (the shell's field-separator variable) supplies the
// whitespace the payload needs without requiring a literal space
// character. Reachable by any ordinary, authenticated customer via a
// plain chat message ("open https://...") — backend/utils/parser.js's
// raw-URL matcher (line ~154) accepts any http(s):// URL with no
// whitespace and passes it straight through to this function with zero
// further validation. Fixed with the same principle already established
// throughout this codebase this session (safe-exec.js,
// terminalExecutionAdapter.cjs, browserController.cjs's downloadFile
// fix): spawn(shell:false) with an argument array instead of a shell
// string. openApp()'s own regex-strip sanitizer (`;&|`$`) already
// correctly excludes "$", so it was not independently vulnerable to this
// same technique — fixed anyway for consistency and defense-in-depth,
// since it shares the exact same shell-string-construction shape.
function _spawnExec(cmd, args, timeoutMs = 8000) {
    return new Promise(resolve => {
        let settled = false;
        const child = spawn(cmd, args, { shell: false, stdio: "ignore" });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill("SIGKILL"); } catch {}
            resolve({ success: false, error: `timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(code === 0 ? { success: true } : { success: false, error: `exited with code ${code}` });
        });
        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ success: false, error: err.message });
        });
    });
}

// ── openURL ──────────────────────────────────────────────────────
async function openURL(url) {
    if (!url || !SAFE_URL_REGEX.test(url)) {
        return { success: false, error: "URL rejected — unsafe or missing" };
    }
    if (process.platform === "darwin")  return _spawnExec("open", [url]);
    if (process.platform === "win32")   return _spawnExec("cmd.exe", ["/c", "start", "", url]);
    // Linux — headless VPS: no browser, return the URL so the caller can surface it
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return { success: true, message: `URL ready: ${url}`, url, headless: true };
    }
    return _spawnExec("xdg-open", [url]);
}

// ── webSearch ────────────────────────────────────────────────────
async function webSearch(query) {
    if (!query || !query.trim()) return { success: false, error: "Empty search query" };
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const r = await openURL(url);
    return { ...r, url, query };
}

// ── openApp ──────────────────────────────────────────────────────
async function openApp(appName) {
    if (!appName) return { success: false, error: "No app name provided" };
    // Strip shell metacharacters — retained as defense-in-depth even
    // though spawn(shell:false) below no longer depends on it for safety.
    const safe = appName.replace(/"/g, "").replace(/[;&|`$]/g, "");
    if (process.platform === "win32") return _spawnExec("cmd.exe", ["/c", "start", "", safe]);
    if (process.platform !== "darwin") return _spawnExec(safe, []);
    return _spawnExec("open", ["-a", safe]);
}

// ── typeText ─────────────────────────────────────────────────────
async function typeText(text) {
    if (!_robot) return { success: false, error: "robotjs not installed — desktop control unavailable" };
    const safe = (text || "").slice(0, MAX_TYPE_CHARS);
    if (!safe) return { success: false, error: "No text to type" };
    _robot.typeString(safe);
    return { success: true, typed_chars: safe.length };
}

// ── pressKey ─────────────────────────────────────────────────────
async function pressKey(key) {
    if (!_robot) return { success: false, error: "robotjs not installed" };
    const mapped = KEY_MAP[(key || "enter").toLowerCase()] || (key || "enter");
    _robot.keyTap(mapped);
    return { success: true, key: mapped };
}

// ── pressKeyCombo ────────────────────────────────────────────────
// mods: string[] e.g. ["command"], key: string e.g. "c"
async function pressKeyCombo(modifiers, key) {
    if (!_robot) return { success: false, error: "robotjs not installed" };
    const mods = (modifiers || []).map(m => KEY_MAP[m.toLowerCase()] || m.toLowerCase());
    const k    = KEY_MAP[(key || "c").toLowerCase()] || (key || "c");
    _robot.keyTap(k, mods);
    return { success: true, key: k, modifiers: mods };
}

module.exports = { openURL, webSearch, openApp, typeText, pressKey, pressKeyCombo, SAFE_URL_REGEX };
