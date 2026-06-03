// Phase 366: Execution Validation
// Calls the backend /runtime/verify endpoint after dispatch.
// Records validation outcomes to the execution graph.
// Surfaces false-positive warnings to the operator.
// Pure async logic — no render-phase computations.

import { useCallback, useState } from "react";
import { recordValidationOutcome } from "../../hooks/useExecutionGraph";

const VERIFY_ENDPOINT = "/api/runtime/verify";

/**
 * useExecutionValidation
 *
 * @param {Function} addNotification
 */
export function useExecutionValidation({ addNotification } = {}) {
  const [lastValidation, setLastValidation] = useState(null);

  const verify = useCallback(async (cmd, result) => {
    if (!cmd || !result) return null;
    try {
      const resp = await fetch(VERIFY_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cmd, result }),
      });
      if (!resp.ok) return null;
      const validation = await resp.json();
      setLastValidation(validation);

      // Record to execution graph for historical pattern analysis
      recordValidationOutcome(cmd, {
        verified:      validation.verified,
        falsePositive: validation.falsePositive,
        summary:       validation.summary,
      });

      // Alert operator on false positive
      if (validation.falsePositive) {
        addNotification?.(
          `⚠ Verification failed after apparent success: ${cmd.slice(0, 30)}`,
          "warn"
        );
      }
      return validation;
    } catch {
      return null; // verification is best-effort — never block execution
    }
  }, [addNotification]);

  const clearValidation = useCallback(() => setLastValidation(null), []);

  return { lastValidation, verify, clearValidation };
}
