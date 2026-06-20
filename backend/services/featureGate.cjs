"use strict";
/**
 * Feature Gate Engine — every premium feature checks license here.
 * Zero hardcoded checks in feature code — all gates defined in this file.
 *
 * Usage:
 *   const { checkGate } = require("./featureGate.cjs");
 *   const result = checkGate("coding.review", plan, status);
 *   if (!result.allowed) return res.status(402).json({ ...result });
 *
 * Gate registry:
 *   Each gate: { plans: string[], gracePeriod: bool, message: string }
 *   plans: which plans include this feature (empty = public / all)
 */

const GATES = {
  // ── Editor features ───────────────────────────────────────────
  "editor.basic":          { plans: ["trial","starter","growth","scale"], grace: true  },
  "editor.ai_pair":        { plans: ["trial","starter","growth","scale"], grace: true  },
  "editor.inline_diff":    { plans: ["trial","starter","growth","scale"], grace: true  },
  "editor.lsp":            { plans: ["starter","growth","scale"],         grace: false },
  "editor.git_blame":      { plans: ["starter","growth","scale"],         grace: false },
  "editor.test_gen":       { plans: ["starter","growth","scale"],         grace: false },

  // ── AI features ───────────────────────────────────────────────
  "ai.chat":               { plans: ["trial","starter","growth","scale"], grace: true  },
  "ai.repo_chat":          { plans: ["starter","growth","scale"],         grace: true  },
  "ai.coding_ask":         { plans: ["trial","starter","growth","scale"], grace: true  },
  "ai.code_review":        { plans: ["starter","growth","scale"],         grace: false },
  "ai.byok":               { plans: ["growth","scale"],                   grace: false },
  "ai.local_models":       { plans: ["growth","scale"],                   grace: false },
  "ai.custom_model":       { plans: ["scale"],                            grace: false },

  // ── Mission features ──────────────────────────────────────────
  "mission.create":        { plans: ["trial","starter","growth","scale"], grace: true  },
  "mission.pipeline":      { plans: ["starter","growth","scale"],         grace: false },
  "mission.autonomous":    { plans: ["growth","scale"],                   grace: false },
  "mission.team":          { plans: ["scale"],                            grace: false },

  // ── Git features ──────────────────────────────────────────────
  "git.visual":            { plans: ["starter","growth","scale"],         grace: false },
  "git.push_workflow":     { plans: ["starter","growth","scale"],         grace: false },
  "git.blame":             { plans: ["starter","growth","scale"],         grace: false },

  // ── Pipeline features ─────────────────────────────────────────
  "pipeline.run":          { plans: ["starter","growth","scale"],         grace: false },
  "pipeline.autonomous":   { plans: ["growth","scale"],                   grace: false },
  "pipeline.deploy":       { plans: ["growth","scale"],                   grace: false },

  // ── Plugin features ───────────────────────────────────────────
  "plugins.install":       { plans: ["growth","scale"],                   grace: false },
  "plugins.marketplace":   { plans: ["starter","growth","scale"],         grace: false },

  // ── Team features ─────────────────────────────────────────────
  "team.members":          { plans: ["scale"],                            grace: false },
  "team.orgs":             { plans: ["scale"],                            grace: false },

  // ── Analytics / admin ─────────────────────────────────────────
  "analytics.workspace":   { plans: ["growth","scale"],                   grace: false },
  "analytics.cost":        { plans: ["growth","scale"],                   grace: false },
  "admin.console":         { plans: ["growth","scale"],                   grace: false },
  "admin.dashboard":       { plans: ["scale"],                            grace: false },
};

/**
 * Check if a feature is accessible given the current billing state.
 *
 * @param {string} featureId   e.g. "editor.lsp"
 * @param {string} plan        e.g. "trial" | "starter" | "growth" | "scale"
 * @param {string} status      e.g. "trialing" | "active" | "expired" | "cancelled"
 * @returns {{ allowed: bool, reason: string, upgradeRequired: string|null }}
 */
function checkGate(featureId, plan, status) {
  const gate = GATES[featureId];

  // Unknown gate = open (fail-open for unknown features)
  if (!gate) return { allowed: true, reason: "unknown_gate_open", upgradeRequired: null };

  // Cancelled / expired: only allow gracePeriod gates
  if (status === "cancelled" || (status === "expired" && !gate.grace)) {
    return { allowed: false, reason: "account_inactive", upgradeRequired: _minPlan(gate.plans), featureId };
  }

  // Check plan membership
  if (!gate.plans.includes(plan)) {
    const minPlan = _minPlan(gate.plans);
    return {
      allowed: false,
      reason: `requires_${minPlan}_or_higher`,
      upgradeRequired: minPlan,
      featureId,
      message: `This feature requires the ${_capitalise(minPlan)} plan or higher.`,
    };
  }

  return { allowed: true, reason: "plan_entitlement", upgradeRequired: null };
}

/**
 * List all features accessible for a given plan.
 */
function listEntitlements(plan) {
  return Object.entries(GATES)
    .filter(([, g]) => g.plans.includes(plan))
    .map(([id]) => id);
}

/**
 * Express middleware — gates a route on a feature.
 * Usage: router.get("/foo", requireFeature("editor.lsp"), handler)
 */
function requireFeature(featureId) {
  const billingService = require("./billingService");
  return (req, res, next) => {
    const accountId = req.user?.accountId || req.user?.id;
    if (!accountId) return res.status(401).json({ error: "Not authenticated" });
    const access = billingService.checkAccess(accountId);
    const plan   = access.plan || "trial";
    const result = checkGate(featureId, plan, access.status);
    if (!result.allowed) {
      return res.status(402).json({
        error: "feature_gated",
        featureId,
        ...result,
      });
    }
    req.featurePlan = plan;
    next();
  };
}

/**
 * All gates (for admin dashboard).
 */
function getAllGates() {
  return Object.entries(GATES).map(([id, g]) => ({ id, ...g }));
}

function _minPlan(plans) {
  const ORDER = ["trial", "starter", "growth", "scale"];
  return plans.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] || "starter";
}

function _capitalise(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

module.exports = { checkGate, listEntitlements, requireFeature, getAllGates, GATES };
