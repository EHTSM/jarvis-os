"use strict";
/**
 * Phase 572 — Engineering Task Understanding
 *
 * Bounded intent detection: classify engineering requests into
 * typed task structs. Explainable, low-noise, deterministic.
 *
 * Intent types: debugging | deployment | recovery | patch | dependency |
 *               git | browser | validation | monitoring | unknown
 */

// ── Intent classification ────────────────────────────────────────────────────

const INTENT_RULES = [
    { type: "debugging",   patterns: [/debug|error|crash|exception|stack.?trace|traceback|fail|broken/i],  confidence: 80 },
    { type: "deployment",  patterns: [/deploy|release|ship|publish|pm2|nginx|restart|reload/i],             confidence: 80 },
    { type: "recovery",    patterns: [/recover|restore|rollback|roll.?back|fix.*down|down.*fix/i],          confidence: 80 },
    { type: "patch",       patterns: [/patch|hotfix|edit.*file|change.*file|update.*file|apply.*fix/i],     confidence: 75 },
    { type: "dependency",  patterns: [/npm|yarn|install|module|package|dep(endency)?/i],                    confidence: 75 },
    { type: "git",         patterns: [/git|commit|push|pull|merge|branch|rebase|diff|stash/i],              confidence: 75 },
    { type: "browser",     patterns: [/browser|puppeteer|playwright|scrape|form|login|extract/i],           confidence: 70 },
    { type: "validation",  patterns: [/test|validate|verify|check|assert|spec|lint/i],                     confidence: 70 },
    { type: "monitoring",  patterns: [/monitor|health|status|metric|log|trace|alert|dashboard/i],          confidence: 70 },
];

/**
 * Classify a natural-language task description into an intent struct.
 * @param {string} text
 * @returns {{ type, confidence, signals, subtype, recoveryAware, deploymentAware }}
 */
function classifyIntent(text = "") {
    const lower = text.toLowerCase();
    const matches = [];

    for (const rule of INTENT_RULES) {
        for (const pat of rule.patterns) {
            if (pat.test(lower)) {
                matches.push({ type: rule.type, confidence: rule.confidence, signal: pat.source });
                break;
            }
        }
    }

    if (matches.length === 0) {
        return { type: "unknown", confidence: 0, signals: [], recoveryAware: false, deploymentAware: false };
    }

    // Pick highest-confidence match; boost if multiple signals
    matches.sort((a, b) => b.confidence - a.confidence);
    const primary   = matches[0];
    const boost     = Math.min(10, (matches.length - 1) * 3);
    const finalConf = Math.min(98, primary.confidence + boost);

    // Recovery-chain awareness
    const recoveryAware   = matches.some(m => ["recovery", "debugging"].includes(m.type));
    const deploymentAware = matches.some(m => m.type === "deployment");

    return {
        type:             primary.type,
        confidence:       finalConf,
        signals:          matches.map(m => m.signal),
        allTypes:         [...new Set(matches.map(m => m.type))],
        recoveryAware,
        deploymentAware,
    };
}

// ── Workflow dependency understanding ─────────────────────────────────────────

const WORKFLOW_DEPS = {
    deployment:  ["validation", "monitoring"],
    recovery:    ["debugging", "monitoring"],
    patch:       ["validation", "git"],
    debugging:   ["monitoring"],
    dependency:  ["validation"],
    git:         [],
    browser:     [],
    validation:  [],
    monitoring:  [],
    unknown:     [],
};

/**
 * Given an intent type, return dependent workflow types that should run first.
 */
function workflowDependencies(intentType) {
    return WORKFLOW_DEPS[intentType] || [];
}

// ── Task struct builder ───────────────────────────────────────────────────────

/**
 * Build a full task understanding struct from raw text.
 * @param {string} rawText
 * @param {{ sessionId?, operatorId?, context? }} opts
 */
function understand(rawText, opts = {}) {
    const { sessionId = null, operatorId = null, context = {} } = opts;
    const intent   = classifyIntent(rawText);
    const deps     = workflowDependencies(intent.type);
    const urgency  = _detectUrgency(rawText);
    const entities = _extractEntities(rawText);

    return {
        raw:              rawText,
        intent,
        dependencies:     deps,
        urgency,
        entities,
        sessionId,
        operatorId,
        contextSignals:   Object.keys(context).length,
        ts:               Date.now(),
    };
}

function _detectUrgency(text) {
    if (/urgent|asap|immediately|critical|down now|production.*down/i.test(text)) return "critical";
    if (/soon|quickly|broken|failing/i.test(text)) return "high";
    return "normal";
}

function _extractEntities(text) {
    const entities = {};
    // File paths
    const files = text.match(/[\w./-]+\.(js|cjs|ts|json|yml|yaml|env|sh|md)/g);
    if (files) entities.files = [...new Set(files)].slice(0, 5);
    // Port numbers
    const ports = text.match(/:\d{4,5}/g);
    if (ports) entities.ports = [...new Set(ports)].slice(0, 3);
    // Package names
    const pkgs = text.match(/(?:npm install|require|import)\s+([\w@/-]+)/g);
    if (pkgs) entities.packages = pkgs.slice(0, 5);
    return entities;
}

// ── Operational context awareness ────────────────────────────────────────────

/**
 * Merge session context into a task understanding.
 * Enriches with session goal + active chain context.
 */
function enrichWithContext(task, sessionCtx = {}) {
    const { goal = "", activeChain = "", recentErrors = [] } = sessionCtx;

    // Re-classify if session goal adds signal
    if (goal && task.intent.type === "unknown") {
        const merged  = understand(`${task.raw} ${goal}`, { sessionId: task.sessionId });
        task.intent   = merged.intent;
        task.enriched = true;
    }

    // Elevate urgency based on errors
    if (recentErrors.length >= 3 && task.urgency === "normal") {
        task.urgency = "high";
        task.urgencyElevated = true;
    }

    task.sessionGoal   = goal.slice(0, 100);
    task.activeChain   = activeChain;
    task.recentErrors  = recentErrors.length;

    return task;
}

module.exports = { classifyIntent, workflowDependencies, understand, enrichWithContext };
