"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * PHASE 4 — CAPABILITY MARKETPLACE (Missions 161-175) — regression test
 *
 * Covers two genuine, live-reproduced gaps found and fixed this mission in
 * the pre-existing POST-Ω P13 "Autonomous Marketplace" subsystem
 * (backend/services/marketplaceCatalogEngine.cjs /
 * marketplaceAutomationEngine.cjs), reached via /auto-market/* per
 * backend/routes/autonomousMarketplace.js:
 *
 * 1. Missions 168-170 (Versioning): automate("version_bump", ...) computed
 *    a real, correct new semver string but never wrote it back onto the
 *    catalog asset's own `version` field — getAsset(id).version stayed at
 *    its original value forever. Live-reproduced before this fix (bump from
 *    1.0.0 with bumpType "minor" left the real catalog record at 1.0.0
 *    while the automation record claimed newVersion "1.1.0"). Fixed via a
 *    new, additive marketplaceCatalogEngine.setAssetVersion() (immutable
 *    versionHistory, not just an overwritten pointer) called from
 *    marketplaceAutomationEngine's non-approval execution branch.
 *
 * 2. Missions 171-173 (Trust/Verify — approval gating): the requiresApproval
 *    branch (deprecate/retire) called approvalEngine.cjs's
 *    requestApproval(workflowId, opts) with an *options object* as the
 *    workflowId argument — a real, pre-existing bug that always resolved to
 *    "workflow not found" internally. The failure was swallowed by a bare
 *    _try() with its result discarded, so auto.status was unconditionally
 *    set to "awaiting_approval" regardless of whether anything was actually
 *    enqueued — a fabricated-pending-approval anti-pattern (CLAUDE.md §18).
 *    Fixed by calling approvalQueue.cjs's enqueue() directly (the same
 *    lower-level primitive missionOrchestrator.cjs's own Approval-node
 *    stages use, per reports/PHASE-3-WORKFLOW-AUTONOMY-PROGRESS.md §4) and
 *    only reporting "awaiting_approval" when a real request id comes back;
 *    otherwise the automation is honestly marked "failed".
 *
 * Isolation: marketplaceCatalogEngine.cjs, marketplaceAutomationEngine.cjs,
 * and approvalQueue.cjs are required from throwaway mkdtempSync copies
 * (the established pattern from tests/runtime/_isolatedMissionMemory.helper
 * .cjs and tests/runtime/orchestrator-approval-and-compensation-phase3.test
 * .cjs) so this test writes zero bytes to the real
 * data/auto-marketplace-catalog.json, data/marketplace-automations.json, or
 * data/approval-queue.json. The pre-existing tests/runtime/p13-autonomous-
 * marketplace.test.cjs does NOT use isolation (it requires the real
 * modules directly) — that is a pre-existing condition of this repo, not
 * introduced or fixed by this mission (out of this mission's narrow scope;
 * reported honestly in reports/PHASE-4-CAPABILITY-MARKETPLACE-PROGRESS.md).
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_ROOT = path.join(__dirname, "..", "..");

function buildIsolatedMarketplace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-iso-"));
  fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });

  const files = [
    "marketplaceCatalogEngine.cjs",
    "marketplaceAutomationEngine.cjs",
    "approvalQueue.cjs",
  ];
  const copiedPaths = {};
  for (const f of files) {
    const dest = path.join(root, "backend", "services", f);
    fs.copyFileSync(path.join(REAL_ROOT, "backend", "services", f), dest);
    copiedPaths[f] = dest;
  }

  const mce = require(copiedPaths["marketplaceCatalogEngine.cjs"]);
  const mae = require(copiedPaths["marketplaceAutomationEngine.cjs"]);

  return {
    mce, mae, root,
    catalogFile: path.join(root, "data", "auto-marketplace-catalog.json"),
    automationsFile: path.join(root, "data", "marketplace-automations.json"),
    cleanup() {
      for (const f of files) {
        try { delete require.cache[require.resolve(copiedPaths[f])]; } catch { /* noop */ }
      }
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); fail++; }
}

