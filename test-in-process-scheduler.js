const { orchestrator } = require("./orchestrator");
const { getSchedulerStatus, getScheduledTasks } = require("./scheduler");

async function testSchedulerExecution() {
    console.log("🧪 Testing Scheduler Execution (In-Process)\n");

    console.log("Step 1: Schedule a task");
    const result1 = await orchestrator("remind me in 2 seconds to test scheduler");
    const taskId = result1.results[0]?.result?.task_id;
    console.log(`✅ Scheduled task: ${taskId}\n`);

    console.log("Step 2: Check status immediately");
    let status = getSchedulerStatus();
    console.log(`   Total tasks: ${status.total_tasks}`);
    console.log(`   Active tasks: ${status.active_tasks}`);
    console.log(`   Total executed: ${status.total_executed}\n`);

    console.log("Step 3: Wait 3 seconds for task to trigger...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("✅ Wait complete\n");

    console.log("Step 4: Check status after trigger");
    status = getSchedulerStatus();
    console.log(`   Total tasks: ${status.total_tasks}`);
    console.log(`   Active tasks: ${status.active_tasks}`);
    console.log(`   Total executed: ${status.total_executed}\n`);

    console.log("Step 5: Get task details");
    const tasks = getScheduledTasks();
    if (tasks.length > 0) {
        console.log(`   Task ID: ${tasks[0].id}`);
        console.log(`   Status: ${tasks[0].status}`);
        console.log(`   Execution count: ${tasks[0].execution_count}`);
        console.log(`   Last executed: ${tasks[0].last_executed}`);
    } else {
        console.log("   No tasks found");
    }
}

testSchedulerExecution().catch(console.error);
