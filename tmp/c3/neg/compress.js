"use strict";
/**
 * Response compression middleware — gzip for JSON responses >= 1 KB, and for
 * static build assets (JS/CSS/SVG/JSON) served from frontend/build.
 * Uses ONLY Node.js built-in zlib (no external dependencies).
 *
 * Phase C.3 (C3-02): this middleware only ever patched res.json, so it covered
 * API responses and NOTHING served by express.static. Measured live: the SPA's
 * main bundle shipped completely uncompressed —
 *
 *     main.js   1,211 KB uncompressed  ->    329 KB gzipped
 *     main.css    416 KB uncompressed  ->     68 KB gzipped
 *     cold first visit transfer: 1,667 KB
 *
 * while /p27/missions (JSON) correctly compressed 206 KB -> 15 KB. Every first
 * visit therefore paid ~1.2 MB that did not need to be sent.
 *
 * Compressed bytes are cached in-process, keyed on the file's mtime+size, so
 * gzip CPU is paid once per asset per deploy rather than per request. Assets
 * are content-hashed, so this cache cannot serve a stale body for a new build.
 *
 * Skips:
 *   - Clients that don't accept gzip (no Accept-Encoding: gzip)
 *   - HEAD requests
 *   - Responses < 1024 bytes (not worth the CPU overhead)
 *   - Already-compressed formats (images, fonts, archives)
 *   - Streaming responses (caller should skip this middleware or use res.write directly)
 */

const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "../../frontend/build");
// HTML is deliberately EXCLUDED. index.html is re-rendered per request to stamp
// a fresh CSP 'nonce-...' onto every <script> tag (see server.js); serving a
// pre-gzipped copy from disk would ship HTML whose nonce does not match the
// response's CSP header, and the browser would block every script — a blank
// page. Correctness over a few compressed KB.
const COMPRESSIBLE = /\.(js|css|svg|json|map|txt)$/i;
const MIN_BYTES = 1024;

// url -> { stamp, buf, type }. Bounded: one entry per served build asset.
const _assetCache = new Map();

const TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
};

/** Serve a build asset gzipped, or return false to fall through untouched. */
function _tryStaticGzip(req, res) {
    if (req.method !== "GET") return false;
    const urlPath = req.path;
    if (!COMPRESSIBLE.test(urlPath)) return false;

    // Resolve inside the build directory only — never follow traversal out of it.
    const abs = path.join(BUILD_DIR, urlPath);
    const rel = path.relative(BUILD_DIR, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;

    let st;
    try { st = fs.statSync(abs); } catch { return false; }
    if (!st.isFile() || st.size < MIN_BYTES) return false;

    const stamp = `${st.mtimeMs}:${st.size}`;
    let entry = _assetCache.get(urlPath);
    if (!entry || entry.stamp !== stamp) {
        let raw;
        try { raw = fs.readFileSync(abs); } catch { return false; }
        entry = {
            stamp,
            buf: zlib.gzipSync(raw),
            type: TYPES[path.extname(urlPath).toLowerCase()] || "application/octet-stream",
        };
        _assetCache.set(urlPath, entry);
    }

    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", entry.type);
    res.setHeader("Content-Length", entry.buf.length);
    res.end(entry.buf);
    return true;
}

module.exports = function compress(req, res, next) {
    const ae = req.headers["accept-encoding"] || "";
    if (!ae.includes("gzip") || req.method === "HEAD") return next();

    // Static build assets never reach res.json, so they were never compressed.
    if (_tryStaticGzip(req, res)) return;

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
