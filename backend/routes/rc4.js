"use strict";
/**
 * rc4 routes — Final Launch Certification for Ooplix 1.0.0
 * All routes at /rc4/* require auth.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/rc4.cjs");

router.use("/rc4", requireAuth);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Full certification ─────────────────────────────────────────────────────────

router.post("/rc4/certify", (req, res) => {
  try { _ok(res, svc.runLaunchCertification()); } catch (e) { _err(res, e); }
});

// ── Report ─────────────────────────────────────────────────────────────────────

router.post("/rc4/report/generate", (req, res) => {
  try { _ok(res, svc.generateRC4Report()); } catch (e) { _err(res, e); }
});

router.get("/rc4/report", (req, res) => {
  try {
    const r = svc.getRC4Report();
    if (!r) return res.status(404).json({ ok: false, error: "No RC-4 report. POST /rc4/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

// ── Individual area routes ─────────────────────────────────────────────────────

router.get("/rc4/areas", (req, res) => {
  _ok(res, {
    areas: [
      { area: "A", name: "Launch Readiness",    weight: svc.AREA_WEIGHTS.A },
      { area: "B", name: "Documentation",       weight: svc.AREA_WEIGHTS.B },
      { area: "C", name: "Business Readiness",  weight: svc.AREA_WEIGHTS.C },
      { area: "D", name: "Operations",          weight: svc.AREA_WEIGHTS.D },
      { area: "E", name: "Infrastructure",      weight: svc.AREA_WEIGHTS.E },
      { area: "F", name: "Launch Assets",       weight: svc.AREA_WEIGHTS.F },
      { area: "G", name: "Founder Checklist",   weight: svc.AREA_WEIGHTS.G },
      { area: "H", name: "Final Certification", weight: svc.AREA_WEIGHTS.H },
    ],
  });
});

router.get("/rc4/areas/:area", (req, res) => {
  try {
    const area = req.params.area.toUpperCase();
    _ok(res, svc.runArea(area));
  } catch (e) { _err(res, e, 400); }
});

// Convenience named area routes
router.get("/rc4/areas/launch-readiness",   (req, res) => { try { _ok(res, svc.certifyLaunchReadiness()); }    catch (e) { _err(res, e); } });
router.get("/rc4/areas/documentation",      (req, res) => { try { _ok(res, svc.certifyDocumentation()); }      catch (e) { _err(res, e); } });
router.get("/rc4/areas/business-readiness", (req, res) => { try { _ok(res, svc.certifyBusinessReadiness()); }  catch (e) { _err(res, e); } });
router.get("/rc4/areas/operations",         (req, res) => { try { _ok(res, svc.certifyOperations()); }         catch (e) { _err(res, e); } });
router.get("/rc4/areas/infrastructure",     (req, res) => { try { _ok(res, svc.certifyInfrastructure()); }     catch (e) { _err(res, e); } });
router.get("/rc4/areas/launch-assets",      (req, res) => { try { _ok(res, svc.certifyLaunchAssets()); }       catch (e) { _err(res, e); } });
router.get("/rc4/areas/founder-checklist",  (req, res) => { try { _ok(res, svc.generateFounderChecklist()); }  catch (e) { _err(res, e); } });

// ── Founder checklist standalone ───────────────────────────────────────────────

router.get("/rc4/founder-checklist", (req, res) => {
  try { _ok(res, svc.generateFounderChecklist()); } catch (e) { _err(res, e); }
});

// ── State + admin ──────────────────────────────────────────────────────────────

router.get("/rc4/state", (req, res) => {
  try { _ok(res, svc.getRC4State()); } catch (e) { _err(res, e); }
});

router.post("/rc4/reset", (req, res) => {
  try { _ok(res, svc.resetRC4State()); } catch (e) { _err(res, e); }
});

// ── Metadata ───────────────────────────────────────────────────────────────────

router.get("/rc4/metadata", (req, res) => {
  _ok(res, {
    version:     svc.RC4_VERSION,
    description: "Final Launch Certification for Ooplix 1.0.0 — 8 areas, composite score, Go/No-Go",
    areaWeights: svc.AREA_WEIGHTS,
    areas: [
      "A: Launch Readiness (15%)", "B: Documentation (15%)", "C: Business Readiness (15%)",
      "D: Operations (15%)",       "E: Infrastructure (15%)", "F: Launch Assets (10%)",
      "G: Founder Checklist (5%)", "H: Final Certification (10%)",
    ],
  });
});

module.exports = router;
