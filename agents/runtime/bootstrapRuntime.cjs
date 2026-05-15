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

const orchestrator = require("./runtimeOrchestrator.cjs");
const logger       = require("../../backend/utils/logger");

// ── 1. Desktop Agent ──────────────────────────────────────────────
// Capabilities: open_app, type_text, press_key, key_combo
// maxConcurrent=1 — keyboard/mouse operations are inherently serial
try {
    const { DesktopAgent } = require("../desktopAgent.cjs");
    const _da = new DesktopAgent();

    orchestrator.registerAgent({
        id:           "desktop",
        capabilities: ["desktop"],
        maxConcurrent: 1,
        handler: async (task) => {
            const type = task.type;
            const p    = task.payload || {};
            if (type === "open_app")  return _da.openApp(p.app || p.appName || "");
            if (type === "type_text") return _da.typeText(p.text || "");
            if (type === "press_key") return _da.pressKey(p.key || "enter");
            if (type === "key_combo") return _da.pressKeyCombo(p.modifiers || [], p.key || "c");
            return { success: false, message: `DesktopAgent: unhandled type "${type}"` };
        },
    });
    logger.info("[Bootstrap] desktop agent registered");
} catch (err) {
    logger.warn("[Bootstrap] desktop agent skipped:", err.message);
}

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

logger.info("[Bootstrap] Runtime agent registration complete");
