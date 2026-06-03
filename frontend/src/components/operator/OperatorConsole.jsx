import React, { useState, useEffect } from "react";
import { useRuntimeStream } from "../../hooks/useRuntimeStream";
import { useNotifications } from "../../hooks/useNotifications";
import { useAuth } from "../../contexts/AuthContext";
import ExecLogPanel    from "./ExecLogPanel";
import AIConsolePanel  from "./AIConsolePanel";
import AdapterPanel    from "./AdapterPanel";
import WorkflowPanel   from "./WorkflowPanel";
import GovernorPanel   from "./GovernorPanel";
import PluginManagerPanel from "./PluginManagerPanel";
import BrowserAutomationPanel from "./BrowserAutomationPanel";
import ErrorBoundary   from "../ErrorBoundary";
import { EmergencyModeBanner } from "./widgets/EmergencyModeBanner";
import { ConnectionStatusCard } from "./widgets/ConnectionStatusCard";
import { RuntimeHealthCard } from "./widgets/RuntimeHealthCard";
import { QueueStatusCard } from "./widgets/QueueStatusCard";
import { RecentFailuresPanel } from "./widgets/RecentFailuresPanel";
import { SessionContextCard } from "./widgets/SessionContextCard";
import { OperationalStatusBanner } from "./widgets/OperationalStatusBanner";
import { NotificationOverlay } from "./widgets/NotificationOverlay";
import { FirstRunSetup, shouldShowFirstRun } from "./widgets/FirstRunSetup";
import "./operator.css";

