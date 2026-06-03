// Phase 811-812: Runtime health monitor.
// Consolidates failure prediction, resource pressure detection, dependency instability,
// stale-context detection, and execution trust validation into one bounded surface.
//
// All analysis: localStorage-only. No timers beyond visibility change.
// No external calls. No autonomous execution.
// Bounded: predictions capped at 6, staleness window 15min, storage 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY     = "jarvis_workflow_hist";
const FRICTION_KEY = "jarvis_friction_signals";
const EXEC_MEM_KEY = "jarvis_execution_memory";
const SNAPSHOT_KEY = "jarvis_health_snapshot";
const SNAP_TTL     = 24 * 60 * 60 * 1000;
const STALE_WINDOW = 15 * 60 * 1000;   // 15 min — beyond this, context is stale
const PRED_MAX     = 6;

// ── Storage helpers ──────────────────────────────────────────────────────────

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function _loadFriction() {
  try { return JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]"); } catch { return []; }
}

function _loadExecMem() {
  try { return JSON.parse(localStorage.getItem(EXEC_MEM_KEY) || "[]"); } catch { return []; }
}

// Phase 815: persist health snapshot for reconnect-safe restore
function _saveSnapshot(snap) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...snap, ts: Date.now() })); } catch {}
}

function _loadSnapshot() {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!raw || Date.now() - raw.ts > SNAP_TTL) return null;
    return raw;
  } catch { return null; }
}

// ── Phase 811: Execution trust validation ───────────────────────────────────
// Validates that the execution context is consistent: no stale checkpoints,
// no runaway failure rate, no replay state mismatch.

function _validateExecutionTrust(hist, friction) {
  const now = Date.now();
  const issues = [];
  let trustScore = 100;

  // Recent failure rate (last 15 min)
  const recent = hist.filter(h => (now - (h.ts || 0)) < STALE_WINDOW);
  const failRate = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100)
    : 0;

  if (failRate > 50) {
    issues.push({ id: "high_fail_rate", severity: "high", msg: `${failRate}% failure rate in last 15m`, trustImpact: 30 });
    trustScore -= 30;
  } else if (failRate > 25) {
    issues.push({ id: "elevated_fail_rate", severity: "medium", msg: `${failRate}% failure rate in last 15m`, trustImpact: 15 });
    trustScore -= 15;
  }

  // Stale context: last execution > 30 min ago but operator is likely resuming
  const lastEntry = hist[0];
  const lastTs = lastEntry?.ts || 0;
  const idleMin = Math.round((now - lastTs) / 60000);
  if (lastTs > 0 && idleMin > 30 && idleMin < 480) {
    issues.push({ id: "stale_context", severity: "low", msg: `Last execution ${idleMin}m ago — context may be stale`, trustImpact: 5 });
    trustScore -= 5;
  }

  // Reconnect storms — degrades execution trust
  const recentFriction = friction.filter(f => (now - (f.ts || 0)) < 10 * 60 * 1000);
  const reconnects = recentFriction.filter(f => f.type === "reconnect_event" || f.type === "reconnect_during_input").length;
  if (reconnects >= 3) {
    issues.push({ id: "reconnect_storm", severity: "high", msg: `${reconnects} reconnects in last 10m`, trustImpact: 20 });
    trustScore -= 20;
  } else if (reconnects >= 1) {
    issues.push({ id: "reconnect_noise", severity: "low", msg: `${reconnects} reconnect(s) in last 10m`, trustImpact: 5 });
    trustScore -= 5;
  }

  // Crash events
  const crashes = friction.filter(f => f.type === "crash" && (now - (f.ts || 0)) < 30 * 60 * 1000).length;
  if (crashes > 0) {
    issues.push({ id: "crash_recent", severity: "high", msg: `${crashes} crash event(s) in last 30m`, trustImpact: 25 });
    trustScore -= 25;
  }

  const score = Math.max(0, trustScore);
  const label = score >= 80 ? "TRUSTED" : score >= 55 ? "DEGRADED" : "UNSTABLE";
  const color = score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)";

  return { score, label, color, issues };
}

// ── Phase 812: Failure prediction ───────────────────────────────────────────
// Predicts likely upcoming failures from patterns in history + memory.
// Returns ranked predictions, capped at PRED_MAX.