async function main() {
  console.log("\n── Marketplace Versioning + Approval Gate (Phase 4) ──");

  // ── Real production data untouched, confirmed before running anything ──
  const realCatalogPath = path.join(REAL_ROOT, "data", "auto-marketplace-catalog.json");
  const realAutomationsPath = path.join(REAL_ROOT, "data", "marketplace-automations.json");
  const realCatalogBefore = fs.existsSync(realCatalogPath) ? fs.statSync(realCatalogPath).size : null;
  const realAutomationsBefore = fs.existsSync(realAutomationsPath) ? fs.statSync(realAutomationsPath).size : null;

  // ── Section 1: setAssetVersion() / setAssetStatus() exist and work ─────
  {
    const iso = buildIsolatedMarketplace();
    const { mce } = iso;

    test("setAssetVersion and setAssetStatus are exported", () => {
      assert.strictEqual(typeof mce.setAssetVersion, "function");
      assert.strictEqual(typeof mce.setAssetStatus, "function");
    });

    test("setAssetVersion rejects a non-semver version", () => {
      const pub = mce.publishAsset({ type: "plugin", name: "v-test-1", version: "1.0.0" });
      const r = mce.setAssetVersion(pub.asset.id, "not-a-version");
      assert.strictEqual(r.ok, false);
    });

    test("setAssetVersion updates the real catalog record and preserves history", () => {
      const pub = mce.publishAsset({ type: "plugin", name: "v-test-2", version: "1.0.0" });
      const r = mce.setAssetVersion(pub.asset.id, "1.1.0", { bumpType: "minor" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.version, "1.1.0");
      assert.strictEqual(r.previousVersion, "1.0.0");

      const after = mce.getAsset(pub.asset.id);
      assert.strictEqual(after.version, "1.1.0", "catalog asset version must actually change");
      assert.ok(Array.isArray(after.versionHistory), "version history must be tracked");
      assert.strictEqual(after.versionHistory.length, 2, "history: original + new version");
      assert.strictEqual(after.versionHistory[0].version, "1.0.0", "original version stays in history (immutable, not overwritten)");
      assert.strictEqual(after.versionHistory[1].version, "1.1.0");
    });

    test("setAssetVersion on unknown asset returns ok:false, not a throw", () => {
      const r = mce.setAssetVersion("does-not-exist", "2.0.0");
      assert.strictEqual(r.ok, false);
    });

    test("setAssetStatus rejects an invalid status", () => {
      const pub = mce.publishAsset({ type: "plugin", name: "v-test-3", version: "1.0.0" });
      const r = mce.setAssetStatus(pub.asset.id, "banana");
      assert.strictEqual(r.ok, false);
    });

    test("setAssetStatus updates the real catalog record and tracks history", () => {
      const pub = mce.publishAsset({ type: "plugin", name: "v-test-4", version: "1.0.0" });
      assert.strictEqual(pub.asset.status, "published");
      const r = mce.setAssetStatus(pub.asset.id, "deprecated", { reason: "stale" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.status, "deprecated");
      assert.strictEqual(r.previousStatus, "published");

      const after = mce.getAsset(pub.asset.id);
      assert.strictEqual(after.status, "deprecated");
      assert.ok(Array.isArray(after.statusHistory) && after.statusHistory.length === 1);
    });

    iso.cleanup();
  }

  // ── Section 2: automate("version_bump") now genuinely writes back ──────
  {
    const iso = buildIsolatedMarketplace();
    const { mce, mae } = iso;

    await atest("automate('version_bump') with skipExecute:false updates the real catalog asset (THE FIX)", async () => {
      const pub = mce.publishAsset({ type: "plugin", name: "auto-bump-test", version: "1.0.0" });
      const before = mce.getAsset(pub.asset.id);
      assert.strictEqual(before.version, "1.0.0");

      const r = await mae.automate(pub.asset.id, "version_bump", { skipExecute: false, bumpType: "minor" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.automation.status, "executed");
      assert.strictEqual(r.automation.newVersion, "1.1.0");

      const after = mce.getAsset(pub.asset.id);
      assert.strictEqual(after.version, "1.1.0", "THE FIX: real catalog version must now match automation.newVersion");
    });

    await atest("automate('version_bump') with skipExecute:true (dry run) does NOT mutate the real catalog", async () => {
      const pub = mce.publishAsset({ type: "plugin", name: "auto-bump-dryrun", version: "2.0.0" });
      const r = await mae.automate(pub.asset.id, "version_bump", { skipExecute: true, bumpType: "major" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.automation.newVersion, "3.0.0");

      const after = mce.getAsset(pub.asset.id);
      assert.strictEqual(after.version, "2.0.0", "dry run (skipExecute) must never touch real catalog state");
    });

    iso.cleanup();
  }

  // ── Section 3: deprecate/retire approval gating is now honest ──────────
  {
    const iso = buildIsolatedMarketplace();
    const { mce, mae } = iso;

    await atest("automate('deprecate') genuinely enqueues a real approval request (THE FIX)", async () => {
      const pub = mce.publishAsset({ type: "plugin", name: "deprecate-test", version: "1.0.0" });
      const r = await mae.automate(pub.asset.id, "deprecate", { skipExecute: false });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.automation.status, "awaiting_approval",
        "must only claim awaiting_approval when a real request was enqueued");
      assert.ok(r.automation.approvalReqId, "a real approval queue request id must be recorded");

      // Confirm it's a genuinely different id space than the automation's own id
      assert.notStrictEqual(r.automation.approvalReqId, r.automation.id);
    });

    await atest("deprecate/retire never apply a status change without a resolved approval (no fabricated success)", async () => {
      const pub = mce.publishAsset({ type: "plugin", name: "retire-test", version: "1.0.0" });
      await mae.automate(pub.asset.id, "retire", { skipExecute: false });

      // The whole point of the fix: requesting approval must NEVER, by
      // itself, change the asset's real status. Only a genuine downstream
      // approval-resolution bridge (not built this mission — honestly
      // reported as a remaining gap) may do that.
      const after = mce.getAsset(pub.asset.id);
      assert.strictEqual(after.status, "published", "status must remain unchanged pending real approval");
    });

    iso.cleanup();
  }

  // ── Real production data integrity check ────────────────────────────────
  test("real data/auto-marketplace-catalog.json was not modified by this test file", () => {
    const nowSize = fs.existsSync(realCatalogPath) ? fs.statSync(realCatalogPath).size : null;
    assert.strictEqual(nowSize, realCatalogBefore);
  });
  test("real data/marketplace-automations.json was not modified by this test file", () => {
    const nowSize = fs.existsSync(realAutomationsPath) ? fs.statSync(realAutomationsPath).size : null;
    assert.strictEqual(nowSize, realAutomationsBefore);
  });

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
