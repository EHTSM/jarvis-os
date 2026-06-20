"use strict";
/**
 * Browser Automation Commercial Benchmark.
 *
 * Verifies: Can Ooplix automate GitHub, LinkedIn, Instagram, Figma, Shopify, Razorpay?
 * Outputs: automation score per platform, commercial readiness, regression pass/fail.
 *
 * Runs lightweight smoke tests (no actual external calls) to verify the
 * automation stack is wired: nlBrowser can parse, hitl can gate,
 * marketplace has flows, memory can store.
 */

const nlBrowser        = require("./nlBrowser.cjs");
const humanInTheLoop   = require("./humanInTheLoop.cjs");
const browserMarketplace = require("./browserMarketplace.cjs");
const browserMemory    = require("./browserMemory.cjs");
const browserRegistry  = require("./browserRegistry.cjs");

const PLATFORMS = [
  { id: "github",    name: "GitHub",    intent: "Create a pull request on GitHub", category: "development", expected_cap: "code" },
  { id: "linkedin",  name: "LinkedIn",  intent: "Login to LinkedIn",               category: "social",      expected_cap: "chat" },
  { id: "instagram", name: "Instagram", intent: "Publish Instagram post",           category: "social",      expected_cap: "image" },
  { id: "figma",     name: "Figma",     intent: "Export Figma frame",              category: "design",      expected_cap: "vision" },
  { id: "shopify",   name: "Shopify",   intent: "Add product to Shopify store",    category: "ecommerce",   expected_cap: "chat" },
  { id: "razorpay",  name: "Razorpay",  intent: "Create Razorpay payment link",    category: "fintech",     expected_cap: "chat" },
];

async function runBenchmark() {
  const results = [];

  for (const platform of PLATFORMS) {
    const checks = [];

    // 1. NL parse — can we turn the intent into steps?
    let steps = [];
    let nlSource = "unknown";
    try {
      const parsed = await nlBrowser.parse(platform.intent, { useKnownFlow: true });
      steps    = parsed.steps || [];
      nlSource = parsed.source;
      checks.push({ check: "nl_parse",         ok: steps.length > 0, steps: steps.length, source: nlSource });
    } catch (e) {
      checks.push({ check: "nl_parse",         ok: false, error: e.message });
    }

    // 2. Danger detection — HITL wired?
    try {
      const flagged = humanInTheLoop.scanSteps(steps, platform.intent);
      checks.push({ check: "hitl_scan",        ok: true, flaggedSteps: flagged.length });
    } catch (e) {
      checks.push({ check: "hitl_scan",        ok: false, error: e.message });
    }

    // 3. Marketplace — does a flow exist?
    const mFlows = browserMarketplace.getCatalogue({ search: platform.id });
    checks.push({ check: "marketplace_flow",  ok: mFlows.length > 0, count: mFlows.length });

    // 4. Memory — can we store a flow record?
    try {
      browserMemory.rememberFlow(`benchmark_${platform.id}`, steps, { success: true, tags: ["benchmark"] });
      const stored = browserMemory.getBestFlow(`benchmark_${platform.id}`);
      checks.push({ check: "memory_store",    ok: !!stored });
    } catch (e) {
      checks.push({ check: "memory_store",    ok: false, error: e.message });
    }

    // 5. Browser registry — automated browser available?
    const browser = browserRegistry.getAvailable()[0];
    checks.push({ check: "browser_available", ok: !!browser, browser: browser?.id || null });

    const passing = checks.filter(c => c.ok).length;
    const score   = Math.round((passing / checks.length) * 100);

    results.push({
      platform: platform.id,
      name:     platform.name,
      score,
      passing,
      total:    checks.length,
      checks,
      ready:    score >= 60,
    });
  }

  const overallScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  const allReady     = results.every(r => r.ready);
  const readyCount   = results.filter(r => r.ready).length;

  // Regression: all 6 platforms must parse NL intent
  const regressionPass = results.every(r => r.checks.find(c => c.check === "nl_parse")?.ok);

  return {
    overallScore,
    commercialReadiness: overallScore >= 75 ? "ready" : overallScore >= 50 ? "developing" : "pre_commercial",
    platformsReady:      readyCount,
    totalPlatforms:      PLATFORMS.length,
    regressionPass,
    allReady,
    results,
    ts: new Date().toISOString(),
  };
}

module.exports = { runBenchmark, PLATFORMS };
