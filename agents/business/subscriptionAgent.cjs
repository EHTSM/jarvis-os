/**
 * Subscription Agent — manages plans and user subscriptions.
 * Persists to data/subscriptions.json.
 */

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/subscriptions.json");

const PLANS = {
    free:    { name: "Free",    price: 0,    features: ["Basic AI chat", "5 commands/day"],           durationDays: null  },
    pro:     { name: "Pro",     price: 999,  features: ["Unlimited chat", "All agents", "WhatsApp"],  durationDays: 30    },
    premium: { name: "Premium", price: 2999, features: ["Everything in Pro", "Priority support", "Custom agents", "Analytics"], durationDays: 30 }
};

function _read() {
    try {
        if (!fs.existsSync(FILE)) return [];
        return JSON.parse(fs.readFileSync(FILE, "utf8")) || [];
    } catch { return []; }
}

function _write(data) {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function _expiry(durationDays) {
    if (!durationDays) return null;
    const d = new Date();
    d.setDate(d.getDate() + durationDays);
    return d.toISOString();
}

function assign(userId, plan) {
    if (!PLANS[plan]) return { success: false, error: `Unknown plan: ${plan}` };
    const subs = _read();
    const now  = new Date().toISOString();

    const existing = subs.findIndex(s => s.userId === userId);
    const record   = {
        userId,
        plan,
        planDetails: PLANS[plan],
        startDate:   now,
        endDate:     _expiry(PLANS[plan].durationDays),
        active:      true,
        amount:      PLANS[plan].price,
        updatedAt:   now
    };

    if (existing >= 0) subs[existing] = record;
    else               subs.push(record);

    _write(subs);
    return { success: true, ...record };
}

function getSubscription(userId) {
    const subs = _read();
    const sub  = subs.find(s => s.userId === userId);
    if (!sub) return { active: false, plan: "free", ...PLANS.free };

    // Check expiry
    if (sub.endDate && new Date(sub.endDate) < new Date()) {
        sub.active = false;
        _write(subs);
    }
    return sub;
}

function isActive(userId) {
    const sub = getSubscription(userId);
    return sub.active !== false;
}

function listAll() {
    return _read();
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "subscribe":
        case "assign_plan":
            return { success: true, type: "subscriptionAgent", data: assign(p.userId || p.phone, p.plan || "pro") };

        case "check_subscription":
        case "get_subscription":
            return { success: true, type: "subscriptionAgent", data: getSubscription(p.userId || p.phone) };

        case "list_plans":
            return { success: true, type: "subscriptionAgent", data: { plans: PLANS } };

        case "list_subscriptions":
            return { success: true, type: "subscriptionAgent", data: { subscriptions: listAll() } };

        default:
            return { success: false, type: "subscriptionAgent", data: { error: `Unknown: ${task.type}` } };
    }
}

module.exports = { run, assign, getSubscription, isActive, listAll, PLANS };
