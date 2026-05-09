/**
 * Recruitment Agent — hiring pipeline from job posting to offer.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const PIPELINE_STAGES = ["applied","screening","interview_1","interview_2","technical","hr_round","offer","hired","rejected"];

function createJobPosting({ tenantId, userId, title, department, description, requirements = [], salaryMin, salaryMax, type = "full_time", remote = false }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("recruitmentAgent", auth.error);

    const job = { id: uid("job"), tenantId, title, department, description, requirements, salaryRange: { min: salaryMin, max: salaryMax }, type, remote, status: "open", applicants: 0, postedBy: userId, postedAt: NOW() };
    const jobs = load(tenantId, "jobs", []);
    jobs.push(job);
    flush(tenantId, "jobs", jobs);
    auditLog(tenantId, userId, "job_posted", { title, department });
    return ok("recruitmentAgent", job);
}

function addCandidate({ tenantId, userId, jobId, name, email, phone, resumeUrl = "", source = "direct" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("recruitmentAgent", auth.error);

    const candidates = load(tenantId, "candidates", []);
    const candidate  = { id: uid("cand"), tenantId, jobId, name, email, phone, resumeUrl, source, stage: "applied", score: 0, notes: [], createdBy: userId, createdAt: NOW() };
    candidates.push(candidate);
    flush(tenantId, "candidates", candidates.slice(-5000));

    const jobs = load(tenantId, "jobs", []);
    const job  = jobs.find(j => j.id === jobId);
    if (job) { job.applicants++; flush(tenantId, "jobs", jobs); }

    auditLog(tenantId, userId, "candidate_added", { name, jobId });
    return ok("recruitmentAgent", candidate);
}

function moveStage({ tenantId, userId, candidateId, stage, note = "" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("recruitmentAgent", auth.error);
    if (!PIPELINE_STAGES.includes(stage)) return fail("recruitmentAgent", `Invalid stage: ${stage}`);

    const candidates  = load(tenantId, "candidates", []);
    const candidate   = candidates.find(c => c.id === candidateId);
    if (!candidate) return fail("recruitmentAgent", "Candidate not found");

    candidate.notes.push({ stage, note, movedBy: userId, at: NOW() });
    candidate.stage = stage;
    flush(tenantId, "candidates", candidates);
    auditLog(tenantId, userId, "candidate_stage_moved", { candidateId, stage });
    return ok("recruitmentAgent", { candidateId, stage, status: stage === "hired" ? "HIRED 🎉" : stage === "rejected" ? "Rejected" : "Pipeline updated" });
}

function getPipeline(tenantId, requesterId, jobId = null) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("recruitmentAgent", auth.error);

    let candidates = load(tenantId, "candidates", []);
    if (jobId) candidates = candidates.filter(c => c.jobId === jobId);

    const byStage = PIPELINE_STAGES.reduce((m, s) => { m[s] = candidates.filter(c => c.stage === s).length; return m; }, {});
    return ok("recruitmentAgent", { total: candidates.length, byStage, candidates: candidates.slice(-50) });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "post_job")      return createJobPosting(p);
        if (task.type === "add_candidate") return addCandidate(p);
        if (task.type === "move_stage")    return moveStage(p);
        return getPipeline(p.tenantId, p.userId, p.jobId);
    } catch (err) { return fail("recruitmentAgent", err.message); }
}

module.exports = { createJobPosting, addCandidate, moveStage, getPipeline, PIPELINE_STAGES, run };
