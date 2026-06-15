// Phase 366: Recovery Coordinator (frontend)
// Bridges the backend recoveryOrchestrator via /api/runtime/recover.
// Tracks recovery state: idle → recovering → recovered | failed.
// Bounded: only one recovery per failed cmd at a time.
// No infinite loops: recovery state is cleared on next successful dispatch.

import { useCallback, useState } from "react";

const RECOVER_ENDPOINT = "/runtime/recover";

export function useRecoveryCoordinator({ addNotification } = {}) {
  const [recoveryState, setRecoveryState] = useState("idle"); // "idle" | "recovering" | "recovered" | "failed"
  const [recoveryTarget, setRecoveryTarget] = useState(null); // cmd being recovered

  const recover = useCallback(async (cmd, originalError) => {
    if (!cmd || recoveryState === "recovering") return null;
    setRecoveryState("recovering");
    setRecoveryTarget(cmd);
    addNotification?.(`↺ Auto-recovery triggered for: ${cmd.slice(0, 30)}`, "info");

    try {
      const resp = await fetch(RECOVER_ENDPOINT, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ input: cmd, originalError: originalError || "" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.recovered) {
        setRecoveryState("recovered");
        addNotification?.(`✓ Recovered: ${cmd.slice(0, 30)}`, "ok");
      } else {
        setRecoveryState("failed");
        addNotification?.(`✗ Recovery failed: ${data.error || "unknown"}`, "warn");
      }
      return data;
    } catch (e) {
      setRecoveryState("failed");
      addNotification?.(`Recovery error: ${e.message.slice(0, 40)}`, "warn");
      return null;
    }
  }, [recoveryState, addNotification]);

  const clearRecovery = useCallback(() => {
    setRecoveryState("idle");
    setRecoveryTarget(null);
  }, []);

  return { recoveryState, recoveryTarget, recover, clearRecovery };
}
