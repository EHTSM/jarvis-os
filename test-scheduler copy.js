const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function testScheduler() {
    console.log("🧪 Testing Jarvis Scheduler & Self-Trigger System\n");

    try {
        // Test 1: Health check
        console.log("Test 1: Health Check");
        const healthRes = await axios.get(`${BASE_URL}/`);
        console.log("✅ Status:", healthRes.data);
        console.log("");

        // Test 2: Schedule reminder in 5 seconds
        console.log("Test 2: Schedule reminder in 5 seconds");
        console.log('Request: "remind me in 5 seconds to test scheduler"\n');
        const res1 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "remind me in 5 seconds to test scheduler"
        });
        console.log("✅ Response:");
        console.log(`   Tasks parsed: ${res1.data.tasks.length}`);
        console.log(`   Task type: ${res1.data.tasks[0]?.type}`);
        if (res1.data.results[0]?.result.scheduled) {
            console.log(`   Scheduled task ID: ${res1.data.results[0].result.task_id}`);
            console.log(`   Next execution: ${res1.data.results[0].result.next_execution}`);
        }
        console.log("");

        // Test 3: Get scheduler status
        console.log("Test 3: Get Scheduler Status");
        const statusRes = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log("✅ Scheduler Status:");
        console.log(`   Total tasks: ${statusRes.data.total_tasks}`);
        console.log(`   Active tasks: ${statusRes.data.active_tasks}`);
        console.log(`   Next execution: ${JSON.stringify(statusRes.data.next_execution, null, 2)}`);
        console.log("");

        // Test 4: Get scheduled tasks
        console.log("Test 4: Get All Scheduled Tasks");
        const tasksRes = await axios.get(`${BASE_URL}/scheduled`);
        console.log(`✅ Found ${tasksRes.data.total} scheduled task(s):`);
        tasksRes.data.tasks.forEach((task, idx) => {
            console.log(`   ${idx + 1}. ID: ${task.id}`);
            console.log(`      Action: "${task.action}"`);
            console.log(`      Type: ${task.type}`);
            console.log(`      Status: ${task.status}`);
            console.log(`      Next: ${task.next_execution}`);
        });
        console.log("");

        // Test 5: Schedule a daily task  
        console.log("Test 5: Create a daily task at specific time");
        console.log('Request: "daily at 9:30 am send me notification"\n');
        const res2 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "daily at 9:30 am send me notification"
        });
        console.log("✅ Response:");
        console.log(`   Tasks parsed: ${res2.data.tasks.length}`);
        console.log(`   Task type: ${res2.data.tasks[0]?.type}`);
        if (res2.data.results[0]?.result.scheduled) {
            console.log(`   Scheduled task ID: ${res2.data.results[0].result.task_id}`);
            console.log(`   Is recurring: ${res2.data.results[0].result.is_recurring}`);
        }
        console.log("");

        // Test 6: Get updated status
        console.log("Test 6: Check Updated Scheduler Status");
        const statusRes2 = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log("✅ Updated Scheduler Status:");
        console.log(`   Total tasks: ${statusRes2.data.total_tasks}`);
        console.log(`   Active tasks: ${statusRes2.data.active_tasks}`);
        console.log("");

        // Test 7: Wait for first reminder to trigger
        console.log("Test 7: Waiting for first reminder to trigger (5 seconds)...");
        await new Promise(resolve => setTimeout(resolve, 6000));

        const statusRes3 = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log("✅ Post-execution Status:");
        console.log(`   Total tasks: ${statusRes3.data.total_tasks}`);
        console.log(`   Active tasks: ${statusRes3.data.active_tasks}`);
        console.log(`   Total executed: ${statusRes3.data.total_executed}`);
        console.log("");

        console.log("✅ All scheduler tests completed!");

    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

// Wait for server to start
console.log("⏳ Waiting for server to start...");
setTimeout(testScheduler, 2000);
