"use strict";
/**
 * Enterprise Layer — State (LEVEL 7)
 *
 * Manages the AI Enterprise across companies, workspaces, products, customers.
 * Delegates all execution to Level 6 (Executive Layer) and below.
 * Zero new runtimes, schedulers, event buses, or memory systems.
 *
 * Storage: data/enterprise/ (9 JSON files)
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/enterprise");
const FILES = {
  state:      path.join(DATA_DIR, "state.json"),      // companies, workspaces, products, customers, partners
  portfolio:  path.join(DATA_DIR, "portfolio.json"),  // portfolios, initiatives, programs
  finance:    path.join(DATA_DIR, "finance.json"),    // budgets, forecasts, p&l, spend
  governance: path.join(DATA_DIR, "governance.json"), // policies, controls, approvals, audit trail
  hr:         path.join(DATA_DIR, "hr.json"),         // headcount, roles, org structure
  kpis:       path.join(DATA_DIR, "kpis.json"),       // per-division KPIs
  memory:     path.join(DATA_DIR, "memory.json"),     // enterprise memory entries
  reports:    path.join(DATA_DIR, "reports.json"),    // executive board reports
  context:    path.join(DATA_DIR, "context.json"),    // global enterprise context
};

// ── Lazy accessors — Level 1-6 integration ───────────────────────────────────
function _eosSt()  { try { return require("./executiveState.cjs");      } catch { return null; } }
function _eosWf()  { try { return require("./executiveWorkflow.cjs");   } catch { return null; } }
function _engSt()  { try { return require("./engineeringOrgState.cjs"); } catch { return null; } }
function _bizSt()  { try { return require("./businessOrgState.cjs");    } catch { return null; } }
function _akoSt()  { try { return require("./akoState.cjs");            } catch { return null; } }
function _aeoSt()  { try { return require("./aeoState.cjs");            } catch { return null; } }
function _obs()    { try { return require("./observabilityEngine.cjs"); } catch { return null; } }
function _ca()     { try { return require("./costAnalytics.cjs");       } catch { return null; } }
function _polEnt() { try { return require("./enterprisePolicies.cjs");  } catch { return null; } }
function _entObs() { try { return require("./enterpriseObservability.cjs"); } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");       } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _sup()    { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  state: {
    companies: [], workspaces: [], products: [], customers: [],
    partners: [], vendors: [], contracts: [],
  },
  portfolio: { portfolios: [], initiatives: [], programs: [] },
  finance: { budgets: [], forecasts: [], transactions: [], pl: [] },
  governance: { policies: [], controls: [], approvals: [], auditTrail: [] },
  hr: { headcount: [], roles: [], orgChart: [] },
  kpis: {},
  memory: [],
  reports: [],
  context: {
    globalObjective: null, activeCompanies: [], enterpriseHealth: 100,
    totalARR: 0, totalHeadcount: 0, lastSync: null,
  },
};

const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}

function _s()   { return _load("state"); }
function _p()   { return _load("portfolio"); }
function _f()   { return _load("finance"); }
function _g()   { return _load("governance"); }
function _h()   { return _load("hr"); }
function _k()   { return _load("kpis"); }
function _m()   { return _load("memory"); }
function _r()   { return _load("reports"); }
function _ctx() { return _load("context"); }

const _id = pfx => `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── Division IDs ──────────────────────────────────────────────────────────────
const DIVISION_IDS = [
  "ent_governance","ent_portfolio","ent_product","ent_customer","ent_partner",
  "ent_finance","ent_legal","ent_compliance","ent_risk","ent_operations",
  "ent_infrastructure","ent_security","ent_analytics","ent_procurement",
  "ent_vendor","ent_hr","ent_strategy","ent_audit","ent_board","ent_director",
];

function _kpi(divId) {
  const k = _k();
  if (!k[divId]) {
    k[divId] = {
      divId, goalsCreated: 0, policiesEnforced: 0, approvalsGranted: 0,
      auditsCompleted: 0, reportsGenerated: 0, risksResolved: 0,
      budgetAllocated: 0, complianceScore: 100,
      lastTickAt: null, tickCount: 0,
    };
    _save("kpis");
  }
  return k[divId];
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANIES (multi-company governance)
// ═══════════════════════════════════════════════════════════════════════════════

function createCompany({ name, legalName, country = "IN", industry, arr = 0, stage = "startup", tags = [] } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const s = _s();
  if (s.companies.some(c => c.name === name && c.status === "active"))
    return { ok: false, error: "Duplicate active company" };
  const company = {
    id: _id("eco"), name, legalName: legalName || name, country, industry, arr,
    stage, tags, status: "active",
    workspaceIds: [], productIds: [], customerIds: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  s.companies.push(company);
  _kpi("ent_governance").goalsCreated++;
  _save("state"); _save("kpis");
  try { _bus()?.emit("enterprise:company:created", { id: company.id, name }); } catch {}
  return { ok: true, company };
}

function listCompanies({ status, country, industry, limit = 50 } = {}) {
  let list = _s().companies;
  if (status)   list = list.filter(c => c.status === status);
  if (country)  list = list.filter(c => c.country === country);
  if (industry) list = list.filter(c => c.industry === industry);
  return list.slice(-limit).reverse();
}

function getCompany(id) { return _s().companies.find(c => c.id === id) || null; }

function updateCompany(id, patch) {
  const c = _s().companies.find(x => x.id === id);
  if (!c) return { ok: false, error: "Not found" };
  Object.assign(c, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, company: c };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACES (multi-workspace governance)
// ═══════════════════════════════════════════════════════════════════════════════

function createWorkspace({ companyId, name, type = "product", region = "global", tier = "standard", quotas = {} } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const ws = {
    id: _id("ews"), companyId, name, type, region, tier, quotas,
    status: "active", memberCount: 0, productIds: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().workspaces.push(ws);
  if (companyId) {
    const co = getCompany(companyId);
    if (co) co.workspaceIds = [...(co.workspaceIds||[]), ws.id];
  }
  _save("state");
  try { _bus()?.emit("enterprise:workspace:created", { id: ws.id, companyId, name }); } catch {}
  return { ok: true, workspace: ws };
}

function listWorkspaces({ companyId, status, type } = {}) {
  let list = _s().workspaces;
  if (companyId) list = list.filter(w => w.companyId === companyId);
  if (status)    list = list.filter(w => w.status === status);
  if (type)      list = list.filter(w => w.type === type);
  return list;
}

function getWorkspace(id) { return _s().workspaces.find(w => w.id === id) || null; }
function updateWorkspace(id, patch) {
  const w = _s().workspaces.find(x => x.id === id);
  if (!w) return { ok: false, error: "Not found" };
  Object.assign(w, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, workspace: w };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS (product lifecycle management)
// ═══════════════════════════════════════════════════════════════════════════════

const PRODUCT_STAGES = ["concept","development","alpha","beta","ga","deprecated","sunset"];

function createProduct({ companyId, workspaceId, name, description = "", stage = "development", type = "saas", mrr = 0, arr = 0, revenueModel = "subscription" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const product = {
    id: _id("eprd"), companyId, workspaceId, name, description,
    stage, type, mrr, arr, revenueModel,
    status: "active", customerCount: 0, featureIds: [],
    launchedAt: stage === "ga" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().products.push(product);
  if (companyId) { const co = getCompany(companyId); if (co) co.productIds = [...(co.productIds||[]), product.id]; }
  _save("state");
  _kpi("ent_product").goalsCreated++;
  _save("kpis");
  return { ok: true, product };
}

function listProducts({ companyId, workspaceId, stage, status, limit = 50 } = {}) {
  let list = _s().products;
  if (companyId)   list = list.filter(p => p.companyId === companyId);
  if (workspaceId) list = list.filter(p => p.workspaceId === workspaceId);
  if (stage)       list = list.filter(p => p.stage === stage);
  if (status)      list = list.filter(p => p.status === status);
  return list.slice(-limit).reverse();
}

function getProduct(id) { return _s().products.find(p => p.id === id) || null; }
function updateProduct(id, patch) {
  const p = _s().products.find(x => x.id === id);
  if (!p) return { ok: false, error: "Not found" };
  Object.assign(p, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, product: p };
}

function advanceProductStage(id, toStage) {
  if (!PRODUCT_STAGES.includes(toStage)) return { ok: false, error: "Invalid stage" };
  const p = getProduct(id);
  if (!p) return { ok: false, error: "Not found" };
  const prev = p.stage;
  p.stage = toStage;
  p.updatedAt = new Date().toISOString();
  if (toStage === "ga") p.launchedAt = new Date().toISOString();
  _save("state");
  try { _bus()?.emit("enterprise:product:stage", { id, from: prev, to: toStage }); } catch {}
  return { ok: true, product: p, from: prev, to: toStage };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS (customer lifecycle management)
// ═══════════════════════════════════════════════════════════════════════════════

function createCustomer({ companyId, productId, name, email, plan = "starter", mrr = 0, arr = 0, status = "trial", country = "IN" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const customer = {
    id: _id("ecust"), companyId, productId, name, email, plan, mrr, arr,
    status, country, healthScore: 80,
    churnRisk: "low", ltv: arr,
    activatedAt: null, churnedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().customers.push(customer);
  if (companyId) { const co = getCompany(companyId); if (co) co.customerIds = [...(co.customerIds||[]), customer.id]; }
  if (productId) {
    const pr = getProduct(productId);
    if (pr) { pr.customerCount = (pr.customerCount || 0) + 1; pr.mrr = (pr.mrr || 0) + mrr; }
  }
  _save("state");
  _kpi("ent_customer").goalsCreated++;
  _save("kpis");
  try { _bus()?.emit("enterprise:customer:created", { id: customer.id, companyId, productId }); } catch {}
  return { ok: true, customer };
}

function listCustomers({ companyId, productId, status, plan, churnRisk, limit = 100 } = {}) {
  let list = _s().customers;
  if (companyId)  list = list.filter(c => c.companyId === companyId);
  if (productId)  list = list.filter(c => c.productId === productId);
  if (status)     list = list.filter(c => c.status === status);
  if (plan)       list = list.filter(c => c.plan === plan);
  if (churnRisk)  list = list.filter(c => c.churnRisk === churnRisk);
  return list.slice(-limit).reverse();
}

function getCustomer(id) { return _s().customers.find(c => c.id === id) || null; }
function updateCustomer(id, patch) {
  const c = _s().customers.find(x => x.id === id);
  if (!c) return { ok: false, error: "Not found" };
  Object.assign(c, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, customer: c };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTNERS & VENDORS
// ═══════════════════════════════════════════════════════════════════════════════

function createPartner({ name, type = "reseller", country = "IN", tier = "silver", contractValue = 0 } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const partner = {
    id: _id("eprt"), name, type, country, tier, contractValue,
    status: "active", revenueGenerated: 0, dealsCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().partners.push(partner);
  _save("state");
  _kpi("ent_partner").goalsCreated++;
  _save("kpis");
  return { ok: true, partner };
}

function listPartners({ type, status, tier } = {}) {
  let list = _s().partners;
  if (type)   list = list.filter(p => p.type === type);
  if (status) list = list.filter(p => p.status === status);
  if (tier)   list = list.filter(p => p.tier === tier);
  return list;
}

function createVendor({ name, category, country = "IN", contractValue = 0, riskLevel = "low" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const vendor = {
    id: _id("evnd"), name, category, country, contractValue, riskLevel,
    status: "active", annualSpend: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().vendors.push(vendor);
  _save("state");
  _kpi("ent_vendor").goalsCreated++;
  _save("kpis");
  return { ok: true, vendor };
}

function listVendors({ category, status, riskLevel } = {}) {
  let list = _s().vendors;
  if (category)  list = list.filter(v => v.category === category);
  if (status)    list = list.filter(v => v.status === status);
  if (riskLevel) list = list.filter(v => v.riskLevel === riskLevel);
  return list;
}

// Contracts (covers partners + vendors)
function createContract({ partyId, partyType = "vendor", title, value = 0, currency = "USD", startDate, endDate, type = "service" } = {}) {
  if (!partyId || !title) return { ok: false, error: "partyId and title required" };
  const contract = {
    id: _id("econt"), partyId, partyType, title, value, currency, startDate, endDate, type,
    status: "active", renewalAlert: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().contracts.push(contract);
  _save("state");
  return { ok: true, contract };
}

function listContracts({ partyId, status, type } = {}) {
  let list = _s().contracts;
  if (partyId) list = list.filter(c => c.partyId === partyId);
  if (status)  list = list.filter(c => c.status === status);
  if (type)    list = list.filter(c => c.type === type);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function createPortfolio({ name, description = "", companyId, ownerDivision = "ent_portfolio", budget = 0, horizon = "annual" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const portfolio = {
    id: _id("epfl"), name, description, companyId, ownerDivision, budget, horizon,
    status: "active", initiativeIds: [], programIds: [],
    healthScore: 100, onTrack: 0, atRisk: 0, blocked: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _p().portfolios.push(portfolio);
  _save("portfolio");
  _kpi("ent_portfolio").goalsCreated++;
  _save("kpis");
  return { ok: true, portfolio };
}

function listPortfolios({ companyId, status } = {}) {
  let list = _p().portfolios;
  if (companyId) list = list.filter(p => p.companyId === companyId);
  if (status)    list = list.filter(p => p.status === status);
  return list;
}

function createInitiative({ portfolioId, name, description = "", orgTargets = [], budget = 0, priority = "high", execGoalId = null } = {}) {
  if (!portfolioId || !name) return { ok: false, error: "portfolioId and name required" };
  const init = {
    id: _id("einit"), portfolioId, name, description, orgTargets, budget, priority, execGoalId,
    status: "active", progress: 0, milestones: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _p().initiatives.push(init);
  const pfl = _p().portfolios.find(p => p.id === portfolioId);
  if (pfl) pfl.initiativeIds = [...(pfl.initiativeIds||[]), init.id];
  _save("portfolio");
  _kpi("ent_portfolio").goalsCreated++;
  _save("kpis");
  return { ok: true, initiative: init };
}

function listInitiatives({ portfolioId, status, priority } = {}) {
  let list = _p().initiatives;
  if (portfolioId) list = list.filter(i => i.portfolioId === portfolioId);
  if (status)      list = list.filter(i => i.status === status);
  if (priority)    list = list.filter(i => i.priority === priority);
  return list;
}

function updateInitiative(id, patch) {
  const i = _p().initiatives.find(x => x.id === id);
  if (!i) return { ok: false, error: "Not found" };
  Object.assign(i, patch, { updatedAt: new Date().toISOString() });
  _save("portfolio");
  return { ok: true, initiative: i };
}

function createProgram({ portfolioId, name, description = "", initiativeIds = [], budget = 0 } = {}) {
  if (!portfolioId || !name) return { ok: false, error: "portfolioId and name required" };
  const prog = {
    id: _id("eprog"), portfolioId, name, description, initiativeIds, budget,
    status: "active", progress: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _p().programs.push(prog);
  _save("portfolio");
  return { ok: true, program: prog };
}

function listPrograms({ portfolioId, status } = {}) {
  let list = _p().programs;
  if (portfolioId) list = list.filter(p => p.portfolioId === portfolioId);
  if (status)      list = list.filter(p => p.status === status);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCE (budgeting, forecasting, P&L)
// ═══════════════════════════════════════════════════════════════════════════════

function createEnterpriseBudget({ companyId, title, totalUsd, fiscalYear, breakdown = {}, ownerDivision = "ent_finance" } = {}) {
  if (!companyId || !title || !totalUsd) return { ok: false, error: "companyId, title, totalUsd required" };
  const budget = {
    id: _id("ebgt"), companyId, title, totalUsd, fiscalYear: fiscalYear || new Date().getFullYear(),
    breakdown, ownerDivision,
    spentUsd: 0, committedUsd: 0, remainingUsd: totalUsd,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _f().budgets.push(budget);
  _save("finance");
  _kpi("ent_finance").budgetAllocated += totalUsd;
  _save("kpis");
  return { ok: true, budget };
}

function allocateEnterpriseBudget(budgetId, { division, amountUsd, description = "" } = {}) {
  const b = _f().budgets.find(x => x.id === budgetId);
  if (!b) return { ok: false, error: "Not found" };
  if (amountUsd > b.remainingUsd) return { ok: false, error: "Insufficient budget" };
  b.committedUsd += amountUsd; b.remainingUsd -= amountUsd;
  b.breakdown[division] = (b.breakdown[division] || 0) + amountUsd;
  b.updatedAt = new Date().toISOString();
  _save("finance");
  const tx = { id: _id("etx"), budgetId, division, amountUsd, description, type: "allocation", at: new Date().toISOString() };
  _f().transactions.push(tx);
  _save("finance");
  return { ok: true, budget: b, transaction: tx };
}

function listEnterpriseBudgets({ companyId, fiscalYear } = {}) {
  let list = _f().budgets;
  if (companyId)  list = list.filter(b => b.companyId === companyId);
  if (fiscalYear) list = list.filter(b => b.fiscalYear === fiscalYear);
  return list;
}

function createForecast({ companyId, title, period, revenueUsd, expenseUsd, assumptions = [] } = {}) {
  if (!companyId || !title) return { ok: false, error: "companyId and title required" };
  const fc = {
    id: _id("efc"), companyId, title, period: period || `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth()+1)/3)}`,
    revenueUsd: revenueUsd || 0, expenseUsd: expenseUsd || 0,
    netUsd: (revenueUsd || 0) - (expenseUsd || 0),
    assumptions, confidence: 80,
    createdAt: new Date().toISOString(),
  };
  _f().forecasts.push(fc);
  _save("finance");
  return { ok: true, forecast: fc };
}

function listForecasts({ companyId, period } = {}) {
  let list = _f().forecasts;
  if (companyId) list = list.filter(f => f.companyId === companyId);
  if (period)    list = list.filter(f => f.period === period);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOVERNANCE (policies, controls, enterprise approvals)
// ═══════════════════════════════════════════════════════════════════════════════

function createEnterprisePolicy({ title, scope = "enterprise", companyId, category = "operational", rules = [], enforcement = "mandatory", enabled = true } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const g = _g();
  if (g.policies.some(p => p.title === title && p.enabled))
    return { ok: false, error: "Duplicate active policy" };
  const policy = {
    id: _id("egpol"), title, scope, companyId, category, rules, enforcement, enabled,
    violationCount: 0, lastEvaluatedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  g.policies.push(policy);
  _save("governance");
  _kpi("ent_governance").policiesEnforced++;
  _save("kpis");
  return { ok: true, policy };
}

function listEnterprisePolicies({ scope, category, enabled, companyId } = {}) {
  let list = _g().policies;
  if (scope)     list = list.filter(p => p.scope === scope);
  if (category)  list = list.filter(p => p.category === category);
  if (enabled !== undefined) list = list.filter(p => p.enabled === enabled);
  if (companyId) list = list.filter(p => !p.companyId || p.companyId === companyId);
  return list;
}

function evaluateEnterprisePolicy(context = {}) {
  const active = _g().policies.filter(p => p.enabled).sort((a,b) => (b.enforcement === "mandatory" ? 1 : 0) - (a.enforcement === "mandatory" ? 1 : 0));
  const violations = [];
  for (const p of active) {
    p.lastEvaluatedAt = new Date().toISOString();
    for (const rule of (p.rules || [])) {
      let violated = false;
      if (rule.type === "spend_cap"   && (context.spendUsd || 0) > rule.limit)       violated = true;
      if (rule.type === "headcount"   && (context.headcount || 0) > rule.limit)      violated = true;
      if (rule.type === "data_region" && context.region && !rule.allowed.includes(context.region)) violated = true;
      if (rule.type === "approval_required" && context.requireApproval) violated = true;
      if (violated) {
        violations.push({ policyId: p.id, policyTitle: p.title, rule, context, enforcement: p.enforcement });
        p.violationCount++;
      }
    }
  }
  _save("governance");
  return { ok: true, violations, evaluated: active.length };
}

function createEnterpriseApproval({ companyId, title, type = "budget", requestedBy, autoApprove = false, threshold = 0.8, data = {} } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const appr = {
    id: _id("egappr"), companyId, title, type, requestedBy, autoApprove, threshold, data,
    status: autoApprove ? "approved" : "pending",
    resolvedBy: autoApprove ? "auto" : null,
    createdAt: new Date().toISOString(), resolvedAt: autoApprove ? new Date().toISOString() : null,
  };
  _g().approvals.push(appr);
  if (autoApprove) _kpi("ent_governance").approvalsGranted++;
  _save("governance"); _save("kpis");
  return { ok: true, approval: appr };
}

function resolveEnterpriseApproval(id, { approved, resolvedBy = "board", reason = "" } = {}) {
  const a = _g().approvals.find(x => x.id === id);
  if (!a) return { ok: false, error: "Not found" };
  a.status = approved ? "approved" : "rejected";
  a.resolvedBy = resolvedBy; a.reason = reason;
  a.resolvedAt = new Date().toISOString();
  if (approved) _kpi("ent_governance").approvalsGranted++;
  _save("governance"); _save("kpis");
  // Emit audit event
  addAuditEntry({ entityId: id, entityType: "approval", action: a.status, actor: resolvedBy, detail: reason });
  return { ok: true, approval: a };
}

function listEnterpriseApprovals({ status, type, companyId } = {}) {
  let list = _g().approvals;
  if (status)    list = list.filter(a => a.status === status);
  if (type)      list = list.filter(a => a.type === type);
  if (companyId) list = list.filter(a => a.companyId === companyId);
  return list.slice(-50).reverse();
}

// ── Controls ──────────────────────────────────────────────────────────────────
function createControl({ title, framework = "SOC2", category = "access", divisionId = "ent_compliance", automated = true, status = "active" } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const ctrl = {
    id: _id("ectrl"), title, framework, category, divisionId, automated, status,
    lastTestedAt: null, nextTestAt: null, evidenceCount: 0,
    createdAt: new Date().toISOString(),
  };
  _g().controls.push(ctrl);
  _save("governance");
  _kpi("ent_compliance").auditsCompleted++;
  _save("kpis");
  return { ok: true, control: ctrl };
}

function listControls({ framework, category, status } = {}) {
  let list = _g().controls;
  if (framework) list = list.filter(c => c.framework === framework);
  if (category)  list = list.filter(c => c.category === category);
  if (status)    list = list.filter(c => c.status === status);
  return list;
}

// ── Audit Trail ───────────────────────────────────────────────────────────────
function addAuditEntry({ entityId, entityType, action, actor = "system", detail = "", companyId, workspaceId, severity = "info" } = {}) {
  const entry = {
    id: _id("eaud"), entityId, entityType, action, actor, detail, companyId, workspaceId, severity,
    at: new Date().toISOString(),
  };
  const trail = _g().auditTrail;
  trail.push(entry);
  if (trail.length > 5000) trail.splice(0, trail.length - 5000); // cap at 5k
  _save("governance");
  return entry;
}

function getAuditTrail({ entityId, entityType, companyId, severity, limit = 100 } = {}) {
  let list = _g().auditTrail;
  if (entityId)   list = list.filter(e => e.entityId === entityId);
  if (entityType) list = list.filter(e => e.entityType === entityType);
  if (companyId)  list = list.filter(e => e.companyId === companyId);
  if (severity)   list = list.filter(e => e.severity === severity);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// HR (headcount, roles, org chart)
// ═══════════════════════════════════════════════════════════════════════════════

function addHeadcount({ companyId, divisionId = "ent_hr", name, role, level = "IC3", type = "full_time", location = "remote", department, startDate } = {}) {
  if (!companyId || !name) return { ok: false, error: "companyId and name required" };
  const hc = {
    id: _id("ehc"), companyId, divisionId, name, role, level, type, location, department,
    status: "active", startDate: startDate || new Date().toISOString().slice(0,10),
    createdAt: new Date().toISOString(),
  };
  _h().headcount.push(hc);
  _save("hr");
  _kpi("ent_hr").goalsCreated++;
  _save("kpis");
  const ctx = _ctx();
  ctx.totalHeadcount = _h().headcount.filter(h => h.status === "active").length;
  _save("context");
  return { ok: true, headcount: hc };
}

function listHeadcount({ companyId, divisionId, status, type } = {}) {
  let list = _h().headcount;
  if (companyId)  list = list.filter(h => h.companyId === companyId);
  if (divisionId) list = list.filter(h => h.divisionId === divisionId);
  if (status)     list = list.filter(h => h.status === status);
  if (type)       list = list.filter(h => h.type === type);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY + REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function addEnterpriseMemory({ divId, type = "signal", title, detail = "", companyId, tags = [] } = {}) {
  if (!divId || !title) return { ok: false, error: "divId and title required" };
  const entry = { id: _id("emem"), divId, type, title, detail, companyId, tags, at: new Date().toISOString() };
  _m().push(entry);
  if (_m().length > 2000) _m().splice(0, _m().length - 2000);
  _save("memory");
  return { ok: true, entry };
}

function listEnterpriseMemory({ divId, type, companyId, limit = 50 } = {}) {
  let list = _m();
  if (divId)     list = list.filter(x => x.divId === divId);
  if (type)      list = list.filter(x => x.type === type);
  if (companyId) list = list.filter(x => x.companyId === companyId);
  return list.slice(-limit).reverse();
}

function createEnterpriseReport({ title, divId = "ent_board", type = "executive", data = {}, summary = "", companyId } = {}) {
  if (!title || !divId) return { ok: false, error: "title and divId required" };
  const report = {
    id: _id("erpt"), title, divId, type, data, summary, companyId,
    createdAt: new Date().toISOString(),
  };
  _r().push(report);
  if (_r().length > 500) _r().splice(0, _r().length - 500);
  _kpi(divId).reportsGenerated = (_kpi(divId).reportsGenerated || 0) + 1;
  _save("reports"); _save("kpis");
  return { ok: true, report };
}

function listEnterpriseReports({ divId, type, companyId, limit = 20 } = {}) {
  let list = _r();
  if (divId)     list = list.filter(r => r.divId === divId);
  if (type)      list = list.filter(r => r.type === type);
  if (companyId) list = list.filter(r => r.companyId === companyId);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function getEnterpriseKpi(divId) { return _kpi(divId); }
function getAllEnterpriseKpis()   { return Object.values(_k()); }
function updateEnterpriseKpi(divId, patch) { Object.assign(_kpi(divId), patch); _save("kpis"); }

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE HEALTH (cross-org, cross-company)
// ═══════════════════════════════════════════════════════════════════════════════

function getEnterpriseHealth() {
  const health = { score: 100, dimensions: {}, companies: {}, alerts: [] };
  const s = _s();
  const f = _f();

  // Companies
  const activeCompanies = s.companies.filter(c => c.status === "active");
  health.dimensions.companies = { total: s.companies.length, active: activeCompanies.length, score: 100 };

  // Products — stage health
  const gaProducts = s.products.filter(p => p.stage === "ga" && p.status === "active");
  const totalProducts = s.products.filter(p => p.status === "active");
  health.dimensions.products = {
    total: totalProducts.length, ga: gaProducts.length,
    score: totalProducts.length > 0 ? Math.round((gaProducts.length / totalProducts.length) * 100) : 100,
  };

  // Customers — churn risk
  const customers = s.customers.filter(c => c.status === "active" || c.status === "trial");
  const highRisk = customers.filter(c => c.churnRisk === "high").length;
  const totalARR = customers.reduce((sum,c) => sum + (c.arr || 0), 0);
  health.dimensions.customers = {
    total: customers.length, highChurnRisk: highRisk,
    totalARR, score: customers.length > 0 ? Math.max(0, 100 - Math.round((highRisk/customers.length)*100)) : 100,
  };

  // Finance — budget utilization
  const totalBudget = f.budgets.reduce((s,b) => s + b.totalUsd, 0);
  const totalSpent  = f.budgets.reduce((s,b) => s + b.spentUsd, 0);
  const utilization = totalBudget > 0 ? totalSpent / totalBudget : 0;
  health.dimensions.finance = {
    totalBudget, totalSpent, utilization,
    score: utilization <= 0.9 ? 100 : Math.max(0, Math.round((1 - (utilization - 0.9) * 10) * 100)),
  };

  // Governance — active approvals pending
  const pendingApprovals = _g().approvals.filter(a => a.status === "pending").length;
  health.dimensions.governance = { pendingApprovals, score: Math.max(0, 100 - pendingApprovals * 5) };

  // Compliance — controls
  const activeControls = _g().controls.filter(c => c.status === "active").length;
  const failedControls = _g().controls.filter(c => c.status === "failed").length;
  health.dimensions.compliance = {
    activeControls, failedControls,
    score: activeControls > 0 ? Math.max(0, 100 - Math.round((failedControls / activeControls)*100)) : 100,
  };

  // Level 6 — pull EOS health
  try {
    const eosHealth = _eosSt()?.getGlobalHealth?.();
    if (eosHealth) health.dimensions.executive = { score: eosHealth.score, orgs: eosHealth.orgs };
  } catch { health.dimensions.executive = { score: 50 }; }

  // Aggregate
  const scores = Object.values(health.dimensions).map(d => d.score || 50);
  health.score = Math.min(100, Math.max(0, Math.round(scores.reduce((a,b) => a+b, 0) / scores.length)));

  // Update context
  const ctx = _ctx();
  ctx.enterpriseHealth = health.score;
  ctx.totalARR = totalARR;
  ctx.lastSync = new Date().toISOString();
  _save("context");

  return health;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getEnterpriseDashboard() {
  const s = _s(); const f = _f(); const g = _g(); const h = _h(); const p = _p();
  const health = getEnterpriseHealth();
  const eosDb = (() => { try { return _eosSt()?.getDashboard?.() || {}; } catch { return {}; } })();

  return {
    enterprise: {
      companies:  { total: s.companies.length,  active: s.companies.filter(c => c.status === "active").length },
      workspaces: { total: s.workspaces.length, active: s.workspaces.filter(w => w.status === "active").length },
      products:   { total: s.products.length,   ga: s.products.filter(p => p.stage === "ga").length },
      customers:  { total: s.customers.length,  active: s.customers.filter(c => c.status === "active" || c.status === "paid").length },
      partners:   { total: s.partners.length },
      vendors:    { total: s.vendors.length },
    },
    portfolio: {
      portfolios:  p.portfolios.length,
      initiatives: p.initiatives.length,
      programs:    p.programs.length,
      atRisk:      p.initiatives.filter(i => i.status === "at_risk").length,
    },
    finance: {
      totalBudgetUsd: f.budgets.reduce((sum,b) => sum + b.totalUsd, 0),
      totalSpentUsd:  f.budgets.reduce((sum,b) => sum + b.spentUsd, 0),
      totalARR:       s.customers.reduce((sum,c) => sum + (c.arr||0), 0),
      forecasts:      f.forecasts.length,
    },
    governance: {
      policies:        g.policies.filter(p => p.enabled).length,
      controls:        g.controls.filter(c => c.status === "active").length,
      pendingApprovals:g.approvals.filter(a => a.status === "pending").length,
      auditEntries:    g.auditTrail.length,
    },
    hr: {
      totalHeadcount: h.headcount.filter(h => h.status === "active").length,
    },
    reports:  { total: _r().length },
    health,
    executive: eosDb,
    lastSync:  _ctx().lastSync,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE-WIDE SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function enterpriseSearch(query, { types = ["company","product","customer","partner","vendor","initiative"], limit = 20 } = {}) {
  if (!query) return { ok: false, error: "query required" };
  const q = query.toLowerCase();
  const results = [];
  const s = _s(); const p = _p();

  if (types.includes("company"))     s.companies.forEach(c => { if (c.name.toLowerCase().includes(q) || (c.legalName||"").toLowerCase().includes(q)) results.push({ type:"company",   id:c.id, name:c.name, status:c.status }); });
  if (types.includes("product"))     s.products.forEach(p  => { if (p.name.toLowerCase().includes(q) || (p.description||"").toLowerCase().includes(q)) results.push({ type:"product",   id:p.id, name:p.name, stage:p.stage  }); });
  if (types.includes("customer"))    s.customers.forEach(c => { if (c.name.toLowerCase().includes(q) || (c.email||"").toLowerCase().includes(q)) results.push({ type:"customer",  id:c.id, name:c.name, status:c.status }); });
  if (types.includes("partner"))     s.partners.forEach(p  => { if (p.name.toLowerCase().includes(q)) results.push({ type:"partner",   id:p.id, name:p.name, tier:p.tier }); });
  if (types.includes("vendor"))      s.vendors.forEach(v   => { if (v.name.toLowerCase().includes(q)) results.push({ type:"vendor",    id:v.id, name:v.name, category:v.category }); });
  if (types.includes("initiative"))  p.initiatives.forEach(i => { if (i.name.toLowerCase().includes(q) || (i.description||"").toLowerCase().includes(q)) results.push({ type:"initiative", id:i.id, name:i.name, status:i.status }); });

  // Also search EOS goals
  try {
    const goals = _eosSt()?.listGoals?.({ limit: 200 }) || [];
    if (types.includes("goal")) goals.forEach(g => { if (g.title.toLowerCase().includes(q)) results.push({ type:"goal", id:g.id, name:g.title, status:g.status }); });
  } catch {}

  return { ok: true, results: results.slice(0, limit), total: results.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

function getEnterpriseContext() { return _ctx(); }
function updateEnterpriseContext(patch) {
  Object.assign(_ctx(), patch, { lastSync: new Date().toISOString() });
  _save("context");
  return _ctx();
}

module.exports = {
  // Companies
  createCompany, listCompanies, getCompany, updateCompany,
  // Workspaces
  createWorkspace, listWorkspaces, getWorkspace, updateWorkspace,
  // Products
  createProduct, listProducts, getProduct, updateProduct, advanceProductStage, PRODUCT_STAGES,
  // Customers
  createCustomer, listCustomers, getCustomer, updateCustomer,
  // Partners + Vendors + Contracts
  createPartner, listPartners, createVendor, listVendors, createContract, listContracts,
  // Portfolio
  createPortfolio, listPortfolios, createInitiative, listInitiatives, updateInitiative,
  createProgram, listPrograms,
  // Finance
  createEnterpriseBudget, allocateEnterpriseBudget, listEnterpriseBudgets,
  createForecast, listForecasts,
  // Governance
  createEnterprisePolicy, listEnterprisePolicies, evaluateEnterprisePolicy,
  createEnterpriseApproval, resolveEnterpriseApproval, listEnterpriseApprovals,
  createControl, listControls,
  addAuditEntry, getAuditTrail,
  // HR
  addHeadcount, listHeadcount,
  // Memory + Reports
  addEnterpriseMemory, listEnterpriseMemory,
  createEnterpriseReport, listEnterpriseReports,
  // KPIs
  getEnterpriseKpi, getAllEnterpriseKpis, updateEnterpriseKpi,
  // Health + Dashboard + Search
  getEnterpriseHealth, getEnterpriseDashboard, enterpriseSearch,
  // Context
  getEnterpriseContext, updateEnterpriseContext,
  // Constants
  DIVISION_IDS,
};
