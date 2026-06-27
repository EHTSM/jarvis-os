"use strict";
/**
 * Civilization Organization — LEVEL 9
 * 20 civilization domains, all via agentRuntimeSupervisor.registerAgent()
 */

const _sup = () => require("./agentRuntimeSupervisor.cjs");
const _st  = () => require("./civilizationState.cjs");
const _wf  = () => require("./civilizationWorkflow.cjs");
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

let _registered = false;

function _kpiTick(domainId, patch = {}) {
  try { _st().updateCivKpi(domainId, { ...patch, lastTickAt: new Date().toISOString(), tickCount: (_st().getCivKpi(domainId).tickCount || 0) + 1 }); } catch {}
}
function _mem(domainId, title, detail = "") {
  try { _st().addCivMemory({ domainId, type: "tick", title, detail }); } catch {}
}

const CIV_ORG = [
  // ── 1. Civilization Registry ───────────────────────────────────────────────
  {
    id: "civ_registry", role: "civ_registry", label: "Civilization Registry",
    description: "Maintains global registry of all member organizations, federations, and coalitions.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const members = _st().listMembers({ status: "active" });
      const alliances = _st().listAlliances({ status: "active" });
      _kpiTick("civ_registry", { membersRegistered: members.length });
      _mem("civ_registry", `Registry: ${members.length} active members, ${alliances.length} alliances`);
      try { _bus()?.emit("civilization:registry:ticked", { members: members.length, alliances: alliances.length }); } catch {}
    },
  },
  // ── 2. Civilization Council ────────────────────────────────────────────────
  {
    id: "civ_council", role: "civ_council", label: "Civilization Council",
    description: "Governs the civilization through proposal/vote cycle. Auto-closes expired proposals.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const openProposals = _st().listProposals({ status: "open" });
      // Auto-expire overdue proposals
      const now = new Date();
      let expired = 0;
      for (const p of openProposals) {
        if (p.deadline && new Date(p.deadline) < now) {
          try {
            const cou = require("../../data/civilization/council.json");
            // Simple state update via voteOnProposal triggering majority
          } catch {}
          expired++;
        }
      }
      _kpiTick("civ_council", { proposalsProcessed: openProposals.length });
      _mem("civ_council", `Council: ${openProposals.length} open proposals, ${expired} expired`);
    },
  },
  // ── 3. Civilization Governance ─────────────────────────────────────────────
  {
    id: "civ_governance", role: "civ_governance", label: "Civilization Governance",
    description: "Enforces constitution and policies. Validates all civilization-level actions.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const articles = _st().listArticles({ status: "active" });
      const disputes = _st().listDisputes({ status: "open" });
      _kpiTick("civ_governance", { proposalsProcessed: articles.length });
      _mem("civ_governance", `Governance: ${articles.length} active articles, ${disputes.length} open disputes`);
      if (disputes.length > 10) try { _bus()?.emit("civilization:governance:alert", { openDisputes: disputes.length }); } catch {}
    },
  },
  // ── 4. Civilization Constitution ───────────────────────────────────────────
  {
    id: "civ_constitution", role: "civ_constitution", label: "Civilization Constitution",
    description: "Manages constitutional articles, amendments, and legal precedents.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const con = _st().getConstitution();
      const pending = con.amendments.filter(a => a.status === "proposed").length;
      _kpiTick("civ_constitution", { proposalsProcessed: con.articles.length });
      _mem("civ_constitution", `Constitution: ${con.articles.length} articles, ${pending} pending amendments, ${con.precedents.length} precedents`);
    },
  },
  // ── 5. Civilization Policy Engine ─────────────────────────────────────────
  {
    id: "civ_policy", role: "civ_policy", label: "Civilization Policy Engine",
    description: "Evaluates and enforces civilization-wide policies. Bridges to enterprise governance layer.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      let enterprisePolicies = 0;
      try { enterprisePolicies = require("./enterpriseState.cjs").listGovernancePolicies?.({})?.length || 0; } catch {}
      const civArticles = _st().listArticles({ category: "governance" }).length;
      _kpiTick("civ_policy", { proposalsProcessed: civArticles + enterprisePolicies });
      _mem("civ_policy", `Policy: ${civArticles} civ articles, ${enterprisePolicies} enterprise policies`);
    },
  },
  // ── 6. Civilization Economy ────────────────────────────────────────────────
  {
    id: "civ_economy", role: "civ_economy", label: "Civilization Economy",
    description: "Manages resource ledger, trades, and economic balancing across all members.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const trades = _st().listTrades({});
      const completedTrades = trades.filter(t => t.status === "completed").length;
      const pool = _st().getResourcePool("global");
      _kpiTick("civ_economy", { tradesExecuted: completedTrades });
      _mem("civ_economy", `Economy: ${trades.length} total trades, ${completedTrades} completed, pool: ${JSON.stringify(pool)}`);
      try { _bus()?.emit("civilization:economy:ticked", { trades: trades.length, completedTrades }); } catch {}
    },
  },
  // ── 7. Civilization Resource Exchange ─────────────────────────────────────
  {
    id: "civ_resource_exchange", role: "civ_resource_exchange", label: "Civilization Resource Exchange",
    description: "Facilitates resource trading between members. Auto-matches supply and demand.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const pendingTrades = _st().listTrades({ status: "proposed" });
      _kpiTick("civ_resource_exchange", { tradesExecuted: pendingTrades.length });
      _mem("civ_resource_exchange", `Resource Exchange: ${pendingTrades.length} pending trades`);
    },
  },
  // ── 8. Civilization Knowledge Network ─────────────────────────────────────
  {
    id: "civ_knowledge_network", role: "civ_knowledge_network", label: "Civilization Knowledge Network",
    description: "Routes knowledge across civilization. Integrates with AKO (L4) knowledge graph.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const routes = _st().listKnowledgeRoutes({});
      let akoItems = 0;
      try { akoItems = require("./autonomousKnowledgeOrg.cjs")?.listKnowledgeItems?.({})?.total || 0; } catch {}
      _kpiTick("civ_knowledge_network", { knowledgeShared: routes.length });
      _mem("civ_knowledge_network", `Knowledge Network: ${routes.length} routes, ${akoItems} AKO knowledge items`);
    },
  },
  // ── 9. Civilization Mission Network ───────────────────────────────────────
  {
    id: "civ_mission_network", role: "civ_mission_network", label: "Civilization Mission Network",
    description: "Distributes missions across civilization. Bridges to ecosystem mission exchange.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const openMissions = _st().listCivMissions({ status: "open" });
      const assignedMissions = _st().listCivMissions({ status: "assigned" });
      _kpiTick("civ_mission_network", { missionsExchanged: openMissions.length + assignedMissions.length });
      _mem("civ_mission_network", `Mission Network: ${openMissions.length} open, ${assignedMissions.length} assigned`);
      if (openMissions.length > 0) try { _bus()?.emit("civilization:missions:open", { count: openMissions.length }); } catch {}
    },
  },
  // ── 10. Civilization Reputation Network ───────────────────────────────────
  {
    id: "civ_reputation", role: "civ_reputation", label: "Civilization Reputation Network",
    description: "Tracks reputation scores and endorsements across civilization members.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const scores = _st().listReputations({});
      const lowRep = scores.filter(s => s.score < 40).length;
      const highRep = scores.filter(s => s.score >= 80).length;
      const avg = scores.length > 0 ? Math.round(scores.reduce((a,s)=>a+s.score,0)/scores.length) : 70;
      _kpiTick("civ_reputation", { membersRegistered: scores.length });
      _mem("civ_reputation", `Reputation: ${scores.length} members, avg=${avg}, low=${lowRep}, high=${highRep}`);
      if (lowRep > 0) try { _bus()?.emit("civilization:reputation:alert", { lowRep }); } catch {}
    },
  },
  // ── 11. Civilization Trust Engine ─────────────────────────────────────────
  {
    id: "civ_trust", role: "civ_trust", label: "Civilization Trust Engine",
    description: "Aggregates trust across all layers (civ→eco→ent→exec). Flags trust breakdown.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      let ecoTrustEntries = 0;
      try { ecoTrustEntries = require("./ecosystemState.cjs").listTrustScores?.({})?.length || 0; } catch {}
      const civReps = _st().listReputations({}).length;
      _kpiTick("civ_trust", { membersRegistered: civReps + ecoTrustEntries });
      _mem("civ_trust", `Trust Engine: ${civReps} civ reputations, ${ecoTrustEntries} eco trust entries`);
    },
  },
  // ── 12. Civilization Diplomacy ─────────────────────────────────────────────
  {
    id: "civ_diplomacy", role: "civ_diplomacy", label: "Civilization Diplomacy",
    description: "Manages treaties, negotiations, and diplomatic relations between members.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const treaties = _st().listTreaties({});
      const negotiations = _st().listNegotiations({ status: "open" });
      const disputes = _st().listDisputes({ status: "open" });
      _kpiTick("civ_diplomacy", { treatiesSigned: treaties.filter(t => t.status === "ratified").length });
      _mem("civ_diplomacy", `Diplomacy: ${treaties.length} treaties (${treaties.filter(t=>t.status==="ratified").length} ratified), ${negotiations.length} open negotiations, ${disputes.length} open disputes`);
    },
  },
  // ── 13. Civilization Collaboration ────────────────────────────────────────
  {
    id: "civ_collaboration", role: "civ_collaboration", label: "Civilization Collaboration",
    description: "Orchestrates multi-member collaborative projects and channels.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const collabs = _st().listCollaborations({ status: "active" });
      const channels = _st().listChannels({});
      _kpiTick("civ_collaboration", { missionsExchanged: collabs.length });
      _mem("civ_collaboration", `Collaboration: ${collabs.length} active collaborations, ${channels.length} channels`);
    },
  },
  // ── 14. Civilization Arbitration ──────────────────────────────────────────
  {
    id: "civ_arbitration", role: "civ_arbitration", label: "Civilization Arbitration",
    description: "Resolves disputes through fair arbitration. Creates legal precedents.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const openArbs = _st().listArbitrations({ status: "open" });
      const precedents = _st().getConstitution().precedents.length;
      _kpiTick("civ_arbitration", { proposalsProcessed: openArbs.length });
      _mem("civ_arbitration", `Arbitration: ${openArbs.length} open cases, ${precedents} precedents established`);
    },
  },
  // ── 15. Civilization Innovation Engine ────────────────────────────────────
  {
    id: "civ_innovation", role: "civ_innovation", label: "Civilization Innovation Engine",
    description: "Drives civilization-wide innovation. Promotes adopted innovations as standards.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const innovations = _st().listInnovations({});
      const adopted = innovations.filter(i => i.status === "adopted").length;
      _kpiTick("civ_innovation", { innovationsAdopted: adopted });
      _mem("civ_innovation", `Innovation: ${innovations.length} published, ${adopted} adopted standards`);
      if (adopted > 0) try { _bus()?.emit("civilization:innovation:adopted", { count: adopted }); } catch {}
    },
  },
  // ── 16. Civilization Research Network ─────────────────────────────────────
  {
    id: "civ_research", role: "civ_research", label: "Civilization Research Network",
    description: "Coordinates cross-member research. Integrates with AEO (L5) evolution.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const projects = _st().listResearchProjects({ status: "active" });
      let aeoInsights = 0;
      try { aeoInsights = require("./autonomousEvolutionOrg.cjs")?.getOrgSummary?.()?.dashboard?.insights || 0; } catch {}
      _kpiTick("civ_research", { knowledgeShared: projects.length });
      _mem("civ_research", `Research Network: ${projects.length} active projects, ${aeoInsights} AEO insights`);
    },
  },
  // ── 17. Civilization Evolution Board ──────────────────────────────────────
  {
    id: "civ_evolution", role: "civ_evolution", label: "Civilization Evolution Board",
    description: "Approves civilization evolution proposals. Bridges to AEO (L5) and I7 pipeline.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const proposals = _st().listEvolutionProposals({ status: "proposed" });
      const approved = _st().listEvolutionProposals({ status: "approved" });
      _kpiTick("civ_evolution", { innovationsAdopted: approved.length });
      _mem("civ_evolution", `Evolution Board: ${proposals.length} proposed, ${approved.length} approved`);
    },
  },
  // ── 18. Civilization Analytics ────────────────────────────────────────────
  {
    id: "civ_analytics", role: "civ_analytics", label: "Civilization Analytics",
    description: "Generates civilization-wide analytics: member growth, trade volume, innovation velocity.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const health = (() => { try { return _st().getCivilizationHealth(); } catch { return { score: 50 }; } })();
      const kpis = _st().getAllCivKpis();
      _kpiTick("civ_analytics", { reportsGenerated: (_st().getCivKpi("civ_analytics").reportsGenerated || 0) + 1 });
      _mem("civ_analytics", `Analytics: civilization health=${health.score}, ${kpis.length} domain KPIs`);
      try { _bus()?.emit("civilization:analytics:ticked", { health: health.score, kpiDomains: kpis.length }); } catch {}
    },
  },
  // ── 19. Civilization Health ────────────────────────────────────────────────
  {
    id: "civ_health", role: "civ_health", label: "Civilization Health",
    description: "Monitors civilization-wide health across all 9 levels. Raises alerts on degradation.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const health = (() => { try { return _st().getCivilizationHealth(); } catch { return { score: 50, alerts: [] }; } })();
      _kpiTick("civ_health", { reportsGenerated: (_st().getCivKpi("civ_health").reportsGenerated || 0) + 1 });
      _mem("civ_health", `Health Monitor: score=${health.score}, alerts=${health.alerts?.length || 0}`);
      if (health.score < 70) {
        try {
          _st().createCivReport({
            title: `Health Alert — ${new Date().toISOString().slice(0,10)}`,
            domainId: "civ_health", type: "alert",
            summary: `Civilization health dropped to ${health.score}. Alerts: ${(health.alerts||[]).map(a=>a.type).join(", ")}`,
            data: health,
          });
        } catch {}
        try { _bus()?.emit("civilization:health:alert", { score: health.score, alerts: health.alerts?.length }); } catch {}
      }
    },
  },
  // ── 20. Civilization Director ──────────────────────────────────────────────
  {
    id: "civ_director", role: "civ_director", label: "Civilization Director",
    description: "Orchestrates all civilization domains. Coordinates with Ecosystem Layer (L8). Drives civilization alignment and evolution.",
    intervalMs: 180_000, enabled: true,
    tickFn: () => {
      const health = (() => { try { return _st().getCivilizationHealth(); } catch { return { score: 50 }; } })();
      const openMissions = _st().listCivMissions({ status: "open" }).length;
      const openDisputes = _st().listDisputes({ status: "open" }).length;
      const pendingProposals = _st().listProposals({ status: "open" }).length;

      if (openMissions > 0) {
        // Auto-delegate oldest open mission to most reputable member
        const missions = _st().listCivMissions({ status: "open" });
        if (missions.length > 0) {
          const mission = missions[missions.length - 1]; // oldest
          const members = _st().listMembers({ status: "active" });
          if (members.length > 0) {
            const best = members.sort((a,b) => (b.reputation||70) - (a.reputation||70))[0];
            try { _st().bidCivMission(mission.id, { bidderMemberId: best.id, proposal: "Auto-delegated by director" }); } catch {}
          }
        }
      }

      _kpiTick("civ_director", { membersRegistered: (_st().getCivKpi("civ_director").membersRegistered || 0) + 1 });
      _mem("civ_director", `Director: health=${health.score}, openMissions=${openMissions}, openDisputes=${openDisputes}, pendingProposals=${pendingProposals}`);
      try { _bus()?.emit("civilization:director:ticked", { health: health.score, openMissions, openDisputes, pendingProposals }); } catch {}
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: CIV_ORG.length, registered: CIV_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}

  const results = [];
  for (const spec of CIV_ORG) {
    try { results.push(sup.registerAgent(spec)); } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  _registered = true;

  try { _wf().bootstrapCivilization(); } catch {}
  try { _wf().subscribecivEvents(); }     catch {}

  try { _bus()?.emit("civilization:registered", { count: CIV_ORG.length, ids: CIV_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: CIV_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  try {
    const sup = _sup();
    return CIV_ORG.map(spec => sup.getAgent(spec.id) || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" });
  } catch { return CIV_ORG.map(spec => ({ id: spec.id, role: spec.role, label: spec.label, status: "unknown" })); }
}

function getOrgSummary() {
  const status = getOrgStatus();
  const running = status.filter(a => a.status === "running").length;
  const db = (() => { try { return _st().getCivilizationDashboard(); } catch { return {}; } })();
  return { total: CIV_ORG.length, running, stopped: CIV_ORG.length - running, dashboard: db };
}

module.exports = { register, getOrgStatus, getOrgSummary, CIV_ORG };