function _predictFailures(hist, execMem) {
  const now = Date.now();
  const predictions = [];

  // Chronically failing commands that were run recently
  const cmdMap = {};
  hist.forEach(h => {
    if (!cmdMap[h.cmd]) cmdMap[h.cmd] = { total: 0, fails: 0, lastTs: 0 };
    cmdMap[h.cmd].total++;
    if (!h.ok) cmdMap[h.cmd].fails++;
    if ((h.ts || 0) > cmdMap[h.cmd].lastTs) cmdMap[h.cmd].lastTs = h.ts || 0;
  });

  Object.entries(cmdMap).forEach(([cmd, v]) => {
    if (v.total < 3) return;
    const failRate = v.fails / v.total;
    if (failRate < 0.4) return;
    const recentlyRun = (now - v.lastTs) < 60 * 60 * 1000; // within 1h
    if (!recentlyRun) return;

    predictions.push({
      id:         `chronic_fail_${cmd.slice(0, 20).replace(/\s/g, "_")}`,
      type:       "chronic_failure",
      cmd:        cmd.slice(0, 60),
      probability: Math.round(failRate * 100),
      severity:   failRate > 0.7 ? "high" : "medium",
      msg:        `"${cmd.slice(0, 40)}" fails ${Math.round(failRate * 100)}% of the time`,
      suggestion: "Check recent error output before dispatching again",
    });
  });

  // Resource pressure: disk/memory errors in recent history
  const resourceFails = hist
    .filter(h => !h.ok && (now - (h.ts || 0)) < 30 * 60 * 1000)
    .filter(h => /enospc|no space|out of memory|heap|enomem|killed/i.test(h.summary || h.output || ""));

  if (resourceFails.length >= 2) {
    predictions.push({
      id:         "resource_pressure",
      type:       "resource",
      probability: 80,
      severity:   "high",
      msg:        `${resourceFails.length} resource-related failures in last 30m`,
      suggestion: "Run: df -h && pm2 info to check disk and memory",
      cmd:        "df -h",
    });
  }

  // Dependency rot: npm/module errors in recent history
  const depFails = hist
    .filter(h => !h.ok && (now - (h.ts || 0)) < 60 * 60 * 1000)
    .filter(h => /cannot find module|module not found|npm err/i.test(h.summary || h.output || ""));

  if (depFails.length >= 1) {
    predictions.push({
      id:         "dependency_rot",
      type:       "dependency",
      probability: 75,
      severity:   "medium",
      msg:        `${depFails.length} missing-dependency failure(s) in last 1h`,
      suggestion: "Run: npm install to restore node_modules",
      cmd:        "npm install",
    });
  }

  // Stale context: if the last >3 commands were all to the same failing endpoint
  const last5Fails = hist.filter(h => !h.ok).slice(0, 5);
  if (last5Fails.length >= 3) {
    const cmds = last5Fails.map(h => (h.cmd || "").split(" ").slice(0, 2).join(" "));
    const unique = new Set(cmds);
    if (unique.size === 1) {
      predictions.push({
        id:         "retry_loop_risk",
        type:       "loop",
        probability: 85,
        severity:   "high",
        msg:        `Same command failing repeatedly — retry loop risk`,
        suggestion: "Try a diagnostic command first: pm2 logs --lines 20",
        cmd:        "pm2 logs --lines 20",
      });
    }
  }

  // Deduplicate + sort by probability + cap
  const seen = new Set();
  return predictions
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, PRED_MAX);
}

// ── Phase 816: Deployment confidence ────────────────────────────────────────
// Generates a deployment confidence report: score, blockers, readiness label.

function _deploymentConfidence(hist) {
  const now = Date.now();
  const WINDOW_30M = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < WINDOW_30M);

  // Check for failed deploys in recent window
  const failedDeploys = recent.filter(h =>
    !h.ok && /deploy|pm2 start|pm2 restart/i.test(h.cmd || "")
  );

  // Last successful backup
  const lastBackup = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;

  // Overall recent failure rate
  const recentFailRate = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100)
    : 0;

  let confidence = 100;
  const blockers = [];
  const signals = [];

  if (failedDeploys.length > 0) {
    confidence -= 35;
    blockers.push(`${failedDeploys.length} failed deployment(s) in last 30m`);
  }
  if (backupAgeMin === null) {
    confidence -= 25;
    blockers.push("No backup on record — create one before deploying");
  } else if (backupAgeMin > 120) {
    confidence -= 15;
    signals.push(`Backup is ${Math.floor(backupAgeMin / 60)}h old — consider refreshing`);
  } else {
    signals.push(`Backup available ${backupAgeMin}m ago`);
  }
  if (recentFailRate > 30) {
    confidence -= 20;
    blockers.push(`${recentFailRate}% failure rate in last 30m — stabilize before deploying`);
  }

  const score = Math.max(0, confidence);
  return {
    score,
    label:   score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW",
    color:   score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    blockers,
    signals,
  };
}

