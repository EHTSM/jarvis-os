"use strict";
/**
 * Generic serving route for locally-stored export files (DOCX/PPTX/ZIP/etc).
 * Companion to backend/services/exportFileService.cjs — that service writes
 * the bytes to data/exports/:orgScope/:filename when cloud storage isn't
 * configured; this route reads them back. Mirrors the strict-filename +
 * path-traversal-guard pattern already used by GET /creative/audio/:filename
 * in backend/routes/creativeStudio.js.
 *
 * Auth: requireAuth + attachOrg + requireOrgMember, then a check that the
 * caller's own org matches the :orgScope segment in the URL — a member of
 * one org can never fetch another org's export by guessing/iterating
 * filenames, even though the path itself is server-generated.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const { resolveLocal } = require("../services/exportFileService.cjs");

const MIME_BY_EXT = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip":  "application/zip",
  ".json": "application/json",
  ".csv":  "text/csv",
  ".pdf":  "application/pdf",
};

function _serve(req, res) {
  const { orgScope, filename } = req.params;
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return res.status(400).json({ error: "invalid_filename" });

  const abs = resolveLocal(orgScope, filename);
  if (!abs) return res.status(404).json({ error: "not_found" });

  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  res.setHeader("Content-Type", MIME_BY_EXT[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(abs);
}

// "global" scope = account-personal exports (e.g. GDPR data export) that
// aren't org-scoped at all — access control there is just requireAuth,
// since ownership is checked at generation time (filename is unguessable,
// namespaced by an id derived from the requesting account).
router.get("/exports/global/:filename", requireAuth, _serve);

router.get("/exports/:orgScope/:filename", requireAuth, (req, res, next) => {
  if (!/^[A-Za-z0-9_-]+$/.test(req.params.orgScope)) return res.status(400).json({ error: "invalid_scope" });
  // orgScope in the URL IS the org to resolve — the client doesn't need to
  // separately pass X-Org-Id/orgId for a link that already names the org.
  req.query.orgId = req.params.orgScope;
  next();
}, attachOrg, requireOrgMember, _serve);

module.exports = router;
