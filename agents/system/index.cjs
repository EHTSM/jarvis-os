/**
 * System barrel — exports all system-level monitoring modules.
 */

module.exports = {
    systemHealth:  require("./systemHealth.cjs"),
    systemMonitor: require("../automation/systemMonitor.cjs"),
    logManager:    require("../automation/logManager.cjs")
};
