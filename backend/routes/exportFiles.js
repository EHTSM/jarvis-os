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
 * filenames, even though the path itself is server-generated. The "global"
 * (account-personal, non-org) scope is requireAuth + an ownership check
 * against the accountId creativeAssetLibrary.cjs recorded at persist() time.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const { resolveLocal } = require("../services/exportFileService.cjs");

// Customer-Facing Sensitive Data, Export & File-Access Boundary Audit
// (2026-08-21): the "global" scope's access control was "filename is
// unguessable" alone — false in practice. Every persist() call in this
// scope (GDPR export, founder report, knowledge-graph export, blueprint
// export, API docs export) actually uses a Date.now()/date-string/weak-
// random filename, not a real secret, and creativeAssetLibrary.cjs already
// records the owning accountId for every persisted file via storeAsset()
// (the same getAssetByUrl()-based mechanism already certified for
// /creative/image|video/file/:filename in creativeStudio.js). Unlike that
// route, this one fails CLOSED (not open) on a missing record: live-tested,
// creativeAssetLibrary's index only gained a `url` field in a later pass,
// so exports persisted before that pass (real example found on disk:
// fop-report-2026-08-13.docx, a founder-only report) have no matching
// record and were still reachable by any authenticated customer even after
// the ownership check below was added, until this was changed to deny
// rather than allow when no record is found.
function _fileOwnedOrDenied(res, record, accountId) {
  if (!record || record.accountId !== accountId) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  return true;
}

const MIME_BY_EXT = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip":  "application/zip",
  ".json": "application/json",
  ".csv":  "text/csv",
  ".pdf":  "application/pdf",
};

function _serve(req, res) {
  // req.params.orgScope only exists on the /exports/:orgScope/:filename
  // route below — the /exports/global/:filename route has no :orgScope
  // param at all, so it must be inferred as "global" explicitly rather
  // than read from req.params (which would be undefined there).
  const orgScope = req.params.orgScope || "global";
  const { filename } = req.params;
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return res.status(400).json({ error: "invalid_filename" });

  const abs = resolveLocal(orgScope, filename);
  if (!abs) return res.status(404).json({ error: "not_found" });

  if (orgScope === "global") {
    const assets = require("../services/creativeAssetLibrary.cjs");
    const accountId = req.user?.sub || req.user?.id || null;
    const record = assets.getAssetByUrl(`/exports/global/${filename}`);
    if (!_fileOwnedOrDenied(res, record, accountId)) return;
  }

  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  res.setHeader("Content-Type", MIME_BY_EXT[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(abs);
}

// "global" scope = account-personal exports (e.g. GDPR data export) that
// aren't org-scoped at all — requireAuth plus the _fileOwnedOrDenied()
// check above (accountId recorded by creativeAssetLibrary.storeAsset() at
// persist() time, not filename secrecy, which the 2026-08-21 audit proved
// is not actually unguessable for any current caller).
router.get("/exports/global/:filename", requireAuth, _serve);

router.get("/exports/:orgScope/:filename", requireAuth, (req, res, next) => {
  if (!/^[A-Za-z0-9_-]+$/.test(req.params.orgScope)) return res.status(400).json({ error: "invalid_scope" });
  // Mission 78 pre-VPS audit: `req.query.orgId = req.params.orgScope` was a
  // silent no-op on this project's pinned Express 5 (req.query is a getter
  // with no writable backing store — reproduced live in this exact
  // environment). attachOrg never saw the intended orgScope, so it fell
  // through to auto-resolving the CALLER's own primary org instead — and
  // this route's :orgId path param is actually named :orgScope, so
  // attachOrg's own highest-priority `req.params?.orgId` source could never
  // match it either. requireOrgMember then only confirmed membership in the
  // caller's own (wrong) org, while _serve() below still trusted the raw
  // URL orgScope directly for file resolution — a real cross-tenant export
  // disclosure (GDPR exports, founder reports, blueprints), not a
  // hypothetical one. Fixed the exact way workforce.js's own already-proven
  // fix for this identical Express 5 pattern does: req.headers is a plain
  // mutable object in both Express 4 and 5, so setting the header attachOrg
  // already reads (its highest-priority source after :orgId) works
  // correctly where req.query assignment does not.
  req.headers["x-org-id"] = req.params.orgScope;
  next();
}, attachOrg, requireOrgMember, (req, res) => {
  // Second layer, matching this file's own header comment's original intent
  // (which was never actually enforced): even with attachOrg now correctly
  // resolving req.org from the URL's orgScope, explicitly confirm the
  // resolved org's id equals the requested orgScope before serving — a
  // defense-in-depth check against any future change to attachOrg's
  // precedence order silently reopening this exact gap.
  if (!req.org || req.org.id !== req.params.orgScope) return res.status(404).json({ error: "not_found" });
  _serve(req, res);
});

module.exports = router;
