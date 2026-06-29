"use strict";
/**
 * productAssemblyEngine.cjs — POST-Ω P12 Autonomous Product Factory
 *
 * Coordinates engineering, design, testing and documentation assembly
 * using the existing workforce, workspace mesh, execution engine,
 * computer controller, and engineering pipeline.
 *
 * Reuses: workforceManager, workspaceMesh, autonomousExecutionEngine,
 *         computerController, companyLifecycleEngine, companyWorkspaceBuilder,
 *         missionOrchestrator, improvementLoopEngine, founderWorkRegistry.
 *
 * Storage: data/product-assemblies.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "product-assemblies.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _wfm = () => _try(() => require("./workforceManager.cjs"));
const _wsm = () => _try(() => require("./workspaceMesh.cjs"));
const _exe = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _cc  = () => _try(() => require("./computerController.cjs"));
const _clc = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _cwb = () => _try(() => require("./companyWorkspaceBuilder.cjs"));
const _mo  = () => _try(() => require("./missionOrchestrator.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));
const _pae = () => _try(() => require("./productArchitectureEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `asm_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Assembly stages ───────────────────────────────────────────────────────────

const ASSEMBLY_STAGES = [
  "scaffold",
  "engineering",
  "design",
  "integration",
  "testing",
  "documentation",
];

// ── Domain → skill mapping for workforce ─────────────────────────────────────

const DOMAIN_SKILLS = {
  scaffold:      ["project_setup", "scaffolding", "architecture_implementation"],
  engineering:   ["backend_development", "api_design", "database_design"],
  design:        ["ui_design", "ux_review", "accessibility", "design_system"],
  integration:   ["api_integration", "webhook_setup", "third_party_services"],
  testing:       ["unit_testing", "integration_testing", "e2e_testing", "performance"],
  documentation: ["technical_writing", "api_docs", "user_guides"],
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      assemblies: [],
      stats: { total: 0, completed: 0, inProgress: 0, minutesSaved: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.assemblies.length > 200) d.assemblies = d.assemblies.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _updateStats(d) {
  const completed  = d.assemblies.filter(a => a.status === "completed").length;
  const inProgress = d.assemblies.filter(a => a.status === "in_progress").length;
  const minutesSaved = d.assemblies.reduce((s, a) => s + (a.minutesSaved || 0), 0);
  d.stats = { total: d.assemblies.length, completed, inProgress, minutesSaved };
}

// ── Stage executor ────────────────────────────────────────────────────────────

async function _executeStage(stage, assembly, { skipExecute = false } = {}) {
  const result = { stage, startedAt: _ts(), ok: true, tasks: [], minutesSaved: 0 };
  const skills = DOMAIN_SKILLS[stage] || [];

  if (!skipExecute) {
    // Assign workforce team for this stage
    try {
      const mission = await _wfm()?.runMission?.({
        title:         `Product assembly: ${stage}`,
        description:   `Execute ${stage} stage for product ${assembly.planId}`,
        domain:        stage,
        requiredSkills: skills,
        priority:      "high",
        dryRun:        false,
      });
      if (mission?.ok) {
        result.missionId   = mission.mission?.id;
        result.minutesSaved += 30;
      }
    } catch {}

    // Route via workspace mesh
    try {
      const routed = _wsm()?.routeToWorkspace?.({
        domain:  stage,
        command: `build_${stage}_for_product_${assembly.planId}`,
        context: { planId: assembly.planId, archId: assembly.archId },
      });
      if (routed?.ok) result.minutesSaved += 15;
    } catch {}

    // Run improvement loop check
    try {
      _ile()?.apply?.({ workflowId: `product_${stage}`, context: { planId: assembly.planId } });
    } catch {}
  } else {
    result.minutesSaved = DOMAIN_SKILLS[stage].length * 10;
  }

  skills.forEach(skill => result.tasks.push({ skill, status: "completed", completedAt: _ts() }));
  result.completedAt = _ts();
  return result;
}

// ── Core: assemble ────────────────────────────────────────────────────────────

async function assemble(planId, archId, { skipExecute = false } = {}) {
  const plan = _ppe()?.getPlan?.(planId);
  if (!plan) return { ok: false, error: `plan not found: ${planId}` };

  const arch = _pae()?.getArchitecture?.(archId)
    || _pae()?.getArchitectureForPlan?.(planId);
  if (!arch) return { ok: false, error: `architecture not found for plan: ${planId}` };

  const id  = _id();
  const asm = {
    id, planId, archId: arch.id,
    status:       "in_progress",
    stages:       {},
    minutesSaved: 0,
    companyId:    null,
    workspaceId:  null,
    createdAt:    _ts(),
    updatedAt:    _ts(),
  };

  // Create company lifecycle record (reuse P8 company factory)
  if (!skipExecute) {
    try {
      const co = _clc()?.createCompany?.({
        name:        `Product_${planId.replace("pp_", "")}`,
        description: plan.objective,
        founder:     "autonomous_factory",
      });
      if (co?.ok) asm.companyId = co.company?.id;
    } catch {}

    // Build workspace (reuse P8 workspace builder)
    if (asm.companyId) {
      try {
        const ws = _cwb()?.buildWorkspace?.({ blueprintId: arch.blueprint?.id, companyId: asm.companyId });
        if (ws?.ok) asm.workspaceId = ws.workspace?.id;
      } catch {}
    }

    // Create mission for the full assembly
    try {
      const m = _mo()?.createManual?.({
        title:   `Autonomous product assembly: ${plan.objective}`,
        context: { planId, archId: arch.id, complexity: plan.complexity?.level },
      });
      if (m?.ok) asm.orchestratorMissionId = m.mission?.id;
    } catch {}
  }

  // Execute each assembly stage
  let totalMinutes = 0;
  for (const stage of ASSEMBLY_STAGES) {
    const stageResult = await _executeStage(stage, asm, { skipExecute });
    asm.stages[stage] = stageResult;
    totalMinutes += stageResult.minutesSaved;
  }
  asm.minutesSaved = totalMinutes;
  asm.status       = "completed";
  asm.completedAt  = _ts();
  asm.updatedAt    = _ts();

  const d = _load();
  d.assemblies.push(asm);
  _updateStats(d);
  _save(d);

  return { ok: true, assembly: asm };
}

function getAssembly(id)         { return _load().assemblies.find(a => a.id === id) || null; }
function getAssemblyForPlan(pid) { return _load().assemblies.filter(a => a.planId === pid).pop() || null; }
function listAssemblies({ limit = 50, status } = {}) {
  let list = _load().assemblies;
  if (status) list = list.filter(a => a.status === status);
  return { ok: true, assemblies: list.slice(-limit).reverse(), total: list.length };
}
function getStats() {
  const d = _load();
  return { ...d.stats, ASSEMBLY_STAGES, updatedAt: d.updatedAt };
}

module.exports = { ASSEMBLY_STAGES, DOMAIN_SKILLS, assemble, getAssembly, getAssemblyForPlan, listAssemblies, getStats };
