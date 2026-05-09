const { learningSystem } = require("../learning/learningSystem.cjs");
const { moneyEngine } = require("../money/moneyEngine.cjs");
const executorAgent = require("../executor.cjs");
const cron = require("node-cron");
const axios = require("axios");
let isRunning = false;


async function autoLoop() {

    if (isRunning) return;
    isRunning = true;

    console.log("🤖 Auto Money Loop Started...");

    setInterval(async () => {
        try {

            const fs = require("fs");

const raw = fs.readFileSync("leads.json", "utf-8")
    .split("\n")
    .filter(Boolean);

if (raw.length === 0) {
    console.log("⚠️ No leads found");
    return;
}

const randomLead = JSON.parse(
    raw[Math.floor(Math.random() * raw.length)]
);

const randomIntent = `follow up ${randomLead.phone}`;

            const randomIntent = intents[Math.floor(Math.random() * intents.length)];

            console.log("💡 Generated Intent:", randomIntent);

            const moneyIntent = await moneyEngine(randomIntent);

            if (moneyIntent) {

                console.log("💰 Triggering:", moneyIntent);

                // ✅ learning FIX (ab sahi jagah pe)
                learningSystem.learnMoneyPattern(randomIntent, moneyIntent);

                await executorAgent.executorAgent({
                    type: moneyIntent.action
                });
            }

        } catch (err) {
            console.error("❌ AutoLoop error:", err.message);
        }

    }, 15000);
}

module.exports = { autoLoop };