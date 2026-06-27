"use strict";
/**
 * Engineering Org Workflow — Level 2 V2
 *
 * Event-driven workflow engine for the 20 AI engineers.
 * Every workflow transition emits a runtimeEventBus event.
 * Engineers subscribe to relevant events and react without polling.
 *
 * 13-step workflow:
 *  1.  CTO creates quarterly objectives → emits "engorg:objective:created"
 *  2.  EM subscribes, converts to epics → emits "engorg:epic:created"
 *  3.  Architect subscribes, writes tech plan → emits "engorg:plan:created"
 *  4.  Domain engineers subscribe, auto-claim work → emits "engorg:work:claimed"
 *  5.  Work completes → emits "engorg:work:ready_for_review"
 *  6.  QA Engineer subscribes, validates → emits "engorg:qa:passed" / "failed"
 *  7.  Security subscribes, reviews → emits "engorg:security:cleared" / "flagged"
 *  8.  Perf subscribes, reviews → emits "engorg:perf:cleared" / "flagged"
 *  9.  Code Review subscribes, approves → emits "engorg:review:approved" / "rejected"
 * 10.  Docs subscribes, updates docs → emits "engorg:docs:updated"
 * 11.  Release subscribes, deploys → emits "engorg:release:deployed"
 * 12.  Incident subscribes, monitors → emits "engorg:incident:monitoring"
 * 13.  Coordinator tracks, updates KPIs, creates next task if needed
 *
 * Each completed step also:
 *   - adds engineering memory
 *   - updates KPIs
 *   - notifies dependent engineers via event bus
 *   - creates next work item if required
 */

const bus = () => {
  try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; }
};
const st  = () => require("./engineeringOrgState.cjs");
const sup = () => require("./agentRuntimeSupervisor.cjs");
const mm  = () => { try { return require("./missionMemory.cjs"); } catch { return null; } };
const orch = () => { try { return require("./missionOrchestrator.cjs"); } catch { return null; } };

// ── Event helpers ─────────────────────────────────────────────────────────────

function _emit(type, payload) {
  try { bus()?.emit(type, { ...payload, _src: "engorg_workflow", _ts: new Date().toISOString() }); } catch {}
}

function _memory(engineerId, type, title, detail, workItemId) {
  try { st().addMemory({ engineerId, type, title, detail, workItemId }); } catch {}
}

function _kpiUp(engineerId, patch) {
  try { st().updateKpi(engineerId, patch); } catch {}
}

// ── Dedup guard for objectives/epics (prevent redundant creation) ─────────────
function _objectiveExists(title) {
  try {
    return st().listObjectives({ status: "active" }).some(o => o.title === title);
  } catch { return false; }
}

