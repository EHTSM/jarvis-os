/**
 * Attendance Tracker — clock-in/out, leave management, and attendance reports.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const LEAVE_TYPES = ["sick","casual","earned","maternity","paternity","unpaid","comp_off"];

function clockIn({ tenantId, userId, location = "office", note = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("attendanceTracker", auth.error);

    const today   = new Date().toDateString();
    const records = load(tenantId, "attendance", []);
    const already = records.find(r => r.userId === userId && r.date === today && !r.clockOut);
    if (already) return fail("attendanceTracker", "Already clocked in today");

    const record  = { id: uid("att"), tenantId, userId, date: today, clockIn: NOW(), clockOut: null, totalHours: null, location, note, status: "present" };
    records.push(record);
    flush(tenantId, "attendance", records.slice(-50000));
    return ok("attendanceTracker", record);
}

function clockOut({ tenantId, userId }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("attendanceTracker", auth.error);

    const today   = new Date().toDateString();
    const records = load(tenantId, "attendance", []);
    const record  = records.find(r => r.userId === userId && r.date === today && !r.clockOut);
    if (!record) return fail("attendanceTracker", "No active clock-in found");

    record.clockOut    = NOW();
    record.totalHours  = +((new Date(record.clockOut) - new Date(record.clockIn)) / 3_600_000).toFixed(2);
    flush(tenantId, "attendance", records);
    return ok("attendanceTracker", record);
}

function applyLeave({ tenantId, userId, type, startDate, endDate, reason = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("attendanceTracker", auth.error);
    if (!LEAVE_TYPES.includes(type)) return fail("attendanceTracker", `Invalid leave type: ${type}`);

    const leave = { id: uid("leave"), tenantId, userId, type, startDate, endDate, reason, status: "pending", appliedAt: NOW() };
    const leaves = load(tenantId, "leaves", []);
    leaves.push(leave);
    flush(tenantId, "leaves", leaves.slice(-5000));
    auditLog(tenantId, userId, "leave_applied", { type, startDate, endDate });
    return ok("attendanceTracker", leave);
}

function getReport(tenantId, requesterId, employeeId, month = null) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("attendanceTracker", auth.error);

    const target    = employeeId || requesterId;
    const records   = load(tenantId, "attendance", []).filter(r => r.userId === target);
    const filtered  = month ? records.filter(r => r.date.includes(month)) : records.slice(-31);

    const present   = filtered.filter(r => r.status === "present").length;
    const avgHours  = filtered.length ? +(filtered.reduce((s, r) => s + (r.totalHours || 0), 0) / filtered.length).toFixed(1) : 0;

    return ok("attendanceTracker", { employeeId: target, period: month || "last 31 days", present, records: filtered.length, avgHours });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "clock_in")      return clockIn(p);
        if (task.type === "clock_out")     return clockOut(p);
        if (task.type === "apply_leave")   return applyLeave(p);
        return getReport(p.tenantId, p.userId, p.employeeId, p.month);
    } catch (err) { return fail("attendanceTracker", err.message); }
}

module.exports = { clockIn, clockOut, applyLeave, getReport, run };
