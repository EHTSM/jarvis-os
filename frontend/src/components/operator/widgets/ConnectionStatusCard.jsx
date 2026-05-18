import React from "react";

function fmtStreamAge(lastBeat) {
  if (!lastBeat) return "—";
  const secs = Math.floor((Date.now() - lastBeat) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m`;
}

export const ConnectionStatusCard = React.memo(({ connectionState, streamMeta, fetchErrors }) => {
  const isConnected = connectionState === "connected";
  const streamAge = fmtStreamAge(streamMeta.lastBeat);
  
  return (
    <div className="op-widget-card connection-card">
      <div className="op-widget-header">
        <div className={`op-pulse ${isConnected ? "" : connectionState === "reconnecting" ? "reconnecting" : "offline"}`} />
        <span>Stream Status</span>
      </div>
      
      <div className="op-widget-content">
        <div className="op-metric">
          <span className="label">State</span>
          <span className={`value ${isConnected ? "ok" : connectionState === "reconnecting" ? "warn" : "crit"}`}>
            {isConnected ? "LIVE" : connectionState.toUpperCase()}
          </span>
        </div>
        
        <div className="op-metric">
          <span className="label">Last Beat</span>
          <span className="value dim">{streamAge}</span>
        </div>
        
        {!isConnected && streamMeta.retryCount > 0 && (
          <div className="op-metric" style={{ marginTop: '0.5rem' }}>
            <span className="label">Retries</span>
            <span className="value warn">
              Attempt {streamMeta.retryCount} (Next: {Math.round(streamMeta.retryDelayMs / 1000)}s)
            </span>
          </div>
        )}

        {Object.values(fetchErrors).some(Boolean) && (
          <div className="op-metric" style={{ marginTop: '0.5rem' }}>
            <span className="label">Fetch Error</span>
            <span className="value crit">⚠ API Unreachable</span>
          </div>
        )}
      </div>
    </div>
  );
});
