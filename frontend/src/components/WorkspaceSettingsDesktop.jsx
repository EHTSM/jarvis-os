import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch, _isElectron } from "../_client";

// Desktop Integrations panel — exposes real Electron IPC handlers
// (printer-list, printer-print, fs-show-save-dialog, printer-print-to-pdf,
// scanner-open-native-app, folder-sync-*) that were fully implemented in
// electron/main.cjs + preload.cjs but had zero frontend caller anywhere in
// the repo. Every action here is a thin wrapper around the existing
// window.electronAPI method — no new IPC handler, no new main-process logic.

function _fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Print to PDF ────────────────────────────────────────────────────
function PrintToPdfCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handlePrint = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await window.electronAPI.printerPrintToPdf({});
      setResult(r?.ok ? { ok: true, path: r.path } : { ok: false, error: r?.error || "Print failed" });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k2-row">
      <span className="k2-row-icon">🖨</span>
      <div className="k2-row-meta">
        <span className="k2-row-title">Print current view to PDF</span>
        <span className="k2-row-sub">
          {result?.ok ? `Saved to ${result.path}` : result?.error ? `Failed: ${result.error}` : "Uses Electron's real printToPDF — saved to your Downloads folder."}
        </span>
      </div>
      <div className="k2-row-actions">
        <button className="k2-create-btn" onClick={handlePrint} disabled={busy}>{busy ? "Printing…" : "Print to PDF"}</button>
      </div>
    </div>
  );
}

