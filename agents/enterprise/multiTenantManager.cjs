/**
 * Multi-Tenant Manager — tenant lifecycle and strict data isolation.
 * Every agent routes through this for tenant validation.
 */

const { loadGlobal, flushGlobal, uid, NOW, setMember, auditLog, ok, fail } = require("./_enterpriseStore.cjs");

const PLANS = {
    free:       { maxUsers: 5,    maxStorage: "1GB",  maxApiCalls: 1000,  price: "₹0/mo"      },
    starter:    { maxUsers: 25,   maxStorage: "10GB", maxApiCalls: 10000, price: "₹999/mo"    },
    pro:        { maxUsers: 100,  maxStorage: "50GB", maxApiCalls: 50000, price: "₹4999/mo"   },
    enterprise: { maxUsers: -1,   maxStorage: "∞",    maxApiCalls: -1,    price: "Custom"     }
};

function createTenant({ name, ownerUserId, ownerEmail, plan = "free", domain = "" }) {
    if (!name || !ownerUserId || !ownerEmail) throw new Error("name, ownerUserId, ownerEmail required");

    const tenants  = loadGlobal("tenants", {});
    const tenantId = uid("tenant");

    if (Object.values(tenants).some(t => t.domain && t.domain === domain && domain)) {
        throw new Error(`Domain "${domain}" already registered`);
    }

    const tenant = {
        id:        tenantId,
        name,
        ownerUserId,
        ownerEmail,
        plan,
        domain:    domain || "",
        status:    "active",
        limits:    PLANS[plan] || PLANS.free,
        createdAt: NOW(),
        updatedAt: NOW()
    };

    tenants[tenantId] = tenant;
    flushGlobal("tenants", tenants);

    // Auto-assign owner as superadmin
    setMember(tenantId, ownerUserId, "superadmin", { email: ownerEmail, name: ownerUserId });
    auditLog(tenantId, ownerUserId, "tenant_created", { name, plan });

    return tenant;
}

function getTenant(tenantId) {
    const tenants = loadGlobal("tenants", {});
    return tenants[tenantId] || null;
}

function listTenants() {
    const tenants = loadGlobal("tenants", {});
    return Object.values(tenants);
}

function updatePlan(tenantId, newPlan, updatedBy) {
    const tenants = loadGlobal("tenants", {});
    if (!tenants[tenantId]) throw new Error("Tenant not found");
    if (!PLANS[newPlan])    throw new Error(`Plan "${newPlan}" not found`);

    tenants[tenantId].plan      = newPlan;
    tenants[tenantId].limits    = PLANS[newPlan];
    tenants[tenantId].updatedAt = NOW();
    flushGlobal("tenants", tenants);
    auditLog(tenantId, updatedBy, "plan_changed", { newPlan });
    return tenants[tenantId];
}

function suspendTenant(tenantId, reason, updatedBy) {
    const tenants = loadGlobal("tenants", {});
    if (!tenants[tenantId]) throw new Error("Tenant not found");
    tenants[tenantId].status    = "suspended";
    tenants[tenantId].suspendReason = reason;
    tenants[tenantId].updatedAt = NOW();
    flushGlobal("tenants", tenants);
    auditLog(tenantId, updatedBy, "tenant_suspended", { reason });
    return { suspended: true, tenantId };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "create_tenant") {
            data = createTenant(p);
        } else if (task.type === "get_tenant") {
            data = getTenant(p.tenantId) || { error: "not_found" };
        } else if (task.type === "update_plan") {
            data = updatePlan(p.tenantId, p.plan, p.userId);
        } else if (task.type === "suspend_tenant") {
            data = suspendTenant(p.tenantId, p.reason || "policy violation", p.userId);
        } else {
            data = listTenants();
        }
        return ok("multiTenantManager", data);
    } catch (err) { return fail("multiTenantManager", err.message); }
}

module.exports = { createTenant, getTenant, listTenants, updatePlan, suspendTenant, PLANS, run };
