"use strict";
/**
 * Civilization Layer — State (LEVEL 9)
 *
 * A federation of autonomous organizations that cooperate, negotiate,
 * compete, trade knowledge, share capabilities, and continuously evolve.
 *
 * Sits above Ecosystem (L8) → Enterprise (L7) → Executive (L6) → Orgs (L1-5).
 *
 * Storage: data/civilization/ (12 JSON files — all owned by this layer)
 *
 * Reuses (never duplicates):
 *   ecosystemState     — tenant/org/marketplace/knowledge/trust/mission exchange
 *   enterpriseState    — companies/products/customers/governance
 *   executiveState     — goals/strategies/missions/decisions
 *   runtimeEventBus    — event fan-out
 *   agentRuntimeSupervisor — agent lifecycle
 *   missionOrchestrator — mission creation
 *   continuousLearningEngine — lessons
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/civilization");
const FILES = {
  registry:     path.join(DATA_DIR, "registry.json"),     // member organizations
  council:      path.join(DATA_DIR, "council.json"),      // council members + proposals + votes
  constitution: path.join(DATA_DIR, "constitution.json"), // articles + amendments + precedents
  economy:      path.join(DATA_DIR, "economy.json"),      // resource ledger, trades, balances
  network:      path.join(DATA_DIR, "network.json"),      // collaboration channels, missions, knowledge routes
  reputation:   path.join(DATA_DIR, "reputation.json"),   // reputation scores, endorsements
  diplomacy:    path.join(DATA_DIR, "diplomacy.json"),    // treaties, disputes, arbitrations
  innovation:   path.join(DATA_DIR, "innovation.json"),   // research projects, innovations, evolution proposals
  kpis:         path.join(DATA_DIR, "kpis.json"),         // per-domain KPIs
  memory:       path.join(DATA_DIR, "memory.json"),       // civilization memory
  reports:      path.join(DATA_DIR, "reports.json"),      // civilization reports
  context:      path.join(DATA_DIR, "context.json"),      // global civilization context
};

// Lazy accessors to lower layers — never duplicate, always delegate
function _ecoSt()  { try { return require("./ecosystemState.cjs");    } catch { return null; } }
function _ecoWf()  { try { return require("./ecosystemWorkflow.cjs"); } catch { return null; } }
function _entSt()  { try { return require("./enterpriseState.cjs");   } catch { return null; } }
function _eosSt()  { try { return require("./executiveState.cjs");    } catch { return null; } }
function _eosWf()  { try { return require("./executiveWorkflow.cjs"); } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _sup()    { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs"); } catch { return null; } }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  registry: { members: [], alliances: [] },
  council:  { members: [], proposals: [], votes: [] },
  constitution: { articles: [], amendments: [], precedents: [] },
  economy:  { balances: {}, trades: [], resourcePools: {} },
  network:  { channels: [], missionRoutes: [], knowledgeRoutes: [], collaborations: [] },
  reputation: { scores: {}, endorsements: [], badges: [] },
  diplomacy: { treaties: [], disputes: [], arbitrations: [], negotiations: [] },
  innovation: { projects: [], innovations: [], proposals: [], adoptions: [] },
  kpis: {},
  memory: [],
  reports: [],
  context: { phase: "active", membersCount: 0, healthScore: 100, epoch: 1, lastSync: null },
};

const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}

const _reg = () => _load("registry");
const _cou = () => _load("council");
const _con = () => _load("constitution");
const _eco = () => _load("economy");
const _net = () => _load("network");
const _rep = () => _load("reputation");
const _dip = () => _load("diplomacy");
const _inn = () => _load("innovation");
const _k   = () => _load("kpis");
const _m   = () => _load("memory");
const _r   = () => _load("reports");
const _cx  = () => _load("context");

const _id = pfx => `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── Domain IDs ────────────────────────────────────────────────────────────────
const DOMAIN_IDS = [
  "civ_registry","civ_council","civ_governance","civ_constitution",
  "civ_policy","civ_economy","civ_resource_exchange","civ_knowledge_network",
  "civ_mission_network","civ_reputation","civ_trust","civ_diplomacy",
  "civ_collaboration","civ_arbitration","civ_innovation","civ_research",
  "civ_evolution","civ_analytics","civ_health","civ_director",
];

const MEMBER_TYPES = ["enterprise","ecosystem","organization","coalition","federation"];
const RESOURCE_TYPES = ["compute","data","knowledge","capability","capital","attention","trust"];
const TREATY_TYPES = ["trade","defense","knowledge","capability","non_aggression","collaboration"];

function _kpi(domainId) {
  const k = _k();
  if (!k[domainId]) {
    k[domainId] = {
      domainId, membersRegistered: 0, proposalsProcessed: 0,
      tradesExecuted: 0, missionsExchanged: 0, knowledgeShared: 0,
      treatiesSigned: 0, innovationsAdopted: 0, reportsGenerated: 0,
      lastTickAt: null, tickCount: 0,
    };
    _save("kpis");
  }
  return k[domainId];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION REGISTRY — member organizations
// ═══════════════════════════════════════════════════════════════════════════════

function registerMember({ name, type = "organization", tenantId, enterpriseId, capabilities = [], resources = {}, region = "global", tier = "standard", metadata = {} } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const reg = _reg();
  const existing = reg.members.find(m => m.name === name && m.status === "active");
  if (existing) return { ok: true, member: existing, existing: true };
  const member = {
    id: _id("cmem"), name, type, tenantId, enterpriseId,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    resources: { compute: 0, data: 0, knowledge: 0, capability: 0, capital: 0, attention: 100, trust: 70, ...resources },
    region, tier, status: "active",
    reputation: 70, trustScore: 70, contributionScore: 0,
    joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  reg.members.push(member);
  _kpi("civ_registry").membersRegistered++;
  _save("registry"); _save("kpis");
  // Initialize resource balance in economy
  _eco().balances[member.id] = { ...member.resources, lastUpdated: new Date().toISOString() };
  _save("economy");
  try { _bus()?.emit("civilization:member:registered", { id: member.id, name, type }); } catch {}
  return { ok: true, member };
}

function listMembers({ type, region, tier, status = "active", limit = 100 } = {}) {
  let list = _reg().members;
  if (status)  list = list.filter(m => m.status === status);
  if (type)    list = list.filter(m => m.type === type);
  if (region)  list = list.filter(m => m.region === region);
  if (tier)    list = list.filter(m => m.tier === tier);
  return list.slice(-limit).reverse();
}

function getMember(id) { return _reg().members.find(m => m.id === id) || null; }
function updateMember(id, patch) {
  const m = _reg().members.find(x => x.id === id);
  if (!m) return { ok: false, error: "Not found" };
  Object.assign(m, patch, { updatedAt: new Date().toISOString() });
  _save("registry");
  return { ok: true, member: m };
}

// Alliances between members
function formAlliance({ name, memberIds = [], type = "collaboration", purpose = "", expiresAt = null } = {}) {
  if (!name || memberIds.length < 2) return { ok: false, error: "name and at least 2 memberIds required" };
  const alliance = {
    id: _id("call"), name, memberIds, type, purpose, status: "active", expiresAt,
    formedAt: new Date().toISOString(),
  };
  _reg().alliances.push(alliance);
  _save("registry");
  try { _bus()?.emit("civilization:alliance:formed", { id: alliance.id, name, memberIds }); } catch {}
  return { ok: true, alliance };
}

function listAlliances({ type, status = "active" } = {}) {
  return _reg().alliances.filter(a => (!status || a.status === status) && (!type || a.type === type));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION COUNCIL — governance body
// ═══════════════════════════════════════════════════════════════════════════════

function addCouncilMember({ memberId, role = "representative", votingWeight = 1, mandate = "permanent" } = {}) {
  if (!memberId) return { ok: false, error: "memberId required" };
  const cou = _cou();
  if (cou.members.find(m => m.memberId === memberId && m.status === "active"))
    return { ok: false, error: "Already a council member" };
  const cm = { id: _id("ccm"), memberId, role, votingWeight, mandate, status: "active", joinedAt: new Date().toISOString() };
  cou.members.push(cm);
  _save("council");
  return { ok: true, councilMember: cm };
}

function listCouncilMembers({ status = "active" } = {}) {
  return _cou().members.filter(m => !status || m.status === status);
}

function createProposal({ title, description = "", proposerId, type = "policy", data = {}, requiredVotes, deadline } = {}) {
  if (!title || !proposerId) return { ok: false, error: "title and proposerId required" };
  const cou = _cou();
  const councilSize = cou.members.filter(m => m.status === "active").length;
  const proposal = {
    id: _id("cprop"), title, description, proposerId, type, data,
    status: "open", requiredVotes: requiredVotes || Math.ceil(councilSize / 2) || 1,
    deadline: deadline || new Date(Date.now() + 7 * 86400000).toISOString(),
    votesFor: 0, votesAgainst: 0, abstentions: 0, votes: [],
    createdAt: new Date().toISOString(), resolvedAt: null, outcome: null,
  };
  cou.proposals.push(proposal);
  _kpi("civ_council").proposalsProcessed++;
  _save("council"); _save("kpis");
  try { _bus()?.emit("civilization:proposal:created", { id: proposal.id, title, type }); } catch {}
  return { ok: true, proposal };
}

function voteOnProposal(proposalId, { voterId, vote, rationale = "" } = {}) {
  if (!["for","against","abstain"].includes(vote)) return { ok: false, error: "vote must be for/against/abstain" };
  const cou = _cou();
  const proposal = cou.proposals.find(p => p.id === proposalId);
  if (!proposal) return { ok: false, error: "Proposal not found" };
  if (proposal.status !== "open") return { ok: false, error: "Proposal not open" };
  if (proposal.votes.find(v => v.voterId === voterId)) return { ok: false, error: "Already voted" };
  const voter = cou.members.find(m => m.memberId === voterId);
  const weight = voter?.votingWeight || 1;
  proposal.votes.push({ id: _id("cvote"), voterId, vote, weight, rationale, at: new Date().toISOString() });
  if (vote === "for")     proposal.votesFor     += weight;
  if (vote === "against") proposal.votesAgainst += weight;
  if (vote === "abstain") proposal.abstentions  += weight;
  // Auto-resolve if threshold met
  if (proposal.votesFor >= proposal.requiredVotes) {
    proposal.status = "passed"; proposal.outcome = "approved"; proposal.resolvedAt = new Date().toISOString();
    try { _bus()?.emit("civilization:proposal:passed", { id: proposalId, title: proposal.title }); } catch {}
  } else if (proposal.votesAgainst > proposal.requiredVotes) {
    proposal.status = "rejected"; proposal.outcome = "rejected"; proposal.resolvedAt = new Date().toISOString();
  }
  _save("council");
  return { ok: true, proposal };
}

function listProposals({ status, type, limit = 50 } = {}) {
  let list = _cou().proposals;
  if (status) list = list.filter(p => p.status === status);
  if (type)   list = list.filter(p => p.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION CONSTITUTION — articles, amendments, precedents
// ═══════════════════════════════════════════════════════════════════════════════

function addConstitutionalArticle({ title, content, articleNumber, category = "governance" } = {}) {
  if (!title || !content) return { ok: false, error: "title and content required" };
  const con = _con();
  const articleNum = articleNumber || con.articles.length + 1;
  if (con.articles.find(a => a.articleNumber === articleNum))
    return { ok: false, error: `Article ${articleNum} already exists` };
  const article = { id: _id("cart"), articleNumber: articleNum, title, content, category, status: "active", adoptedAt: new Date().toISOString() };
  con.articles.push(article);
  _save("constitution");
  return { ok: true, article };
}

function proposeAmendment({ articleId, proposerId, change, rationale = "" } = {}) {
  if (!articleId || !proposerId || !change) return { ok: false, error: "articleId, proposerId, change required" };
  const amend = { id: _id("camend"), articleId, proposerId, change, rationale, status: "proposed", proposedAt: new Date().toISOString() };
  _con().amendments.push(amend);
  _save("constitution");
  return { ok: true, amendment: amend };
}

function recordPrecedent({ title, ruling, context = "", caseRef, domainId = "civ_arbitration" } = {}) {
  if (!title || !ruling) return { ok: false, error: "title and ruling required" };
  const prec = { id: _id("cprec"), title, ruling, context, caseRef, domainId, recordedAt: new Date().toISOString() };
  _con().precedents.push(prec);
  _save("constitution");
  return { ok: true, precedent: prec };
}

function getConstitution() { return _con(); }
function listArticles({ category, status } = {}) {
  let list = _con().articles;
  if (category) list = list.filter(a => a.category === category);
  if (status)   list = list.filter(a => a.status === status);
  return list.sort((a,b) => a.articleNumber - b.articleNumber);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION ECONOMY — resource ledger, trades, balances
// ═══════════════════════════════════════════════════════════════════════════════

function getBalance(memberId) {
  return _eco().balances[memberId] || { compute: 0, data: 0, knowledge: 0, capability: 0, capital: 0, attention: 0, trust: 0 };
}

function creditResource(memberId, resourceType, amount, reason = "") {
  if (!RESOURCE_TYPES.includes(resourceType)) return { ok: false, error: `Invalid resource type: ${resourceType}` };
  if (amount <= 0) return { ok: false, error: "amount must be > 0" };
  const eco = _eco();
  if (!eco.balances[memberId]) eco.balances[memberId] = { compute:0, data:0, knowledge:0, capability:0, capital:0, attention:0, trust:0, lastUpdated: new Date().toISOString() };
  eco.balances[memberId][resourceType] = (eco.balances[memberId][resourceType] || 0) + amount;
  eco.balances[memberId].lastUpdated = new Date().toISOString();
  _save("economy");
  return { ok: true, balance: eco.balances[memberId] };
}

function debitResource(memberId, resourceType, amount, reason = "") {
  const eco = _eco();
  const balance = eco.balances[memberId]?.[resourceType] || 0;
  if (balance < amount) return { ok: false, error: `Insufficient ${resourceType}: have ${balance}, need ${amount}` };
  eco.balances[memberId][resourceType] = balance - amount;
  eco.balances[memberId].lastUpdated = new Date().toISOString();
  _save("economy");
  return { ok: true, balance: eco.balances[memberId] };
}

function proposeTrade({ fromMemberId, toMemberId, offer = {}, request = {}, description = "", deadline } = {}) {
  if (!fromMemberId || !toMemberId) return { ok: false, error: "fromMemberId and toMemberId required" };
  if (!Object.keys(offer).length || !Object.keys(request).length) return { ok: false, error: "offer and request required" };
  const trade = {
    id: _id("ctrd"), fromMemberId, toMemberId, offer, request, description,
    status: "proposed", deadline: deadline || new Date(Date.now() + 3 * 86400000).toISOString(),
    proposedAt: new Date().toISOString(), resolvedAt: null,
  };
  _eco().trades.push(trade);
  _save("economy");
  try { _bus()?.emit("civilization:trade:proposed", { id: trade.id, fromMemberId, toMemberId }); } catch {}
  return { ok: true, trade };
}

function acceptTrade(tradeId, { acceptorId } = {}) {
  const trade = _eco().trades.find(t => t.id === tradeId);
  if (!trade) return { ok: false, error: "Trade not found" };
  if (trade.status !== "proposed") return { ok: false, error: "Trade not in proposed state" };
  if (trade.toMemberId !== acceptorId) return { ok: false, error: "Only the recipient can accept" };

  // Execute resource transfer — debit offer from sender, credit to receiver
  const errors = [];
  for (const [res, amt] of Object.entries(trade.offer)) {
    const dr = debitResource(trade.fromMemberId, res, amt, `trade:${tradeId}`);
    if (!dr.ok) errors.push(`offer ${res}: ${dr.error}`);
    else creditResource(trade.toMemberId, res, amt, `trade:${tradeId}`);
  }
  for (const [res, amt] of Object.entries(trade.request)) {
    const dr = debitResource(trade.toMemberId, res, amt, `trade:${tradeId}`);
    if (!dr.ok) errors.push(`request ${res}: ${dr.error}`);
    else creditResource(trade.fromMemberId, res, amt, `trade:${tradeId}`);
  }
  if (errors.length) { trade.status = "failed"; trade.errors = errors; _save("economy"); return { ok: false, errors }; }
  trade.status = "completed"; trade.resolvedAt = new Date().toISOString();
  _save("economy");
  _kpi("civ_economy").tradesExecuted++;
  _save("kpis");
  try { _bus()?.emit("civilization:trade:completed", { id: tradeId }); } catch {}
  return { ok: true, trade };
}

function listTrades({ fromMemberId, toMemberId, status, limit = 50 } = {}) {
  let list = _eco().trades;
  if (fromMemberId) list = list.filter(t => t.fromMemberId === fromMemberId || t.toMemberId === fromMemberId);
  if (toMemberId)   list = list.filter(t => t.toMemberId === toMemberId);
  if (status)       list = list.filter(t => t.status === status);
  return list.slice(-limit).reverse();
}

// Resource pool — shared civilization resources
function contributeToPool({ memberId, resourceType, amount, poolId = "global" } = {}) {
  if (!memberId || !resourceType || amount <= 0) return { ok: false, error: "memberId, resourceType, amount>0 required" };
  const dr = debitResource(memberId, resourceType, amount, `pool:${poolId}`);
  if (!dr.ok) return dr;
  const eco = _eco();
  if (!eco.resourcePools[poolId]) eco.resourcePools[poolId] = {};
  eco.resourcePools[poolId][resourceType] = (eco.resourcePools[poolId][resourceType] || 0) + amount;
  _save("economy");
  return { ok: true, pool: eco.resourcePools[poolId] };
}

function claimFromPool({ memberId, resourceType, amount, poolId = "global", reason = "" } = {}) {
  const eco = _eco();
  const pool = eco.resourcePools[poolId] || {};
  if ((pool[resourceType] || 0) < amount) return { ok: false, error: `Pool insufficient: ${pool[resourceType]||0} < ${amount}` };
  pool[resourceType] -= amount;
  creditResource(memberId, resourceType, amount, `pool_claim:${poolId}`);
  _save("economy");
  return { ok: true, pool };
}

function getResourcePool(poolId = "global") { return _eco().resourcePools[poolId] || {}; }

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION NETWORK — channels, mission routes, knowledge routes, collabs
// ═══════════════════════════════════════════════════════════════════════════════

function createChannel({ name, description = "", memberIds = [], type = "collaboration", visibility = "public" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const net = _net();
  if (net.channels.find(c => c.name === name && c.status === "active"))
    return { ok: false, error: "Channel already exists" };
  const channel = {
    id: _id("cch"), name, description, memberIds, type, visibility,
    status: "active", messages: 0, lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  net.channels.push(channel);
  _save("network");
  return { ok: true, channel };
}

function listChannels({ type, visibility, limit = 50 } = {}) {
  let list = _net().channels.filter(c => c.status === "active");
  if (type)       list = list.filter(c => c.type === type);
  if (visibility) list = list.filter(c => c.visibility === visibility);
  return list.slice(-limit);
}

function publishCivMission({ fromMemberId, title, description = "", requiredCapabilities = [], rewardResources = {}, deadline, priority = "medium", domain = "general" } = {}) {
  if (!fromMemberId || !title) return { ok: false, error: "fromMemberId and title required" };
  const route = {
    id: _id("cmrt"), fromMemberId, title, description, requiredCapabilities,
    rewardResources, deadline, priority, domain,
    status: "open", bids: [], assignedTo: null,
    publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _net().missionRoutes.push(route);
  _kpi("civ_mission_network").missionsExchanged++;
  _save("network"); _save("kpis");
  // Also publish to ecosystem mission exchange for cross-layer visibility
  try { _ecoSt()?.publishMissionExchange?.({ fromTenantId: fromMemberId, title, description, requiredCapabilities, reward: 0 }); } catch {}
  try { _bus()?.emit("civilization:mission:published", { id: route.id, title, fromMemberId }); } catch {}
  return { ok: true, missionRoute: route };
}

function bidCivMission(missionId, { bidderMemberId, proposal = "", estimatedResources = {}, timeline = "" } = {}) {
  const route = _net().missionRoutes.find(m => m.id === missionId);
  if (!route) return { ok: false, error: "Mission not found" };
  if (route.status !== "open") return { ok: false, error: "Mission not open" };
  const bid = { id: _id("cbid"), bidderMemberId, proposal, estimatedResources, timeline, at: new Date().toISOString() };
  route.bids.push(bid);
  route.updatedAt = new Date().toISOString();
  _save("network");
  return { ok: true, bid };
}

function assignCivMission(missionId, { toMemberId } = {}) {
  const route = _net().missionRoutes.find(m => m.id === missionId);
  if (!route) return { ok: false, error: "Mission not found" };
  route.assignedTo = toMemberId; route.status = "assigned";
  route.updatedAt = new Date().toISOString();
  _save("network");
  // Create EOS executive mission for tracking
  try { _eosSt()?.createExecMission?.({ title: route.title, description: route.description, orgTargets: ["engineering","business"], priority: route.priority }); } catch {}
  try { _bus()?.emit("civilization:mission:assigned", { id: missionId, toMemberId }); } catch {}
  return { ok: true, missionRoute: route };
}

function listCivMissions({ status, fromMemberId, domain, limit = 50 } = {}) {
  let list = _net().missionRoutes;
  if (status)       list = list.filter(m => m.status === status);
  if (fromMemberId) list = list.filter(m => m.fromMemberId === fromMemberId);
  if (domain)       list = list.filter(m => m.domain === domain);
  return list.slice(-limit).reverse();
}

// Knowledge routing between members
function shareKnowledgeRoute({ fromMemberId, toMemberId, knowledgeId, title, content = "", type = "article", visibility = "members" } = {}) {
  if (!fromMemberId || !title) return { ok: false, error: "fromMemberId and title required" };
  const kr = {
    id: _id("ckr"), fromMemberId, toMemberId, knowledgeId, title, content, type, visibility,
    views: 0, forks: 0, sharedAt: new Date().toISOString(),
  };
  _net().knowledgeRoutes.push(kr);
  _kpi("civ_knowledge_network").knowledgeShared++;
  _save("network"); _save("kpis");
  // Also share to ecosystem knowledge exchange
  try { _ecoSt()?.shareKnowledge?.({ fromTenantId: fromMemberId, title, content, type, visibility: visibility === "public" ? "public" : "private" }); } catch {}
  try { _bus()?.emit("civilization:knowledge:shared", { id: kr.id, fromMemberId, title }); } catch {}
  return { ok: true, knowledgeRoute: kr };
}

function listKnowledgeRoutes({ fromMemberId, toMemberId, visibility, limit = 50 } = {}) {
  let list = _net().knowledgeRoutes;
  if (fromMemberId) list = list.filter(k => k.fromMemberId === fromMemberId);
  if (toMemberId)   list = list.filter(k => k.toMemberId === toMemberId || k.visibility === "members");
  if (visibility)   list = list.filter(k => k.visibility === visibility);
  return list.slice(-limit).reverse();
}

// Collaboration records
function startCollaboration({ name, memberIds = [], objective = "", domain = "general", resources = {} } = {}) {
  if (!name || memberIds.length < 2) return { ok: false, error: "name and at least 2 memberIds required" };
  const collab = {
    id: _id("ccol"), name, memberIds, objective, domain, resources,
    status: "active", outcomes: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _net().collaborations.push(collab);
  _save("network");
  try { _bus()?.emit("civilization:collaboration:started", { id: collab.id, name, memberIds }); } catch {}
  return { ok: true, collaboration: collab };
}

function completeCollaboration(collabId, { outcome = "", results = {} } = {}) {
  const collab = _net().collaborations.find(c => c.id === collabId);
  if (!collab) return { ok: false, error: "Collaboration not found" };
  collab.status = "completed"; collab.outcomes.push({ outcome, results, at: new Date().toISOString() });
  collab.updatedAt = new Date().toISOString();
  _save("network");
  return { ok: true, collaboration: collab };
}

function listCollaborations({ status, domain, memberId, limit = 50 } = {}) {
  let list = _net().collaborations;
  if (status)   list = list.filter(c => c.status === status);
  if (domain)   list = list.filter(c => c.domain === domain);
  if (memberId) list = list.filter(c => c.memberIds.includes(memberId));
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION REPUTATION + TRUST
// ═══════════════════════════════════════════════════════════════════════════════

function recordReputationEvent({ memberId, eventType, score, fromMemberId, detail = "", domain = "general" } = {}) {
  if (!memberId || !eventType) return { ok: false, error: "memberId and eventType required" };
  const rep = _rep();
  if (!rep.scores[memberId]) rep.scores[memberId] = { score: 70, events: [], badges: [] };
  const evt = { id: _id("crevt"), eventType, score: score || 0, fromMemberId, detail, domain, at: new Date().toISOString() };
  rep.scores[memberId].events.push(evt);
  if (rep.scores[memberId].events.length > 200) rep.scores[memberId].events.splice(0, rep.scores[memberId].events.length - 200);
  if (score) rep.scores[memberId].score = Math.min(100, Math.max(0, rep.scores[memberId].score + score));
  _save("reputation");
  _kpi("civ_reputation").tradesExecuted++;  // reuse field for events count
  _save("kpis");
  // Sync to ecosystem trust engine
  try { _ecoSt()?.recordTrustEvent?.({ entityId: memberId, entityType: "civilization_member", eventType, score }); } catch {}
  return { ok: true, reputation: rep.scores[memberId] };
}

function getReputation(memberId) {
  return _rep().scores[memberId] || { score: 70, events: [], badges: [] };
}

function endorseMember({ fromMemberId, toMemberId, domain, message = "" } = {}) {
  if (!fromMemberId || !toMemberId) return { ok: false, error: "fromMemberId and toMemberId required" };
  const endorse = { id: _id("cend"), fromMemberId, toMemberId, domain, message, at: new Date().toISOString() };
  _rep().endorsements.push(endorse);
  _save("reputation");
  recordReputationEvent({ memberId: toMemberId, eventType: "endorsement", score: 2, fromMemberId, detail: message, domain });
  return { ok: true, endorsement: endorse };
}

function listReputations({ minScore, maxScore } = {}) {
  return Object.entries(_rep().scores)
    .map(([id, s]) => ({ memberId: id, ...s }))
    .filter(s => (minScore === undefined || s.score >= minScore) && (maxScore === undefined || s.score <= maxScore))
    .sort((a,b) => b.score - a.score);
}

function awardBadge({ memberId, badge, reason, fromMemberId = "civilization" } = {}) {
  if (!memberId || !badge) return { ok: false, error: "memberId and badge required" };
  const b = { id: _id("cbadge"), memberId, badge, reason, fromMemberId, awardedAt: new Date().toISOString() };
  _rep().badges.push(b);
  if (_rep().scores[memberId]) _rep().scores[memberId].badges.push(badge);
  _save("reputation");
  return { ok: true, badge: b };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION DIPLOMACY — treaties, disputes, negotiations, arbitration
// ═══════════════════════════════════════════════════════════════════════════════

function proposeTreaty({ title, type = "collaboration", parties = [], terms = [], duration = "permanent", proposerId } = {}) {
  if (!title || parties.length < 2 || !proposerId) return { ok: false, error: "title, 2+ parties, proposerId required" };
  const treaty = {
    id: _id("ctrty"), title, type, parties, terms, duration, proposerId,
    status: "proposed", signatures: [], ratifiedAt: null,
    proposedAt: new Date().toISOString(),
  };
  _dip().treaties.push(treaty);
  _kpi("civ_diplomacy").treatiesSigned++;
  _save("diplomacy"); _save("kpis");
  try { _bus()?.emit("civilization:treaty:proposed", { id: treaty.id, title, parties }); } catch {}
  return { ok: true, treaty };
}

function ratifyTreaty(treatyId, { memberId } = {}) {
  const treaty = _dip().treaties.find(t => t.id === treatyId);
  if (!treaty) return { ok: false, error: "Treaty not found" };
  if (!treaty.parties.includes(memberId)) return { ok: false, error: "Not a party to this treaty" };
  if (treaty.signatures.includes(memberId)) return { ok: false, error: "Already signed" };
  treaty.signatures.push(memberId);
  if (treaty.signatures.length >= treaty.parties.length) {
    treaty.status = "ratified"; treaty.ratifiedAt = new Date().toISOString();
    try { _bus()?.emit("civilization:treaty:ratified", { id: treatyId, title: treaty.title }); } catch {}
  }
  _save("diplomacy");
  return { ok: true, treaty };
}

function raiseDispute({ title, description = "", claimantId, respondentId, evidence = [], category = "resource" } = {}) {
  if (!title || !claimantId || !respondentId) return { ok: false, error: "title, claimantId, respondentId required" };
  const dispute = {
    id: _id("cdisp"), title, description, claimantId, respondentId, evidence, category,
    status: "open", resolution: null, arbitrationId: null,
    raisedAt: new Date().toISOString(), resolvedAt: null,
  };
  _dip().disputes.push(dispute);
  _save("diplomacy");
  try { _bus()?.emit("civilization:dispute:raised", { id: dispute.id, claimantId, respondentId }); } catch {}
  return { ok: true, dispute };
}

function openArbitration({ disputeId, arbitratorId, description = "" } = {}) {
  const dispute = _dip().disputes.find(d => d.id === disputeId);
  if (!dispute) return { ok: false, error: "Dispute not found" };
  const arb = {
    id: _id("carb"), disputeId, arbitratorId, description,
    status: "open", ruling: null, precedentCreated: false,
    openedAt: new Date().toISOString(), closedAt: null,
  };
  _dip().arbitrations.push(arb);
  dispute.arbitrationId = arb.id;
  dispute.status = "in_arbitration";
  _save("diplomacy");
  return { ok: true, arbitration: arb };
}

function closeArbitration(arbitrationId, { ruling, precedentTitle = "" } = {}) {
  const arb = _dip().arbitrations.find(a => a.id === arbitrationId);
  if (!arb) return { ok: false, error: "Arbitration not found" };
  arb.ruling = ruling; arb.status = "closed"; arb.closedAt = new Date().toISOString();
  const dispute = _dip().disputes.find(d => d.id === arb.disputeId);
  if (dispute) { dispute.status = "resolved"; dispute.resolution = ruling; dispute.resolvedAt = new Date().toISOString(); }
  if (precedentTitle) {
    const prec = recordPrecedent({ title: precedentTitle, ruling, caseRef: arbitrationId });
    arb.precedentCreated = prec.ok;
  }
  _save("diplomacy");
  return { ok: true, arbitration: arb };
}

function openNegotiation({ title, parties = [], subject, proposerId, initialTerms = {} } = {}) {
  if (!title || parties.length < 2 || !proposerId) return { ok: false, error: "title, 2+ parties, proposerId required" };
  const neg = {
    id: _id("cneg"), title, parties, subject, proposerId, initialTerms,
    status: "open", rounds: [], agreedTerms: null,
    openedAt: new Date().toISOString(), closedAt: null,
  };
  _dip().negotiations.push(neg);
  _save("diplomacy");
  return { ok: true, negotiation: neg };
}

function addNegotiationRound(negotiationId, { memberId, terms = {}, counterOffer = {}, notes = "" } = {}) {
  const neg = _dip().negotiations.find(n => n.id === negotiationId);
  if (!neg) return { ok: false, error: "Negotiation not found" };
  if (neg.status !== "open") return { ok: false, error: "Negotiation not open" };
  const round = { id: _id("cnrnd"), memberId, terms, counterOffer, notes, at: new Date().toISOString() };
  neg.rounds.push(round);
  _save("diplomacy");
  return { ok: true, round };
}

function concludeNegotiation(negotiationId, { agreedTerms = {}, outcome = "agreement" } = {}) {
  const neg = _dip().negotiations.find(n => n.id === negotiationId);
  if (!neg) return { ok: false, error: "Negotiation not found" };
  neg.agreedTerms = agreedTerms; neg.status = outcome === "agreement" ? "concluded" : "failed";
  neg.closedAt = new Date().toISOString();
  _save("diplomacy");
  if (outcome === "agreement" && Object.keys(agreedTerms).length) {
    proposeTreaty({ title: neg.title, type: "collaboration", parties: neg.parties, terms: Object.entries(agreedTerms).map(([k,v])=>`${k}: ${v}`), proposerId: neg.proposerId });
  }
  return { ok: true, negotiation: neg };
}

function listTreaties({ type, status, limit = 50 } = {}) {
  let list = _dip().treaties;
  if (type)   list = list.filter(t => t.type === type);
  if (status) list = list.filter(t => t.status === status);
  return list.slice(-limit).reverse();
}

function listDisputes({ status, claimantId, limit = 50 } = {}) {
  let list = _dip().disputes;
  if (status)     list = list.filter(d => d.status === status);
  if (claimantId) list = list.filter(d => d.claimantId === claimantId || d.respondentId === claimantId);
  return list.slice(-limit).reverse();
}

function listArbitrations({ status, limit = 50 } = {}) {
  return _dip().arbitrations.filter(a => !status || a.status === status).slice(-limit).reverse();
}

function listNegotiations({ status, limit = 50 } = {}) {
  return _dip().negotiations.filter(n => !status || n.status === status).slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION INNOVATION + RESEARCH + EVOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

function createResearchProject({ title, description = "", leadMemberId, collaborators = [], domain = "general", hypothesis = "", resources = {}, timeline = "3m" } = {}) {
  if (!title || !leadMemberId) return { ok: false, error: "title and leadMemberId required" };
  const project = {
    id: _id("crsp"), title, description, leadMemberId, collaborators, domain,
    hypothesis, resources, timeline,
    status: "active", findings: [], innovations: [],
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _inn().projects.push(project);
  _save("innovation");
  return { ok: true, project };
}

function addFinding(projectId, { finding, confidence = 0.7, evidence = "", memberId } = {}) {
  const project = _inn().projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: "Project not found" };
  const f = { id: _id("cfnd"), finding, confidence, evidence, memberId, at: new Date().toISOString() };
  project.findings.push(f);
  project.updatedAt = new Date().toISOString();
  _save("innovation");
  return { ok: true, finding: f };
}

function publishInnovation({ title, description = "", authorMemberId, projectId = null, category = "process", impact = "medium", implementation = "", tags = [] } = {}) {
  if (!title || !authorMemberId) return { ok: false, error: "title and authorMemberId required" };
  const innovation = {
    id: _id("cinv"), title, description, authorMemberId, projectId, category, impact, implementation, tags,
    status: "proposed", adoptions: 0, rating: 0, reviews: 0,
    publishedAt: new Date().toISOString(),
  };
  _inn().innovations.push(innovation);
  _save("innovation");
  try { _bus()?.emit("civilization:innovation:published", { id: innovation.id, title, category }); } catch {}
  return { ok: true, innovation };
}

function adoptInnovation(innovationId, { memberId, notes = "" } = {}) {
  const innovation = _inn().innovations.find(i => i.id === innovationId);
  if (!innovation) return { ok: false, error: "Innovation not found" };
  innovation.adoptions++;
  if (innovation.adoptions >= 3) innovation.status = "adopted";
  const adoption = { id: _id("cadp"), innovationId, memberId, notes, at: new Date().toISOString() };
  _inn().adoptions.push(adoption);
  _kpi("civ_innovation").innovationsAdopted++;
  _save("innovation"); _save("kpis");
  recordReputationEvent({ memberId: innovation.authorMemberId, eventType: "innovation_adopted", score: 5, detail: `Adopted by ${memberId}` });
  return { ok: true, innovation, adoption };
}

function proposeEvolution({ title, description = "", proposerId, targetDomain, change, rationale = "", priority = "medium" } = {}) {
  if (!title || !proposerId || !targetDomain || !change) return { ok: false, error: "title, proposerId, targetDomain, change required" };
  const proposal = {
    id: _id("cevo"), title, description, proposerId, targetDomain, change, rationale, priority,
    status: "proposed", votes: [], votesFor: 0, votesAgainst: 0,
    proposedAt: new Date().toISOString(), implementedAt: null,
  };
  _inn().proposals.push(proposal);
  _save("innovation");
  // Also link to L4 evolution engine
  try { _le()?.addLesson?.({ type: "evolution_proposal", title, source: "civilization_evolution", confidence: 0.7, tags: ["civilization","evolution",targetDomain] }); } catch {}
  return { ok: true, evolutionProposal: proposal };
}

function voteEvolution(proposalId, { memberId, vote, rationale = "" } = {}) {
  const proposal = _inn().proposals.find(p => p.id === proposalId);
  if (!proposal) return { ok: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { ok: false, error: "Proposal not active" };
  proposal.votes.push({ memberId, vote, rationale, at: new Date().toISOString() });
  if (vote === "for") proposal.votesFor++;
  if (vote === "against") proposal.votesAgainst++;
  if (proposal.votesFor >= 3) { proposal.status = "approved"; try { _bus()?.emit("civilization:evolution:approved", { id: proposalId }); } catch {} }
  _save("innovation");
  return { ok: true, evolutionProposal: proposal };
}

function listResearchProjects({ status, domain, leadMemberId, limit = 50 } = {}) {
  let list = _inn().projects;
  if (status)       list = list.filter(p => p.status === status);
  if (domain)       list = list.filter(p => p.domain === domain);
  if (leadMemberId) list = list.filter(p => p.leadMemberId === leadMemberId);
  return list.slice(-limit).reverse();
}

function listInnovations({ category, status, limit = 50 } = {}) {
  let list = _inn().innovations;
  if (category) list = list.filter(i => i.category === category);
  if (status)   list = list.filter(i => i.status === status);
  return list.slice(-limit).reverse();
}

function listEvolutionProposals({ status, targetDomain, limit = 50 } = {}) {
  let list = _inn().proposals;
  if (status)       list = list.filter(p => p.status === status);
  if (targetDomain) list = list.filter(p => p.targetDomain === targetDomain);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION HEALTH (aggregates all layers)
// ═══════════════════════════════════════════════════════════════════════════════

function getCivilizationHealth() {
  const health = { score: 100, layers: {}, alerts: [] };

  // L8 Ecosystem
  try { const h = _ecoSt()?.getEcosystemHealth?.(); health.layers.ecosystem = { score: h?.score ?? 70 }; } catch { health.layers.ecosystem = { score: 70 }; }
  // L7 Enterprise
  try { const h = _entSt()?.getEnterpriseHealth?.(); health.layers.enterprise = { score: h?.score ?? 60 }; } catch { health.layers.enterprise = { score: 60 }; }
  // L6 Executive
  try { const h = _eosSt()?.getGlobalHealth?.(); health.layers.executive = { score: h?.score ?? 60 }; } catch { health.layers.executive = { score: 60 }; }

  // Civilization layer metrics
  const members = _reg().members.filter(m => m.status === "active").length;
  const openMissions = _net().missionRoutes.filter(m => m.status === "open").length;
  const openDisputes = _dip().disputes.filter(d => d.status === "open").length;
  const ratifiedTreaties = _dip().treaties.filter(t => t.status === "ratified").length;
  const adoptedInnovations = _inn().innovations.filter(i => i.status === "adopted").length;
  const avgRep = (() => { const s = Object.values(_rep().scores).map(x => x.score); return s.length > 0 ? Math.round(s.reduce((a,b)=>a+b,0)/s.length) : 70; })();

  health.layers.civilization = {
    members, openMissions, openDisputes, ratifiedTreaties, adoptedInnovations, avgReputation: avgRep,
    score: Math.min(100, Math.max(0, avgRep - openDisputes * 3 + ratifiedTreaties * 2)),
  };

  if (openDisputes > 5)     health.alerts.push({ type: "dispute_backlog", count: openDisputes, severity: "medium" });
  if (avgRep < 50)          health.alerts.push({ type: "low_reputation", avgScore: avgRep, severity: "high" });
  if (members === 0)        health.alerts.push({ type: "no_members", severity: "critical" });

  const layerScores = Object.values(health.layers).map(l => l.score || 50);
  health.score = Math.min(100, Math.max(0, Math.round(layerScores.reduce((a,b)=>a+b,0)/layerScores.length)));

  // Update context
  const cx = _cx();
  cx.membersCount = members; cx.healthScore = health.score; cx.lastSync = new Date().toISOString();
  _save("context");

  return health;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getCivilizationDashboard() {
  const health = getCivilizationHealth();
  const ecoDb = (() => { try { return _ecoSt()?.getEcosystemDashboard?.() || {}; } catch { return {}; } })();
  return {
    civilization: {
      members:        { total: _reg().members.length, active: _reg().members.filter(m => m.status === "active").length },
      alliances:      { total: _reg().alliances.length, active: _reg().alliances.filter(a => a.status === "active").length },
      council:        { members: _cou().members.filter(m => m.status === "active").length, proposals: _cou().proposals.length, openProposals: _cou().proposals.filter(p => p.status === "open").length },
      constitution:   { articles: _con().articles.length, amendments: _con().amendments.length, precedents: _con().precedents.length },
      economy:        { trades: _eco().trades.length, completedTrades: _eco().trades.filter(t => t.status === "completed").length, resourcePools: Object.keys(_eco().resourcePools).length },
      network:        { channels: _net().channels.length, missions: _net().missionRoutes.length, openMissions: _net().missionRoutes.filter(m => m.status === "open").length, collaborations: _net().collaborations.length },
      diplomacy:      { treaties: _dip().treaties.length, ratified: _dip().treaties.filter(t => t.status === "ratified").length, openDisputes: _dip().disputes.filter(d => d.status === "open").length, openNegotiations: _dip().negotiations.filter(n => n.status === "open").length },
      innovation:     { projects: _inn().projects.length, innovations: _inn().innovations.length, adopted: _inn().innovations.filter(i => i.status === "adopted").length, evolutionProposals: _inn().proposals.length },
      reputation:     { members: Object.keys(_rep().scores).length, avgScore: (() => { const s = Object.values(_rep().scores).map(x=>x.score); return s.length>0?Math.round(s.reduce((a,b)=>a+b,0)/s.length):70; })() },
      reports:        { total: _r().length },
    },
    health,
    ecosystem: ecoDb,
    context: _cx(),
    lastSync: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIVILIZATION-WIDE SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function civilizationSearch(query, { limit = 30 } = {}) {
  if (!query) return { ok: false, error: "query required" };
  const q = query.toLowerCase();
  const results = [];
  _reg().members.forEach(m => { if (m.name.toLowerCase().includes(q)) results.push({ type: "member", id: m.id, name: m.name, memberType: m.type }); });
  _reg().alliances.forEach(a => { if (a.name.toLowerCase().includes(q)) results.push({ type: "alliance", id: a.id, name: a.name }); });
  _net().missionRoutes.forEach(m => { if (m.title.toLowerCase().includes(q)) results.push({ type: "mission", id: m.id, name: m.title, status: m.status }); });
  _net().knowledgeRoutes.forEach(k => { if (k.title.toLowerCase().includes(q)) results.push({ type: "knowledge", id: k.id, name: k.title }); });
  _dip().treaties.forEach(t => { if (t.title.toLowerCase().includes(q)) results.push({ type: "treaty", id: t.id, name: t.title, status: t.status }); });
  _inn().innovations.forEach(i => { if (i.title.toLowerCase().includes(q)) results.push({ type: "innovation", id: i.id, name: i.title, category: i.category }); });
  _inn().projects.forEach(p => { if (p.title.toLowerCase().includes(q)) results.push({ type: "research", id: p.id, name: p.title, domain: p.domain }); });
  // Delegate to ecosystem search
  try {
    const ecoR = _ecoSt()?.ecosystemSearch?.(query, { limit: 15 });
    if (ecoR?.ok) ecoR.results.forEach(r => results.push({ ...r, source: "ecosystem" }));
  } catch {}
  return { ok: true, results: results.slice(0, limit), total: results.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY + REPORTS + KPIs + CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

function addCivMemory({ domainId, type = "signal", title, detail = "", tags = [] } = {}) {
  if (!domainId || !title) return { ok: false, error: "domainId and title required" };
  const entry = { id: _id("cmem2"), domainId, type, title, detail, tags, at: new Date().toISOString() };
  _m().push(entry);
  if (_m().length > 3000) _m().splice(0, _m().length - 3000);
  _save("memory");
  return { ok: true, entry };
}

function listCivMemory({ domainId, type, limit = 50 } = {}) {
  let list = _m();
  if (domainId) list = list.filter(x => x.domainId === domainId);
  if (type)     list = list.filter(x => x.type === type);
  return list.slice(-limit).reverse();
}

function createCivReport({ title, domainId = "civ_analytics", type = "civilization", data = {}, summary = "" } = {}) {
  if (!title || !domainId) return { ok: false, error: "title and domainId required" };
  const report = { id: _id("crpt2"), title, domainId, type, data, summary, createdAt: new Date().toISOString() };
  _r().push(report);
  if (_r().length > 500) _r().splice(0, _r().length - 500);
  _kpi(domainId).reportsGenerated = (_kpi(domainId).reportsGenerated || 0) + 1;
  _save("reports"); _save("kpis");
  return { ok: true, report };
}

function listCivReports({ domainId, type, limit = 20 } = {}) {
  let list = _r();
  if (domainId) list = list.filter(r => r.domainId === domainId);
  if (type)     list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

function getCivKpi(domainId)       { return _kpi(domainId); }
function getAllCivKpis()            { return Object.values(_k()); }
function updateCivKpi(domainId, p) { Object.assign(_kpi(domainId), p); _save("kpis"); }
function getCivContext()           { return _cx(); }
function updateCivContext(patch)   { Object.assign(_cx(), patch, { lastSync: new Date().toISOString() }); _save("context"); return _cx(); }

module.exports = {
  DOMAIN_IDS, MEMBER_TYPES, RESOURCE_TYPES, TREATY_TYPES,
  // Registry
  registerMember, listMembers, getMember, updateMember,
  formAlliance, listAlliances,
  // Council
  addCouncilMember, listCouncilMembers,
  createProposal, voteOnProposal, listProposals,
  // Constitution
  addConstitutionalArticle, proposeAmendment, recordPrecedent,
  getConstitution, listArticles,
  // Economy
  getBalance, creditResource, debitResource,
  proposeTrade, acceptTrade, listTrades,
  contributeToPool, claimFromPool, getResourcePool,
  // Network
  createChannel, listChannels,
  publishCivMission, bidCivMission, assignCivMission, listCivMissions,
  shareKnowledgeRoute, listKnowledgeRoutes,
  startCollaboration, completeCollaboration, listCollaborations,
  // Reputation + Trust
  recordReputationEvent, getReputation, endorseMember, listReputations, awardBadge,
  // Diplomacy
  proposeTreaty, ratifyTreaty, listTreaties,
  raiseDispute, listDisputes,
  openArbitration, closeArbitration, listArbitrations,
  openNegotiation, addNegotiationRound, concludeNegotiation, listNegotiations,
  // Innovation + Research + Evolution
  createResearchProject, addFinding, listResearchProjects,
  publishInnovation, adoptInnovation, listInnovations,
  proposeEvolution, voteEvolution, listEvolutionProposals,
  // Health + Dashboard + Search
  getCivilizationHealth, getCivilizationDashboard, civilizationSearch,
  // Memory + Reports + KPIs + Context
  addCivMemory, listCivMemory,
  createCivReport, listCivReports,
  getCivKpi, getAllCivKpis, updateCivKpi,
  getCivContext, updateCivContext,
};
