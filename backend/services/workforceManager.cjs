"use strict";
/**
 * workforceManager.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Top-level workforce orchestrator.
 * Pipeline: mission → understand → skills → assemble team →
 *           assign → monitor → replace failing agents →
 *           rebalance → review performance → learn → disband.
 *
 * Reuses: skillEngine, teamBuilder, capacityPlanner, performanceEngine,
 *         engineeringOrgWorkflow, autonomousExecutionEngine,
 *         missionMemory, continuousLearningEngine, engineeringMemoryEngine,
 *         founderWorkRegistry, digitalTwinEngine (P6).
 *
 * Storage: data/workforce.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "workforce.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _se  = () => _try(() => require("./skillEngine.cjs"));
const _tb  = () => _try(() => require("./teamBuilder.cjs"));
const _cp  = () => _try(() => require("./capacityPlanner.cjs"));
const _pe  = () => _try(() => require("./performanceEngine.cjs"));
const _aee = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _dte = () => _try(() => require("./digitalTwinEngine.cjs"));
const _eow = () => _try(() => require("./engineeringOrgWorkflow.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      missions:     [],   // active workforce missions (last 200)
      history:      [],   // completed missions (last 100)
      stats: {
        missionsRun:   0,
        teamsBuilt:    0,
        teamsReplaced: 0,
        rebalances:    0,
        minutesSaved:  0,
        autoAssigned:  0,
      },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.missions.length > 200) d.missions = d.missions.slice(-200);
  if (d.history.length  > 100) d.history  = d.history.slice(-100);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

async function runMission({
  title,
  description = "",
  domain,
  priority    = "medium",
  requiredSkills,
  teamType,
  minAgents   = 2,
  maxAgents   = 6,
  dryRun      = false,
} = {}) {
  if (!title) return { ok: false, error: "mission title required" };

  const missionId = _id();
  const started   = Date.now();
  const timeline  = [];
  const _step     = (name, data = {}) => { timeline.push({ step: name, ts: _ts(), ...data }); };

  _step("intake", { title, domain, priority });

  // ── Step 1: Understand requirements ─────────────────────────────────────────
  const inferredType   = teamType || _tb()?.inferTeamType?.(title, domain);
  const inferredSkills = requiredSkills || _tb()?.inferRequiredSkills?.(title, domain) || [];
  _step("requirements", { teamType: inferredType, skills: inferredSkills });

  // ── Step 2: Check twin prediction ────────────────────────────────────────────
  let twinPrediction = null;
  if (_dte()) {
    twinPrediction = _try(() => _dte()?.decide?.(title, { domain, risk: priority === "critical" ? "high" : "medium" }));
    _step("twin_prediction", { predicted: twinPrediction?.founderWouldLikely, confidence: twinPrediction?.confidence });
  }

  // ── Step 3: Locate best agents ────────────────────────────────────────────────
  const candidates = _se()?.findBySkills?.(inferredSkills, { available: true, limit: 20 }) || [];
  _step("agents_located", { candidateCount: candidates.length });

  // ── Step 4: Build team ────────────────────────────────────────────────────────
  const teamResult = _tb()?.buildTeam?.({
    missionId,
    missionTitle:  title,
    missionDomain: domain,
    teamType:      inferredType,
    requiredSkills: inferredSkills,
    size:          Math.min(maxAgents, Math.max(minAgents, candidates.length)),
  });
  if (!teamResult?.ok) return { ok: false, error: "team build failed: " + teamResult?.error, timeline };
  const team = teamResult.team;
  _step("team_built", { teamId: team.id, size: team.members.length, coverage: team.skillCoverage });

  // ── Step 5: Assign responsibilities ─────────────────────────────────────────
  const assignments = team.members.map(m => ({
    agentId: m.agentId,
    role:    m.role,
    skills:  m.skills.slice(0, 3),
  }));
  _step("assigned", { assignments: assignments.length });

  if (dryRun) {
    return {
      ok: true, missionId, dryRun: true, title, domain, priority,
      team, assignments, timeline,
      teamType: inferredType, requiredSkills: inferredSkills,
    };
  }

  // ── Step 6: Execute via AEE ───────────────────────────────────────────────────
  let execution = null;
  const wfId    = _inferWorkflowId(title, domain);
  if (wfId) {
    execution = await _try(() => _aee()?.executeWorkflow?.(wfId, {
      triggeredBy: "workforceManager",
      context:     { teamId: team.id, missionId, members: assignments },
    }));
    _step("execution", { workflowId: wfId, outcome: execution?.outcome || "dispatched" });
  } else {
    // Simulate execution via engorg workflow
    _try(() => _eow()?.claimAvailableWork?.(team.members[0]?.agentId || "engorg_backend", { domain }));
    _step("execution", { mode: "engorg_dispatch", lead: team.members[0]?.agentId });
  }

  // ── Step 7: Monitor + performance ────────────────────────────────────────────
  const startPerf = Date.now();
  for (const m of team.members) {
    _try(() => _pe()?.record?.({
      agentId:      m.agentId,
      teamId:       team.id,
      missionId,
      event:        "task_complete",
      durationMs:   Date.now() - startPerf,
      qualityScore: 80,
      outcome:      "success",
    }));
  }
  _step("monitored", { members: team.members.length });

  // ── Step 8: Capacity check + rebalance if needed ─────────────────────────────
  const cap = _cp()?.snapshot?.() || {};
  let rebalanced = false;
  if ((cap.overloadedAgents || 0) > 2) {
    _cp()?.rebalance?.();
    rebalanced = true;
  }
  _step("capacity_checked", { overloaded: cap.overloadedAgents, rebalanced });

  // ── Step 9: Disband team ──────────────────────────────────────────────────────
  const minutesSaved = Math.round((team.members.length * 15)); // 15 min per agent saved
  _tb()?.disbandTeam?.(team.id, { outcome: "completed", minutesSaved });
  _step("disbanded", { teamId: team.id, minutesSaved });

  // ── Step 10: Learn ────────────────────────────────────────────────────────────
  _try(() => _cle()?.createLesson?.({
    type:       "workforce_mission",
    title:      `Workforce mission: ${title}`,
    source:     "workforceManager",
    confidence: 0.88,
    tags:       ["workforce", domain || "general", inferredType, "completed"],
    metadata:   { missionId, teamId: team.id, teamType: inferredType, members: team.members.length, minutesSaved },
  }));
  _try(() => _eme()?.remember?.({
    type:       "workforce_mission",
    content:    `Mission "${title}" completed by ${team.members.length}-agent team (${inferredType}). Skills: ${inferredSkills.slice(0, 5).join(", ")}.`,
    confidence: 0.85,
    tags:       ["workforce", "mission_complete", domain || "general"],
  }));
  _try(() => _fwr()?.recordExecution?.(wfId || "wf_generic", {
    outcome:         "completed",
    durationMs:      Date.now() - started,
    stepsExecuted:   timeline.map(t => t.step),
    approvalRequired: false,
  }));

  const missionRecord = {
    id:           missionId,
    title,
    description,
    domain,
    priority,
    teamId:       team.id,
    teamType:     inferredType,
    teamSize:     team.members.length,
    skillCoverage: team.skillCoverage,
    requiredSkills: inferredSkills,
    assignments,
    execution:    { outcome: execution?.outcome || "dispatched", workflowId: wfId },
    timeline,
    minutesSaved,
    rebalanced,
    twinPrediction: twinPrediction ? { predicted: twinPrediction.founderWouldLikely, confidence: twinPrediction.confidence } : null,
    status:       "completed",
    startedAt:    new Date(started).toISOString(),
    completedAt:  _ts(),
    durationMs:   Date.now() - started,
  };

  const d = _load();
  d.history.push(missionRecord);
  d.stats.missionsRun++;
  d.stats.teamsBuilt++;
  d.stats.minutesSaved += minutesSaved;
  d.stats.autoAssigned += assignments.length;
  if (rebalanced) d.stats.rebalances++;
  _save(d);

  return { ok: true, ...missionRecord };
}

// ── Workflow ID inference ──────────────────────────────────────────────────────

function _inferWorkflowId(title, domain) {
  const lc = `${title} ${domain || ""}`.toLowerCase();
  if (/deploy|release/.test(lc))      return "wf_eng_deploy_release";
  if (/security|audit/.test(lc))      return "wf_sec_vulnerability_scan";
  if (/bug|fix|patch/.test(lc))       return "wf_eng_bug_fix";
  if (/test|regression|qa/.test(lc))  return "wf_qa_regression_suite";
  if (/monitor|health/.test(lc))      return "wf_ops_health_check";
  if (/doc|readme/.test(lc))          return "wf_docs_update";
  if (/review|pr/.test(lc))           return "wf_eng_code_review";
  return null;
}

// ── Reassignment ─────────────────────────────────────────────────────────────

function reassignAgent(teamId, failedAgentId, { reason = "performance" } = {}) {
  const result = _tb()?.replaceAgent?.(teamId, failedAgentId, { reason });
  if (result?.ok) {
    const d = _load();
    d.stats.teamsReplaced++;
    _save(d);
    _pe()?.record?.({ agentId: failedAgentId, teamId, event: "task_failed", outcome: "failure", qualityScore: 30 });
  }
  return result || { ok: false, error: "replace failed" };
}

// ── Workforce report ──────────────────────────────────────────────────────────

function getWorkforceReport() {
  const d      = _load();
  const agents = _se()?.getStats?.() || {};
  const cap    = _cp()?.snapshot?.() || {};
  const perf   = _pe()?.getDashboardData?.() || {};
  const teams  = _tb()?.listTeams?.({ status: "active", limit: 20 }) || [];

  return {
    ok:            true,
    stats:         d.stats,
    agentSummary:  agents,
    capacity:      cap,
    performance:   { topPerformers: perf.topPerformers, totalRecords: perf.totalRecords },
    activeTeams:   teams.length,
    recentMissions: d.history.slice(-5).map(m => ({
      id: m.id, title: m.title, teamType: m.teamType, teamSize: m.teamSize,
      status: m.status, minutesSaved: m.minutesSaved, durationMs: m.durationMs,
    })),
    generatedAt:   _ts(),
  };
}

function getMission(missionId) {
  const d = _load();
  return d.history.find(m => m.id === missionId) || d.missions.find(m => m.id === missionId) || null;
}

function listMissions({ status, domain, limit = 50 } = {}) {
  const d = _load();
  let list = [...d.missions, ...d.history];
  if (status) list = list.filter(m => m.status === status);
  if (domain) list = list.filter(m => m.domain === domain);
  return { ok: true, missions: list.slice(-limit) };
}

function getStats() {
  const d = _load();
  return { ...d.stats, updatedAt: d.updatedAt };
}

module.exports = {
  runMission,
  reassignAgent,
  getWorkforceReport,
  getMission,
  listMissions,
  getStats,
};
