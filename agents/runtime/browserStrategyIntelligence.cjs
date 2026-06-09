"use strict";
/**
 * Phase 681 — Browser Strategy Intelligence
 *
 * Extraction-flow optimization, authenticated-session continuity,
 * workflow-linked browser sequencing, replay-aware browser planning,
 * operational-form safety prioritization.
 * PREVENTS: duplicate continuation, stale replay, unsafe automation.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/browser-strategy-intel.json");
const MAX_PLANS  = 30;
const TTL_MS     = 8 * 60 * 60 * 1000;
const STALE_MS   = 30 * 60 * 1000;
const DEDUP_MS   = 5 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.plans = (db.plans || []).filter(p => p.ts > cutoff).slice(0, MAX_PLANS);
    db.dedup = (db.dedup || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}

// ── Extraction flow optimization ──────────────────────────────────────────────

function optimizeExtractionFlow(flows = []) {
    if (!flows.length) return { ok: false, error: "No flows provided" };

    const optimized = flows.map(f => {
        let priority = 50;
        if (f.hasSchema)         priority += 15;
        if (f.authenticated)     priority += 10;
        if (f.replayable)        priority += 8;
        if (f.paginationAware)   priority += 5;
        if (f.hasValidation)     priority += 12;
        if (f.stale)             priority -= 20;
        if (f.hasDuplicateRisk)  priority -= 15;
        return { ...f, priority: Math.max(0, Math.min(100, priority)), optimized: true };
    }).sort((a, b) => b.priority - a.priority);

    return {
        ok:        true,
        optimized,
        primary:   optimized[0],
        explainer: `Extraction flow: primary='${optimized[0]?.id || "unknown"}' (priority=${optimized[0]?.priority})`,
    };
}

// ── Authenticated session continuity ─────────────────────────────────────────

function assessSessionContinuity(sessionId = "") {
    const bei = _tryRequire("./browserExecutionIntelligence.cjs");
    if (!bei) return { ok: true, skipped: true, reason: "browserExecutionIntelligence unavailable" };

    try {
        const stale = bei.detectStaleSessions();
        const isStale = stale.stale?.some(s => s.sessionId === sessionId) || false;

        return {
            ok:            !isStale,
            sessionId,
            stale:         isStale,
            totalStale:    stale.stale?.length || 0,
            warning:       isStale ? "Session stale — re-authenticate before continuing" : null,
            recommendation: isStale ? "Create new session rather than resuming stale one" : "Session continuity intact",
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Workflow-linked browser sequencing ────────────────────────────────────────

function buildWorkflowLinkedBrowserSequence(workflowId = "", steps = []) {
    if (!workflowId) return { ok: false, error: "workflowId required" };

    const db = _load(); _prune(db);

    // Dedup check
    const dupKey = `browser-seq:${workflowId}`;
    const isDup  = db.dedup.some(d => d.key === dupKey);
    if (isDup) return { ok: false, duplicate: true, error: "Duplicate browser workflow sequence blocked" };

    db.dedup.push({ key: dupKey, ts: Date.now() });

    const sequenced = steps.map((step, i) => ({
        index:      i,
        action:     step.action || step,
        url:        step.url || null,
        formSafe:   step.isForm ? "requires-approval" : "auto",
        checkpoint: i > 0,
        requiresApproval: step.isForm || step.risky || false,
    }));

    db.plans.unshift({ workflowId, steps: sequenced, ts: Date.now() });
    _save(db);

    return {
        ok:              true,
        workflowId,
        steps:           sequenced,
        requiresApproval: sequenced.some(s => s.requiresApproval),
        explainer:       `Browser sequence: ${sequenced.length} steps for workflow '${workflowId}'`,
    };
}

// ── Replay-aware browser planning ────────────────────────────────────────────

function buildReplayAwareBrowserPlan(replayId = "", { url = "", opType = "navigate" } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };

    // Check dedup via browser execution intelligence
    const bei = _tryRequire("./browserExecutionIntelligence.cjs");
    if (bei && url) {
        try {
            const context = bei.replayBrowserContext(replayId);
            if (context.duplicate) return { ok: false, duplicate: true, error: "Duplicate browser replay blocked" };
        } catch {}
    }

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const isDup = lhec.isDuplicateRecovery(`browser-replay:${replayId}`);
            if (isDup) return { ok: false, duplicate: true, error: "Replay already in dedup window" };
        } catch {}
    }

    return {
        ok:      true,
        replayId,
        url,
        opType,
        plan: [
            { step: "validate-session",   autonomous: true  },
            { step: "check-stale-state",  autonomous: true  },
            { step: "navigate-to-url",    autonomous: true,  url },
            { step: "verify-page-state",  autonomous: true  },
            { step: "execute-operation",  autonomous: opType !== "submit", requiresApproval: opType === "submit" },
        ],
        approvalRequired: opType === "submit",
    };
}

// ── Form safety prioritization ────────────────────────────────────────────────

function prioritizeFormSafety(forms = []) {
    const reviewed = forms.map(form => {
        const risks = [];
        if (form.isDestructive)    risks.push({ factor: "destructive-action", severity: "critical" });
        if (form.hasPayment)       risks.push({ factor: "payment-involved",   severity: "critical" });
        if (form.irreversible)     risks.push({ factor: "irreversible",       severity: "high" });
        if (!form.hasConfirmation) risks.push({ factor: "no-confirmation",    severity: "medium" });
        if (form.modifiesProfile)  risks.push({ factor: "profile-mutation",   severity: "medium" });

        const critical = risks.filter(r => r.severity === "critical").length;
        return {
            ...form,
            risks,
            safe:            critical === 0,
            requiresApproval: risks.length > 0,
            blockedByDefault: critical > 0,
        };
    });

    return {
        ok:       true,
        forms:    reviewed,
        blocked:  reviewed.filter(f => f.blockedByDefault),
        safe:     reviewed.filter(f => f.safe),
        approvalRequired: reviewed.some(f => f.requiresApproval),
        explainer: `Form safety: ${reviewed.filter(f => f.safe).length}/${reviewed.length} safe`,
    };
}

module.exports = { optimizeExtractionFlow, assessSessionContinuity, buildWorkflowLinkedBrowserSequence, buildReplayAwareBrowserPlan, prioritizeFormSafety };
