/**
 * Legal Compliance Agent — legal risk tracking and regulatory requirement monitoring.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const LEGAL_REQUIREMENTS = {
    corporate: ["ROC filings (annual)","AGM minutes","Board resolutions","Statutory registers","GST returns"],
    data:      ["Privacy policy published","Cookie consent","Data processing agreements","Breach notification plan","Data retention policy"],
    labor:     ["Employment contracts","PF/ESI registration","Minimum wage compliance","Leave policy","POSH policy"],
    ip:        ["Trademark registration","Copyright notices","IP assignment agreements","NDA templates"]
};

function addRequirement({ tenantId, userId, category, requirement, dueDate, assignedTo = "" }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("legalComplianceAgent", auth.error);

    const reqs = load(tenantId, "legal-requirements", []);
    const req  = { id: uid("legal"), tenantId, category, requirement, dueDate, assignedTo, status: "pending", createdBy: userId, createdAt: NOW() };
    reqs.push(req);
    flush(tenantId, "legal-requirements", reqs);
    auditLog(tenantId, userId, "legal_req_added", { category, requirement });
    return ok("legalComplianceAgent", req);
}

function updateRequirement({ tenantId, userId, reqId, status, note = "" }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("legalComplianceAgent", auth.error);

    const reqs = load(tenantId, "legal-requirements", []);
    const req  = reqs.find(r => r.id === reqId);
    if (!req) return fail("legalComplianceAgent", "Requirement not found");

    req.status = status;
    req.note   = note;
    req.updatedAt = NOW();
    flush(tenantId, "legal-requirements", reqs);
    return ok("legalComplianceAgent", req);
}

function getLegalStatus(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("legalComplianceAgent", auth.error);

    const reqs     = load(tenantId, "legal-requirements", []);
    const overdue  = reqs.filter(r => r.status === "pending" && r.dueDate && new Date(r.dueDate) < new Date());
    const upcoming = reqs.filter(r => r.status === "pending" && r.dueDate && new Date(r.dueDate) >= new Date() && new Date(r.dueDate) <= new Date(Date.now() + 30 * 86_400_000));

    return ok("legalComplianceAgent", {
        tenantId,
        requirements: reqs.length,
        compliant:    reqs.filter(r => r.status === "compliant").length,
        pending:      reqs.filter(r => r.status === "pending").length,
        overdue:      overdue.length,
        overdueItems: overdue.map(r => ({ id: r.id, requirement: r.requirement, dueDate: r.dueDate })),
        upcoming:     upcoming.length,
        defaultChecklist: LEGAL_REQUIREMENTS,
        checkedAt:    NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "add_legal_req")    return addRequirement(p);
        if (task.type === "update_legal_req") return updateRequirement(p);
        return getLegalStatus(p.tenantId, p.userId);
    } catch (err) { return fail("legalComplianceAgent", err.message); }
}

module.exports = { addRequirement, updateRequirement, getLegalStatus, LEGAL_REQUIREMENTS, run };
