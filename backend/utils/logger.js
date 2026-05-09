"use strict";

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || "INFO").toUpperCase()] ?? 1;

function _fmt(level, args) {
    const ts  = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    return `[${ts}] [${level}] ${msg}`;
}

const logger = {
    debug: (...a) => { if (current <= 0) console.debug(_fmt("DEBUG", a)); },
    info:  (...a) => { if (current <= 1) console.log  (_fmt("INFO",  a)); },
    warn:  (...a) => { if (current <= 2) console.warn (_fmt("WARN",  a)); },
    error: (...a) => { if (current <= 3) console.error(_fmt("ERROR", a)); }
};

module.exports = logger;
