const fs = require("fs");

function generateAgents(count = 50) {

  const roles = [
    "Marketing Agent",
    "Sales Agent",
    "Support Agent",
    "Lead Generator",
    "Closer Agent",
    "Follow-up Agent",
    "Content Agent",
    "Instagram Agent",
    "WhatsApp Agent",
    "Fiverr Agent"
  ];

  const file = "core/agents/agents.json";

  let agents = [];

  try {
    agents = JSON.parse(fs.readFileSync(file));
  } catch {}

  for (let i = 0; i < count; i++) {

    const role = roles[i % roles.length];

    agents.push({
      name: `${role} ${i + 1}`,
      job: role
    });
  }

  fs.writeFileSync(file, JSON.stringify(agents, null, 2));

  return {
    success: true,
    total: agents.length
  };
}

module.exports = generateAgents;