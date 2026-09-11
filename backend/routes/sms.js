"use strict";
/**
 * SMS routes — Twilio-backed. Communication Ecosystem mission: the
 * missing route for the real send capability just added in
 * twilioService.cjs (Twilio previously had only a credential
 * health-probe, no send path anywhere in the repo).
 *
 * Org-scoped from the outset (attachOrg + the same non-blocking
 * "resolve, then gate" pattern proven across every credential-consuming
 * route fixed in this mission chain — social platforms, Razorpay
 * refunds) rather than retrofitting it later: attachOrg alone resolves
 * req.org from a caller-supplied X-Org-Id/body.orgId with NO membership
 * check on its own, so it is paired with _requireOrgMemberIfOrgContext
 * from the start. A solo caller with no org at all falls through to the
 * documented global Twilio env-var fallback, unaffected.
 */
const router  = require("express").Router();
const twilio  = require("../services/twilioService");
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");

function _requireOrgMemberIfOrgContext(req, res, next) {
    if (!req.org) return next();
    return requireOrgMember(req, res, next);
}

const _smsRL = rateLimiter(15, 60_000, "sms-send");

// POST /sms/send  { to, message }
router.post("/sms/send", requireAuth, attachOrg, _requireOrgMemberIfOrgContext, _smsRL, async (req, res) => {
    const to      = req.body.to || req.body.phone;
    const message = (req.body.message || req.body.text || "").trim();

    if (!to || !message) {
        return res.status(400).json({ success: false, error: "to and message required" });
    }

    const orgId = req.org?.id || null;
    if (!twilio.isConfigured(orgId)) {
        return res.status(503).json({ success: false, error: "Twilio not configured — set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER in .env, or connect via /my-connectors/twilio" });
    }

    const result = await twilio.sendSMS(to, message, 2, orgId);
    return res.json({ success: result.success, ...result });
});

// GET /sms/status
router.get("/sms/status", requireAuth, attachOrg, (req, res) => {
    res.json({ configured: twilio.isConfigured(req.org?.id || null) });
});

module.exports = router;
