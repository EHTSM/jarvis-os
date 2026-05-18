import React, { useState, useRef, useEffect } from "react";
import { emergencyStop, emergencyResume } from "../../api";

/**
 * GovernorPanel - Production safety control center.
 * Implements "Hold-to-Stop" logic to prevent accidental deployment halts on touch devices.
 */
export default function GovernorPanel({ ops, onRefresh }) {
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [reason,  setReason]  = useState("");
  const [holdProgress, setHoldProgress] = useState(0);
  const [resumeHold,   setResumeHold]   = useState(0);
  const [rebootHold,   setRebootHold]   = useState(0);

  const holdTimer = useRef(null);

  // Detect emergency state from ops warnings
  const isEmergency = ops?.status === "critical" ||
    (ops?.warnings ?? []).some(w => w.code === "EMERGENCY_ACTIVE");

  const showResult = (ok, text) => {
    setResult({ ok, text });
    if (ok) setTimeout(() => setResult(null), 5000);
  };

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await emergencyStop(reason.trim() || "operator_initiated");
      r.success || r.alreadyActive
        ? showResult(true, r.alreadyActive ? "Already active" : `Emergency declared — ${r.emergencyId || "ok"}`)
        : showResult(false, r.error || "Stop failed");
    } catch (e) {
      showResult(false, e.message);
    } finally {
      setBusy(false);
      onRefresh?.();
      setHoldProgress(0);
    }
  };

  const startHold = () => {
    if (busy || isEmergency) return;
    setHoldProgress(0);
    holdTimer.current = setInterval(() => {
      setHoldProgress(prev => {
        if (prev >= 100) {
          clearInterval(holdTimer.current);
          handleStop();
          return 100;
        }
        return prev + 5; // ~1.6s total hold time
      });
    }, 80);
  };

  const endHold = () => {
    clearInterval(holdTimer.current);
    if (holdProgress < 100) setHoldProgress(0);
  };

  useEffect(() => () => clearInterval(holdTimer.current), []);

  const handleResume = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await emergencyResume();
      r.success || r.resolved
        ? showResult(true, "Execution resumed")
        : showResult(false, r.error || "Resume failed");
    } catch (e) {
      showResult(false, e.message);
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  const handleReboot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await _fetch("/runtime/reboot", { method: "POST" });
      r.success ? showResult(true, "Rebooting...") : showResult(false, r.error || "Reboot failed");
    } catch (e) { showResult(false, e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="op-panel">
      <div className="op-panel-header">
        <span className="op-panel-title">Governor</span>
        <span className="op-panel-meta" style={{ color: isEmergency ? "var(--op-red)" : "var(--op-green)" }}>
          {isEmergency ? "● EMERGENCY" : "● NORMAL"}
        </span>
      </div>
      <div className="op-governor-body">
        <div className={`op-governor-state ${isEmergency ? "active" : ""}`}>
          <span className={`op-governor-label ${isEmergency ? "active" : "idle"}`}>
            {isEmergency ? "⚠ EXECUTION HALTED" : "✓ Execution active"}
          </span>
        </div>

        {!isEmergency && (
          <input
            className="op-text-input"
            type="text"
            placeholder="Stop reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            style={{ fontSize: 10, padding: "4px 6px" }}
          />
        )}

        <div className="op-governor-actions">
          {!isEmergency ? (
            <button
              className="op-btn-emergency"
              onMouseDown={startHold}
              onMouseUp={endHold}
              onMouseLeave={endHold}
              onTouchStart={startHold}
              onTouchEnd={endHold}
              style={{ position: "relative", overflow: "hidden" }}
            >
              <div className="op-hold-bg" style={{ width: `${holdProgress}%`, position: "absolute", left: 0, top: 0, height: "100%", background: "rgba(255,68,68,0.3)" }} />
              <span style={{ position: "relative", zIndex: 1 }}>HOLD TO STOP RUNTIME</span>
            </button>
          ) : (
            <button 
              className="op-btn ok" 
              style={{ width: "100%", position: "relative", overflow: "hidden" }}
              onMouseDown={() => {
                const timer = setInterval(() => {
                  setResumeHold(prev => {
                    if (prev >= 100) { clearInterval(timer); handleResume(); return 100; }
                    return prev + 10;
                  });
                }, 100);
                window._resumeTimer = timer;
              }}
              onMouseUp={() => { clearInterval(window._resumeTimer); setResumeHold(0); }}
              onMouseLeave={() => { clearInterval(window._resumeTimer); setResumeHold(0); }}
            >
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: "rgba(0,255,163,0.2)", width: `${resumeHold}%` }} />
              <span style={{ position: "relative", zIndex: 1 }}>HOLD TO RESUME</span>
            </button>
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--op-border)", paddingTop: 12 }}>
          <div style={{ fontSize: 9, color: "var(--op-text2)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <span>RECOVERY ASSURANCE</span>
            <span style={{ color: "var(--op-green)" }}>✓ READY</span>
          </div>
          
          <div style={{ 
            fontSize: 9, 
            background: "rgba(0,0,0,0.2)", 
            padding: "6px 8px", 
            borderRadius: 4, 
            border: "1px solid var(--op-border)",
            lineHeight: 1.4
          }}>
            <span style={{ fontWeight: "bold", color: "var(--op-text2)", display: "block", marginBottom: 2 }}>SAFE INTERVENTION:</span>
            {ops?.queue?.counts?.active > 0 
              ? "⚠ ACTIVE TASKS: Reboot will abandon running executions. Wait for idle if possible."
              : "✓ IDLE: Safe to reboot or maintenance."
            }
          </div>

          <button 
            className="op-btn secondary" 
            style={{ width: "100%", marginTop: 8, height: 28, position: "relative", overflow: "hidden", fontSize: 10 }}
            onMouseDown={() => {
              const timer = setInterval(() => {
                setRebootHold(prev => {
                  if (prev >= 100) { clearInterval(timer); handleReboot(); return 100; }
                  return prev + 10;
                });
              }, 100);
              window._rebootTimer = timer;
            }}
            onMouseUp={() => { clearInterval(window._rebootTimer); setRebootHold(0); }}
            onMouseLeave={() => { clearInterval(window._rebootTimer); setRebootHold(0); }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: "rgba(255,255,255,0.1)", width: `${rebootHold}%` }} />
            SAFE REBOOT (HOLD)
          </button>
        </div>

        {/* Warnings from ops */}
        {(ops?.warnings ?? []).length > 0 && (
          <div style={{ marginTop: 2 }}>
            {ops.warnings.map((w, i) => (
              <div key={i} className="op-error" style={{
                marginBottom: 3,
                fontSize: 10,
                color: w.level === "critical" ? "var(--op-red)" : "var(--op-amber)",
                borderColor: w.level === "critical" ? "rgba(255,68,68,0.3)" : "rgba(255,179,0,0.3)",
                background: w.level === "critical" ? "rgba(255,68,68,0.06)" : "rgba(255,179,0,0.06)",
                lineHeight: 1.4,
              }}>
                <span style={{ fontWeight: 700 }}>{w.code}</span>
                {w.detail && <span style={{ opacity: 0.8 }}> — {w.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className={`op-result-box ${result.ok ? "ok" : "err"}`} style={{ fontSize: 10, display: "flex", alignItems: "flex-start", gap: 4 }}>
            <span style={{ flex: 1 }}>{result.ok ? "✓ " : "✗ "}{result.text}</span>
            {!result.ok && (
              <button
                onClick={() => setResult(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 2px", fontSize: 12, lineHeight: 1, opacity: 0.7 }}
                title="Dismiss"
                aria-label="Dismiss error"
              >×</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
