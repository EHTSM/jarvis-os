import { generateReel } from "./contentEngine.js";

function run() {
    const reel = generateReel();

    console.log("🔥 HOOK:");
    console.log(reel.hook);

    console.log("\n📄 CAPTION:");
    console.log(reel.caption);
}

run();