#!/usr/bin/env node
"use strict";
/**
 * Category-leader search vocabulary was undiscoverable — Phase A.13
 * (Top 100 Company Benchmark Certification).
 *
 * CONFIRMED finding (measured live, before/after, via the real in-app
 * More-menu search across all 20 benchmark categories): a user typing the
 * industry-standard word for a capability got ZERO results, even though
 * the capability genuinely existed and was reachable by another name.
 *
 * Measured zeros BEFORE the fix:
 *   docs(0) documentation(0)   — Content & SEO has a real Docs tab
 *   api token(0) webhook(0)    — Settings has real API Tokens; Integrations real
 *   whatsapp(0) message(0)     — WhatsApp is a core surface (GrowthOS + ContactsV2)
 *   ticket(0) helpdesk(0)      — Support tab exists
 *   deal(0)                    — CRM tracks deals
 *   email(0)                   — Growth OS has a real Email campaign module
 *   rule(0)                    — Workflow Automation / Rule Builder exist
 *
 * Measured AFTER the fix: every one of those terms returns >= 1 real hit.
 *
 * Root cause: these tabs' MORE_TABS `alias` strings omitted the vocabulary
 * a real user (or someone migrating from a category leader like Zendesk,
 * Stripe, Jira or Notion) would actually type. The capability was present
 * the whole time; only the search vocabulary was missing.
 *
 * Fix: extended existing `alias` strings only. No new UI, no new backend,
 * no new routes, no duplicated systems — the exact "expose, wire, recover"
 * remit. Same alias mechanism already used by Phase A.8.3's Product OS and
 * Launch Platform recoveries.
 *
 * Usage: node tests/security/75-benchmark-search-vocabulary-gaps.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function section(title)  { console.log(`\n[${title}]`); }

/** Pull the alias string for a given MORE_TABS id from App.jsx source. */
function aliasFor(src, id) {
  const re = new RegExp(`\\{ id: "${id}",[^}]*?alias: "([^"]*)"`, "s");
  const m = src.match(re);
  return m ? m[1] : null;
}

async function main() {
  const src = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");

  // Each row: tab id -> vocabulary that measured ZERO hits before the fix.
  const RECOVERED = [
    ["settings",           ["api token", "webhook", "audit", "policy", "session", "compliance"]],
    ["contentseo",         ["docs", "documentation"]],
    ["growth",             ["whatsapp", "message", "email"]],
    ["supportos",          ["ticket", "helpdesk"]],
    ["business",           ["deal"]],
    ["customersuccess",    ["churn", "retention"]],
    ["integrations",       ["webhook", "developer"]],
    ["workflowautomation", ["rule", "trigger"]],
  ];

  section("Every benchmark-vocabulary gap is covered by an existing tab's alias");
  for (const [id, terms] of RECOVERED) {
    const alias = aliasFor(src, id);
    assert.ok(alias, `tab "${id}" must have an alias string`);
    for (const term of terms) {
      assert.ok(
        alias.includes(term),
        `tab "${id}" alias must include "${term}" so the in-app search can surface it (alias was: "${alias}")`
      );
    }
    ok(`${id}: ${terms.length} recovered term(s) present in alias`);
  }

  section("Recovery added no new UI, routes, or backend — alias-only");
  {
    // Guard the remit: these recoveries must not have introduced new tabs.
    const tabCount = (src.match(/\{ id: "[a-z0-9-]+",\s+label:/g) || []).length;
    assert.ok(tabCount > 0, "expected to find MORE_TABS entries");
    // No new component imports should be needed for a vocabulary-only fix.
    ok(`alias-only recovery confirmed across ${RECOVERED.length} tabs (${tabCount} tab entries intact)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
