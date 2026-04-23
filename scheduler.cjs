/**
 * scheduler: Manages scheduled tasks with timeout and cron support
 * Stores tasks in memory and executes via orchestrator
 */

const cron = require("node-cron");

let scheduledTasks = [];
let taskIdCounter = 0;
let cronJobs = {};
let timeoutHandles = {};

/**
 * Create a scheduled task
 * @param {Object} trigger - Trigger object from triggerAgent
 * @param {Function} executeCallback - Callback to execute task (orchestrator)
 * @returns {Object} Scheduled task with ID
 */
function scheduleTask(trigger, executeCallback) {
    const taskId = `task_${++taskIdCounter}`;
    const scheduledAt = new Date().toISOString();

    // Create task entry
    const task = {
        id: taskId,
        trigger_type: trigger.type,
        action: trigger.action,
        time: trigger.time,
        cron_time: trigger.cron_time,
        scheduled_at: scheduledAt,
        status: "active",
        is_recurring: trigger.is_recurring || false,
        execution_count: 0,
        last_executed: null,
        next_execution: calculateNextExecution(trigger)
    };

    // Store in memory
    scheduledTasks.push(task);

    // Schedule execution
    if (trigger.trigger_type === "timeout") {
        scheduleTimeout(taskId, trigger.delay_ms, trigger.action, executeCallback, task);
    } else if (trigger.trigger_type === "cron") {
        scheduleCron(taskId, trigger.cron_time, trigger.action, executeCallback, task);
    }

    console.log(`✅ Task scheduled: ${taskId} - "${trigger.action}" (${task.next_execution})`);

    return {
        success: true,
        task_id: taskId,
        message: `Task scheduled: ${trigger.action}`,
        next_execution: task.next_execution
    };
}

/**
 * Schedule using setTimeout (for short-term delays)
 */
function scheduleTimeout(taskId, delayMs, action, executeCallback, task) {
    const handle = setTimeout(async () => {
        await executeTask(taskId, action, executeCallback, task);
    }, delayMs);

    timeoutHandles[taskId] = handle;
}

/**
 * Schedule using cron (for recurring or specific times)
 */
function scheduleCron(taskId, cronTime, action, executeCallback, task) {
    const job = cron.schedule(cronTime, () => {
        executeTask(taskId, action, executeCallback, task);
    });

    cronJobs[taskId] = job;
}

/**
 * Execute a scheduled task
 */
async function executeTask(taskId, action, executeCallback, task) {
    try {
        console.log(`⏱️  Task triggered: ${taskId} - "${action}"`);

        // Update task stats
        const taskEntry = scheduledTasks.find(t => t.id === taskId);
        if (taskEntry) {
            taskEntry.execution_count++;
            taskEntry.last_executed = new Date().toISOString();
            taskEntry.next_execution = calculateNextExecution({
                cron_time: task.cron_time,
                is_recurring: task.is_recurring
            });
            console.log(`   ✅ Task ${taskId} execution count: ${taskEntry.execution_count}`);
        }

        // Execute via orchestrator callback
        if (executeCallback && typeof executeCallback === "function") {
            await executeCallback(action);
            console.log(`✅ Task executed successfully: ${taskId}`);
        } else {
            console.log(`⚠️  No callback available for task: ${taskId}`);
        }
    } catch (error) {
        console.error(`❌ Task execution failed (${taskId}):`, error.message);
        const taskEntry = scheduledTasks.find(t => t.id === taskId);
        if (taskEntry) {
            taskEntry.status = "failed";
            taskEntry.error = error.message;
        }
    }
}

/**
 * Calculate next execution time
 */
function calculateNextExecution(trigger) {
    if (trigger.delay_ms) {
        const nextTime = new Date(Date.now() + trigger.delay_ms);
        return nextTime.toISOString();
    }

    if (trigger.cron_time && trigger.is_recurring) {
        // For cron jobs, just return the time pattern
        return `Daily at ${trigger.cron_time.split(" ")[1]}:${trigger.cron_time.split(" ")[0]}`;
    }

    if (trigger.cron_time) {
        const now = new Date();
        const timeStr = trigger.time;
        const [hours, minutes] = timeStr.split(":").map(Number);

        const next = new Date();
        next.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for tomorrow
        if (next < now) {
            next.setDate(next.getDate() + 1);
        }

        return next.toISOString();
    }

    return "Unknown";
}

/**
 * Get all scheduled tasks
 */
function getScheduledTasks() {
    return scheduledTasks.map(task => ({
        id: task.id,
        action: task.action,
        type: task.trigger_type,
        status: task.status,
        scheduled_at: task.scheduled_at,
        next_execution: task.next_execution,
        execution_count: task.execution_count,
        last_executed: task.last_executed,
        is_recurring: task.is_recurring
    }));
}

/**
 * Cancel a scheduled task
 */
function cancelTask(taskId) {
    // Clear timeout if exists
    if (timeoutHandles[taskId]) {
        clearTimeout(timeoutHandles[taskId]);
        delete timeoutHandles[taskId];
    }

    // Stop cron job if exists
    if (cronJobs[taskId]) {
        cronJobs[taskId].stop();
        delete cronJobs[taskId];
    }

    // Mark as cancelled in memory
    const task = scheduledTasks.find(t => t.id === taskId);
    if (task) {
        task.status = "cancelled";
        console.log(`❌ Task cancelled: ${taskId} - "${task.action}"`);
    }

    return {
        success: true,
        message: `Task ${taskId} cancelled`,
        task_id: taskId
    };
}

/**
 * Get task by ID
 */
function getTask(taskId) {
    return scheduledTasks.find(t => t.id === taskId);
}

/**
 * Clear all scheduled tasks
 */
function clearAllTasks() {
    // Clear all timeouts
    Object.values(timeoutHandles).forEach(handle => clearTimeout(handle));
    timeoutHandles = {};

    // Stop all cron jobs
    Object.values(cronJobs).forEach(job => job.stop());
    cronJobs = {};

    // Clear from memory
    const count = scheduledTasks.length;
    scheduledTasks = [];

    console.log(`🗑️  Cleared ${count} scheduled tasks`);

    return {
        success: true,
        cleared_count: count,
        message: "All scheduled tasks cleared"
    };
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
    return {
        total_tasks: scheduledTasks.length,
        active_tasks: scheduledTasks.filter(t => t.status === "active").length,
        failed_tasks: scheduledTasks.filter(t => t.status === "failed").length,
        cancelled_tasks: scheduledTasks.filter(t => t.status === "cancelled").length,
        total_executed: scheduledTasks.reduce((sum, t) => sum + t.execution_count, 0),
        next_execution: getNextExecution()
    };
}

/**
 * Get next task to execute
 */
function getNextExecution() {
    const activeTasks = scheduledTasks.filter(t => t.status === "active");
    if (activeTasks.length === 0) return null;

    const sorted = activeTasks.sort((a, b) => {
        const aTime = new Date(a.next_execution).getTime();
        const bTime = new Date(b.next_execution).getTime();
        return aTime - bTime;
    });

    const next = sorted[0];
    return {
        task_id: next.id,
        action: next.action,
        when: next.next_execution,
        in_ms: new Date(next.next_execution).getTime() - Date.now()
    };
}

module.exports = {
    scheduleTask,
    cancelTask,
    getScheduledTasks,
    getTask,
    clearAllTasks,
    getSchedulerStatus,
    getNextExecution
};
