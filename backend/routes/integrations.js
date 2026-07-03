"use strict";
/**
 * integrations.js — Production Mission 3
 *
 * Unified /integrations/* routes providing:
 *   connect · health · status · reconnect · rotateCredentials ·
 *   failures · metrics · phases dashboard · full scan
 *
 * All routes are auth-gated.
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _ic  = () => _try(() => require("../services/integrationConnectors.cjs"));

router.use("/integrations", requireAuth);

// ── Full scan ─────────────────────────────────────────────────────────────────
// POST so it can be triggered on demand without browser caching issues
router.post("/integrations/scan", async (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const result = await ic.runFullScan();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Summary (uses cached state, no live probes) ───────────────────────────────
router.get("/integrations/summary", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    res.json({ ok: true, ...ic.getScanSummary() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── All connectors (cached state) ────────────────────────────────────────────
router.get("/integrations", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectors = ic.getAllStatus();
    const byPhase    = {};
    connectors.forEach(c => { byPhase[c.phase] = byPhase[c.phase] || []; byPhase[c.phase].push(c); });
    res.json({ ok: true, total: connectors.length, byPhase, connectors });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Failures (connectors with missing credentials) ────────────────────────────
router.get("/integrations/failures", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const failures = ic.detectFailures();
    res.json({ ok: true, count: failures.length, failures });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Phase dashboard — grouped by phase A-L ───────────────────────────────────
router.get("/integrations/phases", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectors = ic.getAllStatus();
    const PHASE_LABELS = {
      A: "AI Providers",   B: "Git",           C: "Infrastructure",
      D: "Payments",       E: "Email",          F: "Messaging",
      G: "Authentication", H: "Productivity",   I: "Commerce",
      J: "Creative",       K: "Automation",     L: "Monitoring",
    };
    const phases = {};
    connectors.forEach(c => {
      if (!phases[c.phase]) phases[c.phase] = { phase: c.phase, label: PHASE_LABELS[c.phase] || c.phase, connectors: [], connected: 0, ready: 0, partial: 0, missing: 0 };
      phases[c.phase].connectors.push(c);
      if (c.status === "CONNECTED") phases[c.phase].connected++;
      else if (c.status === "READY") phases[c.phase].ready++;
      else if (c.status === "PARTIAL") phases[c.phase].partial++;
      else if (c.status === "MISSING") phases[c.phase].missing++;
    });
    const summary = ic.getScanSummary();
    res.json({ ok: true, phases: Object.values(phases), summary });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Single connector status (cached) ─────────────────────────────────────────
router.get("/integrations/:id/status", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    // Connector IDs contain ":" — Express route param stops at ":", so we decode from query or from the raw URL
    const connectorId = decodeURIComponent(req.params.id);
    const status = ic.getStatus(connectorId);
    if (!status) return res.status(404).json({ ok: false, error: `Connector not found: ${connectorId}` });
    res.json({ ok: true, connector: status });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Metrics (cached) ──────────────────────────────────────────────────────────
router.get("/integrations/:id/metrics", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectorId = decodeURIComponent(req.params.id);
    const metrics = ic.getMetrics(connectorId);
    if (!metrics) return res.status(404).json({ ok: false, error: `Connector not found: ${connectorId}` });
    res.json({ ok: true, ...metrics });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Live health probe ─────────────────────────────────────────────────────────
router.post("/integrations/:id/health", async (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectorId = decodeURIComponent(req.params.id);
    const health = await ic.getHealth(connectorId);
    res.json({ ok: true, ...health });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Reconnect (live re-probe using stored/env credentials) ───────────────────
router.post("/integrations/:id/reconnect", async (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectorId = decodeURIComponent(req.params.id);
    const result = await ic.reconnect(connectorId);
    res.json({ ok: true, connector: result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Credential rotation guide ─────────────────────────────────────────────────
router.get("/integrations/:id/rotate", (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectorId = decodeURIComponent(req.params.id);
    const guide = ic.rotateCredentialsGuide(connectorId);
    if (guide.error) return res.status(404).json({ ok: false, error: guide.error });
    res.json({ ok: true, ...guide });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Connect (alias for reconnect + explicit body for future use) ───────────────
// Body can carry provider-specific context (e.g. { note: "added via UI" })
// Actual credentials come from env vars only — never from request body.
router.post("/integrations/:id/connect", async (req, res) => {
  try {
    const ic = _ic();
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });
    const connectorId = decodeURIComponent(req.params.id);
    const result = await ic.reconnect(connectorId);
    res.json({ ok: true, connector: result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
