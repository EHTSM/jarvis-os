export function toolManager(tool) {
  if (tool === "serpapi") return "Search executed";
  if (tool === "http") return "API called";

  console.log("⚠️ New tool needed:", tool);
  return "Tool placeholder created";
}