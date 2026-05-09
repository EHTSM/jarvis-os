const { generateReel } = require("./contentEngine.cjs");

function run() {
    const reel = generateReel();
    console.log("🔥 HOOK:", reel.hook);
    console.log("\n📄 CAPTION:", reel.caption);
}

module.exports = { run };
