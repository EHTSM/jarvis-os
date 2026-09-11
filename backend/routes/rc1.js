"use strict";
/**
 * rc1 routes — Production RC-1: Release Candidate 1
 * All routes at /rc1/* require auth AND operator role.
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const svc = require("../services/rc1.cjs");

// OOPLIX V1 MASTER AUDIT (2026-08-16): same platform-wide, not-tenant-scoped
// defect family already fixed 8 times this session (/eos/ent/eco/civ/auto,
// ACP-9-12, /execution+/founder+/bible) — rc1.cjs confirmed 0 orgId
// occurrences; this is internal release-management infrastructure (version
// freeze, manifest, blocker registry), not customer data. Previously gated
// by requireAuth alone; live-reproduced with a real, non-operator customer
// account: GET /rc1/version returned the real frozen-version manifest. The
// only frontend consumer of this entire RC/PM7/POST-Ω/OP1 cluster
// (PublicLaunch.jsx and its siblings, mounted inside ElectronWorkspace.jsx)
// is a documented pure passthrough in the actual web app
// (`if (!isElectron()) return children`) — these tabs render only inside
// the Electron desktop shell, never in the customer-facing web product.
router.use("/rc1", requireAuth, operatorOnly);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Area A — Version Freeze ──────────────────────────────────────────────────

router.get("/rc1/version", (req, res) => {
  try { _ok(res, svc.getCurrentVersion()); } catch (e) { _err(res, e); }
});

router.post("/rc1/version/freeze", (req, res) => {
  try { _ok(res, svc.freezeVersion()); } catch (e) { _err(res, e); }
});

router.get("/rc1/manifest", (req, res) => {
  try {
    const m = svc.getVersionManifest();
    if (!m) return res.status(404).json({ ok: false, error: "No manifest. POST /rc1/manifest/generate" });
    _ok(res, m);
  } catch (e) { _err(res, e); }
});

router.post("/rc1/manifest/generate", (req, res) => {
  try { _ok(res, svc.generateVersionManifest()); } catch (e) { _err(res, e); }
});

router.get("/rc1/compat", (req, res) => {
  try {
    const r = svc.getCompatibilityReport();
    if (!r) return res.status(404).json({ ok: false, error: "No compat report. POST /rc1/compat/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

router.post("/rc1/compat/generate", (req, res) => {
  try { _ok(res, svc.generateCompatibilityReport()); } catch (e) { _err(res, e); }
});

// ── Area B — Installation Check ──────────────────────────────────────────────

router.get("/rc1/install/check", (req, res) => {
  try { _ok(res, svc.runInstallationCheck()); } catch (e) { _err(res, e); }
});

router.post("/rc1/env/patch", (req, res) => {
  try { _ok(res, svc.patchEnvExample()); } catch (e) { _err(res, e); }
});

// ── Area C — Upgrade Verification ────────────────────────────────────────────

router.get("/rc1/upgrade/verify", (req, res) => {
  try { _ok(res, svc.runUpgradeVerification()); } catch (e) { _err(res, e); }
});

// ── Area D — Backup & Restore ────────────────────────────────────────────────

router.get("/rc1/backup/manifest", (req, res) => {
  try { _ok(res, svc.getBackupManifest()); } catch (e) { _err(res, e); }
});

router.get("/rc1/backup/check", (req, res) => {
  try { _ok(res, svc.runBackupCheck()); } catch (e) { _err(res, e); }
});

router.get("/rc1/backup/verify", (req, res) => {
  try { _ok(res, svc.runBackupVerification()); } catch (e) { _err(res, e); }
});

router.post("/rc1/backup/patch-script", (req, res) => {
  try { _ok(res, svc.patchSafeBackup()); } catch (e) { _err(res, e); }
});

// ── Area E — Release Package ──────────────────────────────────────────────────

router.get("/rc1/checksums", (req, res) => {
  try {
    const c = svc.getChecksums();
    if (!c) return res.status(404).json({ ok: false, error: "No checksums. POST /rc1/checksums/generate" });
    _ok(res, c);
  } catch (e) { _err(res, e); }
});

router.post("/rc1/checksums/generate", (req, res) => {
  try { _ok(res, svc.generateChecksums()); } catch (e) { _err(res, e); }
});

router.get("/rc1/release-metadata", (req, res) => {
  try {
    const m = svc.getReleaseMetadata();
    if (!m) return res.status(404).json({ ok: false, error: "No metadata. POST /rc1/release-metadata/generate" });
    _ok(res, m);
  } catch (e) { _err(res, e); }
});

router.post("/rc1/release-metadata/generate", (req, res) => {
  try { _ok(res, svc.generateReleaseMetadata()); } catch (e) { _err(res, e); }
});

// ── Area F — Production Checklist ────────────────────────────────────────────

router.get("/rc1/production/checklist", (req, res) => {
  try { _ok(res, svc.runProductionChecklist()); } catch (e) { _err(res, e); }
});

// ── Area G — Release Blockers ─────────────────────────────────────────────────

router.get("/rc1/blockers", (req, res) => {
  try {
    const { severity } = req.query;
    _ok(res, { blockers: svc.getBlockers(severity || undefined), summary: svc.getBlockerSummary() });
  } catch (e) { _err(res, e); }
});

router.get("/rc1/blockers/summary", (req, res) => {
  try { _ok(res, svc.getBlockerSummary()); } catch (e) { _err(res, e); }
});

// ── Master Report ─────────────────────────────────────────────────────────────

router.get("/rc1/report", (req, res) => {
  try {
    const r = svc.getRC1Report();
    if (!r) return res.status(404).json({ ok: false, error: "No RC-1 report. POST /rc1/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

router.post("/rc1/report/generate", (req, res) => {
  try { _ok(res, svc.generateRC1Report()); } catch (e) { _err(res, e); }
});

// ── Full RC-1 Freeze (idempotent) ────────────────────────────────────────────

router.post("/rc1/freeze", (req, res) => {
  try { _ok(res, svc.runRC1Freeze()); } catch (e) { _err(res, e); }
});

// ── Changelog ────────────────────────────────────────────────────────────────

router.post("/rc1/changelog/append", (req, res) => {
  try { _ok(res, svc.appendChangelog()); } catch (e) { _err(res, e); }
});

// ── Metadata ──────────────────────────────────────────────────────────────────

router.get("/rc1/metadata", (req, res) => {
  _ok(res, {
    version:               svc.RC1_VERSION,
    previousVersion:       svc.PREV_VERSION,
    breakingChanges:       svc.BREAKING_CHANGES,
    nonBreakingAdditions:  svc.NON_BREAKING_ADDITIONS,
    backupManifestCount:   svc.RC1_BACKUP_MANIFEST.length,
    blockerSummary:        svc.getBlockerSummary(),
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

router.post("/rc1/reset", (req, res) => {
  try { _ok(res, svc.resetRC1State()); } catch (e) { _err(res, e); }
});

module.exports = router;
