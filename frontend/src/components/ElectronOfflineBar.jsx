import React, { useEffect, useState } from 'react';
import { useBackendStatus } from '../hooks/useElectron';

/**
 * Thin banner shown when the local backend (:5050) goes offline.
 * Only renders in Electron — in browser, the app talks to the remote server
 * and this is not applicable.
 */
export default function ElectronOfflineBar() {
  const { online } = useBackendStatus();
  const [visible, setVisible] = useState(false);
  const isElectron = !!window.electronAPI?.isElectron;

  useEffect(() => {
    if (!isElectron) return;
    if (!online) {
      setVisible(true);
    } else {
      // Brief delay so "back online" flash is readable
      const t = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(t);
    }
  }, [online, isElectron]);

  if (!isElectron || !visible) return null;

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
      background:     online ? '#065f46' : '#1c1917',
      color:          online ? '#ecfdf5' : '#a8a29e',
      transition:     'background 0.3s',
    }}>
      <span style={{
        width:        '7px',
        height:       '7px',
        borderRadius: '50%',
        background:   online ? '#34d399' : '#78716c',
        flexShrink:   0,
      }} />
      {online ? 'Backend reconnected' : 'Backend offline — cached data shown'}
    </div>
  );
}
