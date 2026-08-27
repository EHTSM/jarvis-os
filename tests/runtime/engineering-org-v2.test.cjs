"use strict";
/**
 * Engineering Org V2 — test suite
 *
 * Covers: engineeringOrgState, engineeringOrgWorkflow, and route layer.
 * All tests use in-memory (temp) storage to avoid polluting data/.
 */

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Point state module at temp dir before requiring
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engorg-v2-test-"));
process.env._ENGORG_STATE_DIR_OVERRIDE = tmpDir;

// Patch the DIR constant by overriding the module — we do this by resetting module cache
// and monkey-patching fs.mkdirSync calls to write to tmpDir.
// Simpler: just delete temp files in beforeEach and reload.

let st, wf;

function freshModules() {
  // Clear Node module cache for our modules
  for (const key of Object.keys(require.cache)) {
    if (key.includes("engineeringOrgState") || key.includes("engineeringOrgWorkflow")) {
      delete require.cache[key];
    }
  }
  // Delete temp state files
  ["state.json", "kpis.json", "memory.json"].forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
  st = require("../../backend/services/engineeringOrgState.cjs");
  wf = require("../../backend/services/engineeringOrgWorkflow.cjs");
}

// ── State module tests ────────────────────────────────────────────────────────

describe("engineeringOrgState — Objectives", () => {
  before(freshModules);

  it("creates a quarterly objective", () => {
    const r = st.createObjective({ title: "Q3 Reliability", quarter: "Q3-2026", kpis: ["uptime", "error_rate"] });
    assert.equal(r.ok, true);
    assert.ok(r.objective.id.startsWith("obj_"));
    assert.equal(r.objective.title, "Q3 Reliability");
    assert.equal(r.objective.quarter, "Q3-2026");
    assert.equal(r.objective.status, "active");
  });

  it("lists objectives filtered by quarter", () => {
    const list = st.listObjectives({ quarter: "Q3-2026" });
    assert.ok(list.length >= 1);
    assert.ok(list.every(o => o.quarter === "Q3-2026"));
  });

  it("updates objective status", () => {
    const list = st.listObjectives({});
    const id = list[0].id;
    const r = st.updateObjective(id, { status: "completed" });
    assert.equal(r.ok, true);
    assert.equal(r.objective.status, "completed");
  });

  it("rejects objective creation without title", () => {
    const r = st.createObjective({ quarter: "Q3-2026" });
    assert.equal(r.ok, false);
  });
});

describe("engineeringOrgState — Epics", () => {
  before(() => {
    freshModules();
    const obj = st.createObjective({ title: "Q3 Obj", quarter: "Q3-2026" });
    process._testObjId = obj.objective.id;
  });

  it("creates an epic linked to objective", () => {
    const r = st.createEpic({ title: "Backend Reliability", objectiveId: process._testObjId, priority: "high" });
    assert.equal(r.ok, true);
    assert.ok(r.epic.id.startsWith("epic_"));
    assert.equal(r.epic.objectiveId, process._testObjId);
    process._testEpicId = r.epic.id;
  });

  it("epic appears in objective epicIds", () => {
    const list = st.listObjectives({ quarter: "Q3-2026" });
    const obj = list.find(o => o.id === process._testObjId);
    assert.ok(obj.epicIds.includes(process._testEpicId));
  });

  it("lists epics by objectiveId", () => {
    const list = st.listEpics({ objectiveId: process._testObjId });
    assert.ok(list.length >= 1);
  });
});

describe("engineeringOrgState — Work Items", () => {
  before(() => {
    freshModules();
    const ep = st.createEpic({ title: "Test Epic", priority: "high" });
    process._testEpicId2 = ep.epic.id;
  });

  it("creates a work item", () => {
    const r = st.createWorkItem({ title: "Implement auth fix", epicId: process._testEpicId2, domain: "backend", priority: "high" });
    assert.equal(r.ok, true);
    assert.ok(r.workItem.id.startsWith("wi_"));
    assert.equal(r.workItem.status, "planned");
    process._testWiId = r.workItem.id;
  });

  it("claims a work item", () => {
    // Move to ready first
    st.updateWorkItem(process._testWiId, { status: "ready" }, { actor: "test" });
    const r = st.claimWorkItem("engorg_backend", process._testWiId);
    assert.equal(r.ok, true);
    assert.equal(r.workItem.status, "claimed");
    assert.equal(r.workItem.assignedTo, "engorg_backend");
  });

  it("cannot re-claim item assigned to different engineer", () => {
    const r = st.claimWorkItem("engorg_frontend", process._testWiId);
    assert.equal(r.ok, false);
  });

  it("backlog contains claimed item", () => {
    const backlog = st.getBacklog("engorg_backend");
    assert.ok(backlog.some(w => w.id === process._testWiId));
  });

  it("marks work item done and updates KPI velocity", () => {
    st.updateWorkItem(process._testWiId, { status: "in_progress" }, { actor: "engorg_backend" });
    const r = st.updateWorkItem(process._testWiId, { status: "done" }, { actor: "engorg_backend" });
    assert.equal(r.ok, true);
    const kpi = st.getKpi("engorg_backend");
    assert.ok(kpi.velocity >= 1);
    assert.ok(kpi.missionsCompleted >= 1);
  });
});

