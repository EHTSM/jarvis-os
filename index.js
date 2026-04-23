import { brain } from "./core/brain.js";
import { planner } from "./core/planner.js";
import { taskEngine } from "./core/taskEngine.js";

export async function runJarvis(input) {
  console.log("\n🧠 Jarvis Activated...\n");

  const intent = await brain(input);
  console.log("Intent:", intent);

  const tasks = planner(intent);
  console.log("Tasks:", tasks);

  const result = await taskEngine(tasks);

  console.log("\n✅ FINAL RESULT:\n", result);

  return result;
}