"use strict";
/**
 * Production Wiring Sprint 2 — routes
 * /wiring2/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/productionWiring2.cjs");

function _ok(res, data)       { res.json({ ok: true, ...data }); }
function _err(res, e, code=500){ res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// Full audit — POST triggers live requests (~15-20s)
router.post("/wiring2/audit", requireAuth, async (req, res) => {
  try { _ok(res, { report: await svc.runFullAudit() }); } catch (e) { _err(res, e); }
});

// Last cached report (fast)
router.get("/wiring2/report", requireAuth, async (req, res) => {
  try {
    const report = svc.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No audit run yet — POST /wiring2/audit first" });
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// History (summaries only)
router.get("/wiring2/history", requireAuth, async (req, res) => {
  try { _ok(res, { history: svc.getReportHistory() }); } catch (e) { _err(res, e); }
});

// Single integration re-audit
router.post("/wiring2/audit/:integration", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditSingle(req.params.integration) }); }
  catch (e) { _err(res, e.message?.includes("Unknown") ? 400 : 500, e); }
});

// Per-integration live GET endpoints
router.get("/wiring2/smtp",       requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditSMTP()         }); } catch(e){_err(res,e);} });
router.get("/wiring2/ai",         requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditAIExtended()   }); } catch(e){_err(res,e);} });
router.get("/wiring2/oauth",      requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditOAuthExtended()}); } catch(e){_err(res,e);} });
router.get("/wiring2/monitoring", requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditMonitoring()   }); } catch(e){_err(res,e);} });
router.get("/wiring2/storage",    requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditStorage()      }); } catch(e){_err(res,e);} });
router.get("/wiring2/e2e",        requireAuth, async (req, res) => { try { _ok(res, { result: await svc.auditE2E()          }); } catch(e){_err(res,e);} });

// Benchmark
router.get("/wiring2/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, await svc.runBenchmark()); } catch (e) { _err(res, e); }
});

// Env var manifest — what's missing / present
router.get("/wiring2/env", requireAuth, async (req, res) => {
  try {
    const missing = [], present = [];
    const all = Object.entries(svc.ENV_VAR_MANIFEST).flatMap(([integration, vars]) =>
      vars.map(v => ({ ...v, integration })));
    for (const v of all) {
      (process.env[v.key] ? present : missing).push(v);
    }
    _ok(res, { missing, present, missingCount: missing.length, presentCount: present.length });
  } catch (e) { _err(res, e); }
});

module.exports = router;
