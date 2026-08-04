"use strict";
/**
 * Founder Assistant Engine — V6 Phase 8 (Personal JARVIS).
 *
 * Survey confirmed no unified personal-assistant chat entrypoint exists:
 * jarvisController.js's handleJarvis() is a business/WhatsApp gateway
 * (leads/payments/CRM), not founder-personal-context-aware; founderTwin.js
 * exposes decision/preference/prediction APIs but no chat interface pulling
 * twin + agenda + profile together. This composes those three real,
 * already-built subsystems into one system-prompt context and delegates
 * the actual model call to aiService.callAI — the same mechanism /ai/chat
 * already uses, not a new AI-calling path.
 */

function _try(fn, fallback) { try { return fn(); } catch { return fallback; } }

function _buildContext() {
  const twin    = _try(() => require("./digitalTwinEngine.cjs"), null);
  const profile = _try(() => require("./founderProfileEngine.cjs"), null);
  const planning = _try(() => require("./dailyPlanningEngine.cjs"), null);

  const twinDashboard = _try(() => twin?.getDashboard?.(), null);
  const profileData   = _try(() => profile?.getProfile?.(), null);
  const agenda        = _try(() => planning?.getAgenda?.(), null);

  return { twinDashboard, profileData, agenda };
}

function _formatContext({ twinDashboard, profileData, agenda }) {
  const lines = [];

  if (twinDashboard) {
    lines.push(`Digital Twin: trust score ${twinDashboard.trustScore}/100, ${twinDashboard.totalDecisions} decisions tracked (${twinDashboard.accuracy}% prediction accuracy), ${twinDashboard.founderRequired} pending decisions requiring founder input, ${twinDashboard.minutesSaved} minutes saved via automation.`);
  }

  if (profileData?.preferences) {
    const topPrefs = Object.entries(profileData.preferences)
      .filter(([, v]) => v && v.confidence > 0)
      .sort((a, b) => (b[1].confidence || 0) - (a[1].confidence || 0))
      .slice(0, 3)
      .map(([dim, v]) => `${dim} (score ${v.score?.toFixed(2)}, ${Math.round((v.confidence || 0) * 100)}% confidence from ${v.observations} observation(s))`);
    if (topPrefs.length) lines.push(`Known founder preferences: ${topPrefs.join("; ")}.`);
  }

  if (agenda) {
    const t = agenda.tasks || {};
    lines.push(`Today (${agenda.date}): ${t.overdue?.length || 0} overdue task(s), ${t.dueToday?.length || 0} due today, ${t.totalOpen || 0} open total. ${agenda.missionLoad?.active || 0} mission(s) actively executing.`);
    if (t.overdue?.length) lines.push(`Overdue: ${t.overdue.map(x => x.title).slice(0, 5).join("; ")}.`);
    if (t.dueToday?.length) lines.push(`Due today: ${t.dueToday.map(x => x.title).slice(0, 5).join("; ")}.`);
  }

  return lines.join("\n");
}

const SYSTEM_PREAMBLE = `You are the founder's personal assistant inside JARVIS-OS. You have live access to their Digital Twin (decision history, trust score, learned preferences) and their daily agenda (tasks, active missions). Use this real context to answer questions about their day, priorities, and patterns. Be concise and direct — this is a working founder, not a chat audience. If asked something outside this context, say so honestly rather than guessing.

Current real context:
`;

/**
 * ask(): the actual conversational entrypoint. Delegates to aiService's
 * real callAI — same mechanism as /ai/chat — with a system prompt built
 * from live twin/planning/profile data instead of a static persona.
 */
async function ask(prompt, { history } = {}) {
  if (!prompt) return { ok: false, error: "prompt required" };

  const ctx = _buildContext();
  const contextBlock = _formatContext(ctx);
  const system = SYSTEM_PREAMBLE + (contextBlock || "(no live context available)");

  const ai = require("./aiService.js");
  let reply;
  try {
    reply = await ai.callAI(prompt, { system, history });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return { ok: true, reply, contextUsed: Object.keys(ctx).filter(k => ctx[k] != null) };
}

/**
 * getBriefing(): a non-conversational daily summary — the same context
 * composition as ask(), but returned directly without a model call, for
 * UIs that want the raw facts rather than a generated paragraph.
 */
function getBriefing() {
  const ctx = _buildContext();
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: _formatContext(ctx),
    twin: ctx.twinDashboard,
    agenda: ctx.agenda,
  };
}

module.exports = { ask, getBriefing };
