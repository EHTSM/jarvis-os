"use strict";
/**
 * marketplaceAutomationEngine.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Automatically publishes, updates, versions, deprecates and retires
 * marketplace assets. Wires into autonomousExecutionEngine, approvalEngine,
 * and productionBibleEngine for gated operations.
 *
 * Reuses: autonomousExecutionEngine, approvalEngine, productionBibleEngine,
 *         marketplaceCatalogEngine, marketplaceCertificationEngine,
 *         continuousLearningEngine, evolutionEvolutionEngine (OSE X),
 *         founderWorkRegistry.
 *
 * Automation actions: publish, update, version_bump, deprecate, retire, re_certify
 *
 * Storage: data/marketplace-automations.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "marketplace-automations.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _aq   = () => _try(() => require("./approvalQueue.cjs"));
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _mce2 = () => _try(() => require("./marketplaceCertificationEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `mau_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Automation action definitions ─────────────────────────────────────────────

const AUTOMATION_ACTIONS = {
  publish:       { label: "Publish Asset",        requiresApproval: false, minutesSaved: 30 },
  update:        { label: "Update Asset",         requiresApproval: false, minutesSaved: 20 },
  version_bump:  { label: "Version Bump",         requiresApproval: false, minutesSaved: 15 },
  deprecate:     { label: "Deprecate Asset",      requiresApproval: true,  minutesSaved: 25 },
  retire:        { label: "Retire Asset",         requiresApproval: true,  minutesSaved: 20 },
  re_certify:    { label: "Re-certify Asset",     requiresApproval: false, minutesSaved: 40 },
};

// ── Version bumping ───────────────────────────────────────────────────────────

function _bumpVersion(current = "1.0.0", bump = "patch") {
  const [major, minor, patch] = (current || "1.0.0").split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      automations: [],
      stats: { total: 0, executed: 0, pending: 0, minutesSaved: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.automations.length > 500) d.automations = d.automations.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _updateStats(d) {
  const executed    = d.automations.filter(a => a.status === "executed").length;
  const pending     = d.automations.filter(a => a.status === "pending").length;
  const minutesSaved= d.automations.filter(a => a.status === "executed")
    .reduce((s, a) => s + (AUTOMATION_ACTIONS[a.action]?.minutesSaved || 0), 0);
  d.stats = { total: d.automations.length, executed, pending, minutesSaved };
}

// ── Core: automate ────────────────────────────────────────────────────────────

async function automate(assetId, action, { context = {}, skipExecute = false, bumpType = "patch" } = {}) {
  if (!assetId) return { ok: false, error: "assetId required" };
  const def = AUTOMATION_ACTIONS[action];
  if (!def) return { ok: false, error: `unknown action: ${action}` };

  const asset = _mce()?.getAsset?.(assetId) || null;
  if (!asset) return { ok: false, error: `asset not found: ${assetId}` };

  const id   = _id();
  const auto = {
    id, assetId, assetName: asset.name, assetType: asset.type,
    action, label: def.label,
    status: "pending",
    requiresApproval: def.requiresApproval,
    minutesSaved: def.minutesSaved,
    context,
    createdAt: _ts(), updatedAt: _ts(),
  };

  if (!skipExecute) {
    try {
      if (def.requiresApproval) {
        // Phase 4 Missions 171-173 (Trust/Verify — approval gating): this
        // used to call approvalEngine.cjs's requestApproval(workflowId, opts)
        // with an *options object* as the first (workflowId) argument — a
        // real, pre-existing, live-reproduced bug (requestApproval({...}) ->
        // generateApprovalPackage(<object>, ...) -> founderWorkRegistry
        // .getWorkflow(<object>) -> always "workflow not found", confirmed
        // via direct invocation before this fix). The call was wrapped in
        // _try() and its result was never inspected, so the real failure was
        // silently swallowed and auto.status was set to "awaiting_approval"
        // unconditionally — an operator calling this action believed a real
        // human-approval gate was now pending when, in fact, nothing had
        // been enqueued anywhere and nothing could ever resolve it. This is
        // exactly the "return success before the operation actually
        // completed" anti-pattern CLAUDE.md §18 names.
        //
        // Fix: enqueue directly via approvalQueue.cjs (the same lower-level,
        // non-founderWorkRegistry-dependent primitive missionOrchestrator
        // .cjs's own Approval-node stages already use, per
        // reports/PHASE-3-WORKFLOW-AUTONOMY-PROGRESS.md §4) and only mark
        // this automation "awaiting_approval" when a real request id comes
        // back. No auto-resume bridge is added here (that would be a second,
        // marketplace-specific approval bridge on top of Phase 3's
        // orchestratorApprovalBridge.cjs — a real remaining gap, honestly
        // reported in this mission's report rather than built, since this
        // route is operatorOnly with no frontend consumer and building a
        // second bridge is out of this mission's narrow-fix scope).
        const enq = _try(() => _aq()?.enqueue?.({
          action:          `marketplace_${action}`,
          reason:          `${def.label} for asset: ${asset.name}`,
          risk:            "medium",
          approvalType:    "GENERIC",
          expectedOutcome: `${def.label} applied to asset ${asset.name}`,
          rollbackPlan:    "No automatic rollback — re-run automate() with the prior action to reverse.",
          context:         { assetId, action, assetName: asset.name, ...context },
          triggeredBy:     "marketplaceAutomationEngine",
        }));
        if (enq?.reqId) {
          auto.status = "awaiting_approval";
          auto.approvalReqId = enq.reqId;
        } else {
          auto.status = "failed";
          auto.error  = "approval request could not be enqueued";
        }
      } else {
        // Execute automation via execution engine
        _try(() => _exe()?.executeWorkflow?.(`marketplace_${action}`, {
          triggeredBy: "marketplaceAutomationEngine",
          context:     { assetId, action, assetName: asset.name, ...context },
        }));
        // Apply action side-effects
        if (action === "version_bump") {
          auto.newVersion = _bumpVersion(asset.version, bumpType);
          _try(() => _mce()?.setAssetVersion?.(assetId, auto.newVersion, { bumpType }));
        }
        if (action === "re_certify") {
          _try(() => _mce2()?.certify?.(assetId));
        }
        // Record in CLE
        _try(() => _cle()?.createLesson?.({
          context: `marketplace_auto_${assetId}`,
          outcome: "success",
          lesson:  `${def.label} executed for ${asset.name}`,
          source:  "marketplaceAutomationEngine",
        }));
        auto.status = "executed";
        auto.executedAt = _ts();
      }
    } catch (e) {
      auto.status = "failed";
      auto.error  = e.message;
    }
  } else {
    // Test mode
    auto.status = "executed";
    auto.executedAt = _ts();
    if (action === "version_bump") auto.newVersion = _bumpVersion(asset.version, bumpType);
  }

  auto.updatedAt = _ts();
  const d = _load();
  d.automations.push(auto);
  _updateStats(d);
  _save(d);

  return { ok: true, automation: auto };
}

// ── Lifecycle scan: detect assets needing automated action ────────────────────

async function runLifecycleScan({ skipExecute = false } = {}) {
  const allAssets = _mce()?.listAssets?.({ limit: 2000 })?.assets || [];
  const triggered = [];

  for (const asset of allAssets.slice(0, 200)) {
    // Detect stale assets (> 30 days old, never downloaded)
    const ageMs = Date.now() - new Date(asset.discoveredAt || asset.createdAt || 0).getTime();
    if (ageMs > 30 * 86400000 && (asset.downloads || 0) === 0 && asset.status === "published") {
      const r = await automate(asset.id, "deprecate", { context: { reason: "stale_no_downloads" }, skipExecute });
      if (r.ok) triggered.push({ assetId: asset.id, action: "deprecate" });
      continue;
    }

    // Re-certify assets with high downloads but no certification
    if ((asset.downloads || 0) >= 5) {
      const cert = _mce2()?.getCertificationForAsset?.(asset.id);
      if (!cert) {
        const r = await automate(asset.id, "re_certify", { skipExecute });
        if (r.ok) triggered.push({ assetId: asset.id, action: "re_certify" });
      }
    }
  }

  return { ok: true, scanned: Math.min(allAssets.length, 200), triggered: triggered.length, actions: triggered };
}

function getAutomation(id)      { return _load().automations.find(a => a.id === id) || null; }
function listAutomations({ action, status, assetType, limit = 50 } = {}) {
  let list = _load().automations;
  if (action)    list = list.filter(a => a.action    === action);
  if (status)    list = list.filter(a => a.status    === status);
  if (assetType) list = list.filter(a => a.assetType === assetType);
  return { ok: true, automations: list.slice(0, limit) };
}
function getStats() {
  const d = _load();
  return { ...d.stats, AUTOMATION_ACTIONS: Object.keys(AUTOMATION_ACTIONS), updatedAt: d.updatedAt };
}

module.exports = {
  AUTOMATION_ACTIONS, automate, runLifecycleScan,
  getAutomation, listAutomations, getStats,
};
