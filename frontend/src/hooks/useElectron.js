import { useEffect, useCallback, useState, useRef } from 'react';

const _api = () => window.electronAPI ?? null;
const _isElectron = () => !!window.electronAPI?.isElectron;

/**
 * Core Electron hook — returns the IPC API + context flag.
 * Safe in browser: returns null API and isElectron=false.
 */
export function useElectron() {
  const api = _api();
  return { api, isElectron: _isElectron(), platform: api?.platform ?? null };
}

/**
 * Subscribe to an Electron IPC event by key on window.electronAPI.
 * The preload exposes each subscription as a function that returns an unsubscribe fn.
 * Automatically cleans up on unmount or dep change.
 *
 * @param {string}   event   - Key on window.electronAPI (e.g. 'onNav')
 * @param {function} handler - Callback invoked when event fires
 * @param {Array}    deps    - dependency array for handler memoisation
 */
export function useElectronEvent(event, handler, deps = []) {
  const stable = useCallback(handler, deps);
  useEffect(() => {
    const api = _api();
    if (!api || typeof api[event] !== 'function') return;
    const unsub = api[event](stable);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [stable]);}

/**
 * Backend connectivity state.
 * Returns { online: boolean } — updates reactively via IPC events.
 */
export function useBackendStatus() {
  const [online, setOnline] = useState(true);

  useElectronEvent('onBackendOnline',  useCallback(() => setOnline(true),  []));
  useElectronEvent('onBackendOffline', useCallback(() => setOnline(false), []));

  // Non-Electron: assume online
  return { online };
}

/**
 * Auto-updater state.
 * Returns { updateState, updateVersion, downloadPercent, downloadUpdate, quitAndInstall }
 */
export function useAutoUpdater() {
  const [state,   setState]   = useState(null);   // 'checking'|'available'|'downloading'|'downloaded'|'up-to-date'|'error'
  const [version, setVersion] = useState(null);
  const [percent, setPercent] = useState(0);

  useElectronEvent('onUpdateStatus', useCallback((data) => {
    setState(data.state);
    if (data.version) setVersion(data.version);
    if (data.percent !== undefined) setPercent(data.percent);
  }, []));

  const api = _api();
  return {
    updateState:     state,
    updateVersion:   version,
    downloadPercent: percent,
    checkForUpdates: () => api?.checkForUpdates(),
    downloadUpdate:  () => api?.downloadUpdate(),
    quitAndInstall:  () => api?.quitAndInstall(),
  };
}

/**
 * Window state management.
 * Returns isMaximized + toggle/minimize/close controls.
 */
export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const api = _api();

  useEffect(() => {
    if (!api) return;
    api.windowIsMaximized().then(v => setIsMaximized(!!v));
  }, [api]);

  return {
    isMaximized,
    minimize:    () => api?.windowMinimize(),
    toggleMax:   () => { api?.windowMaximize(); setIsMaximized(m => !m); },
    close:       () => api?.windowClose(),
  };
}

/**
 * Persistent store — read/write electron-store from the renderer.
 * Returns { value, set, remove, loading }
 *
 * @param {string} key
 * @param {*}      defaultValue
 */
export function useElectronStore(key, defaultValue = undefined) {
  const [value,   setValue]   = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const api = _api();

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.storeGet(key).then(({ value: v }) => {
      setValue(v !== undefined ? v : defaultValue);
      setLoading(false);
    });
  }, [key]);
  const set = useCallback((v) => {
    setValue(v);
    api?.storeSet(key, v);
  }, [api, key]);

  const remove = useCallback(() => {
    setValue(defaultValue);
    api?.storeDelete(key);
  }, [api, defaultValue, key]);

  return { value, set, remove, loading };
}

/**
 * Offline cache — store API responses locally so the app works offline.
 * Returns { read, write, clear }
 */
export function useOfflineCache() {
  const api = _api();

  const write = useCallback((key, data) => api?.cacheSet(key, data), [api]);

  const read = useCallback(async (key) => {
    if (!api) return null;
    const entry = await api.cacheGet(key);
    return entry?.data ?? null;
  }, [api]);

  const clear = useCallback(() => api?.cacheClear(), [api]);

  return { read, write, clear };
}

