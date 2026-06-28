"use strict";
/**
 * companyLifecycleEngine.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Tracks and manages a company through 6 lifecycle stages:
 *   planning → building → testing → launch → growth → scale → maintenance
 *
 * Reuses: companyBlueprintEngine, companyWorkspaceBuilder, workforceManager,
 *         approvalEngine, autonomousExecutionEngine, missionMemory,
 *         platformOrg, enterpriseOrg, executiveOrg, continuousLearningEngine.
 *
 * Storage: data/company-lifecycle.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "company-lifecycle.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _cbe = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _cwb = () => _try(() => require("./companyWorkspaceBuilder.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));
const _ae  = () => _try(() => require("./approvalEngine.cjs"));
const _aee = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _po  = () => _try(() => require("./platformOrg.cjs"));
const _eo  = () => _try(() => require("./enterpriseOrg.cjs"));
const _xo  = () => _try(() => require("./executiveOrg.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `lc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Lifecycle stages ──────────────────────────────────────────────────────────

const STAGES = ["planning","building","testing","launch","growth","scale","maintenance"];

const STAGE_GATES = {
  building:    ["blueprint_approved", "workspace_ready", "team_allocated"],
  testing:     ["core_features_complete", "unit_tests_passing", "staging_deployed"],
  launch:      ["security_review_passed", "load_test_passed", "runbook_complete"],
  growth:      ["first_customers", "payment_live", "support_sla_met"],
  scale:       ["100_customers", "99_9_uptime", "team_expanded"],
  maintenance: ["product_stable", "retention_target_met", "automation_complete"],
};

const STAGE_MISSIONS = {
  planning:    ["architecture_review","requirements_finalization","risk_assessment"],
  building:    ["core_feature_development","database_setup","auth_system","api_development"],
  testing:     ["automated_test_suite","security_audit","performance_testing","uat"],
  launch:      ["staging_deployment","smoke_tests","production_deployment","announcement"],
  growth:      ["customer_onboarding","marketing_campaigns","feature_expansion","analytics_setup"],
  scale:       ["infrastructure_scaling","enterprise_features","team_hiring","process_automation"],
  maintenance: ["technical_debt_reduction","sla_monitoring","user_feedback_loop","quarterly_review"],
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { companies: [], transitions: [], stats: { totalCompanies: 0, launched: 0, scaled: 0 }, updatedAt: null }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.transitions.length > 500) d.transitions = d.transitions.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Registration in platform layer ────────────────────────────────────────────
// Skipped when SKIP_PLATFORM_REGISTER=1 (test mode) to avoid booting
// the long-running agentRuntimeSupervisor timers.

function _registerInPlatform(companyRecord) {
  if (process.env.SKIP_PLATFORM_REGISTER === "1") return;
  _try(() => _po()?.register?.({
    id:          companyRecord.id,
    name:        companyRecord.name,
    type:        "company",
    templateId:  companyRecord.templateId,
    status:      "registered",
  }));
  _try(() => _eo()?.register?.({
    id:    companyRecord.id,
    name:  companyRecord.name,
    type:  "enterprise_entity",
    tier:  "standard",
  }));
  _try(() => _xo()?.register?.({
    id:    companyRecord.id,
    name:  companyRecord.name,
    type:  "managed_company",
    tier:  "standard",
  }));
}

// ── Company creation ──────────────────────────────────────────────────────────

function createCompany({ blueprintId, workspaceId, name, templateId } = {}) {
  if (!blueprintId && !name) return { ok: false, error: "blueprintId or name required" };

  const blueprint = blueprintId ? _cbe()?.getBlueprint?.(blueprintId) : null;
  const workspace = workspaceId ? _cwb()?.getWorkspace?.(workspaceId) : null;

  const id = _id();
  const companyName = name || blueprint?.name || "New Company";

  const company = {
    id,
    name:        companyName,
    blueprintId: blueprintId || null,
    workspaceId: workspaceId || null,
    templateId:  templateId || blueprint?.templateId || "saas",
    stage:       "planning",
    stageHistory:[{ stage: "planning", enteredAt: _ts(), gates: [] }],
    gates:       {},         // gate → { passed: bool, passedAt, evidence }
    missions:    [],
    risks:       blueprint?.risks || [],
    kpis:        { ...blueprint?.kpis || {} },
    roadmap:     blueprint?.roadmap || [],
    readinessScore: workspace?.readinessScore || 0,
    minutesSaved:   blueprint?.minutesSaved   || 0,
    createdAt:   _ts(),
    updatedAt:   _ts(),
    launchedAt:  null,
  };

  // Register in platform layers
  _registerInPlatform(company);

  const d = _load();
  d.companies.push(company);
  d.stats.totalCompanies++;
  _save(d);

  return { ok: true, company };
}

// ── Stage transition ──────────────────────────────────────────────────────────

async function advanceStage(companyId, { force = false } = {}) {
  const d = _load();
  const company = d.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: "company not found" };

  const currentIdx = STAGES.indexOf(company.stage);
  if (currentIdx === STAGES.length - 1) return { ok: false, error: "already at final stage" };

  const nextStage  = STAGES[currentIdx + 1];
  const gates      = STAGE_GATES[nextStage] || [];
  const missing    = !force ? gates.filter(g => !company.gates[g]?.passed) : [];

  if (missing.length > 0) {
    return { ok: false, error: `gates not met: ${missing.join(", ")}`, missing };
  }

  // Approval for high-risk stages
  if (["launch","scale"].includes(nextStage) && !force) {
    _try(() => _ae()?.requestApproval?.({
      workflowId:  `company_${companyId}_advance_to_${nextStage}`,
      description: `Advance ${company.name} to ${nextStage} stage`,
      riskLevel:   nextStage === "launch" ? "high" : "medium",
      context:     { companyId, fromStage: company.stage, toStage: nextStage },
    }));
  }

  const prev = company.stage;
  company.stage = nextStage;
  company.stageHistory.push({ stage: nextStage, enteredAt: _ts(), gates: gates });
  company.updatedAt = _ts();
  if (nextStage === "launch") { company.launchedAt = _ts(); d.stats.launched++; }
  if (nextStage === "scale")  { d.stats.scaled++; }

  d.transitions.push({ companyId, companyName: company.name, from: prev, to: nextStage, ts: _ts(), forced: force });
  _save(d);

  // Trigger workforce mission for new stage
  const stageMissions = STAGE_MISSIONS[nextStage] || [];
  if (stageMissions.length > 0) {
    await _try(() => _wm()?.runMission?.({
      title:    `${company.name}: ${nextStage} stage setup`,
      domain:   nextStage,
      priority: nextStage === "launch" ? "high" : "medium",
      dryRun:   true,
    }));
  }

  _try(() => _cle()?.createLesson?.({
    type: "company_stage_advance", title: `${company.name}: ${prev} → ${nextStage}`,
    source: "companyLifecycleEngine", confidence: 0.9,
    tags: ["company_factory", "lifecycle", nextStage],
    metadata: { companyId, from: prev, to: nextStage },
  }));

  return { ok: true, company, from: prev, to: nextStage };
}

// ── Gate management ───────────────────────────────────────────────────────────

function passGate(companyId, gate, { evidence = "" } = {}) {
  const d = _load();
  const company = d.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: "company not found" };
  company.gates[gate] = { passed: true, passedAt: _ts(), evidence };
  company.updatedAt   = _ts();
  _save(d);
  return { ok: true, gate, companyId };
}

function getReadinessForStage(companyId, targetStage) {
  const d = _load();
  const company = d.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: "company not found" };
  const gates   = STAGE_GATES[targetStage] || [];
  const passed  = gates.filter(g => company.gates[g]?.passed);
  const missing = gates.filter(g => !company.gates[g]?.passed);
  return {
    ok: true, companyId, targetStage,
    readiness: gates.length > 0 ? Math.round(passed.length / gates.length * 100) : 100,
    passed, missing,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getCompany(id) {
  return _load().companies.find(c => c.id === id) || null;
}

function listCompanies({ stage, templateId, limit = 50 } = {}) {
  let list = _load().companies;
  if (stage)      list = list.filter(c => c.stage === stage);
  if (templateId) list = list.filter(c => c.templateId === templateId);
  return { ok: true, companies: list.slice(-limit) };
}

function updateKPIs(companyId, kpiUpdates) {
  const d = _load();
  const company = d.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: "company not found" };
  Object.assign(company.kpis, kpiUpdates);
  company.updatedAt = _ts();
  _save(d);
  return { ok: true, kpis: company.kpis };
}

function getStats() {
  const d = _load();
  const byStage = {};
  for (const c of d.companies) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
  return { ...d.stats, byStage, updatedAt: d.updatedAt };
}

module.exports = {
  STAGES,
  STAGE_GATES,
  createCompany,
  advanceStage,
  passGate,
  getReadinessForStage,
  getCompany,
  listCompanies,
  updateKPIs,
  getStats,
};
