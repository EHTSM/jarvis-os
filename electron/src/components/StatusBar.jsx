import React from 'react';
import './StatusBar.css';

function StatusBar({ serverHealthy, onToggleFloatingWindow }) {
  return (
    <div className="status-bar">
      <div className="status-indicator">
        <div className={`status-dot ${serverHealthy ? 'healthy' : 'unhealthy'}`}></div>
        <span className="status-text">
          {serverHealthy ? '✓ Server Connected' : '✗ Server Offline'}
        </span>
      </div>

      <div className="status-info">
        <span className="status-detail">Ready</span>
      </div>

      <div className="status-bar-actions">
        <button
          className="icon-btn"
          onClick={onToggleFloatingWindow}
          title="Open floating window (Cmd+Shift+F)"
        >
          ◆
        </button>
        
        <button
          className="icon-btn"
          title="Settings"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}

export default StatusBar;
