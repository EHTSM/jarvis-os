/**
 * Automation Engine — central controller for the automation layer.
 * Flow: task → toolSelector → toolExecutor → systemMonitor → return
 * Errors are caught by errorHandler and logged by logManager.
 */

const logManager    = require("./logManager.cjs");
const errorHandler  = require("./errorHandler.cjs");
const systemMonitor = require("./systemMonitor.cjs");
const toolSelector  = require("./toolSelector.cjs");
const toolExecutor  = require("./toolExecutor.cjs");

async function run(task, handlers = {}) {
    logManager.info("AutomationEngine.run", { type: task?.type });

    if (!task || !task.type) {
        const err = errorHandler.handle(new Error("AutomationEngine: task.type is required"), {});
        systemMonitor.record(task, err);
        return err;
    }

    let selected, result;

    try {
        // Stage 1: select tool for this task
        selected = toolSelector.select(task);

        // Stage 2: execute via selected tool handler
        result = await toolExecutor.execute(selected, handlers);

        // Stage 3: record in monitor
        systemMonitor.record(task, result);

        logManager.info("AutomationEngine.done", { type: task?.type, success: result?.success });
        return result;

    } catch (err) {
        const safe = errorHandler.handle(err, { taskType: task?.type, tool: selected?.tool });
        systemMonitor.record(task, safe);
        return safe;
    }
}

module.exports = { run };
