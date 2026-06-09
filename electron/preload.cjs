const { contextBridge, ipcRenderer } = require('electron');

console.log('[JARVIS-PRELOAD] Loading preload script...');

contextBridge.exposeInMainWorld('electronAPI', {
    // Send command to JARVIS
    sendCommand: (command) => ipcRenderer.invoke('send-command', command),

    // Get evolution score
    getEvolutionScore: () => ipcRenderer.invoke('get-evolution-score'),

    // Get suggestions
    getSuggestions: () => ipcRenderer.invoke('get-suggestions'),

    // Approve suggestion
    approveSuggestion: (suggestionId) => ipcRenderer.invoke('approve-suggestion', suggestionId),

    // Check server health
    getServerHealth: () => ipcRenderer.invoke('get-server-health'),

    // Create floating window
    createFloatingWindow: () => ipcRenderer.invoke('create-floating-window'),

    // Listen for server status
    onServerDisconnected: (callback) => ipcRenderer.on('server-disconnected', callback),

    // Listen for floating window toggle
    onToggleFloatingWindow: (callback) => ipcRenderer.on('toggle-floating-window', callback),

    // Remove listeners
    removeServerDisconnectedListener: () => ipcRenderer.removeAllListeners('server-disconnected'),
    removeFloatingWindowListener: () => ipcRenderer.removeAllListeners('toggle-floating-window'),

    // Phase 73: Renderer crash reporting
    reportCrash: (report) => ipcRenderer.invoke('report-renderer-crash', report),
    getRendererCrashes: () => ipcRenderer.invoke('get-renderer-crashes'),

    // Phase 73: Listen for low-memory signal from main
    onLowMemory: (callback) => ipcRenderer.on('low-memory', (_e, data) => callback(data)),
    removeLowMemoryListener: () => ipcRenderer.removeAllListeners('low-memory'),

    // Phase 86/100: startup success signal with timing
    onStartupSuccess: (callback) => ipcRenderer.on('startup-success', (_e, data) => callback(data)),
    removeStartupSuccessListener: () => ipcRenderer.removeAllListeners('startup-success'),

    // Phase 109: sleep/wake + network signals
    onSystemResume:   (cb) => ipcRenderer.on('system-resume',   (_e, d) => cb(d)),
    onNetworkChange:  (cb) => ipcRenderer.on('network-change',  ()      => cb()),
    onWindowRestored: (cb) => ipcRenderer.on('window-restored', ()      => cb()),
    removeSystemListeners: () => {
        ipcRenderer.removeAllListeners('system-resume');
        ipcRenderer.removeAllListeners('network-change');
        ipcRenderer.removeAllListeners('window-restored');
    },

    // Firebase auth: open OAuth URLs in system browser (popup can't work in BrowserWindow)
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Context detection: lets renderer know it's running inside Electron
    isElectron: true,
});

console.log('[JARVIS-PRELOAD] electronAPI exposed successfully!');
