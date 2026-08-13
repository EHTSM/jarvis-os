"use strict";
/**
 * Sales OS — close-won must produce revenue, exactly once.
 *
 * Reproduced live during the Sales OS mission with two real tenants:
 * a closed-won opportunity moved the pipeline to `closed-won 1 / $72,000`
 * while GET /business/revenue returned `{revenue: [], total: 0}` and
 * revenue/stats reported `count: 0`. The two views disagreed about the same
 * deal — the sales pipeline said won, the finance ledger said nothing happened.
 *
 * The second half of this suite guards the idempotency bug introduced by the
 * FIRST version of the fix: listRevenue() returns `{items, total}`, not a bare
 * array, so a `.length` guard was always undefined and re-closing a won deal
 * silently doubled revenue ($55,000 -> $110,000, reproduced live).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const bds = require(path.join(__dirname, "..", "..", "backend", "services", "businessDataService.cjs"));

const ORG = `org_SALES_TEST_${Date.now()}`;

// createOpportunity takes orgId INSIDE the payload object; closeWon takes it as
// a third positional argument. Mixing the two conventions creates an unscoped
// opportunity that closeWon then cannot find.
function newWonOpportunity(value) {
  const opp = bds.createOpportunity({ title: `sales-os probe ${Date.now()}`, value, orgId: ORG });
  return bds.closeWon(opp.id, {}, ORG);
}

describe("Sales OS — close-won records revenue", () => {
  it("listRevenue returns { items, total }, not a bare array", () => {
    // The exact shape the first fix attempt got wrong. Asserted explicitly so
    // a future refactor that changes it cannot silently break the guard below.
    const r = bds.listRevenue({ orgId: ORG, limit: 1 });
    assert.equal(Array.isArray(r), false, "listRevenue must not be a bare array");
    assert.equal(Array.isArray(r.items), true, "listRevenue must expose .items");
    assert.equal(typeof r.total, "number", "listRevenue must expose a numeric .total");
  });

  it("closing an opportunity won creates a linked revenue record", () => {
    const won = newWonOpportunity(64000);
    assert.equal(won.stage, "closed-won");

    const rev = bds.listRevenue({ oppId: won.id, orgId: ORG, limit: 10 });
    assert.equal(rev.items.length, 1,
      "a won deal must produce exactly one revenue record — pipeline and ledger must agree");

    const row = rev.items[0];
    assert.equal(row.amount, 64000, "revenue amount must match the deal value");
    assert.equal(row.oppId, won.id, "revenue must be linked back to the opportunity");
    assert.equal(row.source, "opportunity-close-won",
      "revenue source must identify how it was created, not look manually entered");
  });

  it("re-closing the same opportunity does NOT duplicate revenue", () => {
    const won = newWonOpportunity(41000);
    bds.closeWon(won.id, {}, ORG);
    bds.closeWon(won.id, {}, ORG);

    const rev = bds.listRevenue({ oppId: won.id, orgId: ORG, limit: 10 });
    assert.equal(rev.items.length, 1,
      `three closes must yield ONE revenue row, got ${rev.items.length} — this is the doubling bug`);
  });

  it("a zero-value deal does not fabricate a revenue row", () => {
    const opp = bds.createOpportunity({ title: "zero value probe", value: 0, orgId: ORG });
    const won = bds.closeWon(opp.id, {}, ORG);
    const rev = bds.listRevenue({ oppId: won.id, orgId: ORG, limit: 10 });
    assert.equal(rev.items.length, 0,
      "a deal worth nothing must not invent revenue");
  });

  it("revenue is scoped to the closing org", () => {
    const other = `org_SALES_OTHER_${Date.now()}`;
    const won = newWonOpportunity(33000);
    const mine = bds.listRevenue({ oppId: won.id, orgId: ORG, limit: 10 });
    const theirs = bds.listRevenue({ oppId: won.id, orgId: other, limit: 10 });
    assert.equal(mine.items.length, 1, "the closing org must see its revenue");
    assert.equal(theirs.items.length, 0, "another org must not see it");
  });

  it("close-won still succeeds even if revenue cannot be written", () => {
    // Revenue is best-effort: a ledger failure must never roll back or mask a
    // successful close, or a sales rep loses the deal state over a bookkeeping
    // error.
    const src = require("fs").readFileSync(
      path.join(__dirname, "..", "..", "backend", "services", "businessDataService.cjs"), "utf8");
    const fn = src.slice(src.indexOf("function closeWon"), src.indexOf("function closeLost"));
    assert.match(fn, /try \{[\s\S]*recordRevenue\([\s\S]*\} catch/,
      "the revenue write must be wrapped so it cannot fail the close");
  });
});
