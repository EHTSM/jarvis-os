#!/usr/bin/env node
"use strict";
/**
 * revenueAutomationEngine.cjs — Accounting Ecosystem mission.
 *
 * Discovery found revenueOS.cjs's generateInvoice(opts) takes a single
 * options object (opts.accountId, opts.amount, opts.plan, opts.period), but
 * revenueAutomationEngine.cjs's "prepare_invoice" automation action called it
 * as generateInvoice(accountId, {amount, plan, period}) — two positional
 * arguments. Since generateInvoice only declares one parameter, JavaScript
 * silently dropped the second argument; `opts` inside generateInvoice was
 * the bare accountId STRING, so `opts.accountId` was always undefined.
 *
 * Live effect, confirmed by tracing the real reachable path
 * (POST /revenue-engine/automate/prepare_invoice, requireAuth+operatorOnly,
 * "prepare_invoice" has requiresApproval:false so it executes immediately):
 * every automated invoice silently got accountId: undefined (via
 * billing.getRecord(undefined) creating/reading a bogus trial record),
 * ignored the real amount/plan/period the caller supplied (all fell back to
 * that bogus trial record's plan price), and the action still reported
 * {ok:true} — a real false-success on a real financial write, exactly what
 * this mission's False Success Rule forbids.
 *
 * A second, milder instance of the same argument-shape defect class was
 * found in the same function: createWinBackCampaign(accountId, templateId)
 * takes templateId as a plain string, but the call site passed an object
 * ({template, discount}), which never matches a real WINBACK_TEMPLATES id
 * ("wbt_1"/"wbt_2"/"wbt_3") — the caller's own "standard" default wasn't a
 * real template id either — so the wrong (always-first) template was
 * silently used regardless of what was requested.
 *
 * This test proves both fixes using the REAL revenueOS.cjs data store (no
 * mock), with distinctive test account IDs, and cleans up every record it
 * creates afterward so the shared data/revenue-os.json file is left exactly
 * as it was found. No real payment, no real customer, no real financial
 * side effect beyond a same-process JSON-file write/cleanup.
 *
 * Usage: node tests/security/152-revenue-automation-invoice-argument-fix.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");
const DATA_FILE = path.join(__dirname, "../../data/revenue-os.json");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function _readStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return null; }
}
function _writeStore(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }

async function main() {
  const rae = require("../../backend/services/revenueAutomationEngine.cjs");
  const testAccountId = `test_acct_152_${Date.now()}`;

  section("prepare_invoice — real accountId/amount/plan reach the invoice record (not undefined/dropped)");
  {
    const before = _readStore();
    const beforeInvoiceCount = before ? Object.keys(before.invoices || {}).length : 0;

    const result = await rae.automate("prepare_invoice", {
      accountId: testAccountId,
      amount: 4242,
      plan: "growth",
      period: "monthly",
    }, { skipExecute: false });

    assert(result.ok === true, "automate() resolves successfully for prepare_invoice", JSON.stringify(result));

    const after = _readStore();
    const invoices = Object.values(after.invoices || {});
    const created = invoices.find(i => i.accountId === testAccountId);

    assert(!!created, "a real invoice record now exists with the REAL accountId (not undefined)", JSON.stringify(invoices.slice(-1)));
    assert(created && created.accountId !== undefined && created.accountId !== "undefined", "accountId is never literally undefined on the stored record");
    assert(created && created.items?.[0]?.amount === 4242, "the caller's real amount (4242) reached the invoice, not a fallback default", created?.items?.[0]?.amount);
    assert(created && created.subtotal === 4242, "subtotal reflects the real requested amount", created?.subtotal);

    // Cleanup — remove only the record this test created, leave everything else untouched.
    if (created) {
      const fresh = _readStore();
      delete fresh.invoices[created.id];
      _writeStore(fresh);
    }
    const afterCleanup = _readStore();
    assert(Object.keys(afterCleanup.invoices || {}).length === beforeInvoiceCount, "cleanup restores the invoice store to its exact pre-test size", Object.keys(afterCleanup.invoices || {}).length);
  }

  section("prepare_invoice — no accountId supplied still falls back honestly to 'auto' (pre-existing default, unchanged)");
  {
    const result = await rae.automate("prepare_invoice", { amount: 111, plan: "starter" }, { skipExecute: false });
    assert(result.ok === true, "automate() still resolves when no accountId is given", JSON.stringify(result));

    const store = _readStore();
    const created = Object.values(store.invoices || {}).find(i => i.accountId === "auto" && i.subtotal === 111);
    assert(!!created, "the 'auto' fallback accountId still works and receives the real amount", JSON.stringify(store.invoices ? Object.values(store.invoices).slice(-1) : null));

    if (created) {
      const fresh = _readStore();
      delete fresh.invoices[created.id];
      _writeStore(fresh);
    }
  }

  section("win_back_campaign — a real template id reaches createWinBackCampaign (not an unmatched object)");
  {
    const result = await rae.automate("win_back_campaign", {
      accountId: testAccountId,
      templateId: "wbt_2",
    }, { skipExecute: false });

    assert(result.ok === true, "automate() resolves successfully for win_back_campaign", JSON.stringify(result));

    const store = _readStore();
    const campaigns = Object.values(store.winBackCampaigns || {}).length
      ? Object.values(store.winBackCampaigns)
      : (Array.isArray(store.winBackCampaigns) ? store.winBackCampaigns : []);
    const created = campaigns.find(c => c.accountId === testAccountId);

    assert(!!created, "a real win-back campaign record exists for the real accountId", JSON.stringify(campaigns.slice(-1)));
    assert(created && created.template?.id === "wbt_2", "the REQUESTED template (wbt_2) was used, not always the first template (wbt_1)", created?.template?.id);

    // Cleanup
    if (created) {
      const fresh = _readStore();
      if (Array.isArray(fresh.winBackCampaigns)) {
        fresh.winBackCampaigns = fresh.winBackCampaigns.filter(c => c.id !== created.id);
      } else if (fresh.winBackCampaigns) {
        delete fresh.winBackCampaigns[created.id];
      }
      _writeStore(fresh);
    }
  }

  section("win_back_campaign — default templateId falls back to a REAL template id (wbt_1), not the old non-existent 'standard'");
  {
    const result = await rae.automate("win_back_campaign", { accountId: testAccountId }, { skipExecute: false });
    assert(result.ok === true, "automate() resolves with no templateId supplied", JSON.stringify(result));

    const store = _readStore();
    const campaigns = Array.isArray(store.winBackCampaigns) ? store.winBackCampaigns : Object.values(store.winBackCampaigns || {});
    const created = campaigns.find(c => c.accountId === testAccountId);
    assert(!!created && created.template?.id === "wbt_1", "the default now resolves to a real template (wbt_1)", created?.template?.id);

    if (created) {
      const fresh = _readStore();
      if (Array.isArray(fresh.winBackCampaigns)) {
        fresh.winBackCampaigns = fresh.winBackCampaigns.filter(c => c.id !== created.id);
      } else if (fresh.winBackCampaigns) {
        delete fresh.winBackCampaigns[created.id];
      }
      _writeStore(fresh);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
