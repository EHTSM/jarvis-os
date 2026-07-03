"use strict";
/**
 * rc3 routes — Production RC-3: 7-Day Stability Certification
 * All routes at /rc3/* require auth.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/rc3.cjs");

router.use("/rc3", requireAuth);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Full stability audit ──────────────────────────────────────────────────────

router.post("/rc3/audit", (req, res) => {
  try { _ok(res, svc.runStabilityAudit()); } catch (e) { _err(res, e); }
});

// ── Report ────────────────────────────────────────────────────────────────────

router.post("/rc3/report/generate", (req, res) => {
  try { _ok(res, svc.generateRC3Report()); } catch (e) { _err(res, e); }
});

router.get("/rc3/report", (req, res) => {
  try {
    const r = svc.getRC3Report();
    if (!r) return res.status(404).json({ ok: false, error: "No RC-3 report. POST /rc3/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

// ── Individual area routes ────────────────────────────────────────────────────

router.get("/rc3/areas", (req, res) => {
  _ok(res, {
    areas: [
      { area: "A", name: "Runtime Stability",    weight: svc.AREA_WEIGHTS.A },
      { area: "B", name: "Autonomous Systems",   weight: svc.AREA_WEIGHTS.B },
      { area: "C", name: "Recovery",             weight: svc.AREA_WEIGHTS.C },
      { area: "D", name: "Resource Monitoring",  weight: svc.AREA_WEIGHTS.D },
      { area: "E", name: "Leak Detection",       weight: svc.AREA_WEIGHTS.E },
      { area: "F", name: "Connector Stability",  weight: svc.AREA_WEIGHTS.F },
      { area: "G", name: "Production Certification", weight: svc.AREA_WEIGHTS.G },
    ],
  });
});

router.get("/rc3/areas/:area", (req, res) => {
  try {
    const area = req.params.area.toUpperCase();
    _ok(res, svc.runArea(area));
  } catch (e) { _err(res, e, 400); }
});

// Convenience named area routes
router.get("/rc3/areas/runtime-stability",    (req, res) => { try { _ok(res, svc.certifyRuntimeStability()); } catch (e) { _err(res, e); } });
router.get("/rc3/areas/autonomous-systems",   (req, res) => { try { _ok(res, svc.certifyAutonomousSystems()); } catch (e) { _err(res, e); } });
router.get("/rc3/areas/recovery",             (req, res) => { try { _ok(res, svc.certifyRecovery()); } catch (e) { _err(res, e); } });
router.get("/rc3/areas/resource-monitoring",  (req, res) => { try { _ok(res, svc.certifyResourceMonitoring()); } catch (e) { _err(res, e); } });
router.get("/rc3/areas/leak-detection",       (req, res) => { try { _ok(res, svc.certifyLeakDetection()); } catch (e) { _err(res, e); } });
router.get("/rc3/areas/connector-stability",  (req, res) => { try { _ok(res, svc.certifyConnectorStability()); } catch (e) { _err(res, e); } });

// ── State + admin ─────────────────────────────────────────────────────────────

router.get("/rc3/state", (req, res) => {
  try { _ok(res, svc.getRC3State()); } catch (e) { _err(res, e); }
});

router.post("/rc3/reset", (req, res) => {
  try { _ok(res, svc.resetRC3State()); } catch (e) { _err(res, e); }
});

// ── Metadata ──────────────────────────────────────────────────────────────────

router.get("/rc3/metadata", (req, res) => {
  _ok(res, {
    version:     svc.RC3_VERSION,
    description: "7-Day Stability Certification — 7 areas, weighted composite, Go/No-Go",
    certDays:    svc.CERT_DAYS,
    areaWeights: svc.AREA_WEIGHTS,
    areas:       ["A: Runtime Stability", "B: Autonomous Systems", "C: Recovery",
                  "D: Resource Monitoring", "E: Leak Detection", "F: Connector Stability",
                  "G: Production Certification"],
  });
});

module.exports = router;