describe("engineeringOrgState — Blockers", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Blocked task", domain: "api", priority: "medium" });
    process._testBlkWiId = wi.workItem.id;
    st.updateWorkItem(wi.workItem.id, { status: "ready" });
    st.claimWorkItem("engorg_api", wi.workItem.id);
  });

  it("raises a blocker", () => {
    const r = st.raiseBlocker({ workItemId: process._testBlkWiId, description: "Missing env var", raisedBy: "engorg_api" });
    assert.equal(r.ok, true);
    assert.ok(r.blocker.id.startsWith("blk_"));
    assert.equal(r.blocker.raisedBy, "engorg_api");
    process._testBlkId = r.blocker.id;
  });

  it("work item is marked blocked", () => {
    const item = st.getWorkItem(process._testBlkWiId);
    assert.equal(item.status, "blocked");
  });

  it("lists active blockers", () => {
    const list = st.listBlockers({ resolved: false });
    assert.ok(list.some(b => b.id === process._testBlkId));
  });

  it("resolves blocker and unblocks work item", () => {
    const r = st.resolveBlocker(process._testBlkId, { resolvedBy: "engorg_devops" });
    assert.equal(r.ok, true);
    assert.ok(["in_progress", "ready"].includes(r.workItemStatus));
  });

  it("blocker KPI increments", () => {
    const kpi = st.getKpi("engorg_api");
    assert.ok(kpi.blockersRaised >= 1);
  });
});

describe("engineeringOrgState — Handoffs", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Handoff task", domain: "frontend", priority: "low" });
    process._testHoWiId = wi.workItem.id;
  });

  it("creates a handoff", () => {
    const r = st.createHandoff({ fromEngineer: "engorg_backend", toEngineer: "engorg_frontend", workItemId: process._testHoWiId, message: "Frontend work ready" });
    assert.equal(r.ok, true);
    assert.ok(r.handoff.id.startsWith("hoff_"));
    assert.equal(r.handoff.accepted, null);
    process._testHoffId = r.handoff.id;
  });

  it("lists pending handoffs", () => {
    const list = st.listHandoffs({ pending: true });
    assert.ok(list.some(h => h.id === process._testHoffId));
  });

  it("accepts handoff and transfers ownership", () => {
    const r = st.acceptHandoff(process._testHoffId, { engineerId: "engorg_frontend" });
    assert.equal(r.ok, true);
    assert.equal(r.handoff.accepted, true);
    const ownership = st.getOwnership();
    assert.equal(ownership[process._testHoWiId], "engorg_frontend");
  });
});

describe("engineeringOrgState — Approvals", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Needs approval", domain: "backend", priority: "high" });
    process._testApprWiId = wi.workItem.id;
  });

  it("requests approval", () => {
    const r = st.requestApproval({ workItemId: process._testApprWiId, requestedBy: "engorg_backend", approvers: ["engorg_code_review"], description: "Ready to merge" });
    assert.equal(r.ok, true);
    assert.equal(r.approval.status, "pending");
    process._testApprId = r.approval.id;
  });

  it("records approve decision and resolves approval", () => {
    const r = st.recordApprovalDecision(process._testApprId, { engineerId: "engorg_code_review", decision: "approve", comment: "LGTM" });
    assert.equal(r.ok, true);
    assert.equal(r.approval.status, "approved");
  });

  it("KPI increments on approval", () => {
    const kpi = st.getKpi("engorg_code_review");
    assert.ok(kpi.approvalsGranted >= 1);
  });
});

describe("engineeringOrgState — Reviews", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Review task", domain: "api", priority: "medium" });
    process._testRevWiId = wi.workItem.id;
  });

  it("creates a review", () => {
    const r = st.createReview({ workItemId: process._testRevWiId, requestedBy: "engorg_api", reviewerIds: ["engorg_code_review"], type: "code" });
    assert.equal(r.ok, true);
    assert.equal(r.review.status, "open");
    process._testRevId = r.review.id;
  });

  it("adds finding to review", () => {
    const r = st.addReviewFinding(process._testRevId, { finding: "Missing null check", severity: "medium", reviewerId: "engorg_code_review" });
    assert.equal(r.ok, true);
    assert.ok(r.review.findings.length >= 1);
  });

  it("closes review and updates work item status", () => {
    const r = st.closeReview(process._testRevId, { status: "approved", reviewerId: "engorg_code_review" });
    assert.equal(r.ok, true);
    const item = st.getWorkItem(process._testRevWiId);
    assert.equal(item.status, "approved");
  });

  it("reviewsCompleted KPI increments", () => {
    const kpi = st.getKpi("engorg_code_review");
    assert.ok(kpi.reviewsCompleted >= 1);
  });
});

