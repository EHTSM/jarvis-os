/**
 * Approval Workflow Agent — multi-step approval chains for enterprise requests.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const WORKFLOW_TEMPLATES = {
    expense:    { steps: ["manager", "finance", "admin"],    maxAmount: 100000, label: "Expense Approval" },
    leave:      { steps: ["manager"],                        label: "Leave Request"                       },
    purchase:   { steps: ["manager", "finance", "admin"],    label: "Purchase Order"                      },
    access:     { steps: ["manager", "admin"],               label: "Access Request"                      },
    policy:     { steps: ["manager", "admin", "superadmin"], label: "Policy Change"                       }
};

function submitRequest({ tenantId, userId, type, title, description, amount, metadata = {} }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("approvalWorkflowAgent", auth.error);

    const template = WORKFLOW_TEMPLATES[type] || WORKFLOW_TEMPLATES.expense;
    const request  = {
        id:          uid("appr"),
        tenantId,
        type,
        title,
        description,
        amount:      amount || 0,
        metadata,
        submittedBy: userId,
        steps:       template.steps.map((role, i) => ({ step: i + 1, requiredRole: role, approvedBy: null, status: "pending", note: "", at: null })),
        currentStep: 0,
        status:      "pending",
        submittedAt: NOW()
    };

    const requests = load(tenantId, "approvals", []);
    requests.push(request);
    flush(tenantId, "approvals", requests.slice(-500));
    auditLog(tenantId, userId, "approval_submitted", { type, title });
    return ok("approvalWorkflowAgent", request);
}

function reviewRequest({ tenantId, userId, requestId, action, note = "" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("approvalWorkflowAgent", auth.error);
    if (!["approve", "reject"].includes(action)) return fail("approvalWorkflowAgent", "action must be 'approve' or 'reject'");

    const requests = load(tenantId, "approvals", []);
    const req      = requests.find(r => r.id === requestId);
    if (!req)                          return fail("approvalWorkflowAgent", "Request not found");
    if (req.status !== "pending")      return fail("approvalWorkflowAgent", `Request already ${req.status}`);

    const step = req.steps[req.currentStep];
    if (!step) return fail("approvalWorkflowAgent", "No pending step");

    step.approvedBy = userId;
    step.status     = action === "approve" ? "approved" : "rejected";
    step.note       = note;
    step.at         = NOW();

    if (action === "reject") {
        req.status = "rejected";
    } else if (req.currentStep + 1 >= req.steps.length) {
        req.status = "approved";
    } else {
        req.currentStep++;
    }

    flush(tenantId, "approvals", requests);
    auditLog(tenantId, userId, `approval_${action}d`, { requestId, step: req.currentStep });
    return ok("approvalWorkflowAgent", { requestId, action, status: req.status, nextStep: req.steps[req.currentStep] || null });
}

function listRequests(tenantId, requesterId, filters = {}) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("approvalWorkflowAgent", auth.error);

    let reqs = load(tenantId, "approvals", []);
    if (filters.status)       reqs = reqs.filter(r => r.status === filters.status);
    if (filters.submittedBy)  reqs = reqs.filter(r => r.submittedBy === filters.submittedBy);
    return ok("approvalWorkflowAgent", { requests: reqs.slice(-50), total: reqs.length });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "submit_approval")  return submitRequest(p);
        if (task.type === "review_approval")  return reviewRequest(p);
        return listRequests(p.tenantId, p.userId, p.filters || {});
    } catch (err) { return fail("approvalWorkflowAgent", err.message); }
}

module.exports = { submitRequest, reviewRequest, listRequests, WORKFLOW_TEMPLATES, run };
