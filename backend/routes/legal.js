"use strict";
/**
 * V6 Phase 6 (Category E: Legal OS) — legal document generation routes
 * Prefix: /legal/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _svc() { return require("../services/legalDocumentEngine.cjs"); }
function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

router.get("/legal/document-types", requireAuth, (req, res) => {
    _ok(res, { types: _svc().listDocumentTypes() });
});

router.post("/legal/documents/generate", requireAuth, async (req, res) => {
    try {
        const { type, params, workspaceId, acknowledgeNotLegalAdvice } = req.body || {};
        if (!type) return _err(res, new Error("type required"), 400);
        _ok(res, await _svc().generateDocument({ type, params: params || {}, workspaceId, acknowledgeNotLegalAdvice }));
    } catch (e) { _err(res, e); }
});

router.get("/legal/documents", requireAuth, (req, res) => {
    const { workspaceId, type, status, limit } = req.query;
    _ok(res, { documents: _svc().listDocuments({ workspaceId, type, status, limit: limit ? +limit : 50 }) });
});

router.get("/legal/documents/:docId", requireAuth, (req, res) => {
    const doc = _svc().getDocument(req.params.docId);
    if (!doc) return _err(res, new Error("document not found"), 404);
    _ok(res, { document: doc });
});

router.post("/legal/documents/:docId/status", requireAuth, (req, res) => {
    const { status, note } = req.body || {};
    if (!status) return _err(res, new Error("status required"), 400);
    _ok(res, _svc().updateStatus(req.params.docId, status, note));
});

router.get("/legal/stats", requireAuth, (req, res) => {
    _ok(res, { stats: _svc().getStats() });
});

module.exports = router;
