"use strict";
/**
 * approvalPolicy.cjs — POST-Ω Sprint P4
 *
 * Determines the approval type, risk level, and required approvers for any
 * workflow or action. Supports three tiers:
 *
 *   AUTO_APPROVE  — low-risk, no human needed
 *   FOUNDER       — single founder tap
 *   MULTI         — multiple approvers (for critical/irreversible operations)
 *
 * Also maps each Class B workflow to a concrete approval TYPE so the approval
 * package can tell the founder exactly what they're approving and why.
 *
 * Approval Types:
 *   DEPLOY_CONFIRM    — confirm a deployment step
 *   SECRET_CONFIRM    — confirm secret/credential values before use
 *   COST_CONFIRM      — confirm spend (VPS plan, paid API etc.)
 *   CONTENT_APPROVE   — approve outbound content (social/blog/email)
 *   CODE_APPROVE      — approve code change going to production
 *   DNS_CONFIRM       — confirm DNS record change
 *   SSL_CONFIRM       — confirm SSL certificate operation
 *   PAYMENT_CONFIRM   — confirm payment action
 *   OAUTH_CONFIRM     — confirm OAuth authorization
 *   OUTREACH_APPROVE  — approve user-facing outreach
 *   RELEASE_APPROVE   — approve production release
 *   SEVERITY_CONFIRM  — confirm critical bug severity classification
 *   GENERIC           — catch-all
 */

"use strict";

// ── Risk levels ───────────────────────────────────────────────────────────────
const RISK = {
  LOW:      "low",      // reversible, no external effect, no cost
  MEDIUM:   "medium",   // some external effect or cost < $10
  HIGH:     "high",     // significant external effect or cost, hard to reverse
  CRITICAL: "critical", // irreversible, regulatory, or large cost
};

// ── Approval types ────────────────────────────────────────────────────────────
const APPROVAL_TYPE = {
  DEPLOY_CONFIRM:   "DEPLOY_CONFIRM",
  SECRET_CONFIRM:   "SECRET_CONFIRM",
  COST_CONFIRM:     "COST_CONFIRM",
  CONTENT_APPROVE:  "CONTENT_APPROVE",
  CODE_APPROVE:     "CODE_APPROVE",
  DNS_CONFIRM:      "DNS_CONFIRM",
  SSL_CONFIRM:      "SSL_CONFIRM",
  PAYMENT_CONFIRM:  "PAYMENT_CONFIRM",
  OAUTH_CONFIRM:    "OAUTH_CONFIRM",
  OUTREACH_APPROVE: "OUTREACH_APPROVE",
  RELEASE_APPROVE:  "RELEASE_APPROVE",
  SEVERITY_CONFIRM: "SEVERITY_CONFIRM",
  GENERIC:          "GENERIC",
};

// ── Workflow → policy mapping ─────────────────────────────────────────────────
const WORKFLOW_POLICY = {
  // Deployment
  wf_deploy_vps_provision:    { type: APPROVAL_TYPE.COST_CONFIRM,    risk: RISK.HIGH,     tier: "FOUNDER",  ttlMs: 3600000,  autoApproveThreshold: null },
  wf_deploy_env_config:       { type: APPROVAL_TYPE.SECRET_CONFIRM,  risk: RISK.HIGH,     tier: "FOUNDER",  ttlMs: 3600000,  autoApproveThreshold: null },
  wf_eng_deploy_release:      { type: APPROVAL_TYPE.RELEASE_APPROVE, risk: RISK.HIGH,     tier: "FOUNDER",  ttlMs: 7200000,  autoApproveThreshold: null },
  wf_eng_code_review:         { type: APPROVAL_TYPE.CODE_APPROVE,    risk: RISK.MEDIUM,   tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: 0.95 },
  wf_eng_dependency_update:   { type: APPROVAL_TYPE.CODE_APPROVE,    risk: RISK.MEDIUM,   tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: null },

  // Operations
  wf_ops_error_triage:        { type: APPROVAL_TYPE.SEVERITY_CONFIRM, risk: RISK.MEDIUM,  tier: "FOUNDER",  ttlMs: 3600000,  autoApproveThreshold: 0.9 },

  // User ops
  wf_user_onboarding:         { type: APPROVAL_TYPE.GENERIC,          risk: RISK.LOW,     tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: null },
  wf_user_bug_response:       { type: APPROVAL_TYPE.SEVERITY_CONFIRM, risk: RISK.MEDIUM,  tier: "FOUNDER",  ttlMs: 3600000,  autoApproveThreshold: 0.85 },

  // Business
  wf_biz_churn_detect:        { type: APPROVAL_TYPE.OUTREACH_APPROVE, risk: RISK.MEDIUM,  tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: null },

  // Marketing
  wf_mkt_social_post:         { type: APPROVAL_TYPE.CONTENT_APPROVE,  risk: RISK.MEDIUM,  tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: null },
  wf_mkt_blog_post:           { type: APPROVAL_TYPE.CONTENT_APPROVE,  risk: RISK.LOW,     tier: "FOUNDER",  ttlMs: 172800000,autoApproveThreshold: null },
  wf_mkt_email_campaign:      { type: APPROVAL_TYPE.CONTENT_APPROVE,  risk: RISK.MEDIUM,  tier: "FOUNDER",  ttlMs: 86400000, autoApproveThreshold: null },
};

