/**
 * SaaS Billing Engine — plan management and subscription lifecycle.
 * Integrates with existing payment infrastructure.
 */

const { load, flush, loadGlobal, flushGlobal, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");
const { PLANS } = require("./multiTenantManager.cjs");

const BILLING_STORE = "billing";

function getSubscription(tenantId) {
    const tenants = loadGlobal("tenants", {});
    const tenant  = tenants[tenantId];
    if (!tenant) return null;

    const billing = load(tenantId, BILLING_STORE, {});
    return {
        tenantId,
        plan:         tenant.plan,
        status:       billing.status      || "active",
        nextBilling:  billing.nextBilling || null,
        amount:       PLANS[tenant.plan]?.price || "₹0/mo",
        limits:       PLANS[tenant.plan]         || PLANS.free,
        paymentMethod: billing.paymentMethod    || null,
        invoices:     (billing.invoices || []).slice(-12)
    };
}

function changePlan({ tenantId, userId, newPlan, paymentMethodId }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("saasBillingEngine", auth.error);
    if (!PLANS[newPlan]) return fail("saasBillingEngine", `Plan "${newPlan}" does not exist`);

    const billing       = load(tenantId, BILLING_STORE, {});
    const tenants       = loadGlobal("tenants", {});
    const oldPlan       = tenants[tenantId]?.plan || "free";

    billing.status        = "active";
    billing.paymentMethod = paymentMethodId || billing.paymentMethod;
    billing.nextBilling   = new Date(Date.now() + 30 * 86_400_000).toISOString();

    // Generate invoice record
    if (!billing.invoices) billing.invoices = [];
    billing.invoices.push({
        id:          uid("inv"),
        planFrom:    oldPlan,
        planTo:      newPlan,
        amount:      PLANS[newPlan].price,
        status:      newPlan === "free" ? "N/A" : "pending",
        createdAt:   NOW()
    });

    flush(tenantId, BILLING_STORE, billing);

    // Update tenant plan
    tenants[tenantId].plan   = newPlan;
    tenants[tenantId].limits = PLANS[newPlan];
    flushGlobal("tenants", tenants);

    auditLog(tenantId, userId, "billing_changed", { oldPlan, newPlan });
    return { tenantId, plan: newPlan, limits: PLANS[newPlan], nextBilling: billing.nextBilling };
}

function addPaymentMethod({ tenantId, userId, type, last4, expiryMonth, expiryYear }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("saasBillingEngine", auth.error);

    const billing = load(tenantId, BILLING_STORE, {});
    billing.paymentMethod = { type, last4, expiryMonth, expiryYear, addedAt: NOW() };
    flush(tenantId, BILLING_STORE, billing);
    auditLog(tenantId, userId, "payment_method_added", { type, last4 });
    return { added: true, paymentMethod: billing.paymentMethod };
}

function getBillingHistory(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("saasBillingEngine", auth.error);

    const billing = load(tenantId, BILLING_STORE, {});
    return {
        tenantId,
        invoices: (billing.invoices || []).reverse(),
        status:   billing.status || "active"
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "change_plan")        data = changePlan(p);
        else if (task.type === "add_payment")   data = addPaymentMethod(p);
        else if (task.type === "billing_history") data = getBillingHistory(p.tenantId, p.userId);
        else                                    data = getSubscription(p.tenantId) || fail("saasBillingEngine", "Tenant not found");
        if (data?.code === 403) return data;
        return ok("saasBillingEngine", data);
    } catch (err) { return fail("saasBillingEngine", err.message); }
}

module.exports = { getSubscription, changePlan, addPaymentMethod, getBillingHistory, PLANS, run };
