"use strict";
/**
 * ODI-1 — Visual Capture Engine routes
 *
 * GET  /odi/screenshots          — list captured screenshots
 * POST /odi/capture              — capture a screenshot
 *
 * POST body for /odi/capture:
 *   source: "playwright" | "desktop" | "viewport"   (default: "playwright")
 *
 *   For source "playwright":
 *     pageId?   — reuse an open tab; if omitted, a new headless tab is opened
 *     url?      — navigate to URL before capturing (only if pageId is omitted)
 *     fullPage? — capture full scrollable page (default: false)
 *
 *   For source "desktop":
 *     label?    — human label for the sidecar metadata
 *
 *   For source "viewport":
 *     url       — required — URL to open and capture
 *     width?    — viewport width  (default: 1280)
 *     height?   — viewport height (default: 900)
 *     fullPage? — capture full scrollable page (default: false)
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter     = require("../middleware/rateLimiter");

function _svc() { return require("../services/visualCaptureService.cjs"); }

router.use("/odi", requireAuth);

// ── GET /odi/screenshots ──────────────────────────────────────────────────────
router.get("/odi/screenshots", (req, res) => {
  try {
    const { limit, source } = req.query;
    const shots = _svc().listScreenshots({
      limit:  limit  ? parseInt(limit, 10) : 50,
      source: source || undefined,
    });
    return res.json({ success: true, count: shots.length, screenshots: shots });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /odi/capture ─────────────────────────────────────────────────────────
router.post("/odi/capture", rateLimiter(10, 60_000), async (req, res) => {
  const {
    source   = "playwright",
    pageId, url, fullPage,
    label,
    width, height,
  } = req.body || {};

  try {
    let result;

    if (source === "desktop") {
      result = await _svc().captureDesktop({ label });
    } else if (source === "viewport") {
      if (!url) return res.status(400).json({ success: false, error: "url required for viewport capture" });
      result = await _svc().captureViewport({ url, width, height, fullPage: !!fullPage });
    } else {
      // default: playwright
      result = await _svc().captureFromPage({ pageId, fullPage: !!fullPage, url });
    }

    if (!result.ok) {
      return res.status(422).json({ success: false, error: result.error });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
