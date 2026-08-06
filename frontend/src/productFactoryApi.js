"use strict";
// A.8.3 recovery: /product-factory/* client — productPlannerEngine.cjs +
// productReleaseEngine.cjs (POST-Ω Sprint P12 Autonomous Product Factory)
// were fully built and wired to real routes (backend/routes/productFactory.js)
// with real persisted data (data/product-plans.json) but had zero frontend
// consumers. Same recovery pattern as customerOrgApi.js.
import { _fetch } from "./_client";

export async function getDashboard() {
  return _fetch("/product-factory/dashboard");
}

export async function createPlan({ objective, context, skipResearch }) {
  return _fetch("/product-factory/plan", { method: "POST", body: JSON.stringify({ objective, context, skipResearch }) });
}

export async function getPlan(id) {
  return _fetch(`/product-factory/plan/${encodeURIComponent(id)}`);
}

export async function listPlans({ limit = 50, status } = {}) {
  const q = new URLSearchParams();
  q.set("limit", limit);
  if (status) q.set("status", status);
  return _fetch(`/product-factory/plans?${q.toString()}`);
}

export async function getPlanStats() {
  return _fetch("/product-factory/plan/stats");
}

export async function createRelease(planId) {
  return _fetch(`/product-factory/release/${encodeURIComponent(planId)}`, { method: "POST", body: JSON.stringify({}) });
}

export async function getReleaseForPlan(planId) {
  return _fetch(`/product-factory/release/plan/${encodeURIComponent(planId)}`);
}