// ── Deploy checklist items (all DEPLOY_CONFIRM, low-medium risk) ──────────────
const DEPLOY_ITEM_IDS = [
  "vps_provisioned","node_installed","repo_cloned","deps_installed","env_configured",
  "pm2_started","pm2_startup","backend_health","frontend_built","frontend_served",
  "nginx_installed","nginx_configured","nginx_proxying","ssl_cert","ssl_auto_renew",
  "https_redirect","domain_a_record","domain_www","domain_api","domain_verified",
  "ufw_enabled","fail2ban_active","ssh_keys_only","backup_cron",
];
for (const id of DEPLOY_ITEM_IDS) {
  const risk   = ["ssl_cert","domain_a_record","ssh_keys_only"].includes(id) ? RISK.HIGH : RISK.MEDIUM;
  const ttl    = 3600000;
  const thresh = ["backend_health","pm2_started","nginx_proxying"].includes(id) ? 0.95 : null;
  WORKFLOW_POLICY[`wf_deploy_${id}`] = { type: APPROVAL_TYPE.DEPLOY_CONFIRM, risk, tier: "FOUNDER", ttlMs: ttl, autoApproveThreshold: thresh };
}

// ── Core API ──────────────────────────────────────────────────────────────────

function getPolicy(workflowId) {
  if (WORKFLOW_POLICY[workflowId]) return { ...WORKFLOW_POLICY[workflowId], workflowId };

  // Infer from id pattern
  if (workflowId.startsWith("wf_deploy_"))   return { type: APPROVAL_TYPE.DEPLOY_CONFIRM,  risk: RISK.MEDIUM, tier: "FOUNDER", ttlMs: 3600000, autoApproveThreshold: null, workflowId };
  if (workflowId.startsWith("wf_mkt_"))      return { type: APPROVAL_TYPE.CONTENT_APPROVE, risk: RISK.LOW,    tier: "FOUNDER", ttlMs: 86400000,autoApproveThreshold: null, workflowId };
  if (workflowId.startsWith("wf_eng_"))      return { type: APPROVAL_TYPE.CODE_APPROVE,    risk: RISK.MEDIUM, tier: "FOUNDER", ttlMs: 86400000,autoApproveThreshold: null, workflowId };
  if (workflowId.startsWith("wf_biz_"))      return { type: APPROVAL_TYPE.OUTREACH_APPROVE,risk: RISK.LOW,    tier: "FOUNDER", ttlMs: 86400000,autoApproveThreshold: null, workflowId };

  return { type: APPROVAL_TYPE.GENERIC, risk: RISK.MEDIUM, tier: "FOUNDER", ttlMs: 3600000, autoApproveThreshold: null, workflowId };
}

function shouldAutoApprove(workflowId, confidence = 0) {
  const pol = getPolicy(workflowId);
  if (pol.risk === RISK.LOW && pol.autoApproveThreshold !== null && confidence >= pol.autoApproveThreshold) return true;
  if (pol.risk === RISK.MEDIUM && pol.autoApproveThreshold !== null && confidence >= pol.autoApproveThreshold) return true;
  return false;
}

function getApprovalTier(workflowId) {
  return getPolicy(workflowId).tier;
}

function getRisk(workflowId) {
  return getPolicy(workflowId).risk;
}

function getTtlMs(workflowId) {
  return getPolicy(workflowId).ttlMs;
}

function listPolicies() {
  return Object.entries(WORKFLOW_POLICY).map(([id, p]) => ({ workflowId: id, ...p }));
}

module.exports = {
  RISK, APPROVAL_TYPE, WORKFLOW_POLICY,
  getPolicy, shouldAutoApprove, getApprovalTier, getRisk, getTtlMs, listPolicies,
};
