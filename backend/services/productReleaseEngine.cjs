"use strict";
/**
 * productReleaseEngine.cjs — POST-Ω P12 Autonomous Product Factory
 *
 * Generates release notes, deployment plan, rollback plan,
 * monitoring plan and coordinates the final release.
 *
 * Reuses: productionBibleEngine, deploymentValidator, founderAutomationEngine,
 *         approvalEngine, digitalTwinEngine, continuousLearningEngine,
 *         selfReviewEngine, founderWorkRegistry.
 *
 * Storage: data/product-releases.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "product-releases.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _fa   = () => _try(() => require("./founderAutomationEngine.cjs"));
const _apr  = () => _try(() => require("./approvalEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _srev = () => _try(() => require("./selfReviewEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _pve  = () => _try(() => require("./productValidationEngine.cjs"));

function _ts()    { return new Date().toISOString(); }
function _id()    { return `pr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }
function _ver()   { return `1.0.${Math.floor(Date.now() / 1000) % 1000}`; }

// ── Release artifacts ─────────────────────────────────────────────────────────

function _buildReleaseNotes(plan, validation) {
  const score = validation?.overallScore || 0;
  const dims  = validation?.dimensions || {};
  return {
    version:    _ver(),
    title:      `Release: ${plan.objective}`,
    summary:    `Autonomous product release — ${plan.complexity?.level || "medium"} complexity, ${plan.platformReuse} platform capabilities reused.`,
    highlights: [
      `Validation score: ${score}/100`,
      `Security: ${dims.security?.score || 0}/100`,
      `Performance: ${dims.performance?.score || 0}/100`,
      `Accessibility: ${dims.accessibility?.score || 0} (WCAG ${dims.accessibility?.wcagLevel || "AA"})`,
      `Production Bible compliance: ${dims.bible_compliance?.compliant || 0}/${dims.bible_compliance?.workflows || 0} workflows`,
    ],
    requirements: plan.requirements?.length || 0,
    roadmapPhases: plan.roadmap?.phases?.length || 0,
    generatedAt: _ts(),
  };
}

function _buildDeploymentPlan(plan, validation) {
  const steps = [
    { step: 1, action: "Environment pre-flight check",  owner: "deploymentValidator",    automated: true,  minutesSaved: 10 },
    { step: 2, action: "Database migration dry-run",    owner: "autonomousExecution",     automated: true,  minutesSaved: 20 },
    { step: 3, action: "Staging environment deploy",    owner: "workspaceMesh",           automated: true,  minutesSaved: 30 },
    { step: 4, action: "Smoke test suite",              owner: "productValidationEngine", automated: true,  minutesSaved: 25 },
    { step: 5, action: "Founder digital twin sign-off", owner: "digitalTwinEngine",       automated: true,  minutesSaved: 15 },
    { step: 6, action: "Blue/green production switch",  owner: "productionBibleEngine",   automated: true,  minutesSaved: 20 },
    { step: 7, action: "Post-deploy health verify",     owner: "deploymentValidator",     automated: true,  minutesSaved: 10 },
  ];
  const totalMinutes = steps.reduce((s, t) => s + t.minutesSaved, 0);
  return { steps, estimatedMinutes: totalMinutes, automatedSteps: steps.filter(s => s.automated).length };
}

function _buildRollbackPlan(plan) {
  return {
    trigger:  "Validation score drops below 60 OR health check fails",
    steps: [
      "Halt production traffic via nginx upstream switch",
      "Restore previous deployment via bible rollback workflow",
      "Run post-rollback smoke test",
      "Alert via ops-alerts system",
      "Create incident mission in missionOrchestrator",
    ],
    automatedRollback: true,
    estimatedRollbackMinutes: 5,
  };
}

function _buildMonitoringPlan() {
  return {
    checks: [
      { metric: "API response time (p95)", threshold: "< 500ms",  interval: "1m",  source: "metricsService" },
      { metric: "Error rate",              threshold: "< 1%",      interval: "1m",  source: "metricsService" },
      { metric: "Memory usage",            threshold: "< 80%",     interval: "5m",  source: "processMetrics" },
      { metric: "Database query time",     threshold: "< 100ms",   interval: "2m",  source: "metricsService" },
      { metric: "Authentication success",  threshold: "> 99%",     interval: "5m",  source: "authMiddleware" },
    ],
    alertChannels: ["ops-alerts.json", "missionOrchestrator", "digitalTwinEngine"],
    selfHealingEnabled: true,
  };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      releases: [],
      stats: { total: 0, released: 0, pendingApproval: 0, minutesSaved: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.releases.length > 200) d.releases = d.releases.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core: prepare ─────────────────────────────────────────────────────────────

async function prepare(planId, { skipExecute = false } = {}) {
  const plan       = _ppe()?.getPlan?.(planId);
  if (!plan) return { ok: false, error: `plan not found: ${planId}` };

  const validation = _pve()?.getValidationForPlan?.(planId) || null;
  if (!validation?.productionReady && !skipExecute) {
    return { ok: false, error: "product has not passed validation — run validate() first" };
  }

  const id = _id();

  const releaseNotes    = _buildReleaseNotes(plan, validation);
  const deploymentPlan  = _buildDeploymentPlan(plan, validation);
  const rollbackPlan    = _buildRollbackPlan(plan);
  const monitoringPlan  = _buildMonitoringPlan();

  // Get bible deploy workflow IDs
  let bibleWorkflows = [];
  try {
    const bible = _pb()?.getBible?.();
    if (bible?.workflows) {
      bibleWorkflows = bible.workflows
        .filter(w => w.category === "deployment" || w.category === "release")
        .slice(0, 5)
        .map(w => ({ id: w.id, title: w.title, automated: w.automated }));
    }
  } catch {}

  // Deployment validator pre-check
  let preCheck = { ok: true, score: 80, source: "mock" };
  if (!skipExecute) {
    try {
      const dc = _dv()?.runCheck?.();
      if (dc) preCheck = { ok: dc.ok, score: dc.score || 80, source: "deploymentValidator" };
    } catch {}
  }

  // Digital twin approves release
  let twinApproval = "approve_release";
  try {
    const dt = _dt();
    if (dt?.decide && !skipExecute) {
      const dec = await dt.decide(`release_approval_${planId}`, {
        domain:  "product_release",
        risk:    (validation?.overallScore || 0) < 75 ? "high" : "low",
        context: { validationScore: validation?.overallScore, preCheck },
      });
      // Normalise whatever the twin returns to one of our 3 options
      const raw = dec?.action || dec?.choice || "approve_release";
      if (/hold|review/i.test(raw))  twinApproval = "hold_for_review";
      else if (/block|reject/i.test(raw)) twinApproval = "block_release";
      else                            twinApproval = "approve_release";
    }
  } catch {}

  // Request formal approval if twin says hold
  let approvalId = null;
  if (twinApproval === "hold_for_review" && !skipExecute) {
    try {
      const apr = _apr()?.requestApproval?.({
        context:     `product_release_${planId}`,
        description: `Release approval for: ${plan.objective}`,
        data:        { releaseNotes, deploymentPlan },
        source:      "productReleaseEngine",
      });
      if (apr?.ok) approvalId = apr.sessionId;
    } catch {}
  }

  // Record release outcome in CLE
  try {
    _cle()?.createLesson?.({
      context:  `product_release_${planId}`,
      outcome:  twinApproval.startsWith("approve") ? "success" : "hold",
      lesson:   `Release prepared: ${releaseNotes.version} — twin decision: ${twinApproval}`,
      source:   "productReleaseEngine",
    });
  } catch {}

  // Mark founder workflow as automated
  try {
    _fwr()?.markAutomated?.("product_release_and_deployment");
  } catch {}

  const totalMinutesSaved = deploymentPlan.estimatedMinutes + (validation?.dimensions
    ? 20 : 0);

  const release = {
    id, planId,
    version:      releaseNotes.version,
    status:       twinApproval.startsWith("approve") ? "ready" : "pending_approval",
    twinDecision: twinApproval,
    approvalId,
    releaseNotes,
    deploymentPlan,
    rollbackPlan,
    monitoringPlan,
    bibleWorkflows,
    preCheck,
    productionReady: preCheck.ok && (validation?.productionReady || skipExecute),
    minutesSaved:   totalMinutesSaved,
    createdAt:      _ts(),
    updatedAt:      _ts(),
  };

  const d = _load();
  d.releases.push(release);
  d.stats = {
    total:          d.releases.length,
    released:       d.releases.filter(r => r.status === "ready").length,
    pendingApproval:d.releases.filter(r => r.status === "pending_approval").length,
    minutesSaved:   d.releases.reduce((s, r) => s + (r.minutesSaved || 0), 0),
  };
  _save(d);

  return { ok: true, release };
}

function getRelease(id)        { return _load().releases.find(r => r.id === id) || null; }
function getReleaseForPlan(pid){ return _load().releases.filter(r => r.planId === pid).pop() || null; }
function listReleases({ limit = 50, status } = {}) {
  let list = _load().releases;
  if (status) list = list.filter(r => r.status === status);
  return { ok: true, releases: list.slice(-limit).reverse(), total: list.length };
}
function getStats() {
  const d = _load();
  return { ...d.stats, updatedAt: d.updatedAt };
}

module.exports = { prepare, getRelease, getReleaseForPlan, listReleases, getStats };
