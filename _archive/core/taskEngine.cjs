import { agentManager } from "../agents/agentManager.js";

export async function taskEngine(tasks) {
  let results = [];

  for (let task of tasks) {
    const res = await agentManager(task);
    results.push(res);
  }

  return results;
}