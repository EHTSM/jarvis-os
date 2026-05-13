"use strict";
/**
 * Route barrel — mounts all domain route files.
 * Import order determines Express match priority for overlapping prefixes.
 * Specific paths (webhooks, ai, simulation) before broad ones (crm, ops).
 */
const router = require("express").Router();

router.use(require("./jarvis"));       // POST /jarvis
router.use(require("./whatsapp"));     // /whatsapp/*
router.use(require("./payment"));      // /payment/*, /webhook/razorpay, /razorpay-webhook
router.use(require("./crm"));          // /crm, /crm-leads, /crm/lead/*
router.use(require("./ai"));           // POST /ai/chat
router.use(require("./simulation"));   // POST /simulate/*, /send-followup
router.use(require("./ops"));          // /health, /ops, /stats, /metrics, /test, /api/status

module.exports = router;
