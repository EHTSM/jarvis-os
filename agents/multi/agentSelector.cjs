/**
 * Agent Selector — picks the best registered agent for a given task.
 *
 * Agent Civilization Unification (module 1/2): previously scored free
 * text against a private INTENT_MAP naming 10 agents ("codeGenerator",
 * "debugger", "apiBuilder", "database", "firebase", "deployment",
 * "versionControl", "testRunner", "optimizer", "security") that were
 * never registered anywhere — agentManager.has() always returned false
 * for every one of them, so select() silently fell through to Stage 3
 * of executor.cjs on every dev-shaped task. The real dev capability
 * (agents/devAgent.cjs, delegating to agents/dev/codeGeneratorAgent.cjs)
 * has been registered in the production agentRegistry since
 * bootstrapRuntime.cjs was written — this file just never looked there.
 *
 * Fix: delegate to the same capability-resolution path the real runtime
 * (agents/runtime/executionEngine.cjs) already uses — taskRouter maps
 * task.type -> capability string, agentRegistry.findForCapability()
 * finds the live, circuit-breaker-protected agent. agentManager (the
 * multi/ shadow registry) is no longer consulted here; it had zero
 * consumers outside agents/multi/ (confirmed: no backend/ file requires
 * it), so nothing else observes this change.
 */

const taskRouter    = require("../runtime/taskRouter.cjs");
const agentRegistry = require("../runtime/agentRegistry.cjs");

// Free-text fallback for callers that only pass a description, no
// task.type — mapped onto the SAME capability strings taskRouter uses,
// so a match here reaches the identical real agent as a typed task
// would. Unlike the old INTENT_MAP, every capability below is
// confirmed registered in bootstrapRuntime.cjs.
const KEYWORD_CAPABILITY_MAP = [
    { keywords: ["generate code", "write code", "create code", "build function", "make module", "modify file", "patch"], capability: "dev" },
    { keywords: ["build api", "create api", "rest api", "crud api", "make endpoint"],                                    capability: "dev" },
    { keywords: ["database", "schema", "mongoose", "mongodb", "firestore", "model"],                                     capability: "dev" },
    { keywords: ["deploy", "docker", "dockerfile", "docker-compose", "container", "ci/cd"],                              capability: "dev" },
    { keywords: ["git", "commit", "branch", "version control", "git init", "git status"],                                capability: "terminal" },
    { keywords: ["web search", "scrape", "research", "trend", "competitor", "market intelligence"],                      capability: "research" },
    { keywords: ["schedule post", "caption", "hashtag", "script", "thumbnail", "podcast", "reel"],                       capability: "content_writer" },
];

function _score(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
}

// Select agent by task.type first (via taskRouter's capability map),
// then by free-text keyword scoring against the same capability space.
function select(task) {
    const input = (task.input || task.payload?.description || task.type || "").toLowerCase();

    // 1. Direct type match — taskRouter.resolveCapability() is the same
    //    lookup the production executionEngine uses, so a task routed
    //    here and a task routed through the main pipeline reach the
    //    same physical agent.
    if (task.type) {
        const capability = taskRouter.resolveCapability(task.type);
        const agent = agentRegistry.findForCapability(capability);
        if (agent) return { agent: agent.id, capability, method: "type", score: 100 };
    }

    // 2. Keyword scoring across the confirmed-real capability set
    let bestCapability = null, bestScore = 0;
    for (const { keywords, capability } of KEYWORD_CAPABILITY_MAP) {
        const score = _score(input, keywords);
        if (score > bestScore && agentRegistry.findForCapability(capability)) {
            bestScore      = score;
            bestCapability = capability;
        }
    }
    if (bestCapability) {
        const agent = agentRegistry.findForCapability(bestCapability);
        return { agent: agent.id, capability: bestCapability, method: "keyword", score: bestScore };
    }

    // 3. Fallback — generic "ai" capability, same default taskRouter uses
    //    for any unrecognized task.type.
    const fallback = agentRegistry.findForCapability("ai");
    if (fallback) return { agent: fallback.id, capability: "ai", method: "fallback", score: 1 };

    return null; // no agent found
}

module.exports = { select };
