/**
 * API Gateway Pro — central entry point for all enterprise API requests.
 * Handles auth, rate limiting, metering, and routing.
 */

const { requireAuth, auditLog, meter, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");
const rateLimiter = require("./rateLimiter.cjs");

const ROUTES = {
    "org.*":        "organizationManager",
    "role.*":       "roleManager",
    "billing.*":    "saasBillingEngine",
    "usage.*":      "usageMeteringAgent",
    "hr.*":         "hrManagementAgent",
    "chat.*":       "chatSystemAgent",
    "files.*":      "fileSharingAgent",
    "docs.*":       "documentCollaborationAgent",
    "ticket.*":     "ticketRoutingAgent",
    "kpi.*":        "kpiTracker",
    "okr.*":        "okrManager",
    "audit.*":      "auditLoggerPro",
    "analytics.*":  "companyAnalyticsAgent"
};

function _matchRoute(path = "") {
    for (const [pattern, handler] of Object.entries(ROUTES)) {
        const prefix = pattern.replace(".*", "");
        if (path.startsWith(prefix)) return handler;
    }
    return null;
}

async function request({ tenantId, userId, path, method = "GET", body = {}, ip = "" }) {
    const requestId = uid("req");
    const startedAt = Date.now();

    // 1. Auth check
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) {
        auditLog(tenantId, userId, "permission_denied", { path, method });
        return forbidden("apiGatewayPro", auth.error);
    }

    // 2. Rate limit check
    const rateCheck = rateLimiter.check({ tenantId, userId, feature: path });
    if (!rateCheck.allowed) {
        auditLog(tenantId, userId, "rate_limited", { path, method });
        return {
            ...fail("apiGatewayPro", `Rate limit exceeded. Retry after ${rateCheck.retryAfterSec}s`, 429),
            headers: rateCheck.headers
        };
    }

    // 3. Route resolution
    const handler = _matchRoute(path);

    // 4. Meter usage
    meter(tenantId, userId, "api_call", 1);

    // 5. Audit
    auditLog(tenantId, userId, "api_request", { path, method, requestId });

    const durationMs = Date.now() - startedAt;

    return ok("apiGatewayPro", {
        requestId,
        tenantId,
        path,
        method,
        handler:     handler || "direct",
        status:      200,
        durationMs,
        rateHeaders: rateCheck.headers,
        timestamp:   NOW()
    });
}

function getApiKeys(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("apiGatewayPro", auth.error);

    const { load } = require("./_enterpriseStore.cjs");
    return { tenantId, apiKeys: load(tenantId, "api-keys", []) };
}

function createApiKey({ tenantId, userId, name, scopes = ["read"] }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("apiGatewayPro", auth.error);

    const { load, flush } = require("./_enterpriseStore.cjs");
    const keys = load(tenantId, "api-keys", []);

    const key = {
        id:        uid("ak"),
        name,
        key:       `jv_${uid("key")}`,
        scopes,
        createdBy: userId,
        active:    true,
        createdAt: NOW()
    };
    keys.push(key);
    flush(tenantId, "api-keys", keys);
    auditLog(tenantId, userId, "api_key_created", { name, scopes });
    return key;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "api_request")    data = await request(p);
        else if (task.type === "create_api_key") data = createApiKey(p);
        else                                data = getApiKeys(p.tenantId, p.userId);
        if (data?.code === 403) return data;
        return ok("apiGatewayPro", data);
    } catch (err) { return fail("apiGatewayPro", err.message); }
}

module.exports = { request, createApiKey, getApiKeys, ROUTES, run };
