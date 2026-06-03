"use strict";
/**
 * Electron Main Process — UI shell only.
 * Loads /frontend React app (localhost:3000 in dev, frontend/build in prod).
 * All business logic lives in the Node.js backend on port 5050.
 */

const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path  = require("path");
const fs    = require("fs");
const axios = require("axios");

const _appStartTs = Date.now();  // Phase 86: startup timing baseline

let isDev = false;
try { isDev = require("electron-is-dev"); } catch { isDev = !app.isPackaged; }

const API_URL = "http://localhost:5050";

let mainWindow     = null;
let floatingWindow = null;

// ── Window creation ────────────────────────────────────────────────
function createWindow() {
    const preloadPath = path.join(__dirname, "preload.cjs");
    console.log("[Electron] Preload path:", preloadPath);
    
    mainWindow = new BrowserWindow({
        width:  1400,
        height: 900,
        minWidth:  1000,
        minHeight: 700,
        webPreferences: {
            preload:            preloadPath,
            nodeIntegration:    false,
            contextIsolation:   true,
            enableRemoteModule: false
        }
    });

    // Dev  → loadURL to localhost:3000 with ?desktop=1 query param
    // Prod → loadFile via Electron's built-in method (cross-platform safe: works on
    //         Windows, macOS, Linux — avoids file:// + query string encoding issues).
    //         query: { desktop: "1" } is passed as the query string by loadFile.
    if (isDev) {
        mainWindow.loadURL("http://localhost:3000?desktop=1");
    } else {
        mainWindow.loadFile(
            path.join(__dirname, "..", "frontend", "build", "index.html"),
            { query: { desktop: "1" } }
        );
    }
    if (isDev) mainWindow.webContents.openDevTools();
    mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Phase 73: Renderer crash reporting IPC ───────────────────────
// Renderer calls window.electron.reportCrash({ source, message, stack }) via preload.
// Main writes the report to userData/renderer_crashes.json (ring buffer, max 20).
const _RENDERER_CRASH_LOG = path.join(app.getPath("userData"), "renderer_crashes.json");
const MAX_RENDERER_CRASH_LOG = 20;

ipcMain.handle("report-renderer-crash", (_e, report) => {
  try {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(_RENDERER_CRASH_LOG, "utf8")); } catch {}
    if (!Array.isArray(log)) log = [];
    log.unshift({
      ts:      new Date().toISOString(),
      source:  (report?.source  || "unknown").slice(0, 60),
      message: (report?.message || "").slice(0, 200),
      stack:   (report?.stack   || "").slice(0, 800),
      url:     (report?.url     || "").slice(0, 200),
    });
    if (log.length > MAX_RENDERER_CRASH_LOG) log.length = MAX_RENDERER_CRASH_LOG;
    fs.writeFileSync(_RENDERER_CRASH_LOG, JSON.stringify(log, null, 2));
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle("get-renderer-crashes", () => {
  try {
    const log = JSON.parse(fs.readFileSync(_RENDERER_CRASH_LOG, "utf8"));
    return { ok: true, crashes: Array.isArray(log) ? log : [] };
  } catch { return { ok: true, crashes: [] }; }
});

// ── App menu ───────────────────────────────────────────────────────
function createMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: "File",
            submenu: [{ label: "Exit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() }]
        },
        {
            label: "View",
            submenu: [
                { label: "Toggle Floating Window", accelerator: "CmdOrCtrl+Shift+F",
                  click: () => mainWindow?.webContents.send("toggle-floating-window") },
                { type: "separator" },
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" }
            ]
        },
        { label: "Help", submenu: [
            { label: "About JARVIS", click: () => {
                const { dialog } = require("electron");
                dialog.showMessageBox(mainWindow, {
                    type: "info", title: "JARVIS",
                    message: "JARVIS OS",
                    detail: "AI-powered sales automation.\nOperator console for WhatsApp & Telegram workflows."
                });
            }},
            { type: "separator" },
            { label: "Open DevTools", accelerator: "F12", click: () => mainWindow?.webContents.toggleDevTools() }
        ]}
    ]));
}

// ── IPC handlers — proxy all calls to backend at :5050 ────────────
ipcMain.handle("send-command", async (_e, command) => {
    try {
        const r = await axios.post(`${API_URL}/jarvis`, { input: command, mode: "smart" }, { timeout: 30000 });
        return { success: true, data: r.data };
    } catch (err) {
        return { success: false, error: err.message, details: err.response?.data };
    }
});

