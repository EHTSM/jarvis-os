"use strict";
/**
 * Ooplix Electron Main Process — production shell.
 *
 * Features:
 *   - Multi-window management (main + floating + splash)
 *   - System tray with context menu
 *   - Native notifications
 *   - Auto updater (electron-updater)
 *   - Deep link handling (ooplix://)
 *   - Global keyboard shortcuts
 *   - Window state persistence (electron-store)
 *   - Native menus (full macOS + Windows/Linux)
 *   - IPC bridge to backend :5050
 *   - Offline detection + local cache header injection
 *   - Native file system access
 *   - Native clipboard read/write
 *   - Terminal spawn (pty-free shell exec)
 *   - Background service health watchdog
 *   - Crash recovery + safe-mode boot
 *   - Sleep/wake reconciliation
 *   - Low-memory signal
 */

const {
    app, BrowserWindow, Menu, Tray, Notification,
    ipcMain, shell, clipboard, dialog, globalShortcut,
    nativeImage, session, powerMonitor, screen,
    net,
} = require("electron");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");
const { exec, spawn } = require("child_process");
const axios   = require("axios");

// ── Packages ──────────────────────────────────────────────────────
let autoUpdater, Store;
try { autoUpdater = require("electron-updater").autoUpdater; } catch { autoUpdater = null; }
try { Store = require("electron-store"); } catch { Store = null; }

// ── Dev detection ─────────────────────────────────────────────────
const _appStartTs = Date.now();
let isDev = false;
try { isDev = require("electron-is-dev"); } catch { isDev = !app.isPackaged; }

// ── Production API URL resolution ─────────────────────────────────
// Priority: BACKEND_URL env var → packaged default (localhost:5050, backend
// spawned by Electron) → dev fallback (localhost:5050).
// In packaged builds the backend Express server is launched as a child process
// (see _startBackend below), so localhost:5050 remains correct even in prod.
// To point at Ooplix.com cloud API instead, set BACKEND_URL=https://api.ooplix.com
const API_URL = process.env.BACKEND_URL
    ? process.env.BACKEND_URL.replace(/\/$/, "")
    : "http://localhost:5050";
const DEEP_LINK_SCHEME = "ooplix";
const PRELOAD        = path.join(__dirname, "preload.cjs");
const ICON_PATH      = path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : "icon.png");
const TRAY_ICON_PATH = path.join(__dirname, "assets", "icon.png"); // png for tray on all platforms

// ── Persistent store (window state, prefs, cache) ─────────────────
const store = Store ? new Store({
    name: "ooplix-state",
    defaults: {
        windowBounds:    { x: undefined, y: undefined, width: 1400, height: 900 },
        isMaximized:     false,
        theme:           "dark",
        notifications:   true,
        trayOnClose:     true,
        lastTab:         "home",
        offlineCache:    {},
        updateChannel:   "latest",
    }
}) : { get: (k, d) => d, set: () => {}, store: {} };

// ── Window registry ───────────────────────────────────────────────
const windows = {
    main:      null,
    floating:  null,
    splash:    null,
    settings:  null,
};

let tray        = null;
let isQuitting  = false;

// ── Crash tracking ────────────────────────────────────────────────
const CRASH_FILE = path.join(app.getPath("userData"), "startup_crashes.json");
const RENDERER_CRASH_FILE = path.join(app.getPath("userData"), "renderer_crashes.json");

function _loadCrashCount() {
    try { return JSON.parse(fs.readFileSync(CRASH_FILE, "utf8")).count || 0; } catch { return 0; }
}
function _saveCrashCount(n) {
    try { fs.writeFileSync(CRASH_FILE, JSON.stringify({ count: n, ts: new Date().toISOString() })); } catch {}
}

let _startupCrashes = _loadCrashCount();

// ── Single-instance lock ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

app.on("second-instance", (_e, argv) => {
    // Focus existing window when user opens a second instance
    if (windows.main) {
        if (windows.main.isMinimized()) windows.main.restore();
        windows.main.focus();
    }
    // Handle deep link from second instance (Windows/Linux)
    const url = argv.find(a => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (url) _handleDeepLink(url);
});

// ── Deep link protocol ────────────────────────────────────────────
if (!app.isDefaultProtocolClient(DEEP_LINK_SCHEME)) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

function _handleDeepLink(url) {
    try {
        const parsed = new URL(url);
        const route  = parsed.hostname + (parsed.pathname || "");
        const params = Object.fromEntries(parsed.searchParams.entries());
        windows.main?.webContents.send("deep-link", { url, route, params });
        windows.main?.focus();
    } catch (e) {
        console.warn("[Electron] Invalid deep link:", url, e.message);
    }
}

// macOS: open-url event
app.on("open-url", (e, url) => {
    e.preventDefault();
    _handleDeepLink(url);
});

// ── Window state helpers ──────────────────────────────────────────
function _saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
        if (!win.isMaximized() && !win.isMinimized()) {
            store.set("windowBounds", win.getBounds());
        }
        store.set("isMaximized", win.isMaximized());
    } catch {}
}

function _restoreWindowBounds() {
    const bounds     = store.get("windowBounds", { width: 1400, height: 900 });
    const isMaximized = store.get("isMaximized", false);

    // Verify the saved position is still on a visible display
    const displays = screen.getAllDisplays();
    const onScreen = displays.some(d =>
        bounds.x !== undefined &&
        bounds.x >= d.bounds.x &&
        bounds.y >= d.bounds.y &&
        bounds.x < d.bounds.x + d.bounds.width &&
        bounds.y < d.bounds.y + d.bounds.height
    );

    return {
        x:          onScreen ? bounds.x : undefined,
        y:          onScreen ? bounds.y : undefined,
        width:      bounds.width  || 1400,
        height:     bounds.height || 900,
        isMaximized,
    };
}

// ── Window factory ────────────────────────────────────────────────
function _makeWebPrefs(extra = {}) {
    return {
        preload:             PRELOAD,
        nodeIntegration:     false,
        contextIsolation:    true,
        enableRemoteModule:  false,
        webSecurity:         true,
        ...extra,
    };
}

function _loadApp(win, queryExtra = {}) {
    const query = { desktop: "1", ...queryExtra };
    if (isDev) {
        const qs = new URLSearchParams(query).toString();
        win.loadURL(`http://localhost:3000?${qs}`);
    } else {
        win.loadFile(
            path.join(__dirname, "..", "frontend", "build", "index.html"),
            { query }
        );
    }
}

