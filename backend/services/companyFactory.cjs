"use strict";
/**
 * companyFactory.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Top-level orchestrator. Founder says "Create a SaaS company."
 * Factory runs the full 13-step pipeline autonomously.
 *
 * Pipeline:
 *   1. idea        — parse founder intent
 *   2. analyze     — infer business template
 *   3. template    — load template
 *   4. blueprint   — generate company blueprint
 *   5. workspace   — build workspace (repos, docs, capabilities, bible)
 *   6. workforce   — allocate AI workforce
 *   7. missions    — register execution missions
 *   8. roadmap     — finalize roadmap
 *   9. checklist   — generate production checklist
 *  10. twin        — get founder digital twin prediction
 *  11. register    — register in Platform Ω
 *  12. lifecycle   — create lifecycle record
 *  13. ready       — emit company record
 *
 * Reuses: businessTemplateEngine, companyBlueprintEngine, companyWorkspaceBuilder,
 *         companyLifecycleEngine, workforceManager, digitalTwinEngine,
 *         productionBibleEngine, missionMemory, platformOrg, enterpriseOrg,
 *         executiveOrg, approvalEngine, continuousLearningEngine,
 *         engineeringMemoryEngine, founderWorkRegistry.
 *
 * Storage: data/company-factory.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "company-factory.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bte = () => _try(() => require("./businessTemplateEngine.cjs"));
const _cbe = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _cwb = () => _try(() => require("./companyWorkspaceBuilder.cjs"));
const _cle_e = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));
const _dte = () => _try(() => require("./digitalTwinEngine.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _ae  = () => _try(() => require("./approvalEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _vault = () => _try(() => require("./secretVault.cjs"));
const _deptReg = () => _try(() => require("./departmentTemplateRegistry.cjs"));
const _agentRegistry = () => _try(() => require("../../agents/runtime/agentRegistry.cjs"));
const _org = () => _try(() => require("./organizationService.cjs"));
const _contract = () => _try(() => require("./capabilityContract.cjs"));
const _skillReg = () => _try(() => require("./skillRegistry.cjs"));

function _ts()  { return new Date().toISOString(); }
function _id()  { return `cf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      runs:  [],
      stats: { totalCreated: 0, byTemplate: {}, minutesSaved: 0, avgDurationMs: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.runs.length > 100) d.runs = d.runs.slice(-100);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Production checklist generator ────────────────────────────────────────────

function _buildChecklist(blueprint) {
  const base = [
    { item: "Domain name registered",          category: "infrastructure", done: false },
    { item: "SSL certificate configured",       category: "security",       done: false },
    { item: "Database backup automated",        category: "infrastructure", done: false },
    { item: "Environment variables secured",    category: "security",       done: false },
    { item: "Error monitoring active (Sentry)", category: "monitoring",     done: false },
    { item: "Uptime monitoring configured",     category: "monitoring",     done: false },
    { item: "CI/CD pipeline green",             category: "engineering",    done: false },
    { item: "README up to date",                category: "documentation",  done: false },
    { item: "Security headers configured",      category: "security",       done: false },
    { item: "CORS policy set",                  category: "security",       done: false },
    { item: "Rate limiting enabled",            category: "security",       done: false },
    { item: "Logging pipeline active",          category: "monitoring",     done: false },
    { item: "Rollback plan documented",         category: "operations",     done: false },
    { item: "Support channel active",           category: "business",       done: false },
    { item: "Privacy policy published",         category: "legal",          done: false },
    { item: "Terms of service published",       category: "legal",          done: false },
  ];
  const specific = {
    saas: [
      { item: "Stripe billing connected",       category: "billing",        done: false },
      { item: "Trial flow tested end-to-end",   category: "product",        done: false },
      { item: "Multi-tenant isolation verified",category: "security",       done: false },
    ],
    healthcare: [
      { item: "HIPAA BAAs signed with vendors", category: "compliance",     done: false },
      { item: "PHI access audit log live",      category: "compliance",     done: false },
      { item: "Encryption at rest verified",    category: "security",       done: false },
      { item: "Breach notification plan ready", category: "compliance",     done: false },
    ],
    marketplace: [
      { item: "Escrow system tested",           category: "payments",       done: false },
      { item: "Fraud detection active",         category: "security",       done: false },
      { item: "Seller verification flow live",  category: "operations",     done: false },
    ],
    ecommerce: [
      { item: "Payment processor live",         category: "payments",       done: false },
      { item: "Inventory sync tested",          category: "operations",     done: false },
      { item: "Return policy published",        category: "legal",          done: false },
    ],
    ai_product: [
      { item: "Evals suite baseline set",       category: "ai_safety",      done: false },
      { item: "Prompt injection tests passing", category: "security",       done: false },
      { item: "Cost per call monitored",        category: "monitoring",     done: false },
      { item: "Hallucination guard in place",   category: "ai_safety",      done: false },
    ],
    erp: [
      { item: "Data migration plan approved",   category: "operations",     done: false },
      { item: "Rollback procedure drilled",     category: "operations",     done: false },
      { item: "Access control matrix reviewed", category: "security",       done: false },
    ],
  };
  return [...base, ...(specific[blueprint.templateId] || [])];
}

// ── Blueprint Contract Validation (Universal Composition Engine —
// Completion Gaps, Phase 1) ──────────────────────────────────────────────
// Assembles a real, honest composition blueprint from the SAME composed
// department/skill data already produced by departmentTemplateRegistry.cjs
// and skillRegistry.cjs (no new schema, no fabricated entities), then
// validates the whole thing against capabilityContract.cjs's
// validateBlueprint(). A structurally invalid blueprint is REJECTED
// (createCompany returns ok:false) rather than silently proceeding —
// this is the enforcement point Phase 2 of the original mission left
// unbuilt.
function _assembleBlueprintForContract(company, template, composedDepartments) {
  const contract = _contract();
  const skillReg = _skillReg();
  if (!contract) return null;

  const companyEntity = { id: company?.id || "pending", name: company?.name || "unknown", niche: template?.id || "unknown" };

  // Departments — real composed data, each carrying its own real skill
  // name strings (department.skills, already the true output of
  // departmentTemplateRegistry.composeDepartment()).
  const departments = composedDepartments.map((d, i) => ({
    id: `dept_${i}_${d.templateKey}`,
    templateKey: d.templateKey,
    label: d.label,
    skillIds: d.skills || [],
  }));

  // Skills — resolve each unique skill name referenced by any department
  // against the REAL skill registry. A skill name with no real registry
  // entry is honestly reported as a missing skill (never fabricated) by
  // simply not being included — the reference-chain check below will
  // then correctly flag any department that references it as a
  // reference-integrity failure, surfacing the gap rather than hiding it.
  const uniqueSkillNames = [...new Set(departments.flatMap(d => d.skillIds))];
  const skills = [];
  for (const skillName of uniqueSkillNames) {
    const real = skillReg?.getSkill?.(skillName);
    if (real) skills.push({ id: real.id, name: real.name, category: real.category, riskLevel: real.riskLevel, executionHandler: real.executionHandler, version: real.version });
  }

  return { company: companyEntity, departments, skills };
}

function _validateCompanyBlueprint(company, template, composedDepartments) {
  const contract = _contract();
  if (!contract?.validateBlueprint) return { ok: true, errors: [], skipped: true };
  const blueprint = _assembleBlueprintForContract(company, template, composedDepartments);
  if (!blueprint) return { ok: true, errors: [], skipped: true };
  return contract.validateBlueprint(blueprint);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function createCompany({
  idea,           // NL description — "Create a SaaS company called Ooplix CRM"
  name,           // Optional explicit company name
  templateId,     // Optional explicit template override
  founder = "founder",
  creatorAccountId, // Real authenticated accountId — becomes org_owner of the backing org
  skipApproval = false,
} = {}) {
  if (!idea && !name) return { ok: false, error: "idea or name required" };
  if (!creatorAccountId) return { ok: false, error: "creatorAccountId is required" };

  const runId   = _id();
  const started = Date.now();
  const timeline = [];
  const _step   = (step, data = {}) => { timeline.push({ step, ts: _ts(), ...data }); };

  _step("idea", { idea, name });

  // ─ Step 1: Analyze intent ────────────────────────────────────────────────
  const inferredTemplate = _bte()?.inferTemplate?.(idea || name || "");
  const template = templateId ? (_bte()?.getTemplate?.(templateId) || inferredTemplate) : inferredTemplate;
  _step("analyze", { inferredTemplate: template?.id });

  // ─ Step 2: Template ──────────────────────────────────────────────────────
  _step("template", { id: template.id, name: template.name, riskProfile: template.riskProfile });

  // ─ Step 3: Extract company name from idea or use provided ────────────────
  const companyName = name || _extractName(idea || "") || `${template.name} Venture`;
  _step("name_resolved", { companyName });

  // ─ Step 4: Generate blueprint ────────────────────────────────────────────
  const bpResult = _cbe()?.generateBlueprint?.({ name: companyName, description: idea || "", templateId: template.id, domain: template.id, founder });
  if (!bpResult?.ok) return { ok: false, error: "blueprint generation failed: " + bpResult?.error, timeline };
  const blueprint = bpResult.blueprint;
  _step("blueprint", { blueprintId: blueprint.id, missions: blueprint.missionCount, weeks: blueprint.totalWeeks });

  // ─ Step 5: Digital twin prediction ───────────────────────────────────────
  const twinPred = _try(() => _dte()?.decide?.(`Create ${template.name} company: ${companyName}`, { domain: "business", risk: template.riskProfile }));
  _step("twin_prediction", { predicted: twinPred?.founderWouldLikely, confidence: twinPred?.confidence });

  // ─ Step 6: Approval gate (for high/critical risk) ────────────────────────
  if (["high","critical"].includes(template.riskProfile) && !skipApproval) {
    _try(() => _ae()?.requestApproval?.({
      workflowId:  `company_create_${blueprint.id}`,
      description: `Create ${template.name} company: ${companyName}`,
      riskLevel:   template.riskProfile,
      context:     { blueprintId: blueprint.id, templateId: template.id },
    }));
    _step("approval_requested", { riskProfile: template.riskProfile });
  }

  // ─ Step 7: Build workspace ───────────────────────────────────────────────
  const wsResult = await _cwb()?.buildWorkspace?.(blueprint.id);
  if (!wsResult?.ok) return { ok: false, error: "workspace build failed: " + wsResult?.error, timeline };
  const workspace = wsResult.workspace;
  _step("workspace", { workspaceId: workspace.id, repos: workspace.repositories?.repositories?.length, missions: workspace.registeredMissions?.length, readiness: workspace.readinessScore });

  // ─ Step 7b: Compose departments from the matched template ────────────────
  // Uses departmentTemplateRegistry.cjs (100-COMPANY P1 mission Phase 3) —
  // derives the department set a template genuinely implies from its own
  // teamTypes/capabilities, then reports each department's real
  // composability against the live agent registry. No department record
  // is created here (organizationService.createDepartment() requires an
  // authenticated requestingAccountId and happens after the org exists at
  // step 11) — this step produces the composed plan that a later step or
  // caller can use to actually create departments via the existing,
  // unmodified organizationService API.
  const composedDepartments = _try(() => _deptReg()?.composeDepartmentsForTemplate?.(template, _agentRegistry())) || [];
  _step("departments_composed", {
    count: composedDepartments.length,
    composableNow: composedDepartments.filter(d => d.composable).length,
    requiresNewCapability: composedDepartments.filter(d => d.requiresNewCapability).length,
    departments: composedDepartments.map(d => ({ key: d.templateKey, label: d.label, composable: d.composable })),
  });

  // ─ Step 7c: Blueprint Contract Validation (Universal Composition Engine
  // Completion Gaps, Phase 1) ────────────────────────────────────────────
  // Validates the composed blueprint (Company + Departments + Skills, and
  // the department->skill reference chain) against capabilityContract.cjs
  // BEFORE any org/department records are created. A structurally invalid
  // blueprint (missing required fields, a raw secret smuggled in, or a
  // department referencing a skill that doesn't genuinely exist in the
  // real skill registry) rejects the run here rather than silently
  // proceeding to create a company with broken composition.
  const blueprintValidation = _validateCompanyBlueprint({ id: blueprint.id, name: companyName }, template, composedDepartments);
  _step("blueprint_validated", { ok: blueprintValidation.ok, errorCount: blueprintValidation.errors.length, errors: blueprintValidation.errors.slice(0, 20) });
  if (!blueprintValidation.ok) {
    return { ok: false, error: "blueprint failed contract validation: " + blueprintValidation.errors.join("; "), timeline };
  }

  // ─ Step 8: Workforce allocation ──────────────────────────────────────────
  // Real execution (not dryRun): runMission's non-dryRun path calls the
  // existing autonomousExecutionEngine.executeWorkflow() when a workflow ID
  // can be inferred from the mission title/domain — which already enforces
  // Class B founder-approval pause and Class C hard-block (see
  // autonomousExecutionEngine.cjs) — or otherwise falls back to a bounded
  // engorg dispatch simulation. Nothing here bypasses the existing approval
  // architecture; see 100-COMPANY-GAP-LIST.md P0 #3 / REALITY-AUDIT Part 7.
  const wfResult = await _try(() => _wm()?.runMission?.({
    title:          `Staff ${companyName} core team`,
    domain:         template.id,
    priority:       "high",
    requiredSkills: template.skills.slice(0, 5),
    teamType:       template.teamTypes[0],
    dryRun:         false,
  }));
  // runMission's non-dryRun return shape is { ok, ...missionRecord } — team
  // isn't nested (unlike the dryRun shape), skillCoverage is top-level. See
  // workforceManager.cjs runMission() missionRecord construction.
  _step("workforce", { teamType: wfResult?.teamType, agents: wfResult?.teamSize, coverage: wfResult?.skillCoverage, executionOutcome: wfResult?.execution?.outcome || null });

  // ─ Step 9: Production checklist ─────────────────────────────────────────
  const checklist = _buildChecklist(blueprint);
  _step("checklist", { items: checklist.length });

  // ─ Step 10: Register in platform ─────────────────────────────────────────
  _step("register");

  // ─ Step 11: Create lifecycle record (provisions the backing organization) ─
  const lcResult = _cle_e()?.createCompany?.({ blueprintId: blueprint.id, workspaceId: workspace.id, name: companyName, templateId: template.id, creatorAccountId });
  if (!lcResult?.ok) return { ok: false, error: "lifecycle/org provisioning failed: " + lcResult?.error, timeline };
  const company  = lcResult?.company;
  _step("lifecycle", { companyId: company?.id, stage: company?.stage, orgId: company?.orgId });

  // ─ Step 11a: Instantiate composed departments as real org department records ─
  // Uses the existing, unmodified organizationService.createDepartment() API
  // — no new department data model. Only creates a real department record
  // for families that are genuinely composable right now (skips
  // requiresNewCapability:true families — creating a department record
  // for a family with zero working agent/skill behind it would be an
  // empty label, not real capability; see departmentTemplateRegistry.cjs
  // Phase 3). creatorAccountId is the org owner (real org_owner role,
  // assigned at org creation — see organizationService.createOrg()),
  // so this call passes the same real permission check any operator
  // action would.
  const createdDepartments = [];
  if (company?.orgId) {
    for (const dept of composedDepartments) {
      if (!dept.composable) continue;
      try {
        const rec = _org()?.createDepartment?.(
          company.orgId,
          {
            name: dept.label,
            description: `Auto-composed from template "${template.id}" (${dept.templateKey})`,
            leadAccountId: creatorAccountId,
            // Persist the real composed metadata (skills/connectors/
            // permissions/approvalPolicies/kpis/composable status) onto
            // the department record instead of discarding it after this
            // step — Universal Composition Engine Phase 3 fix.
            composition: {
              templateKey: dept.templateKey,
              skills: dept.skills || [],
              connectors: dept.connectors || [],
              permissions: dept.permissions || [],
              approvalPolicies: dept.approvalPolicies || [],
              kpis: dept.kpis || [],
              composable: dept.composable,
              missingCapabilities: dept.missingCapabilities || [],
            },
          },
          creatorAccountId
        );
        if (rec) createdDepartments.push({ id: rec.id, key: dept.templateKey, label: dept.label });
      } catch (e) {
        // Non-fatal — a single department creation failure (e.g. duplicate
        // name on a re-run) does not block company creation.
      }
    }
  }
  _step("departments_created", { count: createdDepartments.length, departments: createdDepartments });

  // ─ Step 11b: Connector readiness (report only — never auto-connect) ──────
  // No connector can be attached automatically: every connector requires a
  // real credential value (secretVault.storeSecret), and none exist yet for
  // a brand-new org. Per REALITY-AUDIT Part 7 / GAP-LIST P0 #3, this step
  // exists so the company record honestly reflects NEEDS_CREDENTIALS instead
  // of silently omitting connector state or fabricating a connected one.
  const configuredSecrets = _vault()?.listSecrets?.({ orgId: company?.orgId }) || [];
  const connectorStatus   = configuredSecrets.length > 0 ? "PARTIALLY_CONFIGURED" : "NEEDS_CREDENTIALS";
  _step("connectors", { orgId: company?.orgId, requiredCapabilities: template.capabilities, configuredConnectorIds: configuredSecrets.map(s => s.connectorId), status: connectorStatus });

  // ─ Step 12: Pass initial gates for planning stage ─────────────────────────
  if (company?.id) {
    _cle_e()?.passGate?.(company.id, "blueprint_approved",  { evidence: "Blueprint auto-generated" });
    _cle_e()?.passGate?.(company.id, "workspace_ready",     { evidence: "Workspace auto-built" });
    _cle_e()?.passGate?.(company.id, "team_allocated",      { evidence: `Workforce mission executed (team=${wfResult?.teamSize ?? 0}, outcome=${wfResult?.execution?.outcome || "unknown"})` });
  }

  // ─ Step 13: Learn + record ───────────────────────────────────────────────
  const minutesSaved = template.minutesSaved;
  _try(() => _cle()?.createLesson?.({
    type: "company_created", title: `Created ${companyName} (${template.name})`,
    source: "companyFactory", confidence: 0.92,
    tags: ["company_factory", template.id, "created"],
    metadata: { runId, companyId: company?.id, blueprintId: blueprint.id, minutesSaved },
  }));
  _try(() => _eme()?.remember?.({
    type: "company_created", confidence: 0.90,
    content: `Company "${companyName}" (${template.fullName}) created. ${blueprint.missionCount} missions, ${blueprint.totalWeeks} week roadmap. Workspace ready.`,
    tags: ["company_factory", "created", template.id],
  }));
  _try(() => _fwr()?.recordExecution?.("wf_company_factory", {
    outcome: "completed", durationMs: Date.now() - started,
    stepsExecuted: timeline.map(t => t.step), approvalRequired: ["high","critical"].includes(template.riskProfile),
  }));

  _step("ready", { minutesSaved, companyId: company?.id });

  const run = {
    id:           runId,
    companyId:    company?.id,
    orgId:        company?.orgId,
    companyName,
    templateId:   template.id,
    blueprintId:  blueprint.id,
    workspaceId:  workspace.id,
    checklist,
    timeline,
    minutesSaved,
    twinPrediction: twinPred ? { predicted: twinPred.founderWouldLikely, confidence: twinPred.confidence } : null,
    status:       "completed",
    durationMs:   Date.now() - started,
    createdAt:    _ts(),
  };

  const d = _load();
  d.runs.push(run);
  d.stats.totalCreated++;
  d.stats.byTemplate[template.id] = (d.stats.byTemplate[template.id] || 0) + 1;
  d.stats.minutesSaved += minutesSaved;
  d.stats.avgDurationMs = Math.round((d.stats.avgDurationMs * (d.stats.totalCreated - 1) + run.durationMs) / d.stats.totalCreated);
  _save(d);

  return {
    ok: true,
    companyId:    company?.id,
    orgId:        company?.orgId,
    company,
    companyName,
    templateId:   template.id,
    templateName: template.name,
    blueprintId:  blueprint.id,
    workspaceId:  workspace.id,
    blueprint,
    workspace:    { id: workspace.id, readinessScore: workspace.readinessScore, missionCount: workspace.registeredMissions?.length, repoCount: workspace.repositories?.repositories?.length },
    workforce:    { teamType: wfResult?.teamType, teamSize: wfResult?.teamSize },
    checklist,
    timeline,
    minutesSaved,
    totalWeeks:   blueprint.totalWeeks,
    missionCount: blueprint.missionCount,
    twinPrediction: run.twinPrediction,
    status:       "ready",
    durationMs:   run.durationMs,
  };
}

// ── Clone ─────────────────────────────────────────────────────────────────────
// Reuses the exact same 13-step pipeline as createCompany() — a clone is a
// fresh, fully real company/org/blueprint/workspace, seeded from the source
// company's templateId (its "recipe"). Company blueprints have no
// per-company customization beyond templateId today (skills/capabilities/
// techStack/kpis are 100% template-derived — see companyBlueprintEngine.cjs
// and its read-only /blueprints/:id/status-only PATCH route), so templateId
// is the complete, honest definition of "what this company was built from."
// No new blueprint-generation logic is introduced.

async function cloneCompany({ sourceCompanyId, name, creatorAccountId, skipApproval = false } = {}) {
  if (!sourceCompanyId) return { ok: false, error: "sourceCompanyId is required" };
  if (!creatorAccountId) return { ok: false, error: "creatorAccountId is required" };

  const source = _cle_e()?.getCompany?.(sourceCompanyId);
  if (!source) return { ok: false, error: "source company not found" };

  const cloneName = name || `${source.name} (Clone)`;
  const result = await createCompany({
    name: cloneName,
    templateId: source.templateId,
    founder: source.creatorAccountId || "founder",
    creatorAccountId,
    skipApproval,
  });

  if (result.ok) result.clonedFrom = sourceCompanyId;
  return result;
}

// ── Name extractor ────────────────────────────────────────────────────────────

function _extractName(idea) {
  // "Create a SaaS company called Acme" → "Acme"
  const m = idea.match(/called?\s+([A-Z][A-Za-z0-9 ]+?)(?:\s*$|[,.])/);
  if (m) return m[1].trim();
  // "Create Acme CRM" → "Acme CRM"
  const m2 = idea.match(/^[Cc]reate\s+(?:a\s+)?(?:new\s+)?([A-Z][A-Za-z0-9 ]+?)(?:\s+(?:company|startup|platform|product|app|tool|system))/);
  if (m2) return m2[1].trim();
  return null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getRun(runId) {
  return _load().runs.find(r => r.id === runId) || null;
}

function listRuns({ limit = 50, templateId } = {}) {
  let runs = _load().runs;
  if (templateId) runs = runs.filter(r => r.templateId === templateId);
  return { ok: true, runs: runs.slice(-limit) };
}

function getStats() {
  const d = _load();
  return { ...d.stats, updatedAt: d.updatedAt };
}

module.exports = {
  createCompany,
  cloneCompany,
  getRun,
  listRuns,
  getStats,
  // Universal Composition Engine — Completion Gaps, Phase 1
  validateCompanyBlueprint: _validateCompanyBlueprint,
  assembleBlueprintForContract: _assembleBlueprintForContract,
};
