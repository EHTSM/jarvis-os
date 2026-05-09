/**
 * Event Planner Agent — plan personal events and tasks with checklists.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const STORE = "event-log";

const CHECKLISTS = {
    birthday: [
        "Set date and venue", "Create guest list", "Send invitations (2 weeks before)", "Order cake",
        "Plan decorations", "Arrange food/catering", "Plan activities/games", "Buy gifts/favors",
        "Confirm RSVPs", "Day-of: setup 2hrs early"
    ],
    wedding:  [
        "Set budget", "Fix date and venue", "Book photographer", "Send invitations (4-6 weeks)",
        "Arrange catering", "Wedding attire shopping", "Decoration planning", "Book band/DJ",
        "Honeymoon planning", "Final confirmations 1 week before"
    ],
    meeting:  [
        "Define agenda", "Book venue/video link", "Send invites with agenda", "Prepare materials",
        "Confirm attendance", "Set up AV equipment", "Prepare notes template", "Follow up with minutes"
    ],
    trip:     [
        "Choose destination", "Check visas/documents", "Book accommodation", "Book transport",
        "Plan itinerary", "Pack essentials", "Inform bank of travel", "Download offline maps", "Confirm bookings"
    ],
    general:  [
        "Define event goal", "Set date and time", "Choose venue", "Create guest/participant list",
        "Send invitations", "Arrange logistics", "Confirm arrangements", "Day-of coordination", "Follow up after"
    ]
};

function createEvent({ userId = "default", title, eventType = "general", date, location = "", guests = 0, budget = 0, notes = "" }) {
    if (!title) throw new Error("event title required");

    const checklist = (CHECKLISTS[eventType] || CHECKLISTS.general).map((task, i) => ({
        id:        i + 1,
        task,
        done:      false,
        dueOffset: `T-${Math.max(1, CHECKLISTS[eventType].length - i)} days`
    }));

    const event = {
        id:        uid("event"),
        userId,
        title,
        eventType,
        date:      date || "TBD",
        location,
        guests,
        budget,
        notes,
        checklist,
        progress:  "0%",
        status:    "planning",
        createdAt: NOW(),
        updatedAt: NOW()
    };

    const all = load(STORE, {});
    if (!all[userId]) all[userId] = [];
    all[userId].push(event);
    flush(STORE, all);
    logToMemory("eventPlannerAgent", `${userId}:${eventType}`, { title, date });
    return event;
}

function updateChecklist({ userId = "default", eventId, taskId, done = true }) {
    const all   = load(STORE, {});
    const event = (all[userId] || []).find(e => e.id === eventId);
    if (!event) throw new Error("event not found");

    const task = event.checklist.find(t => t.id === taskId);
    if (task) task.done = done;

    const completedCount = event.checklist.filter(t => t.done).length;
    event.progress       = Math.round((completedCount / event.checklist.length) * 100) + "%";
    event.status         = completedCount === event.checklist.length ? "ready" : "planning";
    event.updatedAt      = NOW();

    flush(STORE, all);
    return { event, completedCount, total: event.checklist.length, progress: event.progress };
}

function getEvents(userId = "default") {
    const all    = load(STORE, {});
    const events = all[userId] || [];
    return { userId, events, total: events.length, upcoming: events.filter(e => e.status !== "completed").length };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "event_list") {
            data = getEvents(p.userId || "default");
        } else if (task.type === "update_event_checklist") {
            data = updateChecklist({ userId: p.userId || "default", eventId: p.eventId, taskId: p.taskId, done: p.done !== undefined ? p.done : true });
        } else {
            data = createEvent({ userId: p.userId || "default", title: p.title, eventType: p.eventType || p.type || "general", date: p.date, location: p.location || "", guests: p.guests || 0, budget: p.budget || 0, notes: p.notes || "" });
        }
        return ok("eventPlannerAgent", data, ["Start planning 4x longer than you think you need", "Delegate aggressively for large events"]);
    } catch (err) { return fail("eventPlannerAgent", err.message); }
}

module.exports = { createEvent, updateChecklist, getEvents, CHECKLISTS, run };
