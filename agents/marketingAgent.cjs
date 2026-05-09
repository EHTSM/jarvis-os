const { generateLeads } = require("../agents/money/leadSystem.cjs");
const { sendDM } = require("../automation/dmSender.cjs");

async function marketingAgent() {
  const leads = generateLeads();
  return leads.map(u => sendDM(u));
}

module.exports = marketingAgent;
