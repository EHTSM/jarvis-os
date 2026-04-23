import fs from "fs";

export async function agentRouter(task) {

  const agentName = task.replace(/[^a-zA-Z]/g, "") + "Agent";
  const filePath = `./agents/generated/${agentName}.js`;

  // 🔥 CHECK IF EXISTS
  if (fs.existsSync(filePath)) {
    const agentModule = await import(`./generated/${agentName}.js`);
    return agentModule[agentName]();
  }

  // ❌ not found
  console.log("⚠️ Unknown task:", task);
  return null;
}