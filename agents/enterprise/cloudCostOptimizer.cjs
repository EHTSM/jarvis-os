/**
 * Cloud Cost Optimizer — estimates and optimizes infrastructure costs per tenant.
 */

const { requireAuth, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const COST_MODELS = {
    free:       { compute: 0,     storage: 0,     bandwidth: 0,     support: 0     },
    starter:    { compute: 500,   storage: 200,   bandwidth: 100,   support: 200   },
    pro:        { compute: 2000,  storage: 800,   bandwidth: 400,   support: 800   },
    enterprise: { compute: 8000,  storage: 3000,  bandwidth: 1500,  support: 5000  }
};

function analyze({ tenantId, userId, plan = "pro", activeUsers = 50, storageGB = 10, apicallsPerMonth = 10000 }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("cloudCostOptimizer", auth.error);

    const base    = COST_MODELS[plan] || COST_MODELS.pro;
    const perUser = Math.round((base.compute / 100) * activeUsers / 10);
    const perGB   = Math.round((base.storage / 50) * storageGB / 10);

    const totalMonthly = base.compute + perUser + perGB + base.bandwidth + base.support;
    const totalAnnual  = totalMonthly * 12;

    const savings = [];
    if (activeUsers < 20) savings.push({ action: "Downgrade to Starter plan", monthlySaving: `₹${base.compute - COST_MODELS.starter.compute}` });
    if (storageGB < 5)    savings.push({ action: "Reduce storage allocation", monthlySaving: "₹200-400" });
    savings.push({ action: "Annual billing discount", monthlySaving: `₹${Math.round(totalMonthly * 0.15)} (15% off)` });

    return ok("cloudCostOptimizer", {
        tenantId, plan, activeUsers, storageGB,
        breakdown:    { ...base, perUserExtra: perUser, storageExtra: perGB },
        totalMonthly, totalAnnual,
        currency:     "INR",
        optimizations: savings,
        analyzedAt:   NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        return analyze(p);
    } catch (err) { return fail("cloudCostOptimizer", err.message); }
}

module.exports = { analyze, COST_MODELS, run };