// ── Splash screen ─────────────────────────────────────────────────
function createSplash() {
    windows.splash = new BrowserWindow({
        width:           420,
        height:          280,
        frame:           false,
        transparent:     true,
        alwaysOnTop:     true,
        skipTaskbar:     true,
        resizable:       false,
        webPreferences:  { nodeIntegration: false, contextIsolation: true },
    });
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#fff;border-radius:12px;overflow:hidden;border:1px solid #222">
    <div style="font-size:2.5rem;font-weight:800;letter-spacing:-1px;color:#10b981">Ooplix</div>
    <div style="margin-top:12px;font-size:0.85rem;color:#6b7280">Loading…</div>
    <div style="margin-top:24px;width:180px;height:3px;background:#1f2937;border-radius:99px;overflow:hidden">
        <div id="bar" style="height:100%;width:0%;background:#10b981;border-radius:99px;transition:width 0.3s"></div>
    </div>
    <script>let p=0;const bar=document.getElementById('bar');const iv=setInterval(()=>{p=Math.min(p+(Math.random()*8+2),90);bar.style.width=p+'%';if(p>=90)clearInterval(iv)},120);</script>
    </body></html>`;
    windows.splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return windows.splash;
}

// ── Main window ───────────────────────────────────────────────────
function createMainWindow() {
    const { x, y, width, height, isMaximized } = _restoreWindowBounds();

    const buildOk = _validateBuild();

    windows.main = new BrowserWindow({
        x, y, width, height,
        minWidth:  900,
        minHeight: 600,
        show:      false,
        icon:      ICON_PATH,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
        webPreferences: _makeWebPrefs(),
    });

    if (isMaximized) windows.main.maximize();

    _loadApp(windows.main);

    if (isDev) windows.main.webContents.openDevTools();

    // Show only after paint (avoids white flash)
    windows.main.once("ready-to-show", () => {
        if (windows.splash && !windows.splash.isDestroyed()) {
            setTimeout(() => {
                windows.splash?.close();
                windows.splash = null;
                windows.main.show();
            }, 600);
        } else {
            windows.main.show();
        }
    });

    // Save state on move/resize
    windows.main.on("resize", () => _saveWindowState(windows.main));
    windows.main.on("move",   () => _saveWindowState(windows.main));

    // Tray-on-close: minimise to tray instead of quitting (if enabled)
    windows.main.on("close", (e) => {
        _saveWindowState(windows.main);
        if (!isQuitting && store.get("trayOnClose", true) && tray) {
            e.preventDefault();
            windows.main.hide();
            if (process.platform === "darwin") app.dock.hide();
        }
    });

    windows.main.on("closed", () => { windows.main = null; });

    // Navigation guard: prevent external navigation, block window.open
    _installNavigationGuard(windows.main);

    // Load fail / crash handlers
    _attachCrashHandlers(windows.main);

    windows.main.webContents.once("did-finish-load", () => {
        _saveCrashCount(0);
        const startupMs = Date.now() - _appStartTs;
        windows.main?.webContents.send("runtime-ready",    { startupMs, buildOk: buildOk.ok });
        windows.main?.webContents.send("startup-success",  { startupMs });
    });

    windows.main.webContents.on("did-fail-load", (_e, code, desc, url) => {
        _startupCrashes++;
        _saveCrashCount(_startupCrashes);
        console.error(`[Electron] Load failed: ${desc} (${code}) url=${url}`);
        if (_startupCrashes >= 3) {
            windows.main?.loadURL(`data:text/html,<body style="font-family:monospace;padding:2rem;background:#111;color:#eee"><h2>Ooplix failed to load</h2><p>${desc}</p><p>Crash count: ${_startupCrashes}</p><p>Run <code>npm run build:frontend</code> and restart.</p></body>`);
        }
    });

    return windows.main;
}

// ── Floating always-on-top window ─────────────────────────────────
function createFloatingWindow() {
    if (windows.floating && !windows.floating.isDestroyed()) {
        windows.floating.focus();
        return windows.floating;
    }

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

    windows.floating = new BrowserWindow({
        width:       360,
        height:      520,
        x:           sw - 380,
        y:           sh - 560,
        resizable:   true,
        alwaysOnTop: true,
        frame:       false,
        skipTaskbar: true,
        show:        false,
        webPreferences: _makeWebPrefs(),
    });

    _loadApp(windows.floating, { mode: "floating" });
    windows.floating.once("ready-to-show", () => windows.floating.show());
    windows.floating.on("closed", () => { windows.floating = null; });

    return windows.floating;
}

// ── Settings window ───────────────────────────────────────────────
function createSettingsWindow() {
    if (windows.settings && !windows.settings.isDestroyed()) {
        windows.settings.focus();
        return windows.settings;
    }

    windows.settings = new BrowserWindow({
        width:       700,
        height:      580,
        resizable:   false,
        parent:      windows.main || undefined,
        modal:       process.platform !== "darwin",
        show:        false,
        webPreferences: _makeWebPrefs(),
    });

    _loadApp(windows.settings, { mode: "settings" });
    windows.settings.once("ready-to-show", () => windows.settings.show());
    windows.settings.on("closed", () => { windows.settings = null; });
    // Remove menu bar in settings window
    windows.settings.setMenuBarVisibility(false);

    return windows.settings;
}

// ── Tray ──────────────────────────────────────────────────────────
function createTray() {
    const img = fs.existsSync(TRAY_ICON_PATH)
        ? nativeImage.createFromPath(TRAY_ICON_PATH).resize({ width: 16, height: 16 })
        : nativeImage.createEmpty();

    tray = new Tray(img);
    tray.setToolTip("Ooplix");

    function buildTrayMenu() {
        return Menu.buildFromTemplate([
            { label: "Open Ooplix", click: () => _showMain() },
            { label: "Floating Widget", click: () => createFloatingWindow() },
            { type: "separator" },
            {
                label: "Notifications",
                type: "checkbox",
                checked: store.get("notifications", true),
                click: (item) => store.set("notifications", item.checked),
            },
            {
                label: "Minimize to Tray on Close",
                type: "checkbox",
                checked: store.get("trayOnClose", true),
                click: (item) => store.set("trayOnClose", item.checked),
            },
            { type: "separator" },
            { label: "Check for Updates", click: () => _checkUpdates(true) },
            { type: "separator" },
            { label: "Quit Ooplix", click: () => { isQuitting = true; app.quit(); } },
        ]);
    }

    tray.setContextMenu(buildTrayMenu());

    tray.on("click", () => {
        if (windows.main?.isVisible()) {
            windows.main.hide();
            if (process.platform === "darwin") app.dock.hide();
        } else {
            _showMain();
        }
    });

    tray.on("double-click", () => _showMain());

    // Rebuild menu when prefs change so checkmarks stay in sync
    store.onDidAnyChange?.(() => tray?.setContextMenu(buildTrayMenu()));

    return tray;
}

function _showMain() {
    if (!windows.main || windows.main.isDestroyed()) {
        createMainWindow();
    } else {
        windows.main.show();
        if (windows.main.isMinimized()) windows.main.restore();
        windows.main.focus();
    }
    if (process.platform === "darwin") app.dock.show();
}

// ── Native menu ───────────────────────────────────────────────────
function createMenu() {
    const isMac = process.platform === "darwin";

    const macAppMenu = isMac ? [{
        label: app.name,
        submenu: [
            { role: "about" },
            { type: "separator" },
            { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => createSettingsWindow() },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
        ],
    }] : [];

    const template = [
        ...macAppMenu,
        {
            label: "File",
            submenu: [
                {
                    label: "New Contact…",
                    accelerator: "CmdOrCtrl+N",
                    click: () => windows.main?.webContents.send("menu-action", "new-contact"),
                },
                {
                    label: "Import Contacts…",
                    click: () => _importContacts(),
                },
                { type: "separator" },
                {
                    label: "Export Contacts…",
                    click: () => windows.main?.webContents.send("menu-action", "export-contacts"),
                },
                { type: "separator" },
                ...(!isMac ? [
                    { label: "Settings", accelerator: "Ctrl+,", click: () => createSettingsWindow() },
                    { type: "separator" },
                    { role: "quit" },
                ] : []),
            ],
        },
        {
            label: "View",
            submenu: [
                { label: "Contacts",        accelerator: "CmdOrCtrl+1", click: () => windows.main?.webContents.send("nav", "clients") },
                { label: "Payments",        accelerator: "CmdOrCtrl+2", click: () => windows.main?.webContents.send("nav", "payments") },
                { label: "Dashboard",       accelerator: "CmdOrCtrl+3", click: () => windows.main?.webContents.send("nav", "home") },
                { type: "separator" },
                { label: "Floating Widget", accelerator: "CmdOrCtrl+Shift+F", click: () => createFloatingWindow() },
                { type: "separator" },
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            label: "Window",
            submenu: [
                { role: "minimize" },
                { role: "zoom" },
                ...(isMac ? [
                    { type: "separator" },
                    { role: "front" },
                ] : [
                    { role: "close" },
                ]),
            ],
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "Check for Updates",
                    click: () => _checkUpdates(true),
                },
                { type: "separator" },
                {
                    label: "Open Logs Folder",
                    click: () => shell.openPath(app.getPath("logs")),
                },
                {
                    label: "Open Data Folder",
                    click: () => shell.openPath(app.getPath("userData")),
                },
                { type: "separator" },
                {
                    label: "About Ooplix",
                    click: () => {
                        dialog.showMessageBox(windows.main, {
                            type:    "info",
                            title:   "Ooplix",
                            message: `Ooplix v${app.getVersion()}`,
                            detail:  "ALWALIY TECHNOLOGIES PRIVATE LIMITED\n\nAI-powered business automation for Indian freelancers & agencies.",
                            buttons: ["OK"],
                        });
                    },
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Global shortcuts ──────────────────────────────────────────────
function registerGlobalShortcuts() {
    // Toggle main window visibility
    globalShortcut.register("CommandOrControl+Shift+O", () => {
        if (!windows.main || windows.main.isDestroyed()) {
            _showMain();
        } else if (windows.main.isVisible() && windows.main.isFocused()) {
            windows.main.hide();
        } else {
            _showMain();
        }
    });

    // Toggle floating widget
    globalShortcut.register("CommandOrControl+Shift+W", () => {
        if (windows.floating && !windows.floating.isDestroyed() && windows.floating.isVisible()) {
            windows.floating.hide();
        } else {
            createFloatingWindow();
        }
    });

    // Quick command palette
    globalShortcut.register("CommandOrControl+Shift+K", () => {
        _showMain();
        windows.main?.webContents.send("open-command-palette");
    });
}

// ── Native notifications ──────────────────────────────────────────
function _notify(title, body, opts = {}) {
    if (!store.get("notifications", true)) return;
    if (!Notification.isSupported()) return;
    const n = new Notification({
        title,
        body,
        icon:   TRAY_ICON_PATH,
        silent: opts.silent || false,
        ...opts,
    });
    if (opts.onClick) n.on("click", opts.onClick);
    n.show();
    return n;
}

// ── Auto updater ──────────────────────────────────────────────────
function _setupAutoUpdater() {
    if (!autoUpdater || isDev) return;

    autoUpdater.autoDownload    = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.channel         = store.get("updateChannel", "latest");

    autoUpdater.on("checking-for-update", () => {
        windows.main?.webContents.send("update-status", { state: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
        windows.main?.webContents.send("update-status", { state: "available", version: info.version });
        _notify(
            "Update available",
            `Ooplix ${info.version} is ready to download.`,
            { onClick: () => autoUpdater.downloadUpdate() }
        );
    });

    autoUpdater.on("update-not-available", () => {
        windows.main?.webContents.send("update-status", { state: "up-to-date" });
    });

    autoUpdater.on("download-progress", (p) => {
        windows.main?.webContents.send("update-status", {
            state:    "downloading",
            percent:  Math.round(p.percent),
            bytesPerSecond: p.bytesPerSecond,
        });
        windows.main?.setProgressBar(p.percent / 100);
    });

    autoUpdater.on("update-downloaded", (info) => {
        windows.main?.setProgressBar(-1);
        windows.main?.webContents.send("update-status", { state: "downloaded", version: info.version });
        _notify(
            "Update ready",
            `Ooplix ${info.version} will install on next restart.`,
            {
                onClick: () => {
                    isQuitting = true;
                    autoUpdater.quitAndInstall();
                },
            }
        );
    });

    autoUpdater.on("error", (e) => {
        windows.main?.webContents.send("update-status", { state: "error", error: e.message });
    });

    // Check on startup (after 5s delay) and every 4h
    setTimeout(() => autoUpdater.checkForUpdates(), 5_000);
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60_000);
}

function _checkUpdates(manual = false) {
    if (!autoUpdater || isDev) {
        if (manual) dialog.showMessageBox(windows.main, { type: "info", message: "Auto-updater disabled in development." });
        return;
    }
    autoUpdater.checkForUpdates();
}

// ── Crash handlers ────────────────────────────────────────────────
let _rendererCrashCount = 0;
const MAX_RENDERER_CRASHES = 3;

function _attachCrashHandlers(win) {
    win.webContents.on("render-process-gone", (_e, details) => {
        const reason = details?.reason ?? "unknown";
        if (reason === "clean-exit") return;
        _rendererCrashCount++;
        console.error(`[Electron] Renderer gone (${reason}) — crash #${_rendererCrashCount}`);
        if (_rendererCrashCount <= MAX_RENDERER_CRASHES) {
            setTimeout(() => { try { if (!win.isDestroyed()) win.reload(); } catch {} }, 1200);
        } else {
            win.loadURL(`data:text/html,<body style="font-family:monospace;padding:2rem;background:#111;color:#eee"><h2>Ooplix renderer crashed</h2><p>Crash count: ${_rendererCrashCount}</p><p>Restart the application.</p></body>`);
        }
    });

    win.webContents.on("did-finish-load", () => {
        setTimeout(() => { _rendererCrashCount = 0; }, 60_000);
    });

    win.on("unresponsive", () => {
        console.warn("[Electron] Renderer unresponsive — recovery in 5s");
        setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 5_000);
    });
}

