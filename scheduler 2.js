const fs = require("fs");

const times = ["10:00 AM", "2:00 PM", "7:00 PM"];

function schedulePosts() {
  console.log("📅 TODAY POST PLAN\n");

  times.forEach((t, i) => {
    console.log(`Post ${i + 1} → ${t}`);
  });

  console.log("\n👉 Use reels.js + video.js before each post");
}
setInterval(() => {
  console.log("⏰ Time to post content!");
}, 2 * 60 * 60 * 1000);

schedulePosts();