"use strict";
/**
 * Structured HTTP request logger middleware.
 * Extracted from server.js. Skips OPTIONS and high-frequency polling paths.
 * Logs: method path status ms ip
 */

const logger = require("../utils/logger");

const _SKIP = new Set(["/health", "/test", "/metrics", "/"]);

module.exports = function requestLogger(req, res, next) {
    if (req.method === "OPTIONS" || _SKIP.has(req.path)) return next();
    const t0 = Date.now();
    res.on("finish", () => {
        const ms  = Date.now() - t0;
        const ip  = req.ip || req.socket?.remoteAddress || "-";
        const rid = req.id || "-";
        const msg = `${req.method} ${req.path} ${res.statusCode} ${ms}ms ${ip} [${rid}]`;
        if      (res.statusCode >= 500) logger.error(`[HTTP] ${msg}`);
        else if (res.statusCode >= 400) logger.warn(`[HTTP] ${msg}`);
        else                            logger.info(`[HTTP] ${msg}`);
    });
    next();
};
