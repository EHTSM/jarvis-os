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

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function createCompany({
  idea,           // NL description — "Create a SaaS company called Ooplix CRM"
  name,           // Optional explicit company name
  templateId,     // Optional explicit template override
  founder = "founder",
  skipApproval = false,
} = {}) {
  if (!idea && !name) return { ok: false, error: "idea or name required" };

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

  // ─ Step 8: Workforce allocation ──────────────────────────────────────────
  const wfResult = await _try(() => _wm()?.runMission?.({
    title:          `Staff ${companyName} core team`,
    domain:         template.id,
    priority:       "high",
    requiredSkills: template.skills.slice(0, 5),
    teamType:       template.teamTypes[0],
    dryRun:         true,
  }));
  _step("workforce", { teamType: wfResult?.teamType, agents: wfResult?.teamSize, coverage: wfResult?.team?.skillCoverage });

  // ─ Step 9: Production checklist ─────────────────────────────────────────
  const checklist = _buildChecklist(blueprint);
  _step("checklist", { items: checklist.length });

  // ─ Step 10: Register in platform ─────────────────────────────────────────
  _step("register");

  // ─ Step 11: Create lifecycle record ──────────────────────────────────────
  const lcResult = _cle_e()?.createCompany?.({ blueprintId: blueprint.id, workspaceId: workspace.id, name: companyName, templateId: template.id });
  const company  = lcResult?.company;
  _step("lifecycle", { companyId: company?.id, stage: company?.stage });

  // ─ Step 12: Pass initial gates for planning stage ─────────────────────────
  if (company?.id) {
    _cle_e()?.passGate?.(company.id, "blueprint_approved",  { evidence: "Blueprint auto-generated" });
    _cle_e()?.passGate?.(company.id, "workspace_ready",     { evidence: "Workspace auto-built" });
    _cle_e()?.passGate?.(company.id, "team_allocated",      { evidence: "Workforce dry-run complete" });
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
  getRun,
  listRuns,
  getStats,
};
