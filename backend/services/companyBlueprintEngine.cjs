"use strict";
/**
 * companyBlueprintEngine.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Generates a full company blueprint from a business template + founder intent.
 * Blueprint includes:
 *   - company identity (name, type, description, domain)
 *   - team structure (workforce allocation)
 *   - capability map
 *   - governance rules
 *   - KPI targets
 *   - roadmap (phases → milestones)
 *   - execution missions
 *   - risk register
 *   - tech stack
 *
 * Reuses: businessTemplateEngine, workforceManager, digitalTwinEngine,
 *         engineeringMemoryEngine, continuousLearningEngine.
 *
 * Storage: data/company-blueprints.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "company-blueprints.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bte = () => _try(() => require("./businessTemplateEngine.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));
const _dte = () => _try(() => require("./digitalTwinEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { blueprints: [], updatedAt: null }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.blueprints.length > 200) d.blueprints = d.blueprints.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Roadmap generator ─────────────────────────────────────────────────────────

function _buildRoadmap(template, companyName) {
  const phases = template.roadmap || ["planning","mvp","launch","growth"];
  return phases.map((phase, i) => ({
    phase,
    order:      i + 1,
    status:     "pending",
    milestones: _phaseMilestones(phase, companyName, template),
    estimatedWeeks: _phaseWeeks(phase, template.riskProfile),
    missions:   [],
  }));
}

function _phaseMilestones(phase, name, tpl) {
  const m = {
    mvp:                [`${name} core feature set`, "Basic auth + auth flow", "First working demo"],
    planning:           [`${name} requirements doc`, "Architecture decision record", "Team assembled"],
    private_beta:       ["10 beta users onboarded", "Feedback loop established", "Critical bugs fixed"],
    public_beta:        ["100 active users", "Billing operational", "99%+ uptime"],
    v1_launch:          ["Public launch", "Press & marketing", "Support system ready"],
    launch:             [`${name} publicly live`, "Payment processing live", "Monitoring active"],
    growth:             ["1000 users / first revenue", "Referral program", "Feature expansion"],
    scale:              ["Enterprise tier", "International", "Team scale"],
    setup:              ["Legal entity", "Brand identity", "Tooling setup"],
    compliance_setup:   ["HIPAA BAAs signed", "Security audit", "Encryption keys managed"],
    core_product:       ["Core workflows complete", "Pilot user signed", "Integration tested"],
    pilot:              ["Pilot results validated", "Clinical workflow optimized", "Billing live"],
    regulatory:         ["Regulatory clearance", "Audit trail verified", "Data governance"],
    first_clients:      ["First 3 paid clients", "Testimonials collected", "Process documented"],
    portfolio:          ["5 completed projects", "Case studies published", "Referral network"],
    team_growth:        ["Team of 5+", "SOPs documented", "Hiring pipeline"],
    productize:         ["First productized offer", "Self-serve onboarding", "Content flywheel"],
    catalog_setup:      ["100 products listed", "Categories defined", "SEO optimized"],
    payment_integration:["Stripe connected", "Checkout tested", "Tax configured"],
    marketing:          ["First ad campaign", "Email automation", "Social presence"],
    expansion:          ["10+ product categories", "Wholesale tier", "Mobile app"],
    optimization:       ["Conversion >3%", "CAC reduced 30%", "Repeat purchase >40%"],
    supply_side:        ["50 quality sellers onboarded", "Verification process", "Catalog live"],
    demand_side:        ["500 registered buyers", "First transaction", "Retention loop"],
    matching:           ["Search live", "Recommendation engine", "Quality scoring"],
    trust:              ["Escrow system", "Review system", "Fraud detection"],
    international:      ["Multi-currency", "Localization", "Global logistics"],
    architecture:       ["System architecture finalized", "Data model locked", "Tech stack chosen"],
    core_modules:       ["Finance module", "HR module", "Inventory module"],
    integration:        ["API integrations", "Legacy data migration", "SSO"],
    rollout:            ["Department rollout", "Training complete", "Go-live"],
    prototype:          ["LLM integration working", "Prompt framework", "First eval suite"],
    evals_framework:    ["Automated evals", "Benchmark baseline", "Accuracy >90%"],
    safety_review:      ["Red-team complete", "Safety filters", "Content policy"],
    requirements:       ["Requirements gathered", "Stakeholder sign-off", "Wireframes"],
    feedback:           ["User feedback sessions", "Iteration complete", "Approval"],
    training:           ["Training delivered", "Documentation live", "Support SLA"],
    iterate:            ["v2 roadmap", "Feature backlog groomed", "KPIs tracked"],
    content_framework:  ["Curriculum designed", "Content guidelines", "Review process"],
    delivery_platform:  ["Video delivery", "Quiz engine", "Progress tracking"],
    first_cohort:       ["First 50 learners", "Completion rate >70%", "NPS >50"],
    self_serve:         ["Self-enroll live", "Certificate system", "Payment tiers"],
    enterprise:         ["Enterprise SSO", "Custom branding", "Bulk seats"],
    data_model:         ["Schema finalized", "Migration scripts", "Seed data"],
    core_ui:            ["Dashboard live", "CRUD operations", "Search & filter"],
    integrations:       ["Email sync", "Calendar", "Webhook outbound"],
    automation:         ["Workflow rules", "Auto-assign", "Drip sequences"],
    reporting:          ["Funnel reports", "Activity feed", "Export"],
    mobile:             ["iOS app MVP", "Push notifications", "Offline mode"],
  };
  return m[phase] || [`${phase} milestone 1`, `${phase} milestone 2`, `${phase} milestone 3`];
}

function _phaseWeeks(phase, risk) {
  const base = { planning: 2, setup: 2, mvp: 8, prototype: 6, core_product: 10, architecture: 4, core_modules: 12, core_ui: 8, compliance_setup: 6, private_beta: 4, public_beta: 4, v1_launch: 2, launch: 2, growth: 12, scale: 24, first_clients: 4, portfolio: 8, team_growth: 12, catalog_setup: 3, payment_integration: 2, supply_side: 6, demand_side: 6, matching: 4, trust: 3, pilot: 8, regulatory: 12, rollout: 8, integration: 6, evals_framework: 4, safety_review: 3, content_framework: 4, delivery_platform: 6, first_cohort: 4, self_serve: 4, requirements: 2, feedback: 2, training: 2, data_model: 2, integrations: 3, automation: 4, reporting: 3, mobile: 8, optimization: 4, expansion: 8, marketing: 4, productize: 6, international: 12, iterate: 4, enterprise: 6 };
  const multiplier = risk === "critical" ? 1.5 : risk === "high" ? 1.25 : 1.0;
  return Math.round((base[phase] || 4) * multiplier);
}

// ── Execution missions ────────────────────────────────────────────────────────

function _buildMissions(template, companyName) {
  const base = [
    { title: `Set up ${companyName} development environment`,       domain: "devops",    priority: "high" },
    { title: `Create ${companyName} project repositories`,          domain: "backend",   priority: "high" },
    { title: `Generate ${companyName} technical architecture doc`,  domain: "backend",   priority: "high" },
    { title: `Build ${companyName} core authentication system`,     domain: "backend",   priority: "high" },
    { title: `Design ${companyName} database schema`,               domain: "backend",   priority: "high" },
    { title: `Create ${companyName} API specification`,             domain: "backend",   priority: "medium" },
    { title: `Build ${companyName} frontend scaffold`,              domain: "frontend",  priority: "medium" },
    { title: `Set up ${companyName} CI/CD pipeline`,                domain: "devops",    priority: "medium" },
    { title: `Generate ${companyName} production checklist`,        domain: "ops",       priority: "medium" },
    { title: `Create ${companyName} brand identity guide`,          domain: "design",    priority: "medium" },
    { title: `Write ${companyName} onboarding documentation`,       domain: "docs",      priority: "low" },
    { title: `Configure ${companyName} monitoring and alerts`,      domain: "devops",    priority: "low" },
  ];
  // Template-specific missions
  const extra = {
    healthcare: [
      { title: `Configure ${companyName} HIPAA compliance controls`, domain: "security", priority: "critical" },
      { title: `Set up ${companyName} audit logging`, domain: "backend", priority: "high" },
    ],
    marketplace: [
      { title: `Build ${companyName} escrow payment system`, domain: "backend", priority: "high" },
      { title: `Create ${companyName} seller onboarding flow`, domain: "frontend", priority: "high" },
    ],
    saas: [
      { title: `Integrate ${companyName} Stripe subscription billing`, domain: "backend", priority: "high" },
      { title: `Build ${companyName} multi-tenant data isolation`, domain: "backend", priority: "high" },
    ],
    ai_product: [
      { title: `Set up ${companyName} LLM integration and prompt framework`, domain: "backend", priority: "high" },
      { title: `Build ${companyName} evaluation and safety suite`, domain: "qa", priority: "high" },
    ],
    erp: [
      { title: `Design ${companyName} ERP module architecture`, domain: "backend", priority: "high" },
      { title: `Build ${companyName} data migration pipeline`, domain: "backend", priority: "high" },
    ],
  };
  return [...base, ...(extra[template.id] || [])];
}

// ── Risk register ─────────────────────────────────────────────────────────────

function _buildRisks(template) {
  const common = [
    { risk: "Scope creep", severity: "high", mitigation: "Lock MVP scope, use feature flags" },
    { risk: "Team capacity", severity: "medium", mitigation: "Workforce OS auto-rebalancing" },
    { risk: "Technical debt", severity: "medium", mitigation: "Code review gate on every sprint" },
  ];
  const specific = {
    healthcare: [{ risk: "HIPAA violation", severity: "critical", mitigation: "All PHI access audited, BAAs in place" }],
    marketplace: [{ risk: "Supply-demand imbalance", severity: "high", mitigation: "Curated onboarding, liquidity incentives" }],
    saas: [{ risk: "High churn", severity: "high", mitigation: "Onboarding automation, NPS monitoring" }],
    erp: [{ risk: "Data migration failure", severity: "critical", mitigation: "Staged migration with rollback plan" }],
    ai_product: [{ risk: "Hallucination in prod", severity: "high", mitigation: "Evals gate before every release" }],
  };
  return [...common, ...(specific[template.id] || [])];
}

// ── Core blueprint generator ──────────────────────────────────────────────────

function generateBlueprint({ name, description, templateId, domain, founder = "founder" } = {}) {
  if (!name) return { ok: false, error: "company name required" };

  const template = templateId
    ? _bte()?.getTemplate?.(templateId) || _bte()?.inferTemplate?.(description || templateId)
    : _bte()?.inferTemplate?.(description || name);

  if (!template) return { ok: false, error: "could not determine business template" };

  const id       = _id();
  const roadmap  = _buildRoadmap(template, name);
  const missions = _buildMissions(template, name);
  const risks    = _buildRisks(template);

  // Twin prediction
  const twinPrediction = _try(() =>
    _dte()?.decide?.(`Create ${template.name} company: ${name}`, { domain: "business", risk: template.riskProfile })
  );

  const totalWeeks = roadmap.reduce((s, p) => s + (p.estimatedWeeks || 4), 0);

  const blueprint = {
    id,
    name,
    description:  description || `${name} — ${template.fullName}`,
    templateId:   template.id,
    templateName: template.name,
    domain:       domain || template.id,
    founder,

    // Core blueprint
    skills:       template.skills,
    teamTypes:    template.teamTypes,
    capabilities: template.capabilities,
    techStack:    template.techStack,
    governance:   template.governance,
    kpis:         { ...template.kpis },
    riskProfile:  template.riskProfile,

    // Roadmap
    roadmap,
    totalWeeks,
    estimatedLaunchWeeks: roadmap.filter(p => ["mvp","v1_launch","launch","pilot"].includes(p.phase))
      .reduce((s, p) => s + (p.estimatedWeeks || 4), 0),

    // Missions
    missions,
    missionCount: missions.length,

    // Risks
    risks,
    riskCount: risks.length,

    // Meta
    minutesSaved:    template.minutesSaved,
    twinPrediction:  twinPrediction ? { predicted: twinPrediction.founderWouldLikely, confidence: twinPrediction.confidence } : null,
    status:          "draft",
    generatedAt:     _ts(),
    updatedAt:       _ts(),
  };

  const d = _load();
  d.blueprints.push(blueprint);
  _save(d);

  // Memory + learning
  _try(() => _cle()?.createLesson?.({
    type: "company_blueprint", title: `Blueprint: ${name} (${template.name})`,
    source: "companyBlueprintEngine", confidence: 0.9,
    tags: ["company_factory", template.id, "blueprint"],
    metadata: { companyId: id, template: template.id, missions: missions.length, totalWeeks },
  }));
  _try(() => _eme()?.remember?.({
    type: "company_blueprint", confidence: 0.88,
    content: `Generated company blueprint for "${name}" (${template.fullName}). ${missions.length} missions, ${totalWeeks} week roadmap.`,
    tags: ["company_factory", "blueprint", template.id],
  }));

  return { ok: true, blueprint };
}

function getBlueprint(id) {
  return _load().blueprints.find(b => b.id === id) || null;
}

function listBlueprints({ templateId, status, limit = 50 } = {}) {
  let list = _load().blueprints;
  if (templateId) list = list.filter(b => b.templateId === templateId);
  if (status)     list = list.filter(b => b.status === status);
  return { ok: true, blueprints: list.slice(-limit) };
}

function updateBlueprintStatus(id, status) {
  const d  = _load();
  const bp = d.blueprints.find(b => b.id === id);
  if (!bp) return { ok: false, error: "blueprint not found" };
  bp.status    = status;
  bp.updatedAt = _ts();
  _save(d);
  return { ok: true, blueprint: bp };
}

function getStats() {
  const d = _load();
  const byTemplate = {};
  for (const b of d.blueprints) {
    byTemplate[b.templateId] = (byTemplate[b.templateId] || 0) + 1;
  }
  return { total: d.blueprints.length, byTemplate, updatedAt: d.updatedAt };
}

module.exports = {
  generateBlueprint,
  getBlueprint,
  listBlueprints,
  updateBlueprintStatus,
  getStats,
};
