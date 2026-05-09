const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function log(level, message, data = {}) {
    if (LEVELS[level] < MIN_LEVEL) return;
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...data
    };
    const out = level === "ERROR" ? console.error : console.log;
    out(JSON.stringify(entry));
}

module.exports = {
    info:  (msg, data) => log("INFO",  msg, data),
    warn:  (msg, data) => log("WARN",  msg, data),
    error: (msg, data) => log("ERROR", msg, data),
    debug: (msg, data) => log("DEBUG", msg, data)
};
