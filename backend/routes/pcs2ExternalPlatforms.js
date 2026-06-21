"use strict";
const router = require("express").Router();
const { requireAuth } = require("./middleware");
const pcs2 = require("../services/pcs2ExternalPlatforms.cjs");

function _ok(res, data)        { res.json({ ok: true, ...data }); }
function _err(res, e, code=500){ res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// POST /ext/audit — full audit (all 8 sections)
router.post("/ext/audit", requireAuth, async (req, res) => {
  try { _ok(res, { report: await pcs2.runFullAudit() }); }
  catch (e) { _err(res, e); }
});

// POST /ext/audit/:section — re-audit one section
router.post("/ext/audit/:section", requireAuth, async (req, res) => {
  try { _ok(res, await pcs2.auditSection(req.params.section)); }
  catch (e) { _err(res, e); }
});

// GET /ext/report — last saved report
router.get("/ext/report", requireAuth, async (req, res) => {
  try {
    const report = pcs2.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /ext/audit first" });
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// GET /ext/history — summary of past runs
router.get("/ext/history", requireAuth, async (req, res) => {
  try { _ok(res, { history: pcs2.getReportHistory() }); }
  catch (e) { _err(res, e); }
});

// GET /ext/benchmark — benchmark all gates
router.get("/ext/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, await pcs2.runBenchmark()); }
  catch (e) { _err(res, e); }
});

// GET /ext/env — env var manifest
router.get("/ext/env", requireAuth, async (req, res) => {
  try {
    const report  = pcs2.getLastReport();
    const envVars = report?.envVars || {
      all:          pcs2.ENV_MANIFEST.map(v => ({ ...v, set: !!process.env[v.key] })),
      missingCount: 0, presentCount: 0,
    };
    _ok(res, { envVars });
  } catch (e) { _err(res, e); }
});

// GET /ext/matrix — external platform matrix (all platforms, all statuses)
router.get("/ext/matrix", requireAuth, async (req, res) => {
  try {
    const report = pcs2.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /ext/audit first" });
    const matrix = Object.entries(report.details).map(([section, platforms]) => ({
      section,
      label: report.sections.find(s => s.section === section)?.label || section,
      platforms,
    }));
    _ok(res, { matrix, score: report.score, runAt: report.runAt });
  } catch (e) { _err(res, e); }
});

// GET /ext/:section — section detail from last report
router.get("/ext/:section", requireAuth, async (req, res) => {
  const { section } = req.params;
  const allowed = ["meta","google","microsoft","git","productivity","design","commerce","automation"];
  if (!allowed.includes(section))
    return _err(res, new Error(`Unknown section: ${section} — use: ${allowed.join("|")}`), 400);
  try {
    const report = pcs2.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /ext/audit first" });
    _ok(res, { section, platforms: report.details[section] || [] });
  } catch (e) { _err(res, e); }
});

module.exports = router;
