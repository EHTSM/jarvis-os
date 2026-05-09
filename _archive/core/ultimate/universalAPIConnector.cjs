"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "universalAPIConnector";

const API_CATEGORIES    = ["weather","finance","maps","social","news","health","government","space","energy","commerce"];
const HTTP_METHODS      = ["GET","POST","PUT","PATCH","DELETE"];
const SAFE_METHODS      = new Set(["GET"]);  // Only GET is auto-approved; others require explicit approval
const AUTH_TYPES        = ["none","api_key","oauth2","jwt","basic","bearer"];

// ── Register an API connection config ────────────────────────────
function registerAPI({ apiId, name, baseUrl, category, authType = "api_key", rateLimit = 100 }) {
    if (!apiId || !name || !baseUrl) return fail(AGENT, "apiId, name, and baseUrl are required");
    if (!API_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${API_CATEGORIES.join(", ")}`);
    if (!AUTH_TYPES.includes(authType)) return fail(AGENT, `authType must be: ${AUTH_TYPES.join(", ")}`);

    const registry = load("api_registry", {});
    registry[apiId] = { apiId, name, baseUrl, category, authType, rateLimit, registeredAt: NOW(), status: "registered" };
    flush("api_registry", registry);

    ultimateLog(AGENT, "api_registered", { apiId, name, category }, "INFO");
    return ok(AGENT, { apiId, name, baseUrl, category, authType, rateLimit, registeredAt: NOW() });
}

// ── Execute an API call (simulated — real HTTP via integration) ───
function callAPI({ apiId, endpoint, method = "GET", params = {}, body = {}, approved = false }) {
    if (!apiId || !endpoint) return fail(AGENT, "apiId and endpoint are required");
    if (!HTTP_METHODS.includes(method)) return fail(AGENT, `method must be: ${HTTP_METHODS.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const registry = load("api_registry", {});
    if (!registry[apiId]) return fail(AGENT, `API '${apiId}' not registered. Call registerAPI first.`);

    // Write methods require explicit approval
    if (!SAFE_METHODS.has(method) && approved !== true) {
        return blocked(AGENT, `API write operations (${method}) require approved:true. Ensure human has authorised this external write.`);
    }

    // Rate limit check
    const callLog = load(`api_calls_${apiId}`, []);
    const recentCalls = callLog.filter(c => Date.now() - new Date(c.calledAt).getTime() < 60000);
    if (recentCalls.length >= (registry[apiId].rateLimit || 100)) {
        return blocked(AGENT, `Rate limit reached for API '${apiId}' (${registry[apiId].rateLimit} calls/min)`);
    }

    const call = {
        callId:       uid("api"),
        apiId,
        endpoint,
        method,
        params,
        status:       Math.random() > 0.05 ? "success" : "error",
        statusCode:   Math.random() > 0.05 ? 200 : [400,404,429,500][Math.floor(Math.random()*4)],
        responseTime_ms: Math.round(50 + Math.random() * 500),
        calledAt:     NOW(),
        note:         "Simulated API call — wire real HTTP client for production"
    };

    callLog.push({ callId: call.callId, endpoint, method, status: call.status, calledAt: call.calledAt });
    flush(`api_calls_${apiId}`, callLog.slice(-500));

    ultimateLog(AGENT, call.status === "success" ? "api_call_success" : "API_CALL_FAILED",
        { apiId, endpoint, method, statusCode: call.statusCode }, call.status === "error" ? "WARN" : "INFO");

    return call.status === "success"
        ? ok(AGENT, call)
        : fail(AGENT, `API call failed: status ${call.statusCode}`);
}

// ── List registered APIs ─────────────────────────────────────────
function listAPIs({ category } = {}) {
    const registry = load("api_registry", {});
    const apis = Object.values(registry).filter(a => !category || a.category === category);
    return ok(AGENT, { total: apis.length, apis, categories: API_CATEGORIES, authTypes: AUTH_TYPES });
}

// ── Get API call history ─────────────────────────────────────────
function getCallHistory({ apiId, limit = 20 }) {
    if (!apiId) return fail(AGENT, "apiId required");
    const log = load(`api_calls_${apiId}`, []);
    return ok(AGENT, { apiId, total: log.length, recent: log.slice(-limit) });
}

module.exports = { registerAPI, callAPI, listAPIs, getCallHistory, API_CATEGORIES };
