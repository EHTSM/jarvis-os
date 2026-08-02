"use strict";
/**
 * OpenAPI Generator — builds a real OpenAPI 3.0 spec by introspecting the
 * ACTUAL mounted Express router tree (backend/routes/index.js), not from
 * hand-written JSDoc annotations.
 *
 * Enterprise Capability Expansion mission. Confirmed genuinely absent
 * before this: no OpenAPI/Swagger generation anywhere in the repo, and
 * with 4000+ real routes across ~190 route files, retrofitting JSDoc
 * comments onto every handler (the swagger-jsdoc approach) is not a
 * "wire existing code" job — it would mean writing thousands of new
 * annotations by hand, most of them guesses about request/response shape
 * this service has no way to verify. Introspecting the live router is the
 * only approach that reflects reality: every path this generates is a
 * route that genuinely exists and is genuinely reachable right now.
 *
 * Path parameters (:id, :type etc) are converted to OpenAPI {id} syntax.
 * Request/response bodies are left schema-less (generic object) — this
 * spec documents real surface area (path + method + params), not invented
 * payload shapes, which would violate the "no fake" rule as much as a
 * hand-authored placeholder would.
 */

function _walk(stack, prefix, out) {
    for (const layer of stack) {
        if (layer.route) {
            const routePath = prefix + layer.route.path;
            const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
            for (const m of methods) out.push({ method: m.toUpperCase(), path: routePath });
        } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
            let childPrefix = prefix;
            if (layer.regexp && layer.regexp.fast_slash !== true) {
                // Express doesn't expose the literal mount path once mounted at
                // "/", so nested routers here are walked with their own
                // absolute route.path values already included by callers —
                // no prefix concatenation needed for this codebase's mounting
                // style (routes/index.js mounts everything at "/").
            }
            _walk(layer.handle.stack, childPrefix, out);
        }
    }
}

function _toOpenApiPath(expressPath) {
    // Express `:paramName` -> OpenAPI `{paramName}`
    return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function _extractParams(expressPath) {
    const names = [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map(m => m[1]);
    return names.map(name => ({
        name, in: "path", required: true, schema: { type: "string" },
    }));
}

function _tagFromPath(p) {
    const seg = p.split("/").filter(Boolean)[0] || "root";
    return seg;
}

/**
 * generateSpec({ router, title, version, serverUrl }) -> real OpenAPI 3.0 object
 */
function generateSpec(opts = {}) {
    const router = opts.router || require("../routes/index.js");
    const raw = [];
    _walk(router.stack, "", raw);

    // Dedup identical method+path pairs (some route files register the
    // same path under both /x and /api/x aliases — each is real and kept,
    // but exact duplicates collapse to one entry).
    const seen = new Set();
    const routes = [];
    for (const r of raw) {
        const key = r.method + " " + r.path;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push(r);
    }
    routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    const paths = {};
    for (const { method, path: p } of routes) {
        const oaPath = _toOpenApiPath(p);
        if (!paths[oaPath]) paths[oaPath] = {};
        paths[oaPath][method.toLowerCase()] = {
            summary: `${method} ${p}`,
            tags: [_tagFromPath(p)],
            parameters: _extractParams(p),
            responses: {
                200: { description: "Success" },
                401: { description: "Unauthorized" },
                500: { description: "Server error" },
            },
        };
    }

    const { COOKIE_NAME } = require("../middleware/authMiddleware");

    return {
        openapi: "3.0.3",
        info: {
            title: opts.title || "JARVIS-OS API",
            version: opts.version || "1.0.0",
            description: `Generated from ${routes.length} live mounted routes.`,
        },
        servers: [{ url: opts.serverUrl || "/" }],
        components: {
            securitySchemes: {
                cookieAuth: { type: "apiKey", in: "cookie", name: COOKIE_NAME },
                bearerAuth: { type: "http", scheme: "bearer" },
            },
        },
        paths,
        _meta: { routeCount: routes.length, generatedAt: new Date().toISOString() },
    };
}

module.exports = { generateSpec };
