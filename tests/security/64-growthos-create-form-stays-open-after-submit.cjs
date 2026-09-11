#!/usr/bin/env node
"use strict";
/**
 * GrowthOS "+ New" forms stayed open after a successful create — Phase A.7
 * (Marketing Agency Certification, Growth OS G1 section).
 *
 * CONFIRMED finding (reproduced live: real agency account, Growth -> Email
 * -> "+ New" -> filled a real campaign -> "Create Campaign"): the toast said
 * "Campaign created" and the sub-tab list showed 0 -> stale, but the "+ New"
 * form remained the active view with all fields freshly reset — with no
 * visible confirmation the campaign existed beyond an easy-to-miss toast.
 * Clicking "Create Campaign" again (looking like nothing had happened)
 * created a second, near-duplicate campaign. Confirmed via the real
 * Campaigns list: two rows, "August Retainer Kickoff — Nimbus & Bloom",
 * from what a real founder would experience as one submit attempt.
 *
 * Root cause: GrowthOS.jsx's Email, SMS, and WhatsApp sub-components each
 * keep a single `view` state shared between their list tab(s) and their
 * "+ New" create tab. Every other create flow in this app (Contacts,
 * DistributionOS's Publisher/Campaigns/Influencers/etc, BusinessOS's
 * Leads/Contacts/Deals) already returns to the list view after a
 * successful create — GrowthOS's four create handlers were the only ones
 * that reset the form fields but never switched `view` back, silently
 * leaving the create form as the active tab.
 *
 * Fix: createCampaign/createSeq (Email), create (SMS), and createBroadcast
 * (WhatsApp) now call setView(...) back to their list tab after a
 * successful create, matching the pattern already used everywhere else in
 * this codebase. WhatsApp's createFlow/createAR and Push's createTrigger
 * were left untouched — those are inline list+form combos on a single tab,
 * not a separate "+ New" tab, so there's no stale-form state to reset.
 *
 * Verified live: SMS "+ New" -> fill -> Create Campaign -> lands back on
 * "Campaigns (N)" with the real campaign in the list, not a re-emptied
 * create form. 144/144 regression passing.
 *
 * Usage: node tests/security/64-growthos-create-form-stays-open-after-submit.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const src = fs.readFileSync(require.resolve("../../frontend/src/components/GrowthOS.jsx"), "utf8");

  section("Email: createCampaign returns to the campaigns list after success");
  {
    const fnMatch = src.match(/const createCampaign = async \(\) => \{[\s\S]*?\n  \};/);
    assert.ok(fnMatch, "could not find createCampaign");
    assert.ok(/reloadCamps\(\);\s*\n[\s\S]*?setView\("campaigns"\);/.test(fnMatch[0]),
      "createCampaign must call setView(\"campaigns\") after reloadCamps()");
    ok("createCampaign switches back to the campaigns list view");
  }

  section("Email: createSeq returns to the sequences list after success");
  {
    const fnMatch = src.match(/const createSeq = async \(\) => \{[\s\S]*?\n  \};/);
    assert.ok(fnMatch, "could not find createSeq");
    assert.ok(/setView\("sequences"\);/.test(fnMatch[0]), "createSeq must call setView(\"sequences\")");
    ok("createSeq switches back to the sequences list view");
  }

  section("SMS: create returns to the campaigns list after success");
  {
    const fnMatch = src.match(/const create = async \(\) => \{\s*\n\s*if \(!form\.name \|\| !form\.body\) return;\s*\n\s*await post\("\/growth\/sms\/campaigns"[\s\S]*?\n  \};/);
    assert.ok(fnMatch, "could not find SMS's create()");
    assert.ok(/setView\("campaigns"\);/.test(fnMatch[0]), "SMS create() must call setView(\"campaigns\")");
    ok("SMS create() switches back to the campaigns list view");
  }

  section("WhatsApp: createBroadcast returns to the broadcasts list after success");
  {
    const fnMatch = src.match(/const createBroadcast = async \(\) => \{[\s\S]*?\n  \};/);
    assert.ok(fnMatch, "could not find createBroadcast");
    assert.ok(/setView\("broadcasts"\);/.test(fnMatch[0]), "createBroadcast must call setView(\"broadcasts\")");
    ok("createBroadcast switches back to the broadcasts list view");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
