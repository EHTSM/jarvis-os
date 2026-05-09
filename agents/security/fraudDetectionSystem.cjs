"use strict";
const { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked, alert_ } = require("./_securityStore.cjs");
const AGENT = "fraudDetectionSystem";

const FRAUD_RULES = [
    { id:"F001", name:"Velocity Check",     description:"Multiple transactions in short time",    threshold:5,  window:300000 },
    { id:"F002", name:"Large Amount",       description:"Transaction exceeds usual amount",       threshold:100000, unit:"INR" },
    { id:"F003", name:"New Device",         description:"First time from this device",            weight:1 },
    { id:"F004", name:"Unusual Time",       description:"Transaction at unusual hours (1-5am)",   weight:2 },
    { id:"F005", name:"Geo Mismatch",       description:"Transaction location differs from usual",weight:3 },
    { id:"F006", name:"Round Amount",       description:"Suspicious round amounts (common in fraud)", weight:1 },
    { id:"F007", name:"Known Fraud Merchant", description:"Merchant flagged in fraud database",  weight:4 }
];

const KNOWN_FRAUD_MERCHANTS = new Set(["quickrichscheme","cryptodoubler","lotterywin2024"]);

function analyzeTransaction({ userId, transactionId, amount, currency = "INR", merchantId, merchantName, deviceId, geoLocation, timestamp, category }) {
    if (!userId || !amount) return fail(AGENT, "userId and amount required");

    const history   = load(userId, "transaction_history", []);
    const now       = timestamp ? new Date(timestamp).getTime() : Date.now();
    const indicators = [];
    const flags      = [];

    // Velocity check
    const recentTxns = history.filter(t => now - new Date(t.ts).getTime() < FRAUD_RULES[0].window);
    if (recentTxns.length >= FRAUD_RULES[0].threshold) {
        flags.push(FRAUD_RULES[0]);
        indicators.push("bruteForce");
    }

    // Large amount
    const avgAmount = history.length ? history.reduce((s, t) => s + t.amount, 0) / history.length : amount;
    if (amount > avgAmount * 5 || amount > FRAUD_RULES[1].threshold) {
        flags.push(FRAUD_RULES[1]);
        indicators.push("highValueTransaction");
    }

    // New device
    if (deviceId && !history.some(t => t.deviceId === deviceId)) {
        flags.push(FRAUD_RULES[2]);
        indicators.push("newDevice");
    }

    // Unusual time
    const hour = new Date(now).getHours();
    if (hour >= 1 && hour <= 5) { flags.push(FRAUD_RULES[3]); indicators.push("oddHours"); }

    // Known fraud merchant
    if (merchantId && KNOWN_FRAUD_MERCHANTS.has(merchantId.toLowerCase())) {
        flags.push(FRAUD_RULES[6]);
        indicators.push("sqlInjection"); // repurposed weight
    }

    const threat  = scoreThreat(indicators);
    const txn     = { id: transactionId || uid("txn"), amount, currency, merchantId, merchantName, deviceId, geoLocation, ts: new Date(now).toISOString(), flags: flags.map(f => f.id) };

    history.push(txn);
    flush(userId, "transaction_history", history.slice(-1000));
    securityLog(AGENT, userId, threat.block ? "fraud_blocked" : "transaction_analyzed", { transactionId: txn.id, amount, threatLevel: threat.level }, threat.level);

    if (threat.block) {
        return blocked(AGENT, `Fraud detected — transaction blocked. Flags: ${flags.map(f => f.name).join(", ")}`, threat.level);
    }
    if (flags.length) {
        return alert_(AGENT, `Suspicious transaction flags: ${flags.map(f => f.name).join(", ")}`, threat.level);
    }

    return ok(AGENT, { transactionId: txn.id, approved: true, riskLevel: "LOW", flags: [] });
}

function flagMerchant({ userId, merchantId, reason }) {
    if (!userId || !merchantId) return fail(AGENT, "userId and merchantId required");
    KNOWN_FRAUD_MERCHANTS.add(merchantId.toLowerCase());
    securityLog(AGENT, userId, "merchant_flagged", { merchantId, reason }, "HIGH");
    return ok(AGENT, { flagged: true, merchantId });
}

function getTransactionHistory({ userId, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "transaction_history", []).slice(-limit).reverse());
}

module.exports = { analyzeTransaction, flagMerchant, getTransactionHistory };
