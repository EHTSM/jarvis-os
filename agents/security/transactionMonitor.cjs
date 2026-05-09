"use strict";
const { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked, alert_ } = require("./_securityStore.cjs");
const AGENT = "transactionMonitor";

const ANOMALY_RULES = [
    { id:"A001", name:"Burst Pattern",       check:(txns, t) => txns.filter(x => t - new Date(x.ts).getTime() < 60000).length >= 10, weight:3, desc:"10+ transactions in 60 seconds" },
    { id:"A002", name:"Spike Amount",        check:(txns, t, amt) => { const avg = txns.length ? txns.reduce((s,x)=>s+x.amount,0)/txns.length : 0; return avg > 0 && amt > avg * 10; }, weight:3, desc:"Amount 10x above average" },
    { id:"A003", name:"Night Surge",         check:(txns, t) => { const h = new Date(t).getHours(); return h >= 2 && h <= 4 && txns.filter(x => new Date(x.ts).getHours()>=2 && new Date(x.ts).getHours()<=4).length >= 3; }, weight:2, desc:"Repeated night-time transactions" },
    { id:"A004", name:"Rapid Device Switch", check:(txns, t, amt, meta) => { if (!meta.deviceId) return false; const last = txns.slice(-5); const devices = new Set(last.map(x=>x.deviceId).filter(Boolean)); return devices.size >= 3; }, weight:2, desc:"3+ devices in last 5 transactions" },
    { id:"A005", name:"Exact Repeat",        check:(txns, t, amt) => txns.slice(-10).filter(x => x.amount === amt).length >= 3, weight:2, desc:"Same amount repeated 3+ times" },
    { id:"A006", name:"Round Escalation",    check:(txns, t, amt) => amt % 1000 === 0 && amt > 50000, weight:1, desc:"Large round-number transaction" },
    { id:"A007", name:"Cross-Currency Rapid",check:(txns, t, amt, meta) => { if (!meta.currency) return false; const recent = txns.slice(-5); const currencies = new Set(recent.map(x=>x.currency).filter(Boolean)); return currencies.size >= 3; }, weight:2, desc:"3+ currencies in recent transactions" }
];

const ALERT_THRESHOLDS = {
    LOW:    { score: 0, label: "NORMAL" },
    MEDIUM: { score: 2, label: "WATCH" },
    HIGH:   { score: 4, label: "ALERT" },
    CRITICAL:{ score: 6, label: "FREEZE_ACCOUNT" }
};

function monitorTransaction({ userId, amount, currency = "INR", merchantId, deviceId, geoLocation, sessionId, timestamp }) {
    if (!userId || !amount) return fail(AGENT, "userId and amount required");

    const history = load(userId, "monitor_history", []);
    const now     = timestamp ? new Date(timestamp).getTime() : Date.now();
    const meta    = { deviceId, currency, geoLocation, sessionId };

    const triggeredRules = ANOMALY_RULES.filter(r => r.check(history, now, amount, meta));
    const totalScore     = triggeredRules.reduce((s, r) => s + r.weight, 0);

    let alertLevel = "LOW";
    for (const [level, conf] of Object.entries(ALERT_THRESHOLDS).reverse()) {
        if (totalScore >= conf.score) { alertLevel = level; break; }
    }

    const record = { id: uid("txn"), amount, currency, merchantId, deviceId, geoLocation, sessionId, ts: new Date(now).toISOString(), anomalyScore: totalScore, rules: triggeredRules.map(r => r.id) };
    history.push(record);
    flush(userId, "monitor_history", history.slice(-2000));

    securityLog(AGENT, userId, alertLevel === "LOW" ? "transaction_normal" : "anomaly_detected", { transactionId: record.id, amount, alertLevel, rules: triggeredRules.map(r=>r.name) }, alertLevel);

    if (alertLevel === "CRITICAL") {
        return blocked(AGENT, `Account activity frozen — critical anomaly score ${totalScore}. Triggered: ${triggeredRules.map(r=>r.name).join(", ")}`, "CRITICAL");
    }
    if (alertLevel === "HIGH") {
        return alert_(AGENT, `High-risk transaction pattern detected (score: ${totalScore}): ${triggeredRules.map(r=>r.name).join(", ")}`, "HIGH");
    }
    if (alertLevel === "MEDIUM") {
        return alert_(AGENT, `Transaction flagged for review (score: ${totalScore}): ${triggeredRules.map(r=>r.desc).join("; ")}`, "MEDIUM");
    }

    return ok(AGENT, { transactionId: record.id, status: "NORMAL", anomalyScore: totalScore, monitored: true });
}

function getAccountRiskProfile({ userId }) {
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "monitor_history", []);
    if (!history.length) return ok(AGENT, { userId, riskScore: 0, level: "CLEAN", transactionCount: 0 });

    const recent     = history.slice(-100);
    const avgScore   = recent.reduce((s, t) => s + (t.anomalyScore || 0), 0) / recent.length;
    const highCount  = recent.filter(t => (t.anomalyScore || 0) >= 4).length;
    const level      = avgScore >= 4 ? "HIGH_RISK" : avgScore >= 2 ? "WATCH" : "CLEAN";

    securityLog(AGENT, userId, "risk_profile_read", { level, avgScore: avgScore.toFixed(2) }, level === "HIGH_RISK" ? "HIGH" : "INFO");

    return ok(AGENT, {
        userId,
        riskScore:        parseFloat(avgScore.toFixed(2)),
        level,
        transactionCount: history.length,
        recentHighRisk:   highCount,
        topRules:         _topRules(recent),
        recommendation:   level === "HIGH_RISK" ? "Manual review recommended — account shows persistent anomaly patterns" : level === "WATCH" ? "Monitor closely" : "Account activity appears normal"
    });
}

function setMonitorAlert({ userId, ruleId, enabled }) {
    if (!userId || !ruleId) return fail(AGENT, "userId and ruleId required");
    const rule = ANOMALY_RULES.find(r => r.id === ruleId);
    if (!rule) return fail(AGENT, `Unknown rule ID: ${ruleId}`);

    const prefs = load(userId, "monitor_prefs", {});
    prefs[ruleId] = { enabled: !!enabled, updatedAt: NOW() };
    flush(userId, "monitor_prefs", prefs);

    securityLog(AGENT, userId, "monitor_pref_updated", { ruleId, enabled }, "INFO");
    return ok(AGENT, { ruleId, ruleName: rule.name, enabled: !!enabled });
}

function getAnomalyLog({ userId, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    const history = load(userId, "monitor_history", []);
    const anomalies = history.filter(t => (t.anomalyScore || 0) > 0).slice(-limit).reverse();
    return ok(AGENT, { total: anomalies.length, entries: anomalies });
}

function _topRules(txns) {
    const counts = {};
    txns.forEach(t => (t.rules || []).forEach(r => { counts[r] = (counts[r] || 0) + 1; }));
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id,count]) => {
        const rule = ANOMALY_RULES.find(r => r.id === id);
        return { ruleId: id, ruleName: rule ? rule.name : id, occurrences: count };
    });
}

module.exports = { monitorTransaction, getAccountRiskProfile, setMonitorAlert, getAnomalyLog };
