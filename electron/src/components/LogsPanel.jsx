import React from 'react';
import './LogsPanel.css';

function LogsPanel({ logs }) {
  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'pending':
        return '⏳';
      default:
        return '📋';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'pending':
        return 'pending';
      default:
        return 'default';
    }
  };

  return (
    <div className="logs-panel">
      {logs.length === 0 ? (
        <div className="empty-logs">
          <div className="empty-icon">📋</div>
          <div className="empty-text">No logs yet</div>
          <div className="empty-hint">Task history will appear here</div>
        </div>
      ) : (
        <div className="logs-list">
          {/* Show newest first */}
          {[...logs].reverse().map((log) => (
            <div key={log.id} className={`log-entry log-${getStatusColor(log.status)}`}>
              <div className="log-header">
                <span className="log-status-icon">
                  {getStatusIcon(log.status)}
                </span>
                <span className="log-action">{log.action}</span>
                <span className="log-time">
                  {log.timestamp.toLocaleTimeString()}
                </span>
              </div>
              
              <div className="log-details">
                {typeof log.details === 'string' ? (
                  <div className="log-detail-text">{log.details}</div>
                ) : (
                  <div className="log-detail-json">
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </div>
                )}
              </div>

              {log.status === 'pending' && (
                <div className="log-loading-bar">
                  <div className="progress"></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LogsPanel;
