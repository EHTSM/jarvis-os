/**
 * WorkspaceRecovery — show recovery banner when previous session snapshot exists.
 * The actual state persistence is already wired in ElectronWorkspace via storeGet/storeSet.
 * This component adds:
 *  - "Session recovered from X" toast when session was restored
 *  - Manual "Save snapshot" button
 *  - "Clear session" button
 *  - Recovery history (last 5 sessions)
 */
import React, { useState, useEffect, useCallback } from "react";
import "./WorkspaceRecovery.css";

const SESSION_KEY = "ew-session-v2";
const HISTORY_KEY = "ew-session-history-v1";

async function storeGet(key) {
  if (!window.electronAPI?.storeGet) return null;
  try { const r = await window.electronAPI.storeGet(key); return r?.value || null; } catch { return null; }
}
async function storeSet(key, value) {
  if (!window.electronAPI?.storeSet) return;
  try { await window.electronAPI.storeSet(key, value); } catch {}
}

function timeFmt(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function WorkspaceRecovery({ currentSession, onRestore }) {
  const [history,     setHistory]     = useState([]);
  const [toast,       setToast]       = useState(null);
  const [expanded,    setExpanded]    = useState(false);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    storeGet(HISTORY_KEY).then(h => {
      if (Array.isArray(h)) setHistory(h);
    });
  }, []);

  const saveSnapshot = useCallback(async () => {
    if (!currentSession || saving) return;
    setSaving(true);
    const snapshot = { ...currentSession, savedAt: Date.now(), label: `Snapshot ${new Date().toLocaleTimeString()}` };
    const prev = (await storeGet(HISTORY_KEY)) || [];
    const next = [snapshot, ...(Array.isArray(prev) ? prev : [])].slice(0, 5);
    await storeSet(HISTORY_KEY, next);
    await storeSet(SESSION_KEY, snapshot);
    setHistory(next);
    setToast("Session saved");
    setTimeout(() => setToast(null), 2500);
    setSaving(false);
  }, [currentSession, saving]);

  const restoreSnapshot = useCallback(async (snap) => {
    await storeSet(SESSION_KEY, snap);
    onRestore?.(snap);
    setToast("Session restored — reload to apply");
    setTimeout(() => setToast(null), 3500);
  }, [onRestore]);

  const clearHistory = useCallback(async () => {
    await storeSet(HISTORY_KEY, []);
    await storeSet(SESSION_KEY, null);
    setHistory([]);
    setToast("Session cleared");
    setTimeout(() => setToast(null), 2000);
  }, []);

  const isElectron = !!window.electronAPI?.isElectron;

  return (
    <div className="wr-root">
      <div className="wr-header">
        <span className="wr-title">Workspace Recovery</span>
        <button className="wr-expand" onClick={() => setExpanded(v => !v)}>{expanded ? "▲" : "▼"} History</button>
      </div>

      {!isElectron && (
        <div className="wr-warn">Session persistence requires the desktop app.</div>
      )}

      <div className="wr-current">
        <div className="wr-current__label">Current session</div>
        <div className="wr-current__meta">
          {currentSession?.cwd ? <code>{currentSession.cwd.split("/").pop()}</code> : "No active workspace"}
          {currentSession?.osView && <span className="wr-chip">{currentSession.osView}</span>}
          {currentSession?.bottomTab && <span className="wr-chip">{currentSession.bottomTab}</span>}
        </div>
        <button
          className="wr-save-btn"
          onClick={saveSnapshot}
          disabled={saving || !isElectron || !currentSession}
        >
          {saving ? "Saving…" : "💾 Save snapshot"}
        </button>
      </div>

      {expanded && (
        <div className="wr-history">
          <div className="wr-history__header">
            <span className="wr-history__title">Session history</span>
            {history.length > 0 && (
              <button className="wr-clear-btn" onClick={clearHistory}>Clear</button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="wr-empty">No snapshots yet.</div>
          ) : (
            history.map((snap, i) => (
              <div key={i} className="wr-snap">
                <div className="wr-snap__info">
                  <span className="wr-snap__label">{snap.label || `Snapshot ${i + 1}`}</span>
                  <span className="wr-snap__time">{timeFmt(snap.savedAt)}</span>
                </div>
                <div className="wr-snap__meta">
                  {snap.cwd && <code className="wr-snap__cwd">{snap.cwd.split("/").pop()}</code>}
                  {snap.osView && <span className="wr-chip wr-chip--sm">{snap.osView}</span>}
                </div>
                <button
                  className="wr-restore-btn"
                  onClick={() => restoreSnapshot(snap)}
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {toast && <div className="wr-toast">{toast}</div>}
    </div>
  );
}
