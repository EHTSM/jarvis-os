"use strict";
/**
 * ODI-1 Visual Capture Engine
 *
 * Captures screenshots from three sources:
 *   - Playwright browser page (existing browserSession)
 *   - Electron desktop (via window.electronAPI if present)
 *   - Browser viewport (Playwright full-page or cropped)
 *
 * All screenshots are written to data/odi/screenshots/ with ISO-8601 timestamps
 * and metadata sidecar JSON.  Returns the path + metadata to the caller.
 */

const fs   = require("fs");
const path = require("path");
const { assertSafeNavigationTarget } = require("../utils/urlSafety.cjs");

const SCREENSHOTS_DIR = path.join(__dirname, "../../data/odi/screenshots");

function _ensureDir() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

function _getSession() {
  try { return require("../../agents/browser/browserSession.cjs"); }
  catch { return null; }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _slug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function _writeScreenshot(buffer, meta) {
  _ensureDir();
  const slug     = _slug();
  const filename = `screenshot-${slug}.png`;
  const metaname = `screenshot-${slug}.json`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  const metapath = path.join(SCREENSHOTS_DIR, metaname);

  fs.writeFileSync(filepath, buffer);
  fs.writeFileSync(metapath, JSON.stringify(meta, null, 2));

  return {
    filename,
    path:      filepath,
    metaPath:  metapath,
    sizeBytes: buffer.length,
    sizeKb:    Math.round(buffer.length / 1024),
    timestamp: meta.timestamp,
  };
}

function _relPath(absPath) {
  // Return path relative to project root for API responses
  return absPath.replace(path.join(__dirname, "../../"), "");
}

// ── capture from a live Playwright page ──────────────────────────────────────

async function captureFromPage({ pageId, fullPage = false, url } = {}) {
  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };

  let page, pid;

  if (pageId) {
    page = session.getPage(pageId);
    if (!page) return { ok: false, error: `Page ${pageId} not found` };
    pid = pageId;
  } else {
    if (!session.isRunning()) {
      const launch = await session.launch({ headless: true });
      if (!launch.ok) return { ok: false, error: `Browser launch failed: ${launch.error}` };
    }
    const r = await session.newPage();
    if (!r.ok) return { ok: false, error: r.error };
    pid  = r.pageId;
    page = r.page;

    if (url) {
      const safety = await assertSafeNavigationTarget(url);
      if (!safety.safe) return { ok: false, error: `unsafe navigation target: ${safety.reason}` };
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }); }
      catch (e) { return { ok: false, error: `Navigation failed: ${e.message}` }; }
    }
  }

  let viewport, title, currentUrl;
  try {
    viewport   = page.viewportSize?.() ?? page.viewportSize ?? null;
    title      = await page.title().catch(() => "");
    currentUrl = page.url();
  } catch {
    viewport = null; title = ""; currentUrl = "";
  }

  let buffer;
  try {
    buffer = await page.screenshot({ type: "png", fullPage });
  } catch (e) {
    return { ok: false, error: `Screenshot failed: ${e.message}` };
  }

  const meta = {
    source:    "playwright",
    pageId:    pid,
    url:       currentUrl,
    title,
    fullPage,
    viewport,
    timestamp: new Date().toISOString(),
    capturedAt: Date.now(),
  };

  const saved = _writeScreenshot(buffer, meta);
  return { ok: true, source: "playwright", ...saved, path: _relPath(saved.path), meta };
}

// ── capture from Electron desktop (via IPC) ───────────────────────────────────
// Electron must expose window.electronAPI.captureScreen() which resolves to
// a base64 PNG string.  If not available we return an error rather than crash.

async function captureDesktop({ label } = {}) {
  // Server-side: Electron is the host process — use desktopCapturer if
  // available. Real, confirmed bug: require("electron") does NOT throw in a
  // plain `node` process that merely has the `electron` package installed
  // (a well-known Node/Electron footgun) — it resolves to a STRING (the
  // path to the Electron binary), not the API object, so the old
  // `if (!electron)` check was always false whenever the `electron`
  // package was present in node_modules, regardless of whether this code
  // was actually running inside Electron's main process. Combined with the
  // real architectural fact that the backend runs as a SEPARATE spawned
  // child process in production (electron/main.cjs's
  // spawn(nodeBin, [serverEntry], {stdio:["ignore",...]}), no Node
  // integration into Electron's process, no existing backend→Electron-main
  // IPC channel to reach real desktopCapturer — building one is new
  // architecture, out of scope here) — captureDesktop() was unconditionally
  // broken in every real environment, not just "outside Electron" as
  // originally assumed. Checking for the real API shape (an object with a
  // desktopCapturer property), not just resolution success, and falling
  // back to a real native OS screenshot when it's absent.
  let electron;
  try {
    const e = require("electron");
    if (e && typeof e === "object" && e.desktopCapturer) electron = e;
  } catch { /* not in Electron */ }

  if (electron) {
    let buffer;
    try {
      const { desktopCapturer } = electron;
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1920, height: 1080 } });
      if (!sources.length) return { ok: false, error: "No desktop source found" };

      const thumbnail = sources[0].thumbnail;
      buffer = thumbnail.toPNG();
    } catch (e) {
      return { ok: false, error: `Desktop capture failed: ${e.message}` };
    }

    const meta = {
      source:    "electron-desktop",
      label:     label || "desktop",
      timestamp: new Date().toISOString(),
      capturedAt: Date.now(),
    };

    const saved = _writeScreenshot(buffer, meta);
    return { ok: true, source: "electron-desktop", ...saved, path: _relPath(saved.path), meta };
  }

  return _captureDesktopNative({ label });
}

