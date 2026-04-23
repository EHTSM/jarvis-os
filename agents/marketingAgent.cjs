import { generateLeads } from "../money/leadSystem.js";
import { sendDM } from "../automation/dmSender.js";

export async function marketingAgent() {
  const leads = generateLeads();

  return leads.map(u => sendDM(u));
}