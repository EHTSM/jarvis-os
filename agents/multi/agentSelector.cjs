/**
 * Agent Selector — picks the best registered agent for a given task.
 * Uses keyword scoring + category matching. Fully extensible.
 */

const agentManager = require("./agentManager.cjs");

// Keyword → agent name mapping for intent detection
const INTENT_MAP = [
    { keywords: ["generate code", "write code", "create code", "build function", "make module"],     agent: "codeGenerator" },
    { keywords: ["fix error", "debug", "fix bug", "error in", "exception", "crash", "stack trace"],  agent: "debugger"      },
    { keywords: ["build api", "create api", "rest api", "crud api", "make endpoint"],                agent: "apiBuilder"    },
    { keywords: ["database", "schema", "mongoose", "mongodb", "firestore", "model"],                 agent: "database"      },
    { keywords: ["firebase", "auth setup", "firestore rules", "firebase storage"],                   agent: "firebase"      },
    { keywords: ["deploy", "docker", "dockerfile", "docker-compose", "container", "ci/cd"],          agent: "deployment"    },
    { keywords: ["git", "commit", "branch", "version control", "git init", "git status"],            agent: "versionControl"},
    { keywords: ["test", "unit test", "jest", "spec", "testing", "coverage"],                        agent: "testRunner"    },
    { keywords: ["optimize", "performance", "speed up", "slow", "bottleneck", "memory leak"],        agent: "optimizer"     },
    { keywords: ["security", "vulnerability", "scan", "xss", "injection", "sanitize", "auth"],       agent: "security"      }
];

function _score(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
}

// Select agent by task.type first, then by free-text scoring
function select(task) {
    const input = (task.input || task.payload?.description || task.type || "").toLowerCase();

    // 1. Direct type match via agentManager
    const byType = _typeToAgent(task.type);
    if (byType && agentManager.has(byType)) return { agent: byType, method: "type", score: 100 };

    // 2. Keyword scoring across intent map
    let best = null, bestScore = 0;
    for (const { keywords, agent } of INTENT_MAP) {
        const score = _score(input, keywords);
        if (score > bestScore && agentManager.has(agent)) {
            bestScore = score;
            best      = agent;
        }
    }
    if (best) return { agent: best, method: "keyword", score: bestScore };

    // 3. Fallback — first active agent in the requested category
    const category = task.category || "dev";
    const inCat    = agentManager.list({ category }).find(a => a.active);
    if (inCat) return { agent: inCat.name, method: "category", score: 1 };

    return null; // no agent found
}

function _typeToAgent(type) {
    const map = {
        generate_code:     "codeGenerator",
        debug_code:        "debugger",
        fix_error:         "debugger",
        build_api:         "apiBuilder",
        create_api:        "apiBuilder",
        create_schema:     "database",
        firebase_setup:    "firebase",
        deploy:            "deployment",
        create_dockerfile: "deployment",
        git_op:            "versionControl",
        git_init:          "versionControl",
        git_commit:        "versionControl",
        git_status:        "versionControl",
        generate_tests:    "testRunner",
        optimize_code:     "optimizer",
        security_scan:     "security",
        sanitize:          "security"
    };
    return map[type] || null;
}

module.exports = { select };
