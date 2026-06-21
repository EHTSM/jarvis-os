"use strict";
const router = require("express").Router();
const { requireAuth } = require("./middleware");
const pcs = require("../services/pcsCredentials.cjs");

function _ok(res, data)      { res.json({ ok: true,  ...data }); }
function _err(res, e, code=500) { res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// POST /credentials/audit — run full audit (all 5 sections)
router.post("/credentials/audit", requireAuth, async (req, res) => {
  try { _ok(res, { report: await pcs.runFullAudit() }); }
  catch (e) { _err(res, e); }
});

// POST /credentials/audit/:section — re-run one section (email|ai|oauth|crash|storage)
router.post("/credentials/audit/:section", requireAuth, async (req, res) => {
  try { _ok(res, await pcs.auditSection(req.params.section)); }
  catch (e) { _err(res, e); }
});

// GET /credentials/report — last saved report
router.get("/credentials/report", requireAuth, async (req, res) => {
  try {
    const report = pcs.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /credentials/audit first" });
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// GET /credentials/history — summary list of past runs
router.get("/credentials/history", requireAuth, async (req, res) => {
  try { _ok(res, { history: pcs.getReportHistory() }); }
  catch (e) { _err(res, e); }
});

// GET /credentials/benchmark — benchmark all gates
router.get("/credentials/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, await pcs.runBenchmark()); }
  catch (e) { _err(res, e); }
});

// GET /credentials/env — env var manifest (configured / missing)
router.get("/credentials/env", requireAuth, async (req, res) => {
  try {
    const report = pcs.getLastReport();
    const envVars = report?.envVars || { all: pcs.ENV_MANIFEST.map(v => ({ ...v, set: !!process.env[v.key] })), missingCount: 0, presentCount: 0 };
    _ok(res, { envVars });
  } catch (e) { _err(res, e); }
});

// GET /credentials/:section — section detail from last report
router.get("/credentials/:section", requireAuth, async (req, res) => {
  const { section } = req.params;
  const allowed = ["email","ai","oauth","crash","storage"];
  if (!allowed.includes(section)) return _err(res, new Error(`Unknown section: ${section} — use: ${allowed.join("|")}`), 400);
  try {
    const report = pcs.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /credentials/audit first" });
    _ok(res, { section, creds: report.details[section] || [] });
  } catch (e) { _err(res, e); }
});

module.exports = router;
