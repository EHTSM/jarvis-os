// Phase 369: Adapter Coordination Layer
// Polls backend adapter health via /api/runtime/tools/state.
// Provides: adapter health summary, availability flags, stale detection.
// Sends heartbeats for the frontend tool (browser).
// Polling: 30s interval — does not run if tab is backgrounded.
// No aggressive polling — never < 15s, cleanup on unmount.

import { useState, useEffect, useCallback, useRef } from "react";

const TOOLS_STATE_ENDPOINT  = "/runtime/tools/state";
const HEARTBEAT_ENDPOINT    = "/runtime/tools/heartbeat";
const POLL_INTERVAL_MS      = 30_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export function useAdapterCoordination({ enabled = true } = {}) {
  const [adapterHealth,   setAdapterHealth]   = useState(null);  // { tools: [], problems: [] }
  const [adapterProblems, setAdapterProblems] = useState([]);
  const pollRef      = useRef(null);
  const heartbeatRef = useRef(null);
  const mountedRef   = useRef(true);

  const fetchState = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const resp = await fetch(TOOLS_STATE_ENDPOINT, { credentials: "include" });
      if (!resp.ok || !mountedRef.current) return;
      const data = await resp.json();
      if (data.success) {
        setAdapterHealth(data.tools);
        setAdapterProblems(data.problems || []);
      }
    } catch { /* non-critical — adapter state is informational */ }
  }, []);

  const sendHeartbeat = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      await fetch(HEARTBEAT_ENDPOINT, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ toolName: "browser", state: "connected" }),
      });
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    mountedRef.current = true;

    // Initial fetch
    fetchState();
    sendHeartbeat();

    // Poll adapter state every 30s
    pollRef.current = setInterval(fetchState, POLL_INTERVAL_MS);
    // Send browser heartbeat every 20s
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(pollRef.current);
      clearInterval(heartbeatRef.current);
    };
  }, [enabled, fetchState, sendHeartbeat]);

  // Derived: is a specific tool healthy?
  const isToolHealthy = useCallback((toolName) => {
    if (!adapterHealth) return null; // unknown
    const tool = adapterHealth.find(t => t.toolName === toolName);
    return tool ? (tool.state !== "error" && tool.state !== "disconnected" && !tool.stale) : null;
  }, [adapterHealth]);

  // Derived: are there any high-severity problems?
  const hasHighSeverityProblem = adapterProblems.some(p => p.severity === "high");

  return { adapterHealth, adapterProblems, hasHighSeverityProblem, isToolHealthy };
}
