import fs from "fs";

export async function createAgent(task) {

  const agentName = task.name.replace(/[^a-zA-Z]/g, "") + "Agent";

  const filePath = `./agents/generated/${agentName}.js`;

  const code = `
import { runWorkflow } from "../../automation/n8nConnector.js";
const { apiTool } = require("../../tools/apiTool.js");
export async function ${agentName}() {

  const toolResult = await apiTool("${task.tool}", {
    task: "${task.name}"
  });

  const workflowResult = await runWorkflow("business-workflow", {
    task: "${task.name}"
  });

  return "Task: ${task.name} → " + toolResult + " → " + workflowResult;
}
`;

  fs.writeFileSync(filePath, code);

  console.log("🤖 Agent created:", agentName);
}