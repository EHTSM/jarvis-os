"use strict";
/**
 * capacityPlanner.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Tracks active workload, queue depth, bottlenecks, idle/overloaded agents.
 * Automatically rebalances work across available agents.
 *
 * Reuses: skillEngine, teamBuilder, engineeringOrgState, workforceManager.
 *
 * Storage: data/capacity-plan.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "capacity-plan.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _se  = () => _try(() => require("./skillEngine.cjs"));
const _tb  = () => _try(() => require("./teamBuilder.cjs"));
const _eos_s = () => _try(() => require("./engineeringOrgState.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// Thresholds
const OVERLOAD_THRESHOLD = 0.85;  // workload/maxConcurrent >= this → overloaded
const IDLE_THRESHOLD     = 0;     // workload === 0 → idle

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      queue:        [],      // pending work assignments
      rebalances:   [],      // history of rebalance actions (last 100)
      snapshots:    [],      // hourly capacity snapshots (last 48)
      stats:        { rebalanceCount: 0, workAssigned: 0, bottlenecksResolved: 0 },
      updatedAt:    null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.rebalances.length > 100) d.rebalances = d.rebalances.slice(-100);
  if (d.snapshots.length  > 48)  d.snapshots  = d.snapshots.slice(-48);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Current capacity snapshot ────────────────────────────────────────────────

function snapshot() {
  const agents  = _se()?.listAgents?.({ limit: 200 }) || [];
  const teams   = _tb()?.listTeams?.({ status: "active", limit: 100 }) || [];
  const queueLen = (_load().queue || []).filter(q => q.status === "pending").length;

  const idle       = agents.filter(a => a.workload === IDLE_THRESHOLD);
  const busy       = agents.filter(a => a.workload > 0 && a.workload < (a.maxConcurrent * OVERLOAD_THRESHOLD));
  const overloaded = agents.filter(a => a.workload >= (a.maxConcurrent * OVERLOAD_THRESHOLD));

  // Skill bottlenecks — required skills with no available agents
  const skillCoverage  = _se()?.getSkillCoverage?.() || {};
  const bottlenecks    = Object.entries(skillCoverage)
    .filter(([, v]) => v.available === 0 && v.total > 0)
    .map(([skill, v]) => ({ skill, total: v.total, available: v.available, avgConfidence: v.avgConfidence }));

  const snap = {
    ts:              _ts(),
    totalAgents:     agents.length,
    idleAgents:      idle.length,
    busyAgents:      busy.length,
    overloadedAgents:overloaded.length,
    activeTeams:     teams.length,
    queueDepth:      queueLen,
    bottlenecks,
    utilizationRate: agents.length > 0
      ? Math.round((busy.length + overloaded.length) / agents.length * 100) : 0,
    overloadRate: agents.length > 0
      ? Math.round(overloaded.length / agents.length * 100) : 0,
    idleRate: agents.length > 0
      ? Math.round(idle.length / agents.length * 100) : 0,
    topOverloaded: overloaded.slice(0, 5).map(a => ({
      id: a.id, org: a.org, workload: a.workload, maxConcurrent: a.maxConcurrent,
    })),
    topIdle: idle.slice(0, 5).map(a => ({ id: a.id, org: a.org })),
  };

  // Persist snapshot
  const d = _load();
  d.snapshots.push(snap);
  _save(d);

  return snap;
}

// ── Queue management ─────────────────────────────────────────────────────────

function enqueueWork({ title, skillsRequired = [], priority = "medium", teamId, missionId, context = {} } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const d   = _load();
  const id  = _id();
  const item = {
    id, title, skillsRequired, priority, teamId, missionId, context,
    status:    "pending",
    assignedTo: null,
    enqueuedAt: _ts(),
  };
  d.queue.push(item);
  d.stats.workAssigned++;
  _save(d);
  return { ok: true, id };
}

function assignWork(workItemId, agentId) {
  const d    = _load();
  const item = d.queue.find(q => q.id === workItemId);
  if (!item) return { ok: false, error: "work item not found" };
  item.status     = "assigned";
  item.assignedTo = agentId;
  item.assignedAt = _ts();
  _try(() => _se()?.setWorkload?.(agentId, (_se()?.getAgent?.(agentId)?.workload || 0) + 1));
  _save(d);
  return { ok: true, workItemId, agentId };
}

function completeWork(workItemId, { outcome = "success" } = {}) {
  const d    = _load();
  const item = d.queue.find(q => q.id === workItemId);
  if (!item) return { ok: false, error: "work item not found" };
  item.status      = "completed";
  item.outcome     = outcome;
  item.completedAt = _ts();
  if (item.assignedTo) {
    _try(() => _se()?.setWorkload?.(item.assignedTo, Math.max(0, (_se()?.getAgent?.(item.assignedTo)?.workload || 1) - 1)));
  }
  _save(d);
  return { ok: true, workItemId, outcome };
}

// ── Auto-rebalance ────────────────────────────────────────────────────────────

function rebalance() {
  const d         = _load();
  const snap      = snapshot();
  const actions   = [];

  // 1. Move work from overloaded agents to idle agents
  const pending = d.queue.filter(q => q.status === "pending");
  const idle    = (_se()?.listAgents?.({ available: true, limit: 20 }) || [])
    .filter(a => a.workload === 0);

  for (const item of pending.slice(0, idle.length)) {
    const capable = idle.find(agent =>
      !item.skillsRequired.length ||
      item.skillsRequired.some(s => agent.skills.includes(s))
    );
    if (capable) {
      assignWork(item.id, capable.id);
      actions.push({ type: "assigned_idle", workItemId: item.id, agentId: capable.id });
    }
  }

  // 2. Flag overloaded agents in teams for replacement
  if (snap.overloadedAgents > 0 && snap.topOverloaded.length > 0) {
    for (const oa of snap.topOverloaded.slice(0, 2)) {
      // Find their team and suggest replacement
      const teams = _tb()?.listTeams?.({ status: "active" }) || [];
      for (const team of teams) {
        const member = team.members.find(m => m.agentId === oa.id && m.status === "active");
        if (member) {
          actions.push({ type: "overload_flagged", agentId: oa.id, teamId: team.id, workload: oa.workload });
        }
      }
    }
  }

  // 3. Resolve bottlenecks by finding least-loaded capable agent
  for (const bn of snap.bottlenecks.slice(0, 3)) {
    const capable = (_se()?.listAgents?.({ skill: bn.skill, limit: 10 }) || [])
      .filter(a => !a.available)
      .sort((a, b) => a.workload - b.workload)[0];
    if (capable) {
      actions.push({ type: "bottleneck_escalated", skill: bn.skill, leastLoadedAgent: capable.id, workload: capable.workload });
      d.stats.bottlenecksResolved++;
    }
  }

  const rec = {
    id:        _id(),
    ts:        _ts(),
    actions,
    snapshot:  snap,
  };

  d.rebalances.push(rec);
  d.stats.rebalanceCount++;
  _save(d);

  _try(() => _cle()?.createLesson?.({
    type:       "capacity_rebalance",
    title:      `Capacity rebalanced: ${actions.length} actions`,
    source:     "capacityPlanner",
    confidence: 0.8,
    tags:       ["capacity", "rebalance"],
    metadata:   { actions: actions.length, overloaded: snap.overloadedAgents, idle: snap.idleAgents },
  }));

  return { ok: true, actions, snapshot: snap };
}

// ── Capacity report ───────────────────────────────────────────────────────────

function getCapacityReport() {
  const snap  = snapshot();
  const d     = _load();
  const queue = d.queue;
  return {
    ok: true,
    current: snap,
    queue: {
      pending:   queue.filter(q => q.status === "pending").length,
      assigned:  queue.filter(q => q.status === "assigned").length,
      completed: queue.filter(q => q.status === "completed").length,
      total:     queue.length,
    },
    stats:     d.stats,
    recentRebalances: d.rebalances.slice(-5),
    generatedAt: _ts(),
  };
}

function getStats() {
  const d = _load();
  return { ...d.stats, updatedAt: d.updatedAt };
}

module.exports = {
  snapshot,
  enqueueWork,
  assignWork,
  completeWork,
  rebalance,
  getCapacityReport,
  getStats,
};
