/**
 * System Health — OS-level metrics via Node's built-in `os` module.
 * No external dependencies required.
 */

const os = require("os");

function _cpuPercent() {
    const cpus  = os.cpus();
    let idleMs  = 0;
    let totalMs = 0;
    for (const cpu of cpus) {
        for (const [type, ms] of Object.entries(cpu.times)) {
            totalMs += ms;
            if (type === "idle") idleMs += ms;
        }
    }
    return totalMs === 0 ? 0 : (((totalMs - idleMs) / totalMs) * 100).toFixed(1);
}

function memory() {
    const total = os.totalmem();
    const free  = os.freemem();
    const used  = total - free;
    return {
        total_gb:  (total / 1e9).toFixed(2),
        used_gb:   (used  / 1e9).toFixed(2),
        free_gb:   (free  / 1e9).toFixed(2),
        used_pct:  ((used / total) * 100).toFixed(1) + "%"
    };
}

function health() {
    return {
        hostname:      os.hostname(),
        platform:      os.platform(),
        arch:          os.arch(),
        node_version:  process.version,
        pid:           process.pid,
        uptime_s:      Math.floor(os.uptime()),
        uptime_min:    (os.uptime() / 60).toFixed(1),
        cpu_count:     os.cpus().length,
        cpu_model:     os.cpus()[0]?.model || "Unknown",
        cpu_usage_pct: _cpuPercent() + "%",
        load_avg:      os.loadavg().map(l => l.toFixed(2)),
        memory:        memory(),
        ts:            new Date().toISOString()
    };
}

function isHealthy() {
    const mem = memory();
    const usedPct = parseFloat(mem.used_pct);
    return { healthy: usedPct < 90, memory_used_pct: usedPct, ts: new Date().toISOString() };
}

module.exports = { health, memory, isHealthy };
