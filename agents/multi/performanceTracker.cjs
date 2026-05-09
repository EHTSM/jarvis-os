/**
 * Performance Tracker — logs timing and success/failure rate per agent.
 * Standalone module — no imports from the agent graph.
 */

const _records = []; // ring buffer — last 1000 executions
const MAX      = 1000;

const _stats = new Map(); // agentName → { calls, failures, totalMs }

function start(agentName, taskType) {
    return { agentName, taskType, startMs: Date.now() };
}

function finish(ctx, success) {
    const elapsed = Date.now() - ctx.startMs;
    const name    = ctx.agentName;

    if (!_stats.has(name)) _stats.set(name, { calls: 0, failures: 0, totalMs: 0 });
    const s = _stats.get(name);
    s.calls++;
    s.totalMs += elapsed;
    if (!success) s.failures++;

    const record = {
        ts:        new Date().toISOString(),
        agent:     name,
        taskType:  ctx.taskType,
        elapsedMs: elapsed,
        success
    };
    _records.push(record);
    if (_records.length > MAX) _records.shift();

    return record;
}

function statsFor(agentName) {
    const s = _stats.get(agentName);
    if (!s) return null;
    return {
        agent:        agentName,
        calls:        s.calls,
        failures:     s.failures,
        successRate:  s.calls ? (((s.calls - s.failures) / s.calls) * 100).toFixed(1) + "%" : "N/A",
        avgMs:        s.calls ? (s.totalMs / s.calls).toFixed(0) : "N/A"
    };
}

function summary() {
    return [..._stats.keys()].map(statsFor);
}

function recent(limit = 20) {
    return _records.slice(-limit);
}

module.exports = { start, finish, statsFor, summary, recent };
