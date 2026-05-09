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
    removeFloatingWindowListener: () => ipcRenderer.removeAllListeners('toggle-floating-window')
});

console.log('[JARVIS-PRELOAD] electronAPI exposed successfully!');
