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

const { exec } = require("child_process");

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

// ── openURL ──────────────────────────────────────────────────────
async function openURL(url) {
    if (!url || !SAFE_URL_REGEX.test(url)) {
        return { success: false, error: "URL rejected — unsafe or missing" };
    }
    const safe = url.replace(/"/g, "");
    if (process.platform === "darwin")  return _exec(`open "${safe}"`);
    if (process.platform === "win32")   return _exec(`start "" "${safe}"`);
    // Linux — headless VPS: no browser, return the URL so the caller can surface it
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return { success: true, message: `URL ready: ${url}`, url, headless: true };
    }
    return _exec(`xdg-open "${safe}"`);
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
    // Strip shell metacharacters before building the command
    const safe = appName.replace(/"/g, "").replace(/[;&|`$]/g, "");
    if (process.platform === "win32") return _exec(`start "" "${safe}"`);
    if (process.platform !== "darwin") return _exec(`${safe} &`);
    return _exec(`open -a "${safe}"`);
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
