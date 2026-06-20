"use strict";
/**
 * Founder Operating Program (FOP-1)
 * Core journal engine — all 10 deliverables in one service.
 *
 * Deliverables:
 *   1. Daily Founder Journal       — per-day narrative + friction entries
 *   2. Escape Log                  — every time user left Ooplix to use another tool
 *   3. Crash Log                   — crashes/errors + resolution status
 *   4. Performance Log             — timing samples for key interactions
 *   5. AI Usage Report             — prompts, tokens, latency, model breakdown
 *   6. Credit Consumption Report   — credits spent per day/feature
 *   7. Top 20 Daily Frictions      — friction items scored 1-10
 *   8. Weekly Product Score        — composite score from all signals
 *   9. Launch Confidence           — confidence % from week signals
 *  10. Ship Recommendation         — GO / CONDITIONAL GO / NOT YET
 *
 * Storage: data/fop-journal.json
 *   {
 *     days:   { "YYYY-MM-DD": DayRecord }
 *     escapes: EscapeEntry[]
 *     crashes: CrashEntry[]
 *   }
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/fop-journal.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { days: {}, escapes: [], crashes: [] }; }
}

function _save(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _ts() { return new Date().toISOString(); }

function _dayTemplate(date) {
  return {
    date,
    narrative:        "",
    mood:             null,           // 1–5
    productiveHours:  null,
    frictions:        [],             // { id, text, score, feature, workaround }
    performance:      [],             // { id, action, ms, acceptable }
    aiUsage:          [],             // { id, feature, model, promptTokens, completionTokens, latencyMs, helpful }
    creditUsage:      [],             // { id, feature, credits, purpose }
    completedGoals:   [],
    blockers:         [],
    notes:            "",
    sealed:           false,
  };
}

function _getDay(state, date) {
  if (!state.days[date]) state.days[date] = _dayTemplate(date);
  return state.days[date];
}

// ── Day Journal ───────────────────────────────────────────────────────────────

function getDay(date) {
  const state = _load();
  return _getDay(state, date || _today());
}

function updateNarrative(date, { narrative, mood, productiveHours, completedGoals, blockers, notes }) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  if (narrative        !== undefined) day.narrative        = narrative;
  if (mood             !== undefined) day.mood             = mood;
  if (productiveHours  !== undefined) day.productiveHours  = productiveHours;
  if (completedGoals   !== undefined) day.completedGoals   = completedGoals;
  if (blockers         !== undefined) day.blockers         = blockers;
  if (notes            !== undefined) day.notes            = notes;
  _save(state);
  return day;
}

function sealDay(date) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  day.sealed  = true;
  _save(state);
  return day;
}

// ── Escape Log ────────────────────────────────────────────────────────────────

function logEscape({ tool, reason, feature, duration, date }) {
  const state = _load();
  const entry = {
    id:        `esc-${Date.now()}`,
    ts:        _ts(),
    date:      date || _today(),
    tool,           // e.g. "VS Code", "ChatGPT", "Browser DevTools"
    reason,         // free text
    feature,        // what Ooplix feature was missing / failed
    duration,       // minutes spent outside Ooplix
  };
  state.escapes.push(entry);
  _save(state);
  return entry;
}

function getEscapes({ date, limit } = {}) {
  const state = _load();
  let list = state.escapes || [];
  if (date) list = list.filter(e => e.date === date);
  if (limit) list = list.slice(-limit);
  return list;
}

// ── Crash Log ─────────────────────────────────────────────────────────────────

function logCrash({ title, description, stackTrace, feature, severity, date }) {
  const state = _load();
  const entry = {
    id:          `crash-${Date.now()}`,
    ts:          _ts(),
    date:        date || _today(),
    title,
    description,
    stackTrace:  stackTrace || "",
    feature,
    severity:    severity || "medium",   // low / medium / high / critical
    resolved:    false,
    resolvedAt:  null,
    resolution:  "",
  };
  if (!state.crashes) state.crashes = [];
  state.crashes.push(entry);
  _save(state);
  return entry;
}

function resolveCrash(id, resolution) {
  const state = _load();
  const crash = (state.crashes || []).find(c => c.id === id);
  if (!crash) throw new Error(`Crash ${id} not found`);
  crash.resolved   = true;
  crash.resolvedAt = _ts();
  crash.resolution = resolution;
  _save(state);
  return crash;
}

function getCrashes({ date, resolved, limit } = {}) {
  const state = _load();
  let list = state.crashes || [];
  if (date     !== undefined) list = list.filter(c => c.date === date);
  if (resolved !== undefined) list = list.filter(c => c.resolved === resolved);
  if (limit) list = list.slice(-limit);
  return list;
}

// ── Performance Log ───────────────────────────────────────────────────────────

function logPerf({ action, ms, acceptable, feature, date }) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  const entry = {
    id:         `perf-${Date.now()}`,
    ts:         _ts(),
    action,
    ms,
    acceptable: acceptable !== false,   // default true
    feature,
  };
  day.performance.push(entry);
  _save(state);
  return entry;
}

function getPerfLog(date) {
  const state = _load();
  return _getDay(state, date || _today()).performance;
}

// ── AI Usage ──────────────────────────────────────────────────────────────────

function logAIUsage({ feature, model, promptTokens, completionTokens, latencyMs, helpful, date }) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  const entry = {
    id:               `ai-${Date.now()}`,
    ts:               _ts(),
    feature,
    model:            model || "claude-sonnet-4-6",
    promptTokens:     promptTokens || 0,
    completionTokens: completionTokens || 0,
    latencyMs:        latencyMs || 0,
    helpful:          helpful !== false,
  };
  day.aiUsage.push(entry);
  _save(state);
  return entry;
}

// ── Credit Usage ──────────────────────────────────────────────────────────────

function logCreditUsage({ feature, credits, purpose, date }) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  const entry = {
    id:      `cr-${Date.now()}`,
    ts:      _ts(),
    feature,
    credits,
    purpose,
  };
  day.creditUsage.push(entry);
  _save(state);
  return entry;
}

// ── Friction ──────────────────────────────────────────────────────────────────

function logFriction({ text, score, feature, workaround, date }) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  const entry = {
    id:          `fr-${Date.now()}`,
    ts:          _ts(),
    text,
    score:       Math.min(10, Math.max(1, score || 5)),
    feature,
    workaround:  workaround || "",
  };
  day.frictions.push(entry);
  _save(state);
  return entry;
}

function getTop20Frictions(date) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  return [...day.frictions].sort((a, b) => b.score - a.score).slice(0, 20);
}

// ── AI Usage Report ───────────────────────────────────────────────────────────

function getAIReport(date) {
  const state = _load();
  const day   = _getDay(state, date || _today());
  const entries = day.aiUsage;

  const totalPrompt      = entries.reduce((s, e) => s + (e.promptTokens     || 0), 0);
  const totalCompletion  = entries.reduce((s, e) => s + (e.completionTokens || 0), 0);
  const totalLatency     = entries.length ? entries.reduce((s, e) => s + (e.latencyMs || 0), 0) / entries.length : 0;
  const helpfulCount     = entries.filter(e => e.helpful).length;

  const byModel = {};
  for (const e of entries) {
    if (!byModel[e.model]) byModel[e.model] = { calls: 0, promptTokens: 0, completionTokens: 0 };
    byModel[e.model].calls++;
    byModel[e.model].promptTokens     += e.promptTokens     || 0;
    byModel[e.model].completionTokens += e.completionTokens || 0;
  }

  const byFeature = {};
  for (const e of entries) {
    if (!byFeature[e.feature]) byFeature[e.feature] = 0;
    byFeature[e.feature]++;
  }

  return {
    date,
    totalCalls:       entries.length,
    totalTokens:      totalPrompt + totalCompletion,
    promptTokens:     totalPrompt,
    completionTokens: totalCompletion,
    avgLatencyMs:     Math.round(totalLatency),
    helpfulRate:      entries.length ? Math.round((helpfulCount / entries.length) * 100) : 0,
    byModel,
    byFeature,
    entries,
  };
}

// ── Credit Report ─────────────────────────────────────────────────────────────

function getCreditReport(date) {
  const state  = _load();
  const day    = _getDay(state, date || _today());
  const entries = day.creditUsage;

  const total = entries.reduce((s, e) => s + (e.credits || 0), 0);

  const byFeature = {};
  for (const e of entries) {
    if (!byFeature[e.feature]) byFeature[e.feature] = 0;
    byFeature[e.feature] += e.credits || 0;
  }

  return {
    date,
    totalCreditsUsed: total,
    byFeature,
    entries,
  };
}

// ── Weekly Product Score ──────────────────────────────────────────────────────

function getWeeklyScore(weekStartDate) {
  const state    = _load();
  const start    = weekStartDate ? new Date(weekStartDate) : (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d;
  })();

  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (state.days[key]) days.push(state.days[key]);
  }

  if (!days.length) return { score: null, daysLogged: 0, days: [], signals: {} };

  const avgMood    = days.filter(d => d.mood).reduce((s, d) => s + d.mood, 0) / (days.filter(d=>d.mood).length || 1);
  const allFrict   = days.flatMap(d => d.frictions);
  const avgFrict   = allFrict.length ? allFrict.reduce((s,f)=>s+f.score,0)/allFrict.length : 0;
  const allPerf    = days.flatMap(d => d.performance);
  const perfOk     = allPerf.length ? allPerf.filter(p=>p.acceptable).length/allPerf.length : 1;
  const allAI      = days.flatMap(d => d.aiUsage);
  const aiHelpful  = allAI.length  ? allAI.filter(a=>a.helpful).length/allAI.length : 1;
  const escapesPer = days.length ? (state.escapes || []).filter(e => days.some(d => d.date === e.date)).length / days.length : 0;
  const crashCount = (state.crashes || []).filter(c => days.some(d => d.date === c.date)).length;
  const openCrashes = (state.crashes || []).filter(c => !c.resolved && days.some(d => d.date === c.date)).length;

  // Product Score (0–100)
  const moodScore    = Math.round((avgMood / 5) * 100);
  const frictionScore = Math.round(Math.max(0, 100 - avgFrict * 10));
  const perfScore    = Math.round(perfOk * 100);
  const aiScore      = Math.round(aiHelpful * 100);
  const escapeScore  = Math.round(Math.max(0, 100 - escapesPer * 20));
  const crashScore   = Math.round(Math.max(0, 100 - openCrashes * 15));

  const weights = { mood: 0.20, friction: 0.25, perf: 0.15, ai: 0.15, escape: 0.15, crash: 0.10 };
  const overall  = Math.round(
    moodScore    * weights.mood    +
    frictionScore * weights.friction +
    perfScore    * weights.perf    +
    aiScore      * weights.ai      +
    escapeScore  * weights.escape  +
    crashScore   * weights.crash
  );

  const signals = { moodScore, frictionScore, perfScore, aiScore, escapeScore, crashScore };

  return {
    score:        overall,
    daysLogged:   days.length,
    avgMood:      Math.round(avgMood * 10) / 10,
    totalFrictions: allFrict.length,
    avgFrictionScore: Math.round(avgFrict * 10) / 10,
    escapeCount:  (state.escapes || []).filter(e => days.some(d => d.date === e.date)).length,
    escapesPerDay: Math.round(escapesPer * 10) / 10,
    crashCount,
    openCrashes,
    aiInteractions: allAI.length,
    aiHelpfulRate: Math.round(aiHelpful * 100),
    signals,
    days: days.map(d => ({
      date:           d.date,
      mood:           d.mood,
      frictions:      d.frictions.length,
      avgFriction:    d.frictions.length ? Math.round(d.frictions.reduce((s,f)=>s+f.score,0)/d.frictions.length*10)/10 : null,
      aiInteractions: d.aiUsage.length,
      perfSamples:    d.performance.length,
      narrative:      d.narrative.slice(0, 120),
    })),
  };
}

// ── Launch Confidence & Ship Recommendation ───────────────────────────────────

function getLaunchConfidence() {
  const weekly  = getWeeklyScore();
  const crashes = getCrashes({ resolved: false });
  const allFrict = Object.values((_load()).days || {}).flatMap(d => d.frictions);
  const highFrict = allFrict.filter(f => f.score >= 8).length;

  const score  = weekly.score || 50;
  const escapes = weekly.escapeCount || 0;
  const open   = crashes.length;

  let confidence = score;
  confidence -= open * 5;
  confidence -= highFrict * 2;
  confidence -= escapes * 1;
  confidence  = Math.min(100, Math.max(0, Math.round(confidence)));

  let recommendation, rationale, blockers = [];

  if (open > 0) blockers.push(`${open} unresolved crash(es)`);
  if (highFrict > 5) blockers.push(`${highFrict} high-severity frictions (score ≥8)`);
  if (escapes > 20) blockers.push(`${escapes} escapes — too many features missing`);

  if (confidence >= 85 && blockers.length === 0) {
    recommendation = "GO";
    rationale      = `Product score ${score}/100, ${confidence}% confidence. No critical blockers.`;
  } else if (confidence >= 65) {
    recommendation = "CONDITIONAL GO";
    rationale      = `Product score ${score}/100, ${confidence}% confidence. Clear blockers before launch.`;
  } else {
    recommendation = "NOT YET";
    rationale      = `Product score ${score}/100, ${confidence}% confidence. Significant gaps remain.`;
  }

  return {
    confidence,
    recommendation,
    rationale,
    blockers,
    weeklyScore: score,
    openCrashes: open,
    highFrictions: highFrict,
    totalEscapes: escapes,
    daysLogged: weekly.daysLogged,
  };
}

// ── Summary (all 10 deliverables) ────────────────────────────────────────────

function getFullReport(date) {
  const d       = date || _today();
  const state   = _load();
  const day     = _getDay(state, d);
  const weekly  = getWeeklyScore();
  const launch  = getLaunchConfidence();

  return {
    // 1
    journal:      day,
    // 2
    escapeLog:    getEscapes({ date: d }),
    // 3
    crashLog:     getCrashes({ date: d }),
    // 4
    perfLog:      getPerfLog(d),
    // 5
    aiReport:     getAIReport(d),
    // 6
    creditReport: getCreditReport(d),
    // 7
    top20Frictions: getTop20Frictions(d),
    // 8
    weeklyScore:  weekly,
    // 9
    launchConfidence: launch.confidence,
    // 10
    shipRecommendation: launch,
  };
}

// ── List all journal dates ────────────────────────────────────────────────────

function listDays() {
  const state = _load();
  return Object.keys(state.days).sort().reverse().map(date => {
    const d = state.days[date];
    return {
      date,
      sealed:         d.sealed,
      mood:           d.mood,
      frictions:      d.frictions.length,
      aiInteractions: d.aiUsage.length,
      escapes:        (state.escapes || []).filter(e => e.date === date).length,
      crashes:        (state.crashes || []).filter(c => c.date === date).length,
      narrative:      d.narrative.slice(0, 80),
    };
  });
}

module.exports = {
  // day
  getDay, updateNarrative, sealDay, listDays,
  // escape
  logEscape, getEscapes,
  // crash
  logCrash, resolveCrash, getCrashes,
  // perf
  logPerf, getPerfLog,
  // AI
  logAIUsage, getAIReport,
  // credits
  logCreditUsage, getCreditReport,
  // friction
  logFriction, getTop20Frictions,
  // scores
  getWeeklyScore, getLaunchConfidence,
  // full
  getFullReport,
};
