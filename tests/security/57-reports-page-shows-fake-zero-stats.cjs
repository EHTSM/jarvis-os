#!/usr/bin/env node
"use strict";
/**
 * Reports page false-zero / false-unavailable regression — Phase A.6
 * (Business Owner Certification).
 *
 * CONFIRMED findings (reproduced live: real signup, one real lead added
 * via Contacts, non-operator founder account, Reports page):
 *
 * 1. "TOTAL LEADS: 0" / "REVENUE: ₹0" / "CLOSE RATE: 0% — 0 leads tracked"
 *    all showed zero despite a real, confirmed HOT lead existing — while
 *    the SAME page's Pipeline Breakdown panel, one section down, correctly
 *    showed "Hot: 1". Root cause: the 4 KPI cards all read from `stats`
 *    (ReportsV2.jsx), which is only populated via the operator-only
 *    getStats() call — Promise.resolve(undefined) for every non-operator
 *    account (per an existing, already-documented "Workflow Coverage
 *    Completion" fix a few lines above). Pipeline Breakdown, by contrast,
 *    already derived its numbers from the real `leads` array (fetched via
 *    the non-operator-safe getLeads()) — the exact same array the KPI
 *    cards should have used but didn't.
 *
 * 2. "Avg response: — / Backend unavailable" showed on every load for
 *    every non-operator account, because avgResp is also sourced from an
 *    operator-only call (getMetrics()) and is therefore always null for a
 *    founder — the sub-label unconditionally claimed "Backend
 *    unavailable" for what is actually just operator-gated data a founder
 *    account never fetches. The sibling "Memory usage" row already
 *    handled its identical null case honestly (empty sub-label).
 *
 * 3. (backend) businessDataService.cjs's getDashboard() only ever counted
 *    leads from its own biz-leads.json store — a completely separate file
 *    from the one the real CRM UI (ContactsV2.jsx → POST /crm/lead →
 *    crmService.js → data/leads.json) actually writes to. A lead added
 *    through the real CRM UI never appeared in this aggregate.
 *
 * Fixes:
 *   - ReportsV2.jsx: added a `leadStats` useMemo derived from the same
 *     `leads` array PipelineChart already consumes successfully (mirrors
 *     crmService.js's own getStats(orgId) total/hot/paid formula). Total
 *     Leads and Close Rate cards now use leadStats instead of the
 *     operator-only stats. Revenue shows "—" (honest) instead of a false
 *     "₹0" when stats is unavailable, since no non-operator-safe revenue
 *     source exists to derive a real figure from.
 *   - ReportsV2.jsx: "Avg response" now matches "Memory usage"'s existing
 *     honest-empty-sub-label pattern instead of claiming "Backend
 *     unavailable".
 *   - businessDataService.cjs: getDashboard() now merges in real lead
 *     counts from crmService.js's getStats(orgId) — additive, not a
 *     storage migration; listLeads()'s own return shape/behavior is
 *     unchanged for its 8+ other callers.
 *
 * Usage: node tests/security/57-reports-page-shows-fake-zero-stats.cjs
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
  const reportsSrc = fs.readFileSync(require.resolve("../../frontend/src/components/ReportsV2.jsx"), "utf8");
  const bdsSrc      = fs.readFileSync(require.resolve("../../backend/services/businessDataService.cjs"), "utf8");

  section("Fix: ReportsV2.jsx derives leadStats from the real leads array");
  {
    assert.ok(/const leadStats = useMemo/.test(reportsSrc), "ReportsV2.jsx must define a leadStats useMemo derived from the leads array");
    assert.ok(/leadStats\.total/.test(reportsSrc) && /leadStats\.hot/.test(reportsSrc) && /leadStats\.paid/.test(reportsSrc),
      "leadStats must expose total/hot/paid, mirroring crmService.js's own getStats() shape");
    ok("leadStats useMemo defined with total/hot/paid derived from the real leads array");
  }

  section("Fix: Total Leads and Close Rate KPI cards use leadStats, not operator-only stats");
  {
    const totalLeadsMatch = reportsSrc.match(/label="Total Leads"[\s\S]{0,120}?value=\{([^}]+)\}/);
    assert.ok(totalLeadsMatch, "could not find the Total Leads KpiCard");
    assert.strictEqual(totalLeadsMatch[1].trim(), "leadStats.total",
      `Total Leads value must be leadStats.total, found "${totalLeadsMatch[1].trim()}"`);

    const closeRateSubMatch = reportsSrc.match(/label="Close Rate"[\s\S]{0,150}?sub=\{([^}]+)\}/);
    assert.ok(closeRateSubMatch, "could not find the Close Rate KpiCard's sub label");
    assert.ok(closeRateSubMatch[1].includes("leadStats.total"),
      `Close Rate sub-label must reference leadStats.total, found "${closeRateSubMatch[1]}"`);
    ok("Total Leads and Close Rate cards both read from leadStats");
  }

  section("Fix: Revenue shows honest '—' instead of a false '₹0' when stats is unavailable");
  {
    const revenueMatch = reportsSrc.match(/label="Revenue"[\s\S]{0,120}?value=\{([^}]+)\}/);
    assert.ok(revenueMatch, "could not find the Revenue KpiCard");
    assert.ok(/stats \? _fmtINR\(stats\.revenue\) : "—"/.test(revenueMatch[1]),
      `Revenue value must be conditional on stats presence with an honest "—" fallback, found "${revenueMatch[1]}"`);
    ok("Revenue card shows '—' (honest) rather than a fabricated ₹0 when the operator-only stats source is unavailable");
  }

  section("Fix: Avg response row no longer claims 'Backend unavailable' for a merely-absent operator-only metric");
  {
    // The real outage-detection error banner (setError("Backend unavailable
    // — reports data could not be loaded.")) is intentionally untouched —
    // that path fires only for an actual operator-session outage. Only the
    // "Avg response" row's sub-label, which fired for every non-operator
    // account regardless of any real outage, was the bug.
    const avgResponseMatch = reportsSrc.match(/label: "Avg response",[\s\S]{0,150}?\}/);
    assert.ok(avgResponseMatch, "could not find the Avg response row definition");
    assert.ok(!avgResponseMatch[0].includes("Backend unavailable"),
      `the Avg response row's sub-label must not claim "Backend unavailable", found: ${avgResponseMatch[0]}`);
    assert.ok(/setError\("Backend unavailable/.test(reportsSrc),
      "the real operator-outage error banner (setError) must remain untouched — this fix is scoped to the Avg response row only");
    ok("Avg response row's misleading sub-label removed; the real operator-outage error banner is untouched");
  }

  section("Fix (backend): getDashboard() merges real CRM lead stats via crmService.getStats()");
  {
    assert.ok(/_crmLeadStats\(orgId\)/.test(bdsSrc), "businessDataService.cjs's getDashboard() must call a _crmLeadStats(orgId) helper");
    assert.ok(/require\(".\/crmService\.js"\)/.test(bdsSrc), "the helper must require crmService.js, the store the real CRM UI actually writes to");
    assert.ok(/leads\.total \+ crmLeads\.total/.test(bdsSrc), "getDashboard()'s leads.total must be additive (existing store + crmService), not a replacement");
    ok("getDashboard() additively merges real crmService lead counts into its own aggregate");
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
