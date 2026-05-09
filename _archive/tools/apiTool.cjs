export async function apiTool(tool, data) {

  // 🔹 BUSINESS TOOLS
  if (tool === "QuickBooks") return "Business structure setup done";
  if (tool === "Microsoft Office") return "Business plan created";
  if (tool === "Government Website") return "Government registration completed";
  if (tool === "Legal Software") return "Licenses processed";
  if (tool === "Banking App") return "Bank account opened";

  // 🔹 SMART MATCH (AI tools)
  if (tool.includes("Excel")) return "Google Sheet created";
  if (tool.includes("Portal")) return "Form submitted";
  if (tool.includes("Bank")) return "Bank API ready";

  return `Tool executed: ${tool}`;
}