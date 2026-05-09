"use strict";
const { loadGlobal, flushGlobal, loadUser, flushUser, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");
const { createWorld } = require("./metaverseBuilder.cjs");

const AGENT = "virtualClassroom";

const ROOM_MODES   = ["lecture","seminar","lab","workshop","exam","open_discussion"];
const MEDIA_TYPES  = ["slide_deck","video","whiteboard","3d_model","quiz","document"];
const SEAT_LAYOUTS = ["theater","roundtable","u_shape","lab_benches","open_floor"];

function createClassroom({ userId, className, subject, maxStudents = 30, roomMode = "lecture", seatLayout = "theater" }) {
    if (!userId || !className || !subject) return fail(AGENT, "userId, className, and subject required");
    if (!ROOM_MODES.includes(roomMode))     return fail(AGENT, `roomMode must be: ${ROOM_MODES.join(", ")}`);
    if (!SEAT_LAYOUTS.includes(seatLayout)) return fail(AGENT, `seatLayout must be: ${SEAT_LAYOUTS.join(", ")}`);

    const worldResult = createWorld({ userId, worldName: className, worldType:"classroom", theme:"corporate", maxUsers: maxStudents + 5, physics:"standard" });
    if (!worldResult.success) return worldResult;

    const classroom = {
        classroomId:  uid("cls"),
        worldId:      worldResult.data.worldId,
        className,
        subject,
        instructorId: userId,
        maxStudents,
        roomMode,
        seatLayout,
        roster:       [],
        sessions:     [],
        materials:    [],
        createdAt:    NOW()
    };

    flushGlobal(`classroom_${classroom.classroomId}`, classroom);
    metaLog(AGENT, userId, "classroom_created", { classroomId: classroom.classroomId, subject }, "INFO");
    return ok(AGENT, classroom);
}

function enrollStudent({ classroomId, studentId, displayName }) {
    if (!classroomId || !studentId || !displayName) return fail(AGENT, "classroomId, studentId, and displayName required");
    const room = loadGlobal(`classroom_${classroomId}`);
    if (!room) return fail(AGENT, `classroomId ${classroomId} not found`);
    if (room.roster.length >= room.maxStudents) return fail(AGENT, "classroom is full");
    if (room.roster.find(s => s.studentId === studentId)) return fail(AGENT, "student already enrolled");

    room.roster.push({ studentId, displayName, enrolledAt: NOW(), attendance: 0, grade: null });
    flushGlobal(`classroom_${classroomId}`, room);

    metaLog(AGENT, studentId, "student_enrolled", { classroomId }, "INFO");
    return ok(AGENT, { enrolled: studentId, classroomId, totalStudents: room.roster.length });
}

function startSession({ classroomId, instructorId, sessionTitle, mediaType = "slide_deck", mediaUrl }) {
    if (!classroomId || !instructorId || !sessionTitle) return fail(AGENT, "classroomId, instructorId, and sessionTitle required");
    if (!MEDIA_TYPES.includes(mediaType)) return fail(AGENT, `mediaType must be: ${MEDIA_TYPES.join(", ")}`);
    const room = loadGlobal(`classroom_${classroomId}`);
    if (!room) return fail(AGENT, `classroomId ${classroomId} not found`);
    if (room.instructorId !== instructorId) return fail(AGENT, "only the instructor can start a session");

    const session = { id:uid("ses"), sessionTitle, mediaType, mediaUrl: mediaUrl||null, startedAt:NOW(), endedAt:null, attendees:[] };
    room.sessions.push(session);
    flushGlobal(`classroom_${classroomId}`, room);

    metaLog(AGENT, instructorId, "session_started", { classroomId, sessionTitle, mediaType }, "INFO");
    return ok(AGENT, session);
}

function submitAssignment({ classroomId, studentId, sessionId, content }) {
    if (!classroomId || !studentId || !sessionId || !content) return fail(AGENT, "all fields required");
    const room = loadGlobal(`classroom_${classroomId}`);
    if (!room) return fail(AGENT, `classroomId ${classroomId} not found`);
    if (!room.roster.find(s => s.studentId === studentId)) return fail(AGENT, "student not enrolled");

    const submission = { id:uid("sub"), studentId, sessionId, content:String(content).slice(0,5000), submittedAt:NOW(), grade:null };
    const submissions = loadUser(studentId, `submissions_${classroomId}`, []);
    submissions.push(submission);
    flushUser(studentId, `submissions_${classroomId}`, submissions);

    metaLog(AGENT, studentId, "assignment_submitted", { classroomId, sessionId }, "INFO");
    return ok(AGENT, submission);
}

function getClassroomState({ classroomId }) {
    if (!classroomId) return fail(AGENT, "classroomId required");
    const room = loadGlobal(`classroom_${classroomId}`);
    if (!room) return fail(AGENT, `classroomId ${classroomId} not found`);
    return ok(AGENT, { ...room, roomModes: ROOM_MODES, mediaTypes: MEDIA_TYPES });
}

module.exports = { createClassroom, enrollStudent, startSession, submitAssignment, getClassroomState };
