import React, { useState, useRef, useEffect, useCallback } from "react";
import { emergencyStop, emergencyResume } from "../../api";
import { _fetch } from "../../_client";

// HoldButton — generic hold-to-confirm pattern, eliminates 3 duplicated inline patterns.
// Fires onConfirm once progress reaches 100%. All timers are ref-scoped (no window globals).
function HoldButton({ onConfirm, disabled, className, style, children, stepMs = 80, stepPct = 5, fillColor }) {
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);

  const start = useCallback(() => {
    if (disabled) return;
    setProgress(0);
    timerRef.current = setInterval(() => {
      setProgress(prev => {
        const next = prev + stepPct;
        if (next >= 100) {
          clearInterval(timerRef.current);
          onConfirm();
          return 100;
        }
        return next;
      });
    }, stepMs);
  }, [disabled, onConfirm, stepMs, stepPct]);

  const cancel = useCallback(() => {
    clearInterval(timerRef.current);
    setProgress(p => (p < 100 ? 0 : p));
  }, []);

  useEffect(() => () => clearInterval(timerRef.current), []);

  return (
    <button
      className={className}
      style={{ position: "relative", overflow: "hidden", ...style }}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      disabled={disabled}
    >
      <div className="op-hold-fill" style={{ width: `${progress}%`, background: fillColor }} />
      <span className="op-hold-label">{children}</span>
    </button>
  );
}

export default function GovernorPanel({ ops, onRefresh }) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [reason, setReason] = useState("");
  const resultTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(resultTimerRef.current), []);

  const isEmergency = ops?.status === "critical" ||
    (ops?.warnings ?? []).some(w => w.code === "EMERGENCY_ACTIVE");

  const showResult = useCallback((ok, text) => {
    clearTimeout(resultTimerRef.current);
    setResult({ ok, text });
    if (ok) resultTimerRef.current = setTimeout(() => setResult(null), 5000);
  }, []);

  const handleStop = useCallback(async () => {
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
    }
  }, [busy, reason, showResult, onRefresh]);

  const handleResume = useCallback(async () => {
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
  }, [busy, showResult, onRefresh]);

  const handleReboot = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await _fetch("/runtime/reboot", { method: "POST" });
      r.success ? showResult(true, "Rebooting…") : showResult(false, r.error || "Reboot failed");
    } catch (e) {
      showResult(false, e.message);
    } finally {
      setBusy(false);
    }
  }, [busy, showResult]);

  const activeTasks = ops?.queue?.counts?.active ?? 0;

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
            onChange={e => setReason(e.target.value)}
            disabled={busy}
            style={{ fontSize: 10, padding: "4px 6px" }}
          />
        )}

        <div className="op-governor-actions">
          {!isEmergency ? (
            <HoldButton
              className="op-btn-emergency"
              style={{ width: "100%" }}
              onConfirm={handleStop}
              disabled={busy}
              stepMs={80}
              stepPct={5}
              fillColor="rgba(255,68,68,0.3)"
            >
              HOLD TO STOP RUNTIME
            </HoldButton>
          ) : (
            <HoldButton
              className="op-btn ok"
              style={{ width: "100%" }}
              onConfirm={handleResume}
              disabled={busy}
              stepMs={100}
              stepPct={10}
              fillColor="rgba(0,255,163,0.2)"
            >
              HOLD TO RESUME
            </HoldButton>
          )}
        </div>

        <div className="op-gov-recovery">
          <div className="op-gov-recovery-header">
            <span>RECOVERY ASSURANCE</span>
            <span className={`op-gov-recovery-status ${activeTasks > 0 ? "active" : "safe"}`}>
              {activeTasks > 0 ? `⚠ ${activeTasks} ACTIVE` : "✓ READY"}
            </span>
          </div>

          <div className="op-gov-recovery-info">
            <span className="op-gov-recovery-title">SAFE INTERVENTION:</span>
            {activeTasks > 0
              ? "⚠ ACTIVE TASKS: Reboot will abandon running executions. Wait for idle if possible."
              : "✓ IDLE: Safe to reboot or maintenance."
            }
          </div>

          <HoldButton
            className="op-btn secondary"
            style={{ width: "100%", marginTop: 8, height: 28, fontSize: 10 }}
            onConfirm={handleReboot}
            disabled={busy}
            stepMs={100}
            stepPct={10}
            fillColor="rgba(255,255,255,0.1)"
          >
            SAFE REBOOT (HOLD)
          </HoldButton>
        </div>

        {(ops?.warnings ?? []).length > 0 && (
          <div className="op-gov-warnings">
            {ops.warnings.map((w, i) => (
              <div key={i} className={`op-error op-gov-warning ${w.level === "critical" ? "crit" : "warn"}`}>
                <span className="op-gov-warning-code">{w.code}</span>
                {w.detail && <span className="op-gov-warning-detail"> — {w.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className={`op-result-box ${result.ok ? "ok" : "err"}`} style={{ fontSize: 10, display: "flex", alignItems: "flex-start", gap: 4 }}>
            <span style={{ flex: 1 }}>{result.ok ? "✓ " : "✗ "}{result.text}</span>
            {!result.ok && (
              <button
                className="op-result-dismiss"
                onClick={() => setResult(null)}
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