ipcMain.handle("get-evolution-score", async () => {
    try { const r = await axios.get(`${API_URL}/evolution/score`, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle("get-suggestions", async () => {
    try { const r = await axios.get(`${API_URL}/evolution/suggestions`, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle("approve-suggestion", async (_e, id) => {
    try { const r = await axios.post(`${API_URL}/evolution/approve/${id}`, {}, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle("get-server-health", async () => {
    try { await axios.get(`${API_URL}/health`, { timeout: 3000 }); return { success: true, isHealthy: true }; }
    catch { return { success: false, isHealthy: false }; }
});

ipcMain.handle("create-floating-window", () => {
    if (floatingWindow) { floatingWindow.focus(); return; }
    floatingWindow = new BrowserWindow({
        width: 350, height: 480, resizable: true,
        alwaysOnTop: true, show: false,
        webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true }
    });
    if (isDev) {
        floatingWindow.loadURL("http://localhost:3000?desktop=1");
    } else {
        floatingWindow.loadFile(
            path.join(__dirname, "..", "frontend", "build", "index.html"),
            { query: { desktop: "1" } }
        );
    }
    floatingWindow.show();
    floatingWindow.on("closed", () => { floatingWindow = null; });
});

// ── Renderer crash recovery ────────────────────────────────────────
// If the renderer process crashes (OOM, JS error, GPU hang), reload it
// automatically rather than leaving operator with a blank window.
// Tracks consecutive crashes to avoid infinite reload loops.
let _rendererCrashCount = 0;
const MAX_RENDERER_CRASHES = 3;
const CRASH_RESET_MS       = 60_000;   // reset counter after 60s clean run

function _attachCrashHandlers(win) {
  win.webContents.on("render-process-gone", (_e, details) => {
    const reason = details?.reason ?? "unknown";
    console.error(`[Electron] Renderer gone: ${reason}`);

    // Clean exits (navigation, normal close) — don't count as crash
    if (reason === "clean-exit") return;

    _rendererCrashCount++;
    if (_rendererCrashCount <= MAX_RENDERER_CRASHES) {
      console.warn(`[Electron] Renderer crash #${_rendererCrashCount} — reloading`);
      setTimeout(() => { try { win.reload(); } catch {} }, 1000);
    } else {
      console.error(`[Electron] Renderer crashed ${_rendererCrashCount} times — showing error page`);
      win.loadURL(`data:text/html,<h2 style="font-family:monospace;padding:2rem">JARVIS renderer crashed too many times.<br><br>Restart the application.</h2>`);
    }
  });

  // Reset counter after a clean run
  win.webContents.on("did-finish-load", () => {
    setTimeout(() => { _rendererCrashCount = 0; }, CRASH_RESET_MS);
  });

  // Unresponsive renderer — show warning, attempt recovery
  win.on("unresponsive", () => {
    console.warn("[Electron] Renderer unresponsive — attempting recovery");
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 5000);
  });
}

// ── Low-memory restart mode ───────────────────────────────────────
// If process memory exceeds LOW_MEM_MB, tell the renderer to reduce
// render load by sending a "low-memory" IPC event, then attempt GC.
const LOW_MEM_MB       = 350;
const LOW_MEM_CHECK_MS = 30_000;

setInterval(() => {
  const heapMb = process.memoryUsage().heapUsed / 1_048_576;
  if (heapMb > LOW_MEM_MB) {
    mainWindow?.webContents.send("low-memory", { heapMb: Math.round(heapMb) });
    try { if (typeof global.gc === "function") global.gc(); } catch {}
  }
}, LOW_MEM_CHECK_MS);

// ── Electron startup safe-mode ────────────────────────────────────
// Tracks consecutive failed loads. After 3 failures:
//   - Clears Electron session cache (may be corrupted)
//   - Falls back to safe-mode URL (health check endpoint)
const { session } = require("electron");
const _ELECTRON_CRASH_FILE = path.join(app.getPath("userData"), "startup_crash_count.json");

let _electronCrashCount = 0;
try {
  const data = JSON.parse(fs.readFileSync(_ELECTRON_CRASH_FILE, "utf8"));
  _electronCrashCount = data.count || 0;
} catch {}

function _electronStartupOk() {
  _electronCrashCount = 0;
  try { fs.writeFileSync(_ELECTRON_CRASH_FILE, JSON.stringify({ count: 0 })); } catch {}
}

function _electronStartupFailed() {
  _electronCrashCount++;
  try { fs.writeFileSync(_ELECTRON_CRASH_FILE, JSON.stringify({ count: _electronCrashCount, ts: new Date().toISOString() })); } catch {}
}

async function _clearSessionCache() {
  try { await session.defaultSession.clearCache(); } catch {}
  try { await session.defaultSession.clearStorageData({ storages: ["appcache","cookies","localstorage","shadercache","websql","serviceworkers","cachestorage"] }); } catch {}
}

// ── Phase 71: Build validation pre-check ─────────────────────────
// Before creating the window, verify the frontend build exists in prod.
// If missing, show an actionable error rather than a blank/broken load.
function _validateBuild() {
  if (isDev) return { ok: true };
  const buildIndex = path.join(__dirname, "..", "frontend", "build", "index.html");
  if (!fs.existsSync(buildIndex)) {
    return { ok: false, message: "Frontend build not found. Run: npm run build:frontend" };
  }
  return { ok: true };
}

// ── Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log("[Electron] Booting...");
  
  // Phase 71: pre-check build before creating window
  const buildCheck = _validateBuild();
  if (!buildCheck.ok) {
    const { dialog } = require("electron");
    // Show dialog on next tick so app is fully ready
    setTimeout(() => {
      dialog.showErrorBox("JARVIS Startup Error", buildCheck.message);
    }, 100);
  }

  // If prior boots failed repeatedly, clear cache before loading
  if (_electronCrashCount >= 2) {
    console.warn(`[Electron] ${_electronCrashCount} prior startup failures — clearing session cache`);
    await _clearSessionCache();
  }

  createWindow();
  createMenu();
  if (mainWindow) {
    _attachCrashHandlers(mainWindow);

    // Track clean load vs failure
    mainWindow.webContents.once("did-finish-load", () => {
      _electronStartupOk();
      // Phase 86/100: emit startup-success with timing so renderer can validate
      const startupMs = Date.now() - _appStartTs;
      mainWindow.webContents.send("runtime-ready", { startupMs, buildOk: buildCheck.ok });
      mainWindow.webContents.send("startup-success", { startupMs });
    });

    // If load fails (e.g. frontend build missing), show a safe fallback page
    mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDesc, url) => {
      _electronStartupFailed();
      console.error(`[Electron] load failed: ${errorDesc} (${errorCode}) url=${url} failures=${_electronCrashCount}`);
      if (_electronCrashCount >= 3) {
        mainWindow.loadURL(`data:text/html,<body style="font-family:monospace;padding:2rem;background:#111;color:#eee"><h2>JARVIS failed to load</h2><p>Error: ${errorDesc}</p><p>Crash count: ${_electronCrashCount}</p><p>Try: restart the app, or run <code>npm run build:frontend</code> first.</p></body>`);
      }
    });
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate",          () => { if (!mainWindow) createWindow(); });

// Poll backend health — 5s when window visible, 60s when hidden (idle memory reduction)
let _healthInterval = null;
let _healthFast     = true;

function _startHealthPoll(fast) {
    if (_healthInterval) clearInterval(_healthInterval);
    _healthFast     = fast;
    _healthInterval = setInterval(async () => {
        try { await axios.get(`${API_URL}/health`, { timeout: 3000 }); }
        catch { mainWindow?.webContents.send("server-disconnected"); }
    }, fast ? 5_000 : 60_000);
}
_startHealthPoll(true);

// Slow down when window is hidden, speed up when it comes back
app.on("browser-window-blur",  () => { if (_healthFast)  _startHealthPoll(false); });
app.on("browser-window-focus", () => { if (!_healthFast) _startHealthPoll(true);  });

// ── Phase 109: Sleep/wake recovery ───────────────────────────────
// On system resume (sleep/wake), kick the renderer to reconcile state.
// The SSE stream and polling intervals may have drifted; a soft reload prompt
// lets the operator recover without losing work.
try {
  const { powerMonitor } = require("electron");
  let _lastSleepTs = 0;

  powerMonitor.on("suspend", () => {
    _lastSleepTs = Date.now();
    console.log("[Electron] System suspending — pausing health poll");
    if (_healthInterval) { clearInterval(_healthInterval); _healthInterval = null; }
  });

  powerMonitor.on("resume", () => {
    const sleepDurationMs = Date.now() - _lastSleepTs;
    console.log(`[Electron] System resumed after ${Math.round(sleepDurationMs / 1000)}s sleep`);
    // Restart health polling
    _startHealthPoll(true);
    // Tell renderer to reconcile — SSE may be stale after sleep
    mainWindow?.webContents.send("system-resume", { sleepDurationMs });
    // If sleep was >15min, attempt GC to free any accumulated pressure
    if (sleepDurationMs > 15 * 60_000) {
      try { if (typeof global.gc === "function") global.gc(); } catch {}
    }
  });

  // Network state changes — renderer should know to re-check SSE
  powerMonitor.on("network-change", () => {
    mainWindow?.webContents.send("network-change");
  });
} catch { /* powerMonitor unavailable in some envs */ }

// ── Phase 102: Renderer memory pressure — idle suspension ────────
// When the window has been hidden (minimized/backgrounded) for >5min,
// tell the renderer to reduce its polling footprint.
let _hiddenSinceTs = 0;
app.on("browser-window-hide", () => { _hiddenSinceTs = Date.now(); });
app.on("browser-window-show", () => {
  if (_hiddenSinceTs && Date.now() - _hiddenSinceTs > 5 * 60_000) {
    // Long hide — tell renderer to reconcile state on return
    mainWindow?.webContents.send("window-restored");
  }
  _hiddenSinceTs = 0;
});
