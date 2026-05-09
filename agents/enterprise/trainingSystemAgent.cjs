/**
 * Training System Agent — corporate learning paths and completion tracking.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function createCourse({ tenantId, userId, title, description, department = "all", modules = [], mandatory = false, dueDate }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("trainingSystemAgent", auth.error);

    const course = {
        id:        uid("course"),
        tenantId,
        title,
        description,
        department,
        mandatory,
        dueDate:   dueDate || null,
        modules:   modules.length ? modules : [{ id: 1, title: "Introduction", duration: 30 }, { id: 2, title: "Core Content", duration: 60 }, { id: 3, title: "Assessment", duration: 20 }],
        createdBy: userId,
        createdAt: NOW()
    };

    const courses = load(tenantId, "training-courses", []);
    courses.push(course);
    flush(tenantId, "training-courses", courses);
    auditLog(tenantId, userId, "training_course_created", { title });
    return ok("trainingSystemAgent", course);
}

function enrollEmployee({ tenantId, userId, courseId, employeeId }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("trainingSystemAgent", auth.error);

    const enrollments = load(tenantId, "training-enrollments", []);
    const existing    = enrollments.find(e => e.courseId === courseId && e.employeeId === employeeId);
    if (existing) return fail("trainingSystemAgent", "Employee already enrolled");

    const enrollment = { id: uid("enroll"), tenantId, courseId, employeeId, progress: 0, status: "enrolled", enrolledAt: NOW() };
    enrollments.push(enrollment);
    flush(tenantId, "training-enrollments", enrollments.slice(-10000));
    return ok("trainingSystemAgent", enrollment);
}

function updateProgress({ tenantId, userId, enrollmentId, progress }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("trainingSystemAgent", auth.error);

    const enrollments  = load(tenantId, "training-enrollments", []);
    const enrollment   = enrollments.find(e => e.id === enrollmentId && e.employeeId === userId);
    if (!enrollment)   return fail("trainingSystemAgent", "Enrollment not found");

    enrollment.progress    = Math.min(100, progress);
    enrollment.status      = progress >= 100 ? "completed" : "in_progress";
    if (progress >= 100) enrollment.completedAt = NOW();
    flush(tenantId, "training-enrollments", enrollments);
    return ok("trainingSystemAgent", { progress: enrollment.progress, status: enrollment.status });
}

function getReport(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("trainingSystemAgent", auth.error);

    const courses     = load(tenantId, "training-courses", []);
    const enrollments = load(tenantId, "training-enrollments", []);
    const completed   = enrollments.filter(e => e.status === "completed").length;

    return ok("trainingSystemAgent", {
        tenantId,
        courses:   courses.length,
        enrolled:  enrollments.length,
        completed,
        completionRate: enrollments.length ? Math.round(completed / enrollments.length * 100) + "%" : "0%"
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_course")    return createCourse(p);
        if (task.type === "enroll_employee")  return enrollEmployee(p);
        if (task.type === "update_progress")  return updateProgress(p);
        return getReport(p.tenantId, p.userId);
    } catch (err) { return fail("trainingSystemAgent", err.message); }
}

module.exports = { createCourse, enrollEmployee, updateProgress, getReport, run };
