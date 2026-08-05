import React, { useEffect } from 'react';
import { useAutoUpdater } from '../hooks/useElectron';

/**
 * Shows a non-intrusive banner at the top of the app when an update is available,
 * downloading, or ready to install. Renders nothing in browser context.
 */
export default function ElectronUpdateBanner() {
  const { updateState, updateVersion, downloadPercent, downloadUpdate, quitAndInstall } =
    useAutoUpdater();

  // dock-set-progress (real setProgressBar() on the dock/taskbar icon) was
  // fully implemented in electron/main.cjs and exposed via preload, but had
  // zero frontend caller — mirror the update download's real percent onto
  // the OS icon so progress is visible even when the app isn't focused.
  useEffect(() => {
    if (!window.electronAPI?.dockSetProgress) return;
    if (updateState === 'downloading') {
      window.electronAPI.dockSetProgress(Math.max(0, Math.min(1, downloadPercent / 100)));
    } else if (updateState === 'downloaded' || updateState === 'error') {
      window.electronAPI.dockSetProgress(-1); // hide once finished/failed
    }
  }, [updateState, downloadPercent]);

  if (!updateState || updateState === 'checking' || updateState === 'up-to-date') return null;

  const styles = {
    banner: {
      position:       'fixed',
      top:            0,
      left:           0,
      right:          0,
      zIndex:         9999,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '8px 16px',
      fontSize:       '13px',
      fontFamily:     'system-ui, sans-serif',
      gap:            '12px',
    },
    available: { background: '#1d4ed8', color: '#fff' },
    downloading: { background: '#0f172a', color: '#94a3b8' },
    downloaded: { background: '#065f46', color: '#ecfdf5' },
    error:      { background: '#7f1d1d', color: '#fee2e2' },
    btn: {
      padding:       '4px 12px',
      borderRadius:  '4px',
      border:        '1px solid rgba(255,255,255,0.3)',
      background:    'rgba(255,255,255,0.15)',
      color:         'inherit',
      cursor:        'pointer',
      fontSize:      '12px',
      fontWeight:    600,
      whiteSpace:    'nowrap',
    },
    progress: {
      flex:           1,
      height:         '4px',
      background:     '#1e3a5f',
      borderRadius:   '2px',
      overflow:       'hidden',
      maxWidth:       '200px',
    },
    bar: {
      height:     '100%',
      background: '#38bdf8',
      transition: 'width 0.3s',
    },
  };

  if (updateState === 'available') {
    return (
      <div style={{ ...styles.banner, ...styles.available }}>
        <span>Ooplix {updateVersion} is available</span>
        <button style={styles.btn} onClick={downloadUpdate}>Download</button>
      </div>
    );
  }

  if (updateState === 'downloading') {
    return (
      <div style={{ ...styles.banner, ...styles.downloading }}>
        <span>Downloading update… {downloadPercent}%</span>
        <div style={styles.progress}>
          <div style={{ ...styles.bar, width: `${downloadPercent}%` }} />
        </div>
      </div>
    );
  }

  if (updateState === 'downloaded') {
    return (
      <div style={{ ...styles.banner, ...styles.downloaded }}>
        <span>Update ready — restart to install {updateVersion}</span>
        <button style={styles.btn} onClick={quitAndInstall}>Restart now</button>
      </div>
    );
  }

  if (updateState === 'error') {
    return (
      <div style={{ ...styles.banner, ...styles.error }}>
        <span>Update check failed</span>
      </div>
    );
  }

  return null;
}
