const hooks = [
  "₹500 रोज कमाने का तरीका",
  "Phone से income start करो",
  "AI से पैसा कमाना शुरू करो",
  "0 skill से earning कैसे करें",
  "Daily ₹2000 possible है?"
];

const bodies = [
  "बस 1 system चाहिए",
  "मैंने test किया है",
  "लोग already use कर रहे हैं",
  "simple setup है",
  "कोई coding नहीं चाहिए"
];

const cta = [
  "Reply START",
  "Link bio में है",
  "WhatsApp करो",
  "आज ही शुरू करो",
  "Limited slots"
];

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateReels(n = 5) {
  for (let i = 0; i < n; i++) {
    console.log(`
🎬 Reel ${i + 1}

Hook: ${random(hooks)}
Body: ${random(bodies)}
CTA: ${random(cta)}
    `);
  }
}

generateReels();