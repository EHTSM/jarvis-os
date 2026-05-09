/**
 * Tool Executor — runs the selected tool via injected handlers.
 * Built-in fallbacks handle api_call and system tasks directly.
 * All other tools are handled by handlers passed from the executor.
 */

const logManager = require("./logManager.cjs");
const apiManager = require("./apiManager.cjs");

async function execute({ tool, task }, handlers = {}) {
    logManager.info("ToolExecutor.execute", { tool, taskType: task?.type });

    // Injected handler takes priority — preserves all existing executor logic
    if (handlers[tool]) {
        return await handlers[tool](task);
    }

    // Built-in: direct API calls (no executor handler needed)
    if (tool === "api") {
        const { url, method, headers, body, params, auth } = task?.payload || {};
        return apiManager.call({ url, method, headers, body, params, auth });
    }

    // Built-in: basic system queries (date/time) when called outside the executor
    if (tool === "system") {
        if (task?.type === "time") return { success: true, type: "time", result: `Current time is: ${new Date().toLocaleTimeString()} ⏰` };
        if (task?.type === "date") return { success: true, type: "date", result: `Today's date is: ${new Date().toLocaleDateString()} 📅` };
        return { success: true, type: task?.type, result: "System task acknowledged" };
    }

    // No handler registered for this tool — return safe unknown response
    logManager.warn("ToolExecutor: no handler for tool", { tool, taskType: task?.type });
    return {
        success:  false,
        type:     "unsupported",
        result:   `No handler registered for tool: ${tool}`,
        tool
    };
}

module.exports = { execute };
