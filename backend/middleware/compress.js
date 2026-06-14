"use strict";
/**
 * Response compression middleware — gzip for JSON responses >= 1 KB.
 * Uses ONLY Node.js built-in zlib (no external dependencies).
 *
 * Skips:
 *   - Clients that don't accept gzip (no Accept-Encoding: gzip)
 *   - HEAD requests
 *   - Responses < 1024 bytes (not worth the CPU overhead)
 *   - Streaming responses (caller should skip this middleware or use res.write directly)
 */

const zlib = require("zlib");

module.exports = function compress(req, res, next) {
    const ae = req.headers["accept-encoding"] || "";
    if (!ae.includes("gzip") || req.method === "HEAD") return next();

    // Monkey-patch res.json to compress large JSON responses
    const origJson = res.json.bind(res);
    res.json = function(body) {
        const str = JSON.stringify(body);
        if (str.length < 1024) return origJson(body); // skip small responses

        zlib.gzip(Buffer.from(str, "utf8"), (err, buf) => {
            if (err) return origJson(body);
            res.setHeader("Content-Encoding", "gzip");
            res.setHeader("Vary", "Accept-Encoding");
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Length", buf.length);
            res.end(buf);
        });
    };

    next();
};
