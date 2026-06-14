"use strict";
/**
 * Ooplix Electron Preload — IPC bridge.
 * Exposes window.electronAPI to the renderer (contextBridge).
 * All methods call ipcRenderer.invoke / ipcRenderer.on only.
 */

const { contextBridge, ipcRenderer } = require("electron");

// ── Safe event listener helper ────────────────────────────────────
// Returns a cleanup function so React components can unsubscribe on unmount.
function _on(channel, cb) {
    const wrapped = (_e, data) => cb(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("electronAPI", {

    // ── Context flag ─────────────────────────────────────────────
    isElectron: true,
    platform:   process.platform,

    // ── Backend proxy ────────────────────────────────────────────
    sendCommand:       (cmd)         => ipcRenderer.invoke("send-command",       cmd),
    apiRequest:        (opts)        => ipcRenderer.invoke("api-request",        opts),
    getServerHealth:   ()            => ipcRenderer.invoke("get-server-health"),
    getEvolutionScore: ()            => ipcRenderer.invoke("get-evolution-score"),
    getSuggestions:    ()            => ipcRenderer.invoke("get-suggestions"),
    approveSuggestion: (id)          => ipcRenderer.invoke("approve-suggestion", id),

    // ── Window management ────────────────────────────────────────
    createFloatingWindow: ()         => ipcRenderer.invoke("create-floating-window"),
    openSettings:         ()         => ipcRenderer.invoke("open-settings"),
    showMainWindow:       ()         => ipcRenderer.invoke("show-main-window"),
    windowMinimize:       ()         => ipcRenderer.invoke("window-minimize"),
    windowMaximize:       ()         => ipcRenderer.invoke("window-maximize"),
    windowClose:          ()         => ipcRenderer.invoke("window-close"),
    windowIsMaximized:    ()         => ipcRenderer.invoke("window-is-maximized"),
    setAlwaysOnTop:       (val)      => ipcRenderer.invoke("set-always-on-top",  val),

    // ── Native notifications ─────────────────────────────────────
    showNotification: (opts)         => ipcRenderer.invoke("show-notification",  opts),

    // ── Clipboard ────────────────────────────────────────────────
    clipboardRead:  ()               => ipcRenderer.invoke("clipboard-read"),
    clipboardWrite: (text)           => ipcRenderer.invoke("clipboard-write",    text),

    // ── File system ──────────────────────────────────────────────
    fsReadFile:       (opts)         => ipcRenderer.invoke("fs-read-file",         opts),
    fsWriteFile:      (opts)         => ipcRenderer.invoke("fs-write-file",        opts),
    fsShowOpenDialog: (opts)         => ipcRenderer.invoke("fs-show-open-dialog",  opts),
    fsShowSaveDialog: (opts)         => ipcRenderer.invoke("fs-show-save-dialog",  opts),
    fsOpenPath:       (p)            => ipcRenderer.invoke("fs-open-path",         p),
    fsGetDownloadsPath: ()           => ipcRenderer.invoke("fs-get-downloads-path"),
    fsGetHomePath:    ()             => ipcRenderer.invoke("fs-get-home-path"),

    // ── Terminal / Shell ─────────────────────────────────────────
    shellExec:        (opts)         => ipcRenderer.invoke("shell-exec",           opts),
    shellOpenTerminal: ()            => ipcRenderer.invoke("shell-open-terminal"),

    // ── Persistent store ─────────────────────────────────────────
    storeGet:    (key)               => ipcRenderer.invoke("store-get",     key),
    storeSet:    (key, value)        => ipcRenderer.invoke("store-set",     { key, value }),
    storeDelete: (key)               => ipcRenderer.invoke("store-delete",  key),
    storeGetAll: ()                  => ipcRenderer.invoke("store-get-all"),

    // ── Offline cache ────────────────────────────────────────────
    cacheSet:   (key, data)          => ipcRenderer.invoke("cache-set",     { key, data }),
    cacheGet:   (key)                => ipcRenderer.invoke("cache-get",     key),
    cacheClear: ()                   => ipcRenderer.invoke("cache-clear"),

    // ── App info ─────────────────────────────────────────────────
    getAppInfo: ()                   => ipcRenderer.invoke("get-app-info"),

    // ── Auto updater ─────────────────────────────────────────────
    checkForUpdates:  ()             => ipcRenderer.invoke("check-for-updates"),
    downloadUpdate:   ()             => ipcRenderer.invoke("download-update"),
    quitAndInstall:   ()             => ipcRenderer.invoke("quit-and-install"),

    // ── Crash reporting ──────────────────────────────────────────
    reportCrash:      (report)       => ipcRenderer.invoke("report-renderer-crash", report),
    getRendererCrashes: ()           => ipcRenderer.invoke("get-renderer-crashes"),

    // ── External URLs ────────────────────────────────────────────
    openExternal: (url)              => ipcRenderer.invoke("open-external", url),

    // ── Inter-window broadcast ───────────────────────────────────
    broadcast: (channel, data)       => ipcRenderer.invoke("broadcast", { channel, data }),

    // ── PTY Terminal sessions ────────────────────────────────────
    ptyCreate:  (opts)               => ipcRenderer.invoke("pty-create",  opts),
    ptyInput:   (id, data)           => ipcRenderer.invoke("pty-input",   { id, data }),
    ptyResize:  (id, cols, rows)     => ipcRenderer.invoke("pty-resize",  { id, cols, rows }),
    ptyKill:    (id)                 => ipcRenderer.invoke("pty-kill",    { id }),
    ptyList:    ()                   => ipcRenderer.invoke("pty-list"),
    ptyCwd:     (id)                 => ipcRenderer.invoke("pty-cwd",     { id }),
    // PTY data: renderer subscribes per session id
    onPtyData:  (id, cb)            => _on(`pty-data:${id}`,  cb),
    onPtyExit:  (id, cb)            => _on(`pty-exit:${id}`,  cb),

    // ── Git ──────────────────────────────────────────────────────
    gitStatus:    (cwd)              => ipcRenderer.invoke("git-status",   { cwd }),
    gitDiff:      (cwd, file)        => ipcRenderer.invoke("git-diff",     { cwd, file }),
    gitLog:       (cwd, limit)       => ipcRenderer.invoke("git-log",      { cwd, limit }),
    gitBranches:  (cwd)              => ipcRenderer.invoke("git-branches", { cwd }),
    gitCheckout:  (cwd, branch)      => ipcRenderer.invoke("git-checkout", { cwd, branch }),
    gitCommit:    (cwd, message)     => ipcRenderer.invoke("git-commit",   { cwd, message }),

    // ── File tree + search ───────────────────────────────────────
    fsReadTree:   (dir, depth)       => ipcRenderer.invoke("fs-read-tree", { dir, depth }),
    fsSearch:     (dir, query)       => ipcRenderer.invoke("fs-search",    { dir, query }),
    fsGrep:       (dir, pattern)     => ipcRenderer.invoke("fs-grep",      { dir, pattern }),

    // ── Screenshot ───────────────────────────────────────────────
    screenshotWindow: ()             => ipcRenderer.invoke("screenshot-window"),

    // ── Clipboard history ────────────────────────────────────────
    clipboardPushHistory:  (text)    => ipcRenderer.invoke("clipboard-push-history",  text),
    clipboardGetHistory:   ()        => ipcRenderer.invoke("clipboard-get-history"),
    clipboardClearHistory: ()        => ipcRenderer.invoke("clipboard-clear-history"),

    // ── Event subscriptions (return unsubscribe fn) ───────────────
    // Backend connectivity
    onBackendOnline:        (cb)     => _on("backend-online",          cb),
    onBackendOffline:       (cb)     => _on("backend-offline",         cb),

    // System events
    onSystemResume:         (cb)     => _on("system-resume",           cb),
    onNetworkChange:        (cb)     => _on("network-change",          cb),
    onWindowRestored:       (cb)     => _on("window-restored",         cb),
    onLowMemory:            (cb)     => _on("low-memory",              cb),

    // App lifecycle
    onStartupSuccess:       (cb)     => _on("startup-success",         cb),
    onRuntimeReady:         (cb)     => _on("runtime-ready",           cb),

    // Navigation (from native menu)
    onNav:                  (cb)     => _on("nav",                     cb),
    onMenuAction:           (cb)     => _on("menu-action",             cb),
    onOpenCommandPalette:   (cb)     => _on("open-command-palette",    cb),

    // Deep links
    onDeepLink:             (cb)     => _on("deep-link",               cb),

    // Floating window toggle (from menu accelerator)
    onToggleFloatingWindow: (cb)     => _on("toggle-floating-window",  cb),

    // Contact import (triggered via File > Import Contacts)
    onImportContacts:       (cb)     => _on("import-contacts",         cb),

    // Auto updater
    onUpdateStatus:         (cb)     => _on("update-status",           cb),

    // Legacy aliases kept for backward compat
    onServerDisconnected:   (cb)     => _on("backend-offline",         cb),
});

console.log("[Ooplix-Preload] electronAPI ready");
