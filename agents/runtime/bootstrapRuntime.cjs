"use strict";
/**
 * bootstrapRuntime — registers all production agents into the runtime registry.
 * Loaded once at server startup (backend/server.js). Fully additive — does not
 * modify any existing agent, executor, or autonomousLoop behavior.
 *
 * Each agent is wrapped in try/catch so a single bad require never blocks
 * the others from registering. Unregistered task types fall through to the
 * existing executor.cjs via executionEngine's legacy fallback.
 */

const path         = require("path");
const orchestrator = require("./runtimeOrchestrator.cjs");
const logger       = require("../../backend/utils/logger");

// ── 1. Desktop Agent ──────────────────────────────────────────────
// [Phase O] Removed from production bootstrap. Desktop automation is now an
// optional plugin at plugins/local-desktop/ — disabled by default on VPS.
// To re-enable, create a plugin loader that registers via orchestrator.registerAgent().

// ── 2. Browser Agent ──────────────────────────────────────────────
// Capabilities: web_search, open_url, named URL shortcuts
// browserAgent.run() already accepts the full task object — no adapter needed
try {
    const browser = require("../browserAgent.cjs");

    orchestrator.registerAgent({
        id:           "browser",
        capabilities: ["browser"],
        maxConcurrent: 3,
        handler: async (task) => browser.run(task),
    });
    logger.info("[Bootstrap] browser agent registered");
} catch (err) {
    logger.warn("[Bootstrap] browser agent skipped:", err.message);
}

// ── 3. Terminal Agent ─────────────────────────────────────────────
// Capabilities: terminal
// terminalAgent.run(command) takes a string — adapter extracts payload.command
try {
    const terminal = require("../terminalAgent.cjs");

    orchestrator.registerAgent({
        id:           "terminal",
        capabilities: ["terminal"],
        maxConcurrent: 2,
        handler: async (task) => {
            const command = task.payload?.command || task.command || "";
            return terminal.run(command);
        },
    });
    logger.info("[Bootstrap] terminal agent registered");
} catch (err) {
    logger.warn("[Bootstrap] terminal agent skipped:", err.message);
}

// ── 4. Automation Agent ───────────────────────────────────────────
// Capabilities: automation
// Handles start_lead_flow, start_content_flow, start_sales_funnel via n8n webhooks
try {
    const automation = require("../automationAgent.cjs");

    orchestrator.registerAgent({
        id:           "automation",
        capabilities: ["automation"],
        maxConcurrent: 2,
        handler: async (task) => automation.execute(task),
    });
    logger.info("[Bootstrap] automation agent registered");
} catch (err) {
    logger.warn("[Bootstrap] automation agent skipped:", err.message);
}

// ── 5. Dev Agent ──────────────────────────────────────────────────
// Capabilities: dev (code generation, file writing)
// devAgent.run() accepts the full task object — no adapter needed
try {
    const dev = require("../devAgent.cjs");

    orchestrator.registerAgent({
        id:           "dev",
        capabilities: ["dev"],
        maxConcurrent: 2,
        handler: async (task) => dev.run(task),
    });
    logger.info("[Bootstrap] dev agent registered");
} catch (err) {
    logger.warn("[Bootstrap] dev agent skipped:", err.message);
}

// ── 6. Filesystem Adapter ─────────────────────────────────────────
// Must be configured here — adapter blocks all I/O until configure() is called.
// Read-only by default; write access is not granted to runtime-dispatched tasks.
try {
    const fsAdapter = require("./adapters/filesystemExecutionAdapter.cjs");
    const projectRoot = path.resolve(__dirname, "../..");
    const result = fsAdapter.configure(projectRoot, { writeAllowed: false });
    if (result.configured) {
        logger.info(`[Bootstrap] filesystem adapter configured — sandbox: ${projectRoot} (read-only)`);
    } else {
        logger.warn("[Bootstrap] filesystem adapter configure() rejected:", result.reason);
    }
} catch (err) {
    logger.warn("[Bootstrap] filesystem adapter skipped:", err.message);
}

logger.info("[Bootstrap] Runtime agent registration complete");
