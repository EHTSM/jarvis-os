export async function apiTool(tool, data) {

  if (tool === "Business Plan Template") {
    return "Business plan document created";
  }

  if (tool === "Business Registration Portal") {
    return "Business registered successfully";
  }

  if (tool === "Government Website") {
    return "Licenses checked and applied";
  }

  if (tool === "Bank Website") {
    return "Bank account opened";
  }

  if (tool === "Accounting Software") {
    return "Accounting system setup done";
  }

  return `Tool executed: ${tool}`;
}