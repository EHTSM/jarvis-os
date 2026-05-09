/**
 * Smart Reminder Agent — schedule and retrieve reminders. Uses shared scheduler.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const STORE = "reminder-log";

const RECURRENCE = ["once", "daily", "weekly", "monthly"];

const PRIORITY_WEIGHTS = { high: 3, medium: 2, low: 1 };

function setReminder({ userId = "default", title, description = "", dateTime, recurrence = "once", priority = "medium", category = "personal" }) {
    if (!title)    throw new Error("reminder title required");
    if (!dateTime) throw new Error("dateTime required (ISO or 'YYYY-MM-DD HH:mm')");

    const dueAt  = new Date(dateTime);
    if (isNaN(dueAt.getTime())) throw new Error("invalid dateTime");

    const reminder = {
        id:          uid("rem"),
        userId,
        title,
        description,
        dueAt:       dueAt.toISOString(),
        recurrence,
        priority,
        category,
        weight:      PRIORITY_WEIGHTS[priority] || 2,
        status:      "pending",
        notified:    false,
        createdAt:   NOW()
    };

    const all = load(STORE, {});
    if (!all[userId]) all[userId] = [];
    all[userId].push(reminder);
    flush(STORE, all);
    logToMemory("smartReminderAgent", `${userId}:set`, { title, dueAt: reminder.dueAt, recurrence });
    return reminder;
}

function getReminders(userId = "default", filter = "pending") {
    const all  = load(STORE, {});
    let   rems = all[userId] || [];

    const now  = Date.now();
    // auto-mark overdue
    for (const r of rems) {
        if (r.status === "pending" && new Date(r.dueAt).getTime() < now) r.status = "overdue";
    }
    flush(STORE, all);

    if (filter !== "all") rems = rems.filter(r => r.status === filter);

    // sort by priority then time
    rems.sort((a, b) => b.weight - a.weight || new Date(a.dueAt) - new Date(b.dueAt));

    const overdue  = rems.filter(r => r.status === "overdue").length;
    const upcoming = rems.filter(r => r.status === "pending" && new Date(r.dueAt).getTime() < now + 86_400_000).length;

    return {
        userId,
        reminders: rems,
        total:     rems.length,
        overdue,
        upcoming,
        suggestions: overdue ? [`⚠️ You have ${overdue} overdue reminder(s). Act now or reschedule.`] : []
    };
}

function completeReminder({ userId = "default", reminderId }) {
    const all = load(STORE, {});
    const rem = (all[userId] || []).find(r => r.id === reminderId);
    if (!rem) throw new Error("reminder not found");

    rem.status       = "completed";
    rem.completedAt  = NOW();

    if (rem.recurrence !== "once") {
        const next  = new Date(rem.dueAt);
        if (rem.recurrence === "daily")   next.setDate(next.getDate() + 1);
        if (rem.recurrence === "weekly")  next.setDate(next.getDate() + 7);
        if (rem.recurrence === "monthly") next.setMonth(next.getMonth() + 1);

        const newRem = { ...rem, id: uid("rem"), dueAt: next.toISOString(), status: "pending", notified: false, completedAt: undefined, createdAt: NOW() };
        all[userId].push(newRem);
    }

    flush(STORE, all);
    return { completed: rem, nextScheduled: rem.recurrence !== "once" ? "Next occurrence scheduled." : null };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "get_reminders") {
            data = getReminders(p.userId || "default", p.filter || "pending");
        } else if (task.type === "complete_reminder") {
            data = completeReminder({ userId: p.userId || "default", reminderId: p.reminderId });
        } else {
            data = setReminder({ userId: p.userId || "default", title: p.title, description: p.description || "", dateTime: p.dateTime || p.time, recurrence: p.recurrence || "once", priority: p.priority || "medium", category: p.category || "personal" });
        }
        return ok("smartReminderAgent", data, ["Set reminders 30 min early — give yourself buffer", "Weekly review clears mental overhead"]);
    } catch (err) { return fail("smartReminderAgent", err.message); }
}

module.exports = { setReminder, getReminders, completeReminder, RECURRENCE, run };
