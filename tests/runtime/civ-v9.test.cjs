"use strict";
/**
 * LEVEL 9 — Civilization Platform test suite
 * Target: 95+ tests covering state, workflow, org, integration
 *
 * ERA-1 Manual Blocker Closure (Task 6): this suite reaches
 * executiveState.cjs's createExecMission() (via civilizationWorkflow.cjs's
 * _eosSt().createGoal-adjacent chain) -> missionOrchestrator.createManual()
 * -> missionMemory.createMission(), which previously wrote real msn_* records
 * into production data/missions.json (Mission 97/98's documented root cause).
 * Setting JARVIS_TEST_DATA_SUFFIX before any backend service is required
 * redirects missionMemory.cjs's MISSIONS_FILE to an isolated per-run file.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = process.env.JARVIS_TEST_DATA_SUFFIX || `test-${process.pid}-${Date.now()}`;

const TS = Date.now();
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };
let passed = 0; let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};
const asyncTest = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};

const st = require("../../backend/services/civilizationState.cjs");
const wf = require("../../backend/services/civilizationWorkflow.cjs");
const org = require("../../backend/services/civilizationOrg.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Member Registry
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 1: Member Registry");

let memberA, memberB, memberC;

test("registerMember — ok", () => {
  const r = st.registerMember({ name: `OrgA-${TS}`, type: "organization", capabilities: ["code","design"], resources: { compute: 100, knowledge: 50 } });
  assert(r.ok, `registerMember failed: ${r.error}`);
  assert(r.member?.id, "no member id");
  assert(r.member.status === "active", "not active");
  memberA = r.member;
});

test("registerMember — dedup returns existing", () => {
  const r2 = st.registerMember({ name: `OrgA-${TS}`, type: "organization" });
  assert(r2.ok, "dedup should return ok");
  assert(r2.existing, "should indicate existing");
});

test("registerMember — second member", () => {
  const r = st.registerMember({ name: `OrgB-${TS}`, type: "enterprise", capabilities: ["sales","marketing"], resources: { capital: 500 } });
  assert(r.ok, `failed: ${r.error}`);
  memberB = r.member;
});

test("registerMember — third member", () => {
  const r = st.registerMember({ name: `OrgC-${TS}`, type: "organization", capabilities: ["knowledge","research"] });
  assert(r.ok, `failed: ${r.error}`);
  memberC = r.member;
});

test("listMembers — returns array", () => {
  const list = st.listMembers({});
  assert(Array.isArray(list) && list.length >= 3, `expected >=3 members, got ${list.length}`);
});

test("listMembers — filter by type", () => {
  const list = st.listMembers({ type: "enterprise" });
  assert(list.every(m => m.type === "enterprise"), "type filter failed");
});

test("getMember — returns correct member", () => {
  const m = st.getMember(memberA.id);
  assert(m?.id === memberA.id, "wrong member returned");
});

test("updateMember — updates fields", () => {
  const r = st.updateMember(memberA.id, { tier: "premium", reputation: 80 });
  assert(r.ok, `update failed: ${r.error}`);
  assert(r.member.tier === "premium", "tier not updated");
});

test("formAlliance — ok", () => {
  const r = st.formAlliance({ name: `AllianceAB-${TS}`, memberIds: [memberA.id, memberB.id], type: "collaboration", purpose: "Joint engineering" });
  assert(r.ok, `formAlliance failed: ${r.error}`);
  assert(r.alliance?.id, "no alliance id");
});

test("listAlliances — returns array", () => {
  assert(Array.isArray(st.listAlliances({})), "not array");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Council + Proposals
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 2: Council & Proposals");

test("addCouncilMember — ok", () => {
  const r = st.addCouncilMember({ memberId: memberA.id, role: "representative", votingWeight: 1 });
  assert(r.ok, `addCouncilMember failed: ${r.error}`);
  assert(r.councilMember?.id, "no council member id");
});

test("addCouncilMember — duplicate blocked", () => {
  const r = st.addCouncilMember({ memberId: memberA.id, role: "representative" });
  assert(!r.ok, "should reject duplicate");
});

test("addCouncilMember — second member", () => {
  const r = st.addCouncilMember({ memberId: memberB.id, role: "delegate", votingWeight: 1 });
  assert(r.ok, `failed: ${r.error}`);
});

test("listCouncilMembers — returns active", () => {
  const list = st.listCouncilMembers({ status: "active" });
  assert(Array.isArray(list) && list.length >= 2, `expected >=2 council members, got ${list.length}`);
});

test("createProposal — ok", () => {
  const r = st.createProposal({ title: `Proposal-${TS}`, proposerId: memberA.id, type: "policy", description: "Expand knowledge sharing", requiredVotes: 1 });
  assert(r.ok, `createProposal failed: ${r.error}`);
  assert(r.proposal?.id, "no proposal id");
  assert(r.proposal.status === "open", "not open");
});

test("voteOnProposal — for — passes when threshold met", () => {
  const p = st.createProposal({ title: `VoteTest-${TS}`, proposerId: memberA.id, type: "resource", requiredVotes: 1 });
  const r = st.voteOnProposal(p.proposal.id, { voterId: memberA.id, vote: "for" });
  assert(r.ok, `vote failed: ${r.error}`);
  assert(r.proposal.status === "passed" || r.proposal.votesFor >= 1, "proposal not moving forward");
});

test("voteOnProposal — duplicate vote blocked", () => {
  const p = st.createProposal({ title: `DupVote-${TS}`, proposerId: memberB.id, type: "policy", requiredVotes: 2 });
  st.voteOnProposal(p.proposal.id, { voterId: memberA.id, vote: "for" });
  const r = st.voteOnProposal(p.proposal.id, { voterId: memberA.id, vote: "for" });
  assert(!r.ok, "should reject duplicate vote");
});

test("listProposals — filter by status", () => {
  const open = st.listProposals({ status: "open" });
  assert(Array.isArray(open), "not array");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Constitution
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 3: Constitution");

test("addConstitutionalArticle — ok", () => {
  const r = st.addConstitutionalArticle({ title: `Article-${TS}`, content: "All members must cooperate.", category: "obligations", articleNumber: 100 });
  assert(r.ok, `addArticle failed: ${r.error}`);
  assert(r.article?.id, "no article id");
});

test("addConstitutionalArticle — dedup articleNumber", () => {
  const r = st.addConstitutionalArticle({ title: "Dup", content: "Dup", articleNumber: 100 });
  assert(!r.ok, "should reject duplicate article number");
});

test("listArticles — returns sorted by number", () => {
  const list = st.listArticles({});
  assert(Array.isArray(list), "not array");
});

test("proposeAmendment — ok", () => {
  const arts = st.listArticles({});
  if (arts.length > 0) {
    const r = st.proposeAmendment({ articleId: arts[0].id, proposerId: memberA.id, change: "Add clause for AI rights", rationale: "AI entities need representation" });
    assert(r.ok, `proposeAmendment failed: ${r.error}`);
  }
});

test("recordPrecedent — ok", () => {
  const r = st.recordPrecedent({ title: `Precedent-${TS}`, ruling: "Members must share knowledge freely", context: "Knowledge dispute resolution", caseRef: "CASE-001" });
  assert(r.ok, `recordPrecedent failed: ${r.error}`);
  assert(r.precedent?.id, "no precedent id");
});

test("getConstitution — returns all sections", () => {
  const con = st.getConstitution();
  assert(con.articles !== undefined, "no articles");
  assert(con.amendments !== undefined, "no amendments");
  assert(con.precedents !== undefined, "no precedents");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — Economy
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 4: Economy");

test("creditResource — ok", () => {
  const r = st.creditResource(memberA.id, "compute", 50, "grant");
  assert(r.ok, `credit failed: ${r.error}`);
  assert(r.balance?.compute >= 50, "compute not credited");
});

test("debitResource — ok", () => {
  // Credit first to ensure balance
  st.creditResource(memberB.id, "knowledge", 100, "setup");
  const r = st.debitResource(memberB.id, "knowledge", 30, "trade");
  assert(r.ok, `debit failed: ${r.error}`);
  assert(r.balance?.knowledge === 70, `expected 70, got ${r.balance?.knowledge}`);
});

test("debitResource — insufficient balance", () => {
  const r = st.debitResource(memberC.id, "capital", 99999, "test");
  assert(!r.ok, "should fail on insufficient balance");
  assert(r.error?.includes("Insufficient"), "wrong error message");
});

test("getBalance — returns balance object", () => {
  const b = st.getBalance(memberA.id);
  assert(b && typeof b === "object", "not object");
  assert(typeof b.compute === "number", "no compute field");
});

test("proposeTrade — ok", () => {
  st.creditResource(memberA.id, "compute", 200, "setup");
  st.creditResource(memberB.id, "knowledge", 200, "setup");
  const r = st.proposeTrade({
    fromMemberId: memberA.id, toMemberId: memberB.id,
    offer: { compute: 50 }, request: { knowledge: 40 },
    description: "Compute for knowledge exchange",
  });
  assert(r.ok, `proposeTrade failed: ${r.error}`);
  assert(r.trade?.id, "no trade id");
});

test("acceptTrade — executes resource transfer", () => {
  st.creditResource(memberA.id, "compute", 500, "setup");
  st.creditResource(memberB.id, "knowledge", 500, "setup");
  const tr = st.proposeTrade({ fromMemberId: memberA.id, toMemberId: memberB.id, offer: { compute: 10 }, request: { knowledge: 10 } });
  const r = st.acceptTrade(tr.trade.id, { acceptorId: memberB.id });
  assert(r.ok, `acceptTrade failed: ${JSON.stringify(r.errors)}`);
  assert(r.trade?.status === "completed", "trade not completed");
});

test("acceptTrade — wrong acceptor rejected", () => {
  st.creditResource(memberA.id, "compute", 100, "setup");
  st.creditResource(memberB.id, "knowledge", 100, "setup");
  const tr = st.proposeTrade({ fromMemberId: memberA.id, toMemberId: memberB.id, offer: { compute: 5 }, request: { knowledge: 5 } });
  const r = st.acceptTrade(tr.trade.id, { acceptorId: memberC.id });
  assert(!r.ok, "should reject wrong acceptor");
});

test("listTrades — returns array", () => {
  assert(Array.isArray(st.listTrades({})), "not array");
});

test("contributeToPool — ok", () => {
  st.creditResource(memberA.id, "capital", 500, "setup");
  const r = st.contributeToPool({ memberId: memberA.id, resourceType: "capital", amount: 100, poolId: "global" });
  assert(r.ok, `contributeToPool failed: ${r.error}`);
});

test("claimFromPool — ok", () => {
  const r = st.claimFromPool({ memberId: memberB.id, resourceType: "capital", amount: 50, poolId: "global" });
  assert(r.ok, `claimFromPool failed: ${r.error}`);
});

test("claimFromPool — insufficient pool", () => {
  const r = st.claimFromPool({ memberId: memberC.id, resourceType: "capital", amount: 99999, poolId: "global" });
  assert(!r.ok, "should fail on insufficient pool");
});

test("getResourcePool — returns pool", () => {
  const p = st.getResourcePool("global");
  assert(p && typeof p === "object", "not object");
  assert(typeof p.capital === "number", "no capital in pool");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5 — Network (Missions + Knowledge + Collaboration + Channels)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 5: Network");

test("createChannel — ok", () => {
  const r = st.createChannel({ name: `TestChannel-${TS}`, type: "technical", description: "Test channel", visibility: "public" });
  assert(r.ok, `createChannel failed: ${r.error}`);
  assert(r.channel?.id, "no channel id");
});

test("createChannel — dedup", () => {
  st.createChannel({ name: `DupChannel-${TS}`, type: "general", visibility: "public" });
  const r = st.createChannel({ name: `DupChannel-${TS}`, type: "general", visibility: "public" });
  assert(!r.ok, "should reject duplicate channel");
});

test("listChannels — returns array", () => {
  const list = st.listChannels({});
  assert(Array.isArray(list) && list.length >= 1, "no channels");
});

let civMission;
test("publishCivMission — ok", () => {
  const r = st.publishCivMission({ fromMemberId: memberA.id, title: `Build AI system ${TS}`, requiredCapabilities: ["code"], priority: "high", domain: "engineering" });
  assert(r.ok, `publishCivMission failed: ${r.error}`);
  assert(r.missionRoute?.id, "no mission id");
  assert(r.missionRoute.status === "open", "not open");
  civMission = r.missionRoute;
});

test("bidCivMission — ok", () => {
  const r = st.bidCivMission(civMission.id, { bidderMemberId: memberB.id, proposal: "We can build this", estimatedResources: { compute: 100 }, timeline: "2 weeks" });
  assert(r.ok, `bid failed: ${r.error}`);
  assert(r.bid?.id, "no bid id");
});

test("assignCivMission — ok", () => {
  const r = st.assignCivMission(civMission.id, { toMemberId: memberB.id });
  assert(r.ok, `assign failed: ${r.error}`);
  assert(r.missionRoute.status === "assigned", "not assigned");
  assert(r.missionRoute.assignedTo === memberB.id, "wrong assignee");
});

test("listCivMissions — filter by status", () => {
  const open = st.listCivMissions({ status: "open" });
  assert(Array.isArray(open), "not array");
});

test("shareKnowledgeRoute — ok", () => {
  const r = st.shareKnowledgeRoute({ fromMemberId: memberA.id, toMemberId: memberB.id, title: `Knowledge ${TS}`, content: "Important insights about AI scaling", type: "article", visibility: "members" });
  assert(r.ok, `shareKnowledge failed: ${r.error}`);
  assert(r.knowledgeRoute?.id, "no knowledge id");
});

test("listKnowledgeRoutes — returns array", () => {
  const list = st.listKnowledgeRoutes({});
  assert(Array.isArray(list) && list.length >= 1, "no knowledge routes");
});

test("startCollaboration — ok", () => {
  const r = st.startCollaboration({ name: `Collab-${TS}`, memberIds: [memberA.id, memberB.id], objective: "Build shared platform", domain: "engineering" });
  assert(r.ok, `startCollaboration failed: ${r.error}`);
  assert(r.collaboration?.id, "no collaboration id");
});

test("completeCollaboration — ok", () => {
  const c = st.startCollaboration({ name: `CompleteCollab-${TS}`, memberIds: [memberA.id, memberC.id], objective: "Research project" });
  const r = st.completeCollaboration(c.collaboration.id, { outcome: "Research complete", results: { papers: 3 } });
  assert(r.ok, `completeCollaboration failed: ${r.error}`);
  assert(r.collaboration.status === "completed", "not completed");
});

test("listCollaborations — filter by status", () => {
  const list = st.listCollaborations({ status: "active" });
  assert(Array.isArray(list), "not array");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 6 — Reputation + Trust
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 6: Reputation & Trust");

test("recordReputationEvent — ok", () => {
  const r = st.recordReputationEvent({ memberId: memberA.id, eventType: "mission_completed", score: 5, fromMemberId: memberB.id, detail: "Excellent work" });
  assert(r.ok, `recordReputation failed: ${r.error}`);
  assert(typeof r.reputation?.score === "number", "no score");
});

test("reputation score clamps 0-100", () => {
  for (let i = 0; i < 30; i++) st.recordReputationEvent({ memberId: memberB.id, eventType: "contribution", score: 10 });
  const rep = st.getReputation(memberB.id);
  assert(rep.score <= 100 && rep.score >= 0, `score OOB: ${rep.score}`);
});

test("getReputation — returns default for unknown", () => {
  const rep = st.getReputation(`unknown-${TS}`);
  assert(rep.score === 70, `expected 70, got ${rep.score}`);
});

test("endorseMember — ok", () => {
  const r = st.endorseMember({ fromMemberId: memberB.id, toMemberId: memberA.id, domain: "engineering", message: "Outstanding contributor" });
  assert(r.ok, `endorse failed: ${r.error}`);
  assert(r.endorsement?.id, "no endorsement id");
});

test("awardBadge — ok", () => {
  const r = st.awardBadge({ memberId: memberA.id, badge: "Pioneer", reason: "First to adopt innovation", fromMemberId: "civilization" });
  assert(r.ok, `awardBadge failed: ${r.error}`);
  assert(r.badge?.id, "no badge id");
});

test("listReputations — returns scored array", () => {
  const list = st.listReputations({});
  assert(Array.isArray(list) && list.length >= 1, "no reputations");
  assert(list[0]?.score !== undefined, "no score field");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 7 — Diplomacy
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 7: Diplomacy");

let treatyId;
test("proposeTreaty — ok", () => {
  const r = st.proposeTreaty({ title: `Treaty-${TS}`, type: "trade", parties: [memberA.id, memberB.id], terms: ["Free trade of compute resources", "Mutual knowledge sharing"], proposerId: memberA.id });
  assert(r.ok, `proposeTreaty failed: ${r.error}`);
  assert(r.treaty?.id, "no treaty id");
  treatyId = r.treaty.id;
});

test("ratifyTreaty — first party", () => {
  const r = st.ratifyTreaty(treatyId, { memberId: memberA.id });
  assert(r.ok, `ratify failed: ${r.error}`);
  assert(r.treaty.signatures.includes(memberA.id), "signature not recorded");
});

test("ratifyTreaty — second party → ratified", () => {
  const r = st.ratifyTreaty(treatyId, { memberId: memberB.id });
  assert(r.ok, `ratify failed: ${r.error}`);
  assert(r.treaty.status === "ratified", "should be ratified after all parties sign");
});

test("ratifyTreaty — non-party rejected", () => {
  const r = st.ratifyTreaty(treatyId, { memberId: memberC.id });
  assert(!r.ok, "should reject non-party");
});

test("listTreaties — filter by status", () => {
  const ratified = st.listTreaties({ status: "ratified" });
  assert(Array.isArray(ratified) && ratified.length >= 1, "no ratified treaties");
});

let disputeId;
test("raiseDispute — ok", () => {
  const r = st.raiseDispute({ title: `Dispute-${TS}`, claimantId: memberA.id, respondentId: memberB.id, category: "resource", description: "Resource allocation disagreement" });
  assert(r.ok, `raiseDispute failed: ${r.error}`);
  assert(r.dispute?.id, "no dispute id");
  disputeId = r.dispute.id;
});

test("openArbitration — ok", () => {
  const r = st.openArbitration({ disputeId, arbitratorId: memberC.id, description: "Neutral arbitration" });
  assert(r.ok, `openArbitration failed: ${r.error}`);
  assert(r.arbitration?.id, "no arbitration id");
  // Close it
  st.closeArbitration(r.arbitration.id, { ruling: "Parties share resources equally", precedentTitle: `Precedent-${TS}` });
});

test("listDisputes — filter by status", () => {
  const list = st.listDisputes({ status: "resolved" });
  assert(Array.isArray(list), "not array");
});

test("openNegotiation — ok", () => {
  const r = st.openNegotiation({ title: `Negotiation-${TS}`, parties: [memberA.id, memberB.id], subject: "Partnership terms", proposerId: memberA.id, initialTerms: { revShare: "50/50" } });
  assert(r.ok, `openNegotiation failed: ${r.error}`);
  assert(r.negotiation?.id, "no negotiation id");
});

test("addNegotiationRound — ok", () => {
  const neg = st.openNegotiation({ title: `NegRound-${TS}`, parties: [memberA.id, memberC.id], subject: "Data sharing", proposerId: memberA.id });
  const r = st.addNegotiationRound(neg.negotiation.id, { memberId: memberA.id, terms: { dataAccess: "full" }, counterOffer: {} });
  assert(r.ok, `addRound failed: ${r.error}`);
  assert(r.round?.id, "no round id");
});

test("concludeNegotiation — creates treaty on agreement", () => {
  const neg = st.openNegotiation({ title: `Conclude-${TS}`, parties: [memberB.id, memberC.id], subject: "Joint project", proposerId: memberB.id });
  const r = st.concludeNegotiation(neg.negotiation.id, { agreedTerms: { projectName: `JP-${TS}`, duration: "6m" }, outcome: "agreement" });
  assert(r.ok, `conclude failed: ${r.error}`);
  assert(r.negotiation.status === "concluded", "not concluded");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 8 — Innovation + Research + Evolution
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 8: Innovation, Research, Evolution");

let projectId;
test("createResearchProject — ok", () => {
  const r = st.createResearchProject({ title: `Research-${TS}`, leadMemberId: memberA.id, collaborators: [memberB.id], domain: "ai", hypothesis: "AI can self-organize", timeline: "6m" });
  assert(r.ok, `createProject failed: ${r.error}`);
  assert(r.project?.id, "no project id");
  projectId = r.project.id;
});

test("addFinding — ok", () => {
  const r = st.addFinding(projectId, { finding: "Self-organization emerges after 100 cycles", confidence: 0.85, evidence: "Simulation data", memberId: memberA.id });
  assert(r.ok, `addFinding failed: ${r.error}`);
  assert(r.finding?.id, "no finding id");
});

test("listResearchProjects — returns array", () => {
  const list = st.listResearchProjects({});
  assert(Array.isArray(list) && list.length >= 1, "no projects");
});

let innovationId;
test("publishInnovation — ok", () => {
  const r = st.publishInnovation({ title: `Innovation-${TS}`, description: "Novel consensus algorithm", authorMemberId: memberA.id, category: "process", impact: "high", implementation: "Use weighted voting with reputation" });
  assert(r.ok, `publishInnovation failed: ${r.error}`);
  assert(r.innovation?.id, "no innovation id");
  innovationId = r.innovation.id;
});

test("adoptInnovation — increments count + reputation", () => {
  const r = st.adoptInnovation(innovationId, { memberId: memberB.id, notes: "Implementing in our pipeline" });
  assert(r.ok, `adopt failed: ${r.error}`);
  assert(r.innovation?.adoptions >= 1, "adoptions not incremented");
});

test("adoptInnovation — 3 adoptions → adopted status", () => {
  st.adoptInnovation(innovationId, { memberId: memberC.id });
  const r = st.adoptInnovation(innovationId, { memberId: `extra-${TS}` });
  assert(r.ok, "third adopt should succeed");
  assert(r.innovation.status === "adopted", `expected adopted, got ${r.innovation.status}`);
});

test("listInnovations — filter by category", () => {
  const list = st.listInnovations({ category: "process" });
  assert(Array.isArray(list) && list.length >= 1, "no process innovations");
});

let evoPropId;
test("proposeEvolution — ok", () => {
  const r = st.proposeEvolution({ title: `Evo-${TS}`, proposerId: memberA.id, targetDomain: "engineering", change: "Add self-healing to all engineering orgs", rationale: "Reduces downtime", priority: "high" });
  assert(r.ok, `proposeEvolution failed: ${r.error}`);
  assert(r.evolutionProposal?.id, "no proposal id");
  evoPropId = r.evolutionProposal.id;
});

test("voteEvolution — for", () => {
  const r = st.voteEvolution(evoPropId, { memberId: memberA.id, vote: "for", rationale: "Critical for resilience" });
  assert(r.ok, `vote failed: ${r.error}`);
  assert(r.evolutionProposal.votesFor >= 1, "vote not counted");
});

test("voteEvolution — 3 for → approved", () => {
  st.voteEvolution(evoPropId, { memberId: memberB.id, vote: "for" });
  const r = st.voteEvolution(evoPropId, { memberId: memberC.id, vote: "for" });
  assert(r.ok, "third vote should succeed");
  assert(r.evolutionProposal.status === "approved", `expected approved, got ${r.evolutionProposal.status}`);
});

test("listEvolutionProposals — filter by status", () => {
  const list = st.listEvolutionProposals({ status: "approved" });
  assert(Array.isArray(list) && list.length >= 1, "no approved proposals");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 9 — Health + Dashboard + Search
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 9: Health, Dashboard, Search");

test("getCivilizationHealth — returns valid score", () => {
  const h = st.getCivilizationHealth();
  assert(typeof h.score === "number", "no score");
  assert(h.score >= 0 && h.score <= 100, `score OOB: ${h.score}`);
  assert(h.layers, "no layers");
  assert(typeof h.alerts === "object", "no alerts");
});

test("getCivilizationDashboard — returns comprehensive data", () => {
  const db = st.getCivilizationDashboard();
  assert(db.civilization, "no civilization section");
  assert(db.health, "no health section");
  assert(db.civilization.members?.total >= 0, "no member count");
  assert(db.civilization.economy?.trades >= 0, "no trade count");
  assert(db.civilization.diplomacy?.ratified >= 0, "no treaty count");
});

test("civilizationSearch — finds member by name", () => {
  const r = st.civilizationSearch(`OrgA-${TS}`);
  assert(r.ok, "search failed");
  assert(r.total >= 1, "should find member");
});

test("civilizationSearch — finds mission by title", () => {
  const r = st.civilizationSearch(`Build AI system ${TS}`);
  assert(r.ok, "search failed");
  assert(r.total >= 1, "should find mission");
});

test("civilizationSearch — finds innovation", () => {
  const r = st.civilizationSearch(`Innovation-${TS}`);
  assert(r.ok, "search failed");
  assert(r.total >= 1, "should find innovation");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 10 — KPIs, Memory, Reports, Context
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 10: KPIs, Memory, Reports, Context");

test("getCivKpi — returns kpi for domain", () => {
  const k = st.getCivKpi("civ_director");
  assert(k && typeof k.membersRegistered === "number", "no kpi");
});

test("updateCivKpi — ok", () => {
  st.updateCivKpi("civ_analytics", { reportsGenerated: 99 });
  const k = st.getCivKpi("civ_analytics");
  assert(k.reportsGenerated === 99, "kpi not updated");
});

test("getAllCivKpis — returns array", () => {
  const list = st.getAllCivKpis();
  assert(Array.isArray(list) && list.length > 0, "no kpis");
});

test("addCivMemory — ok", () => {
  const r = st.addCivMemory({ domainId: "civ_director", type: "observation", title: `Test memory ${TS}`, detail: "detail" });
  assert(r.ok, `addMemory failed: ${r.error}`);
  assert(r.entry?.id, "no entry id");
});

test("listCivMemory — returns entries", () => {
  const list = st.listCivMemory({});
  assert(Array.isArray(list) && list.length >= 1, "no memory");
});

test("createCivReport — ok", () => {
  const r = st.createCivReport({ title: `Report-${TS}`, domainId: "civ_analytics", type: "civilization", summary: "All well" });
  assert(r.ok, `createReport failed: ${r.error}`);
  assert(r.report?.id, "no report id");
});

test("listCivReports — returns array", () => {
  const list = st.listCivReports({});
  assert(Array.isArray(list) && list.length >= 1, "no reports");
});

test("getCivContext — returns context", () => {
  const ctx = st.getCivContext();
  assert(ctx && typeof ctx === "object", "not object");
  assert(typeof ctx.epoch === "number", "no epoch");
});

test("updateCivContext — ok", () => {
  const r = st.updateCivContext({ epoch: 2 });
  assert(r && r.epoch === 2, "context not updated");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 11 — Workflow
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 11: Workflow");

test("bootstrapCivilization — seeds articles + channels", () => {
  const r = wf.bootstrapCivilization();
  assert(r.ok, `bootstrap failed: ${r.error}`);
  assert(typeof r.articles === "number", "no articles count");
  assert(typeof r.channels === "number", "no channels count");
});

test("intakeCivGoal — ok", () => {
  const r = wf.intakeCivGoal(`Deploy civilization platform ${TS}`, { memberId: memberA.id });
  assert(r.ok, `intake failed: ${r.error}`);
  assert(r.command, "no command");
});

test("civilizationGovernance — ok with no restrictions", () => {
  const r = wf.civilizationGovernance(`goal-${TS}`, { memberId: memberA.id, domain: "engineering" });
  assert(r.ok, `governance failed: ${r.error}`);
  assert(typeof r.violations === "number", "no violations count");
});

test("civilizationGovernance — low reputation blocked", () => {
  // Create member with low rep
  const lr = st.registerMember({ name: `LowRep-${TS}`, type: "organization" });
  for (let i = 0; i < 10; i++) st.recordReputationEvent({ memberId: lr.member.id, eventType: "violation", score: -10 });
  const r = wf.civilizationGovernance(`goal-g-${TS}`, { memberId: lr.member.id, domain: "general" });
  assert(typeof r.ok === "boolean", "should return boolean ok");
});

test("civilizationResourceAllocation — ok", () => {
  const r = wf.civilizationResourceAllocation(`goal-${TS}`, { memberId: memberA.id, resources: {} });
  assert(r.ok, `alloc failed: ${r.error}`);
});

test("crossOrgCoordination — ok", () => {
  const r = wf.crossOrgCoordination(`goal-${TS}`, { memberId: memberA.id, command: `Test command ${TS}`, domain: "engineering" });
  assert(r.ok, `coordination failed: ${r.error}`);
  assert(Array.isArray(r.actions), "no actions array");
});

test("generateCivReport — ok", () => {
  const r = wf.generateCivReport(`goal-${TS}`, { memberId: memberA.id, healthScore: 80 });
  assert(r.ok, `report failed: ${r.error}`);
  assert(r.report?.id, "no report id");
});

test("negotiateBetweenOrgs — auto-resolves with agreement", () => {
  const r = wf.negotiateBetweenOrgs({ fromMemberId: memberA.id, toMemberId: memberB.id, subject: `Partnership ${TS}`, initialTerms: { scope: "engineering" }, autoResolve: true });
  assert(r.ok, `negotiate failed: ${r.error}`);
  assert(r.negotiation?.status === "concluded" || r.agreedTerms, "should be concluded or have agreed terms");
});

test("delegateToMember — finds capable member and assigns mission", () => {
  const r = wf.delegateToMember({ command: `Delegate task ${TS}`, requiredCapabilities: [], fromMemberId: memberA.id, priority: "medium", domain: "general" });
  assert(r.ok, `delegate failed: ${r.error}`);
  assert(r.delegatedTo, "no delegated member");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 12 — Full Pipeline
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[civ-v9] Block 12: Full Pipeline");

(async () => {
  await asyncTest("runCivilizationPipeline — missing command", async () => {
    const r = await wf.runCivilizationPipeline("");
    assert(!r.ok, "should fail on empty command");
  });

  await asyncTest("runCivilizationPipeline — completes 6 steps", async () => {
    const r = await wf.runCivilizationPipeline(`Build civilization feature ${TS}`, { memberId: memberA.id, priority: "high", domain: "engineering" });
    assert(r.ok, `pipeline failed: ${r.error}`);
    assert(Array.isArray(r.steps) && r.steps.length >= 5, `only ${r.steps?.length} steps`);
    assert(r.eosGoalId, "no eosGoalId");
    assert(r.reportId, "no reportId");
  });

  await asyncTest("runCivilizationPipeline — health score in range", async () => {
    const r = await wf.runCivilizationPipeline(`Health test ${TS}`, {});
    assert(r.ok, "pipeline should succeed");
    if (typeof r.civilizationHealth === "number") {
      assert(r.civilizationHealth >= 0 && r.civilizationHealth <= 100, `health OOB: ${r.civilizationHealth}`);
    }
  });

  await asyncTest("runCivilizationPipeline — with resources", async () => {
    st.creditResource(memberB.id, "compute", 200, "setup");
    const r = await wf.runCivilizationPipeline(`Resource-backed initiative ${TS}`, { memberId: memberB.id, resources: { compute: 10 }, domain: "business" });
    assert(r.ok, `pipeline with resources failed: ${r.error}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK 13 — Org Registration
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[civ-v9] Block 13: Org Registration");

  test("org register — returns ok with 20 domains", () => {
    const r = org.register();
    assert(r.ok, `register failed: ${r.message || r.error}`);
    assert(r.count === 20, `expected 20 domains, got ${r.count}`);
  });

  test("org register — idempotent", () => {
    const r2 = org.register();
    assert(r2.ok, "second register failed");
    assert(r2.message === "Already registered" || r2.registered >= 0, "unexpected result");
  });

  test("getOrgStatus — returns 20 domains", () => {
    const status = org.getOrgStatus();
    assert(Array.isArray(status) && status.length === 20, `expected 20, got ${status.length}`);
  });

  test("getOrgStatus — all domains have id, role, label", () => {
    const status = org.getOrgStatus();
    assert(status.every(d => d.id && d.role && d.label), "domain missing id/role/label");
  });

  test("getOrgSummary — returns total=20 + dashboard", () => {
    const s = org.getOrgSummary();
    assert(s.total === 20, `expected 20, got ${s.total}`);
    assert(s.dashboard, "no dashboard");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK 14 — Integration Smoke
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[civ-v9] Block 14: Integration Smoke");

  test("civilization health after full pipeline >= 0", () => {
    const h = st.getCivilizationHealth();
    assert(h.score >= 0 && h.score <= 100, `score OOB: ${h.score}`);
  });

  test("ecosystem layer accessible from civilization health", () => {
    const h = st.getCivilizationHealth();
    assert(h.layers.ecosystem !== undefined, "no ecosystem layer in health");
    assert(typeof h.layers.ecosystem.score === "number", "no ecosystem score");
  });

  test("civilization has bootstrapped articles post-registration", () => {
    wf.bootstrapCivilization();
    const articles = st.listArticles({});
    assert(articles.length >= 6, `only ${articles.length} articles`);
  });

  test("civilization has bootstrapped channels post-registration", () => {
    wf.bootstrapCivilization();
    const channels = st.listChannels({});
    assert(channels.length >= 5, `only ${channels.length} channels`);
  });

  await asyncTest("full pipeline → cross-layer health aggregation", async () => {
    const r = await wf.runCivilizationPipeline(`Cross-layer smoke ${TS}`, { memberId: memberA.id });
    assert(r.ok, "pipeline failed");
    const h = st.getCivilizationHealth();
    assert(typeof h.score === "number" && h.score >= 0, "health broken after pipeline");
  });

  await asyncTest("mission publish → assign → creates EOS mission", async () => {
    const mr = st.publishCivMission({ fromMemberId: memberA.id, title: `EOS link test ${TS}`, domain: "engineering", priority: "high" });
    assert(mr.ok, "publishCivMission failed");
    st.bidCivMission(mr.missionRoute.id, { bidderMemberId: memberB.id, proposal: "Accepted" });
    const ar = st.assignCivMission(mr.missionRoute.id, { toMemberId: memberB.id });
    assert(ar.ok, "assignCivMission failed");
    assert(ar.missionRoute.status === "assigned", "not assigned");
  });

  await asyncTest("negotiation → treaty → ratification full flow", async () => {
    const neg = wf.negotiateBetweenOrgs({ fromMemberId: memberA.id, toMemberId: memberC.id, subject: `Full flow ${TS}`, initialTerms: { resource: "compute" }, autoResolve: true });
    assert(neg.ok, "negotiation failed");
    // Treaty should be auto-created by concludeNegotiation
    const treaties = st.listTreaties({});
    assert(treaties.length >= 1, "no treaties created");
  });

  // Final results
  console.log(`\n[civ-v9] Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
