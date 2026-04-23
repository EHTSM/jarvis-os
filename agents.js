const fs = require("fs");

function loadLeads() {
  try {
    return JSON.parse(fs.readFileSync("memory.json", "utf-8"));
  } catch {
    return [];
  }
}

// 🔥 Agent 1: Analyzer
function analyze() {
  const leads = loadLeads().length;
  console.log("📊 Total leads:", leads);
}

// 🔥 Agent 2: Decision
function decision() {
  console.log("🧠 Strategy: Increase outreach");
}

// 🔥 Agent 3: Campaign Manager
function campaign() {
  console.log("🚀 Campaign running...");
}

module.exports = {
  analyze,
  decision,
  campaign
};