// ── Native OS screenshot fallback (no Electron process available) ────────────
async function _captureDesktopNative({ label } = {}) {
  const { execFileSync } = require("child_process");
  const os = require("os");
  const platform = process.platform;

  _ensureDir();
  const slug     = _slug();
  const filename = `screenshot-${slug}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  const metaname = `screenshot-${slug}.json`;
  const metapath = path.join(SCREENSHOTS_DIR, metaname);

  try {
    if (platform === "darwin") {
      // -x: no sound, -T 0: no delay. Native macOS CLI, no dependency.
      execFileSync("screencapture", ["-x", "-T", "0", filepath], { timeout: 10_000 });
    } else if (platform === "linux") {
      // Try common Linux screenshot tools in order; none installed is a
      // real, honest failure, not a silent skip.
      const tools = [
        ["gnome-screenshot", ["-f", filepath]],
        ["scrot",            [filepath]],
        ["import",           ["-window", "root", filepath]],  // ImageMagick
      ];
      let captured = false, lastErr = null;
      for (const [bin, args] of tools) {
        try { execFileSync(bin, args, { timeout: 10_000 }); captured = true; break; }
        catch (e) { lastErr = e; }
      }
      if (!captured) return { ok: false, error: `No screenshot tool available (tried gnome-screenshot/scrot/import): ${lastErr?.message || "unknown"}` };
    } else {
      return { ok: false, error: `Native desktop capture not implemented for platform: ${platform}` };
    }
  } catch (e) {
    return { ok: false, error: `Native desktop capture failed: ${e.message}` };
  }

  if (!fs.existsSync(filepath)) return { ok: false, error: "Screenshot command reported success but produced no file" };

  const buffer = fs.readFileSync(filepath);
  const meta = {
    source:    "native-os",
    platform,
    label:     label || "desktop",
    timestamp: new Date().toISOString(),
    capturedAt: Date.now(),
  };
  fs.writeFileSync(metapath, JSON.stringify(meta, null, 2));

  return {
    ok: true, source: "native-os",
    filename, path: _relPath(filepath), metaPath: _relPath(metapath),
    sizeBytes: buffer.length, sizeKb: Math.round(buffer.length / 1024),
    timestamp: meta.timestamp, meta,
  };
}

// ── capture browser viewport (Playwright page opened at a URL) ────────────────

async function captureViewport({ url, width = 1280, height = 900, fullPage = false } = {}) {
  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };

  if (!url) return { ok: false, error: "url required for viewport capture" };
  const safety = await assertSafeNavigationTarget(url);
  if (!safety.safe) return { ok: false, error: `unsafe navigation target: ${safety.reason}` };

  if (!session.isRunning()) {
    const launch = await session.launch({ headless: true });
    if (!launch.ok) return { ok: false, error: `Browser launch failed: ${launch.error}` };
  }

  const r = await session.newPage({ viewport: { width, height } });
  if (!r.ok) return { ok: false, error: r.error };

  const { pageId, page } = r;
  let title, finalUrl;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    title    = await page.title().catch(() => "");
    finalUrl = page.url();
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: `Navigation failed: ${e.message}` };
  }

  let buffer;
  try {
    buffer = await page.screenshot({ type: "png", fullPage });
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: `Screenshot failed: ${e.message}` };
  }

  await session.closePage(pageId).catch(() => {});

  const meta = {
    source:    "viewport",
    url:       finalUrl,
    title,
    viewport:  { width, height },
    fullPage,
    timestamp: new Date().toISOString(),
    capturedAt: Date.now(),
  };

  const saved = _writeScreenshot(buffer, meta);
  return { ok: true, source: "viewport", ...saved, path: _relPath(saved.path), meta };
}

// ── list saved screenshots ────────────────────────────────────────────────────

function listScreenshots({ limit = 50, source } = {}) {
  _ensureDir();
  const files = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const results = [];
  for (const f of files) {
    if (results.length >= limit) break;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(SCREENSHOTS_DIR, f), "utf8"));
      if (source && meta.source !== source) continue;
      const pngFile = f.replace(".json", ".png");
      const pngPath = path.join(SCREENSHOTS_DIR, pngFile);
      results.push({
        filename:  pngFile,
        path:      `data/odi/screenshots/${pngFile}`,
        sizeKb:    fs.existsSync(pngPath) ? Math.round(fs.statSync(pngPath).size / 1024) : null,
        ...meta,
      });
    } catch { /* skip corrupt sidecar */ }
  }

  return results;
}

module.exports = { captureFromPage, captureDesktop, captureViewport, listScreenshots };
