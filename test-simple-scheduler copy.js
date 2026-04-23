const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function simpleSchedulerTest() {
    console.log("🧪 Simple Scheduler Test\n");

    try {
        // Test: Schedule a really short reminder (2 seconds)
        console.log("Step 1: Schedule reminder in 2 seconds");
        const res1 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "remind me in 2 seconds to test"
        });
        const taskId = res1.data.results[0]?.result.task_id;
        console.log(`✅ Scheduled task: ${taskId}`);
        console.log(`   Action: "${res1.data.results[0]?.result.action}"`);
        console.log("");

        // Check status before execution
        console.log("Step 2: Check status (before execution)");
        let statusRes = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log(`   Total executed so far: ${statusRes.data.total_executed}`);
        console.log("");

        // Wait for trigger
        console.log("Step 3: Wait 3 seconds for task to trigger...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log("✅ Wait complete\n");

        // Check status after execution
        console.log("Step 4: Check status (after execution)");
        statusRes = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log(`   Total tasks: ${statusRes.data.total_tasks}`);
        console.log(`   Active tasks: ${statusRes.data.active_tasks}`);
        console.log(`   Total executed: ${statusRes.data.total_executed}`);
        console.log("");

        // Get task details
        console.log("Step 5: Get task details");
        const taskRes = await axios.get(`${BASE_URL}/scheduled/${taskId}`);
        console.log(`   Task ID: ${taskRes.data.task.id}`);
        console.log(`   Status: ${taskRes.data.task.status}`);
        console.log(`   Execution count: ${taskRes.data.task.execution_count}`);
        console.log(`   Last executed: ${taskRes.data.task.last_executed}`);
        console.log("");

        console.log("✅ Test complete!");

    } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
    }
}

console.log("⏳ Starting test in 1 second...\n");
setTimeout(simpleSchedulerTest, 1000);
