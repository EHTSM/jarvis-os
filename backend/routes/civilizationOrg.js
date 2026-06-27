"use strict";
/**
 * Civilization Platform — Routes (LEVEL 9)
 * /civ/* management + /civ/v9/* full API surface
 */
const router = require("express").Router();

const _org = () => require("../services/civilizationOrg.cjs");
const _st  = () => require("../services/civilizationState.cjs");
const _wf  = () => require("../services/civilizationWorkflow.cjs");

// ── Management ────────────────────────────────────────────────────────────────
router.get("/civ/status",     (req, res) => res.json(_org().getOrgStatus()));
router.get("/civ/summary",    (req, res) => res.json(_org().getOrgSummary()));
router.get("/civ/agents/:id", (req, res) => {
  const a = _org().getOrgStatus().find(x => x.id === req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "Domain not found" });
});

// ── Dashboard + Health + Context ──────────────────────────────────────────────
router.get("/civ/v9/dashboard", (req, res) => res.json(_st().getCivilizationDashboard()));
router.get("/civ/v9/health",    (req, res) => res.json(_st().getCivilizationHealth()));
router.get("/civ/v9/context",   (req, res) => res.json(_st().getCivContext()));
router.patch("/civ/v9/context", (req, res) => res.json(_st().updateCivContext(req.body)));

// ── Search ────────────────────────────────────────────────────────────────────
router.get("/civ/v9/search", (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });
  return res.json(_st().civilizationSearch(q, { limit: parseInt(limit)||30 }));
});

