function decide(intent) {
  if (intent === "bulk") return "bulk_whatsapp";
  if (intent === "whatsapp") return "whatsapp_automation";
  if (intent === "instagram") return "instagram_automation";
  if (intent === "ai") return "ai_planner";
  if (intent === "lead") return "find_leads";
  if (intent === "auto") return "find_and_contact";

  // 🔥 ADD THIS
  if (intent === "agent") return "create_agent";

  return "do_nothing";
}

module.exports = decide;