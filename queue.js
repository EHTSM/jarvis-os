const fs = require("fs");

function addToQueue(text) {
  let data = [];

  try {
    data = JSON.parse(fs.readFileSync("queue.json"));
  } catch {}

  data.push({
    text,
    time: new Date().toISOString()
  });

  fs.writeFileSync("queue.json", JSON.stringify(data, null, 2));
  console.log("✅ Added to queue");
}

// example
addToQueue("₹500 रोज कमाने का तरीका — Reply START");