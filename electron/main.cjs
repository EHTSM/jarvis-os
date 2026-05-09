"use strict";
/**
 * Electron Main Process — UI shell only.
 * Loads /frontend React app (localhost:3000 in dev, frontend/build in prod).
 * All business logic lives in the Node.js backend on port 5050.
 */

const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path  = require("path");
const axios = require("axios");

let isDev = false;
try { isDev = require("electron-is-dev"); } catch { isDev = !app.isPackaged; }

const API_URL = "http://localhost:5050";

let mainWindow     = null;
let floatingWindow = null;

// ── Window creation ────────────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1400,
        height: 900,
        minWidth:  1000,
        minHeight: 700,
        webPreferences: {
            preload:            path.join(__dirname, "preload.cjs"),
            nodeIntegration:    false,
            contextIsolation:   true,
            enableRemoteModule: false
        }
    });

    // Dev  → always http://localhost:3000  (run: npm run frontend)
    // Prod → file:// is required for packaged Electron; run: npm run build:frontend first
    const url = isDev
        ? "http://localhost:3000"
        : `file://${path.join(__dirname, "..", "frontend", "build", "index.html")}`;

    mainWindow.loadURL(url);
    if (isDev) mainWindow.webContents.openDevTools();
    mainWindow.on("closed", () => { mainWindow = null; });
}

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
        { label: "Help", submenu: [{ label: "About JARVIS", click: () => {} }] }
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
    const url = isDev
        ? "http://localhost:3000"
        : `file://${path.join(__dirname, "..", "frontend", "build", "index.html")}`;
    floatingWindow.loadURL(url);
    floatingWindow.show();
    floatingWindow.on("closed", () => { floatingWindow = null; });
});

// ── Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => { createWindow(); createMenu(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate",          () => { if (!mainWindow) createWindow(); });

// Poll backend health every 5s — tell React if it goes offline
setInterval(async () => {
    try { await axios.get(`${API_URL}/health`, { timeout: 3000 }); }
    catch { mainWindow?.webContents.send("server-disconnected"); }
}, 5000);
