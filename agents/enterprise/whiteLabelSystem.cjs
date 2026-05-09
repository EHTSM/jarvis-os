/**
 * White Label System — multi-brand configuration per tenant.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function configure({ tenantId, userId, brandName, domain, logoUrl, primaryColor, secondaryColor, supportEmail, customDomain }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("whiteLabelSystem", auth.error);

    const config = {
        id:            uid("wl"),
        tenantId,
        brandName:     brandName || "Jarvis AI",
        domain:        domain || "",
        customDomain:  customDomain || "",
        logoUrl:       logoUrl || "",
        primaryColor:  primaryColor || "#6366f1",
        secondaryColor:secondaryColor || "#8b5cf6",
        supportEmail:  supportEmail || "",
        poweredBy:     false,
        metaTitle:     `${brandName || "Jarvis AI"} — AI Platform`,
        faviconUrl:    "",
        updatedAt:     NOW()
    };

    flush(tenantId, "white-label", config);
    auditLog(tenantId, userId, "whitelabel_configured", { brandName });
    return ok("whiteLabelSystem", config);
}

function getConfig(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("whiteLabelSystem", auth.error);
    return ok("whiteLabelSystem", load(tenantId, "white-label", { brandName: "Jarvis AI", primaryColor: "#6366f1" }));
}

async function run(task) {
    const p = task.payload || {};
    try {
        return task.type === "get_whitelabel" ? getConfig(p.tenantId, p.userId) : configure(p);
    } catch (err) { return fail("whiteLabelSystem", err.message); }
}

module.exports = { configure, getConfig, run };
