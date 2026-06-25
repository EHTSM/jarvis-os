"use strict";
/**
 * operatorAudit — appends one NDJSON line per operator request to data/logs/operator-audit.ndjson.
 * Fields: ts, method, path, status, ip, requestId, durationMs.
 * Uses fire-and-forget fs.appendFile so it never blocks the response.
 */

const fs   = require("fs");
const path = require("path");

const AUDIT_FILE = path.join(__dirname, "../../data/logs/operator-audit.ndjson");

// Ensure the logs dir exists at module load time (best-effort, never throws).
try { fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true }); } catch { /* already exists */ }

// _middleware is the real Express handler — action label is optional metadata.
function _middleware(action, req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        const entry = JSON.stringify({
            ts:         new Date().toISOString(),
            method:     req.method,
            path:       req.path,
            action:     action || null,
            status:     res.statusCode,
            ip:         req.ip || req.connection?.remoteAddress || "-",
            requestId:  req.id || "-",
            durationMs: Date.now() - start,
        });
        fs.appendFile(AUDIT_FILE, entry + "\n", () => {});  // fire-and-forget
    });
    next();
}

// Supports both usage patterns:
//   operatorAudit              — direct middleware (req, res, next)
//   operatorAudit("label")     — factory returning middleware, with action label
function operatorAudit(reqOrAction, res, next) {
    if (typeof reqOrAction === "string") {
        // Factory call: operatorAudit("runtime-reboot") → returns middleware
        const action = reqOrAction;
        return function operatorAuditLabelled(req, res, next) {
            _middleware(action, req, res, next);
        };
    }
    // Direct middleware call: operatorAudit(req, res, next)
    _middleware(null, reqOrAction, res, next);
}

module.exports = operatorAudit;
