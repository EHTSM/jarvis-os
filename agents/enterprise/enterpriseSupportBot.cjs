/**
 * Enterprise Support Bot — AI-powered help desk with FAQ resolution and escalation.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const FAQ_DATABASE = {
    password:      { answer: "Go to Settings → Security → Reset Password. A reset link will be sent to your registered email.", escalate: false },
    billing:       { answer: "Your billing details are in Settings → Billing. For disputes, contact your account manager or raise a billing ticket.", escalate: true },
    account:       { answer: "Account settings are available under your profile menu. For access issues, contact your admin.", escalate: false },
    permission:    { answer: "Permission changes must be requested from your manager or admin via the Role Management panel.", escalate: false },
    integration:   { answer: "Navigate to Settings → Integrations to connect third-party tools. Check our docs for supported APIs.", escalate: false },
    export:        { answer: "Use Reports → Export to download data in CSV or JSON format. Admins can bulk-export all data.", escalate: false },
    performance:   { answer: "If the platform is slow, try clearing cache (Ctrl+Shift+R) or switching to a different browser. Report persistent issues.", escalate: true },
    error:         { answer: "Note the error code and message, then raise a technical ticket with your browser and OS details included.", escalate: true },
    delete:        { answer: "Deletion is irreversible. Admins can delete data from the Admin Panel. Contact your admin to proceed.", escalate: false },
    api:           { answer: "API keys are generated in Settings → Developer. See our API documentation for endpoint references.", escalate: false },
    sso:           { answer: "SSO setup requires admin access. Go to Settings → Security → SSO and follow the SAML/OAuth setup guide.", escalate: false },
    report:        { answer: "Reports are available under Analytics. Schedule automated reports in Reports → Scheduled.", escalate: false },
    backup:        { answer: "Backups run automatically per your plan. Manual backup can be triggered from Admin Panel → Backups.", escalate: false },
    compliance:    { answer: "Compliance documents (SOC2, GDPR, ISO 27001) are available in your admin portal under Compliance.", escalate: true },
    pricing:       { answer: "Current plan and pricing are in Settings → Billing. Contact sales for upgrades or custom enterprise pricing.", escalate: true }
};

function _matchFAQ(query = "") {
    const lower = query.toLowerCase();
    for (const [keyword, entry] of Object.entries(FAQ_DATABASE)) {
        if (lower.includes(keyword)) return { keyword, ...entry };
    }
    return null;
}

function askSupport({ tenantId, userId, query, context = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("enterpriseSupportBot", auth.error);
    if (!query || query.trim().length < 3) return fail("enterpriseSupportBot", "Query too short");

    const faqMatch  = _matchFAQ(query);
    const sessionId = uid("sup");

    const session = {
        id:        sessionId,
        tenantId,
        userId,
        query:     query.slice(0, 1000),
        context:   context.slice(0, 500),
        response:  faqMatch ? faqMatch.answer : "I couldn't find an exact match for your query. I've flagged this for a human agent to review. You can also raise a support ticket for faster resolution.",
        resolved:  !!faqMatch && !faqMatch.escalate,
        escalated: faqMatch ? faqMatch.escalate : true,
        matchedTopic: faqMatch ? faqMatch.keyword : null,
        suggestedAction: faqMatch && faqMatch.escalate ? "raise_ticket" : faqMatch ? null : "raise_ticket",
        askedAt:   NOW()
    };

    const sessions = load(tenantId, "support-sessions", []);
    sessions.push(session);
    flush(tenantId, "support-sessions", sessions.slice(-5000));
    auditLog(tenantId, userId, "support_query", { resolved: session.resolved, escalated: session.escalated });

    return ok("enterpriseSupportBot", {
        sessionId:   session.id,
        response:    session.response,
        resolved:    session.resolved,
        escalated:   session.escalated,
        topic:       session.matchedTopic,
        nextStep:    session.escalated ? "Please raise a support ticket for personalized assistance." : "Issue resolved via FAQ.",
        suggestedAction: session.suggestedAction
    });
}

function getSupportMetrics(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("enterpriseSupportBot", auth.error);

    const sessions  = load(tenantId, "support-sessions", []);
    const resolved  = sessions.filter(s => s.resolved).length;
    const escalated = sessions.filter(s => s.escalated).length;
    const topTopics = Object.entries(
        sessions.reduce((m, s) => { if (s.matchedTopic) m[s.matchedTopic] = (m[s.matchedTopic] || 0) + 1; return m; }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return ok("enterpriseSupportBot", {
        tenantId,
        total:          sessions.length,
        resolved,
        escalated,
        resolutionRate: sessions.length ? `${Math.round((resolved / sessions.length) * 100)}%` : "0%",
        topTopics:      topTopics.map(([topic, count]) => ({ topic, count }))
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "ask_support")      return askSupport(p);
        if (task.type === "support_metrics")  return getSupportMetrics(p.tenantId, p.userId);
        return askSupport(p);
    } catch (err) { return fail("enterpriseSupportBot", err.message); }
}

module.exports = { askSupport, getSupportMetrics, FAQ_DATABASE, run };
