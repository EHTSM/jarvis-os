"use strict";
/**
 * operatorAudit — appends one NDJSON line per operator request to data/logs/operator-audit.ndjson.
 * Fields: ts, method, path, action, status, ip, requestId, durationMs.
 * Uses fire-and-forget fs.appendFile so it never blocks the response.
 *
 * Supports two call patterns — both work without modification to callers:
 *
 *   1. Direct middleware (existing usage in crm.js, simulation.js, ops.js router.use):
 *        router.use(operatorAudit)
 *        router.post("/path", requireAuth, operatorAudit, handler)
 *
 *   2. Labelled factory (ops.js /runtime/reboot):
 *        router.post("/path", requireAuth, operatorAudit("runtime-reboot"), handler)
 *
 * Pattern detection: if the first argument is a string, return a middleware function.
 * Otherwise behave as a middleware directly.
 */

const fs   = require("fs");
const path = require("path");

const AUDIT_FILE = path.join(__dirname, "../../data/logs/operator-audit.ndjson");

try { fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true }); } catch { /* already exists */ }

function _write(action, req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        try {
            const entry = JSON.stringify({
                ts:         new Date().toISOString(),
                method:     req.method,
                path:       req.path,
                action:     action || null,
                status:     res.statusCode,
                ip:         req.ip || req.socket?.remoteAddress || "-",
                requestId:  req.id || "-",
                durationMs: Date.now() - start,
            });
            fs.appendFile(AUDIT_FILE, entry + "\n", () => {});
        } catch { /* never crash on audit failure */ }
    });
    next();
}

/**
 * operatorAudit(req, res, next)  — direct Express middleware
 * operatorAudit("label")         — returns an Express middleware with an action label
 */
module.exports = function operatorAudit(reqOrLabel, res, next) {
    if (typeof reqOrLabel === "string") {
        // Factory: called as operatorAudit("some-label")
        const label = reqOrLabel;
        return function operatorAuditLabelled(req, res, next) {
            _write(label, req, res, next);
        };
    }
    // Direct middleware: called as operatorAudit(req, res, next) by Express
    _write(null, reqOrLabel, res, next);
};
