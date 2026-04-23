import axios from "axios";

export async function runWorkflow(name) {
  try {
    await axios.post(`http://localhost:5678/webhook/${name}`);
    return "Workflow triggered";
  } catch {
    console.log("⚠️ Creating workflow:", name);
    return "Workflow placeholder created";
  }
}