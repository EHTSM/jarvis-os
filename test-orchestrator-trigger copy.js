const { orchestrator } = require("./orchestrator");

async function testOrchestrator() {
    console.log("🧪 Testing Orchestrator with Trigger\n");

    console.log("Test: 'remind me in 3 seconds hello world'");
    const result = await orchestrator("remind me in 3 seconds hello world");

    console.log("\nResults:");
    console.log(JSON.stringify(result, null, 2));
}

testOrchestrator().catch(console.error);