// ── Phase 819: Key isolation guard ──────────────────────────────────────────
// Verifies no cross-project key contamination on mount.
// Logs a single friction event if unexpected keys are found.

const OWNED_KEYS = new Set([
  "jarvis_workflow_hist", "jarvis_workflow_macros", "jarvis_workflow_chains",
  "jarvis_workflow_checkpoints", "jarvis_friction_signals", "jarvis_execution_memory",
  "jarvis_execution_graph", "jarvis_productivity_analytics", "jarvis_operator_input",
  "jarvis_operator_input_ts", "jarvis_debug_sessions", "jarvis_debug_dismissed",
  "jarvis_repo_nav_index", "jarvis_ea_memory", "jarvis_ea_dismissed", "jarvis_ea_session",
  "jarvis_install_state", "jarvis_update_state", "jarvis_operator_workspace",
  "jarvis_pinned_cmds", "jarvis_exec_bookmarks", "jarvis_exec_saved_filters",
  "jarvis_exec_history", "jarvis_workflow_execution_hist", "jarvis_sequential_workflows",
  "jarvis_biz_profile", "jarvis_started", "jarvis_support_session_id",
  "jarvis_last_wf_export", "jarvis_health_snapshot",
  // Phase 834: productivity workflow + recovery dedup keys
  "jarvis_pw_memory", "jarvis_pw_exec", "jarvis_recovery_dedup",
  // Phase 850: operator intelligence keys
  "jarvis_oi_memory", "jarvis_oi_session", "jarvis_oi_dismissed",
  // Phase 865: workflow automation keys
  "jarvis_wa_chains", "jarvis_wa_memory", "jarvis_wa_session", "jarvis_wa_dedup",
  // Phase 880: collaborative workflow keys
  "jarvis_cw_exports", "jarvis_cw_shared", "jarvis_cw_handoff", "jarvis_cw_imports",
  // Phase 886-900: public-beta preparation keys
  "jarvis_safe_defaults", "jarvis_defaults_override",
  "jarvis_onboarding",
  "jarvis_crash_log", "jarvis_diagnostics",
  "jarvis_migration_log", "jarvis_telemetry", "jarvis_telemetry_off",
  "jarvis_support_exports",
  "jarvis_env_validation",
  "jarvis_version_compat", "jarvis_replay_compat",
  "jarvis_pre_update_snapshot", "jarvis_build_id",
  // Phase 901-910: internal-beta operations keys
  "jarvis_daily_analytics", "jarvis_da_opt_out",
  "jarvis_productivity_scores",
  "jarvis_friction_state",
  "jarvis_bsi_session",
  "jarvis_failure_intel", "jarvis_multi_project_analytics",
  "jarvis_beta_survivability",
  // Phase 916-926: closed-beta release operations keys
  "jarvis_release_channel", "jarvis_feature_flags", "jarvis_rollout_state",
  "jarvis_beta_diagnostics", "jarvis_beta_recovery",
  // Phase 931-940: closed-beta UX evolution keys
  "jarvis_fse_state",
  "jarvis_wf_discoverability",
  "jarvis_contextual_help", "jarvis_help_projects",
  // Phase 946-960: public-MVP readiness keys
  "jarvis_account_profile", "jarvis_operator_id",
  "jarvis_ws_sync", "jarvis_api_access_log",
  "jarvis_hosted_boundaries", "jarvis_boundary_events",
  "jarvis_session_continuity", "jarvis_mvp_diagnostics",
  "jarvis_mvp_readiness", "jarvis_perf_samples",
  "jarvis_account_namespaces",
  // Phase 961-975: SaaS operational foundation keys
  "jarvis_subscription", "jarvis_usage_metering", "jarvis_team_workspace",
  "jarvis_cloud_sync", "jarvis_hosted_isolation", "jarvis_billing_state",
  "jarvis_saas_analytics", "jarvis_mwc_state",
  "jarvis_api_hardening", "jarvis_saas_perf",
  // Phase 976-990: Scaling + platform resilience keys
  "jarvis_heavy_session", "jarvis_runtime_load", "jarvis_queue_resilience",
  "jarvis_dist_continuity", "jarvis_infra_obs", "jarvis_scaling_analytics",
  "jarvis_runtime_isolation",
  // Phase 991-1005: Platform governance + security hardening keys
  "jarvis_governance", "jarvis_audit_log", "jarvis_security_events",
  "jarvis_approval_queue", "jarvis_op_policies",
  "jarvis_ws_isolation", "jarvis_gov_trust", "jarvis_gov_perf",
  // Phase 1006-1020: Enterprise operations foundation keys
  "jarvis_enterprise_org", "jarvis_compliance_log", "jarvis_audit_exports",
  "jarvis_deploy_chains", "jarvis_org_id",
  "jarvis_enterprise_isolation", "jarvis_enterprise_perf",
  // Phase 1021-1035: Ecosystem + integration foundation keys
  "jarvis_plugins", "jarvis_connectors", "jarvis_ecosystem_events",
  "jarvis_ecosystem_trust", "jarvis_eco_isolation", "jarvis_eco_perf",
  // Phase 1036-1050: Platform intelligence + productivity optimization keys
  "jarvis_prod_intelligence", "jarvis_bottlenecks", "jarvis_deploy_efficiency",
  "jarvis_workflow_accel", "jarvis_platform_obs", "jarvis_platform_obs_events",
  "jarvis_ws_prod_isolation", "jarvis_ws_profiles",
  // Phase 1051-1065: Daily-driver engineering experience keys
  "jarvis_daily_driver", "jarvis_dd_assistance", "jarvis_op_smoothness",
  "jarvis_dd_prod_obs", "jarvis_ux_isolation", "jarvis_dd_perf",
  "jarvis_dd_safety", "jarvis_ux_ws_profiles",
  // Phase 1066-1080: Production deployment + live operations keys
  "jarvis_prod_deployments", "jarvis_prod_incidents", "jarvis_prod_failovers",
  "jarvis_prod_ops_events", "jarvis_prod_rollbacks", "jarvis_prod_runtime_isolation",
  "jarvis_prod_perf_audit", "jarvis_prod_safety_audit", "jarvis_prod_readiness",
  // Phase 1081-1095: Autonomous-assisted engineering operations keys
  "jarvis_assisted_workflows", "jarvis_exec_recommendations", "jarvis_assist_approvals",
  "jarvis_assist_recovery", "jarvis_assist_isolation", "jarvis_assist_continuity",
  "jarvis_assist_perf_audit", "jarvis_assist_safety_audit", "jarvis_assist_readiness",
  // Phase 1111-1125: Public release preparation keys
  "jarvis_release_state", "jarvis_crash_reports", "jarvis_public_telemetry",
  "jarvis_support_exports", "jarvis_release_channels", "jarvis_onboarding_state",
  "jarvis_release_perf_audit", "jarvis_release_safety_audit", "jarvis_release_readiness",
  // Phase 1126-1140: Commercialization + SaaS operations keys
  "jarvis_saas_plan", "jarvis_saas_quota", "jarvis_saas_billing",
  "jarvis_saas_analytics", "jarvis_saas_lifecycle", "jarvis_tenant_isolation",
  "jarvis_saas_perf_audit", "jarvis_saas_safety_audit", "jarvis_saas_readiness",
  // Phase 1141-1155: Scale + multi-user live operations keys
  "jarvis_ws_coordination", "jarvis_scale_queue", "jarvis_collab_state",
  "jarvis_load_samples", "jarvis_scale_isolation",
  "jarvis_scale_perf_audit", "jarvis_scale_safety_audit", "jarvis_scale_readiness",
  // Phase 1156-1170: Ecosystem marketplace + workflow distribution keys
  "jarvis_marketplace_workflows", "jarvis_marketplace_plugins", "jarvis_marketplace_templates",
  "jarvis_marketplace_analytics", "jarvis_marketplace_moderation", "jarvis_marketplace_isolation",
  "jarvis_marketplace_trust", "jarvis_marketplace_perf_audit", "jarvis_marketplace_safety_audit",
  "jarvis_marketplace_readiness",
  // Phase 1171-1185: AI-powered engineering intelligence keys
  "jarvis_repo_intelligence", "jarvis_debug_patterns", "jarvis_deploy_risk",
  "jarvis_eng_memory", "jarvis_op_anomalies", "jarvis_eng_productivity",
  "jarvis_eng_intel_isolation", "jarvis_intel_perf_audit", "jarvis_intel_safety_audit",
  "jarvis_intel_readiness",
  // Phase 1201-1215: Cloud + distributed operations keys
  "jarvis_distributed_nodes", "jarvis_cloud_workspaces", "jarvis_remote_exec",
  "jarvis_distributed_replay", "jarvis_cloud_deployments", "jarvis_redundancy_state",
  "jarvis_region_isolation", "jarvis_dist_queue",
  "jarvis_dist_perf_audit", "jarvis_dist_safety_audit", "jarvis_dist_readiness",
  // Phase 1216-1230: Platform observability + self-healing operations keys
  "jarvis_obs_snapshots", "jarvis_infra_degradation", "jarvis_heal_recommendations",
  "jarvis_dist_diagnostics", "jarvis_recovery_state", "jarvis_resilience_forecast",
  "jarvis_obs_isolation",
  "jarvis_res_perf_audit", "jarvis_res_safety_audit", "jarvis_res_readiness",
  // Phase 1231-1245: Customer + organization operations keys
  "jarvis_orgs", "jarvis_org_onboarding", "jarvis_customer_health",
  "jarvis_support_escalations", "jarvis_enterprise_adoption",
  "jarvis_team_productivity", "jarvis_account_survivability", "jarvis_org_isolation",
  "jarvis_cust_perf_audit", "jarvis_cust_safety_audit", "jarvis_cust_readiness",
  // Phase 1246-1260: Growth + platform expansion operations keys
  "jarvis_growth_analytics", "jarvis_onboard_conversion", "jarvis_workflow_adopt_intel",
  "jarvis_retention_signals", "jarvis_ecosystem_expansion", "jarvis_platform_engagement",
  "jarvis_growth_forecast", "jarvis_growth_isolation",
  "jarvis_growth_perf_audit", "jarvis_growth_safety_audit", "jarvis_growth_readiness",
  // Phase 1261-1275: Platform execution + DevOps automation keys
  "jarvis_cicd_pipelines", "jarvis_infra_provisions", "jarvis_release_approvals",
  "jarvis_env_sync", "jarvis_build_survivability", "jarvis_devops_analytics",
  "jarvis_devops_isolation",
  "jarvis_devops_perf_audit", "jarvis_devops_safety_audit", "jarvis_devops_readiness",
  // Phase 1276-1290: Platform security + compliance operations keys
  "jarvis_audit_trail", "jarvis_threat_signals", "jarvis_security_anomalies",
  "jarvis_access_governance", "jarvis_compliance_state", "jarvis_secure_deployments",
  "jarvis_op_trust_hardening", "jarvis_security_reports", "jarvis_security_isolation",
  "jarvis_sec_perf_audit", "jarvis_sec_safety_audit", "jarvis_sec_readiness",
  // Phase 1291-1305: Platform reliability + incident operations keys
  "jarvis_incidents", "jarvis_outage_signals", "jarvis_incident_recovery",
  "jarvis_rollback_intel", "jarvis_op_continuity", "jarvis_reliability_forecast",
  "jarvis_incident_analytics", "jarvis_incident_isolation",
  "jarvis_rel_perf_audit", "jarvis_rel_safety_audit", "jarvis_rel_readiness",
  // Phase 1306-1320: Platform polish + execution excellence
  "jarvis_exec_smoothness", "jarvis_memory_efficiency", "jarvis_render_discipline",
  "jarvis_exec_consistency", "jarvis_platform_maturity",
  "jarvis_exec_perf_audit", "jarvis_exec_safety_audit", "jarvis_exec_readiness",
  // Phase 1321-1335: Public production + launch readiness
  "jarvis_installer_state", "jarvis_launch_onboarding", "jarvis_public_deployments",
  "jarvis_crash_survivability", "jarvis_release_channels", "jarvis_launch_telemetry",
  "jarvis_launch_support", "jarvis_launch_coordination", "jarvis_channel_isolation",
  "jarvis_launch_perf", "jarvis_launch_perf_audit", "jarvis_launch_safety_audit",
  "jarvis_launch_readiness",
  // Phase 1336-1350: Real-world product maturity + UX hardening
  "jarvis_first_session", "jarvis_product_stability", "jarvis_long_sessions",
  "jarvis_plugin_reliability", "jarvis_user_trust", "jarvis_session_isolation",
  "jarvis_usability_analytics", "jarvis_product_calmness",
  "jarvis_mat_perf_audit", "jarvis_mat_safety_audit", "jarvis_mat_readiness",
  // Phase 1351-1365: Scale + production operations maturity
  "jarvis_high_load_state", "jarvis_infra_scaling", "jarvis_scale_intelligence",
  "jarvis_support_scaling", "jarvis_multiuser_continuity", "jarvis_org_scale_workflows",
  "jarvis_platform_durability", "jarvis_tenant_isolation", "jarvis_scale_perf",
  "jarvis_scale_perf_audit", "jarvis_scale_safety_audit", "jarvis_scale_readiness",
  // Phase 1366-1380: Ecosystem + platform economy maturity
  "jarvis_workflow_economy", "jarvis_plugin_monetization", "jarvis_creator_ecosystem",
  "jarvis_op_collaboration", "jarvis_team_marketplace", "jarvis_revenue_survivability",
  "jarvis_ecosystem_governance", "jarvis_ecosystem_isolation", "jarvis_eco_perf",
  "jarvis_eco_perf_audit", "jarvis_eco_safety_audit", "jarvis_eco_readiness",
  // Phase 1381-1395: Global platform operations + infra maturity
  "jarvis_regional_deployments", "jarvis_regional_survivability", "jarvis_infra_redundancy",
  "jarvis_latency_intelligence", "jarvis_global_continuity", "jarvis_global_reliability_forecast",
  "jarvis_infra_analytics", "jarvis_region_iso_state", "jarvis_global_perf",
  "jarvis_glob_perf_audit", "jarvis_glob_safety_audit", "jarvis_glob_readiness",
  // Phase 1396-1410: Autonomous operational assistance + execution coordination
  "jarvis_op_copilot", "jarvis_exec_coordination", "jarvis_productivity_accel",
  "jarvis_contextual_assist", "jarvis_exec_recommendations", "jarvis_op_memory",
  "jarvis_multi_workflow", "jarvis_assist_trust", "jarvis_assist_isolation",
  "jarvis_assist_perf", "jarvis_assist2_perf_audit", "jarvis_assist2_safety_audit",
  "jarvis_assist2_readiness",
  // Phase 1411-1425: Public ecosystem + production deployment readiness
  "jarvis_prod_deploy_pipeline", "jarvis_pub_onboarding", "jarvis_eco_moderation",
  "jarvis_plugin_trust", "jarvis_pub_release", "jarvis_user_op_flows",
  "jarvis_pub_trust", "jarvis_pub_tenant_iso", "jarvis_pub_perf",
  "jarvis_pubeco_perf_audit", "jarvis_pubeco_safety_audit", "jarvis_pubeco_readiness",
  // Phase 1426-1440: Enterprise + organizational intelligence maturity
  "jarvis_ei_org_coord", "jarvis_ei_exec_obs", "jarvis_ei_biz_cont",
  "jarvis_ei_org_workflows", "jarvis_ei_prod_opt", "jarvis_ei_cross_team",
  "jarvis_ei_trust", "jarvis_ei_org_iso", "jarvis_ei_perf",
  "jarvis_ei_perf_audit", "jarvis_ei_safety_audit", "jarvis_ei_readiness",
  // Phase 1441-1455: Production rollout + platform polish excellence
  "jarvis_pr_rollout", "jarvis_pr_onboarding", "jarvis_pr_trust",
  "jarvis_pr_plugin_quality", "jarvis_pr_support", "jarvis_pr_eco_stability",
  "jarvis_pr_tenant_iso", "jarvis_pr_perf",
  "jarvis_pr_perf_audit", "jarvis_pr_safety_audit", "jarvis_pr_readiness",
  // Phase 1456-1470: Launch execution + monetization maturity
  "jarvis_mi_subscriptions", "jarvis_mi_creator_revenue", "jarvis_mi_transactions",
  "jarvis_mi_billing", "jarvis_mi_biz_intel", "jarvis_mi_growth",
  "jarvis_mi_rev_surv", "jarvis_mi_billing_iso", "jarvis_mi_perf",
  "jarvis_mi_perf_audit", "jarvis_mi_safety_audit", "jarvis_mi_readiness",
  // Phase 1471-1485: Real-world launch operations + deployment readiness
  "jarvis_lo_infra", "jarvis_lo_stability", "jarvis_lo_mobile",
  "jarvis_lo_observability", "jarvis_lo_support", "jarvis_lo_incidents",
  "jarvis_lo_launch_surv", "jarvis_lo_runtime_iso", "jarvis_lo_perf",
  "jarvis_lo_perf_audit", "jarvis_lo_safety_audit", "jarvis_lo_readiness",
  // Phase 1486-1500: Final deployment + public release execution
  "jarvis_fr_hosting", "jarvis_fr_domain", "jarvis_fr_web_release",
  "jarvis_fr_mobile_release", "jarvis_fr_store", "jarvis_fr_onboarding",
  "jarvis_fr_support", "jarvis_fr_analytics", "jarvis_fr_release_iso",
  "jarvis_fr_perf", "jarvis_fr_perf_audit", "jarvis_fr_safety_audit", "jarvis_fr_readiness",
  // Phase 1501-1515: Private beta + live deployment execution
  "jarvis_pb_deployments", "jarvis_pb_beta_ops", "jarvis_pb_workflows",
  "jarvis_pb_monitoring", "jarvis_pb_support", "jarvis_pb_incidents",
  "jarvis_pb_trust", "jarvis_pb_live_iso", "jarvis_pb_perf",
  "jarvis_pb_perf_audit", "jarvis_pb_safety_audit", "jarvis_pb_readiness",
  // Phase 1516-1530: Live internet deployment + user scaling
  "jarvis_ld_domain", "jarvis_ld_vps", "jarvis_ld_onboarding",
  "jarvis_ld_traffic", "jarvis_ld_support", "jarvis_ld_incidents",
  "jarvis_ld_trust", "jarvis_ld_live_iso", "jarvis_ld_perf",
  "jarvis_ld_perf_audit", "jarvis_ld_safety_audit", "jarvis_ld_readiness",
  // Phase 1531-1545: Public beta scaling + production hardening
  "jarvis_pbs_traffic", "jarvis_pbs_sessions", "jarvis_pbs_ux",
  "jarvis_pbs_perf", "jarvis_pbs_support", "jarvis_pbs_incidents",
  "jarvis_pbs_trust", "jarvis_pbs_tenants", "jarvis_pbs_live_iso",
  "jarvis_pbs_perf_audit", "jarvis_pbs_safety_audit", "jarvis_pbs_readiness",
  // Phase 1546-1560: Real product experience + frontend maturity
  "jarvis_fem_ux", "jarvis_fem_onboarding", "jarvis_fem_dashboard",
  "jarvis_fem_mobile", "jarvis_fem_sessions", "jarvis_fem_support",
  "jarvis_fem_tenants", "jarvis_fem_perf", "jarvis_fem_live_iso",
  "jarvis_fem_perf_audit", "jarvis_fem_safety_audit", "jarvis_fem_readiness",
  // Phase 1561-1575: Electron desktop shell + operational cockpit
  "jarvis_eld_sessions", "jarvis_eld_cockpit", "jarvis_eld_obs",
  "jarvis_eld_windows", "jarvis_eld_perf", "jarvis_eld_packaging",
  "jarvis_eld_live_iso",
  "jarvis_eld_perf_audit", "jarvis_eld_safety_audit", "jarvis_eld_readiness",
  // Phase 1576-1590: Desktop experience + production packaging
  "jarvis_dxp_sessions", "jarvis_dxp_windows", "jarvis_dxp_notifications",
  "jarvis_dxp_tray", "jarvis_dxp_packaging", "jarvis_dxp_updates",
  "jarvis_dxp_perf", "jarvis_dxp_live_iso",
  "jarvis_dxp_perf_audit", "jarvis_dxp_safety_audit", "jarvis_dxp_readiness",
  // Phase 1591-1605: Real product distribution + user experience
  "jarvis_pdx_sessions", "jarvis_pdx_onboarding", "jarvis_pdx_notifications",
  "jarvis_pdx_workflows", "jarvis_pdx_distribution", "jarvis_pdx_installers",
  "jarvis_pdx_perf", "jarvis_pdx_live_iso",
  "jarvis_pdx_perf_audit", "jarvis_pdx_safety_audit", "jarvis_pdx_readiness",
  // Phase 1606-1620: Public product trust + real-world launch maturity
  "jarvis_plm_trust", "jarvis_plm_sessions", "jarvis_plm_onboarding",
  "jarvis_plm_support", "jarvis_plm_workflows", "jarvis_plm_releases",
  "jarvis_plm_perf", "jarvis_plm_live_iso",
  "jarvis_plm_perf_audit", "jarvis_plm_safety_audit", "jarvis_plm_readiness",
  // Phase 1621-1635: Mobile ecosystem + native experience foundation
  "jarvis_mob_sessions", "jarvis_mob_onboarding", "jarvis_mob_notifications",
  "jarvis_mob_workflows", "jarvis_mob_workspace", "jarvis_mob_trust",
  "jarvis_mob_perf", "jarvis_mob_live_iso",
  "jarvis_mob_perf_audit", "jarvis_mob_safety_audit", "jarvis_mob_readiness",
  // Phase 1636-1650: Premium product experience + operational cockpit polish
  "jarvis_opx_session", "jarvis_opx_perf", "jarvis_opx_safety",
  "jarvis_opx_listener_count", "jarvis_opx_live_iso", "jarvis_opx_autonomous",
  "jarvis_opx_auto_escalate", "jarvis_auto_opx_deploy", "jarvis_opx_exec_auto",
]);