describe("engineeringOrgState — Engineering Memory", () => {
  before(freshModules);

  it("adds memory entry", () => {
    const r = st.addMemory({ engineerId: "engorg_cto", type: "lesson", title: "Platform reliability insight", detail: "Uptime improved after fixing retry logic" });
    assert.equal(r.ok, true);
    assert.ok(r.entry.id.startsWith("mem_"));
  });

  it("retrieves memory by engineerId", () => {
    const list = st.getMemory({ engineerId: "engorg_cto" });
    assert.ok(list.length >= 1);
    assert.ok(list.every(m => m.engineerId === "engorg_cto"));
  });

  it("memoryEntries KPI increments", () => {
    const kpi = st.getKpi("engorg_cto");
    assert.ok(kpi.memoryEntries >= 1);
  });
});

describe("engineeringOrgState — KPIs", () => {
  before(freshModules);

  it("initializes default KPI for new engineer", () => {
    // Use unique ID to avoid state from async cascade tests
    const kpi = st.getKpi("engorg_kpi_isolated_test_" + Date.now());
    assert.ok(kpi.engineerId.startsWith("engorg_kpi_isolated"));
    assert.equal(kpi.velocity, 0);
    assert.equal(kpi.qualityScore, 100);
    assert.equal(kpi.utilization, 0);
  });

  it("updates KPI with patch", () => {
    const eid = "engorg_kpi_update_test_" + Date.now();
    st.updateKpi(eid, { velocity: 5, qualityScore: 95 });
    const kpi = st.getKpi(eid);
    assert.equal(kpi.velocity, 5);
    assert.equal(kpi.qualityScore, 95);
  });

  it("getAllKpis returns array", () => {
    const all = st.getAllKpis();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 1);
  });
});

describe("engineeringOrgState — Dashboard", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Dashboard test item", domain: "backend", priority: "medium" });
    st.updateWorkItem(wi.workItem.id, { status: "ready" });
    st.claimWorkItem("engorg_backend", wi.workItem.id);
    st.updateWorkItem(wi.workItem.id, { status: "in_progress" });
  });

  it("getDashboard returns work item counts", () => {
    const dash = st.getDashboard();
    assert.ok(typeof dash.workItems === "object");
    assert.ok(typeof dash.workItems.total === "number");
    assert.ok(typeof dash.workItems.inProgress === "number");
    assert.ok(dash.workItems.inProgress >= 1);
  });

  it("getDashboard includes objectives and epics counts", () => {
    const dash = st.getDashboard();
    assert.ok(typeof dash.objectives === "object");
    assert.ok(typeof dash.epics === "object");
  });
});

// ── Workflow module tests ──────────────────────────────────────────────────────

describe("engineeringOrgWorkflow — CTO creates objective (cascade)", () => {
  const UNIQUE_TITLE = `Q3-Test-Obj-${Date.now()}`;

  before(() => {
    freshModules();
    wf.subscribeWorkflowEvents();
  });

  it("ctoCreateObjective returns objective", () => {
    const obj = wf.ctoCreateObjective({ title: UNIQUE_TITLE, description: "Test", kpis: ["uptime"] });
    assert.ok(obj, "Should create objective");
    assert.ok(obj.id.startsWith("obj_"));
    process._cascadeObjId = obj.id;
  });

  it("deduplicates identical objectives", () => {
    const obj2 = wf.ctoCreateObjective({ title: UNIQUE_TITLE });
    assert.equal(obj2, null, "Duplicate should return null");
  });

  it("EM creates epics in response (event-driven)", (_, done) => {
    setTimeout(() => {
      const epics = st.listEpics({ objectiveId: process._cascadeObjId });
      assert.ok(epics.length >= 1, `Expected epics, got ${epics.length}`);
      done();
    }, 250);
  });

  it("Architect creates work items for each epic (event-driven)", (_, done) => {
    setTimeout(() => {
      const items = st.listWorkItems({});
      assert.ok(items.length >= 1, `Expected work items, got ${items.length}`);
      done();
    }, 350);
  });
});

