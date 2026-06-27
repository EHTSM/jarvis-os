"use strict";
/**
 * Enterprise Workflow — LEVEL 7
 *
 * Orchestrates the full enterprise pipeline:
 * Enterprise Goal → Executive Layer → 5 Orgs → Deployment → Audit → Report
 *
 * Delegates ALL execution to Level 6 (executiveWorkflow).
 * Zero new runtimes, schedulers, or event buses.
 */

const _st  = () => require("./enterpriseState.cjs");
const _eos = () => { try { return require("./executiveWorkflow.cjs"); } catch { return null; } }
const _eosSt = () => { try { return require("./executiveState.cjs"); } catch { return null; } }
const _le  = () => { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
const _em  = () => { try { return require("./engineeringMemoryEngine.cjs"); } catch { return null; } }
const _obs = () => { try { return require("./observabilityEngine.cjs"); } catch { return null; } }
const _ca  = () => { try { return require("./costAnalytics.cjs"); } catch { return null; } }
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
const _shr = () => { try { return require("./selfHealingRuntime.cjs"); } catch { return null; } }

function _emit(type, payload) {
  try { _bus()?.emit(type, payload); } catch {}
}

// ── Priority weights for enterprise goal scoring ──────────────────────────────
const ENT_PRIORITY_WEIGHTS = { critical: 4, high: 3, medium: 2, low: 1 };

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Intake enterprise goal
// ═══════════════════════════════════════════════════════════════════════════════

function intakeEnterpriseGoal(command, { companyId, priority = "high", portfolioId, kpis = [], deadline = null, divisionId = "ent_director" } = {}) {
  if (!command) return { ok: false, error: "command required" };
  // Create or reuse EOS goal via Level 6
  const eosResult = _eosSt()?.createGoal({
    title: command.slice(0, 200),
    description: `Enterprise initiative: ${command}`,
    priority, kpis, deadline,
    sourceCommand: command,
    tags: ["enterprise", divisionId, companyId].filter(Boolean),
  });
  const eosGoalId = eosResult?.goal?.id || (eosResult?.error === "Duplicate active goal"
    ? _eosSt()?.listGoals()?.find(g => g.title === command.slice(0,200))?.id
    : null);

  // Also create initiative if portfolioId given
  let initiative = null;
  if (portfolioId) {
    const iRes = _st().createInitiative({
      portfolioId, name: command.slice(0, 150), priority,
      orgTargets: ["engineering","business","knowledge","evolution","odi"],
      execGoalId: eosGoalId,
    });
    initiative = iRes.initiative;
  }

  // Audit
  _st().addAuditEntry({ entityId: eosGoalId, entityType: "enterprise_goal", action: "created", actor: divisionId, companyId });
  _emit("enterprise:goal:created", { eosGoalId, command, companyId, portfolioId });

  return { ok: true, eosGoalId, initiative, command };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Enterprise strategy (maps to EOS strategy)
// ═══════════════════════════════════════════════════════════════════════════════

function buildEnterpriseStrategy(eosGoalId, { companyId } = {}) {
  const r = _eosSt()?.createStrategy({
    goalId: eosGoalId,
    title: `Enterprise Strategy for ${eosGoalId}`,
    orgTargets: ["engineering","business","knowledge","evolution","odi"],
    phases: [
      { name: "Foundation",   orgTarget: "engineering", estimatedDays: 7 },
      { name: "Go-to-Market", orgTarget: "business",    estimatedDays: 7 },
      { name: "Knowledge",    orgTarget: "knowledge",   estimatedDays: 3 },
      { name: "Optimize",     orgTarget: "evolution",   estimatedDays: 5 },
      { name: "Design",       orgTarget: "odi",         estimatedDays: 3 },
    ],
    estimatedDuration: "4w",
  });
  if (companyId) _st().addAuditEntry({ entityId: eosGoalId, entityType: "strategy", action: "built", actor: "ent_strategy", companyId });
  return r || { ok: false, error: "EOS strategy unavailable" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Governance gate (policy evaluation + enterprise approval)
// ═══════════════════════════════════════════════════════════════════════════════

function governanceGate(eosGoalId, { companyId, spendUsd = 0, headcount = 0, autoApprove = true } = {}) {
  const policyResult = _st().evaluateEnterprisePolicy({ spendUsd, headcount, region: "global" });
  const violations = policyResult.violations || [];
  const blockers = violations.filter(v => v.enforcement === "mandatory");

  const approval = _st().createEnterpriseApproval({
    companyId, title: `Enterprise Approval: ${eosGoalId}`,
    type: "strategic", autoApprove: autoApprove && blockers.length === 0,
  });

  _emit("enterprise:governance:evaluated", { eosGoalId, violations: violations.length, approved: approval.approval?.status === "approved" });
  _st().addAuditEntry({ entityId: eosGoalId, entityType: "governance_gate", action: "evaluated", actor: "ent_governance", companyId, detail: `${violations.length} violations, ${blockers.length} blockers` });

  return { ok: blockers.length === 0, approval: approval.approval, violations, blockers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Budget allocation
// ═══════════════════════════════════════════════════════════════════════════════

function allocateBudget(eosGoalId, { companyId, amountUsd = 0, division = "ent_director" } = {}) {
  let budget = null;
  // Try to find existing company budget or create a virtual one
  const existing = _st().listEnterpriseBudgets({ companyId }).find(b => b.remainingUsd >= amountUsd);
  if (existing && amountUsd > 0) {
    const r = _st().allocateEnterpriseBudget(existing.id, { division, amountUsd, description: eosGoalId });
    budget = r.budget;
  }
  // Also allocate at EOS level
  try {
    const goals = _eosSt()?.listGoals?.({ limit: 200 }) || [];
    const goal = goals.find(g => g.id === eosGoalId);
    if (goal) _eosSt()?.allocateResource?.({ goalId: eosGoalId, orgTarget: division, resource: "budget_usd", amount: amountUsd });
  } catch {}
  _emit("enterprise:budget:allocated", { eosGoalId, amountUsd, division, companyId });
  return { ok: true, budget, amountUsd };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Dispatch to Executive Layer (Level 6 runFullPipeline)
// ═══════════════════════════════════════════════════════════════════════════════

async function dispatchToExecutive(command, eosGoalId, { companyId, priority = "high" } = {}) {
  let steps = [], healthScore = 50, reportId = null;
  try {
    const r = await _eos()?.runFullPipeline?.(command, { priority });
    if (r) { steps = r.steps; healthScore = r.healthScore; reportId = r.reportId; }
  } catch (e) {
    // Fallback: dispatch individually
    try { _eos()?.dispatchToEngineering?.(eosGoalId); steps.push("engineering:dispatched"); } catch {}
    try { _eos()?.dispatchToBusiness?.(eosGoalId);    steps.push("business:dispatched");    } catch {}
    try { _eos()?.dispatchToKnowledge?.(eosGoalId);   steps.push("knowledge:dispatched");   } catch {}
    try { _eos()?.dispatchToEvolution?.(eosGoalId);   steps.push("evolution:dispatched");   } catch {}
    try { _eos()?.dispatchToODI?.(eosGoalId);         steps.push("odi:dispatched");         } catch {}
    healthScore = _eosSt()?.getGlobalHealth?.()?.score || 50;
  }
  _emit("enterprise:executive:dispatched", { eosGoalId, steps: steps.length, healthScore });
  return { ok: true, steps, healthScore, reportId };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Enterprise audit
// ═══════════════════════════════════════════════════════════════════════════════

function runEnterpriseAudit(eosGoalId, { companyId, healthScore = 50 } = {}) {
  // Pull data from all layers
  const eosDb    = (() => { try { return _eosSt()?.getDashboard?.() || {}; } catch { return {}; } })();
  const entHealth = _st().getEnterpriseHealth();
  const violations = _st().evaluateEnterprisePolicy({ budget: 0 }).violations || [];
  const pendingApprovals = _st().listEnterpriseApprovals({ status: "pending" }).length;
  const controls = _st().listControls({ status: "active" });

  const auditResult = {
    eosGoalId, companyId,
    timestamp: new Date().toISOString(),
    enterpriseHealth: entHealth.score,
    executiveHealth: healthScore,
    policyViolations: violations.length,
    pendingApprovals,
    activeControls: controls.length,
    findings: [],
    riskLevel: "low",
  };

  if (violations.length > 0)   auditResult.findings.push({ type: "policy_violation", count: violations.length, severity: "medium" });
  if (pendingApprovals > 5)    auditResult.findings.push({ type: "approval_backlog",  count: pendingApprovals, severity: "medium" });
  if (entHealth.score < 70)    auditResult.findings.push({ type: "enterprise_health", score: entHealth.score,  severity: "high" });
  if (healthScore < 60)        auditResult.findings.push({ type: "executive_health",  score: healthScore,      severity: "high" });

  const criticalFindings = auditResult.findings.filter(f => f.severity === "critical").length;
  const highFindings     = auditResult.findings.filter(f => f.severity === "high").length;
  auditResult.riskLevel  = criticalFindings > 0 ? "critical" : highFindings > 0 ? "high" : violations.length > 0 ? "medium" : "low";

  _st().addAuditEntry({ entityId: eosGoalId, entityType: "enterprise_audit", action: "completed", actor: "ent_audit", companyId, detail: `risk=${auditResult.riskLevel} findings=${auditResult.findings.length}`, severity: auditResult.riskLevel === "critical" ? "critical" : "info" });
  _emit("enterprise:audit:completed", { eosGoalId, riskLevel: auditResult.riskLevel, findings: auditResult.findings.length });
  _kpi("ent_audit").auditsCompleted++;

  return { ok: true, audit: auditResult };
}

function _kpi(divId) { return _st().getEnterpriseKpi(divId); }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Enterprise report
// ═══════════════════════════════════════════════════════════════════════════════

function generateEnterpriseReport(eosGoalId, { companyId, audit, healthScore } = {}) {
  const db = _st().getEnterpriseDashboard();
  const eosGoal = _eosSt()?.getGoal?.(eosGoalId);
  const eosDecisions = _eosSt()?.listDecisions?.({ goalId: eosGoalId, limit: 5 }) || [];
  const eosRisks = _eosSt()?.listRisks?.({ goalId: eosGoalId }) || [];
  const memory = _st().listEnterpriseMemory({ divId: "ent_board", limit: 5 });

  const summary = [
    `Enterprise initiative: ${eosGoal?.title || eosGoalId}`,
    `Enterprise health: ${db.health.score}/100`,
    `Executive health: ${healthScore || 0}/100`,
    `Companies: ${db.enterprise.companies.active} active`,
    `Products: ${db.enterprise.products.ga} in GA`,
    `Customers: ${db.enterprise.customers.active} active`,
    `Total ARR: $${db.finance.totalARR?.toLocaleString() || 0}`,
    `Audit risk: ${audit?.riskLevel || "low"}`,
    `Decisions: ${eosDecisions.length}`,
    `Active risks: ${eosRisks.filter(r => r.status === "active").length}`,
  ].join(" | ");

  const r = _st().createEnterpriseReport({
    title: `Enterprise Report: ${eosGoal?.title || eosGoalId}`,
    divId: "ent_board", type: "executive", companyId,
    summary,
    data: { dashboard: db, goal: eosGoal, audit, decisions: eosDecisions, risks: eosRisks, memory },
  });

  // Also push a learning lesson
  try {
    _le()?.addLesson?.({
      type: "enterprise_outcome", title: `Enterprise goal completed: ${eosGoal?.title?.slice(0,80) || eosGoalId}`,
      source: "enterprise_workflow", confidence: 80, tags: ["enterprise","level7"],
    });
  } catch {}

  _emit("enterprise:report:generated", { reportId: r.report?.id, eosGoalId, companyId });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE — Enterprise Goal → Audit → Report
// ═══════════════════════════════════════════════════════════════════════════════

async function runEnterprisePipeline(command, { companyId, portfolioId, priority = "high", amountUsd = 0, autoApprove = true } = {}) {
  if (!command) return { ok: false, error: "command required" };
  const steps = [];
  const t0 = Date.now();

  // Step 1: Intake
  const intake = intakeEnterpriseGoal(command, { companyId, portfolioId, priority });
  steps.push({ step: 1, name: "intake", ok: intake.ok });
  if (!intake.ok) return { ok: false, error: intake.error, steps };
  const { eosGoalId } = intake;

  // Step 2: Strategy
  const strategy = buildEnterpriseStrategy(eosGoalId, { companyId });
  steps.push({ step: 2, name: "strategy", ok: !!strategy?.ok });

  // Step 3: Governance
  const gov = governanceGate(eosGoalId, { companyId, spendUsd: amountUsd, autoApprove });
  steps.push({ step: 3, name: "governance", ok: gov.ok, violations: (gov.violations||[]).length });
  if (!gov.ok) {
    return { ok: false, error: "Governance blocked: mandatory policy violation", blockers: gov.blockers, eosGoalId, steps };
  }

  // Step 4: Budget
  if (amountUsd > 0) {
    const bud = allocateBudget(eosGoalId, { companyId, amountUsd });
    steps.push({ step: 4, name: "budget", ok: bud.ok, amountUsd });
  } else {
    steps.push({ step: 4, name: "budget", ok: true, note: "no budget specified" });
  }

  // Step 5: Executive dispatch (Level 6)
  const exec = await dispatchToExecutive(command, eosGoalId, { companyId, priority });
  steps.push({ step: 5, name: "executive_dispatch", ok: exec.ok, eosSteps: (exec.steps||[]).length, healthScore: exec.healthScore });

  // Step 6: Audit
  const audit = runEnterpriseAudit(eosGoalId, { companyId, healthScore: exec.healthScore });
  steps.push({ step: 6, name: "enterprise_audit", ok: audit.ok, riskLevel: audit.audit?.riskLevel });

  // Step 7: Report
  const report = generateEnterpriseReport(eosGoalId, { companyId, audit: audit.audit, healthScore: exec.healthScore });
  steps.push({ step: 7, name: "enterprise_report", ok: report.ok, reportId: report.report?.id });

  _emit("enterprise:pipeline:completed", { eosGoalId, companyId, steps: steps.length, durationMs: Date.now() - t0 });

  return {
    ok: true, eosGoalId, companyId,
    steps, durationMs: Date.now() - t0,
    healthScore: exec.healthScore,
    enterpriseHealth: audit.audit?.enterpriseHealth,
    reportId: report.report?.id,
    riskLevel: audit.audit?.riskLevel,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO SYNC (refresh initiative progress from EOS missions)
// ═══════════════════════════════════════════════════════════════════════════════

function syncPortfolio(portfolioId) {
  const initiatives = _st().listInitiatives({ portfolioId });
  const updated = [];
  for (const init of initiatives) {
    if (!init.execGoalId) continue;
    try {
      const goal = _eosSt()?.getGoal?.(init.execGoalId);
      if (goal) {
        _st().updateInitiative(init.id, { progress: goal.progress || 0, status: goal.status === "completed" ? "completed" : goal.status === "failed" ? "at_risk" : "active" });
        updated.push(init.id);
      }
    } catch {}
  }
  return { ok: true, portfolioId, updated };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-ORG MISSION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

function getCrossOrgMissionStatus({ companyId, limit = 20 } = {}) {
  const eosMissions = _eosSt()?.listExecMissions?.({ limit: limit * 3 }) || [];
  const filtered = companyId
    ? eosMissions.filter(m => m.tags?.includes(companyId) || !m.goalId)
    : eosMissions;

  const summary = {
    total: filtered.length,
    active: filtered.filter(m => m.status === "active").length,
    completed: filtered.filter(m => m.status === "completed").length,
    failed: filtered.filter(m => m.status === "failed").length,
    byOrg: {},
  };
  for (const m of filtered) {
    for (const org of (m.orgTargets || [])) {
      summary.byOrg[org] = (summary.byOrg[org] || 0) + 1;
    }
  }
  return { ok: true, missions: filtered.slice(0, limit), summary };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE SCAN
// ═══════════════════════════════════════════════════════════════════════════════

function runComplianceScan({ companyId, framework = "SOC2" } = {}) {
  const controls = _st().listControls({ framework, status: "active" });
  const policies = _st().listEnterprisePolicies({ companyId });
  const violations = _st().evaluateEnterprisePolicy({ companyId }).violations || [];
  const auditTrail = _st().getAuditTrail({ companyId, limit: 50 });

  const complianceScore = Math.max(0, 100
    - violations.filter(v => v.enforcement === "mandatory").length * 10
    - controls.filter(c => c.status === "failed").length * 5
  );

  _st().updateEnterpriseKpi("ent_compliance", { complianceScore });
  _st().addAuditEntry({ entityId: companyId || "global", entityType: "compliance_scan", action: "completed", actor: "ent_compliance", companyId, detail: `score=${complianceScore} framework=${framework}` });

  return { ok: true, companyId, framework, complianceScore, controls: controls.length, policies: policies.length, violations: violations.length, auditEntries: auditTrail.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE-WIDE RISK SCORING
// ═══════════════════════════════════════════════════════════════════════════════

function scoreEnterpriseRisk({ companyId } = {}) {
  const entHealth = _st().getEnterpriseHealth();
  const eosRisks  = _eosSt()?.listRisks?.({ status: "active" }) || [];
  const violations = _st().evaluateEnterprisePolicy({}).violations || [];
  const highChurnCustomers = _st().listCustomers({ churnRisk: "high", companyId }).length;
  const failedControls = _st().listControls({ status: "failed" }).length;

  const riskScore = Math.min(100, 0
    + eosRisks.filter(r => r.severity === "critical").length * 20
    + eosRisks.filter(r => r.severity === "high").length * 10
    + violations.filter(v => v.enforcement === "mandatory").length * 8
    + highChurnCustomers * 3
    + failedControls * 5
    + Math.max(0, 70 - entHealth.score) * 0.5
  );

  const overallRisk = riskScore >= 60 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "medium" : "low";

  _st().addAuditEntry({ entityId: companyId || "global", entityType: "risk_score", action: "computed", actor: "ent_risk", companyId, detail: `score=${riskScore} level=${overallRisk}` });

  return { ok: true, riskScore, overallRisk, breakdown: { eosRisks: eosRisks.length, violations: violations.length, highChurnCustomers, failedControls, healthScore: entHealth.score } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function bootstrapEnterprisePolicies() {
  const policies = [
    { title: "Enterprise Data Residency Policy", category: "compliance", enforcement: "mandatory", rules: [{ type: "data_region", allowed: ["global","US","IN","EU"] }] },
    { title: "Enterprise Spend Governance", category: "financial", enforcement: "advisory", rules: [{ type: "spend_cap", limit: 100000 }] },
    { title: "Enterprise Headcount Governance", category: "hr", enforcement: "advisory", rules: [{ type: "headcount", limit: 500 }] },
    { title: "Enterprise Approval Gate", category: "governance", enforcement: "mandatory", rules: [{ type: "approval_required", applies_to: ["budget_over_10k"] }] },
  ];
  let created = 0;
  for (const p of policies) {
    const r = _st().createEnterprisePolicy(p);
    if (r.ok) created++;
  }
  return { ok: true, created };
}

function bootstrapEnterpriseControls() {
  const controls = [
    { title: "Access Control Review",       framework: "SOC2", category: "access",   automated: false },
    { title: "Data Encryption at Rest",     framework: "SOC2", category: "data",     automated: true  },
    { title: "API Rate Limiting",           framework: "SOC2", category: "infra",    automated: true  },
    { title: "Audit Log Retention",         framework: "SOC2", category: "audit",    automated: true  },
    { title: "GDPR Data Subject Requests",  framework: "GDPR", category: "privacy",  automated: false },
    { title: "PCI DSS Tokenization",        framework: "PCI",  category: "payments", automated: true  },
  ];
  let created = 0;
  for (const c of controls) {
    const r = _st().createControl(c);
    if (r.ok) created++;
  }
  return { ok: true, created };
}

function subscribeEnterpriseEvents() {
  try {
    const bus = _bus();
    if (!bus) return;
    // Auto-audit when EOS pipeline completes
    bus.subscribe("eos:pipeline:completed", data => {
      try { _st().addAuditEntry({ entityId: data.goalId, entityType: "eos_pipeline", action: "completed", actor: "ent_audit", detail: JSON.stringify({ healthScore: data.healthScore }).slice(0,200) }); } catch {}
    });
    // Flag high-churn customers
    bus.subscribe("enterprise:customer:created", data => {
      try { _st().addAuditEntry({ entityId: data.id, entityType: "customer", action: "created", actor: "ent_customer", companyId: data.companyId }); } catch {}
    });
    // Track product stage changes
    bus.subscribe("enterprise:product:stage", data => {
      try { _st().addAuditEntry({ entityId: data.id, entityType: "product_stage", action: `${data.from}→${data.to}`, actor: "ent_product" }); } catch {}
    });
  } catch {}
}

module.exports = {
  intakeEnterpriseGoal, buildEnterpriseStrategy, governanceGate, allocateBudget,
  dispatchToExecutive, runEnterpriseAudit, generateEnterpriseReport,
  runEnterprisePipeline,
  syncPortfolio, getCrossOrgMissionStatus,
  runComplianceScan, scoreEnterpriseRisk,
  bootstrapEnterprisePolicies, bootstrapEnterpriseControls,
  subscribeEnterpriseEvents,
};
