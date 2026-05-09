"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "doctorNotesAgent";

function saveNotes({ userId, doctorName, date, chiefComplaint, examination, impression, plan, nextVisit, rawNotes = "" }) {
    if (!userId || !doctorName) return fail(AGENT, "userId and doctorName required");
    accessLog(userId, AGENT, "notes_saved");

    // Parse impression from rawNotes if not structured
    const parsedImpression = impression || (rawNotes.match(/impression[:\-]\s*(.+)/i)?.[1] || "");
    const parsedPlan       = plan || (rawNotes.match(/plan[:\-]\s*(.+)/i)?.[1] || "");

    const note = {
        id:            uid("dn"),
        userId,
        doctorName,
        date:          date || NOW().slice(0, 10),
        chiefComplaint:chiefComplaint || "",
        examination:   examination || "",
        impression:    parsedImpression,
        plan:          parsedPlan,
        nextVisit:     nextVisit || "",
        rawNotes:      rawNotes.slice(0, 10000),
        createdAt:     NOW()
    };

    const notes = load(userId, "doctor_notes", []);
    notes.push(note);
    flush(userId, "doctor_notes", notes.slice(-500), true); // encrypted storage
    return ok(AGENT, { note: { ...note, rawNotes: "Stored securely" }, message: "Doctor's notes saved." });
}

function getNotes({ userId, doctorName, search, limit = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "notes_accessed", { doctorName });

    let notes = load(userId, "doctor_notes", [], true);
    if (doctorName) notes = notes.filter(n => n.doctorName.toLowerCase().includes(doctorName.toLowerCase()));
    if (search) {
        const q = search.toLowerCase();
        notes   = notes.filter(n =>
            (n.chiefComplaint || "").toLowerCase().includes(q) ||
            (n.impression     || "").toLowerCase().includes(q) ||
            (n.plan           || "").toLowerCase().includes(q)
        );
    }
    return ok(AGENT, { notes: notes.slice(-limit).reverse(), total: notes.length });
}

function summarizeVisit({ userId, noteId }) {
    if (!userId || !noteId) return fail(AGENT, "userId and noteId required");
    accessLog(userId, AGENT, "visit_summarized");

    const notes = load(userId, "doctor_notes", [], true);
    const note  = notes.find(n => n.id === noteId);
    if (!note) return fail(AGENT, "Note not found");

    const summary = [
        `Visit to Dr. ${note.doctorName} on ${note.date}`,
        note.chiefComplaint ? `Complaint: ${note.chiefComplaint}` : null,
        note.impression     ? `Assessment: ${note.impression}` : null,
        note.plan           ? `Treatment plan: ${note.plan}` : null,
        note.nextVisit      ? `Next visit: ${note.nextVisit}` : null
    ].filter(Boolean).join("\n");

    return ok(AGENT, { summary, note });
}

module.exports = { saveNotes, getNotes, summarizeVisit };
