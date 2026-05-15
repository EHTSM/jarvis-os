"use strict";

// ── Policy requirements per classification ────────────────────────────

const POLICY_REQUIREMENTS = {
    safe:        { approvalGate: false, sandboxRequired: false, dryRunRequired: false, rollbackRequired: false },
    elevated:    { approvalGate: false, sandboxRequired: false, dryRunRequired: false, rollbackRequired: true  },
    dangerous:   { approvalGate: true,  sandboxRequired: true,  dryRunRequired: true,  rollbackRequired: true  },
    destructive: { approvalGate: true,  sandboxRequired: true,  dryRunRequired: true,  rollbackRequired: true  },
};

function getRequirements(classification) {
    return POLICY_REQUIREMENTS[classification] ?? POLICY_REQUIREMENTS.safe;
}

function evaluate(classification, context = {}) {
    const req = getRequirements(classification);
    const violations = [];

    if (req.approvalGate && !context.approved) {
        violations.push({ rule: "approvalGate", reason: `${classification} commands require explicit approval` });
    }
    if (req.sandboxRequired && !context.sandboxed) {
        violations.push({ rule: "sandboxRequired", reason: `${classification} commands must run in sandbox` });
    }
    if (req.dryRunRequired && !context.dryRunPassed) {
        violations.push({ rule: "dryRunRequired", reason: `${classification} commands must pass a dry-run first` });
    }
    if (req.rollbackRequired && !context.rollbackReady) {
        violations.push({ rule: "rollbackRequired", reason: `${classification} commands require rollback checkpoint` });
    }

    return {
        classification,
        requirements: req,
        violations,
        approved: violations.length === 0,
    };
}

function canProceed(classification, context = {}) {
    return evaluate(classification, context).approved;
}

module.exports = { POLICY_REQUIREMENTS, getRequirements, evaluate, canProceed };
