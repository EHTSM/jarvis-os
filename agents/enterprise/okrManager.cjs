/**
 * OKR Manager — Objectives and Key Results tracking with progress scoring.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const OKR_CYCLES = ["Q1","Q2","Q3","Q4","annual"];
const KR_STATUSES = ["not_started","in_progress","at_risk","completed"];

function createObjective({ tenantId, userId, title, description, cycle, year, owner, keyResults = [] }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("okrManager", auth.error);
    if (!OKR_CYCLES.includes(cycle)) return fail("okrManager", `Invalid cycle. Use: ${OKR_CYCLES.join(", ")}`);

    const defaultKRs = keyResults.length ? keyResults : [
        { title: "Key Result 1", target: 100, unit: "%", current: 0 },
        { title: "Key Result 2", target: 100, unit: "%", current: 0 }
    ];

    const objective = {
        id:          uid("okr"),
        tenantId,
        title,
        description: description || "",
        cycle,
        year:        year || new Date().getFullYear(),
        owner:       owner || userId,
        progress:    0,
        status:      "not_started",
        keyResults:  defaultKRs.map((kr, i) => ({
            id:      `${uid("kr")}-${i}`,
            title:   kr.title,
            target:  kr.target || 100,
            current: kr.current || 0,
            unit:    kr.unit || "%",
            status:  "not_started",
            progress: 0
        })),
        createdBy:  userId,
        createdAt:  NOW()
    };

    const okrs = load(tenantId, "okrs", []);
    okrs.push(objective);
    flush(tenantId, "okrs", okrs.slice(-2000));
    auditLog(tenantId, userId, "okr_created", { title, cycle, year: objective.year });
    return ok("okrManager", objective);
}

function updateKeyResult({ tenantId, userId, objectiveId, keyResultId, current, note = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("okrManager", auth.error);

    const okrs      = load(tenantId, "okrs", []);
    const objective = okrs.find(o => o.id === objectiveId);
    if (!objective) return fail("okrManager", "Objective not found");

    const kr = objective.keyResults.find(k => k.id === keyResultId);
    if (!kr) return fail("okrManager", "Key Result not found");

    kr.current  = Math.min(current, kr.target * 2);
    kr.progress = Math.min(100, Math.round((kr.current / kr.target) * 100));
    kr.status   = kr.progress >= 100 ? "completed" : kr.progress >= 50 ? "in_progress" : kr.progress >= 20 ? "in_progress" : "not_started";
    if (note) kr.lastNote = note;
    kr.updatedAt = NOW();

    const krProgresses = objective.keyResults.map(k => Math.min(100, Math.round((k.current / k.target) * 100)));
    objective.progress = Math.round(krProgresses.reduce((s, p) => s + p, 0) / krProgresses.length);
    objective.status   = objective.progress >= 100 ? "completed" : objective.progress >= 70 ? "in_progress" : objective.progress >= 30 ? "in_progress" : objective.progress > 0 ? "in_progress" : "not_started";
    objective.updatedAt = NOW();

    flush(tenantId, "okrs", okrs);
    auditLog(tenantId, userId, "okr_kr_updated", { objectiveId, keyResultId, current, progress: kr.progress });
    return ok("okrManager", { objective: { id: objective.id, title: objective.title, progress: objective.progress, status: objective.status }, keyResult: kr });
}

function getOKRDashboard(tenantId, requesterId, cycle = null, year = null) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("okrManager", auth.error);

    let okrs = load(tenantId, "okrs", []);
    if (cycle) okrs = okrs.filter(o => o.cycle === cycle);
    if (year)  okrs = okrs.filter(o => o.year === year);

    const completed  = okrs.filter(o => o.status === "completed").length;
    const inProgress = okrs.filter(o => o.status === "in_progress").length;
    const atRisk     = okrs.filter(o => o.progress < 30 && o.status !== "not_started").length;
    const avgProgress = okrs.length ? Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length) : 0;

    return ok("okrManager", {
        tenantId,
        filters:     { cycle: cycle || "all", year: year || "all" },
        total:       okrs.length,
        completed,
        inProgress,
        notStarted:  okrs.filter(o => o.status === "not_started").length,
        atRisk,
        avgProgress: `${avgProgress}%`,
        grade:       avgProgress >= 80 ? "A" : avgProgress >= 60 ? "B" : avgProgress >= 40 ? "C" : "D",
        objectives:  okrs.map(o => ({ id: o.id, title: o.title, owner: o.owner, cycle: o.cycle, progress: o.progress, status: o.status, krCount: o.keyResults.length }))
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_objective")    return createObjective(p);
        if (task.type === "update_key_result")   return updateKeyResult(p);
        return getOKRDashboard(p.tenantId, p.userId, p.cycle, p.year);
    } catch (err) { return fail("okrManager", err.message); }
}

module.exports = { createObjective, updateKeyResult, getOKRDashboard, OKR_CYCLES, run };
