"use strict";
/**
 * ACP-6 Bundle Routes — Repository-Wide Autonomous Editing
 *
 * POST /coding/bundle/plan        — analyze repo + AI plan + per-file patches
 * POST /coding/bundle/apply       — apply bundle through Engineering Pipeline
 * POST /coding/bundle/:id/rollback — restore all files to pre-bundle state
 * GET  /coding/bundle/:id         — get bundle status + files
 * GET  /coding/bundles            — list recent bundles
 * GET  /coding/bundle/stats       — aggregate metrics
 */

const router = require("express").Router();
const logger = require("../utils/logger");
const { requireAuth } = require("../middleware/authMiddleware");

function _re() {
    try { return require("../services/repositoryEditingEngine.cjs"); }
    catch (e) { logger.error(`[Bundle] engine load: ${e.message}`); return null; }
}

// ── POST /coding/bundle/plan ──────────────────────────────────────────────────
router.post("/coding/bundle/plan", requireAuth, async (req, res) => {
    try {
        const { goal, cwd } = req.body;
        if (!goal?.trim()) return res.status(400).json({ ok: false, error: "goal required" });

        const re = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });

        const root   = cwd || require("path").join(__dirname, "../../");
        const bundle = await re.planBundle(goal, root);
        res.json({ ok: true, bundle });
    } catch (err) {
        logger.error(`[Bundle/plan] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/bundle/apply ─────────────────────────────────────────────────
router.post("/coding/bundle/apply", requireAuth, async (req, res) => {
    try {
        const { bundleId, requireApproval = false } = req.body;
        if (!bundleId) return res.status(400).json({ ok: false, error: "bundleId required" });

        const re = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });

        const result = await re.applyBundle(bundleId, { requireApproval });
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[Bundle/apply] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/bundle/:id/rollback ──────────────────────────────────────────
router.post("/coding/bundle/:id/rollback", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const re     = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });

        const result = await re.rollbackBundle(id);
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[Bundle/rollback] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/bundle/stats ───────────────────────────────────────────────────
router.get("/coding/bundle/stats", requireAuth, (req, res) => {
    try {
        const re = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });
        res.json({ ok: true, stats: re.getBundleStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/bundles ───────────────────────────────────────────────────────
router.get("/coding/bundles", requireAuth, (req, res) => {
    try {
        const { limit } = req.query;
        const re        = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });
        const bundles = re.listBundles({ limit: limit ? Number(limit) : 20 });
        // Strip large originalContent for list view
        const light = bundles.map(b => ({
            bundleId:  b.bundleId,
            goal:      b.goal,
            status:    b.status,
            createdAt: b.createdAt,
            metrics:   b.metrics,
            plan:      b.plan ? { summary: b.plan.summary, riskLevel: b.plan.riskLevel, confidence: b.plan.confidence, commitMsg: b.plan.commitMsg } : null,
            fileCount: (b.files || []).length,
        }));
        res.json({ ok: true, bundles: light });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/bundle/:id ────────────────────────────────────────────────────
router.get("/coding/bundle/:id", requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const re     = _re();
        if (!re) return res.status(503).json({ ok: false, error: "repository editing engine unavailable" });

        const bundle = re.getBundle(id);
        if (!bundle) return res.status(404).json({ ok: false, error: "bundle not found" });

        // Strip originalContent from response to keep payload manageable
        const safe = {
            ...bundle,
            rollbackManifest: (bundle.rollbackManifest || []).map(m => ({ path: m.path, isNew: m.isNew })),
            files: (bundle.files || []).map(f => ({
                path:        f.path,
                role:        f.role,
                changeType:  f.changeType,
                isNew:       f.isNew,
                valid:       f.valid,
                error:       f.error,
                explanation: f.explanation,
                confidence:  f.confidence,
                patchSpecs:  (f.patchSpecs || []).map(s => ({
                    targetFile:       s.targetFile,
                    patchTarget:      s.patchTarget?.slice(0, 120),
                    patchReplacement: s.patchReplacement?.slice(0, 120),
                    description:      s.description,
                    valid:            s.valid,
                    error:            s.error,
                })),
                newContent:  f.isNew ? f.newContent?.slice(0, 500) : undefined,
            })),
        };
        res.json({ ok: true, bundle: safe });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