// ── Multi-monitor: move window to display ────────────────────────────
function DisplaysCard() {
  const [displays, setDisplays] = useState(null);
  const [moving, setMoving]     = useState(null);

  useEffect(() => {
    window.electronAPI.getDisplays().then(r => setDisplays(r?.displays || []));
  }, []);

  const handleMove = async (displayId) => {
    setMoving(displayId);
    try {
      await window.electronAPI.moveToDisplay(displayId);
    } finally {
      setMoving(null);
    }
  };

  if (!displays || displays.length < 2) return null; // nothing to show on a single monitor

  return (
    <div className="k2-tokens-panel">
      <div className="k2-tokens-header">
        <span>Displays</span>
      </div>
      <p className="k2-row-sub" style={{ padding: "0 2px" }}>
        {displays.length} monitors detected. Move this window to another display.
      </p>
      <div className="k2-list">
        {displays.map(d => (
          <div key={d.id} className="k2-row">
            <span className="k2-row-icon">🖥</span>
            <div className="k2-row-meta">
              <span className="k2-row-title">{d.bounds.width}×{d.bounds.height}{d.primary ? " (primary)" : ""}</span>
              <span className="k2-row-sub">scale {d.scaleFactor}x</span>
            </div>
            <div className="k2-row-actions">
              <button className="k2-create-btn" onClick={() => handleMove(d.id)} disabled={moving === d.id}>
                {moving === d.id ? "Moving…" : "Move here"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Printer list + direct print ──────────────────────────────────────
function PrinterCard() {
  const [printers, setPrinters] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [printing, setPrinting] = useState(null);
  const [result, setResult]     = useState(null);

  useEffect(() => {
    window.electronAPI.printerList()
      .then(r => setPrinters(r?.ok ? r.printers : []))
      .finally(() => setLoading(false));
  }, []);

  const handlePrint = async (deviceName) => {
    setPrinting(deviceName);
    setResult(null);
    try {
      const r = await window.electronAPI.printerPrint({ deviceName, silent: true });
      setResult(r?.ok ? { ok: true, deviceName } : { ok: false, error: r?.error || "Print failed" });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setPrinting(null);
    }
  };

  return (
    <div className="k2-tokens-panel">
      <div className="k2-tokens-header">
        <span>Printers</span>
      </div>
      <p className="k2-row-sub" style={{ padding: "0 2px" }}>
        Real OS printer enumeration and print jobs via Electron's webContents — no third-party driver.
      </p>
      {loading ? (
        <div className="k2-loading">Loading…</div>
      ) : !printers?.length ? (
        <div className="k2-empty">No printers detected on this system.</div>
      ) : (
        <div className="k2-list">
          {printers.map(p => (
            <div key={p.name} className="k2-row">
              <span className="k2-row-icon">🖨</span>
              <div className="k2-row-meta">
                <span className="k2-row-title">{p.displayName || p.name}{p.isDefault ? " (default)" : ""}</span>
                <span className="k2-row-sub">{p.status !== undefined ? `status: ${p.status}` : p.name}</span>
              </div>
              <div className="k2-row-actions">
                <button className="k2-create-btn" onClick={() => handlePrint(p.name)} disabled={printing === p.name}>
                  {printing === p.name ? "Printing…" : "Print current view"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {result && (
        <p className="k2-row-sub" style={{ padding: "0 2px", color: result.ok ? undefined : "var(--error)" }}>
          {result.ok ? `Sent to ${result.deviceName}.` : `Failed: ${result.error}`}
        </p>
      )}
    </div>
  );
}

// ── Scanner hand-off ────────────────────────────────────────────────
function ScannerCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handleOpen = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await window.electronAPI.scannerOpenNativeApp();
      setResult(r);
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k2-row">
      <span className="k2-row-icon">🖼</span>
      <div className="k2-row-meta">
        <span className="k2-row-title">Scan a document</span>
        <span className="k2-row-sub">
          {result?.ok ? `Opened ${result.app}` : result?.error ? result.error : "Opens your OS's native scanning app (Image Capture / Windows Scan). Import the saved file via File Explorer afterward."}
        </span>
      </div>
      <div className="k2-row-actions">
        <button className="k2-create-btn" onClick={handleOpen} disabled={busy}>{busy ? "Opening…" : "Open Scanner"}</button>
      </div>
    </div>
  );
}

// ── Save-to-file primitive ──────────────────────────────────────────
function SaveDialogCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handleExport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const dialogRes = await window.electronAPI.fsShowSaveDialog({
        defaultPath: `ooplix-export-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (dialogRes.canceled || !dialogRes.filePath) { setBusy(false); return; }
      const status = await _fetch("/health").catch(() => null);
      const writeRes = await window.electronAPI.fsWriteFile({
        filePath: dialogRes.filePath,
        data: JSON.stringify({ exportedAt: new Date().toISOString(), health: status }, null, 2),
      });
      if (!writeRes?.ok) throw new Error(writeRes?.error || "Write failed");
      setResult({ ok: true, path: dialogRes.filePath });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k2-row">
      <span className="k2-row-icon">💾</span>
      <div className="k2-row-meta">
        <span className="k2-row-title">Export system status to file</span>
        <span className="k2-row-sub">
          {result?.ok ? `Saved to ${result.path}` : result?.error ? `Failed: ${result.error}` : "Uses the native OS save dialog, not a browser download."}
        </span>
      </div>
      <div className="k2-row-actions">
        <button className="k2-create-btn" onClick={handleExport} disabled={busy}>{busy ? "Saving…" : "Choose location & save"}</button>
      </div>
    </div>
  );
}

// ── Folder sync ──────────────────────────────────────────────────────
function FolderSyncCard() {
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);
  const cleanupRef = useRef(null);

  const refresh = useCallback(() => {
    window.electronAPI.folderSyncStatus().then(r => setActive(r?.active || [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!window.electronAPI?.onFolderSyncEvent) return;
    const off = window.electronAPI.onFolderSyncEvent(async (evt) => {
      try {
        const file = await window.electronAPI.folderSyncReadFile(evt.fullPath);
        if (!file?.ok) {
          setUploadLog(prev => [{ ts: Date.now(), relativePath: evt.relativePath, ok: false, error: file?.error }, ...prev].slice(0, 20));
          return;
        }
        const upload = await _fetch("/enterprise/physical/folder-sync/upload", {
          method: "POST",
          body: JSON.stringify({ relativePath: evt.relativePath, base64: file.base64, contentType: "application/octet-stream" }),
        }).catch(e => ({ ok: false, error: e.message }));
        setUploadLog(prev => [{ ts: Date.now(), relativePath: evt.relativePath, ok: upload?.ok !== false, error: upload?.error, sizeBytes: file.sizeBytes }, ...prev].slice(0, 20));
      } catch (e) {
        setUploadLog(prev => [{ ts: Date.now(), relativePath: evt.relativePath, ok: false, error: e.message }, ...prev].slice(0, 20));
      }
    });
    cleanupRef.current = off;
    return () => { if (typeof off === "function") off(); };
  }, []);

  const startWatch = async () => {
    const dialogRes = await window.electronAPI.fsShowOpenDialog?.({ properties: ["openDirectory"] });
    if (!dialogRes || dialogRes.canceled || !dialogRes.filePaths?.length) return;
    setStarting(true);
    try {
      const r = await window.electronAPI.folderSyncStart(dialogRes.filePaths[0]);
      if (!r?.ok) throw new Error(r?.error || "Failed to start watcher");
      refresh();
    } catch (e) {
      setUploadLog(prev => [{ ts: Date.now(), relativePath: "(watch start)", ok: false, error: e.message }, ...prev].slice(0, 20));
    } finally {
      setStarting(false);
    }
  };

  const stopWatch = async (watchId) => {
    await window.electronAPI.folderSyncStop(watchId);
    refresh();
  };

  return (
    <div className="k2-tokens-panel">
      <div className="k2-tokens-header">
        <span>Local Folder Sync</span>
        <button className="k2-create-btn" onClick={startWatch} disabled={starting}>{starting ? "Choosing…" : "+ Watch a folder"}</button>
      </div>
      <p className="k2-row-sub" style={{ padding: "0 2px" }}>
        Watches a local folder for changes and uploads new/changed files to your org's storage. Requires a configured storage provider (S3/R2) server-side.
      </p>
      {loading ? <div className="k2-loading">Loading…</div> : active.length === 0 ? (
        <div className="k2-empty">No folders being watched.</div>
      ) : (
        <div className="k2-list">
          {active.map(w => (
            <div key={w.watchId} className="k2-row">
              <span className="k2-row-icon">📂</span>
              <div className="k2-row-meta">
                <span className="k2-row-title">{w.localPath}</span>
                <span className="k2-row-sub">watch id: {w.watchId}</span>
              </div>
              <div className="k2-row-actions">
                <button className="k2-revoke-btn" onClick={() => stopWatch(w.watchId)}>Stop</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {uploadLog.length > 0 && (
        <div className="k2-audit-list">
          {uploadLog.map((u, i) => (
            <div key={i} className="k2-audit-row">
              <span className="k2-audit-dot" style={{ background: u.ok ? "#52d68a" : "var(--error)" }} />
              <span className="k2-audit-ts">{new Date(u.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="k2-audit-action">{u.ok ? "synced" : "failed"}</span>
              <span className="k2-audit-detail">{u.relativePath}{u.sizeBytes ? ` (${_fmtBytes(u.sizeBytes)})` : ""}{u.error ? ` — ${u.error}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DesktopIntegrationsPanel() {
  if (!_isElectron()) {
    return (
      <div className="k2-empty">
        Desktop integrations (print to PDF, scanner hand-off, native save dialog, folder sync) are only available in the Ooplix desktop app.
      </div>
    );
  }
  return (
    <div className="k2-list">
      <DisplaysCard />
      <PrinterCard />
      <PrintToPdfCard />
      <ScannerCard />
      <SaveDialogCard />
      <FolderSyncCard />
    </div>
  );
}
