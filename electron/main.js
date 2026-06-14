"use strict";
/**
 * Electron Main Process — Production-grade Ooplix shell.
 * Loads /frontend React app (localhost:3000 in dev, frontend/build in prod).
 * All business logic lives in the Node.js backend on port 5050.
 */

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeTheme, shell, dialog, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// ── Constants ────────────────────────────────────────────────────────────────
const IS_DEV = !app.isPackaged;
const FRONTEND_URL = IS_DEV ? 'http://localhost:3000' : `file://${path.join(__dirname, '../frontend/build/index.html')}`;
const APP_NAME = 'Ooplix';
const WINDOW_STATE_KEY = 'windowState';

// ── Single instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── State ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Window management ───────────────────────────────────────────────────────
function getWindowState(store) {
  // Default: 80% of primary display
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay().workAreaSize;
  return store.get(WINDOW_STATE_KEY, {
    width:  Math.round(primary.width  * 0.82),
    height: Math.round(primary.height * 0.88),
    x: undefined,
    y: undefined,
    isMaximized: false,
  });
}

function createMainWindow() {
  // Use electron-store if available, else plain object
  let store;
  try { store = new (require('electron-store'))(); }
  catch { store = { get: (k, d) => d, set: () => {} }; }

  const state = getWindowState(store);

  mainWindow = new BrowserWindow({
    width:  state.width,
    height: state.height,
    x:      state.x,
    y:      state.y,
    minWidth:  900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    backgroundColor: '#03050a',
    show: false,
    icon: path.join(__dirname, '../frontend/public/favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: !IS_DEV,
    },
  });

  // Restore maximized state
  if (state.isMaximized) mainWindow.maximize();

  // Show when ready — prevents white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Persist window state
  const saveState = () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    store.set(WINDOW_STATE_KEY, {
      ...b,
      isMaximized: mainWindow.isMaximized(),
    });
  };

  mainWindow.on('resize', saveState);
  mainWindow.on('move',   saveState);

  // Close → hide to tray (macOS), quit on others unless tray exists
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      if (process.platform === 'darwin' || tray) {
        e.preventDefault();
        mainWindow.hide();
        return;
      }
    }
    saveState();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Crash + unresponsive recovery (preserved from existing main.cjs) ──────
  let rendererCrashCount = 0;
  const MAX_RENDERER_CRASHES = 3;
  const CRASH_RESET_MS = 60_000;

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    const reason = details?.reason ?? 'unknown';
    console.error(`[Electron] Renderer gone: ${reason}`);
    if (reason === 'clean-exit') return;
    rendererCrashCount++;
    if (rendererCrashCount <= MAX_RENDERER_CRASHES) {
      console.warn(`[Electron] Renderer crash #${rendererCrashCount} — reloading`);
      setTimeout(() => { try { mainWindow?.reload(); } catch {} }, 1000);
    } else {
      console.error(`[Electron] Renderer crashed ${rendererCrashCount} times — showing error page`);
      mainWindow?.loadURL(`data:text/html,<h2 style="font-family:monospace;padding:2rem">Ooplix renderer crashed too many times.<br><br>Restart the application.</h2>`);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => { rendererCrashCount = 0; }, CRASH_RESET_MS);
    mainWindow?.webContents.send('runtime-ready', { startupMs: Date.now(), buildOk: true });
  });

  mainWindow.on('unresponsive', () => {
    console.warn('[Electron] Renderer unresponsive — attempting recovery');
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 5000);
  });

  // ── Memory pressure monitor ───────────────────────────────────────────────
  const LOW_MEM_MB = 350;
  const memCheck = setInterval(() => {
    const heapMb = process.memoryUsage().heapUsed / 1_048_576;
    if (heapMb > LOW_MEM_MB) {
      mainWindow?.webContents.send('low-memory', { heapMb: Math.round(heapMb) });
      try { if (typeof global.gc === 'function') global.gc(); } catch {}
    }
  }, 30_000);
  mainWindow.on('closed', () => clearInterval(memCheck));

  // ── Sleep/wake recovery ───────────────────────────────────────────────────
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => {
      mainWindow?.webContents.send('system-resume', { sleepDurationMs: 0 });
    });
    powerMonitor.on('network-change', () => {
      mainWindow?.webContents.send('network-change');
    });
  } catch { /* powerMonitor unavailable in some envs */ }

  if (IS_DEV) {
    mainWindow.loadURL(FRONTEND_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '../frontend/build/index.html'),
      { query: { desktop: '1' } }
    );
  }

  return mainWindow;
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../frontend/public',
    process.platform === 'darwin' ? 'tray-icon-template.png' : 'favicon.png'
  );

  try {
    tray = new Tray(iconPath);
  } catch {
    // Icon missing — skip tray in dev
    if (IS_DEV) return;
  }

  const updateTrayMenu = (agentCount = 0, online = false) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Ooplix',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: online
          ? `${agentCount} agent${agentCount !== 1 ? 's' : ''} running`
          : 'Runtime offline',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Ooplix',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: showWindow,
      },
      {
        label: 'Command Palette',
        accelerator: 'CmdOrCtrl+K',
        click: () => {
          showWindow();
          mainWindow?.webContents.send('ipc:open-palette');
        },
      },
      {
        label: 'New Task',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => {
          showWindow();
          mainWindow?.webContents.send('ipc:new-task');
        },
      },
      { type: 'separator' },
      {
        label: 'Emergency Stop',
        click: () => {
          mainWindow?.webContents.send('ipc:emergency-stop');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Ooplix',
        accelerator: 'CmdOrCtrl+Q',
        click: quitApp,
      },
    ]);

    tray.setContextMenu(menu);
  };

  tray.setToolTip('Ooplix — AI Operating System');
  updateTrayMenu();

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  // Expose update function
  tray._update = updateTrayMenu;
}

