/**
 * Core Gateway — single entry point for all Jarvis requests.
 * Routes by mode:
 *   sales  → moneyFlow pipeline
 *   auto   → executor directly
 *   smart  → full orchestrator (default)
 */
const moneyFlow      = require("./moneyFlow.cjs");
const logger         = require("./logger.cjs");

let _orchestrator, _executor;

function getOrchestrator() {
    if (!_orchestrator) _orchestrator = require("../orchestrator.cjs");
    return _orchestrator;
}
function getExecutor() {
    if (!_executor) _executor = require("../agents/executor.cjs");
    return _executor;
}

async function gateway(input, mode = "smart", phone = null, meta = {}) {
    logger.info("Gateway", { mode, inputLen: input?.length });

    if (!input || typeof input !== "string") {
        return { success: false, error: "Input required" };
    }

    // ── SALES MODE: lead → AI closer → payment → CRM → follow-up ──
    if (mode === "sales") {
        return moneyFlow.run({ input, phone, name: meta.name, context: meta.context });
    }

    // ── AUTO MODE: direct execution without orchestrator overhead ──
    if (mode === "auto") {
        try {
            const { executorAgent } = getExecutor();
            const result = await executorAgent({ type: "ai", payload: { query: input } });
            return { success: true, mode: "auto", result };
        } catch (err) {
            logger.error("Auto mode error", { error: err.message });
            return { success: false, error: err.message };
        }
    }

    // ── SMART MODE (default): full orchestrator pipeline ──
    try {
        const { orchestrator } = getOrchestrator();
        const result = await orchestrator(input);
        return { success: true, mode: "smart", ...result };
    } catch (err) {
        logger.error("Smart mode error", { error: err.message });
        return { success: false, error: err.message };
    }
}

module.exports = { gateway };
