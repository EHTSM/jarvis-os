/**
 * Employee Performance Agent — performance reviews, ratings, and feedback cycles.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const REVIEW_CYCLES = ["monthly","quarterly","semi_annual","annual"];
const RATING_SCALE  = { 1: "Below Expectations", 2: "Needs Improvement", 3: "Meets Expectations", 4: "Exceeds Expectations", 5: "Outstanding" };

function createReview({ tenantId, userId, employeeId, cycle = "quarterly", period, ratings = {}, feedback = "", goals = [] }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("employeePerformanceAgent", auth.error);

    const DIMENSIONS = ["quality_of_work","communication","teamwork","initiative","reliability","technical_skills"];
    const finalRatings = DIMENSIONS.reduce((m, d) => { m[d] = ratings[d] || 3; return m; }, {});
    const overall = +(Object.values(finalRatings).reduce((s, r) => s + r, 0) / Object.keys(finalRatings).length).toFixed(1);

    const review = {
        id:           uid("rev"),
        tenantId,
        employeeId,
        reviewerId:   userId,
        cycle,
        period:       period || new Date().toISOString().slice(0, 7),
        ratings:      finalRatings,
        overallRating: overall,
        overallLabel: RATING_SCALE[Math.round(overall)] || "Meets Expectations",
        feedback:     feedback.slice(0, 2000),
        goals,
        status:       "submitted",
        createdAt:    NOW()
    };

    const reviews = load(tenantId, "performance-reviews", []);
    reviews.push(review);
    flush(tenantId, "performance-reviews", reviews.slice(-5000));
    auditLog(tenantId, userId, "performance_review_created", { employeeId, overall });
    return ok("employeePerformanceAgent", review);
}

function getPerformanceHistory(tenantId, requesterId, employeeId, limit = 8) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("employeePerformanceAgent", auth.error);

    const reviews  = load(tenantId, "performance-reviews", []).filter(r => r.employeeId === employeeId);
    const avgRating = reviews.length ? +(reviews.reduce((s, r) => s + r.overallRating, 0) / reviews.length).toFixed(1) : null;
    const trend     = reviews.length >= 2 ? (reviews.at(-1).overallRating > reviews.at(-2).overallRating ? "↑ Improving" : "↓ Declining") : "Insufficient data";

    return ok("employeePerformanceAgent", {
        employeeId,
        reviews:    reviews.slice(-limit),
        avgRating,
        trend,
        totalReviews: reviews.length
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_review") return createReview(p);
        return getPerformanceHistory(p.tenantId, p.userId, p.employeeId, p.limit || 8);
    } catch (err) { return fail("employeePerformanceAgent", err.message); }
}

module.exports = { createReview, getPerformanceHistory, RATING_SCALE, run };
