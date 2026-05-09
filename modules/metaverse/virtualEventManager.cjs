"use strict";
const { loadGlobal, flushGlobal, loadUser, flushUser, metaLog, uid, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");
const { createWorld } = require("./metaverseBuilder.cjs");

const AGENT = "virtualEventManager";

const EVENT_TYPES  = ["concert","conference","exhibition","networking","tournament","graduation","launch","meetup","webinar","party"];
const TICKET_TIERS = ["free","standard","vip","backstage","sponsor"];

function createEvent({ hostId, eventName, eventType, worldId, startAt, endAt, description, maxAttendees = 500, ticketTiers = [{ tier:"free", price:0, supply:500 }] }) {
    if (!hostId || !eventName || !eventType || !startAt) return fail(AGENT, "hostId, eventName, eventType, and startAt required");
    if (!EVENT_TYPES.includes(eventType)) return fail(AGENT, `eventType must be: ${EVENT_TYPES.join(", ")}`);
    if (new Date(startAt) < new Date()) return fail(AGENT, "startAt must be in the future");

    // create a world if none provided
    let assignedWorldId = worldId;
    if (!assignedWorldId) {
        const wr = createWorld({ userId:hostId, worldName:`${eventName} Venue`, worldType:"event", theme:"futuristic", maxUsers:maxAttendees+50 });
        if (!wr.success) return wr;
        assignedWorldId = wr.data.worldId;
    }

    const tiers = ticketTiers.map(t => {
        if (!TICKET_TIERS.includes(t.tier)) return null;
        return { tier:t.tier, price:typeof t.price==="number"?t.price:0, supply:t.supply||100, sold:0, currency:t.currency||"MVC" };
    }).filter(Boolean);
    if (!tiers.length) return fail(AGENT, `ticket tiers must use: ${TICKET_TIERS.join(", ")}`);

    const event = {
        eventId:     uid("ev"),
        hostId,
        eventName,
        eventType,
        worldId:     assignedWorldId,
        description: description ? String(description).slice(0,2000) : null,
        startAt,
        endAt:       endAt || null,
        maxAttendees,
        ticketTiers: tiers,
        attendees:   [],
        status:      "upcoming",
        createdAt:   NOW()
    };

    flushGlobal(`event_${event.eventId}`, event);
    const allEvents = loadGlobal("event_registry", []);
    allEvents.push({ eventId:event.eventId, eventName, eventType, startAt, status:"upcoming", hostId });
    flushGlobal("event_registry", allEvents);

    metaLog(AGENT, hostId, "event_created", { eventId:event.eventId, eventType, startAt }, "INFO");
    return ok(AGENT, event);
}

function buyTicket({ userId, eventId, tier = "free" }) {
    if (!userId || !eventId) return fail(AGENT, "userId and eventId required");
    const event = loadGlobal(`event_${eventId}`);
    if (!event) return fail(AGENT, `eventId ${eventId} not found`);
    if (event.status === "cancelled") return blocked(AGENT, "event is cancelled");
    if (event.attendees.find(a => a.userId === userId)) return blocked(AGENT, "already registered for this event");

    const tierObj = event.ticketTiers.find(t => t.tier === tier);
    if (!tierObj) return fail(AGENT, `tier ${tier} not available for this event`);
    if (tierObj.sold >= tierObj.supply) return blocked(AGENT, `${tier} tickets sold out`);

    if (tierObj.price > 0 && tierObj.currency === "MVC") {
        const wallet = loadUser(userId, "mv_wallet", { balance:1000 });
        if (wallet.balance < tierObj.price) return blocked(AGENT, `insufficient MVC (need ${tierObj.price}, have ${wallet.balance})`);
        wallet.balance = parseFloat((wallet.balance - tierObj.price).toFixed(4));
        flushUser(userId, "mv_wallet", wallet);
    }

    tierObj.sold++;
    const ticket = { ticketId:uid("tkt"), userId, eventId, tier, price:tierObj.price, currency:tierObj.currency||"MVC", issuedAt:NOW() };
    event.attendees.push({ userId, tier, ticketId:ticket.ticketId, joinedAt:NOW() });
    flushGlobal(`event_${eventId}`, event);

    const userTickets = loadUser(userId, "event_tickets", []);
    userTickets.push(ticket);
    flushUser(userId, "event_tickets", userTickets);

    metaLog(AGENT, userId, "ticket_purchased", { eventId, tier, price:tierObj.price }, "INFO");
    return ok(AGENT, ticket);
}

function updateEventStatus({ hostId, eventId, status }) {
    if (!hostId || !eventId || !status) return fail(AGENT, "hostId, eventId, and status required");
    if (!["upcoming","live","ended","cancelled"].includes(status)) return fail(AGENT, "status: upcoming|live|ended|cancelled");
    const event = loadGlobal(`event_${eventId}`);
    if (!event) return fail(AGENT, `eventId ${eventId} not found`);
    if (event.hostId !== hostId) return blocked(AGENT, "only the host can update event status");

    event.status = status;
    event.updatedAt = NOW();
    flushGlobal(`event_${eventId}`, event);

    metaLog(AGENT, hostId, "event_status_updated", { eventId, status }, "INFO");
    return ok(AGENT, { eventId, status });
}

function listEvents({ eventType, status = "upcoming", limit = 50 }) {
    let events = loadGlobal("event_registry", []);
    if (eventType) events = events.filter(e => e.eventType === eventType);
    if (status)    events = events.filter(e => e.status === status);
    return ok(AGENT, { total:events.length, events:events.slice(-limit), eventTypes:EVENT_TYPES, ticketTiers:TICKET_TIERS });
}

module.exports = { createEvent, buyTicket, updateEventStatus, listEvents };
