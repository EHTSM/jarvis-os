import axios from "axios";
export async function runWorkflow(name, data) {
  try {
    const res = await fetch(`http://localhost:5678/webhook/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    const json = await res.json();
    return json.message || "Workflow executed";
  } catch (err) {
    return "Workflow failed";
  }
}