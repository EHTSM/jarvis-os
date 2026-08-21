"use strict";
/**
 * OP-1 — Ooplix Public Launch routes
 * /op1/* with requireAuth
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const svc = require("../services/op1PublicLaunch.cjs");

// OOPLIX V1 MASTER AUDIT (2026-08-16): same fix and same reasoning as rc1.js
// (backend/routes/rc1.js — see that file's comment for the full precedent
// chain). op1PublicLaunch.cjs confirmed 0 orgId occurrences. This route
// family's only real frontend consumer, PublicLaunch.jsx, is mounted inside
// ElectronWorkspace.jsx, itself a documented pure passthrough
// (`if (!isElectron()) return children`) in the actual web app — these
// executive/blockers/KPI/releases tabs render only inside the Electron
// desktop shell, never for a customer using the web product.
router.use("/op1", requireAuth, operatorOnly);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// Executive
router.get("/op1/executive",   (req, res) => { try { _ok(res, svc.getExecutive());       } catch(e) { _err(res,e); } });

// Weeks
router.get("/op1/weeks/:id",   (req, res) => { try { _ok(res, svc.getWeekStatus(req.params.id)); } catch(e) { _err(res,e,404); } });
router.post("/op1/weeks/:id/activate", (req, res) => {
  try { _ok(res, { week: svc.activateWeek(req.params.id) }); } catch(e) { _err(res,e,404); }
});
router.post("/op1/weeks/:weekId/items/:itemId/done",   (req, res) => {
  try { _ok(res, svc.updateWeekItem(req.params.weekId, req.params.itemId, true,  req.body?.note)); } catch(e) { _err(res,e,404); }
});
router.post("/op1/weeks/:weekId/items/:itemId/undone", (req, res) => {
  try { _ok(res, svc.updateWeekItem(req.params.weekId, req.params.itemId, false, req.body?.note)); } catch(e) { _err(res,e,404); }
});

// Escapes
router.get("/op1/escapes",     (req, res) => { try { _ok(res, svc.getEscapes());          } catch(e) { _err(res,e); } });
router.post("/op1/escapes",    (req, res) => {
  try { _ok(res, { escape: svc.logEscape(req.body) });     } catch(e) { _err(res,e); }
});
router.post("/op1/escapes/:id/resolve", (req, res) => {
  try { _ok(res, { escape: svc.resolveEscape(req.params.id) }); } catch(e) { _err(res,e,404); }
});

// Blockers
router.get("/op1/blockers",    (req, res) => { try { _ok(res, svc.getBlockers(req.query)); } catch(e) { _err(res,e); } });
router.post("/op1/blockers",   (req, res) => {
  try { _ok(res, { blocker: svc.reportBlocker(req.body) }); } catch(e) { _err(res,e); }
});
router.post("/op1/blockers/:id/resolve", (req, res) => {
  try { _ok(res, { blocker: svc.resolveBlocker(req.params.id) }); } catch(e) { _err(res,e,404); }
});

// Daily releases
router.get("/op1/releases",    (req, res) => { try { _ok(res, svc.getReleases());          } catch(e) { _err(res,e); } });
router.post("/op1/releases",   (req, res) => {
  try { _ok(res, { release: svc.logRelease(req.body) });   } catch(e) { _err(res,e); }
});

// KPIs
router.get("/op1/kpis",        (req, res) => { try { _ok(res, svc.getKPIDashboard());      } catch(e) { _err(res,e); } });
router.patch("/op1/kpis/:id",  (req, res) => {
  try { _ok(res, { kpi: svc.updateKPI(req.params.id, req.body.value) }); } catch(e) { _err(res,e,400); }
});

// Launch log
router.get("/op1/log",         (req, res) => { try { _ok(res, svc.getLaunchLog());         } catch(e) { _err(res,e); } });
router.post("/op1/log",        (req, res) => {
  try { _ok(res, { event: svc.logLaunchEvent(req.body) }); } catch(e) { _err(res,e); }
});

// Benchmark
router.get("/op1/benchmark",   (req, res) => { try { _ok(res, svc.runBenchmark());         } catch(e) { _err(res,e); } });

module.exports = router;
