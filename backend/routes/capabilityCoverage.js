"use strict";
/**
 * Phase 1 — Capability Coverage (Missions 101-120).
 *
 * Read-only HTTP surface over the existing canonical capability registry
 * (skillRegistry.cjs) plus the new discovery/routing composition layers
 * (capabilityDiscovery.cjs, capabilityRouting.cjs). Mounted with the same
 * requireAuth + attachOrg pattern as its nearest sibling, /p26/capabilities
 * (backend/routes/phase26.js), per CLAUDE.md's "match sibling middleware"
 * rule — attachOrg is non-blocking (see orgMiddleware.cjs) and kept for
 * consistency even though these endpoints read org-agnostic registries.
 *
 *   GET  /p1/capabilities              list all registered capabilities
 *   GET  /p1/capabilities/:id          single capability + live routing preview
 *   GET  /p1/capabilities/discover     NL intent -> ranked capability matches
 *   GET  /p1/capabilities/route/:id    capability -> agent/connector/approval routing
 *   GET  /p1/domains                   domain/category coverage matrix
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg } = require("../middleware/orgMiddleware.cjs");

router.use("/p1/capabilities", requireAuth, attachOrg);
router.use("/p1/domains", requireAuth, attachOrg);

function _skillRegistry() { try { return require("../services/skillRegistry.cjs"); } catch { return null; } }
function _discovery()     { try { return require("../services/capabilityDiscovery.cjs"); } catch { return null; } }
function _routing()       { try { return require("../services/capabilityRouting.cjs"); } catch { return null; } }

// Discovery must be registered before the ":id" param route below —
// Express matches in registration order and "discover"/"route" would
// otherwise be swallowed as a literal :id value.
router.get("/p1/capabilities/discover", (req, res) => {
    try {
        const discovery = _discovery();
        if (!discovery) return res.status(503).json({ success: false, error: "capabilityDiscovery unavailable" });
        const { q, domain, limit } = req.query;
        if (!q && !domain) return res.status(400).json({ success: false, error: "q or domain required" });
        const result = discovery.discover(q || "", { domain, limit: limit ? parseInt(limit, 10) : undefined });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p1/capabilities/route/:id", (req, res) => {
    try {
        const routing = _routing();
        if (!routing) return res.status(503).json({ success: false, error: "capabilityRouting unavailable" });
        const result = routing.routeCapability(req.params.id);
        if (!result.ok && result.blockedReasons.includes("unknown_capability")) {
            return res.status(404).json({ success: false, error: "Unknown capability", capabilityId: req.params.id });
        }
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p1/capabilities/:id", (req, res) => {
    try {
        const skillRegistry = _skillRegistry();
        if (!skillRegistry) return res.status(503).json({ success: false, error: "skillRegistry unavailable" });
        const skill = skillRegistry.getSkill(req.params.id);
        if (!skill) return res.status(404).json({ success: false, error: "Unknown capability", capabilityId: req.params.id });
        const routing = _routing();
        const routingPreview = routing ? routing.routeCapability(req.params.id) : null;
        res.json({ success: true, capability: skill, routingPreview });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p1/capabilities", (req, res) => {
    try {
        const skillRegistry = _skillRegistry();
        if (!skillRegistry) return res.status(503).json({ success: false, error: "skillRegistry unavailable" });
        const { category, riskLevel } = req.query;
        let skills = skillRegistry.listSkills();
        if (category)  skills = skills.filter(s => s.category === category);
        if (riskLevel) skills = skills.filter(s => s.riskLevel === riskLevel);
        res.json({ success: true, capabilities: skills, total: skills.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p1/domains", (_req, res) => {
    try {
        const discovery = _discovery();
        if (!discovery) return res.status(503).json({ success: false, error: "capabilityDiscovery unavailable" });
        const domains = discovery.listDomains();
        res.json({ success: true, domains, total: domains.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