/**
 * Native notifications via Electron's Notification API.
 * Falls back to browser Notification in non-Electron context.
 */
export function useNativeNotification() {
  const api = _api();

  return useCallback((title, body, opts = {}) => {
    if (api) {
      api.showNotification({ title, body, ...opts });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, ...opts });
    }
  }, [api]);
}

/**
 * Clipboard access (read + write).
 */
export function useClipboard() {
  const api = _api();

  const copy = useCallback(async (text) => {
    if (api) return api.clipboardWrite(text);
    try { await navigator.clipboard.writeText(text); return { ok: true }; } catch { return { ok: false }; }
  }, [api]);

  const paste = useCallback(async () => {
    if (api) return (await api.clipboardRead()).text;
    try { return await navigator.clipboard.readText(); } catch { return ''; }
  }, [api]);

  return { copy, paste };
}

/**
 * File system access via Electron dialogs.
 */
export function useFileSystem() {
  const api = _api();

  const openFile = useCallback((opts = {}) =>
    api?.fsShowOpenDialog({ properties: ['openFile'], ...opts }) ?? Promise.resolve({ canceled: true }), [api]);

  const saveFile = useCallback((opts = {}) =>
    api?.fsShowSaveDialog(opts) ?? Promise.resolve({ canceled: true }), [api]);

  const readFile = useCallback((filePath, encoding = 'utf8') =>
    api?.fsReadFile({ filePath, encoding }) ?? Promise.resolve({ ok: false, error: 'Not in Electron' }), [api]);

  const writeFile = useCallback((filePath, data) =>
    api?.fsWriteFile({ filePath, data }) ?? Promise.resolve({ ok: false }), [api]);

  const openPath = useCallback((p) => api?.fsOpenPath(p), [api]);

  return { openFile, saveFile, readFile, writeFile, openPath };
}

/**
 * Shell execution (terminal integration).
 */
export function useShell() {
  const api = _api();

  const exec = useCallback((command, cwd) =>
    api?.shellExec({ command, cwd }) ?? Promise.resolve({ ok: false, error: 'Not in Electron' }), [api]);

  const openTerminal = useCallback(() => api?.shellOpenTerminal(), [api]);

  return { exec, openTerminal };
}

/**
 * Navigation events from native menu (View > Contacts etc.)
 * and deep links (ooplix://route/...).
 *
 * @param {function} onNav   - called with tab string from menu
 * @param {function} onLink  - called with { url, route, params } from deep link
 */
export function useElectronNav(onNav, onLink) {
  useElectronEvent('onNav',      useCallback(onNav  || (() => {}), [onNav]));
  useElectronEvent('onDeepLink', useCallback(onLink || (() => {}), [onLink]));
}

/**
 * System events: sleep/wake, network change, low memory, window restored.
 */
export function useSystemEvents({ onResume, onNetwork, onLowMemory, onRestored } = {}) {
  useElectronEvent('onSystemResume',  useCallback(onResume    || (() => {}), [onResume]));
  useElectronEvent('onNetworkChange', useCallback(onNetwork   || (() => {}), [onNetwork]));
  useElectronEvent('onLowMemory',     useCallback(onLowMemory || (() => {}), [onLowMemory]));
  useElectronEvent('onWindowRestored',useCallback(onRestored  || (() => {}), [onRestored]));
}

/**
 * App info (version, platform, paths).
 * Returns { info, loading }
 */
export function useAppInfo() {
  const [info,    setInfo]    = useState(null);
  const [loading, setLoading] = useState(true);
  const api = _api();

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.getAppInfo().then(i => { setInfo(i); setLoading(false); });
  }, [api]);

  return { info, loading };
}

/**
 * Contact import listener — fires when user picks File > Import Contacts.
 * @param {function} handler - called with { filePath, content, ext }
 */
export function useContactImport(handler) {
  useElectronEvent('onImportContacts', useCallback(handler, [handler]));
}

/**
 * Inter-window broadcast.
 */
export function useBroadcast() {
  const api = _api();
  return useCallback((channel, data) => api?.broadcast(channel, data), [api]);
}
