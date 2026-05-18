"use strict";

const fs   = require("fs");
const path = require("path");

const LEVELS  = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || "INFO").toUpperCase()] ?? 1;

// Optional file sink — enabled when LOG_FILE env var is set
let _fileStream = null;
(function _initFileSink() {
    const logFile = process.env.LOG_FILE;
    if (!logFile) return;
    try {
        const dir = path.dirname(logFile);
        fs.mkdirSync(dir, { recursive: true });
        _fileStream = fs.createWriteStream(logFile, { flags: "a", encoding: "utf8" });
        _fileStream.on("error", () => { _fileStream = null; });
    } catch { /* non-critical — console only */ }
})();

function _fmt(level, args) {
    const ts  = new Date().toISOString();
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    return `[${ts}] [${level}] ${msg}`;
}

function _write(level, line) {
    if (_fileStream) {
        try { _fileStream.write(line + "\n"); } catch { /* non-critical */ }
    }
}

const logger = {
    debug: (...a) => { if (current <= 0) { const l = _fmt("DEBUG", a); console.debug(l); _write("DEBUG", l); } },
    info:  (...a) => { if (current <= 1) { const l = _fmt("INFO",  a); console.log  (l); _write("INFO",  l); } },
    warn:  (...a) => { if (current <= 2) { const l = _fmt("WARN",  a); console.warn (l); _write("WARN",  l); } },
    error: (...a) => { if (current <= 3) { const l = _fmt("ERROR", a); console.error(l); _write("ERROR", l); } },
};

module.exports = logger;
