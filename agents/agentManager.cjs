import { agentRouter } from "./agentRouter.js";
import { createAgent } from "./createAgent.js";

export async function agentManager(task) {

  let result = await agentRouter(task.name);

  if (!result) {
    console.log("⚠️ Creating agent:", task.agent);

    await createAgent(task);

    // 🔥 RUN AGAIN AFTER CREATE
    result = await agentRouter(task.name);
  }

  return result;
}