"use strict";
/**
 * Founder Digital Identity Operating System (FDIOS) routes — /fdios/*
 * Production Mission 3.2
 *
 * All routes require auth. No plaintext secrets are ever returned.
 */

const router     = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _t = fn => { try { return fn(); } catch { return null; } };
const _os = () => _t(() => require("../services/founderIdentityOS.cjs"));

router.use("/fdios", requireAuth);

// ── M1 Identity Graph ─────────────────────────────────────────────────────────
// POST /fdios/identity/build — rebuild the full identity graph
router.post("/fdios/identity/build", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.buildIdentityGraph(req.body?.founderName || "Founder");
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /fdios/identity — get current identity graph (optional ?type= filter)
router.get("/fdios/identity", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = os.getIdentityGraph({ type: req.query.type });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M2 Asset Registry ─────────────────────────────────────────────────────────
// POST /fdios/assets/discover — run full asset discovery
router.post("/fdios/assets/discover", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.discoverAssets();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /fdios/assets — list asset registry (optional ?type= and ?search= filters)
router.get("/fdios/assets", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = os.getAssetRegistry({ type: req.query.type, search: req.query.search });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M3 Discovery Engine ───────────────────────────────────────────────────────
// POST /fdios/discovery — run automatic discovery (optional body: { connectorId })
router.post("/fdios/discovery", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.runDiscovery(req.body?.connectorId || "all");
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/discovery/:connectorId — discover from a specific connector
router.post("/fdios/discovery/:connectorId", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const result = await os.runDiscovery(connectorId);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M4 Relationship Engine ────────────────────────────────────────────────────
// POST /fdios/relationships/build — build dependency graph
router.post("/fdios/relationships/build", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.buildRelationshipGraph();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /fdios/relationships — query relationship graph (optional ?from= ?to= ?relation=)
router.get("/fdios/relationships", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = os.getRelationshipGraph({ from: req.query.from, to: req.query.to, relation: req.query.relation });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M5 Universal Import Engine ────────────────────────────────────────────────
// GET /fdios/import/formats — list supported import formats
router.get("/fdios/import/formats", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    res.json({ ok: true, formats: os.getImportFormats() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/import — import credentials from external password manager
// body: { format, content, passphrase? }
// SECURITY: content is raw export data from password manager — processed in memory, never logged/stored plaintext
router.post("/fdios/import", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { format, content, passphrase } = req.body || {};
    if (!format)  return res.status(400).json({ ok: false, error: "format required" });
    if (!content) return res.status(400).json({ ok: false, error: "content required" });
    const result = os.importCredentials(format, content, { passphrase });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── M6 Secret Discovery Engine ────────────────────────────────────────────────
// POST /fdios/secrets/scan — scan project files for exposed secrets (no values in report)
router.post("/fdios/secrets/scan", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const rootDir = req.body?.rootDir || process.cwd();
    const result = await os.runSecretDiscovery(rootDir);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M7 Credential Intelligence ────────────────────────────────────────────────
// POST /fdios/credential-intelligence/run — generate fresh credential intelligence report
router.post("/fdios/credential-intelligence/run", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.runCredentialIntelligence();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /fdios/credential-intelligence — get cached intelligence report
router.get("/fdios/credential-intelligence", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = os.getCredentialIntelligence();
    res.json({ ok: true, report: result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M8 Workspace Bootstrap ────────────────────────────────────────────────────
// POST /fdios/bootstrap — run full workspace bootstrap sequence
router.post("/fdios/bootstrap", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.runWorkspaceBootstrap({
      target:           req.body?.target,
      founderName:      req.body?.founderName,
      includeEnvContent: false, // never include sensitive env in API response
    });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M9 Permission Policy Engine ───────────────────────────────────────────────
// GET /fdios/policies — list all policies
router.get("/fdios/policies", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    res.json({ ok: true, policies: os.listPolicies(), modes: os.getPolicyModes() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/policies — set a permission policy
// body: { scope: { provider?, project?, workflow?, riskLevel? }, mode }
router.post("/fdios/policies", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { scope, mode, meta } = req.body || {};
    if (!scope || !mode) return res.status(400).json({ ok: false, error: "scope and mode required" });
    const result = os.setPolicy(scope, mode, meta || {});
    res.json({ ok: true, policy: result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// GET /fdios/policies/check — check effective policy for a scope
router.get("/fdios/policies/check", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const scope = {
      provider:  req.query.provider  || undefined,
      project:   req.query.project   || undefined,
      workflow:  req.query.workflow   || undefined,
      riskLevel: req.query.riskLevel  || undefined,
    };
    const result = os.getPolicy(scope);
    res.json({ ok: true, policy: result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/policies/decision — record a policy decision
// body: { scope, decision: "allowed"|"denied" }
router.post("/fdios/policies/decision", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { scope, decision, meta } = req.body || {};
    if (!scope || !decision) return res.status(400).json({ ok: false, error: "scope and decision required" });
    const result = os.recordDecision(scope, decision, meta || {});
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── M10 Founder Command Center ────────────────────────────────────────────────
// GET /fdios/command-center — full command center dashboard
router.get("/fdios/command-center", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.getCommandCenter();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /fdios/command-center/search — search across identity, assets, connectors
router.get("/fdios/command-center/search", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const q = req.query.q || req.query.query;
    if (!q) return res.status(400).json({ ok: false, error: "q query param required" });
    const result = os.searchCommandCenter(q);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── M11 Recovery Kit ─────────────────────────────────────────────────────────
// GET /fdios/recovery/status — recovery readiness status
router.get("/fdios/recovery/status", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    res.json({ ok: true, ...os.getRecoveryStatus() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/recovery/generate — generate encrypted recovery kit
// body: { passphrase } — kit encrypted with passphrase, never stored
// SECURITY: passphrase is required but never stored; only the encrypted kit blob is returned
router.post("/fdios/recovery/generate", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { passphrase } = req.body || {};
    if (!passphrase) return res.status(400).json({ ok: false, error: "passphrase required" });
    if (passphrase.length < 12) return res.status(400).json({ ok: false, error: "passphrase must be at least 12 characters" });
    const result = await os.generateRecoveryKit(passphrase);
    // Return the kit blob as a download attachment
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="ooplix-recovery-kit-${Date.now()}.json"`);
    res.json({ ok: true, manifest: result.manifest, kit: result.kit, size: result.size });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/recovery/restore — restore from encrypted kit
// body: { kit, passphrase }
router.post("/fdios/recovery/restore", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { kit, passphrase } = req.body || {};
    if (!kit)        return res.status(400).json({ ok: false, error: "kit required" });
    if (!passphrase) return res.status(400).json({ ok: false, error: "passphrase required" });
    const result = await os.restoreFromKit(kit, passphrase);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── M12 Cross-Device Synchronization ─────────────────────────────────────────
// GET /fdios/sync/state — get sync state across all devices
router.get("/fdios/sync/state", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    res.json({ ok: true, ...os.getSyncState() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /fdios/sync/:deviceId — record a device sync
// body: { version?, resolution? }
router.post("/fdios/sync/:deviceId", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = os.recordDeviceSync(req.params.deviceId, req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// POST /fdios/sync/:deviceId/resolve-conflict — resolve a sync conflict
// body: { resolution: "local_wins"|"remote_wins"|"merged" }
router.post("/fdios/sync/:deviceId/resolve-conflict", (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const { resolution } = req.body || {};
    if (!resolution) return res.status(400).json({ ok: false, error: "resolution required" });
    const result = os.resolveConflict(req.params.deviceId, resolution);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Full System Scan ──────────────────────────────────────────────────────────
// POST /fdios/scan — run identity + assets + relationships + credential intel together
router.post("/fdios/scan", async (req, res) => {
  try {
    const os = _os();
    if (!os) return res.status(503).json({ ok: false, error: "founderIdentityOS unavailable" });
    const result = await os.runFullSystemScan();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
