const fs = require("fs");

function createAgent(name, job) {

  const file = "core/agents/agents.json";

  let agents = [];

  try {
    agents = JSON.parse(fs.readFileSync(file));
  } catch {}

  agents.push({ name, job });

  fs.writeFileSync(file, JSON.stringify(agents, null, 2));

  return { name, job };
}

module.exports = createAgent;