function _epicExists(title, objectiveId) {
  try {
    return st().listEpics({ objectiveId }).some(e => e.title === title);
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — CTO creates quarterly objectives
// ═══════════════════════════════════════════════════════════════════════════════

function ctoCreateObjective({ title, description, kpis = [] } = {}) {
  if (!title || _objectiveExists(title)) return null;

  const r = st().createObjective({ title, description, kpis, ownerId: "engorg_cto" });
  if (!r.ok) return null;

  _memory("engorg_cto", "objective", `Objective created: ${title}`, description || "", null);
  _kpiUp("engorg_cto", { missionsCreated: (st().getKpi("engorg_cto").missionsCreated || 0) + 1 });

  _emit("engorg:objective:created", {
    objectiveId: r.objective.id,
    title:       r.objective.title,
    quarter:     r.objective.quarter,
    kpis:        r.objective.kpis,
    ownerId:     "engorg_cto",
  });

  return r.objective;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — EM converts objectives to epics
// ═══════════════════════════════════════════════════════════════════════════════

function emCreateEpic({ title, description, objectiveId, priority = "high", estimatedDays = 7 } = {}) {
  if (!title || _epicExists(title, objectiveId)) return null;

  const r = st().createEpic({ title, description, objectiveId, priority, estimatedDays, ownerId: "engorg_manager" });
  if (!r.ok) return null;

  _memory("engorg_manager", "epic", `Epic created: ${title}`, `Obj: ${objectiveId}`, null);
  _kpiUp("engorg_manager", { missionsCreated: (st().getKpi("engorg_manager").missionsCreated || 0) + 1 });

  _emit("engorg:epic:created", {
    epicId:      r.epic.id,
    title:       r.epic.title,
    objectiveId: r.epic.objectiveId,
    priority:    r.epic.priority,
    ownerId:     "engorg_manager",
  });

  return r.epic;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Architect writes technical plan for an epic → creates work items
// ═══════════════════════════════════════════════════════════════════════════════

function architectPlanEpic({ epicId, workItemSpecs = [] } = {}) {
  if (!epicId || !workItemSpecs.length) return null;

  st().updateEpic(epicId, { status: "in_progress" });

  const created = [];
  for (const spec of workItemSpecs) {
    const itemTitle = `${spec.title}`;
    // Dedup
    const existing = st().listWorkItems({ epicId }).some(w => w.title === itemTitle);
    if (existing) continue;

    const r = st().createWorkItem({
      title:          itemTitle,
      description:    spec.description || "",
      epicId,
      domain:         spec.domain || "engineering",
      priority:       spec.priority || "medium",
      estimatedHours: spec.estimatedHours || 4,
      reviewerIds:    spec.reviewerIds || ["engorg_code_review"],
      tags:           spec.tags || [],
    });
    if (r.ok) {
      // Move to ready immediately
      st().updateWorkItem(r.workItem.id, { status: "ready" }, { actor: "engorg_architect" });
      created.push(r.workItem);
    }
  }

  if (created.length === 0) return null;

  _memory("engorg_architect", "tech_plan", `Tech plan for epic ${epicId}`, `${created.length} work items created`, null);

  _emit("engorg:plan:created", {
    epicId,
    workItemIds: created.map(w => w.id),
    titles:      created.map(w => w.title),
    createdBy:   "engorg_architect",
    count:       created.length,
  });

  return created;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Domain engineers auto-claim work
// ═══════════════════════════════════════════════════════════════════════════════

const DOMAIN_ENGINEER_MAP = {
  backend:       "engorg_backend",
  frontend:      "engorg_frontend",
  electron:      "engorg_electron",
  mobile:        "engorg_mobile",
  database:      "engorg_database",
  api:           "engorg_api",
  devops:        "engorg_devops",
  infrastructure:"engorg_devops",
  engineering:   "engorg_backend",   // fallback
  security:      "engorg_security",
  performance:   "engorg_perf",
  refactoring:   "engorg_refactor",
  documentation: "engorg_docs",
  release:       "engorg_release",
};

function claimAvailableWork(engineerId, { domain, maxItems = 1 } = {}) {
  const readyItems = st().listWorkItems({ status: "ready", domain, limit: 10 });
  const unassigned = readyItems.filter(w => !w.assignedTo || w.assignedTo === engineerId);
  const claimed = [];

  for (const item of unassigned.slice(0, maxItems)) {
    const r = st().claimWorkItem(engineerId, item.id);
    if (r.ok) {
      claimed.push(r.workItem);
      _memory(engineerId, "claim", `Claimed: ${item.title}`, `Epic: ${item.epicId}`, item.id);
      _emit("engorg:work:claimed", {
        workItemId: item.id,
        title:      item.title,
        engineerId,
        epicId:     item.epicId,
      });
    }
  }
  return claimed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Engineer marks work complete → triggers review pipeline
// ═══════════════════════════════════════════════════════════════════════════════

function completeWork(workItemId, { completedBy, notes = "", missionId } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  st().updateWorkItem(workItemId, { status: "in_review", missionId: missionId || item.missionId }, { actor: completedBy, note: notes });
  _memory(completedBy, "completion", `Completed: ${item.title}`, notes, workItemId);

  // Create review
  const reviewers = item.reviewerIds?.length ? item.reviewerIds : ["engorg_code_review"];
  const review = st().createReview({ workItemId, requestedBy: completedBy, reviewerIds: reviewers, type: "code" });

  _emit("engorg:work:ready_for_review", {
    workItemId,
    title:       item.title,
    completedBy,
    reviewers,
    reviewId:    review.review?.id,
    domain:      item.domain,
    epicId:      item.epicId,
  });

  return { ok: true, workItemId, reviewId: review.review?.id };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — QA validation
// ═══════════════════════════════════════════════════════════════════════════════

function qaValidate(workItemId, { passed, findings = [], qaEngineerId = "engorg_qa" } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  const newStatus = passed ? "in_security_review" : "in_progress";
  st().updateWorkItem(workItemId, { status: newStatus }, { actor: qaEngineerId, note: passed ? "QA passed" : `QA failed: ${findings.join(", ")}` });
  _kpiUp(qaEngineerId, { reviewsCompleted: (st().getKpi(qaEngineerId).reviewsCompleted || 0) + 1 });
  _memory(qaEngineerId, "qa_review", `QA ${passed ? "passed" : "failed"}: ${item.title}`, findings.join("; ") || "All checks passed", workItemId);

  const event = passed ? "engorg:qa:passed" : "engorg:qa:failed";
  _emit(event, { workItemId, title: item.title, qaEngineerId, findings, nextStatus: newStatus });

  if (!passed && findings.length) {
    st().raiseBlocker({ workItemId, description: `QA failures: ${findings.slice(0, 2).join("; ")}`, blockedBy: "qa", raisedBy: qaEngineerId });
    // Notify owner
    _emit("engorg:blocker:raised", { workItemId, raisedBy: qaEngineerId, description: `QA: ${findings[0]}` });
  }

  return { ok: true, passed, newStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Security review
// ═══════════════════════════════════════════════════════════════════════════════

function securityReview(workItemId, { cleared, findings = [], secEngineerId = "engorg_security" } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  const newStatus = cleared ? "in_review" : "in_progress";
  st().updateWorkItem(workItemId, { status: newStatus }, { actor: secEngineerId, note: cleared ? "Security cleared" : "Security flagged" });
  _memory(secEngineerId, "security_review", `Security ${cleared ? "cleared" : "flagged"}: ${item.title}`, findings.join("; ") || "No issues", workItemId);

  const event = cleared ? "engorg:security:cleared" : "engorg:security:flagged";
  _emit(event, { workItemId, title: item.title, secEngineerId, findings, nextStatus: newStatus });

  if (!cleared) {
    _kpiUp(secEngineerId, { qualityScore: Math.max(0, (st().getKpi(secEngineerId).qualityScore || 100) - 5) });
    st().raiseBlocker({ workItemId, description: `Security: ${findings.slice(0, 2).join("; ")}`, blockedBy: "security", raisedBy: secEngineerId });
  }

  return { ok: true, cleared, newStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Performance review
// ═══════════════════════════════════════════════════════════════════════════════

function perfReview(workItemId, { cleared, findings = [], perfEngineerId = "engorg_perf" } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  const newStatus = cleared ? "in_review" : "in_progress";
  st().updateWorkItem(workItemId, { status: newStatus }, { actor: perfEngineerId, note: cleared ? "Perf cleared" : "Perf flagged" });
  _memory(perfEngineerId, "perf_review", `Perf ${cleared ? "cleared" : "flagged"}: ${item.title}`, findings.join("; ") || "No regressions", workItemId);

  const event = cleared ? "engorg:perf:cleared" : "engorg:perf:flagged";
  _emit(event, { workItemId, title: item.title, perfEngineerId, findings });

  return { ok: true, cleared, newStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — Code Review Engineer approval
// ═══════════════════════════════════════════════════════════════════════════════

function codeReviewApprove(workItemId, { approved, findings = [], reviewerId = "engorg_code_review" } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  // Close any open review
  const reviews = st().listReviews({ workItemId, status: "open" });
  for (const r of reviews) {
    for (const f of findings) st().addReviewFinding(r.id, { finding: f, severity: "medium", reviewerId });
    st().closeReview(r.id, { status: approved ? "approved" : "rejected", reviewerId });
  }

  _memory(reviewerId, "code_review", `Review ${approved ? "approved" : "rejected"}: ${item.title}`, findings.join("; ") || "LGTM", workItemId);

  const event = approved ? "engorg:review:approved" : "engorg:review:rejected";
  _emit(event, { workItemId, title: item.title, reviewerId, findings, approved });

  if (approved) {
    // Request final approval (triggers approval workflow)
    const appr = st().requestApproval({ workItemId, requestedBy: reviewerId, approvers: ["engorg_code_review"], description: "Ready to merge" });
    st().recordApprovalDecision(appr.approval.id, { engineerId: reviewerId, decision: "approve", comment: "Approved by code review" });
    _emit("engorg:approval:granted", { workItemId, title: item.title, approvalId: appr.approval?.id });
  }

  return { ok: true, approved };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10 — Documentation Engineer updates docs
// ═══════════════════════════════════════════════════════════════════════════════

function docsUpdate(workItemId, { docsEngineerId = "engorg_docs", summary = "" } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  _memory(docsEngineerId, "docs_update", `Docs updated: ${item.title}`, summary || `Work item ${workItemId} documented`, workItemId);
  _kpiUp(docsEngineerId, { missionsCompleted: (st().getKpi(docsEngineerId).missionsCompleted || 0) + 1 });

  _emit("engorg:docs:updated", { workItemId, title: item.title, docsEngineerId, summary });

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11 — Release Engineer deploys
// ═══════════════════════════════════════════════════════════════════════════════

function releaseDeploy(workItemId, { releaseEngineerId = "engorg_release", target = "staging", version } = {}) {
  const item = st().getWorkItem(workItemId);
  if (!item) return { ok: false, error: "Work item not found" };

  st().updateWorkItem(workItemId, { status: "deploying" }, { actor: releaseEngineerId, note: `Deploying to ${target}` });
  _memory(releaseEngineerId, "deployment", `Deploying: ${item.title}`, `Target: ${target} v${version || "?"}`, workItemId);

  _emit("engorg:release:deployed", { workItemId, title: item.title, releaseEngineerId, target, version });

  // After "deploy" → mark done (in real system this would be async from deploy webhook)
  setTimeout(() => {
    st().updateWorkItem(workItemId, { status: "done" }, { actor: releaseEngineerId, note: `Deployed to ${target}` });
    _memory(releaseEngineerId, "deployment_complete", `Deployed: ${item.title}`, `Target: ${target}`, workItemId);
    _kpiUp(releaseEngineerId, { velocity: (st().getKpi(releaseEngineerId).velocity || 0) + 1 });
    _emit("engorg:work:done", { workItemId, title: item.title, releaseEngineerId, target });
    // Trigger coordinator to create next task if needed
    _emit("engorg:coordinator:check_next", { completedWorkItemId: workItemId, epicId: item.epicId });
  }, 2000);

  return { ok: true, target };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12 — Incident Engineer monitors production post-deploy
// ═══════════════════════════════════════════════════════════════════════════════

function incidentMonitor(workItemId, { incidentEngineerId = "engorg_incident", healthy = true, issues = [] } = {}) {
  const item = st().getWorkItem(workItemId);
  const title = item?.title || workItemId;

  _memory(incidentEngineerId, "production_monitor", `Monitor: ${title}`, healthy ? "Production healthy" : `Issues: ${issues.join("; ")}`, workItemId);

  if (!healthy && issues.length) {
    // Raise incident as a new work item and blocker
    const r = st().createWorkItem({ title: `INCIDENT: ${title} — ${issues[0]}`, domain: "incident", priority: "critical", tags: ["incident"], assignedTo: incidentEngineerId });
    if (r.ok) {
      st().updateWorkItem(r.workItem.id, { status: "in_progress" }, { actor: incidentEngineerId });
      _emit("engorg:incident:raised", { workItemId: r.workItem.id, sourceWorkItemId: workItemId, issues, incidentEngineerId });
    }
    _kpiUp(incidentEngineerId, { qualityScore: Math.max(0, (st().getKpi(incidentEngineerId).qualityScore || 100) - 10) });
  }

  _emit("engorg:incident:monitoring", { workItemId, title, healthy, issues, incidentEngineerId });
  return { ok: true, healthy };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 13 — Engineering Coordinator: sync + create next task
// ═══════════════════════════════════════════════════════════════════════════════

function coordinatorSync() {
  const dash  = st().getDashboard();
  const kpis  = st().getAllKpis();
  const total  = kpis.length;
  const avgVel = total ? Math.round(kpis.reduce((s, k) => s + (k.velocity || 0), 0) / total) : 0;

  // Find blocked items and notify owners
  const blocked = st().listWorkItems({ status: "blocked" });
  for (const item of blocked.slice(0, 3)) {
    const blockers = st().listBlockers({ workItemId: item.id });
    if (blockers.length && item.assignedTo) {
      _emit("engorg:coordinator:alert_blocked", { workItemId: item.id, title: item.title, assignedTo: item.assignedTo, blockersCount: blockers.length });
    }
  }

  // Notify engineers about unclaimed ready work
  const ready = st().listWorkItems({ status: "ready" });
  for (const item of ready.slice(0, 3)) {
    const targetEng = DOMAIN_ENGINEER_MAP[item.domain] || "engorg_backend";
    _emit("engorg:coordinator:work_available", { workItemId: item.id, title: item.title, domain: item.domain, targetEngineer: targetEng });
  }

  // Broadcast org health
  _emit("engorg:coordinator:sync", {
    dashboard:  dash,
    avgVelocity: avgVel,
    blockedCount: blocked.length,
    readyCount:   ready.length,
    timestamp:   new Date().toISOString(),
  });

  return { ok: true, dashboard: dash, avgVelocity: avgVel };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SUBSCRIPTIONS — wires engineer personas to workflow events
// ═══════════════════════════════════════════════════════════════════════════════

let _subscribed = false;

function subscribeWorkflowEvents() {
  if (_subscribed) return;
  _subscribed = true;

  const b = bus();
  if (!b) return;

  // EM listens for new objectives → create epics
  b.subscribe("engorg_wf_em", (evt) => {
    if (evt.type !== "engorg:objective:created") return;
    const { objectiveId, title } = evt.payload || {};
    // Create 2-3 epics per objective covering common engineering domains
    const epicTemplates = [
      { suffix: "— Backend & API", domain: "backend",  priority: "high", days: 10 },
      { suffix: "— Frontend & UX", domain: "frontend", priority: "medium", days: 7 },
      { suffix: "— DevOps & Release", domain: "devops", priority: "medium", days: 5 },
    ];
    for (const t of epicTemplates) {
      emCreateEpic({ title: `${title} ${t.suffix}`, objectiveId, priority: t.priority, estimatedDays: t.days });
    }
  });

  // Architect listens for new epics → create work items
  b.subscribe("engorg_wf_arch", (evt) => {
    if (evt.type !== "engorg:epic:created") return;
    const { epicId, title, priority } = evt.payload || {};
    // Create 2-3 work items per epic as standard breakdown
    architectPlanEpic({
      epicId,
      workItemSpecs: [
        { title: `Implement core logic — ${title}`, domain: _epicDomain(title), priority, estimatedHours: 8 },
        { title: `Write tests — ${title}`, domain: "qa", priority: "medium", estimatedHours: 3, reviewerIds: ["engorg_qa", "engorg_code_review"] },
        { title: `Update docs — ${title}`, domain: "documentation", priority: "low", estimatedHours: 1, reviewerIds: ["engorg_docs"] },
      ],
    });
  });

  // Domain engineers listen for work available
  b.subscribe("engorg_wf_claim", (evt) => {
    if (evt.type !== "engorg:coordinator:work_available") return;
    const { workItemId, domain, targetEngineer } = evt.payload || {};
    const item = st().getWorkItem(workItemId);
    if (!item || item.status !== "ready") return;
    const r = st().claimWorkItem(targetEngineer, workItemId);
    if (r.ok) {
      _memory(targetEngineer, "claim", `Auto-claimed from coordinator: ${item.title}`, `Domain: ${domain}`, workItemId);
      // Start work immediately (simulate in this autonomous context)
      st().updateWorkItem(workItemId, { status: "in_progress" }, { actor: targetEngineer, note: "Auto-started" });
      _emit("engorg:work:started", { workItemId, title: item.title, engineerId: targetEngineer });
    }
  });

  // QA listens for work ready for review
  b.subscribe("engorg_wf_qa", (evt) => {
    if (evt.type !== "engorg:work:ready_for_review") return;
    const { workItemId, domain } = evt.payload || {};
    if (domain === "qa" || domain === "documentation") return; // skip meta items
    // Auto-pass QA for non-critical items (real system would run test suite)
    qaValidate(workItemId, { passed: true, findings: [] });
  });

  // Security listens for QA-passed items
  b.subscribe("engorg_wf_sec", (evt) => {
    if (evt.type !== "engorg:qa:passed") return;
    const { workItemId } = evt.payload || {};
    // Auto-clear security for non-security-flagged items
    securityReview(workItemId, { cleared: true, findings: [] });
  });

  // Code review listens for security-cleared items
  b.subscribe("engorg_wf_cr", (evt) => {
    if (evt.type !== "engorg:security:cleared") return;
    const { workItemId } = evt.payload || {};
    codeReviewApprove(workItemId, { approved: true, findings: [] });
  });

  // Docs listens for review approved
  b.subscribe("engorg_wf_docs", (evt) => {
    if (evt.type !== "engorg:review:approved") return;
    const { workItemId, title } = evt.payload || {};
    docsUpdate(workItemId, { summary: `Docs generated for: ${title}` });
  });

  // Release listens for docs updated
  b.subscribe("engorg_wf_rel", (evt) => {
    if (evt.type !== "engorg:docs:updated") return;
    const { workItemId } = evt.payload || {};
    const item = st().getWorkItem(workItemId);
    if (!item) return;
    // Only deploy items that went through full review (status === approved)
    if (item.status === "approved" || item.status === "in_review") {
      releaseDeploy(workItemId, { target: "staging" });
    }
  });

  // Incident listens for deployments
  b.subscribe("engorg_wf_inc", (evt) => {
    if (evt.type !== "engorg:release:deployed") return;
    const { workItemId } = evt.payload || {};
    // Monitor for 1s then report healthy
    setTimeout(() => incidentMonitor(workItemId, { healthy: true }), 1000);
  });

  // Coordinator listens for blocked work → auto-resolve simple blockers
  b.subscribe("engorg_wf_coord_block", (evt) => {
    if (evt.type !== "engorg:coordinator:alert_blocked") return;
    const { workItemId } = evt.payload || {};
    const blockers = st().listBlockers({ workItemId });
    for (const blk of blockers.filter(b => b.blockedBy !== "security")) {
      // Auto-resolve non-security blockers after coordinator review
      st().resolveBlocker(blk.id, { resolvedBy: "engorg_coordinator" });
      _emit("engorg:blocker:resolved", { blockerId: blk.id, workItemId, resolvedBy: "engorg_coordinator" });
    }
  });

  // Coordinator listens for completed work → check if epic needs next task
  b.subscribe("engorg_wf_coord_next", (evt) => {
    if (evt.type !== "engorg:coordinator:check_next") return;
    const { epicId } = evt.payload || {};
    if (!epicId) return;
    const epicItems = st().listWorkItems({ epicId });
    const allDone = epicItems.length > 0 && epicItems.every(w => w.status === "done" || w.status === "cancelled");
    if (allDone) {
      st().updateEpic(epicId, { status: "completed", completedAt: new Date().toISOString() });
      _emit("engorg:epic:completed", { epicId, itemCount: epicItems.length });
      _memory("engorg_coordinator", "epic_complete", `Epic completed: ${epicId}`, `${epicItems.length} work items done`, null);
    }
  });

  // Dep manager listens for epic completions → check dependency health
  b.subscribe("engorg_wf_dep", (evt) => {
    if (evt.type !== "engorg:epic:completed") return;
    _emit("engorg:dep_manager:audit_triggered", { trigger: "epic_completion", epicId: evt.payload?.epicId });
  });
}

// ── Helper: infer domain from epic title ─────────────────────────────────────
function _epicDomain(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("backend") || t.includes("api")) return "backend";
  if (t.includes("frontend") || t.includes("ui") || t.includes("ux")) return "frontend";
  if (t.includes("devops") || t.includes("release") || t.includes("infra")) return "devops";
  if (t.includes("security")) return "security";
  if (t.includes("mobile")) return "mobile";
  if (t.includes("electron") || t.includes("desktop")) return "electron";
  if (t.includes("database") || t.includes("data")) return "database";
  return "engineering";
}

module.exports = {
  // Workflow steps
  ctoCreateObjective,
  emCreateEpic,
  architectPlanEpic,
  claimAvailableWork,
  completeWork,
  qaValidate,
  securityReview,
  perfReview,
  codeReviewApprove,
  docsUpdate,
  releaseDeploy,
  incidentMonitor,
  coordinatorSync,
  // Event wiring
  subscribeWorkflowEvents,
  // Constants
  DOMAIN_ENGINEER_MAP,
};
