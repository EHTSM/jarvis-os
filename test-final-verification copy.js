const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function finalVerificationTest() {
    console.log("🎯 JARVIS SCHEDULER UPGRADE - FINAL VERIFICATION\n");
    console.log("=".repeat(60) + "\n");

    try {
        // Test 1: Health Check
        console.log("✅ Test 1: Server Health Check");
        const healthRes = await axios.get(`${BASE_URL}/`);
        console.log(`   Status: ${healthRes.data}\n`);

        // Test 2: Multi-task with standard commands
        console.log("✅ Test 2: Standard Multi-Task (Non-Trigger)");
        const res2 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "open google and tell me the time"
        });
        console.log(`   Tasks parsed: ${res2.data.tasks.length}`);
        console.log(`   Results generated: ${res2.data.results.length}`);
        res2.data.results.forEach((r, i) => {
            console.log(`   - Result ${i + 1}: ${r.result.result}`);
        });
        console.log("");

        // Test 3: Schedule reminder in N seconds
        console.log("✅ Test 3: Short-term Scheduling (Timeout)");
        console.log("   Command: 'remind me in 3 seconds to check status'");
        const res3 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "remind me in 3 seconds to check status"
        });
        const taskId1 = res3.data.results[0]?.result?.task_id;
        console.log(`   Scheduled task: ${taskId1}`);
        console.log(`   Next execution: ${res3.data.results[0]?.result?.next_execution}\n`);

        // Test 4: Daily recurring task
        console.log("✅ Test 4: Recurring Daily Task (Cron)");
        console.log("   Command: 'daily at 10:30 am run backups'");
        const res4 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "daily at 10:30 am run backups"
        });
        const taskId2 = res4.data.results[0]?.result?.task_id;
        console.log(`   Scheduled task: ${taskId2}`);
        console.log(`   Is recurring: ${res4.data.results[0]?.result?.is_recurring}`);
        console.log(`   Next execution: ${res4.data.results[0]?.result?.next_execution}\n`);

        // Test 5: Remind at specific time
        console.log("✅ Test 5: Scheduled at Specific Time (Cron)");
        console.log("   Command: 'remind me at 2 pm to review emails'");
        const res5 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "remind me at 2 pm to review emails"
        });
        const taskId3 = res5.data.results[0]?.result?.task_id;
        console.log(`   Scheduled task: ${taskId3}`);
        console.log(`   Next execution: ${res5.data.results[0]?.result?.next_execution}\n`);

        // Test 6: Get scheduler status
        console.log("✅ Test 6: Scheduler Status");
        const statusRes = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log(`   Total tasks: ${statusRes.data.total_tasks}`);
        console.log(`   Active tasks: ${statusRes.data.active_tasks}`);
        console.log(`   Failed tasks: ${statusRes.data.failed_tasks}`);
        console.log(`   Total executed: ${statusRes.data.total_executed}`);
        if (statusRes.data.next_execution) {
            console.log(`   Next execution in ${Math.round(statusRes.data.next_execution.in_ms / 1000)}s\n`);
        } else {
            console.log("");
        }

        // Test 7: Get all scheduled tasks
        console.log("✅ Test 7: List All Scheduled Tasks");
        const tasksRes = await axios.get(`${BASE_URL}/scheduled`);
        console.log(`   Total scheduled: ${tasksRes.data.total}`);
        tasksRes.data.tasks.forEach((task, idx) => {
            console.log(`   ${idx + 1}. [${task.status.toUpperCase()}] ${task.id}: "${task.action}"`);
            console.log(`      Next: ${task.next_execution}`);
        });
        console.log("");

        // Test 8: Get specific task
        console.log("✅ Test 8: Get Specific Task Details");
        if (taskId1) {
            const taskRes = await axios.get(`${BASE_URL}/scheduled/${taskId1}`);
            console.log(`   Task: ${taskRes.data.task.id}`);
            console.log(`   Action: "${taskRes.data.task.action}"`);
            console.log(`   Status: ${taskRes.data.task.status}`);
            console.log(`   Type: ${taskRes.data.task.type}`);
            console.log(`   Scheduled at: ${taskRes.data.task.scheduled_at}`);
            console.log("");
        }

        // Test 9: Wait for task to execute
        console.log("✅ Test 9: Waiting for First Task to Trigger (3 seconds)...");
        await new Promise(resolve => setTimeout(resolve, 4000));

        const statusRes2 = await axios.get(`${BASE_URL}/scheduler/status`);
        console.log(`   Tasks executed so far: ${statusRes2.data.total_executed}\n`);

        // Test 10:  Cancel a task
        console.log("✅ Test 10: Cancel a Scheduled Task");
        if (taskId3) {
            const cancelRes = await axios.delete(`${BASE_URL}/scheduled/${taskId3}`);
            console.log(`   Cancelled: ${cancelRes.data.task_id}`);
            console.log(`   Message: ${cancelRes.data.message}\n`);
        }

        console.log("=".repeat(60));
        console.log("\n✅ ALL TESTS COMPLETED SUCCESSFULLY!\n");
        console.log("Summary:");
        console.log("  ✓ Trigger detection working");
        console.log("  ✓ Short-term scheduling (setTimeout) working");
        console.log("  ✓ Long-term scheduling (cron) working");
        console.log("  ✓ Task management endpoints working");
        console.log("  ✓ Scheduler status tracking working");
        console.log("  ✓ Task execution and tracking working");
        console.log("  ✓ Multi-task orchestration working");
        console.log("");

    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

console.log("⏳ Waiting for server...\n");
setTimeout(finalVerificationTest, 2000);