// ── Build validation ──────────────────────────────────────────────
function _validateBuild() {
    if (isDev) return { ok: true };
    const idx = path.join(__dirname, "..", "frontend", "build", "index.html");
    return fs.existsSync(idx)
        ? { ok: true }
        : { ok: false, message: "Frontend build not found. Run: npm run build:frontend" };
}

// ── Contact import helper ─────────────────────────────────────────
async function _importContacts() {
    const result = await dialog.showOpenDialog(windows.main, {
        title:       "Import Contacts",
        buttonLabel: "Import",
        filters:     [{ name: "CSV or JSON", extensions: ["csv", "json"] }],
        properties:  ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return;
    const filePath = result.filePaths[0];
    try {
        const content = fs.readFileSync(filePath, "utf8");
        windows.main?.webContents.send("import-contacts", { filePath, content, ext: path.extname(filePath).slice(1) });
    } catch (e) {
        dialog.showErrorBox("Import failed", e.message);
    }
}

// ── Health watchdog ───────────────────────────────────────────────
let _healthInterval = null;
let _healthFast     = true;
let _wasOffline     = false;

function _startHealthPoll(fast) {
    if (_healthInterval) clearInterval(_healthInterval);
    _healthFast     = fast;
    _healthInterval = setInterval(async () => {
        try {
            await axios.get(`${API_URL}/health`, { timeout: 3000 });
            if (_wasOffline) {
                _wasOffline = false;
                windows.main?.webContents.send("backend-online");
            }
        } catch {
            if (!_wasOffline) {
                _wasOffline = true;
                windows.main?.webContents.send("backend-offline");
            }
        }
    }, fast ? 5_000 : 60_000);
}

// ── Low-memory watchdog ───────────────────────────────────────────
const _lowMemInterval = setInterval(() => {
    const heapMb = process.memoryUsage().heapUsed / 1_048_576;
    if (heapMb > 400) {
        windows.main?.webContents.send("low-memory", { heapMb: Math.round(heapMb) });
        try { if (typeof global.gc === "function") global.gc(); } catch {}
    }
}, 30_000);

// ── Sleep/wake ────────────────────────────────────────────────────
try {
    let _sleepTs = 0;
    powerMonitor.on("suspend", () => {
        _sleepTs = Date.now();
        if (_healthInterval) { clearInterval(_healthInterval); _healthInterval = null; }
    });
    powerMonitor.on("resume", () => {
        const elapsed = Date.now() - _sleepTs;
        _startHealthPoll(true);
        windows.main?.webContents.send("system-resume", { sleepDurationMs: elapsed });
        if (elapsed > 15 * 60_000) try { if (typeof global.gc === "function") global.gc(); } catch {}
    });
    powerMonitor.on("network-change", () => windows.main?.webContents.send("network-change"));
} catch {}

// ═══════════════════════════════════════════════════════════════════
// IPC handlers
// ═══════════════════════════════════════════════════════════════════

// ── IPC argument guards ───────────────────────────────────────────
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
function _ipcStr(v, max = 2048) {
    if (typeof v !== "string") throw new TypeError("Expected string");
    if (v.length > max) throw new RangeError("Argument too long");
    return v;
}
function _ipcNum(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new RangeError("Number out of range");
    return n;
}

// ── Backend proxy ─────────────────────────────────────────────────
ipcMain.handle("send-command", async (_e, command) => {
    try {
        if (typeof command !== "string" || command.length > 4096) return { success: false, error: "Invalid command" };
        const r = await axios.post(`${API_URL}/jarvis`, { input: command, mode: "smart" }, { timeout: 30_000 });
        return { success: true, data: r.data };
    } catch (err) {
        return { success: false, error: err.message, details: err.response?.data };
    }
});

ipcMain.handle("api-request", async (_e, opts) => {
    try {
        if (!opts || typeof opts !== "object") return { success: false, error: "Invalid request" };
        const method  = opts.method ?? "GET";
        const p       = opts.path;
        const body    = opts.body;
        const timeout = opts.timeout ?? 15_000;
        if (typeof p !== "string" || !p.startsWith("/") || p.length > 1024) return { success: false, error: "Invalid path" };
        if (!ALLOWED_METHODS.has(String(method).toUpperCase())) return { success: false, error: "Invalid method" };
        if (typeof timeout !== "number" || timeout < 0 || timeout > 120_000) return { success: false, error: "Invalid timeout" };
        const r = await axios({ method: String(method).toUpperCase(), url: `${API_URL}${p}`, data: body, timeout, withCredentials: false });
        return { success: true, status: r.status, data: r.data };
    } catch (err) {
        return { success: false, status: err.response?.status, error: err.message, data: err.response?.data };
    }
});

ipcMain.handle("get-server-health", async () => {
    try { await axios.get(`${API_URL}/health`, { timeout: 3_000 }); return { success: true, isHealthy: true }; }
    catch { return { success: false, isHealthy: false }; }
});

ipcMain.handle("get-evolution-score",  async () => { try { return { success: true, data: (await axios.get(`${API_URL}/evolution/score`,       { timeout: 5_000 })).data }; } catch (e) { return { success: false, error: e.message }; } });
ipcMain.handle("get-suggestions",      async () => { try { return { success: true, data: (await axios.get(`${API_URL}/evolution/suggestions`,  { timeout: 5_000 })).data }; } catch (e) { return { success: false, error: e.message }; } });
ipcMain.handle("approve-suggestion",   async (_e, id) => {
    try {
        if (typeof id !== "string" && typeof id !== "number") return { success: false, error: "Invalid id" };
        const safeId = encodeURIComponent(String(id).slice(0, 128));
        return { success: true, data: (await axios.post(`${API_URL}/evolution/approve/${safeId}`, {}, { timeout: 5_000 })).data };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── Window management ─────────────────────────────────────────────
ipcMain.handle("create-floating-window", () => { createFloatingWindow(); return { ok: true }; });
ipcMain.handle("open-settings",          () => { createSettingsWindow(); return { ok: true }; });
ipcMain.handle("show-main-window",       () => { _showMain(); return { ok: true }; });

ipcMain.handle("window-minimize",  () => windows.main?.minimize());
ipcMain.handle("window-maximize",  () => windows.main?.isMaximized() ? windows.main.unmaximize() : windows.main?.maximize());
ipcMain.handle("window-close",     () => windows.main?.close());
ipcMain.handle("window-is-maximized", () => windows.main?.isMaximized() ?? false);

ipcMain.handle("set-always-on-top", (_e, val) => {
    windows.floating?.setAlwaysOnTop(!!val);
    return { ok: true };
});

// ── Native notifications ──────────────────────────────────────────
ipcMain.handle("show-notification", (_e, { title, body, silent }) => {
    _notify(title || "Ooplix", body || "", { silent: !!silent });
    return { ok: true };
});

// ── Clipboard ─────────────────────────────────────────────────────
ipcMain.handle("clipboard-read",  () => ({ text: clipboard.readText() }));
ipcMain.handle("clipboard-write", (_e, text) => { clipboard.writeText(String(text)); return { ok: true }; });

// ── File system ───────────────────────────────────────────────────
// Restrict file access to paths the user owns — no absolute traversal to /etc, /System etc.
const _FS_ALLOW_ROOTS = [os.homedir(), app.getPath("userData"), app.getPath("downloads"), app.getPath("temp")];
function _isSafePath(p) {
    const resolved = path.resolve(p);
    return _FS_ALLOW_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root);
}

ipcMain.handle("fs-read-file", async (_e, { filePath, encoding = "utf8" }) => {
    try {
        if (typeof filePath !== "string") return { ok: false, error: "Invalid path" };
        const safe = path.resolve(filePath);
        if (!_isSafePath(safe)) return { ok: false, error: "Access denied" };
        const data = fs.readFileSync(safe, encoding === "binary" ? "binary" : "utf8");
        return { ok: true, data };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("fs-write-file", async (_e, { filePath, data }) => {
    try {
        if (typeof filePath !== "string") return { ok: false, error: "Invalid path" };
        const safe = path.resolve(filePath);
        if (!_isSafePath(safe)) return { ok: false, error: "Access denied" };
        fs.mkdirSync(path.dirname(safe), { recursive: true });
        fs.writeFileSync(safe, data);
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("fs-show-open-dialog", async (_e, opts = {}) => {
    const result = await dialog.showOpenDialog(windows.main, {
        properties: ["openFile"],
        ...opts,
    });
    return result;
});

ipcMain.handle("fs-show-save-dialog", async (_e, opts = {}) => {
    const result = await dialog.showSaveDialog(windows.main, opts);
    return result;
});

ipcMain.handle("fs-open-path", async (_e, p) => {
    await shell.openPath(path.resolve(p));
    return { ok: true };
});

ipcMain.handle("fs-get-downloads-path", () => ({ path: app.getPath("downloads") }));
ipcMain.handle("fs-get-home-path",      () => ({ path: os.homedir() }));

// ── Shell exec (terminal integration) ────────────────────────────
// Security: command must be a string; never eval; output capped at 64KB
ipcMain.handle("shell-exec", (_e, { command, cwd }) => {
    return new Promise((resolve) => {
        if (typeof command !== "string" || command.length > 2048) {
            return resolve({ ok: false, error: "Invalid command" });
        }
        const safeCwd = cwd ? path.resolve(cwd) : os.homedir();
        exec(command, { cwd: safeCwd, timeout: 30_000, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
            resolve({
                ok:     !err || err.code === 0,
                stdout: stdout.slice(0, 60_000),
                stderr: stderr.slice(0,  4_000),
                code:   err?.code ?? 0,
            });
        });
    });
});

ipcMain.handle("shell-open-terminal", async () => {
    const cwd = os.homedir();
    if (process.platform === "darwin") {
        exec(`open -a Terminal "${cwd}"`);
    } else if (process.platform === "win32") {
        spawn("cmd.exe", ["/c", "start", "cmd.exe"], { cwd, detached: true, stdio: "ignore" }).unref();
    } else {
        const terms = ["gnome-terminal", "xterm", "konsole", "xfce4-terminal"];
        for (const t of terms) {
            try { spawn(t, [], { cwd, detached: true, stdio: "ignore" }).unref(); break; } catch {}
        }
    }
    return { ok: true };
});

// ── Persistent store (prefs + offline cache) ──────────────────────
ipcMain.handle("store-get", (_e, key) => ({ value: store.get(key) }));
ipcMain.handle("store-set", (_e, { key, value }) => { store.set(key, value); return { ok: true }; });
ipcMain.handle("store-delete", (_e, key) => { store.delete(key); return { ok: true }; });
ipcMain.handle("store-get-all", () => ({ value: store.store }));

// Offline cache: renderer can store JSON blobs keyed by route
ipcMain.handle("cache-set", (_e, { key, data }) => {
    const cache = store.get("offlineCache", {});
    cache[key] = { data, ts: Date.now() };
    // Evict if cache >200 keys
    const keys = Object.keys(cache);
    if (keys.length > 200) {
        keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
            .slice(0, 50)
            .forEach(k => delete cache[k]);
    }
    store.set("offlineCache", cache);
    return { ok: true };
});

ipcMain.handle("cache-get", (_e, key) => {
    const cache = store.get("offlineCache", {});
    return cache[key] || null;
});

ipcMain.handle("cache-clear", () => { store.set("offlineCache", {}); return { ok: true }; });

// ── App info ──────────────────────────────────────────────────────
ipcMain.handle("get-app-info", () => ({
    version:  app.getVersion(),
    name:     app.getName(),
    platform: process.platform,
    arch:     process.arch,
    electron: process.versions.electron,
    node:     process.versions.node,
    isDev,
    userData: app.getPath("userData"),
    logs:     app.getPath("logs"),
}));

// ── Update controls (from renderer) ──────────────────────────────
ipcMain.handle("check-for-updates",   () => { _checkUpdates(true); return { ok: true }; });
ipcMain.handle("download-update",     () => { autoUpdater?.downloadUpdate(); return { ok: true }; });
ipcMain.handle("quit-and-install",    () => { isQuitting = true; autoUpdater?.quitAndInstall(); });

// ── Renderer crash reporting ──────────────────────────────────────
ipcMain.handle("report-renderer-crash", (_e, report) => {
    try {
        let log = [];
        try { log = JSON.parse(fs.readFileSync(RENDERER_CRASH_FILE, "utf8")); } catch {}
        if (!Array.isArray(log)) log = [];
        log.unshift({
            ts:      new Date().toISOString(),
            source:  (report?.source  || "unknown").slice(0, 60),
            message: (report?.message || "").slice(0, 200),
            stack:   (report?.stack   || "").slice(0, 800),
            url:     (report?.url     || "").slice(0, 200),
        });
        if (log.length > 20) log.length = 20;
        fs.writeFileSync(RENDERER_CRASH_FILE, JSON.stringify(log, null, 2));
        return { ok: true };
    } catch { return { ok: false }; }
});

ipcMain.handle("get-renderer-crashes", () => {
    try {
        const log = JSON.parse(fs.readFileSync(RENDERER_CRASH_FILE, "utf8"));
        return { ok: true, crashes: Array.isArray(log) ? log : [] };
    } catch { return { ok: true, crashes: [] }; }
});

// ── External URLs (OAuth, docs) ───────────────────────────────────
ipcMain.handle("open-external", (_e, url) => {
    if (typeof url !== "string" || !url.startsWith("https://")) return { ok: false };
    shell.openExternal(url);
    return { ok: true };
});

// ── Inter-window messaging ────────────────────────────────────────
ipcMain.handle("broadcast", (_e, { channel, data }) => {
    for (const win of Object.values(windows)) {
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, data);
        }
    }
    return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════
// PTY Terminal session manager
// Sessions keyed by sessionId (uuid string from renderer).
// Each session is a node-pty IPty instance.
// Data flows: pty → ipcMain.emit("pty-data:${id}") → BrowserWindow.send
// Input flows: renderer → ipcMain.handle("pty-input") → pty.write
// ═══════════════════════════════════════════════════════════════════

let pty = null;
try { pty = require("node-pty"); } catch (e) { console.warn("[PTY] node-pty not available:", e.message); }

const ptySessions = new Map(); // id → { proc, cwd, shell }

function _shell() {
    if (process.platform === "win32") return process.env.COMSPEC || "cmd.exe";
    return process.env.SHELL || "/bin/bash";
}

ipcMain.handle("pty-create", (event, { id, cwd, cols = 120, rows = 30 }) => {
    if (!pty) return { ok: false, error: "node-pty not available" };
    if (ptySessions.has(id)) return { ok: true, reused: true };

    const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const shell   = _shell();

    let proc;
    try {
        proc = pty.spawn(shell, [], {
            name: "xterm-256color",
            cols, rows,
            cwd:  safeCwd,
            env:  { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        });
    } catch (e) {
        return { ok: false, error: e.message };
    }

    const sender = event.sender;

    proc.onData((data) => {
        if (!sender.isDestroyed()) sender.send(`pty-data:${id}`, data);
    });

    proc.onExit(({ exitCode }) => {
        ptySessions.delete(id);
        if (!sender.isDestroyed()) sender.send(`pty-exit:${id}`, { exitCode });
    });

    ptySessions.set(id, { proc, cwd: safeCwd, shell });
    return { ok: true, shell, cwd: safeCwd };
});

ipcMain.handle("pty-input", (_e, { id, data }) => {
    const s = ptySessions.get(id);
    if (!s) return { ok: false };
    if (typeof data !== "string" || data.length > 65_536) return { ok: false, error: "Invalid input" };
    s.proc.write(data);
    return { ok: true };
});

ipcMain.handle("pty-resize", (_e, { id, cols, rows }) => {
    const s = ptySessions.get(id);
    if (!s) return { ok: false };
    try { s.proc.resize(cols, rows); } catch {}
    return { ok: true };
});

ipcMain.handle("pty-kill", (_e, { id }) => {
    const s = ptySessions.get(id);
    if (!s) return { ok: false };
    try { s.proc.kill(); } catch {}
    ptySessions.delete(id);
    return { ok: true };
});

ipcMain.handle("pty-list", () => {
    return { sessions: [...ptySessions.entries()].map(([id, s]) => ({ id, cwd: s.cwd, shell: s.shell })) };
});

ipcMain.handle("pty-cwd", (_e, { id }) => {
    const s = ptySessions.get(id);
    if (!s) return { cwd: os.homedir() };
    // On macOS/Linux try to read the cwd of the child process via /proc or lsof
    try {
        if (process.platform === "darwin") {
            const { execSync } = require("child_process");
            const out = execSync(`lsof -a -p ${s.proc.pid} -d cwd -Fn 2>/dev/null | grep ^n`).toString().trim();
            const cwd = out.replace(/^n/, "");
            if (cwd) return { cwd };
        }
    } catch {}
    return { cwd: s.cwd };
});

// Clean up all PTY sessions on quit
app.on("before-quit", () => {
    for (const [, s] of ptySessions) {
        try { s.proc.kill(); } catch {}
    }
    ptySessions.clear();
});

// ── Git operations (native shell, no extra deps) ──────────────────
ipcMain.handle("git-status", async (_e, { cwd }) => {
    return new Promise((resolve) => {
        exec("git status --porcelain=v1 -b 2>&1", { cwd: path.resolve(cwd), timeout: 8_000 }, (err, stdout) => {
            if (err && !stdout) return resolve({ ok: false, error: err.message });
            const lines  = stdout.split("\n").filter(Boolean);
            const branch = (lines[0] || "").replace(/^## /, "");
            const files  = lines.slice(1).map(l => ({ code: l.slice(0, 2).trim(), file: l.slice(3) }));
            resolve({ ok: true, branch, files });
        });
    });
});

ipcMain.handle("git-diff", async (_e, { cwd, file }) => {
    return new Promise((resolve) => {
        // Pass file as a separate argv element to avoid shell injection
        const args = file
            ? ["diff", "--", file]
            : ["diff"];
        const proc = spawn("git", args, { cwd: path.resolve(cwd) });
        let stdout = "", stderr = "";
        proc.stdout.on("data", d => { stdout += d; });
        proc.stderr.on("data", d => { stderr += d; });
        const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 10_000);
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, diff: stdout.slice(0, 200_000), error: stderr });
        });
    });
});

ipcMain.handle("git-log", async (_e, { cwd, limit = 50 }) => {
    return new Promise((resolve) => {
        const fmt = "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ar%x1f%s";
        exec(`git log ${fmt} -${limit} 2>&1`, { cwd: path.resolve(cwd), timeout: 8_000 }, (err, stdout) => {
            if (err && !stdout) return resolve({ ok: false, commits: [] });
            const commits = stdout.trim().split("\n").filter(Boolean).map(line => {
                const [hash, short, author, email, date, ...msgParts] = line.split("\x1f");
                return { hash, short, author, email, date, message: msgParts.join("\x1f") };
            });
            resolve({ ok: true, commits });
        });
    });
});

ipcMain.handle("git-branches", async (_e, { cwd }) => {
    return new Promise((resolve) => {
        exec("git branch -a --format=%(refname:short) 2>&1", { cwd: path.resolve(cwd), timeout: 5_000 }, (err, stdout) => {
            exec("git branch --show-current 2>&1", { cwd: path.resolve(cwd), timeout: 3_000 }, (_e2, cur) => {
                const branches = stdout.trim().split("\n").filter(Boolean);
                resolve({ ok: !err, branches, current: cur.trim() });
            });
        });
    });
});

ipcMain.handle("git-checkout", async (_e, { cwd, branch }) => {
    return new Promise((resolve) => {
        // spawn with argv array: no shell, no injection risk
        const proc = spawn("git", ["checkout", branch], { cwd: path.resolve(cwd) });
        let out = "";
        proc.stdout.on("data", d => { out += d; });
        proc.stderr.on("data", d => { out += d; });
        const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 15_000);
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, output: out });
        });
    });
});

ipcMain.handle("git-commit", async (_e, { cwd, message }) => {
    return new Promise((resolve) => {
        exec(`git commit -m ${JSON.stringify(message)} 2>&1`, { cwd: path.resolve(cwd), timeout: 15_000 }, (err, stdout, stderr) => {
            resolve({ ok: !err, output: stdout + stderr });
        });
    });
});

// ── File tree (for explorer) ──────────────────────────────────────
ipcMain.handle("fs-read-tree", async (_e, { dir, depth = 3 }) => {
    function readDir(p, d) {
        if (d <= 0) return [];
        let entries;
        try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
        return entries
            .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
            .map(e => {
                const fullPath = path.join(p, e.name);
                const isDir    = e.isDirectory();
                return {
                    name:     e.name,
                    path:     fullPath,
                    isDir,
                    children: isDir ? readDir(fullPath, d - 1) : undefined,
                    ext:      !isDir ? path.extname(e.name).slice(1) : undefined,
                };
            })
            .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    }
    try {
        const safe = path.resolve(dir);
        return { ok: true, tree: readDir(safe, depth), root: safe };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle("fs-search", async (_e, { dir, query, maxResults = 50 }) => {
    return new Promise((resolve) => {
        if (!query || query.length < 2) return resolve({ ok: true, results: [] });
        const cmd = process.platform === "win32"
            ? `dir /s /b "${path.resolve(dir)}" | findstr /i "${query}"`
            : `find "${path.resolve(dir)}" -not \\( -name "node_modules" -prune \\) -not \\( -name ".git" -prune \\) -iname "*${query}*" 2>/dev/null | head -${maxResults}`;
        exec(cmd, { timeout: 8_000, maxBuffer: 256 * 1024 }, (_err, stdout) => {
            const results = stdout.trim().split("\n").filter(Boolean).slice(0, maxResults);
            resolve({ ok: true, results });
        });
    });
});

ipcMain.handle("fs-grep", async (_e, { dir, pattern, maxResults = 100 }) => {
    return new Promise((resolve) => {
        if (!pattern) return resolve({ ok: true, results: [] });
        const cmd = `grep -rn --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" -l "${pattern}" "${path.resolve(dir)}" 2>/dev/null | head -${maxResults}`;
        exec(cmd, { timeout: 10_000, maxBuffer: 256 * 1024 }, (_err, stdout) => {
            const results = stdout.trim().split("\n").filter(Boolean).slice(0, maxResults);
            resolve({ ok: true, results });
        });
    });
});

// ── Screenshot ────────────────────────────────────────────────────
ipcMain.handle("screenshot-window", async () => {
    try {
        const img = await windows.main?.webContents.capturePage();
        if (!img) return { ok: false };
        const png  = img.toPNG();
        const dest = path.join(app.getPath("pictures"), `ooplix-${Date.now()}.png`);
        fs.writeFileSync(dest, png);
        return { ok: true, path: dest };
    } catch (e) { return { ok: false, error: e.message }; }
});

// ── Clipboard history ─────────────────────────────────────────────
const _clipHistory = [];
const MAX_CLIP_HISTORY = 50;

ipcMain.handle("clipboard-push-history", (_e, text) => {
    if (!text || _clipHistory[0] === text) return { ok: true };
    _clipHistory.unshift(text);
    if (_clipHistory.length > MAX_CLIP_HISTORY) _clipHistory.length = MAX_CLIP_HISTORY;
    return { ok: true };
});

ipcMain.handle("clipboard-get-history", () => ({ history: [..._clipHistory] }));
ipcMain.handle("clipboard-clear-history", () => { _clipHistory.length = 0; return { ok: true }; });

// ═══════════════════════════════════════════════════════════════════
// Phase 4 — Native Desktop Enhancements
// ═══════════════════════════════════════════════════════════════════

// ── Dock / taskbar progress ───────────────────────────────────────
ipcMain.handle("dock-set-progress", (_e, { value }) => {
    // value: 0.0–1.0, or -1 to hide. Use setProgressBar on all platforms.
    windows.main?.setProgressBar(typeof value === "number" && value >= 0 ? value : -1);
    return { ok: true };
});

ipcMain.handle("dock-bounce", (_e, { type = "informational" } = {}) => {
    if (process.platform === "darwin") {
        return { id: app.dock?.bounce(type) };
    }
    return { id: null };
});

ipcMain.handle("dock-cancel-bounce", (_e, { id }) => {
    if (process.platform === "darwin" && id != null) app.dock?.cancelBounce(id);
    return { ok: true };
});

ipcMain.handle("taskbar-badge", (_e, { count }) => {
    // macOS: badge on dock icon; Windows: overlay icon
    if (process.platform === "darwin") {
        app.dock?.setBadge(count > 0 ? String(count) : "");
    } else if (process.platform === "win32" && windows.main) {
        if (count > 0) {
            const img = nativeImage.createFromDataURL(
                `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`
            );
            windows.main.setOverlayIcon(img, `${count} notifications`);
        } else {
            windows.main.setOverlayIcon(null, "");
        }
    }
    return { ok: true };
});

// ── Native context menu ───────────────────────────────────────────
ipcMain.handle("show-context-menu", (event, { items = [] }) => {
    const menuItems = items.map(item => {
        if (item.type === "separator") return { type: "separator" };
        return {
            label:   item.label,
            enabled: item.enabled !== false,
            click:   () => {
                event.sender.send("context-menu-action", item.id);
            },
        };
    });
    const menu = Menu.buildFromTemplate(menuItems);
    const win  = BrowserWindow.fromWebContents(event.sender);
    if (win) menu.popup({ window: win });
    return { ok: true };
});

// ── Recent projects (native "Recents" on macOS/Windows) ───────────
const _recentProjects = [];
ipcMain.handle("add-recent-project", (_e, { path: p, name }) => {
    if (p) {
        app.addRecentDocument(p);
        const exists = _recentProjects.findIndex(r => r.path === p);
        if (exists >= 0) _recentProjects.splice(exists, 1);
        _recentProjects.unshift({ path: p, name: name || p.split("/").pop(), ts: Date.now() });
        if (_recentProjects.length > 20) _recentProjects.length = 20;
    }
    return { ok: true };
});
ipcMain.handle("get-recent-projects", () => ({ projects: [..._recentProjects] }));
ipcMain.handle("clear-recent-projects", () => {
    _recentProjects.length = 0;
    app.clearRecentDocuments();
    return { ok: true };
});

// ── Native drag: allow dragging files out of the app ─────────────
ipcMain.on("ondragstart", (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    event.sender.startDrag({
        file: filePath,
        icon: nativeImage.createFromPath(TRAY_ICON_PATH),
    });
});

// ── Multi-monitor: get all display info ───────────────────────────
ipcMain.handle("get-displays", () => {
    const displays = screen.getAllDisplays();
    return { displays: displays.map(d => ({
        id:          d.id,
        bounds:      d.bounds,
        scaleFactor: d.scaleFactor,
        primary:     d.id === screen.getPrimaryDisplay().id,
    })) };
});

ipcMain.handle("move-to-display", (_e, { displayId }) => {
    const win = windows.main;
    if (!win) return { ok: false };
    const display = screen.getAllDisplays().find(d => d.id === displayId);
    if (!display) return { ok: false, error: "Display not found" };
    const { x, y, width, height } = display.bounds;
    win.setPosition(x + Math.floor(width / 2) - 700, y + Math.floor(height / 2) - 450);
    return { ok: true };
});

// ── File associations (open files passed by OS at launch) ─────────
const _pendingOpenFiles = [];
app.on("open-file", (event, path) => {
    event.preventDefault();
    _pendingOpenFiles.push(path);
    if (windows.main?.webContents) {
        windows.main.webContents.send("open-file", path);
    }
});
ipcMain.handle("get-pending-open-files", () => {
    const files = [..._pendingOpenFiles];
    _pendingOpenFiles.length = 0;
    return { files };
});

// ── Performance: startup timing ───────────────────────────────────
ipcMain.handle("get-startup-timing", () => ({
    startTs:  _appStartTs,
    elapsed:  Date.now() - _appStartTs,
    platform: process.platform,
    arch:     process.arch,
    version:  app.getVersion(),
    electron: process.versions.electron,
    node:     process.versions.node,
}));

// ── Resource usage ────────────────────────────────────────────────
ipcMain.handle("get-process-metrics", async () => {
    const metrics = app.getAppMetrics();
    const mem     = process.memoryUsage();
    return {
        processes: metrics.map(m => ({
            pid:    m.pid,
            type:   m.type,
            cpu:    m.cpu,
            memory: m.memory,
        })),
        mainProcess: {
            rss:       mem.rss,
            heapUsed:  mem.heapUsed,
            heapTotal: mem.heapTotal,
            external:  mem.external,
        },
        uptime: process.uptime(),
    };
});

// ── Force GC (V8) — safe to call from renderer ────────────────────
ipcMain.handle("request-gc", () => {
    if (global.gc) {
        global.gc();
        return { ok: true, triggered: true };
    }
    return { ok: true, triggered: false };
});

// ═══════════════════════════════════════════════════════════════════
// Production backend process management
// ═══════════════════════════════════════════════════════════════════

let _backendProc = null;
let _backendReady = false;

function _startBackend() {
    // In dev the backend is started separately (npm start / concurrently).
    // In packaged builds, Electron owns the backend process.
    if (isDev || process.env.BACKEND_URL) return;

    const serverEntry = app.isPackaged
        ? path.join(process.resourcesPath, "app", "backend", "server.js")
        : path.join(__dirname, "..", "backend", "server.js");

    if (!fs.existsSync(serverEntry)) {
        console.warn("[Electron] Backend server.js not found at:", serverEntry);
        return;
    }

    // Packaged builds don't bundle a standalone Node binary. Electron's own
    // executable can run plain Node scripts via ELECTRON_RUN_AS_NODE=1, so
    // reuse it instead of depending on a system-installed `node`.
    const nodeBin = app.isPackaged ? process.execPath : "node";
    const env = {
        ...process.env,
        NODE_ENV:    "production",
        PORT:        "5050",
        ELECTRON_RUN: "1",
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    };

    _backendProc = spawn(nodeBin, [serverEntry], {
        env,
        cwd:   path.dirname(serverEntry),
        stdio: ["ignore", "pipe", "pipe"],
    });

    _backendProc.stdout?.on("data", d => console.log("[Backend]", d.toString().trim()));
    _backendProc.stderr?.on("data", d => console.warn("[Backend:err]", d.toString().trim()));

    _backendProc.on("error", e => console.error("[Backend] spawn error:", e.message));
    _backendProc.on("exit", (code, sig) => {
        console.warn(`[Backend] exited code=${code} sig=${sig}`);
        _backendProc  = null;
        _backendReady = false;
        // Restart after 3s unless app is quitting
        if (!isQuitting) setTimeout(_startBackend, 3_000);
    });

    console.log("[Electron] Backend process started (pid", _backendProc?.pid, ")");
}

function _stopBackend() {
    if (_backendProc && !_backendProc.killed) {
        try { _backendProc.kill("SIGTERM"); } catch {}
        _backendProc = null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Permission handler — block browser-origin requests for camera/mic/geo
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_PERMISSIONS = new Set([
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
]);

function _installPermissionHandler() {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return ALLOWED_PERMISSIONS.has(permission);
    });
}

// ═══════════════════════════════════════════════════════════════════
// CSP + navigation guard
// ═══════════════════════════════════════════════════════════════════

function _installSecurityHeaders() {
    // Inject Content-Security-Policy on all responses
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                "Content-Security-Policy": [
                    [
                        "default-src 'self' http://localhost:5050",
                        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // React needs unsafe-eval in dev
                        "style-src 'self' 'unsafe-inline'",
                        "img-src 'self' data: blob: https:",
                        "connect-src 'self' http://localhost:5050 https://api.ooplix.com wss://api.ooplix.com",
                        "font-src 'self' data:",
                        "worker-src 'self' blob:",
                    ].join("; "),
                ],
            },
        });
    });
}

