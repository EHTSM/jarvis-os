const fs = require("fs");

const scripts = [
  "₹500 रोज कमाने का तरीका, बस phone चाहिए",
  "AI से daily income start करो, बिना skill",
  "लोग ₹2000/day earn कर रहे हैं, तुम कब start करोगे?"
];

function generateScript() {
  return scripts[Math.floor(Math.random() * scripts.length)];
}

function createVideoPlan() {
  const script = generateScript();

  console.log(`
🎬 VIDEO PLAN

Text: ${script}

Voice: Use any TTS (ElevenLabs / Google)
Background: Stock video (money / phone / laptop)
Duration: 8–12 sec

Caption:
🔥 Earn ₹500–₹2000/day
Link in bio
  `);
}

createVideoPlan();