"use strict";
/**
 * Civilization Workflow — LEVEL 9
 *
 * Full 6-step civilization pipeline:
 * Civilization Goal → Governance → Resource Allocation →
 * Ecosystem Dispatch → Cross-Org Coordination → Report
 *
 * Orchestrates: Civilization → Ecosystem(L8) → Enterprise(L7) → Executive(L6) → Orgs → Runtime
 */

const _st  = () => require("./civilizationState.cjs");
const _eco = () => { try { return require("./ecosystemWorkflow.cjs");  } catch { return null; } }
const _ent = () => { try { return require("./enterpriseWorkflow.cjs"); } catch { return null; } }
const _eos = () => { try { return require("./executiveWorkflow.cjs");  } catch { return null; } }
const _eosSt = () => { try { return require("./executiveState.cjs");   } catch { return null; } }
const _ecoSt = () => { try { return require("./ecosystemState.cjs");   } catch { return null; } }
const _entSt = () => { try { return require("./enterpriseState.cjs");  } catch { return null; } }
const _le  = () => { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

function _emit(type, payload) { try { _bus()?.emit(type, payload); } catch {} }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Civilization Intake (register goal + identify members)
// ═══════════════════════════════════════════════════════════════════════════════

function intakeCivGoal(command, { memberId, priority = "high", domain = "general" } = {}) {
  if (!command) return { ok: false, error: "command required" };

  // Create EOS goal via executive layer
  let eosGoalId = null;
  try {
    const r = _eosSt()?.createGoal?.({ title: command.slice(0,200), description: `Civilization initiative: ${command}`, priority, tags: ["civilization", memberId, domain].filter(Boolean) });
    eosGoalId = r?.goal?.id || null;
  } catch {}

  // Add civilization memory
  _st().addCivMemory({ domainId: "civ_director", type: "goal", title: `Goal: ${command.slice(0,120)}`, detail: JSON.stringify({ eosGoalId, memberId, domain }) });

  _emit("civilization:goal:created", { eosGoalId, command, memberId, domain });
  return { ok: true, eosGoalId, command, memberId, domain };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Civilization Governance (constitution + policy check)
// ═══════════════════════════════════════════════════════════════════════════════

function civilizationGovernance(eosGoalId, { memberId, domain } = {}) {
  // Check constitution articles relevant to domain
  const articles = _st().listArticles({ status: "active" });
  const violations = articles.filter(a => {
    // Article enforcement: check if any article blocks this domain
    return a.category === "restriction" && a.content.toLowerCase().includes(domain?.toLowerCase());
  });
  if (violations.length > 0) {
    return { ok: false, error: "Constitutional violation", violations: violations.map(v => v.title) };
  }
  // Reputation gate — member must have reputation >= 30
  if (memberId) {
    const rep = _st().getReputation(memberId);
    if (rep.score < 30) return { ok: false, error: "Reputation too low for execution", reputationScore: rep.score };
  }
  _emit("civilization:governance:passed", { eosGoalId, memberId });
  return { ok: true, violations: 0, articles: articles.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Resource Allocation (civilization economy + lower layers)
// ═══════════════════════════════════════════════════════════════════════════════

function civilizationResourceAllocation(eosGoalId, { memberId, resources = {} } = {}) {
  // Credit execution resources from pool if member provided
  let resourcesAllocated = {};
  if (memberId) {
    for (const [res, amt] of Object.entries(resources)) {
      const cr = _st().creditResource(memberId, res, amt, `goal:${eosGoalId}`);
      if (cr.ok) resourcesAllocated[res] = amt;
    }
  }
  // Allocate via EOS budget
  try { _eosSt()?.allocateBudget?.({ goalId: eosGoalId, amount: resources.capital || 0, currency: "credits", source: "civilization_pool" }); } catch {}
  _emit("civilization:resources:allocated", { eosGoalId, memberId, resourcesAllocated });
  return { ok: true, resourcesAllocated };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Ecosystem Dispatch (Ecosystem → Enterprise → Executive → Orgs)
// ═══════════════════════════════════════════════════════════════════════════════

async function dispatchToEcosystem(command, { memberId, tenantId, priority, amountUsd = 0 } = {}) {
  const steps = [];
  let healthScore = 50;
  try {
    const r = await _eco()?.runEcosystemPipeline?.(command, { tenantId, priority, amountUsd });
    if (r) { steps.push(...(r.steps || [])); healthScore = r.ecosystemHealth || r.healthScore || 50; }
  } catch (e) {
    // Fallback: enterprise dispatch
    try {
      const r = await _ent()?.runEnterprisePipeline?.(command, { priority, amountUsd, autoApprove: true });
      if (r) { steps.push(...(r.steps || [])); healthScore = r.healthScore || 50; }
    } catch {
      // Final fallback: executive
      try {
        const r = await _eos()?.runFullPipeline?.(command, { priority });
        if (r) { steps.push(...(r.steps || [])); healthScore = r.healthScore || 50; }
      } catch {}
    }
  }
  _emit("civilization:ecosystem:dispatched", { steps: steps.length, healthScore });
  return { ok: true, steps, healthScore };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Cross-Org Coordination (missions, knowledge, collaboration)
// ═══════════════════════════════════════════════════════════════════════════════

function crossOrgCoordination(eosGoalId, { memberId, command, domain } = {}) {
  const actions = [];
  // Publish civilization mission for other members to pick up
  try {
    const mr = _st().publishCivMission({ fromMemberId: memberId || "system", title: `Cross-org: ${command?.slice(0,120)}`, domain: domain || "general", priority: "high" });
    if (mr.ok) actions.push({ type: "mission_published", id: mr.missionRoute?.id });
  } catch {}
  // Share knowledge route about this goal
  try {
    const kr = _st().shareKnowledgeRoute({ fromMemberId: memberId || "system", title: `Knowledge: ${command?.slice(0,120)}`, content: `Goal: ${eosGoalId}`, type: "goal_context", visibility: "members" });
    if (kr.ok) actions.push({ type: "knowledge_shared", id: kr.knowledgeRoute?.id });
  } catch {}
  _emit("civilization:coordination:completed", { eosGoalId, actions: actions.length });
  return { ok: true, actions };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Civilization Report
// ═══════════════════════════════════════════════════════════════════════════════

function generateCivReport(eosGoalId, { memberId, healthScore, steps = [], coordinationActions = [] } = {}) {
  const db = _st().getCivilizationDashboard();
  const goal = (() => { try { return _eosSt()?.getGoal?.(eosGoalId); } catch { return null; } })();

  const summary = [
    `Civilization initiative: ${goal?.title || eosGoalId}`,
    `Civilization health: ${db.health.score}/100`,
    `Ecosystem health: ${healthScore}/100`,
    `Members: ${db.civilization.members.active} active`,
    `Treaties: ${db.civilization.diplomacy.ratified} ratified`,
    `Innovations: ${db.civilization.innovation.adopted} adopted`,
    `Coordination actions: ${coordinationActions.length}`,
  ].join(" | ");

  const r = _st().createCivReport({
    title: `Civilization Report: ${goal?.title?.slice(0,80) || eosGoalId}`,
    domainId: "civ_analytics", type: "pipeline", summary,
    data: { dashboard: db, goal, healthScore, steps: steps.length, coordinationActions },
  });

  try { _le()?.addLesson?.({ type: "civilization_outcome", title: `Civilization goal: ${goal?.title?.slice(0,80) || eosGoalId}`, source: "civilization_workflow", confidence: 0.8, tags: ["civilization","level9"] }); } catch {}
  _emit("civilization:report:generated", { reportId: r.report?.id, eosGoalId, memberId });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function runCivilizationPipeline(command, { memberId, tenantId, priority = "high", domain = "general", resources = {}, amountUsd = 0 } = {}) {
  if (!command) return { ok: false, error: "command required" };
  const steps = [];
  const t0 = Date.now();

  // Step 1: Intake
  const intake = intakeCivGoal(command, { memberId, priority, domain });
  steps.push({ step: 1, name: "civilization_intake", ok: intake.ok });
  if (!intake.ok) return { ok: false, error: intake.error, steps };
  const { eosGoalId } = intake;

  // Step 2: Governance
  const gov = civilizationGovernance(eosGoalId, { memberId, domain });
  steps.push({ step: 2, name: "civilization_governance", ok: gov.ok, violations: gov.violations });
  if (!gov.ok) return { ok: false, error: gov.error, steps };

  // Step 3: Resource allocation
  const alloc = civilizationResourceAllocation(eosGoalId, { memberId, resources });
  steps.push({ step: 3, name: "resource_allocation", ok: alloc.ok });

  // Step 4: Ecosystem dispatch
  const dispatch = await dispatchToEcosystem(command, { memberId, tenantId, priority, amountUsd });
  steps.push({ step: 4, name: "ecosystem_dispatch", ok: dispatch.ok, subSteps: dispatch.steps.length, healthScore: dispatch.healthScore });

  // Step 5: Cross-org coordination
  const coord = crossOrgCoordination(eosGoalId, { memberId, command, domain });
  steps.push({ step: 5, name: "cross_org_coordination", ok: coord.ok, actions: coord.actions.length });

  // Step 6: Report
  const report = generateCivReport(eosGoalId, { memberId, healthScore: dispatch.healthScore, steps: dispatch.steps, coordinationActions: coord.actions });
  steps.push({ step: 6, name: "civilization_report", ok: report.ok, reportId: report.report?.id });

  _emit("civilization:pipeline:completed", { eosGoalId, memberId, steps: steps.length, durationMs: Date.now() - t0 });

  return {
    ok: true, eosGoalId, memberId, domain, steps,
    durationMs: Date.now() - t0,
    healthScore: dispatch.healthScore,
    civilizationHealth: _st().getCivilizationHealth().score,
    reportId: report.report?.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG-TO-ORG NEGOTIATION (orchestrate diplomacy layer)
// ═══════════════════════════════════════════════════════════════════════════════

function negotiateBetweenOrgs({ fromMemberId, toMemberId, subject, initialTerms = {}, autoResolve = true } = {}) {
  if (!fromMemberId || !toMemberId || !subject) return { ok: false, error: "fromMemberId, toMemberId, subject required" };
  const neg = _st().openNegotiation({ title: subject, parties: [fromMemberId, toMemberId], subject, proposerId: fromMemberId, initialTerms });
  if (!neg.ok) return neg;
  // Add initial round from proposer
  _st().addNegotiationRound(neg.negotiation.id, { memberId: fromMemberId, terms: initialTerms });
  // Auto-resolve in collaborative mode
  if (autoResolve) {
    const agreedTerms = { ...initialTerms, agreed: true, resolvedAt: new Date().toISOString() };
    const conclude = _st().concludeNegotiation(neg.negotiation.id, { agreedTerms, outcome: "agreement" });
    return { ok: true, negotiation: conclude.negotiation, agreedTerms };
  }
  return { ok: true, negotiation: neg.negotiation };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS DELEGATION (assign mission to best-fit member)
// ═══════════════════════════════════════════════════════════════════════════════

function delegateToMember({ command, requiredCapabilities = [], fromMemberId = "system", priority = "medium", domain = "general" } = {}) {
  if (!command) return { ok: false, error: "command required" };
  // Find capable member
  const members = _st().listMembers({ status: "active" });
  const capable = members.filter(m => {
    if (!requiredCapabilities.length) return true;
    return requiredCapabilities.every(cap => (m.capabilities || []).includes(cap));
  });
  const target = capable.sort((a,b) => (b.reputation||70) - (a.reputation||70))[0];
  if (!target) return { ok: false, error: "No capable member found" };

  // Publish mission for target
  const mr = _st().publishCivMission({ fromMemberId, title: command.slice(0,200), description: command, requiredCapabilities, priority, domain });
  if (mr.ok) _st().assignCivMission(mr.missionRoute.id, { toMemberId: target.id });

  _emit("civilization:delegation:completed", { targetMemberId: target.id, command: command.slice(0,100) });
  return { ok: true, delegatedTo: target, missionId: mr.missionRoute?.id };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP — seed constitution + council + initial members
// ═══════════════════════════════════════════════════════════════════════════════

function bootstrapCivilization() {
  const results = { articles: 0, council: 0, members: 0, channels: 0 };

  // Constitutional articles
  const articles = [
    { title: "Right to Participate", content: "Every registered member has the right to participate in civilization activities, missions, and governance.", category: "rights", articleNumber: 1 },
    { title: "Obligation to Cooperate", content: "Members must cooperate in good faith for civilization-wide missions and knowledge sharing.", category: "obligations", articleNumber: 2 },
    { title: "Resource Reciprocity", content: "Members who contribute resources to the civilization pool have priority access to pool claims.", category: "economy", articleNumber: 3 },
    { title: "Dispute Resolution", content: "All disputes must first go through negotiation, then arbitration, before escalating to Council.", category: "governance", articleNumber: 4 },
    { title: "Innovation Adoption", content: "Innovations with 3+ adoptions are considered civilization standards and are recommended for all members.", category: "innovation", articleNumber: 5 },
    { title: "Reputation Integrity", content: "Reputation scores are immutable historical records. Manipulation of reputation is grounds for expulsion.", category: "governance", articleNumber: 6 },
  ];
  for (const art of articles) {
    const r = _st().addConstitutionalArticle(art);
    if (r.ok) results.articles++;
  }

  // Channels
  const channels = [
    { name: "General", type: "general", description: "Civilization-wide general communication", visibility: "public" },
    { name: "Engineering", type: "technical", description: "Engineering collaboration and code review", visibility: "public" },
    { name: "Knowledge", type: "knowledge", description: "Knowledge sharing and research collaboration", visibility: "public" },
    { name: "Economy", type: "trade", description: "Resource trading and economic coordination", visibility: "public" },
    { name: "Governance", type: "governance", description: "Policy proposals and votes", visibility: "public" },
  ];
  for (const ch of channels) {
    const r = _st().createChannel(ch);
    if (r.ok) results.channels++;
  }

  return { ok: true, ...results };
}

function subscribecivEvents() {
  try {
    const bus = _bus();
    if (!bus) return;
    // Pipeline completion → reputation boost for member
    bus.subscribe("civilization:pipeline:completed", data => {
      try { if (data.memberId) _st().recordReputationEvent({ memberId: data.memberId, eventType: "pipeline_success", score: 3, detail: `pipeline health=${data.healthScore}` }); } catch {}
    });
    // Mission assigned → record
    bus.subscribe("civilization:mission:assigned", data => {
      try { _st().addCivMemory({ domainId: "civ_mission_network", type: "mission_assigned", title: `Mission assigned to ${data.toMemberId}`, detail: data.id }); } catch {}
    });
    // Treaty ratified → boost all parties
    bus.subscribe("civilization:treaty:ratified", data => {
      try { _st().addCivMemory({ domainId: "civ_diplomacy", type: "treaty_ratified", title: `Treaty ratified: ${data.title}` }); } catch {}
    });
  } catch {}
}

module.exports = {
  intakeCivGoal, civilizationGovernance, civilizationResourceAllocation,
  dispatchToEcosystem, crossOrgCoordination, generateCivReport,
  runCivilizationPipeline,
  negotiateBetweenOrgs, delegateToMember,
  bootstrapCivilization, subscribecivEvents,
};
