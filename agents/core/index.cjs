/**
 * Core barrel — single import point for all core + automation utilities.
 */

module.exports = {
    logManager:    require("../automation/logManager.cjs"),
    errorHandler:  require("../automation/errorHandler.cjs"),
    systemMonitor: require("../automation/systemMonitor.cjs"),
    groqClient:    require("./groqClient.cjs"),
    fileSystem:    require("./fileSystem.cjs")
};
