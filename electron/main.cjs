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

// ── Constants ─────────────────────────────────────────────────────
const API_URL        = "http://localhost:5050";
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
        lastTab:         "dashboard",
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
                { label: "Contacts",        accelerator: "CmdOrCtrl+1", click: () => windows.main?.webContents.send("nav", "contacts") },
                { label: "Payments",        accelerator: "CmdOrCtrl+2", click: () => windows.main?.webContents.send("nav", "payments") },
                { label: "Dashboard",       accelerator: "CmdOrCtrl+3", click: () => windows.main?.webContents.send("nav", "dashboard") },
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
setInterval(() => {
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

// ── Backend proxy ─────────────────────────────────────────────────
ipcMain.handle("send-command", async (_e, command) => {
    try {
        const r = await axios.post(`${API_URL}/jarvis`, { input: command, mode: "smart" }, { timeout: 30_000 });
        return { success: true, data: r.data };
    } catch (err) {
        return { success: false, error: err.message, details: err.response?.data };
    }
});

ipcMain.handle("api-request", async (_e, { method = "GET", path: p, body, timeout = 15_000 }) => {
    try {
        const r = await axios({ method, url: `${API_URL}${p}`, data: body, timeout, withCredentials: false });
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
ipcMain.handle("approve-suggestion",   async (_e, id) => { try { return { success: true, data: (await axios.post(`${API_URL}/evolution/approve/${id}`, {}, { timeout: 5_000 })).data }; } catch (e) { return { success: false, error: e.message }; } });

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
ipcMain.handle("fs-read-file", async (_e, { filePath, encoding = "utf8" }) => {
    try {
        const safe = path.resolve(filePath);
        const data = fs.readFileSync(safe, encoding);
        return { ok: true, data };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("fs-write-file", async (_e, { filePath, data }) => {
    try {
        const safe = path.resolve(filePath);
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
// App lifecycle
// ═══════════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
    console.log("[Electron] Booting Ooplix…");

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
});
