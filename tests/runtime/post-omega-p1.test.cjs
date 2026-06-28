"use strict";
/**
 * POST-Ω Sprint P1 test suite
 * Covers: intelligenceLayer fix, selfReviewEngine, consolidationAudit
 */

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };
let passed = 0; let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};
const testAsync = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};

const il  = require("../../backend/services/intelligenceLayer.cjs");
const sre = require("../../backend/services/selfReviewEngine.cjs");
const ca  = require("../../backend/services/consolidationAudit.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Intelligence Layer Fix (correlations bug)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[post-omega-P1] Block 1: Intelligence Layer Fix");

test("getCorrelations — returns without throwing", () => {
  let result, err;
  try { result = il.getCorrelations(); }
  catch (e) { err = e; }
  assert(!err, `getCorrelations threw: ${err?.message}`);
  assert(result && typeof result === "object", "result not an object");
});

test("getCorrelations — has correlations key", () => {
  const r = il.getCorrelations();
  assert(r.correlations && typeof r.correlations === "object", "missing correlations key");
});

test("getCorrelations — correlation values are objects not errors", () => {
  const r = il.getCorrelations();
  for (const [key, val] of Object.entries(r.correlations || {})) {
    assert(typeof val === "object", `correlation[${key}] is not an object`);
    assert(!val?.error, `correlation[${key}] has error: ${val?.error}`);
  }
});

test("getCorrelations — failures_deployments present", () => {
  const r = il.getCorrelations();
  assert("failures_deployments" in r.correlations, "missing failures_deployments");
});

test("getCorrelations — deployments_health present", () => {
  const r = il.getCorrelations();
  assert("deployments_health" in r.correlations, "missing deployments_health");
});

test("getInsights — returns without throwing after fix", () => {
  let result, err;
  try { result = il.getInsights(); }
  catch (e) { err = e; }
  assert(!err, `getInsights threw: ${err?.message}`);
  assert(result, "no result");
});

test("getInsights — insights is an array", () => {
  const r = il.getInsights();
  assert(Array.isArray(r.insights), `insights not array: ${typeof r.insights}`);
});

