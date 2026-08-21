"use strict";
/**
 * V6 Phase 6 (Category E: Legal OS) — legal document generation routes
 * Prefix: /legal/*
 *
 * OOPLIX V1 MASTER AUDIT (2026-08-16, endpoint authorization sweep):
 * live-reproduced a real cross-tenant IDOR — every route here trusted a
 * caller-supplied workspaceId/docId with zero membership verification.
 * A real, unrelated tenant read another tenant's full legal document
 * content (both by direct docId and by supplying the victim's real
 * workspaceId to the list route) and could mutate its status, blocked
 * only by an unrelated state-machine rule, not by any authorization
 * check. This is real customer contract/NDA data, not platform-internal
 * tooling — the most severe finding in that sweep.
 *
 * Fixed by reusing the exact established pattern (admin.js/automation.js/
 * governance.js/security.js): attachWorkspace + requireWorkspaceMember for
 * routes that already carry workspaceId, and — for the two docId-only
 * routes, which don't know which workspace a document belongs to until
 * after looking it up — a direct getMemberRole() ownership check against
 * the document's own stored workspaceId. No new authorization framework.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");

function _svc() { return require("../services/legalDocumentEngine.cjs"); }
function _wsSvc() { return require("../services/workspaceService.cjs"); }
function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

router.get("/legal/document-types", requireAuth, (req, res) => {
    _ok(res, { types: _svc().listDocumentTypes() });
});

router.post("/legal/documents/generate", requireAuth, attachWorkspace, requireWorkspaceMember, rateLimiter(15, 60_000, "legal-doc-generate"), async (req, res) => {
    try {
        const { type, params, acknowledgeNotLegalAdvice } = req.body || {};
        if (!type) return _err(res, new Error("type required"), 400);
        // req.workspace.id is the authenticated caller's own, membership-verified
        // workspace — never a raw client-supplied id (same convention as admin.js).
        _ok(res, await _svc().generateDocument({ type, params: params || {}, workspaceId: req.workspace.id, acknowledgeNotLegalAdvice }));
    } catch (e) { _err(res, e); }
});

router.get("/legal/documents", requireAuth, attachWorkspace, requireWorkspaceMember, (req, res) => {
    const { type, status, limit } = req.query;
    _ok(res, { documents: _svc().listDocuments({ workspaceId: req.workspace.id, type, status, limit: limit ? +limit : 50 }) });
});

// docId-only routes: the target workspace is only known once the document
// itself is loaded, so attachWorkspace/requireWorkspaceMember (which need a
// workspaceId up front) don't apply directly here — verify membership
// against the document's own stored workspaceId instead, same real
// getMemberRole() check those middlewares use internally.
function _requireDocOwnership(req, res, doc) {
    if (!doc) { _err(res, new Error("document not found"), 404); return false; }
    if (!doc.workspaceId) { _err(res, new Error("document not found"), 404); return false; }
    const accountId = req.user?.sub;
    const role = accountId ? _wsSvc().getMemberRole(doc.workspaceId, accountId) : null;
    if (!role) { _err(res, new Error("Not a member of this workspace"), 403); return false; }
    return true;
}

router.get("/legal/documents/:docId", requireAuth, (req, res) => {
    const doc = _svc().getDocument(req.params.docId);
    if (!_requireDocOwnership(req, res, doc)) return;
    _ok(res, { document: doc });
});

router.post("/legal/documents/:docId/status", requireAuth, (req, res) => {
    const doc = _svc().getDocument(req.params.docId);
    if (!_requireDocOwnership(req, res, doc)) return;
    const { status, note } = req.body || {};
    if (!status) return _err(res, new Error("status required"), 400);
    _ok(res, _svc().updateStatus(req.params.docId, status, note));
});

router.get("/legal/stats", requireAuth, (req, res) => {
    _ok(res, { stats: _svc().getStats() });
});

module.exports = router;