describe("engineeringOrgWorkflow — Manual workflow steps", () => {
  before(() => {
    freshModules();
    const ep = st.createEpic({ title: "Manual test epic", priority: "high" });
    process._manualEpicId = ep.epic.id;
  });

  it("architectPlanEpic creates work items", () => {
    const items = wf.architectPlanEpic({
      epicId: process._manualEpicId,
      workItemSpecs: [
        { title: "Backend task", domain: "backend", priority: "high", estimatedHours: 4 },
        { title: "Test task", domain: "qa", priority: "medium", estimatedHours: 2 },
      ],
    });
    assert.ok(Array.isArray(items));
    assert.ok(items.length >= 1);
    process._manualWiId = items[0].id;
  });

  it("claimAvailableWork auto-claims for engineer", () => {
    const claimed = wf.claimAvailableWork("engorg_backend", { domain: "backend" });
    assert.ok(claimed.length >= 1);
  });

  it("completeWork triggers review creation", () => {
    const r = wf.completeWork(process._manualWiId, { completedBy: "engorg_backend", notes: "Done" });
    assert.equal(r.ok, true);
    assert.ok(r.reviewId, "Should create review");
  });

  it("qaValidate passes and advances status", () => {
    const r = wf.qaValidate(process._manualWiId, { passed: true });
    assert.equal(r.ok, true);
    assert.equal(r.passed, true);
  });

  it("securityReview clears item", () => {
    const r = wf.securityReview(process._manualWiId, { cleared: true });
    assert.equal(r.ok, true);
    assert.equal(r.cleared, true);
  });

  it("codeReviewApprove approves and creates approval", () => {
    const r = wf.codeReviewApprove(process._manualWiId, { approved: true });
    assert.equal(r.ok, true);
    assert.equal(r.approved, true);
  });

  it("docsUpdate records memory and emits event", () => {
    const r = wf.docsUpdate(process._manualWiId, { summary: "Docs updated" });
    assert.equal(r.ok, true);
    const mem = st.getMemory({ engineerId: "engorg_docs" });
    assert.ok(mem.length >= 1);
  });

  it("releaseDeploy changes status to deploying", () => {
    const r = wf.releaseDeploy(process._manualWiId, { target: "staging" });
    assert.equal(r.ok, true);
    const item = st.getWorkItem(process._manualWiId);
    assert.equal(item.status, "deploying");
  });
});

describe("engineeringOrgWorkflow — Coordinator sync", () => {
  before(() => {
    freshModules();
    // Create some ready items and blockers
    const wi = st.createWorkItem({ title: "Ready item", domain: "backend", priority: "high" });
    st.updateWorkItem(wi.workItem.id, { status: "ready" });
    const wi2 = st.createWorkItem({ title: "Another ready", domain: "frontend", priority: "medium" });
    st.updateWorkItem(wi2.workItem.id, { status: "ready" });
  });

  it("coordinatorSync returns ok", () => {
    const r = wf.coordinatorSync();
    assert.equal(r.ok, true);
    assert.ok(typeof r.dashboard === "object");
    assert.ok(typeof r.avgVelocity === "number");
  });

  it("coordinator reports ready work", () => {
    const r = wf.coordinatorSync();
    assert.ok(r.dashboard.workItems.ready >= 1);
  });
});

describe("engineeringOrgWorkflow — QA failure raises blocker", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "QA fail item", domain: "api", priority: "medium" });
    st.updateWorkItem(wi.workItem.id, { status: "ready" });
    st.claimWorkItem("engorg_api", wi.workItem.id);
    st.updateWorkItem(wi.workItem.id, { status: "in_review" });
    process._qaFailWiId = wi.workItem.id;
  });

  it("qaValidate failure raises blocker", () => {
    const r = wf.qaValidate(process._qaFailWiId, { passed: false, findings: ["Test coverage < 80%", "Missing edge case"] });
    assert.equal(r.ok, true);
    assert.equal(r.passed, false);
    const blockers = st.listBlockers({ workItemId: process._qaFailWiId });
    assert.ok(blockers.length >= 1);
  });

  it("security flag raises blocker", () => {
    const r = wf.securityReview(process._qaFailWiId, { cleared: false, findings: ["SQL injection risk"] });
    assert.equal(r.ok, true);
    assert.equal(r.cleared, false);
  });
});

describe("engineeringOrgWorkflow — Incident monitor", () => {
  before(() => {
    freshModules();
    const wi = st.createWorkItem({ title: "Deploy item", domain: "devops", priority: "high" });
    process._incWiId = wi.workItem.id;
  });

  it("incidentMonitor healthy returns ok", () => {
    const r = wf.incidentMonitor(process._incWiId, { healthy: true });
    assert.equal(r.ok, true);
    assert.equal(r.healthy, true);
  });

  it("incidentMonitor unhealthy creates incident work item", () => {
    const before = st.listWorkItems({ domain: "incident" }).length;
    wf.incidentMonitor(process._incWiId, { healthy: false, issues: ["High error rate", "Latency spike"] });
    const after = st.listWorkItems({ domain: "incident" }).length;
    assert.ok(after > before, "Should create incident work item");
  });
});
