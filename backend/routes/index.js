"use strict";
/**
 * Route barrel — mounts all domain route files.
 * Import order determines Express match priority for overlapping prefixes.
 * Specific paths (webhooks, ai, simulation) before broad ones (crm, ops).
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

router.use(require("./auth"));         // POST /auth/login, POST /auth/logout, GET /auth/me
router.use(require("./accounts"));    // POST /accounts/register, GET /accounts/me, GET /accounts
router.use(require("./settings"));    // GET /settings/status, POST /settings/whatsapp, POST /settings/razorpay
router.use(require("./billing"));     // GET /billing/status, POST /billing/upgrade, POST /billing/cancel
router.use(require("./jarvis"));       // POST /jarvis
router.use(require("./whatsapp"));     // /whatsapp/*
router.use(require("./telegram"));     // /telegram/send, /telegram/status
router.use(require("./payment"));      // /payment/*, /webhook/razorpay, /razorpay-webhook
router.use(require("./crm"));          // /crm, /crm-leads, /crm/lead/*
router.use(require("./ai"));           // POST /ai/chat
router.use(require("./simulation"));   // POST /simulate/*, /send-followup
router.use(require("./ops"));          // /health, /ops, /stats, /metrics, /test, /api/status
router.use("/runtime", requireAuth);   // gate all /runtime/* routes
router.use(require("./runtime"));      // /runtime/dispatch, /runtime/queue, /runtime/status, /runtime/history
router.use(require("../../agents/runtime/runtimeStream.cjs")); // GET /runtime/stream, /runtime/stream/status
router.use(require("./tasks"));        // /tasks, /scheduler/status, /queue/status
router.use(require("./browser"));      // /browser/run, /browser/action, /browser/navigate, /browser/sessions, /browser/status
router.use(require("./phase18"));      // /p18/actions, /p18/agents, /p18/memory, /p18/cycles
router.use(require("./phase19"));      // /p19/tools, /p19/coord, /p19/heal, /p19/learn

module.exports = router;