function _installNavigationGuard(win) {
    // Prevent navigation away from the app origin
    win.webContents.on("will-navigate", (e, url) => {
        const allowed = url.startsWith("http://localhost") ||
                        url.startsWith("file://") ||
                        url.startsWith("data:");
        if (!allowed) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    // Block new-window / window.open to external sites
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://")) shell.openExternal(url);
        return { action: "deny" };
    });
}

// ═══════════════════════════════════════════════════════════════════
// App lifecycle
// ═══════════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
    console.log("[Electron] Booting Ooplix…");

    // Security: install permission + CSP handlers before any window loads
    _installPermissionHandler();
    _installSecurityHeaders();

    // Start bundled backend in production
    _startBackend();

    const buildCheck = _validateBuild();
    if (!buildCheck.ok) {
        setTimeout(() => dialog.showErrorBox("Ooplix Startup Error", buildCheck.message), 100);
    }

    if (_startupCrashes >= 2) {
        console.warn(`[Electron] ${_startupCrashes} prior startup failures — clearing session cache`);
        try {
            await session.defaultSession.clearCache();
            await session.defaultSession.clearStorageData({
                storages: ["appcache", "cookies", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
            });
        } catch {}
    }

    // Splash only in production (dev has fast HMR)
    if (!isDev) createSplash();

    createMainWindow();
    createMenu();
    createTray();
    registerGlobalShortcuts();
    _startHealthPoll(true);
    _setupAutoUpdater();

    app.on("activate", () => {
        if (!windows.main || windows.main.isDestroyed()) createMainWindow();
        else _showMain();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        isQuitting = true;
        app.quit();
    }
});

app.on("before-quit", () => { isQuitting = true; });

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (_healthInterval) clearInterval(_healthInterval);
    clearInterval(_lowMemInterval);
    _stopBackend();
});
