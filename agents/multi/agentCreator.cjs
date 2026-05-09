/**
 * Agent Creator — dynamically creates new agents and registers them.
 * Generated agents are written to agents/generated/ and immediately usable.
 */

const fs           = require("fs");
const path         = require("path");
const agentManager = require("./agentManager.cjs");

const GEN_DIR = path.join(__dirname, "../generated");

function _template(name, category, description) {
    return `/**
 * Auto-generated agent: ${name}
 * Category: ${category}
 * Description: ${description}
 * Generated: ${new Date().toISOString()}
 */

async function run(task) {
    const p = task.payload || {};
    // TODO: implement agent logic for "${description}"
    return {
        success: true,
        agent:   "${name}",
        input:   p,
        result:  "Agent '${name}' executed — implement custom logic here"
    };
}

module.exports = { run };
`;
}

function create({ name, category = "custom", description = "", meta = {} }) {
    if (!name) throw new Error("agentCreator: name is required");
    if (agentManager.has(name)) return { success: false, error: `Agent "${name}" already exists` };

    if (!fs.existsSync(GEN_DIR)) fs.mkdirSync(GEN_DIR, { recursive: true });

    const filePath = path.join(GEN_DIR, `${name}.cjs`);
    const code     = _template(name, category, description);
    fs.writeFileSync(filePath, code, "utf8");

    // Load and register immediately
    const agent = require(filePath);
    agentManager.register(name, agent, { category, description, generated: true, ...meta });

    return { success: true, name, category, filePath, registered: true };
}

// Register an existing module as an agent (no file generation needed)
function registerExisting(name, agentModule, meta = {}) {
    return agentManager.register(name, agentModule, meta);
}

module.exports = { create, registerExisting };
