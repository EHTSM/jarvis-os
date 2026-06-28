"use strict";
/**
 * founderWorkRegistry.cjs — POST-Ω Sprint P2
 *
 * Builds and maintains the Founder Work Registry:
 * every manual workflow the founder must currently perform,
 * classified and tracked for elimination.
 *
 * Classification:
 *   Class A — Fully Automatable (no human needed once implemented)
 *   Class B — Approval Required (human approves, platform executes)
 *   Class C — Physical / Legal only (must remain human)
 */

"use strict";
const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/founder-work-registry.json");

// ── Lazy service accessors ─────────────────────────────────────────────────────
const _try = fn => { try { return fn(); } catch { return null; } };
const _co2 = () => _try(() => require("./co2FounderOps.cjs"));
const _inf = () => _try(() => require("./productionInfra.cjs"));
const _ast = () => _try(() => require("./autonomousState.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _op1 = () => _try(() => require("./op1PublicLaunch.cjs"));

// ── Master workflow catalogue ─────────────────────────────────────────────────
// Each entry describes one unit of founder manual work.
// This is the ground truth — updated by runRegistryBuild() and markAutomated().

const WORKFLOW_CATALOGUE = [

  // ── DOMAIN: Deployment ──────────────────────────────────────────────────────
  {
    id: "wf_deploy_vps_provision",
    domain: "deployment",
    workflow: "Provision VPS server (Ubuntu 22.04+)",
    manualSteps: ["Log into hosting provider", "Select plan", "Create server", "Note IP", "SSH in to verify"],
    estimatedMinutes: 20,
    class: "B",
    feasibility: 0.7,
    blockers: ["Requires hosting provider API key (DigitalOcean/Hetzner/Linode)"],
    requiredApprovals: ["founder_confirms_plan_and_cost"],
    targetLevel: "semi-auto",
    implementationPlan: "Use DigitalOcean API to provision Droplet on approval; record IP to .env",
    automatedBy: null,
  },
  {
    id: "wf_deploy_env_config",
    domain: "deployment",
    workflow: "Configure .env file on server",
    manualSteps: ["SSH to server", "Create /opt/jarvis-os/.env", "Copy 15+ env vars from local", "Verify no placeholders remain"],
    estimatedMinutes: 15,
    class: "B",
    feasibility: 0.9,
    blockers: [],
    requiredApprovals: ["founder_confirms_secret_values"],
    targetLevel: "semi-auto",
    implementationPlan: "productionInfra audit → flag missing vars → founder approves values → scp .env to server",
    automatedBy: null,
  },
  {
    id: "wf_deploy_nginx",
    domain: "deployment",
    workflow: "Install and configure Nginx with SSL",
    manualSteps: ["apt install nginx", "Copy nginx.conf", "certbot --nginx", "Test HTTPS", "Enable rate limits"],
    estimatedMinutes: 30,
    class: "A",
    feasibility: 0.95,
    blockers: ["Domain must already point to server IP"],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "Deploy bash script: apt install → copy template nginx.conf → certbot → systemctl reload",
    automatedBy: null,
  },
  {
    id: "wf_deploy_pm2",
    domain: "deployment",
    workflow: "Start application with PM2 and configure startup",
    manualSteps: ["npm install --omit=dev", "pm2 start ecosystem.config.cjs", "pm2 startup", "pm2 save"],
    estimatedMinutes: 10,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "Included in deploy.sh script — already partially automated",
    automatedBy: "deploy.sh",
  },
  {
    id: "wf_deploy_backup_cron",
    domain: "deployment",
    workflow: "Configure daily backup cron job",
    manualSteps: ["crontab -e", "Add backup.sh entry", "Verify first run"],
    estimatedMinutes: 5,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "Add crontab line in deploy.sh: 0 2 * * * /opt/jarvis-os/backup.sh",
    automatedBy: null,
  },
  {
    id: "wf_deploy_security_harden",
    domain: "deployment",
    workflow: "Security hardening (UFW, Fail2Ban, SSH keys)",
    manualSteps: ["ufw enable", "ufw allow 22/80/443", "apt install fail2ban", "Disable SSH password auth", "Disable root login"],
    estimatedMinutes: 20,
    class: "A",
    feasibility: 0.95,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "harden.sh script: ufw rules + fail2ban config + sshd_config patch + service restart",
    automatedBy: null,
  },

  // ── DOMAIN: Daily Operations ────────────────────────────────────────────────
  {
    id: "wf_ops_health_check",
    domain: "daily_ops",
    workflow: "Daily server health check",
    manualSteps: ["SSH to server", "Check pm2 status", "Check nginx", "Check disk space", "Check error logs"],
    estimatedMinutes: 10,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "continuousRuntimeObserver already runs health checks — expose daily digest to Slack/email",
    automatedBy: "continuousRuntimeObserver.cjs",
  },
  {
    id: "wf_ops_error_triage",
    domain: "daily_ops",
    workflow: "Triage production errors and exceptions",
    manualSteps: ["Check error logs", "Categorize errors", "Decide fix vs ignore", "Create bug ticket"],
    estimatedMinutes: 20,
    class: "B",
    feasibility: 0.85,
    blockers: [],
    requiredApprovals: ["founder_approves_critical_fixes"],
    targetLevel: "semi-auto",
    implementationPlan: "errorAnalyticsEngine detects → rootCauseAnalysis classifies → autoHeal or queue for founder",
    automatedBy: "selfHealingEngine.cjs",
  },
  {
    id: "wf_ops_backup_verify",
    domain: "daily_ops",
    workflow: "Verify daily backups completed successfully",
    manualSteps: ["SSH to server", "ls backup directory", "Check backup size", "Confirm last backup date"],
    estimatedMinutes: 5,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "backup.sh writes manifest → productionInfra reads manifest → alert if stale",
    automatedBy: null,
  },

  // ── DOMAIN: User / Customer ─────────────────────────────────────────────────
  {
    id: "wf_user_invite",
    domain: "user_ops",
    workflow: "Send beta user invite emails",
    manualSteps: ["Open email client", "Compose invite", "Attach invite code", "Send to each user"],
    estimatedMinutes: 30,
    class: "A",
    feasibility: 0.95,
    blockers: ["SMTP credentials required"],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "co3UserSuccess.sendBetaInvite() already implemented — trigger from /co3/invites endpoint",
    automatedBy: "co3UserSuccess.cjs",
  },
  {
    id: "wf_user_onboarding",
    domain: "user_ops",
    workflow: "Manually onboard first users (walkthrough / setup help)",
    manualSteps: ["Schedule call", "Walk through product", "Answer questions", "Follow up"],
    estimatedMinutes: 60,
    class: "B",
    feasibility: 0.7,
    blockers: ["Requires empathetic product context"],
    requiredApprovals: ["founder_schedules_call"],
    targetLevel: "semi-auto",
    implementationPlan: "onboardingEngine auto-generates onboarding flow; founder joins only for first 3 users",
    automatedBy: "onboardingEngine.cjs",
  },
  {
    id: "wf_user_feedback_triage",
    domain: "user_ops",
    workflow: "Read and categorize user feedback",
    manualSteps: ["Read feedback", "Tag by category", "Prioritize", "Create tickets"],
    estimatedMinutes: 30,
    class: "A",
    feasibility: 0.85,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "co3 feedback inbox → AI classify → business intelligence routes → decision engine",
    automatedBy: "co3UserSuccess.cjs",
  },
  {
    id: "wf_user_bug_response",
    domain: "user_ops",
    workflow: "Respond to user-reported bugs",
    manualSteps: ["Receive bug report", "Reproduce", "Classify severity", "Reply to user", "Fix or schedule"],
    estimatedMinutes: 45,
    class: "B",
    feasibility: 0.8,
    blockers: [],
    requiredApprovals: ["founder_approves_critical_severity"],
    targetLevel: "semi-auto",
    implementationPlan: "co3 crash reporting + rootCauseAnalysis → auto-reply with ETA → founder approves criticals",
    automatedBy: null,
  },

  // ── DOMAIN: Business / Revenue ──────────────────────────────────────────────
  {
    id: "wf_biz_plan_upgrade",
    domain: "business",
    workflow: "Process plan upgrade requests",
    manualSteps: ["Receive request", "Verify payment", "Upgrade account", "Send confirmation"],
    estimatedMinutes: 10,
    class: "A",
    feasibility: 1.0,
    blockers: ["Razorpay webhook must be configured"],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "Razorpay webhook → billingService.upgrade() → accountService.setPlan() — already wired",
    automatedBy: "billingService.cjs",
  },
  {
    id: "wf_biz_invoice_send",
    domain: "business",
    workflow: "Send monthly invoices",
    manualSteps: ["Generate invoice", "Email to customer", "Record in ledger"],
    estimatedMinutes: 15,
    class: "A",
    feasibility: 0.9,
    blockers: ["Razorpay generates invoices automatically on paid plans"],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "Razorpay handles invoice generation and email — zero founder action needed",
    automatedBy: "razorpay",
  },
  {
    id: "wf_biz_churn_detect",
    domain: "business",
    workflow: "Identify and respond to churning users",
    manualSteps: ["Check login recency", "Identify at-risk users", "Draft outreach", "Send email"],
    estimatedMinutes: 30,
    class: "B",
    feasibility: 0.85,
    blockers: [],
    requiredApprovals: ["founder_approves_outreach_copy"],
    targetLevel: "semi-auto",
    implementationPlan: "businessIntelligenceEngine detects churn signals → draft outreach → founder approves → auto-send",
    automatedBy: null,
  },
  {
    id: "wf_biz_revenue_report",
    domain: "business",
    workflow: "Generate weekly revenue report",
    manualSteps: ["Pull Razorpay data", "Compile metrics", "Write summary", "Share with self"],
    estimatedMinutes: 20,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "revenueOS executive dashboard already generates this — trigger weekly via autonomous scheduler",
    automatedBy: "revenueOS.cjs",
  },

  // ── DOMAIN: Content / Marketing ─────────────────────────────────────────────
  {
    id: "wf_mkt_social_post",
    domain: "marketing",
    workflow: "Write and post weekly social media updates",
    manualSteps: ["Write post", "Add image/video", "Schedule or post", "Monitor engagement"],
    estimatedMinutes: 45,
    class: "B",
    feasibility: 0.8,
    blockers: ["Requires social API access tokens"],
    requiredApprovals: ["founder_approves_post_copy"],
    targetLevel: "semi-auto",
    implementationPlan: "contentSEOEngine drafts post → founder approves → distributionEngine publishes",
    automatedBy: "contentSEOEngine.cjs",
  },
  {
    id: "wf_mkt_blog_post",
    domain: "marketing",
    workflow: "Write and publish blog post",
    manualSteps: ["Research topic", "Write draft", "Edit", "Publish", "Share"],
    estimatedMinutes: 120,
    class: "B",
    feasibility: 0.75,
    blockers: [],
    requiredApprovals: ["founder_approves_final_draft"],
    targetLevel: "semi-auto",
    implementationPlan: "contentSEOEngine generates draft from keyword research → founder reviews → auto-publish",
    automatedBy: "contentSEOEngine.cjs",
  },
  {
    id: "wf_mkt_email_campaign",
    domain: "marketing",
    workflow: "Send email newsletter / campaign",
    manualSteps: ["Write content", "Build list", "Configure sending", "Send", "Monitor opens"],
    estimatedMinutes: 60,
    class: "B",
    feasibility: 0.85,
    blockers: ["SMTP or SendGrid credentials required"],
    requiredApprovals: ["founder_approves_content"],
    targetLevel: "semi-auto",
    implementationPlan: "growthOS email engine drafts → founder approves → auto-send to segment",
    automatedBy: "growthOS.cjs",
  },

  // ── DOMAIN: Engineering ─────────────────────────────────────────────────────
  {
    id: "wf_eng_code_review",
    domain: "engineering",
    workflow: "Review and merge pull requests",
    manualSteps: ["Read diff", "Run tests", "Approve or request changes", "Merge"],
    estimatedMinutes: 30,
    class: "B",
    feasibility: 0.85,
    blockers: [],
    requiredApprovals: ["founder_final_approve_on_prod_changes"],
    targetLevel: "semi-auto",
    implementationPlan: "engineeringOrg code_review agent pre-reviews → scores risk → founder approves if risk > threshold",
    automatedBy: "engineeringOrg.cjs",
  },
  {
    id: "wf_eng_deploy_release",
    domain: "engineering",
    workflow: "Deploy new release to production",
    manualSteps: ["Tag release", "Run tests", "SSH to server", "git pull && npm install", "pm2 restart", "Verify health"],
    estimatedMinutes: 25,
    class: "B",
    feasibility: 0.95,
    blockers: [],
    requiredApprovals: ["founder_triggers_deploy"],
    targetLevel: "semi-auto",
    implementationPlan: "autonomousDeployment pipeline: test → build → deploy → health check → rollback on failure",
    automatedBy: "autonomousDeployment.cjs",
  },
  {
    id: "wf_eng_dependency_update",
    domain: "engineering",
    workflow: "Update npm dependencies",
    manualSteps: ["npm outdated", "Review changelogs", "Update", "Test", "Commit"],
    estimatedMinutes: 30,
    class: "B",
    feasibility: 0.8,
    blockers: [],
    requiredApprovals: ["founder_approves_major_updates"],
    targetLevel: "semi-auto",
    implementationPlan: "engineeringOrg dep_manager agent runs npm-check-updates → founder approves majors → auto-patch minors",
    automatedBy: "engineeringOrg.cjs",
  },

  // ── DOMAIN: Compliance / Legal ──────────────────────────────────────────────
  {
    id: "wf_legal_tos_update",
    domain: "legal",
    workflow: "Update Terms of Service or Privacy Policy",
    manualSteps: ["Draft changes", "Legal review", "Publish new version", "Notify users"],
    estimatedMinutes: 120,
    class: "C",
    feasibility: 0.1,
    blockers: ["Requires legal expertise and human judgment"],
    requiredApprovals: ["founder_and_legal_counsel"],
    targetLevel: "manual",
    implementationPlan: "Platform can draft and notify; final approval always manual",
    automatedBy: null,
  },
  {
    id: "wf_legal_tax_filing",
    domain: "legal",
    workflow: "Quarterly tax filing",
    manualSteps: ["Compile revenue data", "File with tax authority", "Pay"],
    estimatedMinutes: 240,
    class: "C",
    feasibility: 0.1,
    blockers: ["Requires accountant or legal review"],
    requiredApprovals: ["founder_and_accountant"],
    targetLevel: "manual",
    implementationPlan: "Platform can prepare revenue reports; filing remains human",
    automatedBy: null,
  },
  {
    id: "wf_legal_bank_account",
    domain: "legal",
    workflow: "Business banking and fund transfers",
    manualSteps: ["Log into bank", "Transfer funds", "Reconcile"],
    estimatedMinutes: 20,
    class: "C",
    feasibility: 0.0,
    blockers: ["Physical/financial — no API access to bank"],
    requiredApprovals: ["founder_only"],
    targetLevel: "manual",
    implementationPlan: "Cannot be automated. Track reconciliation reports via revenueOS.",
    automatedBy: null,
  },

  // ── DOMAIN: Product / UX ────────────────────────────────────────────────────
  {
    id: "wf_product_ux_review",
    domain: "product",
    workflow: "Weekly UX review of product",
    manualSteps: ["Open app", "Click through flows", "Note friction points", "Prioritize fixes"],
    estimatedMinutes: 30,
    class: "A",
    feasibility: 0.85,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "ODI continuousDesignObserver + UX optimizer runs automatically — generates weekly UX report",
    automatedBy: "continuousDesignObserver.cjs",
  },
  {
    id: "wf_product_a11y_check",
    domain: "product",
    workflow: "Accessibility audit",
    manualSteps: ["Open screen reader", "Tab through app", "Check contrast", "Fix issues"],
    estimatedMinutes: 45,
    class: "A",
    feasibility: 0.9,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "ODI accessibilityAuditor runs WCAG checks automatically on every deployment",
    automatedBy: "accessibilityAuditor.cjs",
  },

  // ── DOMAIN: Knowledge / Documentation ───────────────────────────────────────
  {
    id: "wf_docs_changelog",
    domain: "docs",
    workflow: "Write release changelog",
    manualSteps: ["Review commits", "Summarize changes", "Write changelog entry", "Publish"],
    estimatedMinutes: 20,
    class: "A",
    feasibility: 0.9,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "releaseEngine.cjs already generates changelog from commits — trigger on release tag",
    automatedBy: "releaseEngine.cjs",
  },
  {
    id: "wf_docs_api_docs",
    domain: "docs",
    workflow: "Update API documentation",
    manualSteps: ["Identify new routes", "Write descriptions", "Update README or Swagger"],
    estimatedMinutes: 30,
    class: "A",
    feasibility: 0.8,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "engineeringOrg docs agent generates from route definitions — runs on every commit",
    automatedBy: "engineeringOrg.cjs",
  },
  {
    id: "wf_docs_runbook",
    domain: "docs",
    workflow: "Maintain ops runbook / production bible",
    manualSteps: ["Identify new procedure", "Write steps", "Test steps", "Publish"],
    estimatedMinutes: 60,
    class: "A",
    feasibility: 0.8,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "productionBibleEngine converts checklist items to executable workflows automatically",
    automatedBy: "productionBibleEngine.cjs",
  },

  // ── DOMAIN: Self-Improvement ────────────────────────────────────────────────
  {
    id: "wf_self_weekly_review",
    domain: "self_improvement",
    workflow: "Weekly platform self-review",
    manualSteps: ["Run through checklist", "Score each dimension", "Write notes", "Plan next sprint"],
    estimatedMinutes: 60,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "selfReviewEngine.runReview() — already implemented in Sprint P1",
    automatedBy: "selfReviewEngine.cjs",
  },
  {
    id: "wf_self_consolidation_audit",
    domain: "self_improvement",
    workflow: "Monthly codebase consolidation audit",
    manualSteps: ["Scan for duplicates", "Identify dead code", "Document findings", "Plan cleanup sprint"],
    estimatedMinutes: 120,
    class: "A",
    feasibility: 1.0,
    blockers: [],
    requiredApprovals: [],
    targetLevel: "full-auto",
    implementationPlan: "consolidationAudit.runAudit() — already implemented in Sprint P1",
    automatedBy: "consolidationAudit.cjs",
  },
];

// ── Data layer ──────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { version: "1.0.0", generatedAt: new Date().toISOString(), summary: {}, workflows: [] }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function _computeSummary(workflows) {
  const classA = workflows.filter(w => w.class === "A").length;
  const classB = workflows.filter(w => w.class === "B").length;
  const classC = workflows.filter(w => w.class === "C").length;
  const automated = workflows.filter(w => w.automatedBy || w.targetLevel === "full-auto").length;
  const totalMinutes = workflows.reduce((s, w) => s + (w.estimatedMinutes || 0), 0);
  const savedMinutes = workflows.filter(w => w.automatedBy)
    .reduce((s, w) => s + (w.estimatedMinutes || 0), 0);
  return {
    total: workflows.length,
    classA, classB, classC,
    automatedCount: automated,
    totalMinutesSaved: savedMinutes,
    totalFounderMinutesPerWeek: totalMinutes,
    automationPct: Math.round((automated / (workflows.length || 1)) * 100),
  };
}

// ── Core API ──────────────────────────────────────────────────────────────────

function buildRegistry() {
  // Merge static catalogue with any dynamic detection from existing services
  const workflows = WORKFLOW_CATALOGUE.map(w => ({
    ...w,
    lastUpdated: new Date().toISOString(),
    executionHistory: [],
    status: w.automatedBy ? "automated" : w.class === "C" ? "manual_permanent" : "pending_automation",
  }));

  // Dynamic: check co2 deploy checklist for unchecked items
  try {
    const co2 = _co2();
    if (co2) {
      const ds = co2.getDeploymentState?.();
      if (ds) {
        for (const item of (ds.items || [])) {
          if (!item.done) {
            const existing = workflows.find(w => w.id === `wf_deploy_${item.id}`);
            if (!existing) {
              workflows.push({
                id: `wf_deploy_${item.id}`,
                domain: "deployment",
                workflow: item.label,
                manualSteps: [`Complete: ${item.label}`],
                estimatedMinutes: 5,
                class: item.critical ? "B" : "A",
                feasibility: 0.8,
                blockers: [],
                requiredApprovals: item.critical ? ["founder_confirms"] : [],
                targetLevel: item.critical ? "semi-auto" : "full-auto",
                implementationPlan: `Auto-execute: ${item.label}`,
                automatedBy: null,
                lastUpdated: new Date().toISOString(),
                executionHistory: [],
                status: "pending_automation",
              });
            }
          }
        }
      }
    }
  } catch {}

  const summary = _computeSummary(workflows);
  const registry = { version: "1.0.0", generatedAt: new Date().toISOString(), summary, workflows };
  _save(registry);
  return { ok: true, registry };
}

function getRegistry() {
  const d = _load();
  if (!d.workflows?.length) return buildRegistry().registry;
  return d;
}

function getWorkflow(id) {
  return _load().workflows?.find(w => w.id === id) || null;
}

function listWorkflows({ domain, classType, status, limit = 100 } = {}) {
  let list = _load().workflows || [];
  if (domain)    list = list.filter(w => w.domain === domain);
  if (classType) list = list.filter(w => w.class === classType);
  if (status)    list = list.filter(w => w.status === status);
  return list.slice(0, limit);
}

function markAutomated(workflowId, { automatedBy, evidence, minutesSaved }) {
  const d = _load();
  const w = d.workflows?.find(w => w.id === workflowId);
  if (!w) return { ok: false, error: `workflow ${workflowId} not found` };
  w.automatedBy = automatedBy;
  w.status = "automated";
  w.automatedAt = new Date().toISOString();
  w.evidence = evidence;
  if (minutesSaved !== undefined) w.estimatedMinutes = minutesSaved;
  d.summary = _computeSummary(d.workflows);
  _save(d);
  return { ok: true, workflow: w };
}

function recordExecution(workflowId, { outcome, durationMs, stepsExecuted, approvalRequired, notes }) {
  const d = _load();
  const w = d.workflows?.find(w => w.id === workflowId);
  if (!w) return { ok: false, error: "not found" };
  if (!w.executionHistory) w.executionHistory = [];
  w.executionHistory.push({ ts: new Date().toISOString(), outcome, durationMs, stepsExecuted, approvalRequired, notes });
  if (w.executionHistory.length > 20) w.executionHistory = w.executionHistory.slice(-20);
  w.lastExecutedAt = new Date().toISOString();
  _save(d);
  return { ok: true };
}

function getDashboard() {
  const d = getRegistry();
  const byClass = { A: [], B: [], C: [] };
  for (const w of (d.workflows || [])) {
    (byClass[w.class] || []).push(w);
  }
  return {
    summary: d.summary,
    byClass: {
      A: { count: byClass.A.length, automated: byClass.A.filter(w => w.automatedBy).length, workflows: byClass.A.map(w => ({ id: w.id, workflow: w.workflow, status: w.status, minutes: w.estimatedMinutes })) },
      B: { count: byClass.B.length, automated: byClass.B.filter(w => w.automatedBy).length, workflows: byClass.B.map(w => ({ id: w.id, workflow: w.workflow, status: w.status, minutes: w.estimatedMinutes })) },
      C: { count: byClass.C.length, workflows: byClass.C.map(w => ({ id: w.id, workflow: w.workflow, status: w.status, minutes: w.estimatedMinutes })) },
    },
    topBottlenecks: (d.workflows || [])
      .filter(w => !w.automatedBy && w.class !== "C")
      .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)
      .slice(0, 5)
      .map(w => ({ id: w.id, workflow: w.workflow, minutes: w.estimatedMinutes, class: w.class, blockers: w.blockers })),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildRegistry, getRegistry, getWorkflow, listWorkflows,
  markAutomated, recordExecution, getDashboard,
  WORKFLOW_CATALOGUE,
};
