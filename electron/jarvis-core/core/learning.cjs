const fs = require("fs");

function learn(agent, task) {

  const file = "core/agentMemory.json";

  let data = [];

  try {
    data = JSON.parse(fs.readFileSync(file));
  } catch {}

  data.push({ agent, task, time: new Date() });

  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = learn;