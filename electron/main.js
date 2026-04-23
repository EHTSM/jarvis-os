const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const axios = require('axios');

let mainWindow;
let floatingWindow;
const API_URL = 'http://localhost:3000';


mainWindow.loadURL("http://localhost:3000");

// Handle IPC communication
ipcMain.handle('send-command', async (event, command) => {
    try {
        const response = await axios.post(`${API_URL}/jarvis`, {
            command: command
        });
        return { success: true, data: response.data };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            details: error.response?.data
        };
    }
});

ipcMain.handle('get-evolution-score', async (event) => {
    try {
        const response = await axios.get(`${API_URL}/evolution/score`);
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-suggestions', async (event) => {
    try {
        const response = await axios.get(`${API_URL}/evolution/suggestions`);
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('approve-suggestion', async (event, suggestionId) => {
    try {
        const response = await axios.post(`${API_URL}/evolution/approve/${suggestionId}`);
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-server-health', async (event) => {
    try {
        const response = await axios.get(`${API_URL}/`);
        return { success: true, isHealthy: true };
    } catch (error) {
        return { success: false, isHealthy: false, error: error.message };
    }
});

ipcMain.handle('create-floating-window', (event) => {
    if (floatingWindow) {
        floatingWindow.focus();
        return;
    }

    floatingWindow = new BrowserWindow({
        width: 350,
        height: 450,
        resizable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        alwaysOnTop: true,
        show: false
    });

    const url = isDev
        ? 'http://localhost:3000/floating'
        : `file://${path.join(__dirname, '../build/index.html')}?mode=floating`;

    floatingWindow.loadURL(url);
    floatingWindow.show();

    floatingWindow.on('closed', () => {
        floatingWindow = null;
    });
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });

    const url = isDev
        ? 'http://localhost:3001'
        : `file://${path.join(__dirname, '../build/index.html')}`;

    console.log('[JARVIS] Loading URL:', url);
    console.log('[JARVIS] Using preload:', path.join(__dirname, 'preload.js'));
    mainWindow.loadURL(url);

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Create application menu
const createMenu = () => {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Exit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Floating Window',
                    accelerator: 'CmdOrCtrl+Shift+F',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('toggle-floating-window');
                        }
                    }
                },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        // Create about window
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
};

// Start app when ready
app.whenReady().then(() => {
    console.log('[JARVIS] App ready, creating window...');
    createWindow();
    createMenu();
    console.log('[JARVIS] Window created successfully');
});

app.on('window-all-closed', () => {
    console.log('[JARVIS] All windows closed');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    console.log('[JARVIS] App activated');
    if (mainWindow === null) {
        createWindow();
    }
});

// Health check - restart if server is down
setInterval(async () => {
    try {
        await axios.get(`${API_URL}/`, { timeout: 3000 });
    } catch (error) {
        if (mainWindow) {
            mainWindow.webContents.send('server-disconnected');
        }
    }
}, 5000);
