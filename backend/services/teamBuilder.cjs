"use strict";
/**
 * teamBuilder.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Automatically assembles the best AI team for any mission.
 * Supports: engineering, design, business, mixed, emergency,
 *           deployment, research, infrastructure teams.
 *
 * Reuses: skillEngine, workforceManager, continuousLearningEngine,
 *         digitalTwinEngine (P6), engineeringOrgWorkflow, missionMemory.
 *
 * Storage: data/teams.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "teams.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _se  = () => _try(() => require("./skillEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _dte = () => _try(() => require("./digitalTwinEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `team_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Team type blueprints ─────────────────────────────────────────────────────

const TEAM_BLUEPRINTS = {
  engineering: {
    requiredSkills:  ["backend", "testing", "review"],
    optionalSkills:  ["architecture", "database", "devops"],
    minSize:         2,
    maxSize:         6,
    preferredOrgs:   ["engineering", "knowledge"],
  },
  design: {
    requiredSkills:  ["frontend", "ui"],
    optionalSkills:  ["documentation", "review"],
    minSize:         2,
    maxSize:         4,
    preferredOrgs:   ["engineering"],
  },
  business: {
    requiredSkills:  ["strategy", "planning"],
    optionalSkills:  ["analytics", "operations", "finance"],
    minSize:         2,
    maxSize:         5,
    preferredOrgs:   ["business", "executive"],
  },
  mixed: {
    requiredSkills:  ["coordination", "planning"],
    optionalSkills:  ["backend", "strategy", "testing"],
    minSize:         3,
    maxSize:         8,
    preferredOrgs:   ["engineering", "business", "executive"],
  },
  emergency: {
    requiredSkills:  ["reliability", "monitoring", "recovery"],
    optionalSkills:  ["security", "devops", "performance"],
    minSize:         2,
    maxSize:         5,
    preferredOrgs:   ["engineering", "executive", "evolution"],
  },
  deployment: {
    requiredSkills:  ["deployment", "testing", "release"],
    optionalSkills:  ["security", "monitoring", "documentation"],
    minSize:         2,
    maxSize:         5,
    preferredOrgs:   ["engineering"],
  },
  research: {
    requiredSkills:  ["research", "analysis"],
    optionalSkills:  ["documentation", "architecture", "learning"],
    minSize:         2,
    maxSize:         5,
    preferredOrgs:   ["knowledge", "evolution", "engineering"],
  },
  infrastructure: {
    requiredSkills:  ["devops", "monitoring"],
    optionalSkills:  ["security", "database", "performance"],
    minSize:         2,
    maxSize:         4,
    preferredOrgs:   ["engineering", "evolution"],
  },
};

// ── Mission → team type inference ─────────────────────────────────────────────

function inferTeamType(missionTitle, missionDomain) {
  const lc = `${missionTitle} ${missionDomain || ""}`.toLowerCase();
  if (/deploy|release|ship|publish|rollout/.test(lc))               return "deployment";
  if (/incident|outage|emergency|critical|down|urgent/.test(lc))    return "emergency";
  if (/ui|design|layout|component|visual|css/.test(lc))             return "design";
  if (/research|analyze|investigate|study|explore/.test(lc))        return "research";
  if (/infra|server|nginx|vps|network|ssl/.test(lc))                return "infrastructure";
  if (/business|revenue|sales|marketing|growth/.test(lc))           return "business";
  if (/bug|fix|patch|hotfix|regression/.test(lc))                   return "engineering";
  if (/feature|implement|build|develop/.test(lc))                   return "engineering";
  if (/document|readme|wiki|tutorial/.test(lc))                     return "research";
  return "mixed";
}

// ── Mission → required skills inference ──────────────────────────────────────

function inferRequiredSkills(missionTitle, missionDomain) {
  const lc = `${missionTitle} ${missionDomain || ""}`.toLowerCase();
  const skills = [];
  if (/backend|api|server|node/.test(lc))       skills.push("backend", "api");
  if (/frontend|react|ui|component/.test(lc))   skills.push("frontend", "ui");
  if (/database|sql|migration/.test(lc))         skills.push("database");
  if (/deploy|devops|ci_cd/.test(lc))            skills.push("devops", "deployment");
  if (/security|auth|ssl|encrypt/.test(lc))      skills.push("security", "audit");
  if (/test|qa|regression/.test(lc))             skills.push("testing", "qa");
  if (/performance|latency|speed/.test(lc))      skills.push("performance", "profiling");
  if (/document|docs|readme/.test(lc))           skills.push("documentation", "writing");
  if (/research|analyze/.test(lc))               skills.push("research", "analysis");
  if (/review|refactor|quality/.test(lc))        skills.push("code_review", "refactoring");
  if (/monitor|alert|health/.test(lc))           skills.push("monitoring", "reliability");
  if (/release|version|publish/.test(lc))        skills.push("release", "versioning");
  if (skills.length === 0)                        skills.push("planning", "coordination");
  return [...new Set(skills)];
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { teams: [], disbanded: [], stats: { built: 0, disbanded: 0, avgSize: 0, successRate: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.disbanded.length > 200) d.disbanded = d.disbanded.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core team builder ─────────────────────────────────────────────────────────

function buildTeam({ missionId, missionTitle = "", missionDomain, teamType, requiredSkills, size }) {
  if (!missionId) return { ok: false, error: "missionId required" };

  const type      = teamType || inferTeamType(missionTitle, missionDomain);
  const blueprint = TEAM_BLUEPRINTS[type] || TEAM_BLUEPRINTS.mixed;
  const skills    = requiredSkills?.length ? requiredSkills : [
    ...blueprint.requiredSkills,
    ...inferRequiredSkills(missionTitle, missionDomain),
  ];
  const targetSize = Math.min(size || blueprint.maxSize, blueprint.maxSize);

  // Find best agents for the required skills
  const candidates = _se()?.findBySkills?.(skills, { available: true, limit: 30 }) || [];

  if (candidates.length < blueprint.minSize) {
    // Relax availability constraint
    const relaxed = _se()?.findBySkills?.(skills, { available: false, limit: 20 }) || [];
    candidates.push(...relaxed.filter(r => !candidates.find(c => c.id === r.id)));
  }

  // Select top agents ensuring skill diversity
  const selected  = [];
  const coveredSkills = new Set();
  const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);

  for (const candidate of sortedCandidates) {
    if (selected.length >= targetSize) break;
    if (selected.find(s => s.id === candidate.id)) continue;
    selected.push(candidate);
    for (const skill of candidate.skills) coveredSkills.add(skill);
  }

  // Calculate skill coverage
  const totalSkills = new Set(skills).size;
  const covered     = skills.filter(s => coveredSkills.has(s)).length;
  const coverage    = Math.round(covered / Math.max(1, totalSkills) * 100);

  // Assign roles
  const members = selected.map((agent, i) => ({
    agentId:      agent.id,
    org:          agent.org,
    role:         _assignRole(agent, i, type),
    skills:       agent.skills,
    confidence:   agent.confidence,
    workload:     agent.workload,
    joinedAt:     _ts(),
    status:       "active",
  }));

  const teamId = _id();
  const team   = {
    id:            teamId,
    missionId,
    missionTitle,
    missionDomain,
    type,
    members,
    skillsCovered:  [...coveredSkills],
    skillCoverage:  coverage,
    requiredSkills: skills,
    leadId:         members[0]?.agentId || null,
    status:         "active",
    performance:    { tasksCompleted: 0, tasksFailed: 0, avgDurationMs: 0 },
    createdAt:      _ts(),
    updatedAt:      _ts(),
    disbandedAt:    null,
  };

  const store = _load();
  store.teams.push(team);
  store.stats.built++;
  _save(store);

  // Register agents in skill engine
  for (const m of members) {
    _try(() => _se()?.joinTeam?.(m.agentId, teamId));
  }

  // Persist lesson
  _try(() => _cle()?.createLesson?.({
    type:       "team_built",
    title:      `Team built for: ${missionTitle}`,
    source:     "teamBuilder",
    confidence: 0.85,
    tags:       ["team_built", type, missionDomain || "general"],
    metadata:   { teamId, missionId, type, size: members.length, coverage },
  }));

  return { ok: true, team };
}

function _assignRole(agent, index, teamType) {
  if (index === 0) return "lead";
  if (agent.skills.includes("coordination") || agent.id.includes("coordinator")) return "coordinator";
  if (agent.skills.includes("testing") || agent.id.includes("qa"))              return "qa";
  if (agent.skills.includes("security") || agent.id.includes("security"))       return "security";
  if (agent.skills.includes("documentation") || agent.id.includes("docs"))     return "docs";
  if (agent.skills.includes("devops") || agent.id.includes("devops"))          return "devops";
  return "member";
}

// ── Team operations ───────────────────────────────────────────────────────────

function getTeam(teamId) {
  const store = _load();
  return store.teams.find(t => t.id === teamId) || null;
}

function getTeamForMission(missionId) {
  const store = _load();
  return store.teams.find(t => t.missionId === missionId && t.status === "active") || null;
}

function listTeams({ status, type, limit = 50 } = {}) {
  const store = _load();
  let list    = store.teams;
  if (status) list = list.filter(t => t.status === status);
  if (type)   list = list.filter(t => t.type === type);
  return list.slice(-limit);
}

function replaceAgent(teamId, failedAgentId, { reason = "failure" } = {}) {
  const store = _load();
  const team  = store.teams.find(t => t.id === teamId);
  if (!team) return { ok: false, error: "team not found" };

  const failing = team.members.find(m => m.agentId === failedAgentId);
  if (!failing) return { ok: false, error: "agent not in team" };

  // Find replacement with similar skills
  const replacements = _se()?.findBySkills?.(failing.skills, { available: true, limit: 5 }) || [];
  const replacement  = replacements.find(r => !team.members.find(m => m.agentId === r.id));

  if (!replacement) return { ok: false, error: "no replacement available" };

  failing.status     = "replaced";
  failing.replacedAt = _ts();
  failing.replacedBy = replacement.id;

  team.members.push({
    agentId:    replacement.id,
    org:        replacement.org,
    role:       failing.role,
    skills:     replacement.skills,
    confidence: replacement.confidence,
    workload:   replacement.workload,
    joinedAt:   _ts(),
    status:     "active",
    replacedAgent: failedAgentId,
  });

  _try(() => _se()?.leaveTeam?.(failedAgentId, teamId));
  _try(() => _se()?.joinTeam?.(replacement.id, teamId));
  _try(() => _se()?.recordFailure?.(failedAgentId, { teamId, reason }));

  team.updatedAt = _ts();
  _save(store);

  return { ok: true, replacedBy: replacement.id, role: failing.role };
}

function disbandTeam(teamId, { outcome = "completed", minutesSaved = 0 } = {}) {
  const store = _load();
  const team  = store.teams.find(t => t.id === teamId);
  if (!team) return { ok: false, error: "team not found" };

  team.status      = "disbanded";
  team.disbandedAt = _ts();
  team.outcome     = outcome;

  // Release agents
  for (const m of team.members.filter(m => m.status === "active")) {
    _try(() => _se()?.leaveTeam?.(m.agentId, teamId));
    if (outcome === "completed") _try(() => _se()?.recordSuccess?.(m.agentId, { teamId }));
  }

  store.disbanded.push({ ...team });
  store.teams = store.teams.filter(t => t.id !== teamId);
  store.stats.disbanded++;
  _save(store);

  return { ok: true, teamId, outcome, membersReleased: team.members.length };
}

function getStats() {
  const store   = _load();
  const active  = store.teams.length;
  return {
    ...store.stats,
    active,
    updatedAt: store.updatedAt,
  };
}

module.exports = {
  buildTeam,
  getTeam,
  getTeamForMission,
  listTeams,
  replaceAgent,
  disbandTeam,
  getStats,
  inferTeamType,
  inferRequiredSkills,
  TEAM_BLUEPRINTS,
};
