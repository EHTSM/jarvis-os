"use strict";
/**
 * Enterprise Organization — LEVEL 7
 * 20 enterprise divisions, all via agentRuntimeSupervisor.registerAgent()
 * No new runtimes, schedulers, or event buses.
 */

const _sup = () => require("./agentRuntimeSupervisor.cjs");
const _st  = () => require("./enterpriseState.cjs");
const _wf  = () => require("./enterpriseWorkflow.cjs");
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

let _registered = false;

// ── Tick helpers ──────────────────────────────────────────────────────────────
function _updateKpi(divId, patch) { try { _st().updateEnterpriseKpi(divId, { ...patch, lastTickAt: new Date().toISOString(), tickCount: (_st().getEnterpriseKpi(divId).tickCount || 0) + 1 }); } catch {} }
function _addMemory(divId, title, detail = "") { try { _st().addEnterpriseMemory({ divId, type: "tick", title, detail }); } catch {} }
function _health() { try { return _st().getEnterpriseHealth(); } catch { return { score: 50 }; } }

// ═══════════════════════════════════════════════════════════════════════════════
// 20 ENTERPRISE DIVISIONS
// ═══════════════════════════════════════════════════════════════════════════════

const ENT_ORG = [
  // ── 1. Enterprise Governance ──────────────────────────────────────────────
  {
    id: "ent_governance", role: "ent_governance", label: "Enterprise Governance",
    description: "Enforces enterprise-wide policies, controls, and standards across all companies and workspaces.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const r = _st().evaluateEnterprisePolicy({ budget: 0, activeOrgs: 5 });
      _updateKpi("ent_governance", { policiesEnforced: _st().listEnterprisePolicies({ enabled: true }).length });
      if (r.violations?.length) _addMemory("ent_governance", `Policy violations: ${r.violations.length}`, JSON.stringify(r.violations.slice(0,2)));
      try { _bus()?.emit("enterprise:governance:ticked", { violations: r.violations?.length || 0 }); } catch {}
    },
  },
  // ── 2. Enterprise Portfolio Management ───────────────────────────────────
  {
    id: "ent_portfolio", role: "ent_portfolio", label: "Enterprise Portfolio Management",
    description: "Manages portfolios, initiatives, and programs. Syncs with EOS goals for cross-org visibility.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const portfolios = _st().listPortfolios({});
      for (const pfl of portfolios) { try { _wf().syncPortfolio(pfl.id); } catch {} }
      _updateKpi("ent_portfolio", { goalsCreated: portfolios.length });
      _addMemory("ent_portfolio", `Portfolio sync: ${portfolios.length} portfolios`);
    },
  },
  // ── 3. Enterprise Product Division ───────────────────────────────────────
  {
    id: "ent_product", role: "ent_product", label: "Enterprise Product Division",
    description: "Tracks product lifecycle across all companies. Flags stalled products and identifies GA readiness.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const products = _st().listProducts({ status: "active" });
      const ga = products.filter(p => p.stage === "ga").length;
      const dev = products.filter(p => p.stage === "development").length;
      _updateKpi("ent_product", { goalsCreated: products.length });
      _addMemory("ent_product", `Products: ${ga} GA, ${dev} in development of ${products.length} total`);
      try { _bus()?.emit("enterprise:product:ticked", { total: products.length, ga, dev }); } catch {}
    },
  },
  // ── 4. Enterprise Customer Division ──────────────────────────────────────
  {
    id: "ent_customer", role: "ent_customer", label: "Enterprise Customer Division",
    description: "Manages customer lifecycle, health scores, churn risk, and ARR tracking.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const customers = _st().listCustomers({ status: "active" });
      const highRisk = customers.filter(c => c.churnRisk === "high").length;
      const arr = customers.reduce((sum,c) => sum + (c.arr||0), 0);
      _updateKpi("ent_customer", { goalsCreated: customers.length });
      _addMemory("ent_customer", `Customers: ${customers.length} active, ARR $${arr.toLocaleString()}, ${highRisk} high-churn-risk`);
      if (highRisk > 0) try { _bus()?.emit("enterprise:churn:alert", { count: highRisk }); } catch {}
    },
  },
  // ── 5. Enterprise Partner Division ───────────────────────────────────────
  {
    id: "ent_partner", role: "ent_partner", label: "Enterprise Partner Division",
    description: "Manages partner relationships, deal flow, and contract health.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const partners = _st().listPartners({ status: "active" });
      const contracts = _st().listContracts({ partyType: "partner", status: "active" });
      _updateKpi("ent_partner", { goalsCreated: partners.length });
      _addMemory("ent_partner", `Partners: ${partners.length} active, ${contracts.length} active contracts`);
    },
  },
  // ── 6. Enterprise Finance Division ───────────────────────────────────────
  {
    id: "ent_finance", role: "ent_finance", label: "Enterprise Finance Division",
    description: "Manages enterprise budgets, forecasts, spend tracking, and financial health.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const budgets = _st().listEnterpriseBudgets({});
      const totalBudget = budgets.reduce((s,b) => s + b.totalUsd, 0);
      const totalSpent  = budgets.reduce((s,b) => s + b.spentUsd, 0);
      const utilization = totalBudget > 0 ? Math.round((totalSpent/totalBudget)*100) : 0;
      _updateKpi("ent_finance", { budgetAllocated: totalBudget });
      _addMemory("ent_finance", `Finance: $${totalBudget.toLocaleString()} budget, ${utilization}% utilized`);
      if (utilization > 90) try { _bus()?.emit("enterprise:finance:alert", { utilization }); } catch {}
    },
  },
  // ── 7. Enterprise Legal Division ─────────────────────────────────────────
  {
    id: "ent_legal", role: "ent_legal", label: "Enterprise Legal Division",
    description: "Reviews contracts, tracks legal obligations, and flags expiring agreements.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const contracts = _st().listContracts({ status: "active" });
      const expiringSoon = contracts.filter(c => {
        if (!c.endDate) return false;
        const daysLeft = (new Date(c.endDate) - new Date()) / 86400000;
        return daysLeft > 0 && daysLeft < 30;
      });
      _updateKpi("ent_legal", { auditsCompleted: contracts.length });
      _addMemory("ent_legal", `Legal: ${contracts.length} active contracts, ${expiringSoon.length} expiring in 30d`);
      if (expiringSoon.length > 0) try { _bus()?.emit("enterprise:legal:expiry_alert", { count: expiringSoon.length }); } catch {}
    },
  },
  // ── 8. Enterprise Compliance Division ────────────────────────────────────
  {
    id: "ent_compliance", role: "ent_compliance", label: "Enterprise Compliance Division",
    description: "Runs compliance scans, tracks SOC2/GDPR/PCI controls, and maintains compliance score.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const scanResult = _wf().runComplianceScan({ framework: "SOC2" });
      _updateKpi("ent_compliance", { complianceScore: scanResult.complianceScore, auditsCompleted: (_st().getEnterpriseKpi("ent_compliance").auditsCompleted || 0) + 1 });
      _addMemory("ent_compliance", `Compliance scan: score=${scanResult.complianceScore} violations=${scanResult.violations}`);
    },
  },
  // ── 9. Enterprise Risk Division ───────────────────────────────────────────
  {
    id: "ent_risk", role: "ent_risk", label: "Enterprise Risk Division",
    description: "Scores enterprise risk across all orgs, customers, compliance, and finance.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const risk = _wf().scoreEnterpriseRisk({});
      _updateKpi("ent_risk", { risksResolved: risk.riskScore });
      _addMemory("ent_risk", `Enterprise risk: ${risk.overallRisk} (score=${risk.riskScore})`);
      if (risk.overallRisk === "critical" || risk.overallRisk === "high") {
        try { _bus()?.emit("enterprise:risk:alert", { risk: risk.overallRisk, score: risk.riskScore }); } catch {}
      }
    },
  },
  // ── 10. Enterprise Operations Division ───────────────────────────────────
  {
    id: "ent_operations", role: "ent_operations", label: "Enterprise Operations Division",
    description: "Monitors cross-org mission status, coordinates operational workflows, tracks blockers.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const missions = _wf().getCrossOrgMissionStatus({ limit: 30 });
      const blocked = missions.summary?.failed || 0;
      _updateKpi("ent_operations", { goalsCreated: missions.summary?.total || 0 });
      _addMemory("ent_operations", `Operations: ${missions.summary?.active || 0} active missions, ${blocked} failed`);
      if (blocked > 0) try { _bus()?.emit("enterprise:operations:blocked", { count: blocked }); } catch {}
    },
  },
  // ── 11. Enterprise Infrastructure Division ────────────────────────────────
  {
    id: "ent_infrastructure", role: "ent_infrastructure", label: "Enterprise Infrastructure Division",
    description: "Manages workspaces, quotas, tier upgrades, and infrastructure health.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const workspaces = _st().listWorkspaces({ status: "active" });
      _updateKpi("ent_infrastructure", { goalsCreated: workspaces.length });
      _addMemory("ent_infrastructure", `Infrastructure: ${workspaces.length} active workspaces`);
    },
  },
  // ── 12. Enterprise Security Operations ───────────────────────────────────
  {
    id: "ent_security", role: "ent_security", label: "Enterprise Security Operations",
    description: "Monitors security controls, audit trail anomalies, and vendor risk levels.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const controls = _st().listControls({ status: "active" });
      const highRiskVendors = _st().listVendors({ riskLevel: "high" }).length;
      const critAudit = _st().getAuditTrail({ severity: "critical", limit: 10 }).length;
      _updateKpi("ent_security", { auditsCompleted: (_st().getEnterpriseKpi("ent_security").auditsCompleted || 0) + 1 });
      _addMemory("ent_security", `Security: ${controls.length} controls, ${highRiskVendors} high-risk vendors, ${critAudit} critical audit events`);
      if (critAudit > 0 || highRiskVendors > 0) try { _bus()?.emit("enterprise:security:alert", { critAudit, highRiskVendors }); } catch {}
    },
  },
  // ── 13. Enterprise Analytics ──────────────────────────────────────────────
  {
    id: "ent_analytics", role: "ent_analytics", label: "Enterprise Analytics",
    description: "Generates cross-company and cross-product analytics, KPI roll-ups, and trend reports.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const health = _health();
      const kpis = _st().getAllEnterpriseKpis();
      _updateKpi("ent_analytics", { reportsGenerated: (_st().getEnterpriseKpi("ent_analytics").reportsGenerated || 0) + 1 });
      _addMemory("ent_analytics", `Analytics: enterprise health ${health.score}, ${kpis.length} division KPIs tracked`);
      try { _bus()?.emit("enterprise:analytics:updated", { healthScore: health.score, kpiCount: kpis.length }); } catch {}
    },
  },
  // ── 14. Enterprise Procurement ────────────────────────────────────────────
  {
    id: "ent_procurement", role: "ent_procurement", label: "Enterprise Procurement",
    description: "Tracks vendor contracts, spend commitments, and procurement approvals.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const vendors = _st().listVendors({ status: "active" });
      const contracts = _st().listContracts({ partyType: "vendor", status: "active" });
      const totalSpend = vendors.reduce((s,v) => s + (v.annualSpend || 0), 0);
      _updateKpi("ent_procurement", { budgetAllocated: totalSpend });
      _addMemory("ent_procurement", `Procurement: ${vendors.length} vendors, ${contracts.length} contracts, $${totalSpend.toLocaleString()} annual spend`);
    },
  },
  // ── 15. Enterprise Vendor Management ─────────────────────────────────────
  {
    id: "ent_vendor", role: "ent_vendor", label: "Enterprise Vendor Management",
    description: "Manages vendor risk scoring, SLA tracking, and relationship health.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const vendors = _st().listVendors({});
      const byRisk = { low: 0, medium: 0, high: 0 };
      vendors.forEach(v => { byRisk[v.riskLevel] = (byRisk[v.riskLevel] || 0) + 1; });
      _updateKpi("ent_vendor", { goalsCreated: vendors.length });
      _addMemory("ent_vendor", `Vendors: ${vendors.length} total, risk: L=${byRisk.low} M=${byRisk.medium} H=${byRisk.high}`);
    },
  },
  // ── 16. Enterprise HR ─────────────────────────────────────────────────────
  {
    id: "ent_hr", role: "ent_hr", label: "Enterprise HR",
    description: "Tracks headcount, hiring plans, org structure, and workforce metrics.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const hc = _st().listHeadcount({ status: "active" });
      const byType = { full_time: 0, contractor: 0, part_time: 0 };
      hc.forEach(h => { byType[h.type] = (byType[h.type] || 0) + 1; });
      _updateKpi("ent_hr", { goalsCreated: hc.length });
      _addMemory("ent_hr", `HR: ${hc.length} active headcount — FT=${byType.full_time} Contract=${byType.contractor}`);
    },
  },
  // ── 17. Enterprise Global Strategy ───────────────────────────────────────
  {
    id: "ent_strategy", role: "ent_strategy", label: "Enterprise Global Strategy",
    description: "Maintains enterprise-wide strategy, portfolio alignment, and long-horizon planning.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const portfolios = _st().listPortfolios({});
      const initiatives = _st().listInitiatives({});
      const atRisk = initiatives.filter(i => i.status === "at_risk").length;
      _updateKpi("ent_strategy", { goalsCreated: initiatives.length });
      _addMemory("ent_strategy", `Strategy: ${portfolios.length} portfolios, ${initiatives.length} initiatives, ${atRisk} at-risk`);
      if (atRisk > 0) try { _bus()?.emit("enterprise:strategy:risk", { atRisk }); } catch {}
    },
  },
  // ── 18. Enterprise Audit ──────────────────────────────────────────────────
  {
    id: "ent_audit", role: "ent_audit", label: "Enterprise Audit",
    description: "Runs enterprise audits, maintains audit trail integrity, and generates audit reports.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const trail = _st().getAuditTrail({ limit: 50 });
      const critEvents = trail.filter(e => e.severity === "critical").length;
      _updateKpi("ent_audit", { auditsCompleted: (_st().getEnterpriseKpi("ent_audit").auditsCompleted || 0) + 1 });
      _addMemory("ent_audit", `Audit: ${trail.length} recent entries, ${critEvents} critical`);
      if (critEvents > 0) try { _bus()?.emit("enterprise:audit:critical", { count: critEvents }); } catch {}
    },
  },
  // ── 19. Enterprise Executive Board ────────────────────────────────────────
  {
    id: "ent_board", role: "ent_board", label: "Enterprise Executive Board",
    description: "Generates board-level reports, approves major decisions, and sets enterprise direction.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const db = (() => { try { return _st().getEnterpriseDashboard(); } catch { return { health: { score: 50 }, enterprise: {} }; } })();
      const pending = _st().listEnterpriseApprovals({ status: "pending" }).length;
      // Auto-approve low-risk pending approvals
      if (pending > 0) {
        const toApprove = _st().listEnterpriseApprovals({ status: "pending" }).filter(a => a.autoApprove);
        for (const a of toApprove.slice(0,5)) {
          try { _st().resolveEnterpriseApproval(a.id, { approved: true, resolvedBy: "ent_board", reason: "Board auto-approval" }); } catch {}
        }
      }
      _updateKpi("ent_board", { reportsGenerated: (_st().getEnterpriseKpi("ent_board").reportsGenerated || 0) + 1 });
      _addMemory("ent_board", `Board: enterprise health ${db.health?.score}, ${pending} pending approvals`);
      try { _bus()?.emit("enterprise:board:ticked", { healthScore: db.health?.score, pendingApprovals: pending }); } catch {}
    },
  },
  // ── 20. Enterprise Director ───────────────────────────────────────────────
  {
    id: "ent_director", role: "ent_director", label: "Enterprise Director",
    description: "Orchestrates all enterprise divisions. Coordinates with Executive Layer (Level 6) and drives cross-division alignment.",
    intervalMs: 180_000, enabled: true,
    tickFn: () => {
      const health = _health();
      const risk = (() => { try { return _wf().scoreEnterpriseRisk({}); } catch { return { overallRisk: "low", riskScore: 0 }; } })();
      // Generate periodic board report if health drops
      if (health.score < 70) {
        try {
          _st().createEnterpriseReport({
            title: `Enterprise Health Alert — ${new Date().toISOString().slice(0,10)}`,
            divId: "ent_director", type: "health_alert", summary: `Enterprise health dropped to ${health.score}. Risk: ${risk.overallRisk}`,
            data: { health, risk },
          });
        } catch {}
      }
      _updateKpi("ent_director", { goalsCreated: (_st().getEnterpriseKpi("ent_director").goalsCreated || 0) + 1 });
      _addMemory("ent_director", `Director: health=${health.score} risk=${risk.overallRisk}`);
      try { _bus()?.emit("enterprise:director:ticked", { health: health.score, risk: risk.overallRisk }); } catch {}
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: ENT_ORG.length, registered: ENT_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}

  const results = [];
  for (const spec of ENT_ORG) {
    try { results.push(sup.registerAgent(spec)); } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  _registered = true;

  // Bootstrap on first registration
  try { _wf().bootstrapEnterprisePolicies(); } catch {}
  try { _wf().bootstrapEnterpriseControls(); } catch {}
  try { _wf().subscribeEnterpriseEvents();   } catch {}

  try { _bus()?.emit("enterprise:registered", { count: ENT_ORG.length, ids: ENT_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: ENT_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  try {
    const sup = _sup();
    return ENT_ORG.map(spec => sup.getAgent(spec.id) || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" });
  } catch { return ENT_ORG.map(spec => ({ id: spec.id, role: spec.role, label: spec.label, status: "unknown" })); }
}

function getOrgSummary() {
  const status = getOrgStatus();
  const running = status.filter(a => a.status === "running").length;
  const db = (() => { try { return _st().getEnterpriseDashboard(); } catch { return {}; } })();
  return { total: ENT_ORG.length, running, stopped: ENT_ORG.length - running, dashboard: db };
}

module.exports = { register, getOrgStatus, getOrgSummary, ENT_ORG };
