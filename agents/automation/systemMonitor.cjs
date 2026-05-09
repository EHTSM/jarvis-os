/**
 * System Monitor — tracks execution health and task history.
 * In-process state; swap _state persistence to Redis/DB for multi-instance.
 */

const logManager = require("./logManager.cjs");

const _state = {
    startedAt:   new Date().toISOString(),
    executions:  0,
    failures:    0,
    lastTask:    null,
    lastResult:  null,
    lastTs:      null,
    taskHistory: []   // ring buffer — last 100
};

const MAX_HISTORY = 100;

function record(task, result) {
    const ok = result?.success !== false && result !== null;

    _state.executions++;
    if (!ok) _state.failures++;
    _state.lastTask   = task?.type || "unknown";
    _state.lastResult = ok ? "ok" : "fail";
    _state.lastTs     = new Date().toISOString();

    const entry = {
        ts:     _state.lastTs,
        type:   _state.lastTask,
        result: _state.lastResult
    };
    _state.taskHistory.push(entry);
    if (_state.taskHistory.length > MAX_HISTORY) _state.taskHistory.shift();

    logManager.debug("Monitor.record", entry);
}

function health() {
    const upMs = Date.now() - new Date(_state.startedAt).getTime();
    return {
        status:       "running",
        started_at:   _state.startedAt,
        uptime_ms:    upMs,
        uptime_min:   (upMs / 60000).toFixed(1),
        executions:   _state.executions,
        failures:     _state.failures,
        success_rate: _state.executions > 0
            ? ((_state.executions - _state.failures) / _state.executions * 100).toFixed(1) + "%"
            : "N/A",
        last_task:    _state.lastTask,
        last_result:  _state.lastResult,
        last_ts:      _state.lastTs
    };
}

function recentHistory(limit = 20) {
    return _state.taskHistory.slice(-limit);
}

module.exports = { record, health, recentHistory };
