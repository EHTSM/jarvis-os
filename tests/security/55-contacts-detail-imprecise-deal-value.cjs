#!/usr/bin/env node
"use strict";
/**
 * CRM lead-detail imprecise deal-value regression — Phase A.6 (Business
 * Owner Certification).
 *
 * CONFIRMED finding (reproduced live: real signup, real login, real
 * "+ New" contact form, entered dealValue=8500): ContactsV2.jsx's
 * detail-drawer "Deal value" field reused _fmtINR() — the SAME abbreviated
 * formatter used for the space-constrained compact list row
 * (`n >= 1000 → "₹9k"`, zero decimal places) — in the full detail view,
 * where a founder is specifically looking to confirm the exact figure
 * before writing a proposal or invoice. Entering ₹8,500 showed "₹9k" in
 * BOTH the compact row AND the dedicated detail panel, with no way to see
 * the real number anywhere in the UI.
 *
 * Fix: added _fmtINRExact() (Intl.NumberFormat, same pattern already
 * established in BusinessOS.jsx for currency display — not a new
 * mechanism) and used it only in the detail-drawer "Deal value" row.
 * The compact list row intentionally keeps the abbreviated _fmtINR()
 * form — space-constrained list is a legitimate reason to abbreviate;
 * only the precision-sensitive detail view needed the fix.
 *
 * Verified live: detail view now shows "₹8,500" for an entered 8500;
 * the compact list row still correctly shows "₹9k".
 *
 * Usage: node tests/security/55-contacts-detail-imprecise-deal-value.cjs
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
  const src = fs.readFileSync(require.resolve("../../frontend/src/components/ContactsV2.jsx"), "utf8");

  section("Fix: an exact currency formatter exists");
  {
    assert.ok(/function _fmtINRExact\(/.test(src), "ContactsV2.jsx must define _fmtINRExact()");
    assert.ok(/Intl\.NumberFormat\("en-IN",\s*\{\s*style:\s*"currency",\s*currency:\s*"INR"/.test(src),
      "_fmtINRExact must use Intl.NumberFormat with INR currency style — the same pattern BusinessOS.jsx already uses");
    ok("_fmtINRExact() is defined and uses the established Intl.NumberFormat currency pattern");
  }

  section("Fix: the detail-drawer deal-value row uses the exact formatter");
  {
    const detailRowMatch = src.match(/Deal value<\/span><span className="cv2-detail-val">\{(_fmtINR\w*)\(contact\.dealValue\)\}/);
    assert.ok(detailRowMatch, "could not find the detail-drawer Deal value row in ContactsV2.jsx");
    assert.strictEqual(detailRowMatch[1], "_fmtINRExact",
      `detail-drawer Deal value row must call _fmtINRExact(), found ${detailRowMatch[1]}() instead`);
    ok("detail-drawer 'Deal value' row calls _fmtINRExact(), not the abbreviated _fmtINR()");
  }

  section("Regression: the compact list row still uses the abbreviated formatter (intentional, unchanged)");
  {
    const listRowMatch = src.match(/cv2-row-value">\{(_fmtINR\w*)\(contact\.dealValue\)\}/);
    assert.ok(listRowMatch, "could not find the compact list row's deal-value span in ContactsV2.jsx");
    assert.strictEqual(listRowMatch[1], "_fmtINR",
      `compact list row should still use the abbreviated _fmtINR() for space reasons, found ${listRowMatch[1]}() instead`);
    ok("compact list row still uses abbreviated _fmtINR() — fix is scoped to the detail view only");
  }

  section("Sanity: _fmtINRExact formats a known value correctly (pure function, no DOM needed)");
  {
    // Re-implement identically to how the component does it, to test in isolation.
    function _fmtINRExact(v) {
      if (!v) return "";
      const n = Number(String(v).replace(/[^\d.]/g, ""));
      if (!n) return "";
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    }
    const formatted = _fmtINRExact(8500);
    assert.ok(formatted.includes("8,500"), `expected formatted value to contain "8,500", got "${formatted}"`);
    assert.ok(!formatted.includes("9k") && !formatted.includes("9K"), `formatted value must not be rounded to "9k", got "${formatted}"`);
    ok(`_fmtINRExact(8500) → "${formatted}" — exact, not rounded`);
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
