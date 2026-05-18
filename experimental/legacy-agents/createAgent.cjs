const fs = require("fs");
const path = require("path");

async function createAgent(task) {
    const agentName = task.name.replace(/[^a-zA-Z]/g, "") + "Agent";
    const dir = path.join(__dirname, "generated");

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${agentName}.cjs`);

    const code = `// Auto-generated agent: ${agentName}
async function ${agentName}(input) {
    console.log("${agentName} executing:", input);
    return { agent: "${agentName}", task: input, status: "completed" };
}

module.exports = { ${agentName} };
`;

    fs.writeFileSync(filePath, code);
    console.log("🤖 Agent created:", agentName);
    return { agentName, filePath };
}

module.exports = { createAgent };
