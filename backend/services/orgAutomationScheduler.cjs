"use strict";
/**
 * orgAutomationScheduler.cjs — V5 Global AI Organization Platform,
 * Module 7: Organization Automation Center (scheduled-jobs half).
 *
 * automationService.cjs (the real K5 Enterprise Automation Service,
 * already used org-scoped by Modules 2/5/6 via orgId-as-workspaceId) has
 * a real "schedule" trigger type and real BUILT_IN_TEMPLATES that use it
 * (e.g. atpl_daily_health: cron "0 8 * * *") — but nothing in this
 * codebase actually reads a rule's trigger.cron and fires it when due
 * (confirmed by grepping every fireRule call site: all are
 * manual/webhook/event-triggered, none are scheduler-driven). This file
 * adds exactly that missing piece — real cron matching against the
 * already-installed node-cron package's own parser, driving the same
 * real automationService.fireRule() every other trigger path already
 * uses. No new execution engine, no new rule format, no new storage
 * beyond a tiny per-rule "last fired minute" cache (in-memory only,
 * intentionally not persisted — a missed fire after a restart just means
 * the next matching minute fires it, same tolerance as node-cron itself).
 *
 * Runs ONE recurring node-cron job (every minute) that enumerates every
 * real org via organizationService.listOrgs(), reads each org's real
 * schedule-type rules via automationService.getRules(orgId), and fires
 * whichever are due for the current minute — not one cron.schedule() per
 * rule, since rules are created/deleted dynamically across potentially
 * many orgs and node-cron has no API to reschedule a running job's
 * expression; a single dispatcher loop avoids that entirely.
 */

const cron = require("node-cron");

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _automation = () => _try(() => require("./automationService.cjs"));

// orgId::ruleId -> "YYYY-MM-DDTHH:MM" of the last minute it was fired, so a
// rule due for e.g. 08:00 doesn't refire on every scheduler tick within
// that same minute (the dispatcher tick itself runs once per minute, but
// this guard also protects against a future faster tick interval).
const _lastFiredMinute = new Map();

function _currentMinuteKey(date) {
  return date.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/** Real cron-field matching using node-cron's own parser — no
 * approximation, no hand-rolled cron grammar. */
function isDue(cronExpression, date) {
  let parsed;
  try { parsed = cron.parse(cronExpression); } catch { return false; }
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();
  return parsed.minute.includes(minute) &&
    parsed.hour.includes(hour) &&
    parsed.dayOfMonth.includes(dayOfMonth) &&
    parsed.month.includes(month) &&
    parsed.dayOfWeek.includes(dayOfWeek);
}

/** One dispatcher tick — real, callable directly (not only via the
 * node-cron wrapper below) so it can be tested deterministically against
 * a fixed date. */
async function runTick(now = new Date()) {
  const automation = _automation();
  const orgSvc = _org();
  if (!automation || !orgSvc) return { fired: [], scanned: 0 };

  const orgs = _try(() => orgSvc.listOrgs()) || { orgs: [] };
  const fired = [];
  let scanned = 0;

  const minuteKey = _currentMinuteKey(now);

  for (const orgSummary of orgs.orgs || []) {
    const orgId = orgSummary.id;
    const rules = _try(() => automation.getRules(orgId)) || [];
    for (const rule of rules) {
      if (rule.trigger?.type !== "schedule" || !rule.trigger?.cron) continue;
      if (!rule.enabled || rule.status !== "active") continue;
      scanned++;

      const guardKey = `${orgId}::${rule.id}`;
      if (_lastFiredMinute.get(guardKey) === minuteKey) continue;
      if (!isDue(rule.trigger.cron, now)) continue;

      _lastFiredMinute.set(guardKey, minuteKey);
      try {
        const result = await automation.fireRule(orgId, rule.id, { scheduledAt: now.toISOString() }, "system:scheduler");
        fired.push({ orgId, ruleId: rule.id, ruleName: rule.name, result });
      } catch (e) {
        fired.push({ orgId, ruleId: rule.id, ruleName: rule.name, error: e.message });
      }
    }
  }

  return { fired, scanned, tickAt: now.toISOString() };
}

let _cronTask = null;

/** Starts the real recurring dispatcher — every minute, matching cron's
 * own minute-level resolution. Idempotent: calling twice is a no-op.
 * Respects SKIP_PLATFORM_REGISTER=1 (the existing test-mode convention
 * used across this codebase — see companyLifecycleEngine.cjs's
 * _registerInPlatform — for "don't boot long-running timers under test"),
 * since this is exactly that kind of timer. */
function start() {
  if (process.env.SKIP_PLATFORM_REGISTER === "1") return { ok: true, skipped: true };
  if (_cronTask) return { ok: true, alreadyRunning: true };
  _cronTask = cron.schedule("* * * * *", () => {
    runTick().catch(() => { /* individual rule failures are already captured per-rule in runTick; a total failure here is non-fatal to the platform */ });
  });
  return { ok: true, alreadyRunning: false };
}

function stop() {
  if (!_cronTask) return { ok: true, wasRunning: false };
  _cronTask.stop();
  _cronTask = null;
  return { ok: true, wasRunning: true };
}

function getStatus() {
  return { running: !!_cronTask, trackedRules: _lastFiredMinute.size };
}

module.exports = { isDue, runTick, start, stop, getStatus };
