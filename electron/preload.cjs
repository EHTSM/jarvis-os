"use strict";
/**
 * Ooplix Electron Preload — IPC bridge.
 * Exposes window.electronAPI to the renderer (contextBridge).
 * All methods call ipcRenderer.invoke / ipcRenderer.on only.
 */

const { contextBridge, ipcRenderer } = require("electron");

// ── IPC input validation guards ───────────────────────────────────
function _str(v, maxLen = 2048) {
    if (typeof v !== "string") throw new TypeError("Expected string");
    if (v.length > maxLen) throw new RangeError(`String too long (max ${maxLen})`);
    return v;
}
function _strOpt(v, maxLen = 2048) {
    return v == null ? v : _str(v, maxLen);
}
function _posNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new RangeError("Expected non-negative number");
    return n;
}
function _int(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`Integer out of range [${min}, ${max}]`);
    return n;
}
function _obj(v) {
    if (typeof v !== "object" || v === null) throw new TypeError("Expected object");
    return v;
}

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
    sendCommand:       (cmd)         => ipcRenderer.invoke("send-command",       _str(cmd, 4096)),
    apiRequest: (opts) => {
        _obj(opts);
        if (typeof opts.path === "string") _str(opts.path, 1024);
        return ipcRenderer.invoke("api-request", opts);
    },
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
    shellExec: (opts) => {
        _obj(opts);
        _str(opts.command, 2048);
        if (opts.cwd != null) _str(opts.cwd, 1024);
        return ipcRenderer.invoke("shell-exec", opts);
    },
    shellOpenTerminal: () => ipcRenderer.invoke("shell-open-terminal"),

    // ── Persistent store ─────────────────────────────────────────
    storeGet:    (key)               => ipcRenderer.invoke("store-get",     _str(key, 128)),
    storeSet:    (key, value)        => ipcRenderer.invoke("store-set",     { key: _str(key, 128), value }),
    storeDelete: (key)               => ipcRenderer.invoke("store-delete",  _str(key, 128)),
    storeGetAll: ()                  => ipcRenderer.invoke("store-get-all"),

    // ── Offline cache ────────────────────────────────────────────
    cacheSet:   (key, data)          => ipcRenderer.invoke("cache-set",     { key: _str(key, 256), data }),
    cacheGet:   (key)                => ipcRenderer.invoke("cache-get",     _str(key, 256)),
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
    openExternal: (url) => {
        // Only allow https:// URLs — same check as main process, defence-in-depth
        if (typeof url !== "string" || !url.startsWith("https://")) return Promise.resolve({ ok: false });
        return ipcRenderer.invoke("open-external", url);
    },

    // ── Inter-window broadcast ───────────────────────────────────
    broadcast: (channel, data) => ipcRenderer.invoke("broadcast", { channel: _str(channel, 64), data }),

    // ── PTY Terminal sessions ────────────────────────────────────
    ptyCreate:  (opts)               => ipcRenderer.invoke("pty-create",  opts),
    ptyInput:   (id, data)           => ipcRenderer.invoke("pty-input",   { id: _str(id, 64), data: _str(data, 65536) }),
    ptyResize:  (id, cols, rows)     => ipcRenderer.invoke("pty-resize",  { id: _str(id, 64), cols: _int(cols, 1, 512), rows: _int(rows, 1, 300) }),
    ptyKill:    (id)                 => ipcRenderer.invoke("pty-kill",    { id: _str(id, 64) }),
    ptyList:    ()                   => ipcRenderer.invoke("pty-list"),
    ptyCwd:     (id)                 => ipcRenderer.invoke("pty-cwd",     { id: _str(id, 64) }),
    // PTY data: renderer subscribes per session id
    onPtyData:  (id, cb)            => _on(`pty-data:${id}`,  cb),
    onPtyExit:  (id, cb)            => _on(`pty-exit:${id}`,  cb),

    // ── Git ──────────────────────────────────────────────────────
    gitStatus:    (cwd)              => ipcRenderer.invoke("git-status",   { cwd: _str(cwd, 1024) }),
    gitDiff:      (cwd, file)        => ipcRenderer.invoke("git-diff",     { cwd: _str(cwd, 1024), file: _strOpt(file, 1024) }),
    gitLog:       (cwd, limit)       => ipcRenderer.invoke("git-log",      { cwd: _str(cwd, 1024), limit: _int(limit ?? 50, 1, 500) }),
    gitBranches:  (cwd)              => ipcRenderer.invoke("git-branches", { cwd: _str(cwd, 1024) }),
    gitCheckout:  (cwd, branch)      => ipcRenderer.invoke("git-checkout", { cwd: _str(cwd, 1024), branch: _str(branch, 256) }),
    gitCommit:    (cwd, message)     => ipcRenderer.invoke("git-commit",   { cwd: _str(cwd, 1024), message: _str(message, 4096) }),

    // ── File tree + search ───────────────────────────────────────
    fsReadTree:   (dir, depth)       => ipcRenderer.invoke("fs-read-tree", { dir: _str(dir, 1024), depth: _int(depth ?? 3, 1, 6) }),
    fsSearch:     (dir, query)       => ipcRenderer.invoke("fs-search",    { dir: _str(dir, 1024), query: _str(query, 256) }),
    fsGrep:       (dir, pattern)     => ipcRenderer.invoke("fs-grep",      { dir: _str(dir, 1024), pattern: _str(pattern, 256) }),

    // ── Screenshot ───────────────────────────────────────────────
    screenshotWindow: ()             => ipcRenderer.invoke("screenshot-window"),

    // ── Clipboard history ────────────────────────────────────────
    clipboardPushHistory:  (text)    => ipcRenderer.invoke("clipboard-push-history",  text),
    clipboardGetHistory:   ()        => ipcRenderer.invoke("clipboard-get-history"),
    clipboardClearHistory: ()        => ipcRenderer.invoke("clipboard-clear-history"),

    // ── Phase 4 — Native Desktop ─────────────────────────────────────
    dockSetProgress:     (value)       => ipcRenderer.invoke("dock-set-progress",       { value }),
    dockBounce:          (type)        => ipcRenderer.invoke("dock-bounce",             { type }),
    dockCancelBounce:    (id)          => ipcRenderer.invoke("dock-cancel-bounce",      { id }),
    taskbarBadge:        (count)       => ipcRenderer.invoke("taskbar-badge",           { count }),
    showContextMenu:     (items)       => ipcRenderer.invoke("show-context-menu",       { items }),
    addRecentProject:    (path, name)  => ipcRenderer.invoke("add-recent-project",      { path, name }),
    getRecentProjects:   ()            => ipcRenderer.invoke("get-recent-projects"),
    clearRecentProjects: ()            => ipcRenderer.invoke("clear-recent-projects"),
    ondragstart:         (filePath)    => ipcRenderer.send  ("ondragstart",             filePath),
    getDisplays:         ()            => ipcRenderer.invoke("get-displays"),
    moveToDisplay:       (displayId)   => ipcRenderer.invoke("move-to-display",         { displayId }),
    getPendingOpenFiles: ()            => ipcRenderer.invoke("get-pending-open-files"),
    getStartupTiming:    ()            => ipcRenderer.invoke("get-startup-timing"),
    getProcessMetrics:   ()            => ipcRenderer.invoke("get-process-metrics"),
    requestGC:           ()            => ipcRenderer.invoke("request-gc"),
    // File open from OS
    onOpenFile:          (cb)          => _on("open-file",               cb),
    onContextMenuAction: (cb)          => _on("context-menu-action",     cb),

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
