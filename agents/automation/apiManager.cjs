/**
 * API Manager — generic REST client for external integrations.
 * Handles retries, timeout, auth injection, and response normalization.
 */

const axios      = require("axios");
const logManager = require("./logManager.cjs");

const DEFAULT_TIMEOUT = 15000; // 15s
const MAX_RETRIES     = 2;

async function _request(config, attempt = 1) {
    try {
        const res = await axios(config);
        return { success: true, status: res.status, data: res.data, headers: res.headers };
    } catch (err) {
        const status = err.response?.status;
        const isRetryable = !status || status >= 500;

        if (isRetryable && attempt <= MAX_RETRIES) {
            const delay = attempt * 1000;
            logManager.warn("API retry", { url: config.url, attempt, delay });
            await new Promise(r => setTimeout(r, delay));
            return _request(config, attempt + 1);
        }

        return {
            success: false,
            status:  status || 0,
            error:   err.message,
            data:    err.response?.data || null
        };
    }
}

async function call({ url, method = "GET", headers = {}, body = null, params = {}, auth = null, timeout = DEFAULT_TIMEOUT }) {
    if (!url) return { success: false, error: "apiManager: url is required" };

    logManager.info("API call", { method: method.toUpperCase(), url });

    const authHeaders = {};
    if (auth?.type === "bearer") authHeaders["Authorization"] = `Bearer ${auth.token}`;
    if (auth?.type === "basic")  authHeaders["Authorization"] = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString("base64")}`;
    if (auth?.type === "apikey") authHeaders[auth.header || "X-API-Key"] = auth.key;

    const config = {
        method:  method.toUpperCase(),
        url,
        timeout,
        headers: { "Content-Type": "application/json", ...authHeaders, ...headers },
        params
    };
    if (body) config.data = body;

    return _request(config);
}

async function get(url, options = {})  { return call({ ...options, url, method: "GET" }); }
async function post(url, body, options = {}) { return call({ ...options, url, method: "POST", body }); }
async function put(url, body, options = {})  { return call({ ...options, url, method: "PUT",  body }); }
async function del(url, options = {})  { return call({ ...options, url, method: "DELETE" }); }

module.exports = { call, get, post, put, del };
