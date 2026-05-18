/**
 * Router — maps detected intent to gateway mode.
 * sales → "sales", automation → "auto", everything else → "smart"
 */

const INTENT_MODE_MAP = {
    sales:      "sales",
    automation: "auto",
    task:       "auto",    // hits executorAgent — life/autonomous/enterprise layers
    question:   "smart"    // hits orchestrator — handles conversational questions
};

function route(intent) {
    return INTENT_MODE_MAP[intent] || "smart";
}

module.exports = { route };
