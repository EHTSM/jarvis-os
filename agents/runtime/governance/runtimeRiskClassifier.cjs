"use strict";
/**
 * runtimeRiskClassifier — deterministic risk classification of runtime actions
 * and workflows, with override support and risk profile queries.
 *
 * classifyAction(spec)     → { classified, classId, action, riskClass }
 * classifyWorkflow(spec)   → { classified, classId, workflowId, riskClass }
 * overrideRiskClass(spec)  → { overridden, classId, oldClass, newClass }
 * getRiskProfile(id)       → RiskProfile | { found: false }
 * getRiskMetrics()         → RiskMetrics
 * reset()
 *
 * Risk classes (least → most): safe → guarded → elevated → critical → restricted
 */

const RISK_CLASSES = ["safe", "guarded", "elevated", "critical", "restricted"];
const RISK_RANK    = Object.fromEntries(RISK_CLASSES.map((c, i) => [c, i]));

// Static action → base risk class mapping
const ACTION_RISK_MAP = {
    observe:     "safe",
    schedule:    "safe",
    execute:     "guarded",
    admit:       "guarded",
    degrade:     "elevated",
    isolate:     "elevated",
    failover:    "critical",
    quarantine:  "critical",
    govern:      "restricted",
    root_access: "restricted",
};

let _classifications = new Map();   // classId → ClassRecord
let _idIndex         = new Map();   // `action:${action}` or `workflow:${workflowId}` → classId
let _counter         = 0;

// ── classifyAction ────────────────────────────────────────────────────

function classifyAction(spec = {}) {
    const { action = null } = spec;
    if (!action) return { classified: false, reason: "action_required" };

    const baseClass = ACTION_RISK_MAP[action];
    if (!baseClass) return { classified: false, reason: `unknown_action: ${action}` };

    const classId = `class-${++_counter}`;
    const key     = `action:${action}`;
    const record  = { classId, type: "action", id: action, riskClass: baseClass, overridden: false, classifiedAt: new Date().toISOString() };
    _classifications.set(classId, record);
    _idIndex.set(key, classId);

    return { classified: true, classId, action, riskClass: baseClass };
}

// ── classifyWorkflow ──────────────────────────────────────────────────

function classifyWorkflow(spec = {}) {
    const {
        workflowId    = null,
        recoveryMode  = false,
        errorRate     = 0,
        cascadeDepth  = 0,
        isolated      = false,
        priority      = 5,
        hasApproval   = false,
    } = spec;

    if (!workflowId) return { classified: false, reason: "workflowId_required" };

    // Determine risk class from highest-severity factor
    let riskClass  = "safe";
    const factors  = [];

    if (priority >= 9)       { riskClass = _max(riskClass, "guarded");   factors.push("high_priority"); }
    if (recoveryMode)        { riskClass = _max(riskClass, "elevated");  factors.push("recovery_mode"); }
    if (isolated)            { riskClass = _max(riskClass, "elevated");  factors.push("isolated"); }
    if (errorRate >= 0.3)    { riskClass = _max(riskClass, "elevated");  factors.push("elevated_error_rate"); }
    if (errorRate >= 0.5)    { riskClass = _max(riskClass, "critical");  factors.push("high_error_rate"); }
    if (cascadeDepth >= 2)   { riskClass = _max(riskClass, "elevated");  factors.push("cascade_risk"); }
    if (cascadeDepth >= 3)   { riskClass = _max(riskClass, "critical");  factors.push("deep_cascade"); }

    const classId = `class-${++_counter}`;
    const key     = `workflow:${workflowId}`;
    const record  = { classId, type: "workflow", id: workflowId, riskClass, factors, overridden: false, classifiedAt: new Date().toISOString() };
    _classifications.set(classId, record);
    _idIndex.set(key, classId);

    return { classified: true, classId, workflowId, riskClass, factors };
}

function _max(a, b) {
    return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// ── overrideRiskClass ─────────────────────────────────────────────────

function overrideRiskClass(spec = {}) {
    const { classId = null, newClass = null, reason = "manual_override" } = spec;
    if (!classId)  return { overridden: false, reason: "classId_required" };
    if (!newClass) return { overridden: false, reason: "newClass_required" };
    if (!RISK_CLASSES.includes(newClass))
        return { overridden: false, reason: `invalid_risk_class: ${newClass}` };

    const rec = _classifications.get(classId);
    if (!rec) return { overridden: false, reason: "classification_not_found" };

    const oldClass  = rec.riskClass;
    rec.riskClass   = newClass;
    rec.overridden  = true;
    rec.overrideReason = reason;

    return { overridden: true, classId, oldClass, newClass, reason };
}

// ── getRiskProfile ────────────────────────────────────────────────────

function getRiskProfile(id) {
    if (!id) return { found: false, reason: "id_required" };

    // Try both action and workflow keys
    const classId = _idIndex.get(`action:${id}`) ?? _idIndex.get(`workflow:${id}`);
    if (!classId) return { found: false, id };

    const rec = _classifications.get(classId);
    return { found: true, ...rec };
}

// ── getRiskMetrics ────────────────────────────────────────────────────

function getRiskMetrics() {
    const all    = [..._classifications.values()];
    const byClass = {};
    for (const c of RISK_CLASSES) byClass[c] = 0;
    for (const r of all) byClass[r.riskClass]++;

    return {
        totalClassifications: all.length,
        overriddenCount:      all.filter(r => r.overridden).length,
        byClass,
        highRiskCount: all.filter(r => RISK_RANK[r.riskClass] >= RISK_RANK.critical).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _classifications = new Map();
    _idIndex         = new Map();
    _counter         = 0;
}

module.exports = {
    RISK_CLASSES, RISK_RANK, ACTION_RISK_MAP,
    classifyAction, classifyWorkflow, overrideRiskClass,
    getRiskProfile, getRiskMetrics, reset,
};
