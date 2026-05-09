"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "appointmentBookingAgent";

const APPOINTMENT_TYPES  = ["general_checkup","specialist_consultation","follow_up","lab_test","vaccination","physiotherapy","mental_health","emergency_followup"];
const APPOINTMENT_STATUS = ["scheduled","confirmed","completed","cancelled","rescheduled","no_show"];

function bookAppointment({ userId, doctorName, specialization, date, time, type = "general_checkup", location, isOnline = false, notes = "" }) {
    if (!userId)     return fail(AGENT, "userId required");
    if (!doctorName) return fail(AGENT, "doctorName required");
    if (!date)       return fail(AGENT, "date required (YYYY-MM-DD)");
    if (!time)       return fail(AGENT, "time required (HH:MM)");

    if (!APPOINTMENT_TYPES.includes(type))
        return fail(AGENT, `Invalid type. Use: ${APPOINTMENT_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "appointment_booked", { doctorName, date });

    const appt = {
        id:             uid("appt"),
        userId,
        doctorName,
        specialization: specialization || "General Practitioner",
        date,
        time,
        type,
        status:         "scheduled",
        location:       isOnline ? "Online Telemedicine" : (location || "To be confirmed"),
        isOnline,
        notes,
        reminders:      [
            { at: "24h_before",  sent: false },
            { at: "1h_before",   sent: false }
        ],
        createdAt: NOW()
    };

    const appts = load(userId, "appointments", []);
    appts.push(appt);
    flush(userId, "appointments", appts.slice(-500));

    return ok(AGENT, {
        appointment: appt,
        confirmationId: appt.id,
        reminder: "You will be reminded 24 hours and 1 hour before your appointment.",
        tip: "Bring your medical records, insurance card, and a list of current medications."
    });
}

function updateAppointment({ userId, appointmentId, status, rescheduledDate, rescheduledTime, notes }) {
    if (!userId || !appointmentId) return fail(AGENT, "userId and appointmentId required");
    if (status && !APPOINTMENT_STATUS.includes(status))
        return fail(AGENT, `Invalid status. Use: ${APPOINTMENT_STATUS.join(", ")}`);

    accessLog(userId, AGENT, "appointment_updated", { appointmentId, status });

    const appts = load(userId, "appointments", []);
    const idx   = appts.findIndex(a => a.id === appointmentId);
    if (idx === -1) return fail(AGENT, "Appointment not found");

    if (status)           appts[idx].status = status;
    if (rescheduledDate)  { appts[idx].date = rescheduledDate; appts[idx].status = "rescheduled"; }
    if (rescheduledTime)  appts[idx].time = rescheduledTime;
    if (notes)            appts[idx].notes = notes;
    appts[idx].updatedAt = NOW();
    flush(userId, "appointments", appts);
    return ok(AGENT, appts[idx]);
}

function getAppointments({ userId, status, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "appointments_viewed");
    let appts = load(userId, "appointments", []);
    if (status) appts = appts.filter(a => a.status === status);
    return ok(AGENT, {
        appointments: appts.slice(-limit).reverse(),
        total:        appts.length
    });
}

function cancelAppointment({ userId, appointmentId, reason = "" }) {
    return updateAppointment({ userId, appointmentId, status: "cancelled", notes: reason ? `Cancelled: ${reason}` : undefined });
}

module.exports = { bookAppointment, updateAppointment, getAppointments, cancelAppointment };
