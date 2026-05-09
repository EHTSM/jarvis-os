/**
 * Personalization — enriches input with user context from CRM.
 * Attaches history, name, status so downstream agents can personalize replies.
 */
const { getLeads } = require("../crm.cjs");

function getUserProfile(userId) {
    if (!userId || userId === "guest") return null;
    try {
        const leads = getLeads();
        return leads.find(l => l.phone === userId || l.id === userId) || null;
    } catch {
        return null;
    }
}

async function apply({ text, user, intent, emotion }) {
    const profile = getUserProfile(user.id);

    const enrichedUser = {
        ...user,
        name:         profile?.name || user.name || "User",
        status:       profile?.status || "new",
        isReturning:  !!profile,
        isPaid:       profile?.status === "paid",
        isHot:        profile?.status === "hot",
        source:       profile?.source || "unknown"
    };

    // Prepend invisible context tag so AI/sales agent can personalize tone
    let enrichedText = text;

    if (enrichedUser.isPaid) {
        enrichedText = `[EXISTING_CUSTOMER:${enrichedUser.name}] ${text}`;
    } else if (enrichedUser.isHot && intent.intent === "sales") {
        enrichedText = `[RETURNING_HOT_LEAD:${enrichedUser.name}] ${text}`;
    } else if (enrichedUser.isReturning) {
        enrichedText = `[RETURNING_USER:${enrichedUser.name}] ${text}`;
    }

    return {
        text: enrichedText,
        user: enrichedUser,
        intent,
        emotion
    };
}

module.exports = { apply, getUserProfile };
