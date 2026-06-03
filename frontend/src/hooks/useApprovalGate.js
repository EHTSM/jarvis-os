// Phase 361: Operator Approval Gate
// Classifies commands as SAFE / CAUTION / CRITICAL.
// SAFE: auto-run allowed.
// CAUTION: operator confirmation required before dispatch.
// CRITICAL: manual approval mandatory — shows reasoning + rollback preview.
//
// Pure computation + local state. No external calls.

import { useState, useCallback, useMemo } from "react";

// Patterns that classify a command's approval level
const CRITICAL_PATTERNS = [
    /rm\s+-rf/i,
    /drop\s+(table|database)/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /git\s+push\s+.*--force/i,
    /format\b/i,
    /mkfs\b/i,
    /\bdd\s+if=/i,
];

const CAUTION_PATTERNS = [
    /git\s+push(?!\s+.*--force)/i,
    /pm2\s+(restart|delete|stop)/i,
    /npm\s+run\s+build/i,
    /\brm\s+/i,
    /\bkill\b/i,
    /\bpkill\b/i,
    /git\s+reset\s+--hard/i,
    /npm\s+install/i,
    /git\s+checkout\s+\./i,
];

// Human-readable explanations for operator visibility
const CRITICAL_REASONS = [
    { pattern: /rm\s+-rf/i,               reason: "Recursively deletes files — cannot be undone" },
    { pattern: /drop\s+(table|database)/i, reason: "Permanently destroys database objects" },
    { pattern: /\bshutdown\b|\breboot\b/i, reason: "Terminates the runtime environment" },
    { pattern: /git\s+push\s+.*--force/i,  reason: "Force-pushes overwrite remote history" },
];

const CAUTION_REASONS = [
    { pattern: /git\s+push/i,           reason: "Pushes commits to the remote — visible to others" },
    { pattern: /pm2\s+restart/i,        reason: "Interrupts the live backend runtime briefly" },
    { pattern: /npm\s+run\s+build/i,    reason: "Rebuilds frontend bundle — takes 10–60s" },
    { pattern: /\brm\s+/i,             reason: "Deletes files from the filesystem" },
    { pattern: /git\s+reset\s+--hard/i, reason: "Discards uncommitted changes permanently" },
];

export function classifyCommand(cmd) {
    if (!cmd) return { level: "safe", reason: null, rollbackHint: null };
    const trimmed = cmd.trim();

    for (const p of CRITICAL_PATTERNS) {
        if (p.test(trimmed)) {
            const match = CRITICAL_REASONS.find(r => r.pattern.test(trimmed));
            return {
                level:        "critical",
                reason:       match?.reason || "High-risk destructive operation",
                rollbackHint: "This action cannot be automatically undone. Ensure you have a backup before proceeding.",
            };
        }
    }

    for (const p of CAUTION_PATTERNS) {
        if (p.test(trimmed)) {
            const match = CAUTION_REASONS.find(r => r.pattern.test(trimmed));
            return {
                level:        "caution",
                reason:       match?.reason || "This command modifies system state",
                rollbackHint: null,
            };
        }
    }

    return { level: "safe", reason: null, rollbackHint: null };
}

/**
 * useApprovalGate — manages the approval lifecycle for a command.
 *
 * Returns:
 *   classification   — { level, reason, rollbackHint } for the current command
 *   approvalState    — "idle" | "pending" | "approved" | "rejected"
 *   requestApproval  — call when operator clicks Run on a CAUTION/CRITICAL cmd
 *   approve          — operator confirms
 *   reject           — operator cancels
 *   reset            — clear approval state (after dispatch completes)
 *   needsApproval    — boolean: true if this cmd requires a confirmation step
 */
export function useApprovalGate(cmd = "") {
    const [approvalState, setApprovalState] = useState("idle");

    const classification = useMemo(() => classifyCommand(cmd), [cmd]);

    const needsApproval = classification.level !== "safe";

    const requestApproval = useCallback(() => {
        if (classification.level === "safe") return; // nothing to gate
        setApprovalState("pending");
    }, [classification.level]);

    const approve = useCallback(() => {
        setApprovalState("approved");
    }, []);

    const reject = useCallback(() => {
        setApprovalState("rejected");
    }, []);

    const reset = useCallback(() => {
        setApprovalState("idle");
    }, []);

    return {
        classification,
        approvalState,
        needsApproval,
        requestApproval,
        approve,
        reject,
        reset,
    };
}
