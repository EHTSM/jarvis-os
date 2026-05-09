/**
 * Agent Marketplace — catalog of all available agents.
 * Foundation for future SaaS agent discovery and subscription.
 */

const agentManager = require("./agentManager.cjs");

// Static catalog (built-in agents descriptions)
const CATALOG = {
    codeGenerator:  { displayName: "Code Generator",      description: "Generate Node.js, React, and API code from descriptions", tags: ["dev", "codegen"],   free: true  },
    debugger:       { displayName: "Debug Agent",          description: "Analyze errors, identify root cause, suggest fixes",     tags: ["dev", "debug"],     free: true  },
    apiBuilder:     { displayName: "API Builder",          description: "Generate complete REST API with routes and controllers",  tags: ["dev", "api"],       free: true  },
    database:       { displayName: "Database Agent",       description: "Generate Mongoose schemas and Firestore CRUD modules",   tags: ["dev", "database"],  free: true  },
    firebase:       { displayName: "Firebase Agent",       description: "Setup Firebase Auth, Firestore, and Storage",           tags: ["dev", "firebase"],  free: true  },
    deployment:     { displayName: "Deployment Agent",     description: "Generate Docker, docker-compose, and deploy scripts",   tags: ["dev", "devops"],    free: true  },
    versionControl: { displayName: "Version Control",      description: "Git operations: init, commit, branch, status",          tags: ["dev", "git"],       free: true  },
    testRunner:     { displayName: "Test Agent",           description: "Generate Jest unit and API integration tests",           tags: ["dev", "testing"],   free: true  },
    optimizer:      { displayName: "Optimization Agent",   description: "AI-powered code performance analysis and suggestions",  tags: ["dev", "perf"],      free: true  },
    security:       { displayName: "Security Agent",       description: "Vulnerability scanning and security review",             tags: ["dev", "security"],  free: true  }
};

function browse(filter = {}) {
    const registered = new Set(agentManager.list().map(a => a.name));
    let   agents     = Object.entries(CATALOG).map(([name, info]) => ({
        name,
        ...info,
        registered: registered.has(name),
        status:     registered.has(name) ? "active" : "available"
    }));

    if (filter.tag)      agents = agents.filter(a => a.tags.includes(filter.tag));
    if (filter.free)     agents = agents.filter(a => a.free === true);
    if (filter.registered !== undefined) agents = agents.filter(a => a.registered === filter.registered);

    return agents;
}

function details(name) {
    const info = CATALOG[name];
    if (!info) return null;
    const entry = agentManager.get(name);
    return {
        name,
        ...info,
        registered: !!entry,
        stats: entry ? {
            execCount: entry.execCount,
            failCount: entry.failCount
        } : null
    };
}

function search(query) {
    const q = query.toLowerCase();
    return browse().filter(a =>
        a.name.toLowerCase().includes(q)          ||
        a.displayName.toLowerCase().includes(q)   ||
        a.description.toLowerCase().includes(q)   ||
        a.tags.some(t => t.includes(q))
    );
}

module.exports = { browse, details, search, CATALOG };
