/**
 * Team Collaboration Agent — shared tasks, assignments, and team activities.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function createTask({ tenantId, userId, title, description = "", assignedTo = [], dueDate, priority = "medium", teamId = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("teamCollaborationAgent", auth.error);
    if (!title) return fail("teamCollaborationAgent", "title required");

    const tasks = load(tenantId, "collab-tasks", []);
    const task  = { id: uid("task"), tenantId, title, description, assignedTo, dueDate, priority, teamId, status: "open", createdBy: userId, createdAt: NOW(), updatedAt: NOW() };
    tasks.push(task);
    flush(tenantId, "collab-tasks", tasks.slice(-2000));
    auditLog(tenantId, userId, "task_created", { title, assignedTo });
    return ok("teamCollaborationAgent", task);
}

function updateTask({ tenantId, userId, taskId, updates = {} }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("teamCollaborationAgent", auth.error);

    const tasks = load(tenantId, "collab-tasks", []);
    const idx   = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return fail("teamCollaborationAgent", "Task not found");

    const allowed = ["status", "priority", "dueDate", "description", "assignedTo"];
    for (const k of Object.keys(updates)) {
        if (allowed.includes(k)) tasks[idx][k] = updates[k];
    }
    tasks[idx].updatedAt = NOW();
    flush(tenantId, "collab-tasks", tasks);
    auditLog(tenantId, userId, "task_updated", { taskId, updates: Object.keys(updates) });
    return ok("teamCollaborationAgent", tasks[idx]);
}

function listTasks(tenantId, requesterId, filters = {}) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("teamCollaborationAgent", auth.error);

    let tasks = load(tenantId, "collab-tasks", []);
    if (filters.status)     tasks = tasks.filter(t => t.status === filters.status);
    if (filters.assignedTo) tasks = tasks.filter(t => t.assignedTo.includes(filters.assignedTo));
    if (filters.teamId)     tasks = tasks.filter(t => t.teamId === filters.teamId);
    if (filters.priority)   tasks = tasks.filter(t => t.priority === filters.priority);

    return ok("teamCollaborationAgent", { tasks: tasks.slice(-100), total: tasks.length });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_task")  return createTask(p);
        if (task.type === "update_task")  return updateTask(p);
        return listTasks(p.tenantId, p.userId, p.filters || {});
    } catch (err) { return fail("teamCollaborationAgent", err.message); }
}

module.exports = { createTask, updateTask, listTasks, run };
