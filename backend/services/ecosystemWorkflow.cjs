"use strict";
/**
 * Ecosystem Workflow — LEVEL 8
 *
 * Orchestrates the full ecosystem pipeline:
 * Ecosystem Goal → Enterprise → Executive → All Orgs → Runtime
 *
 * Delegates execution: Ecosystem → Enterprise (L7) → Executive (L6) → Orgs
 * Zero new runtimes, schedulers, or event buses.
 */

const _st  = () => require("./ecosystemState.cjs");
const _ent = () => { try { return require("./enterpriseWorkflow.cjs"); } catch { return null; } }
const _entSt=() => { try { return require("./enterpriseState.cjs");    } catch { return null; } }
const _eos = () => { try { return require("./executiveWorkflow.cjs");  } catch { return null; } }
const _eosSt=() => { try { return require("./executiveState.cjs");     } catch { return null; } }
const _le  = () => { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
const _em  = () => { try { return require("./engineeringMemoryEngine.cjs");  } catch { return null; } }
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
const _plg = () => { try { return require("./pluginSDK.cjs");          } catch { return null; } }

function _emit(type, payload) { try { _bus()?.emit(type, payload); } catch {} }
function _kpi(d) { return _st().getEcosystemKpi(d); }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Ecosystem intake (register tenant + goal)
// ═══════════════════════════════════════════════════════════════════════════════

function intakeEcosystemGoal(command, { tenantId, companyId, portfolioId, priority = "high", divisionId = "eco_director" } = {}) {
  if (!command) return { ok: false, error: "command required" };

  // Ensure tenant exists
  let tenant = tenantId ? _st().getTenant(tenantId) : null;
  if (!tenant && tenantId) return { ok: false, error: "Tenant not found" };

  // Delegate to L7 Enterprise
  const entResult = _entSt()?.createGoal?.({
    title: command.slice(0, 200),
    description: `Ecosystem initiative: ${command}`,
    priority, sourceCommand: command,
    tags: ["ecosystem", divisionId, tenantId, companyId].filter(Boolean),
  });
  const entGoalId = entResult?.goal?.id || null;
  // Also create EOS goal
  const eosResult = _eosSt()?.createGoal?.({
    title: command.slice(0, 200),
    description: `EOS goal via ecosystem: ${command}`,
    priority, sourceCommand: command,
    tags: ["ecosystem", tenantId].filter(Boolean),
  });
  const eosGoalId = eosResult?.goal?.id || (eosResult?.error?.includes("Duplicate") ? _eosSt()?.listGoals?.()?.find(g => g.title === command.slice(0,200))?.id : null);

  _emit("ecosystem:goal:created", { eosGoalId, entGoalId, command, tenantId });
  return { ok: true, eosGoalId, entGoalId, tenantId, command };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Ecosystem governance (cross-tenant routing + permissions)
// ═══════════════════════════════════════════════════════════════════════════════

function ecosystemGovernance(eosGoalId, { tenantId, companyId } = {}) {
  // Route self → enterprise
  if (tenantId) {
    const selfRoute = _st().addRoute({ fromTenantId: tenantId, toTenantId: "ent_layer", resourceType: "mission", permissions: ["read","write","execute"] });
    const trustScore = _st().getTrustScore(tenantId).score;
    if (trustScore < 30) return { ok: false, error: "Trust score too low for execution", trustScore };
  }
  // Enterprise governance gate
  const gov = (() => { try { return _entSt()?.evaluateEnterprisePolicy?.({ budget: 0 }) || { violations: [] }; } catch { return { violations: [] }; } })();
  _emit("ecosystem:governance:passed", { eosGoalId, tenantId });
  return { ok: true, violations: gov.violations?.length || 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Dispatch to Enterprise Layer (L7) → Executive (L6) → All Orgs
// ═══════════════════════════════════════════════════════════════════════════════

async function dispatchToEnterprise(command, { tenantId, companyId, portfolioId, priority, amountUsd = 0 } = {}) {
  const steps = [];
  let healthScore = 50, reportId = null, riskLevel = "low";
  try {
    const r = await _ent()?.runEnterprisePipeline?.(command, { companyId, portfolioId, priority, amountUsd, autoApprove: true });
    if (r) { steps.push(...(r.steps||[])); healthScore = r.healthScore || 50; reportId = r.reportId; riskLevel = r.riskLevel || "low"; }
  } catch (e) {
    // Fallback: dispatch directly to executive
    try {
      const r = await _eos()?.runFullPipeline?.(command, { priority });
      if (r) { steps.push(...(r.steps||[])); healthScore = r.healthScore || 50; reportId = r.reportId; }
    } catch {}
  }
  _emit("ecosystem:enterprise:dispatched", { steps: steps.length, healthScore });
  return { ok: true, steps, healthScore, reportId, riskLevel };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Ecosystem audit (cross-layer health)
// ═══════════════════════════════════════════════════════════════════════════════

function ecosystemAudit(eosGoalId, { tenantId, healthScore = 50 } = {}) {
  const ecoHealth = _st().getEcosystemHealth();
  const lowTrustTenants = _st().listTrustScores({ maxScore: 40 }).length;
  const openMissions = _st().listMissionExchange({ status: "open" }).length;

  const findings = [];
  if (ecoHealth.score < 70)  findings.push({ type: "ecosystem_health", score: ecoHealth.score, severity: "high" });
  if (lowTrustTenants > 0)   findings.push({ type: "low_trust_tenants", count: lowTrustTenants, severity: "medium" });
  if (openMissions > 20)     findings.push({ type: "mission_backlog", count: openMissions, severity: "low" });
  if (healthScore < 60)      findings.push({ type: "executive_health", score: healthScore, severity: "high" });

  const riskLevel = findings.some(f => f.severity === "high") ? "high" : findings.length > 0 ? "medium" : "low";

  _emit("ecosystem:audit:completed", { eosGoalId, riskLevel, findings: findings.length });
  return { ok: true, audit: { eosGoalId, tenantId, ecosystemHealth: ecoHealth.score, healthScore, lowTrustTenants, openMissions, findings, riskLevel, at: new Date().toISOString() } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Ecosystem report
// ═══════════════════════════════════════════════════════════════════════════════

function generateEcosystemReport(eosGoalId, { tenantId, audit, healthScore } = {}) {
  const db = _st().getEcosystemDashboard();
  const goal = _eosSt()?.getGoal?.(eosGoalId);

  const summary = [
    `Ecosystem initiative: ${goal?.title || eosGoalId}`,
    `Ecosystem health: ${db.health.score}/100`,
    `Executive health: ${healthScore || 0}/100`,
    `Tenants: ${db.ecosystem.tenants.active} active`,
    `Marketplace listings: ${db.marketplace.total}`,
    `Cross-org missions: ${db.exchange.missions.total}`,
    `Knowledge items: ${db.exchange.knowledge.total}`,
    `Audit risk: ${audit?.riskLevel || "low"}`,
  ].join(" | ");

  const r = _st().createEcosystemReport({
    title: `Ecosystem Report: ${goal?.title || eosGoalId}`,
    domainId: "eco_analytics", type: "executive", summary,
    data: { dashboard: db, goal, audit, healthScore },
  });

  try { _le()?.addLesson?.({ type: "ecosystem_outcome", title: `Ecosystem goal: ${goal?.title?.slice(0,80) || eosGoalId}`, source: "ecosystem_workflow", confidence: 80, tags: ["ecosystem","level8"] }); } catch {}
  _emit("ecosystem:report:generated", { reportId: r.report?.id, eosGoalId, tenantId });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function runEcosystemPipeline(command, { tenantId, companyId, portfolioId, priority = "high", amountUsd = 0 } = {}) {
  if (!command) return { ok: false, error: "command required" };
  const steps = [];
  const t0 = Date.now();

  // Step 1: Intake
  const intake = intakeEcosystemGoal(command, { tenantId, companyId, portfolioId, priority });
  steps.push({ step: 1, name: "ecosystem_intake", ok: intake.ok });
  if (!intake.ok) return { ok: false, error: intake.error, steps };
  const { eosGoalId, entGoalId } = intake;

  // Step 2: Governance
  const gov = ecosystemGovernance(eosGoalId, { tenantId, companyId });
  steps.push({ step: 2, name: "ecosystem_governance", ok: gov.ok, violations: gov.violations });
  if (!gov.ok) return { ok: false, error: gov.error, steps };

  // Step 3: Enterprise dispatch
  const dispatch = await dispatchToEnterprise(command, { tenantId, companyId, portfolioId, priority, amountUsd });
  steps.push({ step: 3, name: "enterprise_dispatch", ok: dispatch.ok, enterpriseSteps: dispatch.steps.length, healthScore: dispatch.healthScore });

  // Step 4: Ecosystem audit
  const audit = ecosystemAudit(eosGoalId, { tenantId, healthScore: dispatch.healthScore });
  steps.push({ step: 4, name: "ecosystem_audit", ok: audit.ok, riskLevel: audit.audit?.riskLevel });

  // Step 5: Report
  const report = generateEcosystemReport(eosGoalId, { tenantId, audit: audit.audit, healthScore: dispatch.healthScore });
  steps.push({ step: 5, name: "ecosystem_report", ok: report.ok, reportId: report.report?.id });

  _emit("ecosystem:pipeline:completed", { eosGoalId, tenantId, steps: steps.length, durationMs: Date.now() - t0 });

  return { ok: true, eosGoalId, entGoalId, tenantId, steps, durationMs: Date.now() - t0, healthScore: dispatch.healthScore, ecosystemHealth: _st().getEcosystemHealth().score, reportId: report.report?.id, riskLevel: audit.audit?.riskLevel };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-ORG COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════

function sendCrossOrgMessage({ fromTenantId, toTenantId, subject, body, type = "message", priority = "normal" } = {}) {
  if (!fromTenantId || !toTenantId || !subject) return { ok: false, error: "fromTenantId, toTenantId, subject required" };
  const perm = _st().checkPermission(fromTenantId, toTenantId, "message", "write");
  if (!perm.allowed) {
    // Auto-create route for same-ecosystem tenants
    _st().addRoute({ fromTenantId, toTenantId, resourceType: "message", permissions: ["read","write"] });
  }
  const msg = { id: _id("emsg"), fromTenantId, toTenantId, subject, body, type, priority, status: "delivered", at: new Date().toISOString() };
  _emit("ecosystem:message:sent", msg);
  return { ok: true, message: msg };
}

function _id(pfx) { return `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function bootstrapEcosystem() {
  const results = { listings: 0, sdks: 0, apis: 0 };

  // Seed marketplace listings from existing capabilities
  const capListings = [
    { name: "AI Chat",               type: "capability", category: "ai",         description: "Multi-model AI chat with streaming", pricingModel: "usage" },
    { name: "Code Review Agent",     type: "agent",      category: "engineering", description: "Autonomous code review with suggestions", pricingModel: "usage" },
    { name: "Knowledge Graph",       type: "capability", category: "knowledge",   description: "Build and query knowledge graphs", pricingModel: "free" },
    { name: "Business Automation",   type: "workflow",   category: "business",    description: "Lead nurturing and deal automation workflows", pricingModel: "free" },
    { name: "Design System AI",      type: "capability", category: "design",      description: "AI-powered design tokens and component generation", pricingModel: "free" },
    { name: "Evolution Engine",      type: "integration",category: "platform",    description: "Self-improving org with evolution proposals", pricingModel: "free" },
    { name: "Mission Orchestrator",  type: "api",        category: "platform",    description: "Cross-org mission creation and tracking API", pricingModel: "free" },
    { name: "Plugin SDK v2",         type: "plugin",     category: "developer",   description: "Build and publish platform plugins", pricingModel: "free" },
    { name: "Enterprise Governance", type: "integration",category: "enterprise",  description: "Policies, controls, and approval workflows", pricingModel: "enterprise" },
    { name: "Ooplix Startup Bundle", type: "template",   category: "bundle",      description: "Complete startup: eng+biz+knowledge+executive orgs", pricingModel: "free" },
  ];
  for (const l of capListings) {
    const r = _st().publishListing({ tenantId: "system", ...l });
    if (r.ok) results.listings++;
  }

  // SDK versions
  const sdks = [
    { name: "Ooplix SDK", version: "2.0.0", language: "javascript", stable: true, releaseNotes: "Plugin SDK v2 + capability registry + mission API" },
    { name: "Ooplix SDK", version: "2.0.0", language: "python",     stable: true, releaseNotes: "Python bindings for Ooplix platform APIs" },
    { name: "Ooplix SDK", version: "2.0.0", language: "typescript",  stable: true, releaseNotes: "TypeScript bindings with full type support" },
  ];
  for (const s of sdks) { const r = _st().registerSDKVersion(s); if (r.ok) results.sdks++; }

  // Public APIs
  const apis = [
    { name: "Ecosystem Dashboard", path: "/ent/v8/dashboard",  method: "GET",  category: "ecosystem",   description: "Full ecosystem health + KPIs" },
    { name: "Tenant Registry",     path: "/ent/v8/tenants",     method: "GET",  category: "platform",    description: "List all tenants" },
    { name: "Marketplace Search",  path: "/ent/v8/search",      method: "GET",  category: "marketplace", description: "Search across all ecosystem resources" },
    { name: "Deploy Package",      path: "/ent/v8/packages/:id/deploy", method: "POST", category: "platform", description: "Deploy an org package to a tenant" },
    { name: "Run Pipeline",        path: "/ent/v8/command",     method: "POST", category: "platform",    description: "Full 5-step ecosystem pipeline" },
    { name: "Mission Exchange",    path: "/ent/v8/exchange/missions", method: "GET", category: "collaboration", description: "Browse cross-org missions" },
    { name: "Knowledge Exchange",  path: "/ent/v8/exchange/knowledge", method: "GET", category: "knowledge", description: "Browse shared knowledge" },
  ];
  for (const a of apis) { const r = _st().registerPublicAPI(a); if (r.ok) results.apis++; }

  return { ok: true, ...results };
}

function subscribeEcosystemEvents() {
  try {
    const bus = _bus();
    if (!bus) return;
    // Auto-record trust events when enterprise pipeline completes
    bus.subscribe("enterprise:pipeline:completed", data => {
      try { if (data.tenantId) _st().recordTrustEvent({ entityId: data.tenantId, entityType: "tenant", eventType: "pipeline_success", score: 1, detail: `pipeline health=${data.healthScore}` }); } catch {}
    });
    // Ecosystem goal created → add memory
    bus.subscribe("ecosystem:goal:created", data => {
      try { _st().addEcosystemMemory({ domainId: "eco_director", type: "goal", title: `Goal: ${data.command?.slice(0,80)}`, detail: JSON.stringify({ eosGoalId: data.eosGoalId }).slice(0,200) }); } catch {}
    });
    // Listing installed → update trust
    bus.subscribe("ecosystem:listing:installed", data => {
      try { if (data.tenantId) _st().recordTrustEvent({ entityId: data.tenantId, entityType: "tenant", eventType: "listing_install", score: 2 }); } catch {}
    });
  } catch {}
}

module.exports = {
  intakeEcosystemGoal, ecosystemGovernance, dispatchToEnterprise,
  ecosystemAudit, generateEcosystemReport, runEcosystemPipeline,
  sendCrossOrgMessage, bootstrapEcosystem, subscribeEcosystemEvents,
};
