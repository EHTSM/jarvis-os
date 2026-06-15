// Phase 93: Anonymous local-only beta telemetry.
// No external calls. Captures startup success, crash count, reconnect frequency,
// recovery success. Written to localStorage, readable via /runtime/telemetry/startup.
import { useEffect, useRef } from "react";

const TEL_KEY     = "jarvis_beta_telemetry";
const MAX_ENTRIES = 100;

function _loadLog() {
  try { return JSON.parse(localStorage.getItem(TEL_KEY) || "[]"); }
  catch { return []; }
}

function _appendEvent(evt) {
  try {
    const log = _loadLog();
    log.unshift({ ...evt, ts: new Date().toISOString() });
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    localStorage.setItem(TEL_KEY, JSON.stringify(log));
  } catch {}
}

export function useBetaTelemetry({ connectionState, streamMeta, runtimeDegraded }) {
  const sessionStartRef    = useRef(Date.now());
  const reconnectCountRef  = useRef(0);
  const recoveredRef       = useRef(false);
  const startupLoggedRef   = useRef(false);

  // Log startup success once on first connected state
  useEffect(() => {
    if (connectionState === "connected" && !startupLoggedRef.current) {
      startupLoggedRef.current = true;
      _appendEvent({
        type:        "startup_success",
        durationMs:  Date.now() - sessionStartRef.current,
      });
    }
  }, [connectionState]);

  // Count reconnects
  useEffect(() => {
    if (connectionState === "reconnecting") reconnectCountRef.current++;
    if (connectionState === "connected" && reconnectCountRef.current > 0 && !recoveredRef.current) {
      recoveredRef.current = true;
      _appendEvent({
        type:          "reconnect_recovery",
        attempts:      reconnectCountRef.current,
        recoveryMs:    Date.now() - sessionStartRef.current,
      });
    }
  }, [connectionState]);

  // Log degraded-mode events
  const degradedLoggedRef = useRef(false);
  useEffect(() => {
    if (runtimeDegraded && !degradedLoggedRef.current) {
      degradedLoggedRef.current = true;
      _appendEvent({ type: "degraded_mode_entered" });
    } else if (!runtimeDegraded && degradedLoggedRef.current) {
      degradedLoggedRef.current = false;
      _appendEvent({ type: "degraded_mode_exited" });
    }
  }, [runtimeDegraded]);
}

// Used by FeedbackPanel to attach recent telemetry to feedback
export function getRecentTelemetry(n = 20) {
  return _loadLog().slice(0, n);
}

export function appendTelemetryEvent(evt) {
  _appendEvent(evt);
}

// Phase 105: capture renderer crash with memory + connection state context
export function captureRendererCrash({ source, message, stack, connectionState, heapMb }) {
  const report = { type: "renderer_crash", source, message, stack, connectionState, heapMb };
  _appendEvent(report);

  // Ship to Electron main for persistent storage if available
  if (window.electronAPI?.reportCrash) {
    window.electronAPI.reportCrash({ source, message: (message || "").slice(0, 200), stack: (stack || "").slice(0, 800) }).catch(() => {});
  }

  // Best-effort POST to backend
  fetch("/runtime/feedback", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ category: "Crash", message: `[AUTO] ${source}: ${(message || "").slice(0, 200)}`, connectionState }),
  }).catch(() => {});
}
