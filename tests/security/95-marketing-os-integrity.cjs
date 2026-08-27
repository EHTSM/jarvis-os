#!/usr/bin/env node
"use strict";
/**
 * Marketing/Growth OS integrity — Phase OS-MKT.
 *
 * Locks in four defects found by operating the Marketing OS with real data on
 * a fresh tenant. All four returned HTTP 2xx and were invisible to read-only
 * auditing.
 *
 * ── M-001  CRM → audience sync was a silent no-op ────────────────────────
 * syncCRMToAudience() mapped `l.id`, but CRM leads carry NO id field — they
 * are keyed by phone (measured keys: phone, name, userId, orgId, status, …).
 * Every mapped value was undefined, .filter(Boolean) reduced them to [], and
 * the route returned 200 with an unchanged audience. Measured: 2 real CRM
 * leads synced → 0 members. This silently broke the entire
 * CRM → audience → campaign chain.
 *
 * ── M-002  WhatsApp reported "sent" for a fully failed broadcast ─────────
 * Measured live with 2 real recipients: the provider rejected BOTH messages
 * (genuine Meta Graph permissions error, preserved in lastSendFailures), and
 * the broadcast still reported status:"sent" with a sentAt timestamp.
 * `stats.sent` was memberIds.length — attempts, not deliveries — so it could
 * never disagree with the recipient count however badly the send went.
 *
 * ── M-003  Empty POST created junk campaign records ──────────────────────
 * POST /growth/email|sms|whatsapp|audiences|templates with an EMPTY body
 * returned 200 and persisted a record with name:"" that counts toward
 * campaign totals and can be "sent".
 *
 * ── M-004  A required-field rejection surfaced as HTTP 500 ───────────────
 * Once M-003 was guarded, "name required" mapped to 500 — telling the caller
 * the server broke when the fix is to supply the field.
 *
 * Usage: node tests/security/95-marketing-os-integrity.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

const growth = fs.readFileSync("backend/services/growthOS.cjs", "utf8");
const routes = fs.readFileSync("backend/routes/growthOS.js", "utf8");

function main() {
  section("M-001 — CRM → audience sync uses the identifier CRM actually has");
  {
    const fn = growth.slice(
      growth.indexOf("function syncCRMToAudience"),
      growth.indexOf("function evaluateDynamicAudience")
    );
    assert.ok(fn.length > 0, "syncCRMToAudience must exist");
    assert.ok(
      !/leads\.map\(l => l\.id\)/.test(fn),
      "sync must not map l.id — CRM leads have no id field, so every value is undefined and the sync silently yields zero members"
    );
    assert.ok(
      /leads\.map\(l => l\.phone\)/.test(fn),
      "sync must map l.phone — the identifier sendWhatsAppBroadcast() already treats as an audience member"
    );
    ok("syncCRMToAudience maps phone, matching the recipient contract used by the send path");
  }

  section("M-002 — WhatsApp status reflects the measured delivery outcome");
  {
    const waStart = growth.indexOf("async function sendWhatsAppBroadcast");
    assert.ok(waStart > -1, "sendWhatsAppBroadcast must exist");
    const wa = growth.slice(waStart, growth.indexOf("\nfunction ", waStart + 10));

    assert.ok(
      !/c\.status\s+=\s+"sent";/.test(wa),
      "status must not be unconditionally 'sent' — a broadcast where every message failed reported success"
    );
    assert.ok(
      /delivered > 0/.test(wa),
      "status must be derived from the measured delivered count"
    );
    assert.ok(
      /c\.stats\.sent\s+=\s+delivered/.test(wa),
      "stats.sent must count successful deliveries, not attempted recipients"
    );
    assert.ok(
      /c\.stats\.attempted/.test(wa),
      "attempted recipients must be reported separately so the two can disagree"
    );
    assert.ok(
      /c\.sentAt\s+=\s+delivered > 0 \? _ts\(\) : null/.test(wa),
      "sentAt must be null when nothing was delivered — a timestamp asserts a send that did not happen"
    );
    ok("status/sentAt/stats all follow the measured outcome, attempts reported separately");
  }

  section("M-003 — creators reject an empty body instead of persisting junk");
  {
    const CREATORS = [
      "createEmailCampaign", "createSMSCampaign", "createWhatsAppBroadcast",
      "createAudience", "createTemplate",
    ];
    for (const fn of CREATORS) {
      const at = growth.indexOf(`function ${fn}(`);
      assert.ok(at > -1, `${fn} must exist`);
      const body = growth.slice(at, at + 700);
      assert.ok(
        /name required/.test(body),
        `${fn} must reject a body with no name — an empty POST previously created a record with name:""`
      );
    }
    ok(`${CREATORS.length} campaign/audience/template creators validate their required field`);
  }

  section("M-004 — a required-field rejection is a 400, not a 500");
  {
    assert.ok(
      /\\brequired\\b/.test(routes) && /400/.test(routes),
      "_err must map a '<field> required' error to 400"
    );
    // Ordering matters: not-found must still win for a not-found error.
    const errFn = routes.slice(routes.indexOf("function _err("), routes.indexOf("function _err(") + 700);
    assert.ok(
      /not found/i.test(errFn) && /404/.test(errFn),
      "_err must still map 'not found' to 404"
    );
    ok("_err maps required → 400 and not found → 404, leaving genuine faults as 500");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

try { main(); }
catch (err) { console.error("FAILED:", err.message); process.exit(1); }
