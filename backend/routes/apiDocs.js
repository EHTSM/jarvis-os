"use strict";
/**
 * API Documentation — real OpenAPI 3.0 + Postman collection generation.
 * Enterprise Capability Expansion mission.
 *
 * Both are derived from openApiGenerator.cjs's introspection of the
 * ACTUAL live Express router tree (backend/routes/index.js) — every path
 * in these documents is a route that genuinely exists right now, not a
 * hand-maintained spec that can drift from reality.
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");

// Live JSON — always current, no persistence needed, cheap to compute.
router.get("/api-docs/openapi.json", requireAuth, operatorOnly, (req, res) => {
  try {
    const { generateSpec } = require("../services/openApiGenerator.cjs");
    const spec = generateSpec({ serverUrl: `${req.protocol}://${req.get("host")}` });
    res.json(spec);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Downloadable file version, persisted via the shared exportFileService —
// useful for importing into external tools (Swagger UI, Redocly, Postman)
// that expect a fetchable file rather than an authenticated JSON endpoint.
router.get("/api-docs/openapi/export", requireAuth, operatorOnly, async (req, res) => {
  try {
    const { generateSpec } = require("../services/openApiGenerator.cjs");
    const spec = generateSpec({ serverUrl: `${req.protocol}://${req.get("host")}` });
    const buffer = Buffer.from(JSON.stringify(spec, null, 2), "utf8");

    const exportFiles = require("../services/exportFileService.cjs");
    const result = await exportFiles.persist(buffer, {
      filename: `openapi-${Date.now()}.json`,
      mimeType: "application/json",
      orgId: null,
      accountId: req.user?.sub || req.user?.id || null,
      capability: "openapi_export",
      tags: ["api-docs", "openapi"],
    });
    res.json({ ok: true, ...result, routeCount: spec._meta.routeCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Postman Collection v2.1 — derived from the SAME generateSpec() output,
// not a second independent walk of the router (the mission explicitly
// requires Postman to not duplicate the OpenAPI work).
router.get("/api-docs/postman/export", requireAuth, operatorOnly, async (req, res) => {
  try {
    const { generateSpec } = require("../services/openApiGenerator.cjs");
    const { toPostmanCollection } = require("../services/postmanGenerator.cjs");
    const spec = generateSpec({ serverUrl: `${req.protocol}://${req.get("host")}` });
    const collection = toPostmanCollection(spec);
    const buffer = Buffer.from(JSON.stringify(collection, null, 2), "utf8");

    const exportFiles = require("../services/exportFileService.cjs");
    const result = await exportFiles.persist(buffer, {
      filename: `postman-collection-${Date.now()}.json`,
      mimeType: "application/json",
      orgId: null,
      accountId: req.user?.sub || req.user?.id || null,
      capability: "postman_export",
      tags: ["api-docs", "postman"],
    });
    res.json({ ok: true, ...result, routeCount: spec._meta.routeCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