// ── App menu ─────────────────────────────────────────────────────────────────
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('ipc:open-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, accelerator: 'CmdOrCtrl+Q', click: quitApp },
      ],
    }] : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'New Task',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('ipc:new-task'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('ipc:open-palette'),
        },
        {
          label: 'Command Center',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'home'),
        },
        {
          label: 'Intelligence',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'intelligence'),
        },
        {
          label: 'Engineering',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'engineering'),
        },
        {
          label: 'Contacts',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'clients'),
        },
        {
          label: 'Payments',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'payments'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn',  accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Runtime
    {
      label: 'Runtime',
      submenu: [
        {
          label: 'Emergency Stop',
          accelerator: 'CmdOrCtrl+Shift+.',
          click: () => mainWindow?.webContents.send('ipc:emergency-stop'),
        },
        {
          label: 'Resume Execution',
          accelerator: 'CmdOrCtrl+Shift+/',
          click: () => mainWindow?.webContents.send('ipc:emergency-resume'),
        },
        { type: 'separator' },
        {
          label: 'Show Health Report',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'reliability'),
        },
        {
          label: 'Open Execution Log',
          click: () => mainWindow?.webContents.send('ipc:navigate', 'execution'),
        },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : []),
      ],
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://docs.ooplix.com'),
        },
        {
          label: 'Check for Updates…',
          click: () => autoUpdater.checkForUpdatesAndNotify(),
        },
        { type: 'separator' },
        {
          label: 'Open Dev Tools',
          accelerator: isMac ? 'CmdOrCtrl+Option+I' : 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC handlers ─────────────────────────────────────────────────────────────
function setupIPC() {
  // Renderer → main: update tray status
  ipcMain.on('app:tray-update', (_e, { agentCount, online }) => {
    tray?._update?.(agentCount, online);
  });

  // Renderer → main: send native notification
  ipcMain.on('app:notify', (_e, { title, body, silent }) => {
    if (Notification.isSupported() && !mainWindow?.isFocused()) {
      new Notification({ title: title ?? APP_NAME, body, silent }).show();
    }
  });

  // Renderer → main: open external URL
  ipcMain.handle('app:open-url', (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false };
    shell.openExternal(url);
    return { ok: true };
  });

  // Renderer → main: get platform info
  ipcMain.handle('app:platform', () => ({
    platform: process.platform,
    version:  app.getVersion(),
    isDev:    IS_DEV,
    appName:  APP_NAME,
  }));

  // Renderer → main: window controls (for custom titlebar on Windows/Linux)
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close',    () => mainWindow?.close());
  ipcMain.on('window:hide',     () => mainWindow?.hide());

  // Second instance — focus existing window
  app.on('second-instance', () => showWindow());

  // ── Legacy IPC handlers (preserved from existing main.cjs) ───────────────
  const fs = require('fs');
  const axios = require('axios');
  const API_URL = 'http://localhost:5050';

  const _RENDERER_CRASH_LOG = path.join(app.getPath('userData'), 'renderer_crashes.json');
  const MAX_RENDERER_CRASH_LOG = 20;

  ipcMain.handle('report-renderer-crash', (_e, report) => {
    try {
      let log = [];
      try { log = JSON.parse(fs.readFileSync(_RENDERER_CRASH_LOG, 'utf8')); } catch {}
      if (!Array.isArray(log)) log = [];
      log.unshift({
        ts:      new Date().toISOString(),
        source:  (report?.source  || 'unknown').slice(0, 60),
        message: (report?.message || '').slice(0, 200),
        stack:   (report?.stack   || '').slice(0, 800),
        url:     (report?.url     || '').slice(0, 200),
      });
      if (log.length > MAX_RENDERER_CRASH_LOG) log.length = MAX_RENDERER_CRASH_LOG;
      fs.writeFileSync(_RENDERER_CRASH_LOG, JSON.stringify(log, null, 2));
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle('get-renderer-crashes', () => {
    try {
      const log = JSON.parse(fs.readFileSync(_RENDERER_CRASH_LOG, 'utf8'));
      return { ok: true, crashes: Array.isArray(log) ? log : [] };
    } catch { return { ok: true, crashes: [] }; }
  });

  ipcMain.handle('send-command', async (_e, command) => {
    try {
      const r = await axios.post(`${API_URL}/jarvis`, { input: command, mode: 'smart' }, { timeout: 30000 });
      return { success: true, data: r.data };
    } catch (err) {
      return { success: false, error: err.message, details: err.response?.data };
    }
  });

  ipcMain.handle('get-evolution-score', async () => {
    try { const r = await axios.get(`${API_URL}/evolution/score`, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('get-suggestions', async () => {
    try { const r = await axios.get(`${API_URL}/evolution/suggestions`, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('approve-suggestion', async (_e, id) => {
    try { const r = await axios.post(`${API_URL}/evolution/approve/${id}`, {}, { timeout: 5000 }); return { success: true, data: r.data }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('get-server-health', async () => {
    try { await axios.get(`${API_URL}/health`, { timeout: 3000 }); return { success: true, isHealthy: true }; }
    catch { return { success: false, isHealthy: false }; }
  });

  // Firebase OAuth external URL opener
  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false };
    shell.openExternal(url);
    return { ok: true };
  });
}

// ── Auto updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (IS_DEV) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('ipc:update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('ipc:update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater]', err.message);
  });

  // Check on startup after a delay
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 10_000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showWindow() {
  if (!mainWindow) { createMainWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  buildAppMenu();
  createMainWindow();
  createTray();
  setupIPC();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') quitApp();
});

app.on('before-quit', () => { isQuitting = true; });
