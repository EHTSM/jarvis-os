const fs = require("fs");

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync("queue.json"));
  } catch {
    return [];
  }
}

function runScheduler() {
  const queue = loadQueue();

  console.log("🚀 Posting cycle\n");

  queue.forEach((item, i) => {
    console.log(`Post ${i + 1}:`, item.text);
  });

  console.log("\n👉 Publish via:");
  console.log("- Meta Business Suite (Instagram/Facebook)");
  console.log("- YouTube Studio API (allowed)");
}

runScheduler();