"use strict";
/**
 * workforce.js — Phase M2: Hybrid Workforce routes
 *
 * POST /workforce/:missionId/plan              — create collaboration plan
 * GET  /workforce/:missionId/plan              — get plan
 * GET  /workforce/:missionId                   — full workforce overview
 * GET  /workforce/:missionId/workers           — list all workers in mission
 *
 * Steps:
 * POST /workforce/:missionId/steps/:stepId/assign    — assign step to worker
 * DELETE /workforce/:missionId/steps/:stepId/assign  — unassign step
 * POST /workforce/:missionId/steps/:stepId/handoff   — handoff to another worker
 * POST /workforce/:missionId/steps/:stepId/complete  — human marks step complete
 * POST /workforce/:missionId/steps/:stepId/execute   — trigger AI step execution
 * POST /workforce/:missionId/steps/:stepId/escalate  — escalate step
 *
 * Approvals:
 * POST /workforce/:missionId/steps/:stepId/approval/request — request approval
 * POST /workforce/:missionId/approvals/:approvalId/submit   — submit verdict
 * GET  /workforce/:missionId/approvals/:approvalId          — get approval status
 *
 * Escalations:
 * GET  /workforce/:missionId/escalations — list all escalations
 *
 * Org workers:
 * GET  /workforce/org/:orgId/workers     — list humans + AI for org
 *
 * Constants:
 * GET  /workforce/constants              — WORKER_TYPES, STEP_STATUS, VERDICTS
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _svc() { return require("../services/hybridWorkforceService.cjs"); }
function _ok(res, data)         { res.json({ ok: true, ...data }); }
function _err(res, e, fallback) { res.status(e.status || fallback || 500).json({ ok: false, error: e.message }); }

router.use(requireAuth);

// ── Constants ─────────────────────────────────────────────────────────────────
router.get("/workforce/constants", (req, res) => {
    const s = _svc();
    _ok(res, { WORKER_TYPES: s.WORKER_TYPES, STEP_STATUS: s.STEP_STATUS, APPROVAL_VERDICTS: s.APPROVAL_VERDICTS });
});

// ── Org worker listing ────────────────────────────────────────────────────────
router.get("/workforce/org/:orgId/workers", (req, res) => {
    try { _ok(res, _svc().listWorkersForOrg(req.params.orgId)); }
    catch (e) { _err(res, e); }
});

// ── Collaboration plan ────────────────────────────────────────────────────────
router.post("/workforce/:missionId/plan", (req, res) => {
    try {
        const { steps, orgId, deptId, teamId } = req.body || {};
        if (!Array.isArray(steps) || !steps.length) return res.status(400).json({ ok: false, error: "steps[] required" });
        _ok(res, _svc().createCollaborationPlan(req.params.missionId, steps, { orgId, deptId, teamId }));
    } catch (e) { _err(res, e, 400); }
});

router.get("/workforce/:missionId/plan", (req, res) => {
    try {
        const plan = _svc().getCollaborationPlan(req.params.missionId);
        if (!plan) return res.status(404).json({ ok: false, error: "No collaboration plan for this mission" });
        _ok(res, { plan });
    } catch (e) { _err(res, e); }
});

// ── Workforce overview ────────────────────────────────────────────────────────
router.get("/workforce/:missionId", (req, res) => {
    try { _ok(res, _svc().getMissionWorkforce(req.params.missionId)); }
    catch (e) { _err(res, e); }
});

// ── Step assignment ───────────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/assign", (req, res) => {
    try {
        const { worker } = req.body || {};
        if (!worker) return res.status(400).json({ ok: false, error: "worker required" });
        _ok(res, { step: _svc().assignStep(req.params.missionId, req.params.stepId, worker, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/workforce/:missionId/steps/:stepId/assign", (req, res) => {
    try { _ok(res, { step: _svc().unassignStep(req.params.missionId, req.params.stepId, req.user.sub) }); }
    catch (e) { _err(res, e, 400); }
});

// ── Handoff ───────────────────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/handoff", (req, res) => {
    try {
        const { from, to, reason } = req.body || {};
        if (!from || !to) return res.status(400).json({ ok: false, error: "from and to worker required" });
        _ok(res, _svc().handoff(req.params.missionId, req.params.stepId, from, to, reason, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

// ── Human step completion ─────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/complete", (req, res) => {
    try {
        const { output } = req.body || {};
        _ok(res, { step: _svc().signalHumanStepComplete(req.params.missionId, req.params.stepId, req.user.sub, output) });
    } catch (e) { _err(res, e, 400); }
});

// ── AI step execution ─────────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/execute", async (req, res) => {
    try {
        const { capability, input, policy } = req.body || {};
        const result = await _svc().executeAIStep(req.params.missionId, req.params.stepId, capability, input, { policy });
        _ok(res, result);
    } catch (e) { _err(res, e, 400); }
});

// ── Escalation ────────────────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/escalate", (req, res) => {
    try {
        const { reason, to } = req.body || {};
        if (!to) return res.status(400).json({ ok: false, error: "to (worker) required" });
        _ok(res, { escalation: _svc().escalate(req.params.missionId, req.params.stepId, reason, to, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.get("/workforce/:missionId/escalations", (req, res) => {
    try { _ok(res, _svc().getEscalations(req.params.missionId)); }
    catch (e) { _err(res, e); }
});

// ── Approval chain ────────────────────────────────────────────────────────────
router.post("/workforce/:missionId/steps/:stepId/approval/request", (req, res) => {
    try {
        const { approvers, description, type } = req.body || {};
        if (!Array.isArray(approvers) || !approvers.length) return res.status(400).json({ ok: false, error: "approvers[] required" });
        _ok(res, _svc().requestApproval(req.params.missionId, req.params.stepId, req.user.sub, approvers, { description, type }));
    } catch (e) { _err(res, e, 400); }
});

router.post("/workforce/:missionId/approvals/:approvalId/submit", (req, res) => {
    try {
        const { verdict, reason } = req.body || {};
        if (!verdict) return res.status(400).json({ ok: false, error: "verdict required" });
        _ok(res, _svc().submitApproval(req.params.missionId, req.params.approvalId, req.user.sub, verdict, reason));
    } catch (e) { _err(res, e, 400); }
});

router.get("/workforce/:missionId/approvals/:approvalId", (req, res) => {
    try {
        const approval = _svc().getApprovalStatus(req.params.missionId, req.params.approvalId);
        if (!approval) return res.status(404).json({ ok: false, error: "Approval not found" });
        _ok(res, { approval });
    } catch (e) { _err(res, e); }
});

module.exports = router;