function _checkKeyIsolation() {
  try {
    const unknown = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("jarvis_") && !OWNED_KEYS.has(k)) {
        unknown.push(k);
      }
    }
    if (unknown.length > 0) {
      try {
        const log = JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]");
        log.unshift({ type: "unknown_key_detected", ts: Date.now(), keys: unknown.slice(0, 5) });
        localStorage.setItem("jarvis_friction_signals", JSON.stringify(log.slice(0, 200)));
      } catch {}
    }
    return unknown;
  } catch { return []; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useRuntimeHealthMonitor() {
  const [trustValidation,   setTrustValidation]   = useState(null);
  const [predictions,       setPredictions]       = useState([]);
  const [deployConfidence,  setDeployConfidence]  = useState(null);
  const [unknownKeys,       setUnknownKeys]       = useState([]);
  const [snapshotRestored,  setSnapshotRestored]  = useState(false);

  const evaluate = useCallback(() => {
    const hist    = _loadHist();
    const friction = _loadFriction();
    const execMem  = _loadExecMem();

    const trust  = _validateExecutionTrust(hist, friction);
    const preds  = _predictFailures(hist, execMem);
    const deploy = _deploymentConfidence(hist);

    setTrustValidation(trust);
    setPredictions(preds);
    setDeployConfidence(deploy);
    setSnapshotRestored(false);

    // Phase 815: persist snapshot for reconnect-safe restore
    _saveSnapshot({ trust, predictions: preds, deployConfidence: deploy });
  }, []);

  // Phase 815: restore snapshot on mount (before first evaluation)
  useEffect(() => {
    const snap = _loadSnapshot();
    if (snap?.trust) {
      setTrustValidation(snap.trust);
      setPredictions(snap.predictions || []);
      setDeployConfidence(snap.deployConfidence || null);
      setSnapshotRestored(true);
    }
    // Phase 819: key isolation check on mount
    setUnknownKeys(_checkKeyIsolation());
    // Run live evaluation immediately after
    evaluate();
  }, [evaluate]);

  // Phase 815: re-evaluate on visibility restore (tab/window resume)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Phase 811: summary for operator-facing display
  const trustSummary = useMemo(() => {
    if (!trustValidation) return null;
    const highIssues = trustValidation.issues.filter(i => i.severity === "high");
    const medIssues  = trustValidation.issues.filter(i => i.severity === "medium");
    return {
      ...trustValidation,
      highCount:  highIssues.length,
      medCount:   medIssues.length,
      summary:    highIssues.length
        ? highIssues[0].msg
        : medIssues.length
          ? medIssues[0].msg
          : "Execution environment is healthy",
    };
  }, [trustValidation]);

  // Phase 812: highest-severity prediction
  const topPrediction = useMemo(
    () => predictions.find(p => p.severity === "high") || predictions[0] || null,
    [predictions]
  );

  return {
    // Phase 811
    trustValidation,
    trustSummary,
    // Phase 812
    predictions,
    topPrediction,
    // Phase 816
    deployConfidence,
    // Phase 819
    unknownKeys,
    // Phase 815
    snapshotRestored,
    // Manual re-evaluate
    evaluate,
  };
}
