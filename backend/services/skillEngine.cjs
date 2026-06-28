"use strict";
/**
 * skillEngine.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Every platform agent exposes skills, experience, confidence,
 * specialization, current workload, availability, and historical success rate.
 *
 * Sources:
 *   - engineeringOrgWorkflow (DOMAIN_ENGINEER_MAP) — eng agents + live workload
 *   - engineeringOrgState    — work items + KPIs
 *   - businessOrg            — bizorg agents
 *   - autonomousKnowledgeOrg — ako agents
 *   - autonomousEvolutionOrg — aeo agents
 *   - executiveOrg           — eos agents
 *   - enterpriseOrg          — ent agents
 *
 * Storage: data/skill-registry.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "skill-registry.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _eow = () => _try(() => require("./engineeringOrgWorkflow.cjs"));
const _eos_s = () => _try(() => require("./engineeringOrgState.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }

// ── Master agent catalogue ────────────────────────────────────────────────────
// Derived from org layers. Each entry: { id, org, skills[], specializations[],
//   confidence, baseWorkload, maxConcurrent, teamTypes[] }

const AGENT_CATALOGUE = [
  // Engineering Org
  { id: "engorg_cto",         org: "engineering", skills: ["architecture","strategy","leadership","planning","decision"],      specializations: ["technical_vision","system_design"],     confidence: 0.95, maxConcurrent: 3,  teamTypes: ["engineering","deployment","research"] },
  { id: "engorg_manager",     org: "engineering", skills: ["planning","coordination","delivery","estimation","risk"],           specializations: ["project_management","sprint_planning"], confidence: 0.90, maxConcurrent: 5,  teamTypes: ["engineering","mixed","emergency"] },
  { id: "engorg_architect",   org: "engineering", skills: ["architecture","design","planning","review","documentation"],        specializations: ["system_design","api_design"],           confidence: 0.92, maxConcurrent: 4,  teamTypes: ["engineering","design","research"] },
  { id: "engorg_backend",     org: "engineering", skills: ["backend","api","database","nodejs","testing"],                     specializations: ["api_development","server_logic"],       confidence: 0.88, maxConcurrent: 6,  teamTypes: ["engineering","mixed"] },
  { id: "engorg_frontend",    org: "engineering", skills: ["frontend","react","ui","css","testing"],                           specializations: ["component_development","ui_building"],  confidence: 0.87, maxConcurrent: 6,  teamTypes: ["engineering","design","mixed"] },
  { id: "engorg_electron",    org: "engineering", skills: ["electron","desktop","packaging","ipc","native"],                   specializations: ["desktop_app","electron_build"],         confidence: 0.85, maxConcurrent: 4,  teamTypes: ["engineering","deployment"] },
  { id: "engorg_mobile",      org: "engineering", skills: ["mobile","android","capacitor","firebase","ios"],                   specializations: ["mobile_development","app_build"],       confidence: 0.84, maxConcurrent: 4,  teamTypes: ["engineering","deployment"] },
  { id: "engorg_database",    org: "engineering", skills: ["database","sql","migration","optimization","backup"],              specializations: ["data_modeling","query_optimization"],   confidence: 0.88, maxConcurrent: 4,  teamTypes: ["engineering","infrastructure"] },
  { id: "engorg_api",         org: "engineering", skills: ["api","rest","graphql","swagger","testing"],                        specializations: ["api_design","endpoint_development"],    confidence: 0.87, maxConcurrent: 6,  teamTypes: ["engineering","mixed"] },
  { id: "engorg_devops",      org: "engineering", skills: ["devops","deployment","ci_cd","nginx","ssl","monitoring"],          specializations: ["infrastructure","deployment_pipeline"], confidence: 0.90, maxConcurrent: 5,  teamTypes: ["deployment","infrastructure","emergency"] },
  { id: "engorg_security",    org: "engineering", skills: ["security","audit","compliance","encryption","auth"],               specializations: ["vulnerability_assessment","auth_design"],confidence: 0.91, maxConcurrent: 4,  teamTypes: ["engineering","emergency","research"] },
  { id: "engorg_perf",        org: "engineering", skills: ["performance","profiling","optimization","benchmarking","caching"], specializations: ["latency_optimization","memory_profiling"],confidence:0.87, maxConcurrent: 4,  teamTypes: ["engineering","research"] },
  { id: "engorg_qa",          org: "engineering", skills: ["testing","automation","regression","bug_finding","quality"],       specializations: ["test_automation","quality_gate"],       confidence: 0.89, maxConcurrent: 6,  teamTypes: ["engineering","deployment","emergency"] },
  { id: "engorg_refactor",    org: "engineering", skills: ["refactoring","code_quality","patterns","cleanup","review"],        specializations: ["legacy_cleanup","pattern_extraction"],  confidence: 0.85, maxConcurrent: 5,  teamTypes: ["engineering","research"] },
  { id: "engorg_docs",        org: "engineering", skills: ["documentation","writing","api_docs","readme","tutorial"],          specializations: ["technical_writing","api_documentation"],confidence: 0.86, maxConcurrent: 8,  teamTypes: ["engineering","research","mixed"] },
  { id: "engorg_release",     org: "engineering", skills: ["release","versioning","changelog","tagging","deployment"],        specializations: ["release_management","version_control"],  confidence: 0.88, maxConcurrent: 3,  teamTypes: ["deployment","engineering"] },
  { id: "engorg_coordinator", org: "engineering", skills: ["coordination","sync","unblocking","escalation","planning"],       specializations: ["cross_team_sync","blocker_resolution"],  confidence: 0.87, maxConcurrent: 8,  teamTypes: ["engineering","emergency","mixed"] },
  { id: "engorg_code_review", org: "engineering", skills: ["code_review","standards","feedback","mentoring","quality"],       specializations: ["pull_request_review","code_standards"],  confidence: 0.90, maxConcurrent: 6,  teamTypes: ["engineering","research"] },
  // Business Org
  { id: "bizorg_ceo",         org: "business",    skills: ["strategy","leadership","vision","decisions","prioritization"],     specializations: ["business_strategy","executive_decisions"],confidence:0.93, maxConcurrent: 3,  teamTypes: ["business","mixed","research"] },
  { id: "bizorg_coo",         org: "business",    skills: ["operations","process","coordination","delivery","management"],     specializations: ["operations_management","process_design"],confidence:0.90, maxConcurrent: 4,  teamTypes: ["business","mixed"] },
  { id: "bizorg_sales",       org: "business",    skills: ["sales","crm","outreach","negotiation","pipeline"],                specializations: ["lead_conversion","sales_process"],       confidence: 0.85, maxConcurrent: 8,  teamTypes: ["business","mixed"] },
  { id: "bizorg_marketing",   org: "business",    skills: ["marketing","campaigns","branding","content","analytics"],         specializations: ["campaign_management","brand_building"],  confidence: 0.85, maxConcurrent: 8,  teamTypes: ["business","design"] },
  { id: "bizorg_cs",          org: "business",    skills: ["customer_success","support","onboarding","retention","feedback"],  specializations: ["user_onboarding","churn_prevention"],   confidence: 0.84, maxConcurrent: 10, teamTypes: ["business","mixed"] },
  { id: "bizorg_finance",     org: "business",    skills: ["finance","billing","costs","revenue","forecasting"],              specializations: ["cost_analysis","revenue_forecasting"],   confidence: 0.87, maxConcurrent: 4,  teamTypes: ["business","research"] },
  { id: "bizorg_growth",      org: "business",    skills: ["growth","acquisition","retention","experiments","analytics"],     specializations: ["growth_hacking","a_b_testing"],          confidence: 0.83, maxConcurrent: 6,  teamTypes: ["business","research","mixed"] },
  // Knowledge Org
  { id: "ako_research",       org: "knowledge",   skills: ["research","analysis","synthesis","sourcing","validation"],        specializations: ["market_research","competitive_analysis"],confidence: 0.88, maxConcurrent: 6,  teamTypes: ["research","mixed"] },
  { id: "ako_engineering",    org: "knowledge",   skills: ["engineering","architecture","best_practices","patterns"],         specializations: ["technical_knowledge","design_patterns"],  confidence: 0.87, maxConcurrent: 6,  teamTypes: ["research","engineering"] },
  { id: "ako_learning",       org: "knowledge",   skills: ["learning","training","improvement","curriculum","assessment"],    specializations: ["knowledge_transfer","skill_building"],   confidence: 0.85, maxConcurrent: 6,  teamTypes: ["research","mixed"] },
  { id: "ako_graph",          org: "knowledge",   skills: ["graph","knowledge_graph","relations","semantic","traversal"],     specializations: ["knowledge_graph","entity_relations"],    confidence: 0.86, maxConcurrent: 4,  teamTypes: ["research"] },
  { id: "ako_memory",         org: "knowledge",   skills: ["memory","retrieval","indexing","search","persistence"],           specializations: ["knowledge_retrieval","memory_systems"],  confidence: 0.87, maxConcurrent: 6,  teamTypes: ["research","engineering"] },
  // Evolution Org
  { id: "aeo_architecture",   org: "evolution",   skills: ["architecture","evolution","redesign","migration","optimization"],  specializations: ["system_evolution","architecture_migration"],confidence:0.88, maxConcurrent: 4, teamTypes: ["research","engineering"] },
  { id: "aeo_learning",       org: "evolution",   skills: ["learning","adaptation","pattern_recognition","improvement"],      specializations: ["continuous_learning","pattern_evolution"],confidence:0.87,  maxConcurrent: 6, teamTypes: ["research"] },
  { id: "aeo_performance",    org: "evolution",   skills: ["performance","benchmarking","optimization","tuning","monitoring"], specializations: ["system_performance","latency_reduction"],confidence: 0.86, maxConcurrent: 4, teamTypes: ["research","engineering"] },
  { id: "aeo_reliability",    org: "evolution",   skills: ["reliability","stability","fault_tolerance","recovery","testing"], specializations: ["fault_tolerance","system_reliability"],  confidence: 0.88, maxConcurrent: 4, teamTypes: ["engineering","emergency","deployment"] },
  // Executive Org
  { id: "eos_orchestrator",   org: "executive",   skills: ["orchestration","planning","resource_allocation","strategy"],      specializations: ["mission_orchestration","resource_planning"],confidence:0.92, maxConcurrent: 5, teamTypes: ["mixed","business","engineering"] },
  { id: "eos_decision",       org: "executive",   skills: ["decision","analysis","trade_offs","prioritization","approval"],   specializations: ["executive_decisions","trade_off_analysis"],confidence:0.91, maxConcurrent: 5, teamTypes: ["mixed","business"] },
  { id: "eos_mission_planner",org: "executive",   skills: ["planning","milestones","decomposition","estimation","risk"],      specializations: ["mission_planning","milestone_tracking"],  confidence: 0.90, maxConcurrent: 6, teamTypes: ["mixed","engineering","business"] },
  { id: "eos_health",         org: "executive",   skills: ["health","monitoring","alerting","diagnosis","recovery"],          specializations: ["system_health","issue_diagnosis"],        confidence: 0.88, maxConcurrent: 6, teamTypes: ["emergency","deployment"] },
  { id: "eos_coordinator",    org: "executive",   skills: ["coordination","sync","unblocking","escalation","communication"],  specializations: ["cross_org_coordination","escalation"],   confidence: 0.89, maxConcurrent: 8, teamTypes: ["mixed","emergency","engineering"] },
];

// Skill → agent lookup index
const SKILL_INDEX = {};
for (const agent of AGENT_CATALOGUE) {
  for (const skill of agent.skills) {
    if (!SKILL_INDEX[skill]) SKILL_INDEX[skill] = [];
    SKILL_INDEX[skill].push(agent.id);
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      agentState: {},   // agentId → { workload, activeTeams[], successCount, failCount, lastActive }
      updatedAt:  null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Live workload from engineering org ────────────────────────────────────────

function _getLiveWorkload(agentId) {
  const items = _try(() => _eos_s()?.listWorkItems?.({ assignedTo: agentId, status: "in_progress", limit: 20 })) || [];
  return items.length;
}

// ── Agent record builder ──────────────────────────────────────────────────────

function _buildAgentRecord(agent, state) {
  const s          = state.agentState[agent.id] || {};
  const liveWork   = _getLiveWorkload(agent.id);
  const totalJobs  = (s.successCount || 0) + (s.failCount || 0);
  const successRate = totalJobs > 0 ? s.successCount / totalJobs : agent.confidence;
  const workload   = Math.max(liveWork, s.workload || 0);
  const available  = workload < agent.maxConcurrent;

  return {
    id:              agent.id,
    org:             agent.org,
    skills:          agent.skills,
    specializations: agent.specializations,
    confidence:      agent.confidence,
    maxConcurrent:   agent.maxConcurrent,
    teamTypes:       agent.teamTypes,
    workload,
    available,
    successRate:     Math.round(successRate * 100) / 100,
    successCount:    s.successCount || 0,
    failCount:       s.failCount    || 0,
    activeTeams:     s.activeTeams  || [],
    lastActive:      s.lastActive   || null,
    // Composite score — used by teamBuilder for selection
    score: Math.round((agent.confidence * 0.4 + successRate * 0.4 + (available ? 0.2 : 0)) * 100) / 100,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

function listAgents({ org, skill, available, teamType, limit = 100 } = {}) {
  const state = _load();
  let agents  = AGENT_CATALOGUE;
  if (org)      agents = agents.filter(a => a.org === org);
  if (teamType) agents = agents.filter(a => a.teamTypes.includes(teamType));
  if (skill)    agents = agents.filter(a => a.skills.includes(skill) || a.specializations.some(s => s.includes(skill)));
  const records = agents.slice(0, limit).map(a => _buildAgentRecord(a, state));
  if (available !== undefined) return records.filter(r => r.available === available);
  return records;
}

function getAgent(agentId) {
  const agent = AGENT_CATALOGUE.find(a => a.id === agentId);
  if (!agent) return null;
  return _buildAgentRecord(agent, _load());
}

function findBySkills(skillsRequired, { minConfidence = 0, available = true, limit = 20 } = {}) {
  const state   = _load();
  const scored  = [];
  for (const agent of AGENT_CATALOGUE) {
    const record    = _buildAgentRecord(agent, state);
    if (available && !record.available) continue;
    if (record.confidence < minConfidence) continue;
    const matched   = skillsRequired.filter(s =>
      record.skills.includes(s) || record.specializations.some(sp => sp.includes(s))
    );
    if (matched.length === 0) continue;
    scored.push({ ...record, matchedSkills: matched, coverageScore: matched.length / skillsRequired.length });
  }
  return scored.sort((a, b) => (b.coverageScore * 0.6 + b.score * 0.4) - (a.coverageScore * 0.6 + a.score * 0.4)).slice(0, limit);
}

function recordSuccess(agentId, { teamId, durationMs } = {}) {
  const d   = _load();
  const s   = d.agentState[agentId] || { successCount: 0, failCount: 0, workload: 0, activeTeams: [] };
  s.successCount++;
  s.lastActive   = _ts();
  if (teamId && !s.activeTeams.includes(teamId)) s.activeTeams.push(teamId);
  d.agentState[agentId] = s;
  _save(d);
  _try(() => _cle()?.createLesson?.({
    type: "agent_success", title: `Agent success: ${agentId}`, source: "skillEngine", confidence: 0.85,
    tags: ["agent_success", agentId], metadata: { agentId, teamId, durationMs },
  }));
}

function recordFailure(agentId, { teamId, reason } = {}) {
  const d   = _load();
  const s   = d.agentState[agentId] || { successCount: 0, failCount: 0, workload: 0, activeTeams: [] };
  s.failCount++;
  s.lastActive   = _ts();
  d.agentState[agentId] = s;
  _save(d);
}

function setWorkload(agentId, workload) {
  const d   = _load();
  const s   = d.agentState[agentId] || { successCount: 0, failCount: 0, workload: 0, activeTeams: [] };
  s.workload = workload;
  d.agentState[agentId] = s;
  _save(d);
}

function joinTeam(agentId, teamId) {
  const d = _load();
  const s = d.agentState[agentId] || { successCount: 0, failCount: 0, workload: 0, activeTeams: [] };
  if (!s.activeTeams) s.activeTeams = [];
  if (!s.activeTeams.includes(teamId)) {
    s.activeTeams.push(teamId);
    s.workload = (s.workload || 0) + 1;
  }
  d.agentState[agentId] = s;
  _save(d);
}

function leaveTeam(agentId, teamId) {
  const d = _load();
  const s = d.agentState[agentId] || { successCount: 0, failCount: 0, workload: 0, activeTeams: [] };
  s.activeTeams = (s.activeTeams || []).filter(t => t !== teamId);
  s.workload    = Math.max(0, (s.workload || 1) - 1);
  d.agentState[agentId] = s;
  _save(d);
}

function getSkillCoverage() {
  const skills   = Object.keys(SKILL_INDEX);
  const state    = _load();
  const coverage = {};
  for (const skill of skills) {
    const agents    = SKILL_INDEX[skill].map(id => _buildAgentRecord(AGENT_CATALOGUE.find(a => a.id === id), state));
    const available = agents.filter(a => a.available).length;
    coverage[skill] = { total: agents.length, available, avgConfidence: agents.reduce((s, a) => s + a.confidence, 0) / agents.length };
  }
  return coverage;
}

function getStats() {
  const state  = _load();
  const agents = AGENT_CATALOGUE.map(a => _buildAgentRecord(a, state));
  return {
    totalAgents:   agents.length,
    available:     agents.filter(a => a.available).length,
    busy:          agents.filter(a => !a.available).length,
    orgs:          [...new Set(agents.map(a => a.org))],
    skillCount:    Object.keys(SKILL_INDEX).length,
    avgSuccessRate: Math.round(agents.reduce((s, a) => s + a.successRate, 0) / agents.length * 100) / 100,
    updatedAt:     state.updatedAt,
  };
}

module.exports = {
  listAgents,
  getAgent,
  findBySkills,
  recordSuccess,
  recordFailure,
  setWorkload,
  joinTeam,
  leaveTeam,
  getSkillCoverage,
  getStats,
  AGENT_CATALOGUE,
  SKILL_INDEX,
};
