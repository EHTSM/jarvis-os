import React, { useState, useEffect, useRef } from "react";

export const ConnectionStatusCard = React.memo(({ connectionState, streamMeta, fetchErrors, degraded }) => {
  const isConnected    = connectionState === "connected";
  const isReconnecting = connectionState === "reconnecting";
  const isOffline      = connectionState === "offline";

  // Phase 151: track recovery outcome — flash "Reconnected!" on successful recovery
  const [recoveryFlash, setRecoveryFlash] = useState(false);
  const prevStateRef = useRef(connectionState);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = connectionState;
    if (isConnected && (prev === "reconnecting" || prev === "offline")) {
      setRecoveryFlash(true);
      const t = setTimeout(() => setRecoveryFlash(false), 3000);
      return () => clearTimeout(t);
    }
  }, [connectionState, isConnected]);

  // Live beat-age counter — ticks every second so operator sees heartbeat freshness
  const [beatAge, setBeatAge] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setBeatAge(streamMeta.lastBeat ? Math.floor((Date.now() - streamMeta.lastBeat) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [streamMeta.lastBeat]);

  // Countdown to next reconnect attempt
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (!isReconnecting || !streamMeta.retryDelayMs) { setCountdown(0); return; }
    const end = Date.now() + streamMeta.retryDelayMs;
    setCountdown(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    const id = setInterval(() => {
      const rem = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setCountdown(rem);
      if (rem === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [isReconnecting, streamMeta.retryDelayMs, streamMeta.retryCount]);

  const beatStale = beatAge > 45;   // heartbeat every 30s — stale if >45s

  const fmtAge = (s) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;

  return (
    <div className="op-widget-card connection-card">
      <div className="op-widget-header">
        <div className={`op-pulse ${isConnected ? "" : isReconnecting ? "reconnecting" : "offline"}`} />
        <span>Connection</span>
        <span style={{ marginLeft: "auto", fontWeight: 600, fontSize: 10,
          color: isConnected ? "var(--op-green)" : isReconnecting ? "var(--op-amber)" : "var(--op-red)"
        }}>
          {recoveryFlash ? "✓ Back online" : isConnected ? "Live" : isReconnecting ? "Reconnecting…" : "Offline"}
        </span>
      </div>

      <div className="op-widget-content">
        <div className="op-metric">
          <span className="label">State</span>
          <span className={`value ${isConnected ? "ok" : isReconnecting ? "warn" : "crit"} ${recoveryFlash ? "op-recovery-success" : ""}`}
            aria-live="polite"
          >
            {recoveryFlash ? "✓ Back online" : isConnected ? "Live" : connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
          </span>
        </div>
        {/* reconnect confidence summary */}
        {isConnected && streamMeta.retryCount > 0 && !recoveryFlash && (
          <div className="op-conn-retry-count">
            Recovered after {streamMeta.retryCount} attempt{streamMeta.retryCount > 1 ? "s" : ""}
          </div>
        )}

        <div className="op-metric">
          <span className="label">Last Beat</span>
          <span className={`value ${beatStale ? "warn" : "dim"}`}>
            {streamMeta.lastBeat ? fmtAge(beatAge) : "—"}
            {beatStale && " ⚠"}
          </span>
        </div>

        {/* calmer reconnect language */}
        {isReconnecting && (
          <div className="op-metric">
            <span className="label">Retry in</span>
            <span className="value warn">
              {countdown > 0 ? `${countdown}s` : "connecting…"} ({streamMeta.retryCount} attempt{streamMeta.retryCount !== 1 ? "s" : ""})
            </span>
          </div>
        )}

        {isOffline && (
          <div className="op-metric">
            <span className="label">Mode</span>
            <span className="value warn">Polling (backup)</span>
          </div>
        )}

        {degraded && (
          <>
            <div className="op-metric" style={{ marginTop: "0.5rem" }}>
              <span className="label">Runtime</span>
              <span className="value warn">High memory</span>
            </div>
            <div className="op-conn-note">
              Memory is elevated — some background events are paused to keep things stable. This usually resolves on its own.
            </div>
          </>
        )}

        {isOffline && (
          <div className="op-conn-note">
            Live stream is paused. Results are still arriving via backup polling — you won't miss anything.
          </div>
        )}

        {/* calmer multi-retry language */}
        {isReconnecting && streamMeta.retryCount > 3 && streamMeta.retryCount < 5 && (
          <div className="op-conn-retry-note">
            Still trying to reconnect. This often resolves within 30 seconds after a network change.
          </div>
        )}

        {/* guided recovery — only at attempt 5+, plain language */}
        {isReconnecting && streamMeta.retryCount >= 5 && (
          <div className="op-conn-guidance">
            The connection is taking longer than usual. Here's what to try:
            <div style={{ marginTop: 3 }}>1. Check the server is running: <code>pm2 list</code></div>
            <div>2. View recent logs: <code>pm2 logs jarvis-backend --lines 20</code></div>
            <div>3. Restart if needed: <code>pm2 restart jarvis-backend</code></div>
          </div>
        )}

        {isOffline && (
          <div className="op-conn-guidance">
            Live connection is offline — backup polling is active so you can still run commands. If things seem stuck, check <code>/api/health</code> or restart the backend: <code>pm2 restart jarvis-backend</code>
          </div>
        )}

        {Object.values(fetchErrors).some(Boolean) && (
          <div className="op-metric" style={{ marginTop: "0.5rem" }}>
            <span className="label">API</span>
            <span className="value warn">Unreachable</span>
          </div>
        )}
      </div>
    </div>
  );
});
