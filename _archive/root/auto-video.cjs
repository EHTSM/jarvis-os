const fs = require("fs");

const hooks = [
  "₹500 रोज कमाने का तरीका",
  "Phone से income start करो",
  "AI से पैसा कमाना शुरू करो"
];

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateVideo() {
  const script = `${random(hooks)} — बिना skill, आज ही start करो`;

  const output = `
🎬 VIDEO READY

Text:
${script}

Voice:
Use TTS (ElevenLabs / Google TTS)

Visual:
Use CapCut template (money / phone clips)

Captions:
🔥 Earn ₹500–₹2000/day
Reply START
`;

  console.log(output);

  fs.writeFileSync("video-plan.txt", output);
}

generateVideo();