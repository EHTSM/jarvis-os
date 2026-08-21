"use strict";
const router      = require("express").Router();
const controller  = require("../controllers/jarvisController");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");
const billing     = require("../services/billingService");
const { attachOrg } = require("../middleware/orgMiddleware.cjs");

// POST /jarvis — main AI gateway (the primary "AI Chat" tab's input for every
// account, customer and operator alike — despite the old comment here saying
// "operator auth required", requireAuth only checks for a session, not a
// role). This previously had no usage-quota enforcement at all, while the
// less-used /ai/chat and /ai/chat-with-tools routes did — meaning a
// customer's real AI usage (the main chat) was completely unmetered even
// though the plan's AI-action quota is shown to them on the dashboard.
//
// C.9 AI Experience audit (2026-08-14/15): this route never mounted attachOrg
// — the same gap Phase B.14 already found and fixed on /ai/chat and
// /ai/chat-with-tools. jarvisController.js's intelligence pipeline reads
// req.org?.id/req.workspace?.id and forwards them into aiOrchestrator.execute()
// for org-scoped budget enforcement and promptHistory tenant scoping, but on
// THIS route — the main "AI Chat" tab every account actually uses, per the
// comment above — req.org was always undefined, so the primary chat surface's
// usage was invisible to org-level budgets and its prompt-history entries
// were recorded with orgId:null regardless of which org the caller belonged
// to. attachOrg is non-blocking (mirrors attachWorkspace's contract used
// elsewhere) — it only attaches req.org when resolvable, never rejects.
// OOPLIX V1 MASTER AUDIT (2026-08-16, RBAC role-exercise audit): use_ai is a
// real, deliberately-scoped ACTIONS entry (organizationService.cjs) —
// org_owner/org_admin/dept_lead/team_lead/member, explicitly excluding
// viewer — and orgAiBrain.cjs/orgAgents.cjs (the org-scoped AI surfaces)
// already enforce it. This route, the platform's primary/most-used AI
// entry point, never checked it at all — live-reproduced: a real viewer-role
// account reached this route freely (blocked only by the separate,
// unrelated AI-credential absence, not by any role check). Fixed with the
// same hasPermission("use_ai") check those two files already use, applied
// ONLY when req.org resolved — attachOrg is non-blocking by design (a solo
// user with no org at all must still be able to use the main AI chat, per
// this file's own header comment), so the check must not turn attachOrg
// into an implicit org requirement.
function _requireUseAiIfOrgContext(req, res, next) {
    if (!req.org?.id) return next(); // no org context — nothing to enforce against
    try {
        const org = require("../services/organizationService.cjs");
        if (org.hasPermission(req.org.id, req.user.sub, "use_ai")) return next();
        return res.status(403).json({ success: false, error: "Forbidden — this organization role does not permit AI usage" });
    } catch { return next(); } // service unavailable — fail open, matching attachOrg's own non-blocking contract
}

router.post("/jarvis", requireAuth, attachOrg, _requireUseAiIfOrgContext, rateLimiter(60, 60_000), billing.requireUsageQuota, controller.handleJarvis);

module.exports = router;