// ── Member Registry ───────────────────────────────────────────────────────────
router.get("/civ/v9/members",      (req, res) => res.json(_st().listMembers(req.query)));
router.post("/civ/v9/members",     (req, res) => { const r = _st().registerMember(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/civ/v9/members/:id",  (req, res) => { const m = _st().getMember(req.params.id); return m ? res.json(m) : res.status(404).json({ error: "Not found" }); });
router.patch("/civ/v9/members/:id",(req, res) => res.json(_st().updateMember(req.params.id, req.body)));

router.get("/civ/v9/alliances",    (req, res) => res.json(_st().listAlliances(req.query)));
router.post("/civ/v9/alliances",   (req, res) => { const r = _st().formAlliance(req.body); return res.status(r.ok?201:400).json(r); });

// ── Council ───────────────────────────────────────────────────────────────────
router.get("/civ/v9/council/members",         (req, res) => res.json(_st().listCouncilMembers(req.query)));
router.post("/civ/v9/council/members",        (req, res) => { const r = _st().addCouncilMember(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/civ/v9/council/proposals",       (req, res) => res.json(_st().listProposals(req.query)));
router.post("/civ/v9/council/proposals",      (req, res) => { const r = _st().createProposal(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/council/proposals/:id/vote", (req, res) => res.json(_st().voteOnProposal(req.params.id, req.body)));

// ── Constitution ──────────────────────────────────────────────────────────────
router.get("/civ/v9/constitution",           (req, res) => res.json(_st().getConstitution()));
router.get("/civ/v9/constitution/articles",  (req, res) => res.json(_st().listArticles(req.query)));
router.post("/civ/v9/constitution/articles", (req, res) => { const r = _st().addConstitutionalArticle(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/constitution/amendments",(req,res) => { const r = _st().proposeAmendment(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/constitution/precedents",(req,res) => { const r = _st().recordPrecedent(req.body); return res.status(r.ok?201:400).json(r); });

// ── Economy ───────────────────────────────────────────────────────────────────
router.get("/civ/v9/economy/balance/:memberId", (req, res) => res.json(_st().getBalance(req.params.memberId)));
router.post("/civ/v9/economy/credit",  (req, res) => res.json(_st().creditResource(req.body.memberId, req.body.resourceType, req.body.amount, req.body.reason)));
router.post("/civ/v9/economy/debit",   (req, res) => res.json(_st().debitResource(req.body.memberId, req.body.resourceType, req.body.amount, req.body.reason)));
router.get("/civ/v9/economy/trades",   (req, res) => res.json(_st().listTrades(req.query)));
router.post("/civ/v9/economy/trades",  (req, res) => { const r = _st().proposeTrade(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/economy/trades/:id/accept", (req, res) => res.json(_st().acceptTrade(req.params.id, req.body)));
router.get("/civ/v9/economy/pool/:poolId",       (req, res) => res.json(_st().getResourcePool(req.params.poolId)));
router.post("/civ/v9/economy/pool/contribute",   (req, res) => res.json(_st().contributeToPool(req.body)));
router.post("/civ/v9/economy/pool/claim",        (req, res) => res.json(_st().claimFromPool(req.body)));

// ── Network (Channels + Missions + Knowledge + Collaborations) ────────────────
router.get("/civ/v9/network/channels",    (req, res) => res.json(_st().listChannels(req.query)));
router.post("/civ/v9/network/channels",   (req, res) => { const r = _st().createChannel(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/civ/v9/network/missions",                     (req, res) => res.json(_st().listCivMissions(req.query)));
router.post("/civ/v9/network/missions",                    (req, res) => { const r = _st().publishCivMission(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/network/missions/:id/bid",            (req, res) => res.json(_st().bidCivMission(req.params.id, req.body)));
router.post("/civ/v9/network/missions/:id/assign",         (req, res) => res.json(_st().assignCivMission(req.params.id, req.body)));

router.get("/civ/v9/network/knowledge",   (req, res) => res.json(_st().listKnowledgeRoutes(req.query)));
router.post("/civ/v9/network/knowledge",  (req, res) => { const r = _st().shareKnowledgeRoute(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/civ/v9/network/collaborations",  (req, res) => res.json(_st().listCollaborations(req.query)));
router.post("/civ/v9/network/collaborations", (req, res) => { const r = _st().startCollaboration(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/network/collaborations/:id/complete", (req, res) => res.json(_st().completeCollaboration(req.params.id, req.body)));

// ── Reputation + Trust ────────────────────────────────────────────────────────
router.get("/civ/v9/reputation",             (req, res) => res.json(_st().listReputations(req.query)));
router.get("/civ/v9/reputation/:memberId",   (req, res) => res.json(_st().getReputation(req.params.memberId)));
router.post("/civ/v9/reputation/event",      (req, res) => res.json(_st().recordReputationEvent(req.body)));
router.post("/civ/v9/reputation/endorse",    (req, res) => { const r = _st().endorseMember(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/reputation/badge",      (req, res) => { const r = _st().awardBadge(req.body); return res.status(r.ok?201:400).json(r); });

// ── Diplomacy ─────────────────────────────────────────────────────────────────
router.get("/civ/v9/diplomacy/treaties",              (req, res) => res.json(_st().listTreaties(req.query)));
router.post("/civ/v9/diplomacy/treaties",             (req, res) => { const r = _st().proposeTreaty(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/diplomacy/treaties/:id/ratify",  (req, res) => res.json(_st().ratifyTreaty(req.params.id, req.body)));

router.get("/civ/v9/diplomacy/disputes",              (req, res) => res.json(_st().listDisputes(req.query)));
router.post("/civ/v9/diplomacy/disputes",             (req, res) => { const r = _st().raiseDispute(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/civ/v9/diplomacy/arbitrations",           (req, res) => res.json(_st().listArbitrations(req.query)));
router.post("/civ/v9/diplomacy/arbitrations",          (req, res) => { const r = _st().openArbitration(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/diplomacy/arbitrations/:id/close",(req, res) => res.json(_st().closeArbitration(req.params.id, req.body)));

router.get("/civ/v9/diplomacy/negotiations",             (req, res) => res.json(_st().listNegotiations(req.query)));
router.post("/civ/v9/diplomacy/negotiations",            (req, res) => { const r = _st().openNegotiation(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/diplomacy/negotiations/:id/round",  (req, res) => res.json(_st().addNegotiationRound(req.params.id, req.body)));
router.post("/civ/v9/diplomacy/negotiations/:id/conclude",(req,res) => res.json(_st().concludeNegotiation(req.params.id, req.body)));

// ── Innovation + Research + Evolution ─────────────────────────────────────────
router.get("/civ/v9/innovation/projects",          (req, res) => res.json(_st().listResearchProjects(req.query)));
router.post("/civ/v9/innovation/projects",         (req, res) => { const r = _st().createResearchProject(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/innovation/projects/:id/finding", (req, res) => res.json(_st().addFinding(req.params.id, req.body)));

router.get("/civ/v9/innovation/innovations",        (req, res) => res.json(_st().listInnovations(req.query)));
router.post("/civ/v9/innovation/innovations",       (req, res) => { const r = _st().publishInnovation(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/innovation/innovations/:id/adopt", (req, res) => res.json(_st().adoptInnovation(req.params.id, req.body)));

router.get("/civ/v9/evolution/proposals",            (req, res) => res.json(_st().listEvolutionProposals(req.query)));
router.post("/civ/v9/evolution/proposals",           (req, res) => { const r = _st().proposeEvolution(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/civ/v9/evolution/proposals/:id/vote",  (req, res) => res.json(_st().voteEvolution(req.params.id, req.body)));

// ── KPIs + Memory + Reports ───────────────────────────────────────────────────
router.get("/civ/v9/kpis",            (req, res) => res.json(_st().getAllCivKpis()));
router.get("/civ/v9/kpis/:domainId",  (req, res) => res.json(_st().getCivKpi(req.params.domainId)));

router.get("/civ/v9/memory",          (req, res) => res.json(_st().listCivMemory(req.query)));
router.post("/civ/v9/memory",         (req, res) => { const r = _st().addCivMemory(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/civ/v9/reports",         (req, res) => res.json(_st().listCivReports(req.query)));
router.post("/civ/v9/reports",        (req, res) => { const r = _st().createCivReport(req.body); return res.status(r.ok?201:400).json(r); });

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow triggers
// ═══════════════════════════════════════════════════════════════════════════════

// POST /civ/v9/command — full 6-step civilization pipeline
router.post("/civ/v9/command", async (req, res) => {
  const { command, memberId, tenantId, priority, domain, resources, amountUsd } = req.body || {};
  if (!command) return res.status(400).json({ error: "command required" });
  const r = await _wf().runCivilizationPipeline(command, { memberId, tenantId, priority, domain, resources, amountUsd });
  return res.status(r.ok ? 200 : 400).json(r);
});

// POST /civ/v9/workflow/negotiate
router.post("/civ/v9/workflow/negotiate", (req, res) => res.json(_wf().negotiateBetweenOrgs(req.body)));

// POST /civ/v9/workflow/delegate
router.post("/civ/v9/workflow/delegate", (req, res) => res.json(_wf().delegateToMember(req.body)));

// POST /civ/v9/workflow/governance
router.post("/civ/v9/workflow/governance", (req, res) => res.json(_wf().civilizationGovernance(req.body.eosGoalId, req.body)));

module.exports = router;
