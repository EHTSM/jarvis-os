"use strict";
/**
 * Customer Success Center — health scores, adoption tracking, risk alerts.
 *
 * Health score (0–100) from: onboarding completion, feature adoption,
 * login frequency, AI usage, billing status.
 *
 * Storage: data/customer-success.json
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/customer-success.json");

const HEALTH_WEIGHTS = {
  onboarding:  0.20,  // completed onboarding
  featureUse:  0.25,  // used ≥3 features
  loginFreq:   0.20,  // logged in this week
  aiUsage:     0.20,  // made AI requests
  billing:     0.15,  // on paid plan
};

const SUCCESS_TASKS = [
  { id: "complete_onboarding", label: "Complete onboarding",        priority: 1, trigger: s => !s.onboarding?.completed       },
  { id: "invite_team",         label: "Invite a team member",       priority: 2, trigger: s => !s.hasTeam                     },
  { id: "first_ai_request",    label: "Make your first AI request", priority: 2, trigger: s => (s.aiRequests || 0) < 1        },
  { id: "upgrade_plan",        label: "Upgrade to Starter",         priority: 3, trigger: s => s.plan === "trial"             },
  { id: "setup_brand",         label: "Create a Brand Kit",         priority: 3, trigger: s => !s.hasBrandKit                 },
  { id: "first_automation",    label: "Run a browser automation",   priority: 4, trigger: s => !s.hasAutomation               },
];

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function computeHealth(signals = {}) {
  let score = 0;
  score += (signals.onboarding?.completed ? 1 : 0)        * HEALTH_WEIGHTS.onboarding * 100;
  score += (Math.min(signals.featureCount || 0, 3) / 3)  * HEALTH_WEIGHTS.featureUse  * 100;
  score += (signals.loggedInWeek ? 1 : 0)                 * HEALTH_WEIGHTS.loginFreq   * 100;
  score += (Math.min(signals.aiRequests || 0, 10) / 10)  * HEALTH_WEIGHTS.aiUsage     * 100;
  score += (signals.plan !== "trial" ? 1 : 0)             * HEALTH_WEIGHTS.billing      * 100;
  return Math.round(score);
}

function updateSignals(accountId, signals = {}) {
  const store = _load();
  const prev  = store[accountId] || {};
  const next  = { ...prev, ...signals, accountId, updatedAt: new Date().toISOString() };
  next.healthScore  = computeHealth(next);
  next.riskLevel    = next.healthScore < 30 ? "high" : next.healthScore < 60 ? "medium" : "low";
  store[accountId]  = next;
  _save(store);
  return next;
}

function getHealth(accountId) {
  const store = _load();
  const s     = store[accountId] || {};
  const score = s.healthScore ?? computeHealth(s);
  const tasks = SUCCESS_TASKS.filter(t => t.trigger(s)).slice(0, 5);
  const risk  = score < 30 ? "high" : score < 60 ? "medium" : "low";
  return { accountId, healthScore: score, riskLevel: risk, tasks, signals: s };
}

function getRiskAlerts() {
  const store  = _load();
  const alerts = [];
  for (const [accountId, s] of Object.entries(store)) {
    const score = s.healthScore ?? computeHealth(s);
    if (score < 40) {
      alerts.push({ accountId, healthScore: score, risk: "high", reason: "Low engagement", updatedAt: s.updatedAt });
    }
  }
  return alerts.sort((a, b) => a.healthScore - b.healthScore).slice(0, 50);
}

function getOverview() {
  const store  = _load();
  const all    = Object.values(store);
  const scores = all.map(s => s.healthScore ?? computeHealth(s));
  const avg    = scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : 0;
  return {
    totalAccounts:  all.length,
    avgHealthScore: avg,
    highRisk:       scores.filter(s => s < 30).length,
    mediumRisk:     scores.filter(s => s >= 30 && s < 60).length,
    healthy:        scores.filter(s => s >= 60).length,
  };
}

module.exports = { computeHealth, updateSignals, getHealth, getRiskAlerts, getOverview, SUCCESS_TASKS };
