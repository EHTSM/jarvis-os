"use strict";
/**
 * Request ID middleware — assigns a unique ID to every incoming request.
 * IDs are propagated through logs via req.id and the x-request-id response header.
 * Callers may supply their own ID via x-request-id header (useful for client retries).
 */

const { randomBytes } = require("crypto");

module.exports = function requestId(req, res, next) {
    const supplied = req.headers["x-request-id"];
    // Accept supplied ID only if it looks safe (alphanumeric + hyphens, ≤ 64 chars)
    req.id = (supplied && /^[a-zA-Z0-9_-]{1,64}$/.test(supplied))
        ? supplied
        : randomBytes(8).toString("hex");
    res.setHeader("x-request-id", req.id);
    next();
};
