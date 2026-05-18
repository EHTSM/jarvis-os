/**
 * Log Manager — structured logging for the automation layer.
 * Console output now; swap the _sink function to add DB/file logging later.
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
// Default to WARN so INFO-level automation chatter stays quiet in production.
// Set LOG_LEVEL=info or DEBUG_PIPELINE=true to restore verbose output.
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ??
    (process.env.DEBUG_PIPELINE === "true" ? LEVELS.DEBUG : LEVELS.WARN);

const _history = []; // in-memory ring buffer (last 500 entries)
const MAX_HISTORY = 500;

function _sink(entry) {
    // Store structured; output human-readable to console
    _history.push(entry);
    if (_history.length > MAX_HISTORY) _history.shift();

    const { ts, level, msg, ...rest } = entry;
    const time  = ts.slice(11, 19); // HH:MM:SS
    const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
    const line  = `[${time}] [${level.padEnd(5)}] [Automation] ${msg}${extra}`;

    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
}

function log(level, message, data = {}) {
    if ((LEVELS[level] ?? 0) < MIN_LEVEL) return null;
    const entry = {
        ts:    new Date().toISOString(),
        level,
        msg:   message,
        ...data
    };
    _sink(entry);
    return entry;
}

function info(msg, data)  { return log("INFO",  msg, data); }
function warn(msg, data)  { return log("WARN",  msg, data); }
function error(msg, data) { return log("ERROR", msg, data); }
function debug(msg, data) { return log("DEBUG", msg, data); }

function getHistory(limit = 50) {
    return _history.slice(-limit);
}

module.exports = { log, info, warn, error, debug, getHistory };
