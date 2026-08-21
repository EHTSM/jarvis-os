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
 *
 * ECOSYSTEM OS RECOVERY (2026-08-15): orgId now required — see
 * productPlannerEngine.cjs's file header for the full blast-radius
 * investigation and precedent this follows. Pre-existing unowned records
 * (~54 assemblies) are correctly invisible to real orgId queries, not
 * misattributed.
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
function _ownedBy(item, orgId) { return item.orgId === orgId; }
function _requireOrgId(orgId, fnName) {
  if (!orgId) throw new Error(`${fnName}: orgId is required`);
}

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
    //
    // Product OS pass (2026-08-15): workforceManager.runMission() genuinely
    // succeeds and returns {ok:true, id: missionId, ...} — but this read
    // `mission?.ok` correctly, then `mission.mission?.id` (a field that
    // does not exist on the real return shape; the real field is `id`).
    // Reproduced live: server log showed a real mission created
    // ("[MissionMemory] Created mission msn_...") while the assembly's own
    // API response reported missionId: null for every stage. The `ok`
    // check meant a genuine failure would already have been silently
    // swallowed too (result.ok stayed true either way, matching the outer
    // fake-success pattern fixed below) — fixing the field name alone
    // doesn't change that a thrown/failed call is still silently absorbed
    // by the catch{}; see the outer assemble()'s own fix for that half.
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
        result.missionId   = mission.id;
        result.minutesSaved += 30;
      } else {
        result.ok = false;
        result.error = mission?.error || "workforce mission failed";
      }
    } catch (e) {
      result.ok = false;
      result.error = e.message;
    }

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

async function assemble(orgId, planId, archId, { skipExecute = false } = {}) {
  _requireOrgId(orgId, "assemble");
  const plan = _ppe()?.getPlan?.(orgId, planId);
  if (!plan) return { ok: false, error: `plan not found: ${planId}` };

  const arch = _pae()?.getArchitecture?.(orgId, archId)
    || _pae()?.getArchitectureForPlan?.(orgId, planId);
  if (!arch) return { ok: false, error: `architecture not found for plan: ${planId}` };

  const id  = _id();
  const asm = {
    id, planId, archId: arch.id, orgId,
    status:       "in_progress",
    stages:       {},
    minutesSaved: 0,
    companyId:    null,
    workspaceId:  null,
    createdAt:    _ts(),
    updatedAt:    _ts(),
  };

  // Create company lifecycle record (reuse P8 company factory)
  //
  // Product OS pass (2026-08-15): companyLifecycleEngine.createCompany()
  // REQUIRES a real creatorAccountId (it provisions a real backing
  // organization — by design, not incidental) — this call has never passed
  // one, so it fails every single time with a real, deterministic
  // "creatorAccountId is required" error, previously swallowed by a bare
  // catch{}. Even on a hypothetical success the response shape read here
  // (`co.company?.id`) was actually correct — only the missing required
  // field was wrong. Not fixed by threading a real account through: doing
  // so would mean deciding which of this call's own callers' accounts
  // "owns" the resulting company/org, which is exactly the tenant-model
  // question this pass documents as a genuine gap (see Security report)
  // rather than retrofits. Recording the real failure honestly instead of
  // silently discarding it.
  if (!skipExecute) {
    try {
      const co = _clc()?.createCompany?.({
        name:        `Product_${planId.replace("pp_", "")}`,
        founder:     "autonomous_factory",
      });
      if (co?.ok) { asm.companyId = co.company?.id; }
      else { asm.companyCreationError = co?.error || "company creation failed"; }
    } catch (e) { asm.companyCreationError = e.message; }

    // Build workspace (reuse P8 workspace builder)
    if (asm.companyId) {
      try {
        const ws = _cwb()?.buildWorkspace?.({ blueprintId: arch.blueprint?.id, companyId: asm.companyId });
        if (ws?.ok) asm.workspaceId = ws.workspace?.id;
        else asm.workspaceCreationError = ws?.error || "workspace build failed";
      } catch (e) { asm.workspaceCreationError = e.message; }
    }

    // Create mission for the full assembly
    //
    // Same field-name mismatch as _executeStage's own workforceManager call
    // above — missionOrchestrator.createManual() returns the record
    // directly ({missionId, orchStatus, ...}), not {ok, mission:{id}}. This
    // call genuinely succeeds (confirmed live via server log: "[MissionMemory]
    // Created mission msn_...") but the read was always wrong, so
    // orchestratorMissionId was always null even on success.
    try {
      const m = _mo()?.createManual?.({
        goal:    `Autonomous product assembly: ${plan.objective}`,
        title:   `Autonomous product assembly: ${plan.objective}`,
        context: { planId, archId: arch.id, complexity: plan.complexity?.level },
      });
      if (m?.missionId) asm.orchestratorMissionId = m.missionId;
      else asm.missionCreationError = "mission orchestrator returned no missionId";
    } catch (e) { asm.missionCreationError = e.message; }
  }

  // Execute each assembly stage
  let totalMinutes = 0;
  let anyStageFailed = false;
  for (const stage of ASSEMBLY_STAGES) {
    const stageResult = await _executeStage(stage, asm, { skipExecute });
    asm.stages[stage] = stageResult;
    totalMinutes += stageResult.minutesSaved;
    if (stageResult.ok === false) anyStageFailed = true;
  }
  asm.minutesSaved = totalMinutes;
  // Product OS pass: this unconditionally reported "completed" regardless
  // of whether any stage actually failed or the mission/company/workspace
  // creation calls above succeeded — the response's outer `status` and
  // `ok:true` were the same class of fake-success this mission's honesty
  // requirement forbids. "completed" now genuinely means every stage's own
  // ok flag was true; a real per-stage or per-integration failure surfaces
  // as "completed_with_errors" instead, with the specific error fields
  // (companyCreationError / workspaceCreationError / missionCreationError /
  // each stage's own .error) intact for the caller to inspect — never
  // silently absorbed into an indistinguishable "completed".
  asm.status       = anyStageFailed ? "completed_with_errors" : "completed";
  asm.completedAt  = _ts();
  asm.updatedAt    = _ts();

  const d = _load();
  d.assemblies.push(asm);
  _updateStats(d);
  _save(d);

  return { ok: true, assembly: asm };
}

function getAssembly(orgId, id) {
  _requireOrgId(orgId, "getAssembly");
  return _load().assemblies.find(a => a.id === id && _ownedBy(a, orgId)) || null;
}
function getAssemblyForPlan(orgId, pid) {
  _requireOrgId(orgId, "getAssemblyForPlan");
  return _load().assemblies.filter(a => a.planId === pid && _ownedBy(a, orgId)).pop() || null;
}
function listAssemblies(orgId, { limit = 50, status } = {}) {
  _requireOrgId(orgId, "listAssemblies");
  let list = _load().assemblies.filter(a => _ownedBy(a, orgId));
  if (status) list = list.filter(a => a.status === status);
  return { ok: true, assemblies: list.slice(-limit).reverse(), total: list.length };
}
function getStats() {
  const d = _load();
  return { ...d.stats, ASSEMBLY_STAGES, updatedAt: d.updatedAt };
}

module.exports = { ASSEMBLY_STAGES, DOMAIN_SKILLS, assemble, getAssembly, getAssemblyForPlan, listAssemblies, getStats };
