#!/usr/bin/env node
"use strict";
/**
 * CRM Leads id/leadId field-mismatch regression (Productivity
 * Certification, Phase A.10.2 — CRM Productivity, Workflow 2: Update
 * Lead / Workflow 4: Convert Customer).
 *
 * CONFIRMED finding: backend/services/businessDataService.cjs's
 * createLead() gives every lead object a primary key field named `id`
 * (e.g. "lead_1786...") — there is no `leadId` field anywhere on a lead
 * record. But frontend/src/components/BusinessOS.jsx's LeadsView read
 * `lead.leadId` everywhere (row `key`, openEdit's setEditing(), the
 * Qualify/Disqualify/Delete button handlers), which is always
 * `undefined` on a real lead object. This produced three distinct, real
 * failures, all confirmed live against the running app:
 *
 *   1. Qualify/Disqualify/Delete: fired
 *      POST /business/leads/undefined/qualify (and disqualify/DELETE) —
 *      confirmed 404 in the browser network log, so these buttons never
 *      worked for a single real lead, ever.
 *   2. Edit -> Save: setEditing(lead.leadId) set React state to
 *      `undefined` (falsy), so the form's own `editing ? "Save Changes"
 *      : "Create Lead"` ternary rendered "Create Lead" even while
 *      editing, and handleSave's `editing ? updateBizLead(...) :
 *      createBizLead(...)` branch called createBizLead() again —
 *      confirmed live: editing "Jordan Reyes" and clicking the
 *      (mislabeled) submit button fired a POST /business/leads (not a
 *      PATCH), and the leads table grew from 4 rows to 5 — a silent
 *      duplicate lead instead of an update.
 *   3. Separately, handleQualify/handleDisqualify/handleDelete checked
 *      `r.ok` to decide success/failure, but the backend's real response
 *      shape from _ok() is `{ success: true, lead }` — there is no `.ok`
 *      field at all, so even once #1 is fixed these handlers would show
 *      a false "error" toast (with an undefined message) on every
 *      genuinely successful qualify/disqualify/delete.
 *
 * There was also no "convert lead to customer" action anywhere, despite
 * the backend's LEAD_STATUSES already including "converted" and the
 * generic PATCH /business/leads/:id route already accepting any valid
 * status — recovered as a real "Convert to Customer" button on qualified
 * leads, using the same already-wired updateBizLead() call the (now
 * fixed) Edit flow uses.
 *
 * Fix (frontend/src/components/BusinessOS.jsx, LeadsView only):
 *   - lead.leadId -> lead.id in openEdit(), the row `key`, and the
 *     Qualify/Disqualify/Delete onClick handlers.
 *   - handleQualify/handleDisqualify/handleDelete now check
 *     `r.success !== false` (matching handleSave's existing, correct
 *     check) instead of the nonexistent `r.ok`.
 *   - added handleConvert() (calls the existing updateBizLead(id,
 *     {status:"converted"})) and a "Convert to Customer" button shown
 *     only on qualified leads.
 * No new backend route, no new component, no schema change.
 *
 * Usage: node tests/security/76-crm-leads-id-mismatch-broken-actions.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Static — LeadsView no longer reads the nonexistent lead.leadId field");
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/BusinessOS.jsx"), "utf8");
  const leadsViewMatch = src.match(/function LeadsView\([\s\S]*?\n}\n/);
  assert(!!leadsViewMatch, "LeadsView function body found in BusinessOS.jsx", "could not locate function LeadsView(...) in the source");
  const leadsViewSrc = leadsViewMatch ? leadsViewMatch[0] : "";

  assert(!/\.leadId\b/.test(leadsViewSrc),
    "LeadsView contains zero references to the nonexistent `.leadId` field", "found a remaining `.leadId` reference inside LeadsView");
  assert(/setEditing\(lead\.id\)/.test(leadsViewSrc),
    "openEdit() now sets editing state from lead.id", "openEdit still does not use lead.id");
  assert(/<tr key=\{l\.id\}>/.test(leadsViewSrc),
    "the leads table row key now uses l.id", "row key still not using l.id");
  assert(/handleQualify\(l\.id\)/.test(leadsViewSrc) && /handleDisqualify\(l\.id\)/.test(leadsViewSrc) && /handleDelete\(l\.id\)/.test(leadsViewSrc),
    "Qualify/Disqualify/Delete buttons now pass l.id", "one or more row action buttons still not passing l.id");

  section("Static — success/failure checks now match the real backend response shape ({success:true,...}, no .ok field)");
  assert(/handleQualify = async[\s\S]{0,200}r\.success !== false/.test(leadsViewSrc),
    "handleQualify checks r.success (not the nonexistent r.ok)", "handleQualify still checks r.ok");
  assert(/handleDisqualify = async[\s\S]{0,200}r\.success !== false/.test(leadsViewSrc),
    "handleDisqualify checks r.success (not the nonexistent r.ok)", "handleDisqualify still checks r.ok");
  // Mission 38 (2026-08-23): a later, separate mission (Phase A.11.2,
  // "destructive-confirm consistency") inserted a confirm({...}) safety
  // dialog into handleDelete, pushing the real success-check past this
  // assertion's original {0,200} lookahead window (measured: 242 chars).
  assert(/handleDelete = async[\s\S]{0,320}r\.success !== false/.test(leadsViewSrc),
    "handleDelete checks r.success (not the nonexistent r.ok)", "handleDelete still checks r.ok");

  section("Static — a real 'Convert to Customer' action now exists for qualified leads, reusing the existing updateBizLead() call");
  assert(/handleConvert = async \(leadId\) => \{[\s\S]{0,200}updateBizLead\(leadId, \{ status: "converted" \}\)/.test(leadsViewSrc),
    "handleConvert() calls the existing updateBizLead(id, {status:\"converted\"})", "handleConvert not found or not using updateBizLead with status: converted");
  assert(/title="Convert to Customer"/.test(leadsViewSrc),
    "a 'Convert to Customer' button is rendered", "no Convert to Customer button found");
  assert(/l\.status === "qualified" &&\s*\n\s*<button className="bos-icon-btn" title="Convert to Customer"/.test(leadsViewSrc),
    "the Convert to Customer button is scoped to qualified leads only", "Convert button is not correctly scoped to l.status === \"qualified\"");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  // Mission 38 (2026-08-23): a bare fetch() with no timeout hangs
  // indefinitely against a listening-but-overloaded server (reproduced
  // live) — AbortSignal.timeout() turns that into the same honest skip a
  // connection-refused already takes.
  const serversUp = await Promise.all([
    fetch("http://localhost:3000", { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false),
    fetch("http://localhost:5050/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false),
  ]).then(([fe, be]) => fe && be);
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CRM Leads id/leadId Mismatch Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — real signup, create a lead, edit it (must PATCH not duplicate), qualify it, convert it");
  const email = `crm-leads-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("CRM Leads Regression").catch(() => {});
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill("CrmLeadsRegression12345!");
  await page.locator("button.auth-btn").first().click();
  await page.waitForFunction(() => !document.body.innerText.includes("Creating account"), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const DISMISS = ["Skip for now", "Skip setup", "Skip tour", "Skip", "Got it", "Close", "Maybe later"];
  for (let round = 0; round < 15; round++) {
    let did = false;
    const gtSkip = page.locator(".gt-skip").first();
    if (await gtSkip.isVisible({ timeout: 600 }).catch(() => false)) { await gtSkip.click().catch(() => {}); await page.waitForTimeout(600); did = true; }
    for (const label of DISMISS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 600 }).catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(500); did = true; }
    }
    const overlayLeft = await page.evaluate(() => !!document.querySelector(".gt-overlay, .wf-overlay, .cfr-backdrop")).catch(() => false);
    if (!did && !overlayLeft) break;
  }
  await page.waitForTimeout(1000);

  await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 20000 }).catch(() => {});
  const crmTile = page.locator("button.cd-quick-action", { hasText: "CRM" }).first();
  const crmVisible = await crmTile.isVisible({ timeout: 10000 }).catch(() => false);
  assert(crmVisible, "the Dashboard's CRM quick-action tile is reachable after signup", "CRM quick-action tile not found");

  if (crmVisible) {
    await crmTile.click();
    await page.waitForTimeout(800);
    await page.getByText("Leads", { exact: true }).first().click({ timeout: 10000 });
    await page.waitForTimeout(600);

    // Create a real lead through the real form
    await page.getByText("+ New Lead", { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="Name *"]').fill("Regression Test Lead");
    await page.getByText("Create Lead", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector(".bos-form-card"), { timeout: 8000 }).catch(() => {});
    await page.waitForSelector('button[title="Edit"]', { timeout: 10000 });

    const rowCountAfterCreate = await page.locator("table.bos-table tbody tr").count();
    assert(rowCountAfterCreate === 1, "exactly one lead exists after creating it", `expected 1 row, found ${rowCountAfterCreate}`);

    // Edit it — must show "Save Changes" (not "Create Lead") and must PATCH, not duplicate
    await page.locator('button[title="Edit"]').first().click();
    await page.waitForTimeout(500);
    const submitLabel = await page.locator(".bos-form-card button.bos-btn.primary").innerText().catch(() => "");
    assert(/Save Changes/.test(submitLabel), "the edit form's submit button reads 'Save Changes' (editing state correctly set from lead.id)", `submit button read "${submitLabel}" instead of "Save Changes"`);

    let sawPatch = false;
    page.on("requestfinished", async (req) => {
      if (req.method() === "PATCH" && /\/business\/leads\/lead_/.test(req.url())) sawPatch = true;
    });
    await page.locator('input[placeholder="Company"]').fill("Regression Co");
    await page.getByText("Save Changes", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector(".bos-form-card"), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);

    const rowCountAfterEdit = await page.locator("table.bos-table tbody tr").count();
    assert(rowCountAfterEdit === 1, "editing the lead did NOT create a duplicate (still exactly 1 row)", `expected 1 row after edit, found ${rowCountAfterEdit} — a duplicate was created`);
    assert(sawPatch, "the edit submitted a real PATCH /business/leads/lead_... request (not a duplicate-creating POST)", "no PATCH request to /business/leads/lead_... observed");

    // Qualify it
    const qualifyBtn = page.locator('button[title="Qualify"]').first();
    const qualifyVisible = await qualifyBtn.isVisible({ timeout: 5000 }).catch(() => false);
    assert(qualifyVisible, "the Qualify button is visible on the new lead", "Qualify button not found");
    if (qualifyVisible) {
      await qualifyBtn.click();
      await page.waitForTimeout(1200);
    }

    // Switch to Qualified filter and confirm the lead moved + Convert button present
    await page.getByText("Qualified", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    const convertBtn = page.locator('button[title="Convert to Customer"]').first();
    const convertVisible = await convertBtn.isVisible({ timeout: 5000 }).catch(() => false);
    assert(convertVisible, "after qualifying, a real 'Convert to Customer' button is reachable", "Convert to Customer button not found on the Qualified tab");

    if (convertVisible) {
      await convertBtn.click();
      await page.waitForTimeout(1200);
      await page.getByText("All", { exact: true }).first().click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      assert(/Converted/.test(bodyText), "the lead's status shows 'Converted' after using Convert to Customer", "no 'Converted' status found after clicking Convert to Customer");
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`CRM Leads id/leadId Mismatch Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
