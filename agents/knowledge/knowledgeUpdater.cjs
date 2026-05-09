/**
 * Knowledge Updater — auto-extracts facts from successful task results
 * and stores them in the knowledge base for future retrieval.
 */

const knowledgeBase = require("./knowledgeBase.cjs");

// Task types that produce learnable facts
const EXTRACTORS = {
    show_revenue:    (result) => result.data ? {
        key:      `revenue_snapshot_${_datestamp()}`,
        content:  `Revenue as of ${new Date().toLocaleDateString()}: Total ₹${result.data.total_revenue_inr || 0}, Monthly ₹${result.data.monthly_revenue_inr || 0}, Conversion ${result.data.conversion_rate_pct || 0}%`,
        category: "business"
    } : null,

    crm_stats: (result) => result.data ? {
        key:      `crm_snapshot_${_datestamp()}`,
        content:  `CRM snapshot ${new Date().toLocaleDateString()}: Total leads ${result.data.total || 0}, Paid ${result.data.byStatus?.paid || 0}, Hot ${result.data.byStatus?.hot || 0}`,
        category: "business"
    } : null,

    faq: (result) => result.data?.answer ? {
        key:      `faq_${_slug(result.data.question || "answer")}`,
        content:  result.data.answer,
        category: "support"
    } : null,

    analytics_stats: (result) => result.data ? {
        key:      `analytics_${_datestamp()}`,
        content:  `Analytics ${new Date().toLocaleDateString()}: Messages sent ${result.data.messages_sent || 0}, Campaigns ${result.data.campaigns_sent || 0}, Conversion ${result.data.conversion_rate || "0%"}`,
        category: "business"
    } : null
};

function _datestamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function _slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

/**
 * Called after each task execution.
 * Silently extracts knowledge when an extractor exists for the task type.
 */
function updateFromResult(taskType, result) {
    if (!result?.success) return;
    const extractor = EXTRACTORS[taskType];
    if (!extractor) return;
    try {
        const fact = extractor(result);
        if (fact) knowledgeBase.add(fact.key, fact.content, fact.category);
    } catch { /* non-critical */ }
}

/**
 * Manually add a fact to the knowledge base.
 */
function addFact(key, content, category = "general") {
    return knowledgeBase.add(key, content, category);
}

module.exports = { updateFromResult, addFact };
