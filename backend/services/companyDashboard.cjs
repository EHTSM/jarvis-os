"use strict";
/**
 * companyDashboard.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Unified company factory dashboard. Pure aggregation — no own storage.
 * Shows: companies, lifecycle, active workforce, progress, roadmap, risks, readiness.
 *
 * Reuses: companyLifecycleEngine, companyBlueprintEngine,
 *         companyWorkspaceBuilder, workforceManager, performanceEngine.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _cle_e = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _cbe   = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _cwb   = () => _try(() => require("./companyWorkspaceBuilder.cjs"));
const _wm    = () => _try(() => require("./workforceManager.cjs"));
const _pe    = () => _try(() => require("./performanceEngine.cjs"));
const _bte   = () => _try(() => require("./businessTemplateEngine.cjs"));

function _ts() { return new Date().toISOString(); }

// ── Risk scoring ──────────────────────────────────────────────────────────────

function _companyRiskScore(company) {
  if (!company) return 0;
  const critical = (company.risks || []).filter(r => r.severity === "critical").length;
  const high     = (company.risks || []).filter(r => r.severity === "high").length;
  const med      = (company.risks || []).filter(r => r.severity === "medium").length;
  return Math.min(100, critical * 40 + high * 20 + med * 10);
}

// ── Progress calculation ─────────────────────────────────────────────────────

function _calcProgress(company) {
  const STAGES   = ["planning","building","testing","launch","growth","scale","maintenance"];
  const idx      = STAGES.indexOf(company.stage);
  const pct      = Math.round((idx / (STAGES.length - 1)) * 100);
  const gateKeys = Object.keys(company.gates || {});
  const gatePassed = gateKeys.filter(k => company.gates[k]?.passed).length;
  return {
    stageProgress:  pct,
    stagesComplete: idx,
    totalStages:    STAGES.length,
    gatesPassed:    gatePassed,
    totalGates:     gateKeys.length,
  };
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const companies  = _cle_e()?.listCompanies?.({ limit: 100 })?.companies || [];
  const blueprints = _cbe()?.listBlueprints?.({ limit: 100 })?.blueprints || [];
  const workspaces = _cwb()?.listWorkspaces?.({ limit: 100 })?.workspaces || [];
  const wfStats    = _wm()?.getStats?.()     || {};
  const lifecycle  = _cle_e()?.getStats?.()  || {};
  const bpStats    = _cbe()?.getStats?.()    || {};
  const wsStats    = _cwb()?.getStats?.()    || {};
  const perfData   = _pe()?.getDashboardData?.() || {};

  const byStage  = lifecycle.byStage || {};
  const riskList = companies.flatMap(c => (c.risks || []).map(r => ({ ...r, companyId: c.id, companyName: c.name })));

  return {
    ok: true,

    summary: {
      totalCompanies:   companies.length,
      totalBlueprints:  blueprints.length,
      totalWorkspaces:  workspaces.length,
      launched:         lifecycle.launched  || 0,
      scaled:           lifecycle.scaled    || 0,
      avgReadiness:     wsStats.avgReadiness || 0,
      minutesSaved:     companies.reduce((s, c) => s + (c.minutesSaved || 0), 0),
    },

    // Companies with progress
    companies: companies.slice(-20).map(c => ({
      id:           c.id,
      name:         c.name,
      templateId:   c.templateId,
      stage:        c.stage,
      progress:     _calcProgress(c),
      riskScore:    _companyRiskScore(c),
      readiness:    c.readinessScore,
      minutesSaved: c.minutesSaved,
      launchedAt:   c.launchedAt,
      createdAt:    c.createdAt,
    })),

    // Lifecycle distribution
    lifecycleDistribution: byStage,

    // Active workforce
    activeWorkforce: {
      missionsRun:  wfStats.missionsRun  || 0,
      autoAssigned: wfStats.autoAssigned || 0,
      teamsBuilt:   wfStats.teamsBuilt   || 0,
      topPerformers: (perfData.topPerformers || []).slice(0, 5),
    },

    // Roadmap snapshot (all active companies)
    roadmapSnapshot: companies.slice(-5).map(c => ({
      company:  c.name,
      phase:    c.stage,
      roadmap:  (c.roadmap || []).slice(0, 3).map(p => ({ phase: p.phase, status: p.status, weeks: p.estimatedWeeks })),
    })),

    // Risks
    topRisks: riskList
      .sort((a, b) => { const o = { critical: 3, high: 2, medium: 1, low: 0 }; return (o[b.severity] || 0) - (o[a.severity] || 0); })
      .slice(0, 10),

    // Business templates usage
    templateUsage: Object.entries(bpStats.byTemplate || {}).map(([id, count]) => {
      const tpl = _bte()?.getTemplate?.(id);
      return { id, name: tpl?.name || id, count };
    }).sort((a, b) => b.count - a.count),

    // Recent workspaces
    recentWorkspaces: workspaces.slice(-5).map(w => ({
      id:             w.id,
      companyName:    w.companyName,
      templateId:     w.templateId,
      readinessScore: w.readinessScore,
      missions:       w.registeredMissions?.length || 0,
      repos:          w.repositories?.repositories?.length || 0,
      createdAt:      w.createdAt,
    })),

    generatedAt: _ts(),
  };
}

function getCompanyDetail(companyId) {
  const company   = _cle_e()?.getCompany?.(companyId);
  if (!company) return { ok: false, error: "company not found" };
  const blueprint = company.blueprintId ? _cbe()?.getBlueprint?.(company.blueprintId) : null;
  const workspace = company.workspaceId ? _cwb()?.getWorkspace?.(company.workspaceId) : null;
  return {
    ok: true,
    company,
    blueprint: blueprint ? { id: blueprint.id, name: blueprint.name, templateId: blueprint.templateId, skills: blueprint.skills, techStack: blueprint.techStack } : null,
    workspace: workspace ? { id: workspace.id, readinessScore: workspace.readinessScore, repos: workspace.repositories?.repositories?.length, missions: workspace.registeredMissions?.length } : null,
    riskScore:   _companyRiskScore(company),
    progress:    _calcProgress(company),
  };
}

module.exports = {
  getDashboard,
  getCompanyDetail,
};
