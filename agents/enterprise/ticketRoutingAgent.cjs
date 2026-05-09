/**
 * Ticket Routing Agent — support ticket creation, categorization, and routing.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const TICKET_CATEGORIES = ["billing","technical","hr","legal","security","product","general"];
const PRIORITY_LEVELS   = ["low","medium","high","critical"];
const TICKET_STATUSES   = ["open","assigned","in_progress","pending_user","resolved","closed"];

const ROUTING_RULES = {
    billing:   { team: "finance",    slaHours: 24 },
    technical: { team: "engineering", slaHours: 8 },
    hr:        { team: "hr",          slaHours: 48 },
    legal:     { team: "legal",       slaHours: 72 },
    security:  { team: "security",    slaHours: 2 },
    product:   { team: "product",     slaHours: 24 },
    general:   { team: "support",     slaHours: 24 }
};

function createTicket({ tenantId, userId, title, description, category = "general", priority = "medium", attachments = [] }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("ticketRoutingAgent", auth.error);
    if (!TICKET_CATEGORIES.includes(category)) return fail("ticketRoutingAgent", `Invalid category. Use: ${TICKET_CATEGORIES.join(", ")}`);
    if (!PRIORITY_LEVELS.includes(priority))   return fail("ticketRoutingAgent", `Invalid priority. Use: ${PRIORITY_LEVELS.join(", ")}`);

    const route = ROUTING_RULES[category];
    const slaDeadline = new Date(Date.now() + route.slaHours * 3_600_000).toISOString();

    if (priority === "critical") route.slaHours = Math.max(1, Math.floor(route.slaHours / 4));

    const ticket = {
        id:          uid("tkt"),
        tenantId,
        title:       title.slice(0, 200),
        description: description.slice(0, 5000),
        category,
        priority,
        status:      "open",
        assignedTeam: route.team,
        slaHours:    route.slaHours,
        slaDeadline,
        attachments: attachments.slice(0, 10),
        comments:    [],
        submittedBy: userId,
        createdAt:   NOW()
    };

    const tickets = load(tenantId, "tickets", []);
    tickets.push(ticket);
    flush(tenantId, "tickets", tickets.slice(-10000));
    auditLog(tenantId, userId, "ticket_created", { ticketId: ticket.id, category, priority });
    return ok("ticketRoutingAgent", { ...ticket, routing: { team: route.team, slaHours: route.slaHours, slaDeadline } });
}

function updateTicket({ tenantId, userId, ticketId, status, comment = "", assignTo = null }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("ticketRoutingAgent", auth.error);
    if (status && !TICKET_STATUSES.includes(status)) return fail("ticketRoutingAgent", `Invalid status. Use: ${TICKET_STATUSES.join(", ")}`);

    const tickets = load(tenantId, "tickets", []);
    const ticket  = tickets.find(t => t.id === ticketId);
    if (!ticket) return fail("ticketRoutingAgent", "Ticket not found");

    if (status)  ticket.status     = status;
    if (assignTo) ticket.assignedTo = assignTo;
    if (comment) ticket.comments.push({ text: comment.slice(0, 1000), by: userId, at: NOW() });
    if (status === "resolved" || status === "closed") ticket.resolvedAt = NOW();
    ticket.updatedAt = NOW();

    flush(tenantId, "tickets", tickets);
    auditLog(tenantId, userId, "ticket_updated", { ticketId, status, assignTo });
    return ok("ticketRoutingAgent", ticket);
}

function getTicketQueue(tenantId, requesterId, filters = {}) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("ticketRoutingAgent", auth.error);

    let tickets = load(tenantId, "tickets", []);
    if (filters.category) tickets = tickets.filter(t => t.category === filters.category);
    if (filters.priority) tickets = tickets.filter(t => t.priority === filters.priority);
    if (filters.status)   tickets = tickets.filter(t => t.status === filters.status);
    if (filters.team)     tickets = tickets.filter(t => t.assignedTeam === filters.team);

    const open     = tickets.filter(t => t.status === "open").length;
    const critical = tickets.filter(t => t.priority === "critical" && t.status !== "closed").length;
    const overdue  = tickets.filter(t => t.slaDeadline && new Date(t.slaDeadline) < new Date() && !["resolved","closed"].includes(t.status)).length;

    return ok("ticketRoutingAgent", {
        tenantId, filters,
        summary: { total: tickets.length, open, critical, overdue },
        tickets: tickets.slice(-100).map(t => ({ id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status, assignedTeam: t.assignedTeam, createdAt: t.createdAt }))
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_ticket")  return createTicket(p);
        if (task.type === "update_ticket")  return updateTicket(p);
        return getTicketQueue(p.tenantId, p.userId, p.filters || {});
    } catch (err) { return fail("ticketRoutingAgent", err.message); }
}

module.exports = { createTicket, updateTicket, getTicketQueue, TICKET_CATEGORIES, PRIORITY_LEVELS, run };
