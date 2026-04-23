function interpret(command) {
  command = command.toLowerCase();

  if (command.includes("bulk")) return "bulk";
  if (command.includes("whatsapp")) return "whatsapp";
  if (command.includes("instagram")) return "instagram";
  if (command.includes("plan")) return "ai";
  if (command.includes("lead")) return "lead";
  if (command.includes("contact")) return "auto";

  // 🔥 ADD THIS
  if (command.includes("agent")) return "agent";

  return "unknown";
}

module.exports = interpret;