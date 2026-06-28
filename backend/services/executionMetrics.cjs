"use strict";
/**
 * executionMetrics.cjs — POST-Ω Sprint P3
 *
 * Aggregates execution statistics from all P3 engines.
 * Does NOT store anything — reads from evidence index, recovery records,
 * automation engine data, and registry. Single query surface for the dashboard.
 *
 * Metrics:
 *   pending / running / awaiting_approval / completed / failed / retried / rolled_back
 *   success_rate / avg_execution_ms / founder_minutes_eliminated / automation_coverage
 *   per-domain breakdown / per-class breakdown / trend (last 7 days)
 */

const fs   = require("fs");
const path = require("path");

const ROOT  = path.join(__dirname, "../..");
const _try  = fn => { try { return fn(); } catch { return null; } };
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _fae  = () => _try(() => require("./founderAutomationEngine.cjs"));
const _ev   = () => _try(() => require("./executionEvidence.cjs"));
const _rec  = () => _try(() => require("./executionRecovery.cjs"));
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }

// ── Core metrics aggregation ───────────────────────────────────────────────────

function getDashboard() {
  const faeReport = _fae()?.getReport?.() || {};
  const evSummary = _ev()?.getSummary?.() || {};
  const recStats  = _rec()?.getStats?.() || {};
  const reg       = _fwr()?.getRegistry?.() || { summary: {}, workflows: [] };
  const bibleDash = _pbe()?.getDashboard?.() || {};

  // Execution state counts from FAE runs
  const runs = _try(() => _fae()?.listRuns?.({ limit: 500 }) || []) || [];
  const state = {
    pending:           (reg.workflows || []).filter(w => w.status === "pending_automation" && w.class !== "C").length,
    running:           runs.filter(r => r.status === "running").length,
    awaiting_approval: runs.filter(r => r.status === "awaiting_approval").length,
    completed:         runs.filter(r => r.status === "completed" && r.outcome === "success").length,
    failed:            runs.filter(r => r.outcome === "failed" || r.outcome === "partial").length,
    retried:           recStats.successfulRecoveries || 0,
    rolled_back:       _try(() => { const d = _rj(path.join(ROOT, "data/execution-recovery.json"), { records: [] }); return d.records.filter(r => r.outcome?.includes("rolled_back")).length; }) || 0,
  };

  // Success rate from evidence
  const successRate  = evSummary.successRate ?? (state.completed + state.failed > 0
    ? Math.round(state.completed / (state.completed + state.failed) * 100) : 0);

  // Average execution time from AEE run data file
  const aeeData  = _rj(path.join(ROOT, "data/autonomous-execution.json"), { runs: [] });
  const finishedRuns = (aeeData.runs || []).filter(r => r.durationMs > 0);
  const avgExecMs    = finishedRuns.length > 0
    ? Math.round(finishedRuns.reduce((s, r) => s + r.durationMs, 0) / finishedRuns.length)
    : 0;

  // Founder time eliminated
  const minutesEliminated = faeReport.summary?.minutesSaved || evSummary.minutesSaved || 0;

  // Automation coverage: automated / total automatable (A+B)
  const s = reg.summary;
  const automatable = (s.classA || 0) + (s.classB || 0);
  const automated   = s.automatedCount || 0;
  const automationCoverage = automatable > 0 ? Math.round(automated / automatable * 100) : 0;

  // Per-domain breakdown
  const domainMap = {};
  for (const w of (reg.workflows || [])) {
    if (!domainMap[w.domain]) domainMap[w.domain] = { total: 0, automated: 0, minutes: 0 };
    domainMap[w.domain].total++;
    if (w.automatedBy) domainMap[w.domain].automated++;
    domainMap[w.domain].minutes += w.estimatedMinutes || 0;
  }

  // 7-day trend from evidence index
  const evIdx  = _rj(path.join(ROOT, "data/execution-evidence-index.json"), []);
  const week   = Date.now() - 7 * 24 * 3600 * 1000;
  const trend  = [];
  for (let d = 6; d >= 0; d--) {
    const day     = new Date(Date.now() - d * 86400000);
    const dayStr  = day.toISOString().slice(0, 10);
    const dayRecs = evIdx.filter(e => e.ts?.startsWith(dayStr));
    trend.push({
      date:     dayStr,
      executions: dayRecs.length,
      successes:  dayRecs.filter(e => e.outcome === "success").length,
      minutesSaved: dayRecs.filter(e => e.outcome === "success").reduce((s, e) => s + (e.minutesSaved || 0), 0),
    });
  }

  return {
    ok: true,
    executionState: state,
    successRate,
    avgExecutionMs:       avgExecMs,
    avgExecutionSec:      Math.round(avgExecMs / 1000),
    founderMinutesEliminated: minutesEliminated,
    founderHoursEliminated:   Math.round(minutesEliminated / 60 * 10) / 10,
    automationCoverage,
    totalWorkflows:       s.total || 0,
    classA:               s.classA || 0,
    classB:               s.classB || 0,
    classC:               s.classC || 0,
    perDomain:            domainMap,
    productionBible:      { total: bibleDash.totalWorkflows || 0, automated: bibleDash.automatedWorkflows || 0, pct: bibleDash.automationPct || 0 },
    evidenceSummary:      evSummary,
    recoveryStats:        recStats,
    trend,
    generatedAt:          new Date().toISOString(),
  };
}

// ── Per-workflow metrics ───────────────────────────────────────────────────────
function getWorkflowMetrics(workflowId) {
  const fae = _fae();
  const ev  = _ev();
  const rec = _rec();

  const runs       = (fae?.listRuns?.({ workflowId }) || []);
  const evidence   = (ev?.listEvidence?.({ workflowId }) || []);
  const recoveries = (rec?.listRecoveries?.({ workflowId }) || []);

  const successes = runs.filter(r => r.outcome === "success");
  const failures  = runs.filter(r => r.outcome === "failed" || r.outcome === "partial");

  return {
    ok: true,
    workflowId,
    totalRuns:    runs.length,
    successes:    successes.length,
    failures:     failures.length,
    successRate:  runs.length > 0 ? Math.round(successes.length / runs.length * 100) : 0,
    recoveries:   recoveries.length,
    totalMinutesSaved: successes.reduce((s, r) => s + (r.minutesSaved || 0), 0),
    evidenceCount: evidence.length,
    lastRunAt:    runs[0]?.startedAt || null,
    lastOutcome:  runs[0]?.outcome || null,
  };
}

// ── System-wide summary (for routes) ─────────────────────────────────────────
function getSummary() {
  const dash = getDashboard();
  return {
    ok: true,
    automationCoverage: dash.automationCoverage,
    minutesEliminated:  dash.founderMinutesEliminated,
    hoursEliminated:    dash.founderHoursEliminated,
    successRate:        dash.successRate,
    state:              dash.executionState,
    generatedAt:        dash.generatedAt,
  };
}

module.exports = { getDashboard, getWorkflowMetrics, getSummary };
