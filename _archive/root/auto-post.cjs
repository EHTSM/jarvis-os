const fs = require("fs");

// 🔥 load queue
function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync("queue.json"));
  } catch {
    return [];
  }
}

// 🔥 scheduler run
function runScheduler() {
  const queue = loadQueue();

  console.log("\n🚀 AUTO POST SYSTEM RUNNING\n");

  if (queue.length === 0) {
    console.log("❌ No content in queue");
    return;
  }

  queue.forEach((item, i) => {
    console.log(`📤 Post ${i + 1}:`);
    console.log(item.text);
    console.log("⏰ Time:", item.time);
    console.log("------------------------");
  });

  console.log("\n✅ Ready to post (Instagram / YouTube / etc)");
}

runScheduler();