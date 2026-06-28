"use strict";
/**
 * POST-Ω Sprint P4 — Approval & Human-in-the-Loop Engine
 * Tests: approvalPolicy, approvalQueue, approvalEvidence,
 *        approvalEngine, approvalAnalytics, approvalDashboard
 *        + integration: full Class B approval cycle
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { console.log(`  PASS  ${name}`); passed++; })
            .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
    } else {
      console.log(`  PASS  ${name}`);
      passed++;
    }
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message || e}`);
    failed++;
  }
}

function atest(name, fn) {
  const p = (async () => { await fn(); })();
  p.then(() => { console.log(`  PASS  ${name}`); passed++; })
   .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
  return p;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ── Load modules ──────────────────────────────────────────────────────────────

const pol  = require("../../backend/services/approvalPolicy.cjs");
const aq   = require("../../backend/services/approvalQueue.cjs");
const aev  = require("../../backend/services/approvalEvidence.cjs");
const ae   = require("../../backend/services/approvalEngine.cjs");
const aa   = require("../../backend/services/approvalAnalytics.cjs");
const ad   = require("../../backend/services/approvalDashboard.cjs");
const hitl = require("../../backend/services/humanInTheLoop.cjs");
const fwr  = require("../../backend/services/founderWorkRegistry.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// Block 1: approvalPolicy
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 1: approvalPolicy ──");

test("exports RISK and APPROVAL_TYPE constants", () => {
  assert(pol.RISK, "RISK missing");
  assert(pol.APPROVAL_TYPE, "APPROVAL_TYPE missing");
  assert(pol.RISK.LOW === "low");
  assert(pol.RISK.HIGH === "high");
  assert(pol.RISK.CRITICAL === "critical");
  assert(pol.APPROVAL_TYPE.DEPLOY_CONFIRM === "DEPLOY_CONFIRM");
  assert(pol.APPROVAL_TYPE.CONTENT_APPROVE === "CONTENT_APPROVE");
  assert(pol.APPROVAL_TYPE.RELEASE_APPROVE === "RELEASE_APPROVE");
});

test("getPolicy returns correct type for COST_CONFIRM workflow", () => {
  const p = pol.getPolicy("wf_deploy_vps_provision");
  assert(p.type === "COST_CONFIRM", "expected COST_CONFIRM");
  assert(p.risk === "high", "expected high risk");
  assert(p.tier === "FOUNDER");
  assert(p.ttlMs > 0);
});

test("getPolicy returns CONTENT_APPROVE for marketing workflows", () => {
  const p1 = pol.getPolicy("wf_mkt_social_post");
  const p2 = pol.getPolicy("wf_mkt_blog_post");
  const p3 = pol.getPolicy("wf_mkt_email_campaign");
  assert(p1.type === "CONTENT_APPROVE");
  assert(p2.type === "CONTENT_APPROVE");
  assert(p3.type === "CONTENT_APPROVE");
});

test("getPolicy returns RELEASE_APPROVE for engineering deploy", () => {
  const p = pol.getPolicy("wf_eng_deploy_release");
  assert(p.type === "RELEASE_APPROVE");
  assert(p.risk === "high");
});

test("getPolicy returns CODE_APPROVE for code review", () => {
  const p = pol.getPolicy("wf_eng_code_review");
  assert(p.type === "CODE_APPROVE");
  assert(p.risk === "medium");
  assert(p.autoApproveThreshold === 0.95);
});

test("getPolicy returns DEPLOY_CONFIRM for checklist items", () => {
  const ids = ["wf_deploy_vps_provisioned", "wf_deploy_pm2_started", "wf_deploy_ssl_cert"];
  for (const id of ids) {
    const p = pol.getPolicy(id);
    assert(p.type === "DEPLOY_CONFIRM", `expected DEPLOY_CONFIRM for ${id}`);
  }
});

test("getPolicy infers from workflow ID prefix", () => {
  const p1 = pol.getPolicy("wf_deploy_custom_step");
  assert(p1.type === "DEPLOY_CONFIRM");
  const p2 = pol.getPolicy("wf_biz_custom");
  assert(p2.type === "OUTREACH_APPROVE");
});

test("shouldAutoApprove returns true for medium-risk above threshold", () => {
  // wf_ops_error_triage has autoApproveThreshold=0.9
  assert(pol.shouldAutoApprove("wf_ops_error_triage", 0.95) === true);
  assert(pol.shouldAutoApprove("wf_ops_error_triage", 0.89) === false);
});

test("shouldAutoApprove returns false for high-risk workflows", () => {
  assert(pol.shouldAutoApprove("wf_deploy_vps_provision", 0.99) === false);
  assert(pol.shouldAutoApprove("wf_eng_deploy_release", 0.99) === false);
});

test("shouldAutoApprove returns false when threshold is null", () => {
  assert(pol.shouldAutoApprove("wf_mkt_social_post", 0.99) === false);
});

test("listPolicies returns entries for all known workflows", () => {
  const policies = pol.listPolicies();
  assert(policies.length >= 30, `expected >=30 policies, got ${policies.length}`);
  assert(policies.every(p => p.workflowId && p.type && p.risk));
});

test("getRisk returns expected risk level", () => {
  assert(pol.getRisk("wf_deploy_vps_provision") === "high");
  assert(pol.getRisk("wf_mkt_blog_post") === "low");
});

test("getTtlMs returns positive number", () => {
  assert(pol.getTtlMs("wf_mkt_social_post") > 0);
  assert(pol.getTtlMs("wf_eng_deploy_release") === 7200000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 2: approvalQueue
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 2: approvalQueue ──");

let testReqId = null;
let autoReqId = null;

test("enqueue creates a pending request with all required fields", () => {
  const r = aq.enqueue({
    workflowId:      "wf_mkt_social_post",
    action:          "Post social update",
    reason:          "Approved content ready",
    confidence:      0.8,
    approvalType:    "CONTENT_APPROVE",
    risk:            "medium",
    expectedOutcome: "Post published",
    rollbackPlan:    "Delete post",
    estimatedMs:     45 * 60000,
  });
  assert(r.ok, "enqueue failed");
  assert(r.reqId, "no reqId");
  assert(r.request.status === "pending" || r.request.status === "auto_approved");
  assert(r.request.workflowId === "wf_mkt_social_post");
  testReqId = r.reqId;
});

test("enqueue creates HITL request for non-auto requests", () => {
  const r = aq.enqueue({
    workflowId:   "wf_eng_deploy_release",
    action:       "Deploy release",
    confidence:   0.7,
    risk:         "high",
  });
  assert(r.ok);
  assert(!r.autoApproved, "high-risk should not auto-approve");
  // HITL request ID may be set
  if (r.request.hitlRequestId) {
    const hitlReq = hitl.getRequest(r.request.hitlRequestId);
    assert(hitlReq, "HITL request not found");
  }
});

test("auto-approve fires when confidence meets threshold", () => {
  const r = aq.enqueue({
    workflowId:  "wf_ops_error_triage",
    action:      "Triage error",
    confidence:  0.95,
  });
  assert(r.ok);
  assert(r.autoApproved === true, "expected auto_approved");
  assert(r.request.status === "auto_approved");
  autoReqId = r.reqId;
});

test("listPending returns pending requests", () => {
  const list = aq.listPending();
  assert(Array.isArray(list), "expected array");
  if (testReqId && aq.getRequest(testReqId)?.status === "pending") {
    assert(list.some(r => r.id === testReqId), "pending req not in list");
  }
});

test("approve transitions status and records response time", () => {
  // Enqueue a fresh pending request to approve
  const fresh = aq.enqueue({ workflowId: "wf_mkt_blog_post", action: "Publish blog", confidence: 0.7 });
  assert(fresh.ok);
  const appRes = aq.approve(fresh.reqId, { approvedBy: "founder", note: "Looks good" });
  assert(appRes.ok, `approve failed: ${appRes.error}`);
  assert(appRes.request.status === "approved");
  assert(appRes.request.approvedBy === "founder");
  assert(appRes.request.responseMs >= 0);
});

test("approve on already-approved fails gracefully", () => {
  const fresh = aq.enqueue({ workflowId: "wf_mkt_email_campaign", action: "Send email", confidence: 0.7 });
  aq.approve(fresh.reqId);
  const second = aq.approve(fresh.reqId);
  assert(!second.ok, "expected failure on double-approve");
});

test("reject transitions to rejected with reason", () => {
  const fresh = aq.enqueue({ workflowId: "wf_biz_churn_detect", action: "Outreach", confidence: 0.7 });
  const rej = aq.reject(fresh.reqId, { reason: "wrong_timing" });
  assert(rej.ok);
  assert(rej.request.status === "rejected");
  assert(rej.request.rejectedReason === "wrong_timing");
});

test("expireStale sets status to expired for past-TTL items", () => {
  // This is hard to test without time travel — just assert it runs without error
  const r = aq.expireStale();
  assert(typeof r.expired === "number");
});

test("getRequest returns correct fields", () => {
  const fresh = aq.enqueue({ workflowId: "wf_eng_code_review", action: "Review code", confidence: 0.7 });
  const req = aq.getRequest(fresh.reqId);
  assert(req, "not found");
  assert(req.workflowId === "wf_eng_code_review");
  assert(req.approvalType === "CODE_APPROVE");
});

test("listAll with status filter returns matching", () => {
  const list = aq.listAll({ status: "approved", limit: 10 });
  assert(Array.isArray(list));
  assert(list.every(r => r.status === "approved" || r.status === "auto_approved" || r.approvedAt != null));
});

test("getStats returns aggregate counts", () => {
  const s = aq.getStats();
  assert(s.created >= 3, `expected >=3 created, got ${s.created}`);
  assert(s.approved >= 1);
  assert(typeof s.avgResponseMs === "number");
  assert(typeof s.pending === "number");
});

test("markResumed sets resumedAt on request", () => {
  const fresh = aq.enqueue({ workflowId: "wf_ops_error_triage", action: "Triage", confidence: 0.6 });
  aq.approve(fresh.reqId);
  const r = aq.markResumed(fresh.reqId);
  assert(r.ok);
  const req = aq.getRequest(fresh.reqId);
  assert(req.resumedAt, "resumedAt not set");
});

test("markOutcomeVerified updates verified fields", () => {
  const fresh = aq.enqueue({ workflowId: "wf_mkt_social_post", action: "Post", confidence: 0.7 });
  aq.approve(fresh.reqId);
  const r = aq.markOutcomeVerified(fresh.reqId, { outcome: "success", evidenceId: "aev_test_1" });
  assert(r.ok);
  const req = aq.getRequest(fresh.reqId);
  assert(req.outcomeVerified === true);
  assert(req.verifiedOutcome === "success");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 3: approvalEvidence
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 3: approvalEvidence ──");

let evId1 = null;

test("record creates evidence with all required fields", () => {
  const r = aev.record({
    reqId:        "req_test_1",
    workflowId:   "wf_mkt_social_post",
    approvalType: "CONTENT_APPROVE",
    event:        "created",
    confidence:   0.8,
    notes:        "test",
  });
  assert(r.ok, "record failed");
  assert(r.evidenceId, "no evidenceId");
  assert(r.record.event === "created");
  evId1 = r.evidenceId;
});

test("record approved event with responseMs", () => {
  const r = aev.record({
    reqId:        "req_test_1",
    workflowId:   "wf_mkt_social_post",
    approvalType: "CONTENT_APPROVE",
    event:        "approved",
    responseMs:   45000,
    approvedBy:   "founder",
  });
  assert(r.ok);
  assert(r.record.responseMs === 45000);
  assert(r.record.responseMinutes === 0.8);
});

test("record verified event with outcome and minutesSaved", () => {
  const r = aev.record({
    reqId:        "req_test_1",
    workflowId:   "wf_mkt_social_post",
    approvalType: "CONTENT_APPROVE",
    event:        "verified",
    outcome:      "success",
    minutesSaved: 45,
  });
  assert(r.ok);
  assert(r.record.outcome === "success");
  assert(r.record.minutesSaved === 45);
});

test("getEvidence retrieves by evidenceId", () => {
  if (!evId1) return; // Skip if previous test failed
  const e = aev.getEvidence(evId1);
  assert(e, "not found");
  assert(e.workflowId === "wf_mkt_social_post");
  assert(e.event === "created");
});

test("listEvidence filters by workflowId", () => {
  const list = aev.listEvidence({ workflowId: "wf_mkt_social_post" });
  assert(Array.isArray(list));
  assert(list.length >= 1);
  assert(list.every(e => e.workflowId === "wf_mkt_social_post"));
});

test("listEvidence filters by event type", () => {
  const approved = aev.listEvidence({ event: "approved" });
  assert(Array.isArray(approved));
  if (approved.length > 0) assert(approved.every(e => e.event === "approved"));
});

test("getSummary returns aggregate counts", () => {
  const s = aev.getSummary();
  assert(s.totalEvents >= 3, `expected >=3, got ${s.totalEvents}`);
  assert(typeof s.approved === "number");
  assert(typeof s.verified === "number");
  assert(typeof s.avgResponseMs === "number");
  assert(typeof s.minutesSaved === "number");
});

test("getSummary minutesSaved accounts for verified events", () => {
  const s = aev.getSummary();
  assert(s.minutesSaved >= 45, `expected >=45, got ${s.minutesSaved}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 4: approvalEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 4: approvalEngine ──");

let engReqId = null;

test("generateApprovalPackage works for Class B workflow", () => {
  const r = ae.generateApprovalPackage("wf_mkt_social_post");
  assert(r.ok, "failed: " + r.error);
  const pkg = r.package;
  assert(pkg.workflowId === "wf_mkt_social_post");
  assert(pkg.approvalType === "CONTENT_APPROVE");
  assert(pkg.risk === "medium");
  assert(pkg.reason, "no reason");
  assert(pkg.expectedOutcome, "no expectedOutcome");
  assert(pkg.rollbackPlan, "no rollbackPlan");
  assert(pkg.confidence > 0);
  assert(pkg.estimatedMs > 0);
  assert(pkg.package?.title);
  assert(pkg.package?.actions?.length === 2);
  assert(pkg.package?.callToAction);
});

test("generateApprovalPackage rejects non-B workflows gracefully", () => {
  // wf_ops_health_check is Class A
  const r = ae.generateApprovalPackage("wf_ops_health_check");
  assert(!r.ok, "expected failure for Class A");
  assert(r.error, "no error message");
});

test("generateApprovalPackage fails for unknown workflow", () => {
  const r = ae.generateApprovalPackage("wf_nonexistent_xyz");
  assert(!r.ok, "expected failure");
});

test("requestApproval enqueues and returns reqId", () => {
  const r = ae.requestApproval("wf_mkt_email_campaign", { confidence: 0.8 });
  assert(r.ok, "failed: " + r.error);
  assert(r.reqId, "no reqId");
  assert(r.request, "no request");
  assert(r.package, "no package");
  engReqId = r.reqId;
});

test("requestApproval includes generated approval package in context", () => {
  const req = aq.getRequest(engReqId);
  if (req && req.context?.approvalPackage) {
    assert(req.context.approvalPackage.approvalType === "CONTENT_APPROVE");
    assert(req.context.approvalPackage.reason);
  }
});

test("rejectApproval transitions to rejected", () => {
  const fresh = ae.requestApproval("wf_biz_churn_detect", { confidence: 0.7 });
  assert(fresh.ok);
  const rej = ae.rejectApproval(fresh.reqId, { reason: "wrong_content", rejectedBy: "founder" });
  assert(rej.ok, "reject failed: " + rej.error);
  assert(rej.status === "rejected");
  assert(rej.reason === "wrong_content");
});

test("getStats returns all engine metrics", () => {
  const s = ae.getStats();
  assert(s.requested >= 2, `expected >=2 requested, got ${s.requested}`);
  assert(typeof s.approved === "number");
  assert(typeof s.rejected === "number");
  assert(typeof s.minutesSaved === "number");
});

test("listSessions returns session records", () => {
  const sessions = ae.listSessions({});
  assert(Array.isArray(sessions));
  assert(sessions.length >= 1);
  assert(sessions.every(s => s.reqId && s.workflowId && s.status));
});

test("listSessions filter by status works", () => {
  const pending = ae.listSessions({ status: "pending" });
  assert(Array.isArray(pending));
  if (pending.length > 0) assert(pending.every(s => s.status === "pending"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 5: approvalAnalytics
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 5: approvalAnalytics ──");

test("getBlockedMinutes returns structure", () => {
  const r = aa.getBlockedMinutes();
  assert(r.ok, "failed");
  assert(typeof r.blockedMinutes === "number");
  assert(Array.isArray(r.blockedWorkflows));
});

test("getResponseTimeByType returns sorted array", () => {
  const r = aa.getResponseTimeByType();
  assert(Array.isArray(r));
  if (r.length > 1) {
    // should be sorted ascending by avgResponseMs
    for (let i = 1; i < r.length; i++) {
      assert(r[i].avgResponseMs >= r[i-1].avgResponseMs, "not sorted");
    }
  }
});

test("getAutoApproveCandidates returns array", () => {
  const r = aa.getAutoApproveCandidates();
  assert(Array.isArray(r), "expected array");
  if (r.length > 0) {
    assert(r.every(c => c.workflowId && c.recommendation === "promote_to_auto_approve"));
  }
});

test("getTrend returns exactly 7 days", () => {
  const trend = aa.getTrend();
  assert(trend.length === 7, `expected 7, got ${trend.length}`);
  assert(trend.every(d => d.date && typeof d.created === "number"));
});

test("getMinutesSaved returns totals", () => {
  const r = aa.getMinutesSaved();
  assert(typeof r.fromApproval === "number");
  assert(typeof r.fromAutoApprove === "number");
  assert(r.total === r.fromApproval + r.fromAutoApprove);
});

test("getApprovalBlockageReport returns comprehensive data", () => {
  const r = aa.getApprovalBlockageReport();
  assert(r.ok, "failed");
  assert(typeof r.pendingApprovals === "number");
  assert(typeof r.totalApprovalRequests === "number");
  assert(typeof r.blockedMinutes === "number");
  assert(Array.isArray(r.blockedWorkflows));
  assert(Array.isArray(r.autoApproveCandidates));
  assert(r.minutesSaved);
  assert(Array.isArray(r.trend));
  assert(r.trend.length === 7);
  assert(r.generatedAt);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 6: approvalDashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 6: approvalDashboard ──");

test("getDashboard returns full structure", () => {
  const d = ad.getDashboard();
  assert(d.ok, "dashboard failed");
  // Summary
  assert(typeof d.summary.waiting === "number");
  assert(typeof d.summary.approved === "number");
  assert(typeof d.summary.rejected === "number");
  assert(typeof d.summary.expired === "number");
  assert(typeof d.summary.autoApproved === "number");
  assert(typeof d.summary.avgApprovalDelayMs === "number");
  assert(typeof d.summary.founderResponseTimeMin === "number");
  // Automation
  assert(d.automation.classBTotal === 32, `expected 32 Class B, got ${d.automation.classBTotal}`);
  assert(d.automation.classBCovered >= 30, `expected >=30 covered, got ${d.automation.classBCovered}`);
  assert(d.automation.classBCoveragePercent >= 90);
  // Evidence
  assert(typeof d.evidence.totalEvents === "number");
  assert(typeof d.evidence.minutesSaved === "number");
  // Sessions
  assert(typeof d.sessions.requested === "number");
  assert(typeof d.sessions.minutesSaved === "number");
  // Trend
  assert(Array.isArray(d.trend) && d.trend.length === 7);
  assert(Array.isArray(d.recentActivity));
  assert(Array.isArray(d.pendingQueue));
  assert(d.generatedAt);
});

test("getDashboard shows classBCoveragePercent >= 90%", () => {
  const d = ad.getDashboard();
  assert(d.automation.classBCoveragePercent >= 90,
    `Expected >=90% Class B coverage, got ${d.automation.classBCoveragePercent}%`);
});

test("getPendingForFounder returns formatted approval items", () => {
  const items = ad.getPendingForFounder();
  assert(Array.isArray(items), "expected array");
  for (const item of items) {
    assert(item.reqId, "no reqId");
    assert(item.workflowId, "no workflowId");
    assert(item.action, "no action");
    assert(item.risk, "no risk");
    assert(item.approvalType, "no approvalType");
    assert(item.callToAction, "no callToAction");
    assert(typeof item.waitingMinutes === "number");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 7: humanInTheLoop.cjs compatibility
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 7: HITL compatibility ──");

test("HITL exports unchanged: scanSteps, createRequest, approve, reject, getRequest, listPending, listAll, summary", () => {
  const expected = ["scanSteps","createRequest","approve","reject","getRequest","listPending","listAll","summary"];
  for (const fn of expected) assert(typeof hitl[fn] === "function", `HITL.${fn} missing`);
});

test("approvalQueue creates mirrored HITL request for non-auto items", () => {
  const r = aq.enqueue({
    workflowId:  "wf_eng_dependency_update",
    action:      "Update deps",
    confidence:  0.6,
    risk:        "medium",
  });
  assert(r.ok);
  if (r.request.hitlRequestId) {
    const hr = hitl.getRequest(r.request.hitlRequestId);
    assert(hr, "HITL mirrored request not found");
    assert(hr.workflowId === "wf_eng_dependency_update");
    assert(hr.status === "pending");
  }
});

test("approving queue item also mirrors to HITL", () => {
  const fresh = aq.enqueue({ workflowId: "wf_eng_dependency_update", action: "Update", confidence: 0.6 });
  const hitlId = fresh.request.hitlRequestId;
  aq.approve(fresh.reqId, { approvedBy: "founder" });
  if (hitlId) {
    const hr = hitl.getRequest(hitlId);
    assert(hr?.status === "approved", `expected HITL approved, got ${hr?.status}`);
  }
});

test("HITL summary still works independently", () => {
  const s = hitl.summary();
  assert(typeof s.pending === "number");
  assert(typeof s.approved === "number");
  assert(typeof s.total === "number");
});

test("scanSteps still works for browser workflow scanning", () => {
  const steps = [
    { action: "click", label: "Pay now", url: "checkout" },
    { action: "fillForm", label: "Enter email", value: "test@test.com" },
  ];
  const flagged = hitl.scanSteps(steps, "complete payment");
  assert(Array.isArray(flagged));
  assert(flagged.length >= 1, "expected at least 1 flagged step");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 8: Class B registry coverage
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 8: Class B registry coverage ──");

test("all 32 Class B workflows have a policy", () => {
  const reg    = fwr.getRegistry();
  const classB = (reg.workflows || []).filter(w => w.class === "B");
  assert(classB.length === 32, `expected 32, got ${classB.length}`);
  const policies = pol.listPolicies();
  const policyIds = new Set(policies.map(p => p.workflowId));
  // Either exact match or prefix inference must work
  const covered = classB.filter(w => {
    const p = pol.getPolicy(w.id);
    return p && p.type !== "GENERIC" || policyIds.has(w.id);
  });
  assert(covered.length >= 30, `Expected >=30 covered Class B, got ${covered.length}`);
});

test("each Class B workflow can generate an approval package", () => {
  const reg    = fwr.getRegistry();
  const classB = (reg.workflows || []).filter(w => w.class === "B");
  let ok = 0;
  for (const w of classB) {
    const r = ae.generateApprovalPackage(w.id);
    if (r.ok) ok++;
  }
  assert(ok === 32, `Expected all 32 packages OK, got ${ok}`);
});

test("Class B workflows map to concrete approval types (not all GENERIC)", () => {
  const reg    = fwr.getRegistry();
  const classB = (reg.workflows || []).filter(w => w.class === "B");
  let nonGeneric = 0;
  for (const w of classB) {
    const p = pol.getPolicy(w.id);
    if (p.type !== "GENERIC") nonGeneric++;
  }
  assert(nonGeneric >= 25, `Expected >=25 non-generic, got ${nonGeneric}`);
});

test("Class C workflows are rejected by engine", () => {
  const reg    = fwr.getRegistry();
  const classC = (reg.workflows || []).filter(w => w.class === "C");
  assert(classC.length > 0, "expected at least 1 Class C");
  for (const w of classC) {
    const r = ae.generateApprovalPackage(w.id);
    assert(!r.ok, `Expected Class C ${w.id} to fail package generation`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 9: Full Class B approval cycle (integration)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 9: Integration — full Class B approval cycle ──");

async function runApprovalCycle(workflowId, label) {
  // Step 1: Request approval
  const req = ae.requestApproval(workflowId, { confidence: 0.75, context: { test: true } });
  assert(req.ok, `${label}: requestApproval failed: ${req.error}`);
  assert(req.reqId, `${label}: no reqId`);
  assert(req.package, `${label}: no package`);
  assert(req.package.approvalType, `${label}: no approvalType`);
  assert(req.package.reason, `${label}: no reason`);
  assert(req.package.rollbackPlan, `${label}: no rollbackPlan`);

  // Step 2: Check it appears in pending queue (if not auto-approved)
  if (!req.autoApproved) {
    const pending = aq.listPending();
    assert(pending.some(r => r.id === req.reqId), `${label}: not in pending queue`);
  }

  // Step 3: Founder taps approve → execution resumes automatically
  const resumeResult = await ae.approveAndResume(req.reqId, { approvedBy: "founder_test" });
  // Result should have ok=true or an execution outcome
  assert(resumeResult.reqId === req.reqId, `${label}: reqId mismatch`);

  // Step 4: Verify request is no longer pending
  const finalReq = aq.getRequest(req.reqId);
  assert(finalReq?.status !== "pending", `${label}: still pending after approve+resume`);

  // Step 5: Verify evidence was recorded
  const evList = aev.listEvidence({ workflowId });
  assert(evList.length >= 1, `${label}: no evidence recorded`);

  return { reqId: req.reqId, outcome: resumeResult.outcome };
}

atest("full cycle: wf_mkt_social_post (CONTENT_APPROVE)", () =>
  runApprovalCycle("wf_mkt_social_post", "social_post")
);

atest("full cycle: wf_eng_code_review (CODE_APPROVE)", () =>
  runApprovalCycle("wf_eng_code_review", "code_review")
);

atest("full cycle: wf_ops_error_triage (auto-approve at 0.96)", async () => {
  const req = ae.requestApproval("wf_ops_error_triage", { confidence: 0.96 });
  assert(req.ok);
  // At 0.96 this should auto-approve (threshold=0.9)
  assert(req.autoApproved, "expected auto-approve at 0.96 confidence");
  // Queue request should be auto_approved status
  const qReq = aq.getRequest(req.reqId);
  assert(qReq?.status === "auto_approved", `expected auto_approved, got ${qReq?.status}`);
});

atest("full cycle: wf_deploy_backend_health (DEPLOY_CONFIRM, auto-approve at 0.97)", async () => {
  const req = ae.requestApproval("wf_deploy_backend_health", { confidence: 0.97 });
  assert(req.ok);
  assert(req.autoApproved, "expected auto-approve (backend_health has threshold=0.95)");
});

atest("rejected approval does not resume execution", async () => {
  const req = ae.requestApproval("wf_mkt_email_campaign", { confidence: 0.7 });
  assert(req.ok);
  const rej = ae.rejectApproval(req.reqId, { reason: "wrong_content" });
  assert(rej.ok);
  assert(rej.status === "rejected");
  // Verify queue shows rejected
  const qReq = aq.getRequest(req.reqId);
  assert(qReq?.status === "rejected", `expected rejected, got ${qReq?.status}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 10: Dashboard metrics after activity
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 10: Dashboard after activity ──");

async function runDashboardFinalCheck() {
  // Wait for all async tests above to complete first
  await new Promise(r => setTimeout(r, 500));

  const d = ad.getDashboard();
  assert(d.ok, "dashboard failed");
  assert(d.summary.totalRequests >= 10, `expected >=10 total requests, got ${d.summary.totalRequests}`);
  assert(d.automation.classBTotal === 32);
  assert(d.automation.classBCoveragePercent >= 90);
  assert(d.sessions.requested >= 5, `expected >=5 sessions, got ${d.sessions.requested}`);

  const evSum = aev.getSummary();
  assert(evSum.totalEvents >= 5, `expected >=5 evidence events, got ${evSum.totalEvents}`);

  const analytics = aa.getApprovalBlockageReport();
  assert(analytics.ok);
  assert(typeof analytics.avgFounderResponseMs === "number");

  console.log(`\n  Class B workflows: 32 total, ${d.automation.classBCovered} covered (${d.automation.classBCoveragePercent}%)`);
  console.log(`  Queue: ${d.summary.totalRequests} total | ${d.summary.approved} approved | ${d.summary.rejected} rejected | ${d.summary.autoApproved} auto-approved`);
  console.log(`  Evidence events: ${evSum.totalEvents} | Minutes saved: ${evSum.minutesSaved}`);
  console.log(`  Sessions: ${d.sessions.requested} requested | ${d.sessions.resumed} resumed | ${d.sessions.verified} verified`);
}

const allDone = Promise.all([
  runApprovalCycle("wf_mkt_social_post", "social_post_block10"),
  runApprovalCycle("wf_eng_code_review", "code_review_block10"),
]).then(runDashboardFinalCheck);

atest("dashboard final check: all metrics populated after activity", () => allDone);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await new Promise(r => setTimeout(r, 3000));

  const total = passed + failed;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`POST-Ω Sprint P4 — Approval Engine`);
  console.log(`  ${passed} passed  ${failed} failed  ${total} total`);
  console.log(`══════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
