#!/usr/bin/env node
"use strict";
/**
 * OS-2/OS-3 fake-success regression protection.
 *
 * Three defects of the same class were found by EXECUTING workflows and
 * comparing what the response CLAIMED against what it actually DID. All three
 * were invisible to read-only auditing, because each returned HTTP 200 with a
 * well-formed body.
 *
 * ── F-001 (OS-2) WhatsApp broadcast ─────────────────────────────────────
 * Returned {"status":"sent","sentAt":"…"} while stats read
 * {sent:0, delivered:0, failed:0}. With no audience and a phone-first CRM
 * returning no leads, memberIds was empty and the delivery loop never ran —
 * yet the record claimed success.
 *
 * ── F-002 (OS-2) Push notification ──────────────────────────────────────
 * stats.clicked was Math.round(sent * 0.06) and stats.dismissed was
 * Math.round(sent * 0.12). This module consumes no click or dismissal
 * webhook, so those were invented engagement figures presented as measured
 * analytics. status was also unconditionally "sent" with zero devices.
 *
 * ── OS-3 Distribution publish ───────────────────────────────────────────
 * Widest blast radius. distributionEngine.cjs performs NO external HTTP call
 * anywhere, yet publishJob() marked every platform "published", minted a
 * postUrl pointing at a page that does not exist
 * (https://linkedin.com/ooplix/p/<id>), and derived reach/engagement/shares/
 * clicks from static constants and fixed multipliers (0.042/0.008/0.025).
 * /distrib/analytics then reported engagementRate "4.20" — the multiplier
 * echoed back as a measured rate. A founder could have reported those
 * figures to an investor.
 *
 * These assertions are source-level so they run without a live server, and
 * they fail loudly if anyone reintroduces a claim of delivery or a
 * multiplier-derived "measurement".
 *
 * Usage: node tests/security/93-os2-os3-fake-success-protection.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const growth = fs.readFileSync("backend/services/growthOS.cjs", "utf8");
const distrib = fs.readFileSync("backend/services/distributionEngine.cjs", "utf8");

function main() {
  section("F-001 — WhatsApp refuses rather than claiming a phantom send");
  {
    assert.ok(
      /if \(!memberIds\.length\)/.test(growth),
      "sendWhatsAppBroadcast must guard the zero-recipient case before claiming 'sent'"
    );
    assert.ok(
      /has no recipients/i.test(growth),
      "the zero-recipient refusal must name the real reason for the operator"
    );
    // The guard must sit BEFORE status is assigned, or it cannot prevent the
    // claim. Phase OS-MKT: the anchor was the literal `c.status = "sent"`,
    // which no longer exists — status is now derived from the measured
    // outcome. Anchor on the assignment itself so the ordering invariant is
    // still enforced without depending on a hardcoded value.
    // Scope the ordering check to sendWhatsAppBroadcast() itself — other
    // functions in this file also assign c.status, so a file-wide search
    // would compare against the wrong assignment.
    const waStart = growth.indexOf("async function sendWhatsAppBroadcast");
    assert.ok(waStart > -1, "sendWhatsAppBroadcast must exist");
    const waBody   = growth.slice(waStart, growth.indexOf("\nfunction ", waStart + 10));
    const guardAt  = waBody.indexOf("if (!memberIds.length)");
    const statusAt = waBody.search(/c\.status\s+=/);
    assert.ok(guardAt > -1 && statusAt > -1 && guardAt < statusAt,
      "the recipient guard must run BEFORE the broadcast's status is assigned");

    // Phase OS-MKT strengthening: measured live with 2 real recipients, the
    // provider rejected BOTH messages (real Meta Graph permissions error) and
    // the broadcast still reported status:"sent". Status must now follow the
    // measured outcome, and `sent` must count successful hand-offs rather than
    // attempts (it was memberIds.length, which could never disagree).
    assert.ok(
      !/c\.status\s+=\s+"sent";/.test(growth),
      "WhatsApp status must not be unconditionally 'sent' — it must reflect whether delivery succeeded"
    );
    assert.ok(
      /c\.stats\.sent\s+=\s+delivered/.test(growth),
      "stats.sent must count successful deliveries, not attempted recipients"
    );
    assert.ok(
      /c\.stats\.attempted\s+=\s+memberIds\.length/.test(growth),
      "attempted recipients must be reported separately from successful sends"
    );
    ok("zero-recipient broadcast refuses with a reason, before any 'sent' claim");
  }

  section("F-002 — Push does not fabricate engagement, nor claim a phantom send");
  {
    assert.ok(
      !/clicked:\s*Math\.round\(sent\s*\*\s*0\.06\)/.test(growth),
      "push must not derive `clicked` from a fixed multiplier — that is invented engagement"
    );
    assert.ok(
      !/dismissed:\s*Math\.round\(sent\s*\*\s*0\.12\)/.test(growth),
      "push must not derive `dismissed` from a fixed multiplier"
    );
    assert.ok(
      /clicked: null/.test(growth) && /dismissed: null/.test(growth),
      "unmeasured engagement must be null ('not measured'), not 0 (which asserts zero clicks)"
    );
    assert.ok(
      /status: sent > 0 \? "sent" : "not_sent"/.test(growth),
      "push status must depend on whether anything was actually sent"
    );
    assert.ok(
      /notSentReason/.test(growth),
      "a push that reached nobody must carry a machine-readable reason"
    );
    ok("push reports null for unmeasured engagement and 'not_sent' when nothing was delivered");
  }

  section("OS-3 — Distribution does not claim to have published");
  {
    assert.ok(
      !/pf\.status\s*=\s*"published"/.test(distrib),
      "publishJob must not mark platforms 'published' — this module makes no external call"
    );
    assert.ok(
      /pf\.status\s*=\s*"simulated"/.test(distrib),
      "un-posted platforms must be marked 'simulated'"
    );
    assert.ok(
      !/pf\.postUrl\s*=\s*`https:\/\/\$\{pf\.platform\}/.test(distrib),
      "publishJob must not mint a postUrl for a post that was never created"
    );
    assert.ok(
      /job\.stats\.reach\s*=\s*null/.test(distrib),
      "reach must be null (not measured) rather than a static constant presented as observed"
    );
    assert.ok(
      /projected/.test(distrib) && /NOT measured/.test(distrib),
      "modelled figures must be reported under `projected` and labelled as not measured"
    );
    ok("distribution marks jobs simulated, mints no fake URL, and labels projections");
  }

  section("No module still presents a multiplier as a measured metric");
  {
    // The projection block is allowed — it is explicitly labelled. What must
    // never return is a bare stat assigned straight from reach × rate.
    const bareFabrication = [
      /job\.stats\.engagement\s*=\s*Math\.round\(job\.stats\.reach\s*\*/,
      /job\.stats\.shares\s*=\s*Math\.round\(job\.stats\.reach\s*\*/,
      /job\.stats\.clicks\s*=\s*Math\.round\(job\.stats\.reach\s*\*/,
    ];
    for (const re of bareFabrication) {
      assert.ok(!re.test(distrib),
        `a measured stat must never be assigned from a multiplier: ${re}`);
    }
    ok("no measured counter is assigned from a fixed multiplier");
  }

  section("OS-4 — distribution ANALYTICS does not re-derive fabricated engagement");
  {
    // The publish path was fixed in OS-3, but getDistributionAnalytics() still
    // re-derived per-platform engagement/shares from reach × 0.042 / × 0.008
    // over pre-fix records, and reported totalReach/engagementRate as measured.
    // Measured live before the fix: engagementRate "4.20" — the 0.042
    // multiplier echoed back as an observed rate.
    assert.ok(
      !/byPlatform\[pf\.platform\]\.engagement\s*\+=\s*Math\.round\(perPlatformReach\s*\*/.test(distrib),
      "per-platform engagement must not be re-derived from a multiplier in analytics"
    );
    assert.ok(
      !/byPlatform\[pf\.platform\]\.shares\s*\+=\s*Math\.round\(perPlatformReach\s*\*/.test(distrib),
      "per-platform shares must not be re-derived from a multiplier in analytics"
    );
    assert.ok(
      /totalReach:\s*null/.test(distrib) && /engagementRate:\s*null/.test(distrib),
      "unmeasured analytics totals must be null, not a computed figure presented as measured"
    );
    assert.ok(
      /measured: false/.test(distrib) && /measurementNote/.test(distrib),
      "analytics must state plainly that nothing is measured in this deployment"
    );
    assert.ok(
      /legacy:\s*\{/.test(distrib),
      "residue from pre-fix records must be reported under `legacy`, not as performance"
    );
    ok("distribution analytics reports null + a measurement note, with legacy residue separated");
  }

  section("OS-4 — product validation avgScore cannot exceed its own scale");
  {
    const pve = fs.readFileSync("backend/services/productValidationEngine.cjs", "utf8");
    // The Product Factory dashboard reported avgValidationScore 234 on a
    // 0-100 scale, because 5 records from 2026-06-29 carry dimension scores
    // written before the per-dimension clamps existed (tests: 10000,
    // security: 600). Their overallScore values (2193, 2058 …) dominated the
    // mean. The generator is already correct; only the aggregate was wrong.
    assert.ok(
      /overallScore >= 0 && v\.overallScore <= 100/.test(pve),
      "avgScore must be computed only from records within the 0-100 scale"
    );
    assert.ok(
      /excludedOutOfRange/.test(pve),
      "excluded out-of-range records must be counted visibly, not dropped silently"
    );
    // getStats() must recompute, or a stale stored avgScore keeps being served.
    const statsFn = pve.slice(pve.indexOf("function getStats()"));
    assert.ok(
      /inRange/.test(statsFn.slice(0, 900)),
      "getStats() must recompute avgScore on read rather than return a stale stored value"
    );

    // Behavioural check against the real store.
    const engine = require("../../backend/services/productValidationEngine.cjs");
    const stats  = engine.getStats();
    assert.ok(
      stats.avgScore === null || (stats.avgScore >= 0 && stats.avgScore <= 100),
      `avgScore must be within 0-100 or null, got ${stats.avgScore}`
    );
    ok(`avgScore is ${stats.avgScore} (was 234), ${stats.excludedOutOfRange} out-of-range record(s) excluded`);
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

try { main(); }
catch (err) { console.error("FAILED:", err.message); process.exit(1); }
