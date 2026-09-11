#!/usr/bin/env node
"use strict";
/**
 * Business Org synthetic-data disclosure regression —
 * backend/services/businessOrg.cjs / businessOrgWorkflow.cjs / businessOrgState.cjs.
 *
 * CONFIRMED finding (Zero-Trust Competitor Remediation, Phase 2, classified
 * REAL not DEMO — meaning the fabrication was live and automatic, not an
 * opt-in demo mode): businessOrg.cjs's _growthTick/_crmTick generate
 * fictional company names ("Prospect Alpha", "Beta Dynamics", "Acme Corp",
 * etc.) and Math.random()-based lead values/scores, on a real setInterval
 * that starts automatically and unconditionally on every server boot
 * (server.js's "Level 3: Business Organization" registration, no env/
 * feature-flag guard) — then a setTimeout cascade in businessOrgWorkflow.cjs
 * auto-advances these fake deals through demo→proposal→closed_won with no
 * real customer action. Reproduced live: booted the server, confirmed real
 * "Acme Corp" records already persisted in data/business-leads.json,
 * data/business-contacts.json, and data/business-opportunities.json from
 * ticks that fired during this remediation's earlier testing. The
 * dashboard (GET /bizorg/v3/dashboard) reported this fabricated data with
 * zero disclosure — revenue/lead counts included synthetic deals
 * indistinguishably from real ones.
 *
 * Fix (chosen over deleting the demo pipeline outright, which the
 * mission's "no new architecture / no expansion" constraint ruled out,
 * and over doing nothing, which the mission's "never leave ambiguous
 * simulation" rule ruled out): every fabrication call site now passes
 * `synthetic: true` through growthCaptureLead() → createDeal(), so the
 * flag is persisted with the record. getDashboard() now reports a
 * `dataIntegrity` breakdown (totalDeals/syntheticDeals/realDeals/note)
 * so any consumer can see the split rather than trusting an undifferentiated
 * revenue/lead total. The real HTTP-triggered lead-capture route
 * (backend/routes/businessOrg.js:254) is unaffected — synthetic defaults
 * to false there.
 *
 * Known limitation, documented rather than silently left implicit:
 * records created BEFORE this fix have no synthetic flag and are counted
 * as "real" by getDashboard() purely because they predate the flag, not
 * because their origin was verified — a full historical backfill was out
 * of scope for this remediation.
 *
 * Usage: node tests/security/29-bizorg-synthetic-data-disclosure.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

section("Static — fabrication call sites are tagged synthetic:true");
{
  const bizOrgSrc = require("fs").readFileSync("backend/services/businessOrg.cjs", "utf8");
  assert(/growthCaptureLead\(\{[^}]*synthetic:\s*true/.test(bizOrgSrc), "businessOrg.cjs's _growthTick call site passes synthetic:true", "no synthetic:true found on the growthCaptureLead call in businessOrg.cjs");

  const wfSrc = require("fs").readFileSync("backend/services/businessOrgWorkflow.cjs", "utf8");
  assert(/growthCaptureLead\(\{[^}]*synthetic:\s*true/.test(wfSrc), "businessOrgWorkflow.cjs's campaign-launch simulation call site passes synthetic:true", "no synthetic:true found on the growthCaptureLead call in businessOrgWorkflow.cjs");
}

section("Live — growthCaptureLead() and createDeal() correctly persist and default the flag");
{
  delete require.cache[require.resolve("../../backend/services/businessOrgState.cjs")];
  delete require.cache[require.resolve("../../backend/services/businessOrgWorkflow.cjs")];
  const state = require("../../backend/services/businessOrgState.cjs");
  const wf = require("../../backend/services/businessOrgWorkflow.cjs");

  const suffix = Date.now();
  const syntheticDeal = wf.growthCaptureLead({ campaignId: `test-${suffix}`, company: `Synthetic Test Co ${suffix}`, value: 1500, source: "demo_simulation", synthetic: true });
  assert(syntheticDeal?.synthetic === true, "a lead created with synthetic:true persists that flag on the deal record", `got synthetic=${syntheticDeal?.synthetic}`);

  const realDeal = wf.growthCaptureLead({ campaignId: `test-real-${suffix}`, company: `Real Test Co ${suffix}`, value: 5000 });
  assert(realDeal?.synthetic === false, "a lead created WITHOUT synthetic (matching the real HTTP route's call shape) defaults to synthetic:false", `got synthetic=${realDeal?.synthetic}`);
}

section("Live — getDashboard() discloses the synthetic/real split");
{
  delete require.cache[require.resolve("../../backend/services/businessOrgState.cjs")];
  const state = require("../../backend/services/businessOrgState.cjs");
  const dashboard = state.getDashboard();

  assert(typeof dashboard.dataIntegrity === "object", "getDashboard() includes a dataIntegrity object", `dashboard has no dataIntegrity field: ${JSON.stringify(Object.keys(dashboard))}`);
  assert(typeof dashboard.dataIntegrity?.syntheticDeals === "number", "dataIntegrity.syntheticDeals is a number", `got ${JSON.stringify(dashboard.dataIntegrity?.syntheticDeals)}`);
  assert(typeof dashboard.dataIntegrity?.realDeals === "number", "dataIntegrity.realDeals is a number", `got ${JSON.stringify(dashboard.dataIntegrity?.realDeals)}`);
  assert(dashboard.dataIntegrity?.syntheticDeals + dashboard.dataIntegrity?.realDeals === dashboard.dataIntegrity?.totalDeals, "synthetic + real deal counts sum to the total", `${dashboard.dataIntegrity?.syntheticDeals} + ${dashboard.dataIntegrity?.realDeals} !== ${dashboard.dataIntegrity?.totalDeals}`);
  assert(typeof dashboard.dataIntegrity?.note === "string" && dashboard.dataIntegrity.note.length > 0, "dataIntegrity includes a human-readable disclosure note", `got note=${JSON.stringify(dashboard.dataIntegrity?.note)}`);
}

section("Regression guard — the real HTTP lead-capture route's call shape is unaffected");
{
  const routeSrc = require("fs").readFileSync("backend/routes/businessOrg.js", "utf8");
  const callSiteMatch = routeSrc.match(/_wf\(\)\.growthCaptureLead\(\{[^}]*\}\)/);
  assert(!!callSiteMatch, "the real lead-capture route's growthCaptureLead call site is found", "could not locate the route's growthCaptureLead call — route file structure may have changed");
  if (callSiteMatch) {
    assert(!callSiteMatch[0].includes("synthetic: true") && !callSiteMatch[0].includes("synthetic:true"), "the real route's call site does NOT pass synthetic:true (would mislabel real leads as fake)", `route call site: ${callSiteMatch[0]}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Business Org Synthetic Data Disclosure Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  process.exit(1);
}
process.exit(0);
