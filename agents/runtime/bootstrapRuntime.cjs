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
let _fsAdapter = null;
try {
    const fsAdapter = require("./adapters/filesystemExecutionAdapter.cjs");
    const projectRoot = path.resolve(__dirname, "../..");
    const result = fsAdapter.configure(projectRoot, { writeAllowed: true });
    if (result.configured) {
        _fsAdapter = fsAdapter;
        logger.info(`[Bootstrap] filesystem adapter configured — sandbox: ${projectRoot} (read+write, protected dirs enforced)`);
    } else {
        logger.warn("[Bootstrap] filesystem adapter configure() rejected:", result.reason);
    }
} catch (err) {
    logger.warn("[Bootstrap] filesystem adapter skipped:", err.message);
}

// ── 7. Filesystem Agent ────────────────────────────────────────────
if (_fsAdapter) {
    try {
        orchestrator.registerAgent({
            id: "filesystem",
            capabilities: ["filesystem"],
            maxConcurrent: 2,
            handler: async (task) => {
                const payload = task.payload || {};
                const cmd = payload.command;
                if (cmd === "read") {
                    return _fsAdapter.readFile(payload.filePath, payload.options || {});
                }
                if (cmd === "write") {
                    return _fsAdapter.writeFile(payload.filePath, payload.content || "", { ...(payload.options || {}), createDirs: true });
                }
                if (cmd === "list") {
                    return _fsAdapter.readDir(payload.filePath, payload.options || {});
                }
                if (cmd === "stat") {
                    return _fsAdapter.statFile(payload.filePath);
                }
                if (cmd === "exists") {
                    return _fsAdapter.fileExists(payload.filePath);
                }
                return { success: false, error: `unsupported_filesystem_task: ${cmd}` };
            },
        });
        logger.info("[Bootstrap] filesystem agent registered");
    } catch (err) {
        logger.warn("[Bootstrap] filesystem agent skipped:", err.message);
    }
}

// ── 8. Local Desktop Agent (optional) ───────────────────────────────
const enableLocalDesktop = process.env.ENABLE_LOCAL_DESKTOP === "1" || process.env.ENABLE_RUNTIME_DESKTOP === "1";
if (enableLocalDesktop) {
    try {
        const DesktopAgent = require("../../plugins/local-desktop/desktopAgent.cjs");
        const desktop = new DesktopAgent();
        if (desktop.available) {
            orchestrator.registerAgent({
                id: "desktop",
                capabilities: ["desktop"],
                maxConcurrent: 1,
                handler: async (task) => {
                    const payload = task.payload || {};
                    switch (task.type) {
                        case "open_app":
                            return desktop.openApp(payload.appName || payload.app || "");
                        case "type_text":
                            return desktop.typeText(payload.text || "");
                        case "press_key":
                            return desktop.pressKey(payload.key || "enter");
                        case "key_combo":
                            return desktop.pressKeyCombo(payload.modifiers || [], payload.key || "c");
                        case "click":
                            return desktop.click(payload.button || "left");
                        case "double_click":
                            return desktop.doubleClick(payload.button || "left");
                        case "move_mouse":
                            return desktop.moveMouse(payload.x || 0, payload.y || 0);
                        default:
                            return { success: false, error: `unsupported_desktop_task: ${task.type}` };
                    }
                },
            });
            logger.info("[Bootstrap] local-desktop agent registered");
        } else {
            logger.warn("[Bootstrap] local-desktop plugin loaded but unavailable");
        }
    } catch (err) {
        logger.warn("[Bootstrap] local-desktop plugin skipped:", err.message);
    }
}

// ── CRM Agent — handles get_leads / note / reminder via crmService ───
try {
    const crm = require("../../backend/services/crmService");

    orchestrator.registerAgent({
        id:           "crm",
        capabilities: ["crm"],
        maxConcurrent: 5,
        handler: async (task) => {
            const type = task.type || "";
            if (type === "get_leads") {
                const leads = crm.getLeads();
                return { type: "leads", result: leads, success: true };
            }
            if (type === "note" || type === "reminder") {
                const p = task.payload || {};
                if (p.phone) crm.updateLead(p.phone, { note: p.note || p.text || task.input, updatedAt: new Date().toISOString() });
                return { type, result: "saved", success: true };
            }
            return { type, result: null, success: false, error: `unsupported_crm_task: ${type}` };
        },
    });
    logger.info("[Bootstrap] CRM agent registered");
} catch (err) {
    logger.error("[Bootstrap] CRM agent FAILED to register:", err.message, err.stack);
}

// ── AI Agent — handles "ai" task type via aiService.callAI ───────────
try {
    const { callAI } = require("../../backend/services/aiService.js");

    orchestrator.registerAgent({
        id:           "ai",
        capabilities: ["ai", "intelligence"],
        maxConcurrent: 5,
        handler: async (task) => {
            const query = task.payload?.query || task.input || task.label || "";
            const reply = await callAI(query);
            return { type: "ai", result: reply, message: reply, success: !!reply && !reply.startsWith("AI backend unavailable") };
        },
    });
    logger.info("[Bootstrap] AI agent registered");
} catch (err) {
    logger.warn("[Bootstrap] AI agent skipped:", err.message);
}

const _registry = require("./agentRegistry.cjs");
const _registered = _registry.listAll().map(a => `${a.id}[${a.capabilities.join(",")}]`);
logger.info("[Bootstrap] Runtime agent registration complete — " + _registered.join(" | "));
