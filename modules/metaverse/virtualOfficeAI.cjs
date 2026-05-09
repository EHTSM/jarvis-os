"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");
const { createWorld } = require("./metaverseBuilder.cjs");

const AGENT = "virtualOfficeAI";

const ROOM_TYPES   = ["open_floor","meeting_room","private_office","lounge","reception","server_room","conference_hall"];
const DESK_TOOLS   = ["whiteboard","screen_share","file_browser","calendar","terminal","camera"];
const STATUS_FLAGS = ["available","busy","in_meeting","away","do_not_disturb","offline"];

function createOffice({ userId, officeName, teamSize = 10, rooms = ["open_floor","meeting_room"], tools = ["whiteboard","screen_share"] }) {
    if (!userId || !officeName) return fail(AGENT, "userId and officeName required");
    const invalidRooms = rooms.filter(r => !ROOM_TYPES.includes(r));
    if (invalidRooms.length) return fail(AGENT, `invalid rooms: ${invalidRooms.join(",")}. Valid: ${ROOM_TYPES.join(", ")}`);
    const invalidTools = tools.filter(t => !DESK_TOOLS.includes(t));
    if (invalidTools.length) return fail(AGENT, `invalid tools: ${invalidTools.join(",")}. Valid: ${DESK_TOOLS.join(", ")}`);

    const worldResult = createWorld({ userId, worldName: officeName, worldType:"office", theme:"corporate", maxUsers: teamSize + 10, physics:"standard" });
    if (!worldResult.success) return worldResult;

    const office = {
        officeId:  uid("off"),
        worldId:   worldResult.data.worldId,
        officeName,
        ownerId:   userId,
        teamSize,
        rooms:     rooms.map(r => ({ roomId: uid("room"), type:r, capacity: r==="conference_hall"?teamSize:Math.min(teamSize,10), tools, occupants:[] })),
        announcements: [],
        createdAt: NOW()
    };

    flushGlobal(`office_${office.officeId}`, office);
    metaLog(AGENT, userId, "office_created", { officeId: office.officeId, worldId: office.worldId }, "INFO");
    return ok(AGENT, office);
}

function setPresenceStatus({ userId, officeId, status, roomId }) {
    if (!userId || !officeId) return fail(AGENT, "userId and officeId required");
    if (!STATUS_FLAGS.includes(status)) return fail(AGENT, `status must be: ${STATUS_FLAGS.join(", ")}`);

    const office = loadGlobal(`office_${officeId}`);
    if (!office) return fail(AGENT, `officeId ${officeId} not found`);

    const presence = loadUser(userId, `presence_${officeId}`, {});
    presence.userId = userId;
    presence.officeId = officeId;
    presence.status = status;
    presence.roomId = roomId || null;
    presence.updatedAt = NOW();
    flushUser(userId, `presence_${officeId}`, presence);

    metaLog(AGENT, userId, "presence_updated", { officeId, status, roomId }, "INFO");
    return ok(AGENT, presence);
}

function postAnnouncement({ userId, officeId, message, priority = "normal" }) {
    if (!userId || !officeId || !message) return fail(AGENT, "userId, officeId, and message required");
    if (!["low","normal","high","urgent"].includes(priority)) return fail(AGENT, "priority: low|normal|high|urgent");

    const office = loadGlobal(`office_${officeId}`);
    if (!office) return fail(AGENT, `officeId ${officeId} not found`);
    if (office.ownerId !== userId) return fail(AGENT, "only the office owner can post announcements");

    const ann = { id:uid("ann"), userId, message:String(message).slice(0,500), priority, postedAt:NOW() };
    office.announcements.push(ann);
    office.announcements = office.announcements.slice(-100);
    flushGlobal(`office_${officeId}`, office);

    metaLog(AGENT, userId, "announcement_posted", { officeId, priority }, "INFO");
    return ok(AGENT, ann);
}

function getOfficeState({ officeId }) {
    if (!officeId) return fail(AGENT, "officeId required");
    const office = loadGlobal(`office_${officeId}`);
    if (!office) return fail(AGENT, `officeId ${officeId} not found`);
    return ok(AGENT, { ...office, roomTypes: ROOM_TYPES, deskTools: DESK_TOOLS, statusFlags: STATUS_FLAGS });
}

module.exports = { createOffice, setPresenceStatus, postAnnouncement, getOfficeState };