test("invalidateCache — clears correlation cache", () => {
  il.invalidateCache();
  const r = il.getCorrelations(); // should not throw after cache clear
  assert(r.correlations, "failed after cache invalidation");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Self Review Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[post-omega-P1] Block 2: Self Review Engine");

let reviewId;

test("runReview — returns ok", () => {
  const r = sre.runReview();
  assert(r.ok, `failed: ${r.error}`);
  assert(r.review?.id, "no review id");
  reviewId = r.review.id;
});

test("runReview — overall score 0-100", () => {
  const r = sre.runReview();
  assert(r.ok, "failed");
  const s = r.review.overall;
  assert(typeof s === "number" && s >= 0 && s <= 100, `OOB overall: ${s}`);
});

test("runReview — all 9 dimension scores present", () => {
  const r = sre.runReview();
  const dims = ["architecture","autonomy","technicalDebt","reliability","performance","founderTimeSaved","customerImpact","consolidation","security"];
  for (const d of dims) {
    const score = r.review.scores[d];
    assert(typeof score === "number" && score >= 0 && score <= 100, `dim ${d} OOB: ${score}`);
  }
});

test("runReview — signals populated for each dimension", () => {
  const r = sre.runReview();
  const dims = Object.keys(r.review.signals);
  assert(dims.length >= 8, `expected >=8 signal dims, got ${dims.length}`);
  for (const d of dims) {
    assert(Array.isArray(r.review.signals[d]), `signals[${d}] not array`);
  }
});

test("runReview — recommendations is array", () => {
  const r = sre.runReview();
  assert(Array.isArray(r.review.recommendations), "recommendations not array");
  assert(r.review.recommendations.length >= 1, "no recommendations");
});

test("runReview — each recommendation has priority + action + impact", () => {
  const r = sre.runReview();
  for (const rec of r.review.recommendations) {
    assert(rec.priority, `rec missing priority`);
    assert(rec.action,   `rec missing action`);
    assert(rec.impact,   `rec missing impact`);
  }
});

test("runReview — minutesSaved is a number", () => {
  const r = sre.runReview();
  assert(typeof r.review.minutesSaved === "number", "minutesSaved not a number");
  assert(r.review.minutesSaved >= 0, "negative minutesSaved");
});

test("runReview — debtPoints is a number", () => {
  const r = sre.runReview();
  assert(typeof r.review.debtPoints === "number", "debtPoints not a number");
});

test("getLatestReview — returns most recent review", () => {
  const rev = sre.getLatestReview();
  assert(rev?.id, "no id");
  assert(rev.overall >= 0, "no overall");
});

test("getReview — retrieves by id", () => {
  const rev = sre.getReview(reviewId);
  assert(rev?.id === reviewId, "wrong review returned");
});

test("getReview — returns null for unknown id", () => {
  const rev = sre.getReview("nonexistent_review");
  assert(rev === null, "should return null");
});

test("listReviews — returns array", () => {
  const list = sre.listReviews({ limit: 5 });
  assert(Array.isArray(list) && list.length >= 1, "no reviews");
});

test("listReviews — sorted newest first", () => {
  // Run two more reviews to have ordering to check
  sre.runReview();
  sre.runReview();
  const list = sre.listReviews({ limit: 3 });
  if (list.length >= 2) {
    assert(new Date(list[0].createdAt) >= new Date(list[1].createdAt), "not sorted newest first");
  }
});

test("getTrend — not enough reviews returns ok:false initially then ok:true after enough", () => {
  // We've run >= 2 reviews now, so might have enough
  const t = sre.getTrend();
  assert(typeof t === "object", "not an object");
  // Either ok:true with trend or ok:false with reason — both valid
  if (t.ok) {
    assert(t.trend, "no trend data");
    assert(typeof t.trend.architecture === "object", "no architecture trend");
  } else {
    assert(t.reason, "no reason");
  }
});

test("getTrend — when ok, all 9 dims present in trend", () => {
  // Run enough reviews to get a trend
  for (let i = 0; i < 4; i++) sre.runReview();
  const t = sre.getTrend();
  if (t.ok) {
    const dims = ["architecture","autonomy","technicalDebt","reliability","performance","founderTimeSaved","customerImpact","consolidation","security"];
    for (const d of dims) {
      assert(t.trend[d], `trend missing dim: ${d}`);
      assert(["improving","declining","stable"].includes(t.trend[d].direction), `bad direction for ${d}`);
    }
  }
});

test("runReview — P1 consolidation fix shows in signals", () => {
  const r = sre.runReview();
  const consolSig = r.review.signals.consolidation || [];
  assert(consolSig.includes("P1_intelligence_fix_applied"), "P1 fix not detected in consolidation signals");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Consolidation Audit
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[post-omega-P1] Block 3: Consolidation Audit");

let auditId;

test("runAudit — returns ok", () => {
  const r = ca.runAudit();
  assert(r.ok, `failed: ${r.error}`);
  assert(r.audit?.id, "no audit id");
  auditId = r.audit.id;
});

test("runAudit — summary has all required fields", () => {
  const r = ca.runAudit();
  const s = r.audit.summary;
  assert(typeof s.openDuplicates         === "number", "missing openDuplicates");
  assert(typeof s.resolvedDuplicates     === "number", "missing resolvedDuplicates");
  assert(typeof s.filesWithPlaceholders  === "number", "missing filesWithPlaceholders");
  assert(typeof s.totalPlaceholderCount  === "number", "missing totalPlaceholderCount");
  assert(typeof s.unmountedRouteFiles    === "number", "missing unmountedRouteFiles");
  assert(typeof s.phaseRouteFiles        === "number", "missing phaseRouteFiles");
  assert(typeof s.phaseRouteTotal        === "number", "missing phaseRouteTotal");
});

test("runAudit — consolidationScore 0-100", () => {
  const r = ca.runAudit();
  const s = r.audit.consolidationScore;
  assert(typeof s === "number" && s >= 0 && s <= 100, `OOB: ${s}`);
});

test("runAudit — duplicates array includes known items", () => {
  const r = ca.runAudit();
  assert(Array.isArray(r.audit.duplicates) && r.audit.duplicates.length >= 1, "no duplicates");
  assert(r.audit.duplicates.every(d => d.id && d.category && d.severity && d.action), "duplicate missing fields");
});

test("runAudit — phaseStats covers phase18-27", () => {
  const r = ca.runAudit();
  assert(r.audit.phaseStats.length === 10, `expected 10 phase files, got ${r.audit.phaseStats.length}`);
  assert(r.audit.phaseStats.every(p => p.routes > 0), "some phase files have 0 routes");
});

test("runAudit — placeholderFiles is an array with file + total", () => {
  const r = ca.runAudit();
  assert(Array.isArray(r.audit.placeholderFiles), "not array");
  if (r.audit.placeholderFiles.length > 0) {
    const f = r.audit.placeholderFiles[0];
    assert(f.file, "missing file");
    assert(typeof f.total === "number" && f.total > 0, "missing total");
    assert(f.breakdown && typeof f.breakdown === "object", "missing breakdown");
  }
});

test("runAudit — totalPlaceholders > 0 (known placeholders exist)", () => {
  const r = ca.runAudit();
  assert(r.audit.summary.totalPlaceholderCount > 0, "expected some placeholders found");
});

test("getLatestAudit — returns audit", () => {
  const a = ca.getLatestAudit();
  assert(a?.id, "no audit returned");
  assert(a.summary, "no summary");
});

test("listAudits — returns array", () => {
  const list = ca.listAudits({ limit: 5 });
  assert(Array.isArray(list) && list.length >= 1, "no audits");
});

test("getConsolidationPlan — returns plan with openItems + nextSprint", () => {
  const plan = ca.getConsolidationPlan();
  assert(Array.isArray(plan.openItems), "openItems not array");
  assert(plan.nextSprint?.title, "missing nextSprint.title");
  assert(Array.isArray(plan.nextSprint.items) && plan.nextSprint.items.length >= 1, "no sprint items");
  assert(plan.nextSprint.items.every(i => i.action && i.impact && i.effort), "item missing fields");
  assert(plan.estimatedDebtReduction, "missing estimatedDebtReduction");
});

test("markResolved — marks known duplicate resolved", () => {
  const r = ca.markResolved("automationService_dual_format");
  assert(r.ok, `failed: ${r.error}`);
  assert(r.duplicate.resolved === true, "not marked resolved");
  assert(r.duplicate.resolvedAt, "no resolvedAt");
});

test("markResolved — unknown id returns error", () => {
  const r = ca.markResolved("nonexistent_dup");
  assert(!r.ok, "should fail for unknown id");
  assert(r.error, "no error message");
});

test("KNOWN_DUPLICATES — exported and includes 3 known items", () => {
  assert(Array.isArray(ca.KNOWN_DUPLICATES), "not array");
  assert(ca.KNOWN_DUPLICATES.length >= 3, `expected >=3, got ${ca.KNOWN_DUPLICATES.length}`);
  assert(ca.KNOWN_DUPLICATES.every(d => d.id && d.files && d.category && d.severity && d.action), "dup missing fields");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — Integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[post-omega-P1] Block 4: Integration");

test("getCorrelations + runReview — no interference", () => {
  il.invalidateCache();
  const corr = il.getCorrelations();
  const rev  = sre.runReview();
  assert(corr.correlations, "correlations broken");
  assert(rev.ok, "review broken");
});

test("runAudit consolidationScore feeds into review consolidation signals", () => {
  ca.runAudit();
  const rev = sre.runReview();
  // consolidation score should reflect audit state
  assert(typeof rev.review.scores.consolidation === "number", "no consolidation score in review");
});

test("review persists across calls — id stable", () => {
  const r1 = sre.getLatestReview();
  sre.runReview();
  const r2 = sre.getLatestReview();
  assert(r2.id !== r1.id, "id did not change after new review");
});

test("audit summary open vs resolved after markResolved", () => {
  // automationService_dual_format was marked resolved above
  const plan = ca.getConsolidationPlan();
  assert(plan.resolvedItems.some(d => d.id === "automationService_dual_format"), "not in resolvedItems");
});

console.log(`\n[post-omega-P1] Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