export default function OperatorConsole() {
  const [sessionRestored, setSessionRestored] = React.useState(false);
  const [showFirstRun, setShowFirstRun] = useState(shouldShowFirstRun);

  // Load persisted session state if available
  useEffect(() => {
    const saved = localStorage.getItem('operatorSession');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.pendingCmd) setPendingCmd(data.pendingCmd);
        if (data.lastCheck) setLastCheck(data.lastCheck);
        addNotification('Session restored from local storage.', 'ok', 3000);
        setSessionRestored(true);
      } catch {}
    }
  }, []);

  // Persist session state on changes
  useEffect(() => {
    const state = { pendingCmd, lastCheck };
    localStorage.setItem('operatorSession', JSON.stringify(state));
  }, [pendingCmd, lastCheck]);
  const { logout } = useAuth();
  const [mobileTab, setMobileTab] = useState("Log");
  const [pendingCmd, setPendingCmd] = useState("");
  const [lastCheck, setLastCheck] = useState(Date.now()); // Re-entry orientation anchor
  const { notifications, addNotification, removeNotification } = useNotifications();

  const {
    connectionState,
    streamMeta,
    authError,
    sseWarning,
    fetchErrors,
    forceRefresh,
    dismissWarning,
    data: { ops, rtStatus, history }
  } = useRuntimeStream();

  const reconnectNotifRef = React.useRef(0);

  // Trigger notifications on critical state changes
  useEffect(() => {
    const now = Date.now();
    const cooldownMs = 30000;

    if (connectionState === "reconnecting" && now - reconnectNotifRef.current > cooldownMs) {
      reconnectNotifRef.current = now;
      addNotification(`Connection lost. Retrying... (Attempt ${streamMeta.retryCount})`, "warn", 3000);
    } else if (connectionState === "connected" && streamMeta.retryCount > 0) {
      addNotification("Connection restored successfully.", "ok", 3000);
    } else if (connectionState === "offline") {
      addNotification("Runtime offline. Fallback polling active.", "crit", 0);
    }
  }, [connectionState, streamMeta.retryCount, addNotification]);

  const stats = React.useMemo(() => {
    const last20 = history.slice(0, 20);
    const failed = last20.filter(e => e.status === "failed" || e.status === "error");
    const success = last20.filter(e => e.status === "success" || e.status === "completed");
    
    // Safety: Find last successful backup
    const lastBackupEntry = history.find(e => (e.input || "").includes("backup") && (e.status === "success" || e.status === "completed"));
    const lastBackupMin = lastBackupEntry ? Math.floor((Date.now() - (lastBackupEntry.timestamp || lastBackupEntry.ts)) / 60000) : null;

    return {
      ratio: last20.length ? Math.round((success.length / last20.length) * 100) : 100,
      active: history.filter(e => e.status === "running" || e.status === "pending").length,
      stalled: history.filter(e => e.status === "running" && (Date.now() - (e.timestamp || e.ts)) > 60000).length,
      failCount: failed.length,
      lastBackupMin,
      total: history.length
    };
  }, [history]);

  useEffect(() => {
    if (authError === "expired") {
      addNotification("Authentication expired. Please sign in again.", "crit", 0);
    }
  }, [authError, addNotification]);

  return (
    <div className="operator-console" onClick={() => setLastCheck(Date.now())}>
      {showFirstRun && (
        <FirstRunSetup onComplete={() => setShowFirstRun(false)} rtStatus={rtStatus} />
      )}
      <NotificationOverlay notifications={notifications} removeNotification={removeNotification} />
      {sessionRestored && (
        <div className="op-session-restore" style={{color: 'var(--op-green)', padding: '4px 8px', background: 'var(--op-bg)', borderRadius: '4px', marginTop: '4px'}}>
          Session restored from local storage.
        </div>
      )}
      {connectionState === 'reconnecting' && (
        <div className="op-reconnect-badge" style={{color: 'var(--op-amber)', padding: '4px 8px', background: 'var(--op-bg)', borderRadius: '4px', marginTop: '4px'}}>
          Reconnecting… ({streamMeta.retryCount})
        </div>
      )}
      <OperationalStatusBanner
        stats={{
          ...stats,
          vitals: rtStatus?.vitals,
          runaway: rtStatus?.runaway
        }}
        emergency={rtStatus?.emergency}
      />

      {/* ── Session banners ───────────────────────────────────── */}
      {sseWarning === "expiring_soon" && authError !== "expired" && (
        <div className="op-session-banner warn">
          <span>Session expires in ~5 minutes — save your work and re-authenticate</span>
          <button onClick={dismissWarning}>Dismiss</button>
          <button onClick={logout}>Sign out</button>
        </div>
      )}
      {authError === "expired" && (
        <div className="op-session-banner expired">
          <span>Session expired — sign in again to continue</span>
          <button onClick={logout}>Sign out</button>
        </div>
      )}
      {authError === "unconfigured" && (
        <div className="op-session-banner">
          <span>Runtime auth not configured — set JWT_SECRET + OPERATOR_PASSWORD_HASH in .env</span>
        </div>
      )}

      {/* ── Mobile tab bar ──────────────────── */}
      <div className="op-tab-bar op-mobile-only">
        {["Status","Log","Workflow","Browser","Plugins"].map((t, i) => {
          const labels = ["Status","Activity","Run","Automate","Plugins"];
          return (
            <button
              key={t}
              className={`op-tab${mobileTab === t ? " active" : ""}`}
              onClick={() => setMobileTab(t)}
            >{labels[i]}</button>
          );
        })}
      </div>

      <div className="op-main-container">
        {/* ── Main Grid ────────────────────────────────────────────── */}
        <div className="op-grid">

          {/* Col 1 (Left): Health & Telemetry Widgets */}
          <div className={`op-col-left${mobileTab !== "Status" ? " op-mobile-hide" : ""}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
            <div className="op-widget-card op-sidebar-overview">
              <div className="op-widget-header">
                <span>Your workspace</span>
                <span className={`op-stat-value ${connectionState === "connected" ? "ok" : "warn"}`} style={{ fontSize: 9 }}>
                  {connectionState === "connected" ? "Live" : connectionState === "reconnecting" ? "Reconnecting…" : "Offline"}
                </span>
              </div>
              <div className="op-widget-content">
                <div className="op-sidebar-summary">
                  <div className="op-sidebar-metric">
                    <div className="op-sidebar-metric-label">Running</div>
                    <div className="op-sidebar-metric-value">{stats.active}</div>
                  </div>
                  <div className="op-sidebar-metric">
                    <div className="op-sidebar-metric-label">Done today</div>
                    <div className={`op-sidebar-metric-value${stats.ratio >= 80 ? " done-today" : ""}`}>{stats.total}</div>
                  </div>
                  <div className="op-sidebar-metric">
                    <div className="op-sidebar-metric-label">Failed</div>
                    <div className="op-sidebar-metric-value" style={{ color: stats.failCount > 0 ? "var(--op-amber)" : undefined }}>{stats.failCount}</div>
                  </div>
                </div>
                {stats.active === 0 && stats.failCount === 0 && (
                  <div style={{ fontSize: 9, color: "var(--op-green)", marginTop: 6, opacity: 0.85 }}>✓ Everything is running well</div>
                )}
              </div>
            </div>
            <ErrorBoundary label="ConnectionStatus">
              <ConnectionStatusCard connectionState={connectionState} streamMeta={streamMeta} fetchErrors={fetchErrors} />
            </ErrorBoundary>
            <ErrorBoundary label="RuntimeHealth">
              <RuntimeHealthCard ops={ops} />
            </ErrorBoundary>
            <ErrorBoundary label="QueueStatus">
              <QueueStatusCard ops={ops} />
            </ErrorBoundary>
            <ErrorBoundary label="RecentFailures">
              <RecentFailuresPanel history={history} />
            </ErrorBoundary>
            <ErrorBoundary label="Adapters">
              <AdapterPanel rtStatus={rtStatus} services={ops?.services} />
            </ErrorBoundary>
          </div>

          {/* Col 2 (Mid): Execution History */}
          <div className={`op-col-mid${mobileTab !== "Log" ? " op-mobile-hide" : ""}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            <ErrorBoundary label="ExecLog">
              <ExecLogPanel 
                history={history} 
                rtStatus={rtStatus} 
                ops={ops} 
                onPopulateInput={setPendingCmd} 
                lastCheck={lastCheck} 
              />
            </ErrorBoundary>
          </div>

          {/* Col 3 (Right): Control Center */}
          <div className={`op-col-right${mobileTab !== "Workflow" ? " op-mobile-hide" : ""}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
            <ErrorBoundary label="SessionContext">
              <SessionContextCard history={history} ops={ops} lastCheck={lastCheck} />
            </ErrorBoundary>
            <ErrorBoundary label="Workflow">
              <WorkflowPanel 
                onRefresh={forceRefresh} 
                addNotification={addNotification}
                onAction={(cmd) => setPendingCmd(cmd)}
                externalInput={pendingCmd}
                onClearExternal={() => setPendingCmd("")}
              />
            </ErrorBoundary>
            <ErrorBoundary label="Governor">
              <GovernorPanel ops={ops} onRefresh={forceRefresh} />
            </ErrorBoundary>
            <ErrorBoundary label="AIConsole">
              <AIConsolePanel addNotification={addNotification} />
            </ErrorBoundary>
            <ErrorBoundary label="Plugins">
              <PluginManagerPanel />
            </ErrorBoundary>
          </div>

        </div>

        {/* Browser Automation — full-width below the main grid, hidden on mobile unless "Browser" tab active */}
        <div className={`op-browser-row${mobileTab !== "Browser" ? " op-mobile-hide" : ""}`}>
          <ErrorBoundary label="BrowserAutomation">
            <BrowserAutomationPanel addNotification={addNotification} />
          </ErrorBoundary>
        </div>

      </div>
    </div>
  );
}
