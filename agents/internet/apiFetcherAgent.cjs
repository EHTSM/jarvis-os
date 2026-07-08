/**
 * API Fetcher Agent — generic HTTP API client.
 * Supports GET/POST with auth headers, timeout, and rate limiting.
 */

const axios       = require("axios");
const rateLimiter = require("./_rateLimiter.cjs");

const TIMEOUT_MS  = 10_000;
const MAX_RETRIES = 1;

async function _request(method, url, { params, body, headers, auth } = {}) {
    const reqHeaders = { "Content-Type": "application/json", ...headers };

    if (auth?.type === "bearer") reqHeaders["Authorization"] = `Bearer ${auth.token}`;
    if (auth?.type === "apikey") reqHeaders[auth.headerName || "X-Api-Key"] = auth.key;
    if (auth?.type === "basic")  reqHeaders["Authorization"] = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString("base64")}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await rateLimiter.gate(url, () =>
                axios({ method, url, params, data: body, headers: reqHeaders, timeout: TIMEOUT_MS })
            );
            return { status: res.status, data: res.data, headers: res.headers };
        } catch (err) {
            if (err.rateLimited) throw err;
            if (attempt === MAX_RETRIES) throw err;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

const get  = (url, opts) => _request("get",  url, opts);
const post = (url, opts) => _request("post", url, opts);
const put  = (url, opts) => _request("put",  url, opts);
const del  = (url, opts) => _request("delete", url, opts);

async function run(task) {
    const p      = task.payload || {};
    const url    = p.url || task.input || "";
    const method = (p.method || "get").toLowerCase();
    const opts   = { params: p.params, body: p.body, headers: p.headers, auth: p.auth };

    if (!url) return { success: false, source: "internet", type: "apiFetcherAgent", data: { error: "url required" } };

    try {
        const result = await _request(method, url, opts);
        return { success: true, source: "internet", type: "apiFetcherAgent", data: result };
    } catch (err) {
        return { success: false, source: "internet", type: "apiFetcherAgent", data: { error: err.message, status: err.response?.status } };
    }
}

module.exports = { get, post, put, del, run };
