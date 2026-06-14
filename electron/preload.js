const { contextBridge, ipcRenderer } = require('electron');

// ── Safe event listener helper ────────────────────────────────────────────────
// Returns a cleanup fn — React hooks call it on unmount.
function _on(channel, cb) {
  const wrapped = (_e, data) => cb(data);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Context flags ─────────────────────────────────────────────────────────
  isElectron: true,
  platform:   process.platform,

  // ── Navigation from native menus ─────────────────────────────────────────
  onNavigate:         (cb) => _on('ipc:navigate',         cb),
  onOpenPalette:      (cb) => _on('ipc:open-palette',     cb),
  onOpenSettings:     (cb) => _on('ipc:open-settings',    cb),
  onNewTask:          (cb) => _on('ipc:new-task',         cb),
  onEmergencyStop:    (cb) => _on('ipc:emergency-stop',   cb),
  onEmergencyResume:  (cb) => _on('ipc:emergency-resume', cb),
  onUpdateAvailable:  (cb) => _on('ipc:update-available', cb),
  onUpdateDownloaded: (cb) => _on('ipc:update-downloaded',cb),

  // ── System events ─────────────────────────────────────────────────────────
  onSystemResume:   (cb) => _on('system-resume',   cb),
  onNetworkChange:  (cb) => _on('network-change',  cb),
  onWindowRestored: (cb) => _on('window-restored', cb),
  onLowMemory:      (cb) => _on('low-memory',      cb),
  onStartupSuccess: (cb) => _on('startup-success', cb),
  onRuntimeReady:   (cb) => _on('runtime-ready',   cb),

  // ── Cleanup listeners ─────────────────────────────────────────────────────
  removeListener: (channel, cb) => ipcRenderer.removeListener(channel, cb),

  // ── Main process calls ────────────────────────────────────────────────────
  updateTray:  (data) => ipcRenderer.send('app:tray-update', data),
  notify:      (data) => ipcRenderer.send('app:notify',      data),
  openURL:     (url)  => ipcRenderer.invoke('app:open-url',  url),
  getPlatform: ()     => ipcRenderer.invoke('app:platform'),

  // ── Window controls (custom titlebar on Windows/Linux) ───────────────────
  minimize:    ()     => ipcRenderer.send('window:minimize'),
  maximize:    ()     => ipcRenderer.send('window:maximize'),
  closeWindow: ()     => ipcRenderer.send('window:close'),
  hideWindow:  ()     => ipcRenderer.send('window:hide'),

  // ── Legacy API (backward compat with existing preload.cjs consumers) ──────
  sendCommand:        (cmd) => ipcRenderer.invoke('send-command',          cmd),
  getServerHealth:    ()    => ipcRenderer.invoke('get-server-health'),
  getEvolutionScore:  ()    => ipcRenderer.invoke('get-evolution-score'),
  getSuggestions:     ()    => ipcRenderer.invoke('get-suggestions'),
  approveSuggestion:  (id)  => ipcRenderer.invoke('approve-suggestion',    id),
  openExternal:       (url) => ipcRenderer.invoke('open-external',         url),
  reportCrash:        (r)   => ipcRenderer.invoke('report-renderer-crash', r),
  getRendererCrashes: ()    => ipcRenderer.invoke('get-renderer-crashes'),
});

console.log('[Ooplix-Preload] electronAPI (main.js bridge) ready');
