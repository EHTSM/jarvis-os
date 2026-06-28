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

const { execSync, spawn }  = require("child_process");
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
function _exec(cmd, timeoutMs = 5000) {
  try {
    return { ok: true, out: execSync(cmd, { timeout: timeoutMs, stdio: ["ignore","pipe","pipe"] }).toString().trim() };
  } catch (e) {
    return { ok: false, out: "", error: e.message?.slice(0, 300) };
  }
}

// ── launchApp ─────────────────────────────────────────────────────────────────

function launchApp(appName, opts = {}) {
  if (!appName) return { ok: false, error: "appName required" };

  let result;
  if (PLATFORM === "darwin") {
    result = _exec(`open -a "${appName}"`, 8000);
  } else if (PLATFORM === "linux") {
    result = _exec(`nohup ${appName} &`, 3000);
  } else {
    result = { ok: false, out: "", error: `Platform ${PLATFORM} not supported for launchApp` };
  }

  _le()?.createLesson?.({ type: "desktop_action", title: `launchApp: ${appName}`, source: "desktopController", confidence: result.ok ? 0.9 : 0.4, tags: ["desktop", "launch", appName.toLowerCase().replace(/\s/g,"_")] });

  return { ok: result.ok, app: appName, error: result.error, ts: _ts() };
}

// ── focusWindow ───────────────────────────────────────────────────────────────

function focusWindow(appName) {
  if (PLATFORM === "darwin") {
    const script = `tell application "${appName}" to activate`;
    const r = _exec(`osascript -e '${script}'`, 5000);
    return { ok: r.ok, app: appName, error: r.error };
  }
  return { ok: false, error: `focusWindow not supported on ${PLATFORM}` };
}

// ── openPath ──────────────────────────────────────────────────────────────────

function openPath(filePath) {
  const abs = path.resolve(filePath);
  let r;
  if (PLATFORM === "darwin") r = _exec(`open "${abs}"`, 5000);
  else if (PLATFORM === "linux") r = _exec(`xdg-open "${abs}"`, 5000);
  else r = { ok: false, error: `openPath not supported on ${PLATFORM}` };
  return { ok: r.ok, path: abs, error: r.error };
}

// ── clipboard ────────────────────────────────────────────────────────────────

function clipboardRead() {
  if (PLATFORM === "darwin") {
    const r = _exec("pbpaste", 3000);
    return { ok: r.ok, content: r.out, error: r.error };
  }
  if (PLATFORM === "linux") {
    const r = _exec("xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null", 3000);
    return { ok: r.ok, content: r.out, error: r.error };
  }
  return { ok: false, content: "", error: `clipboardRead not supported on ${PLATFORM}` };
}

function clipboardWrite(text) {
  if (!text) return { ok: false, error: "text required" };
  const escaped = text.replace(/'/g, "'\\''");
  if (PLATFORM === "darwin") {
    const r = _exec(`printf '%s' '${escaped}' | pbcopy`, 3000);
    return { ok: r.ok, error: r.error };
  }
  if (PLATFORM === "linux") {
    const r = _exec(`printf '%s' '${escaped}' | xclip -selection clipboard 2>/dev/null || printf '%s' '${escaped}' | xsel --clipboard --input`, 3000);
    return { ok: r.ok, error: r.error };
  }
  return { ok: false, error: `clipboardWrite not supported on ${PLATFORM}` };
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
    const activeApp = _exec(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, 3000);
    if (activeApp.ok) state.activeApp = activeApp.out;
    const windowTitle = _exec(`osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`, 3000);
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
    const result = await cap.captureDesktop?.(opts) || await cap.captureViewport?.(opts);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── switchWorkspace (macOS: Mission Control spaces) ───────────────────────────

function switchWorkspace(direction = "right") {
  if (PLATFORM === "darwin") {
    const key = direction === "right" ? "right" : "left";
    const r = _exec(`osascript -e 'tell application "System Events" to key code ${key === "right" ? 124 : 123} using control down'`, 3000);
    return { ok: r.ok, direction, error: r.error };
  }
  return { ok: false, error: `switchWorkspace not supported on ${PLATFORM}` };
}

module.exports = {
  launchApp, focusWindow, openPath, switchWorkspace,
  clipboardRead, clipboardWrite,
  readDesktopState, listDownloads, captureScreenshot,
};
