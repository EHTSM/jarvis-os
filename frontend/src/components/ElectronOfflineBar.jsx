import React, { useEffect, useState, useCallback } from 'react';
import { useBackendStatus, useElectronEvent } from '../hooks/useElectron';

/**
 * Thin banner shown when the local backend (:5050) goes offline.
 * Only renders in Electron — in browser, the app talks to the remote server
 * and this is not applicable.
 *
 * Also surfaces the real offline write queue (get-offline-queue /
 * replay-offline-queue IPC, already implemented in electron/main.cjs —
 * writes made while offline are queued there and can be replayed once the
 * backend is back) which had no frontend caller anywhere in the repo.
 */
export default function ElectronOfflineBar() {
  const { online } = useBackendStatus();
  const [visible, setVisible] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const isElectron = !!window.electronAPI?.isElectron;

  const refreshQueue = useCallback(() => {
    if (!isElectron) return;
    window.electronAPI.getOfflineQueue().then(r => setQueueLength(r?.length ?? 0));
  }, [isElectron]);

  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  useElectronEvent('onOfflineWriteQueued', (data) => setQueueLength(data?.queueLength ?? 0), []);
  useElectronEvent('onOfflineReplayStarted', () => setReplaying(true), []);
  useElectronEvent('onOfflineReplayCompleted', (data) => {
    setReplaying(false);
    setQueueLength(data?.remainingQueueLength ?? 0);
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    if (!online) {
      setVisible(true);
    } else if (queueLength === 0) {
      // Brief delay so "back online" flash is readable
      const t = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(t);
    } else {
      setVisible(true);
    }
  }, [online, isElectron, queueLength]);

  const handleReplay = useCallback(async () => {
    if (!isElectron || replaying) return;
    setReplaying(true);
    const status = await window.electronAPI.replayOfflineQueue();
    setReplaying(false);
    setQueueLength(status?.length ?? 0);
  }, [isElectron, replaying]);

  if (!isElectron || !visible) return null;

  const showQueue = online && queueLength > 0;

  return (
    <div style={{
      position:       'fixed',
      bottom:         0,
      left:           0,
      right:          0,
      zIndex:         9998,
      padding:        '6px 16px',
      fontSize:       '12px',
      fontFamily:     'system-ui, sans-serif',
      display:        'flex',
      alignItems:     'center',
      gap:            '8px',
      background:     showQueue ? '#78350f' : online ? '#065f46' : '#1c1917',
      color:          showQueue ? '#fef3c7' : online ? '#ecfdf5' : '#a8a29e',
      transition:     'background 0.3s',
    }}>
      <span style={{
        width:        '7px',
        height:       '7px',
        borderRadius: '50%',
        background:   showQueue ? '#fbbf24' : online ? '#34d399' : '#78716c',
        flexShrink:   0,
      }} />
      {showQueue
        ? `${queueLength} write${queueLength !== 1 ? 's' : ''} queued while offline`
        : online ? 'Backend reconnected' : queueLength > 0
          ? `Backend offline — ${queueLength} write${queueLength !== 1 ? 's' : ''} queued`
          : 'Backend offline — cached data shown'}
      {showQueue && (
        <button
          onClick={handleReplay}
          disabled={replaying}
          style={{
            marginLeft:   'auto',
            background:   'transparent',
            border:       '1px solid #fbbf24',
            borderRadius: '4px',
            color:        '#fef3c7',
            fontSize:     '11px',
            padding:      '2px 8px',
            cursor:       replaying ? 'default' : 'pointer',
          }}
        >
          {replaying ? 'Replaying…' : 'Replay now'}
        </button>
      )}
    </div>
  );
}
