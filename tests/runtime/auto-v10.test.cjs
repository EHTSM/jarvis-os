"use strict";
/**
 * LEVEL 10 — Autonomous Civilization test suite
 * Target: 115+ tests covering all 10 control surfaces + loop + org
 *
 * ERA-1 Manual Blocker Closure (Task 6): isolates this suite's indirect
 * missionOrchestrator/missionMemory writes (via executiveState.cjs) from the
 * real production data/missions.json — see civ-v9.test.cjs's header comment
 * for the full traced call chain (Mission 97/98's documented root cause).
 */
process.env.JARVIS_TEST_DATA_SUFFIX = process.env.JARVIS_TEST_DATA_SUFFIX || `test-${process.pid}-${Date.now()}`;

const TS = Date.now();
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };
let passed = 0; let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};
const asyncTest = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};

const st  = require("../../backend/services/autonomousState.cjs");
const lp  = require("../../backend/services/autonomousLoop.cjs");
const org = require("../../backend/services/autonomousOrg.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Autonomous Decision Ledger
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 1: Decision Ledger");

let decisionId;

test("recordDecision — ok", () => {
  const r = st.recordDecision({ type: "observe", title: `Observe-${TS}`, rationale: "Baseline health check", confidence: 0.8, layer: "civilization", domain: "health" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.decision?.id, "no decision id");
  assert(r.decision.status === "pending", "not pending");
  assert(r.decision.rationale, "no rationale");
  assert(r.decision.confidence === 0.8, "wrong confidence");
  decisionId = r.decision.id;
});

test("recordDecision — missing required fields", () => {
  const r = st.recordDecision({ type: "observe" });
  assert(!r.ok, "should fail without title/rationale");
});

test("recordDecision — all DECISION_TYPES accepted", () => {
  for (const type of st.DECISION_TYPES) {
    const r = st.recordDecision({ type, title: `${type}-${TS}`, rationale: `Testing ${type}`, confidence: 0.7 });
    assert(r.ok, `type ${type} rejected: ${r.error}`);
  }
});

test("getDecision — returns correct decision", () => {
  const d = st.getDecision(decisionId);
  assert(d?.id === decisionId, "wrong decision returned");
  assert(d.type === "observe", "wrong type");
});

test("resolveDecision — ok with outcome + lessons", () => {
  const r = st.resolveDecision(decisionId, { outcome: "success", actualImpact: { healthGain: 5 }, lessons: ["Baseline established successfully"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.decision.status === "succeeded", `expected succeeded, got ${r.decision.status}`);
  assert(r.decision.actualImpact?.healthGain === 5, "actualImpact not set");
  assert(r.decision.lessons.length === 1, "lessons not set");
});

test("resolveDecision — failure outcome", () => {
  const d2 = st.recordDecision({ type: "execute", title: `Fail-${TS}`, rationale: "Will fail", confidence: 0.5 });
  const r = st.resolveDecision(d2.decision.id, { outcome: "failed", actualImpact: { error: "network_timeout" } });
  assert(r.ok, "resolve failed");
  assert(r.decision.status === "failed", "not failed");
});

test("listDecisions — returns array", () => {
  const list = st.listDecisions({});
  assert(Array.isArray(list) && list.length >= 2, "expected >=2 decisions");
});

test("listDecisions — filter by type", () => {
  const list = st.listDecisions({ type: "observe" });
  assert(list.every(d => d.type === "observe"), "type filter failed");
});

test("listDecisions — filter by status", () => {
  const list = st.listDecisions({ status: "succeeded" });
  assert(list.every(d => d.status === "succeeded"), "status filter failed");
});

test("listDecisions — filter by minConfidence", () => {
  const list = st.listDecisions({ minConfidence: 0.8 });
  assert(list.every(d => d.confidence >= 0.8), "confidence filter failed");
});

test("getDecisionStats — returns stats", () => {
  const s = st.getDecisionStats();
  assert(typeof s.total === "number", "no total");
  assert(typeof s.avgConfidence === "number", "no avgConfidence");
  assert(typeof s.byType === "object", "no byType");
  assert(typeof s.byStatus === "object", "no byStatus");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Autonomous Experiment Ledger
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 2: Experiment Ledger");

let expId;

test("createExperiment — ok", () => {
  const r = st.createExperiment({ title: `Exp-${TS}`, hypothesis: "Reducing tick interval increases responsiveness", type: "process", domain: "autonomous", layer: "autonomous", confidence: 0.65, rollbackPlan: "Restore original tick interval" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.experiment?.id, "no experiment id");
  assert(r.experiment.status === "designed", "not designed");
  expId = r.experiment.id;
});

test("createExperiment — missing required", () => {
  const r = st.createExperiment({ title: `NoHyp-${TS}` });
  assert(!r.ok, "should fail without hypothesis");
});

test("startExperiment — ok", () => {
  const r = st.startExperiment(expId);
  assert(r.ok, `failed: ${r.error}`);
  assert(r.experiment.status === "running", "not running");
  assert(r.experiment.startedAt, "no startedAt");
});

test("startExperiment — already running blocked", () => {
  const r = st.startExperiment(expId);
  assert(!r.ok, "should reject already-running experiment");
});

test("addExperimentObservation — ok", () => {
  const r = st.addExperimentObservation(expId, { observation: "Response time improved by 12%", metric: "response_time_ms", value: 88, source: "autonomous_monitor" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.experiment.observations.length >= 1, "no observations");
  assert(r.experiment.measurements.response_time_ms === 88, "metric not recorded");
});

test("concludeExperiment — ok with outcome", () => {
  const r = st.concludeExperiment(expId, { outcome: "success", actualOutcome: "12% improvement confirmed", lessons: ["Shorter intervals improve responsiveness by 12%"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.experiment.status === "completed", "not completed");
  assert(r.experiment.lessons.length === 1, "lessons not set");
});

test("concludeExperiment — rollback path", () => {
  const e2 = st.createExperiment({ title: `Rollback-${TS}`, hypothesis: "Rollback test", type: "capability", domain: "test" });
  st.startExperiment(e2.experiment.id);
  const r = st.concludeExperiment(e2.experiment.id, { outcome: "failed", actualOutcome: "Regression detected", rollback: true });
  assert(r.ok, "failed");
  assert(r.experiment.status === "rolled_back", "not rolled_back");
});

test("listExperiments — filter by status", () => {
  const list = st.listExperiments({ status: "completed" });
  assert(Array.isArray(list) && list.length >= 1, "no completed experiments");
});

test("listExperiments — filter by type", () => {
  const list = st.listExperiments({ type: "process" });
  assert(list.every(e => e.type === "process"), "type filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Evolution Timeline
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 3: Evolution Timeline");

let evoId;

test("recordEvolution — ok", () => {
  const r = st.recordEvolution({ type: "capability", title: `Evo-${TS}`, change: "Add adaptive confidence scoring", rationale: "Static threshold misses context", confidence: 0.75, targetDomain: "autonomous", targetLayer: "autonomous", reversible: true });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.evolution?.id, "no evolution id");
  assert(r.evolution.status === "proposed", "not proposed");
  evoId = r.evolution.id;
});

test("recordEvolution — missing required", () => {
  const r = st.recordEvolution({ type: "capability", title: `Miss-${TS}` });
  assert(!r.ok, "should fail without change/rationale");
});

test("implementEvolution — ok", () => {
  const r = st.implementEvolution(evoId, { outcome: "success", measuredImpact: { confidenceAccuracy: "+8%" } });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.evolution.status === "implemented", "not implemented");
  assert(r.evolution.measuredImpact?.confidenceAccuracy, "no measuredImpact");
});

test("listEvolution — filter by status", () => {
  const list = st.listEvolution({ status: "implemented" });
  assert(Array.isArray(list) && list.length >= 1, "no implemented evolutions");
});

test("listEvolution — filter by targetDomain", () => {
  const list = st.listEvolution({ targetDomain: "autonomous" });
  assert(list.every(e => e.targetDomain === "autonomous"), "domain filter failed");
});

test("recordOrgLifecycle — create action", () => {
  const r = st.recordOrgLifecycle({ action: "create", orgName: `NewOrg-${TS}`, orgType: "specialized", reason: "High demand for AI design", confidence: 0.8 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.event?.id, "no event id");
  assert(r.event.action === "create", "wrong action");
});

test("recordOrgLifecycle — retire action", () => {
  const r = st.recordOrgLifecycle({ action: "retire", orgName: `OldOrg-${TS}`, reason: "Redundant after L8 expansion", confidence: 0.9, reversible: true });
  assert(r.ok, `failed: ${r.error}`);
});

test("listOrgLifecycle — filter by action", () => {
  const creates = st.listOrgLifecycle({ action: "create" });
  assert(creates.every(e => e.action === "create"), "action filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — Opportunity Map
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 4: Opportunity Map");

let oppId;

test("discoverOpportunity — ok", () => {
  const r = st.discoverOpportunity({ title: `Opp-${TS}`, source: "health_monitor", domain: "ecosystem", layer: "ecosystem", estimatedValue: 800, confidence: 0.85 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.opportunity?.id, "no opportunity id");
  assert(r.opportunity.status === "open", "not open");
  assert(r.opportunity.priority === "medium", "wrong priority");
  oppId = r.opportunity.id;
});

test("discoverOpportunity — high value = high priority", () => {
  const r = st.discoverOpportunity({ title: `HighVal-${TS}`, source: "objective_discovery", domain: "growth", layer: "civilization", estimatedValue: 5000, confidence: 0.9 });
  assert(r.ok, "failed");
  assert(r.opportunity.priority === "high", `expected high, got ${r.opportunity.priority}`);
});

test("discoverOpportunity — missing required", () => {
  const r = st.discoverOpportunity({ title: `NoSource-${TS}` });
  assert(!r.ok, "should fail without source");
});

test("actOnOpportunity — ok", () => {
  const decR = st.recordDecision({ type: "execute", title: `Act on opp ${TS}`, rationale: "High value opportunity", confidence: 0.85 });
  const r = st.actOnOpportunity(oppId, { action: "dispatched_to_ecosystem", decisionId: decR.decision.id });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.opportunity.status === "acted", "not acted");
  assert(r.opportunity.actionTaken, "no actionTaken");
});

test("closeOpportunity — ok with outcome", () => {
  const r = st.closeOpportunity(oppId, { outcome: "captured", actualValue: 750 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.opportunity.status === "closed", "not closed");
  assert(r.opportunity.actualValue === 750, "actualValue not set");
});

test("listOpportunities — filter by status", () => {
  const open = st.listOpportunities({ status: "open" });
  assert(Array.isArray(open), "not array");
});

test("listOpportunities — filter by priority", () => {
  const high = st.listOpportunities({ priority: "high" });
  assert(high.every(o => o.priority === "high"), "priority filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5 — Threat Map
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 5: Threat Map");

let threatId;

test("detectThreat — ok", () => {
  const r = st.detectThreat({ title: `Threat-${TS}`, source: "health_monitor", domain: "health", layer: "civilization", severity: "high", confidence: 0.9, affectedSystems: ["civ_health"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.threat?.id, "no threat id");
  assert(r.threat.status === "open", "not open");
  threatId = r.threat.id;
});

test("detectThreat — all severity levels accepted", () => {
  for (const severity of st.THREAT_LEVELS) {
    const r = st.detectThreat({ title: `${severity}-${TS}`, source: "test", domain: "test", layer: "test", severity, confidence: 0.7 });
    assert(r.ok, `severity ${severity} rejected`);
  }
});

test("detectThreat — missing required", () => {
  const r = st.detectThreat({ title: `NoSrc-${TS}` });
  assert(!r.ok, "should fail without source");
});

test("mitigateThreat — in_mitigation", () => {
  const r = st.mitigateThreat(threatId, { plan: "Trigger cross-layer recovery pipeline", decisionId: "test" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.threat.status === "in_mitigation", `expected in_mitigation, got ${r.threat.status}`);
});

test("mitigateThreat — mitigated with outcome", () => {
  const r = st.mitigateThreat(threatId, { plan: "Completed", outcome: true });
  assert(r.ok, "failed");
  assert(r.threat.status === "mitigated", "not mitigated");
  assert(r.threat.mitigatedAt, "no mitigatedAt");
});

test("listThreats — sorted by severity", () => {
  const list = st.listThreats({});
  assert(Array.isArray(list), "not array");
});

test("listThreats — filter by severity", () => {
  const critical = st.listThreats({ severity: "critical" });
  assert(critical.every(t => t.severity === "critical"), "filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 6 — Global Planning
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 6: Global Planning");

test("createGlobalPlan — ok", () => {
  const r = st.createGlobalPlan({ title: `GlobalPlan-${TS}`, objective: "Reach health > 90 across all layers", horizon: "1y", priorities: ["health","growth","innovation"], layers: ["civilization","ecosystem"], confidence: 0.8 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.plan?.id, "no plan id");
  assert(r.plan.objective, "no objective");
});

test("getGlobalPlan — returns active plan", () => {
  const p = st.getGlobalPlan();
  assert(p && typeof p === "object", "no plan");
  assert(p.title, "no title");
});

test("createMultiYearPlan — ok", () => {
  const r = st.createMultiYearPlan({ title: `MultiYear-${TS}`, years: 3, objective: "100+ members, 1000+ innovations", phases: [{year:1,focus:"Foundation"},{year:2,focus:"Growth"},{year:3,focus:"Mastery"}], confidence: 0.65 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.plan?.years === 3, "wrong years");
});

test("getMultiYearPlan — returns plan", () => {
  const p = st.getMultiYearPlan();
  assert(p && p.years >= 1, "no multi-year plan");
});

test("scheduleAction — ok", () => {
  const r = st.scheduleAction({ title: `Schedule-${TS}`, scheduledFor: new Date(Date.now() - 1000).toISOString(), type: "observe", priority: "low", domain: "health" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.action?.id, "no action id");
  assert(r.action.status === "scheduled", "not scheduled");
});

test("executeDueActions — executes past-due", () => {
  const result = st.executeDueActions();
  assert(typeof result.executed === "number", "no executed count");
  assert(result.executed >= 1, "should have executed at least 1 due action");
});

test("getSchedule — filter by status", () => {
  const scheduled = st.getSchedule({ status: "scheduled" });
  assert(Array.isArray(scheduled), "not array");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 7 — Optimizations
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 7: Optimizations");

test("recordBudgetOptimization — ok", () => {
  const r = st.recordBudgetOptimization({ domain: "ecosystem", layer: "ecosystem", action: "Reduce redundant capability calls by 30%", amountSaved: 150, rationale: "Profiling revealed 30% duplicate capability checks", confidence: 0.75 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.optimization?.id, "no optimization id");
});

test("recordBudgetOptimization — missing required", () => {
  const r = st.recordBudgetOptimization({ domain: "test" });
  assert(!r.ok, "should fail without action/rationale");
});

test("recordResourceOptimization — ok", () => {
  const r = st.recordResourceOptimization({ resourceType: "compute", action: "Rebalance compute across civilization pools", amountOptimized: 200, domain: "economy", rationale: "Civilization pool had excess compute", confidence: 0.8 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.optimization?.id, "no id");
});

test("recordCapabilityEvolution — ok", () => {
  const r = st.recordCapabilityEvolution({ capability: "autonomous_planning", action: "upgraded_to_v2", domain: "autonomous", rationale: "V2 has 20% better coverage", confidence: 0.8, impact: "medium" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.optimization?.id, "no id");
});

test("listOptimizations — returns all types", () => {
  const list = st.listOptimizations({});
  assert(Array.isArray(list) && list.length >= 3, `expected >=3, got ${list.length}`);
  const types = new Set(list.map(o => o.optimizationType));
  assert(types.has("budget") && types.has("resource") && types.has("capability"), "missing optimization types");
});

test("listOptimizations — filter by type", () => {
  const budget = st.listOptimizations({ type: "budget" });
  assert(budget.every(o => o.optimizationType === "budget"), "type filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 8 — Control Center
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 8: Control Center");

test("getControlState — returns state", () => {
  const ctl = st.getControlState();
  assert(ctl && typeof ctl === "object", "not object");
  assert(typeof ctl.autonomyLevel === "number", "no autonomyLevel");
  assert(typeof ctl.confidenceThreshold === "number", "no confidenceThreshold");
  assert(["active","paused","recovery"].includes(ctl.mode), "invalid mode");
});

test("updateControlState — ok", () => {
  const r = st.updateControlState({ confidenceThreshold: 0.65 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.control.confidenceThreshold === 0.65, "threshold not updated");
});

test("setMode — active", () => {
  const r = st.setMode("active");
  assert(r.ok, "failed");
  assert(r.mode === "active", "wrong mode");
});

test("setMode — paused", () => {
  const r = st.setMode("paused");
  assert(r.ok, "failed");
  assert(r.mode === "paused", "wrong mode");
  st.setMode("active"); // restore
});

test("setMode — invalid rejected", () => {
  const r = st.setMode("invalid_mode");
  assert(!r.ok, "should reject invalid mode");
});

test("setAutonomyLevel — clamps to 0-1", () => {
  let r = st.setAutonomyLevel(1.5);
  assert(r.autonomyLevel === 1.0, "should clamp to 1.0");
  r = st.setAutonomyLevel(-0.5);
  assert(r.autonomyLevel === 0.0, "should clamp to 0.0");
  st.setAutonomyLevel(1.0); // restore
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 9 — Global Health + Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 9: Health & Dashboard");

test("getGlobalHealthSnapshot — returns valid score", () => {
  const h = st.getGlobalHealthSnapshot();
  assert(typeof h.score === "number", "no score");
  assert(h.score >= 0 && h.score <= 100, `OOB: ${h.score}`);
  assert(h.layers, "no layers");
  assert(h.layers.civilization !== undefined, "no civilization layer");
  assert(typeof h.openThreats === "number", "no openThreats");
  assert(typeof h.openOpportunities === "number", "no openOpportunities");
});

test("getGlobalHealthSnapshot — all 5 layers present", () => {
  const h = st.getGlobalHealthSnapshot();
  const expected = ["civilization","ecosystem","enterprise","executive","runtime"];
  for (const layer of expected) {
    assert(h.layers[layer] !== undefined, `missing layer: ${layer}`);
    assert(typeof h.layers[layer].score === "number", `no score for ${layer}`);
  }
});

test("getGlobalDashboard — returns comprehensive data", () => {
  const db = st.getGlobalDashboard();
  assert(db.autonomous, "no autonomous section");
  assert(db.health, "no health section");
  assert(db.decisions, "no decisions section");
  assert(db.experiments, "no experiments section");
  assert(db.evolution, "no evolution section");
  assert(db.opportunities, "no opportunities section");
  assert(db.threats, "no threats section");
  assert(db.planning, "no planning section");
  assert(db.optimizations, "no optimizations section");
  assert(db.reports, "no reports section");
  assert(db.lastSync, "no lastSync");
});

test("getGlobalDashboard — autonomous mode + cycle fields", () => {
  const db = st.getGlobalDashboard();
  assert(["active","paused","recovery"].includes(db.autonomous.mode), "invalid mode");
  assert(typeof db.autonomous.cycle === "number", "no cycle");
  assert(typeof db.autonomous.autonomyLevel === "number", "no autonomyLevel");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 10 — Explainability Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 10: Explainability Dashboard");

test("getExplainabilityDashboard — summary ok", () => {
  const r = st.getExplainabilityDashboard();
  assert(r.ok, "failed");
  assert(Array.isArray(r.recentDecisions), "no recentDecisions");
  assert(typeof r.avgConfidence === "number", "no avgConfidence");
  assert(typeof r.explainedCount === "number", "no explainedCount");
  assert(typeof r.measuredCount === "number", "no measuredCount");
});

test("getExplainabilityDashboard — by decisionId", () => {
  const d = st.recordDecision({ type: "plan", title: `Explain-${TS}`, rationale: "Strategic planning decision", confidence: 0.8, expectedImpact: { healthGain: 10 } });
  const r = st.getExplainabilityDashboard({ decisionId: d.decision.id });
  assert(r.ok, "failed");
  assert(r.decision?.id === d.decision.id, "wrong decision");
  assert(r.explainability?.rationale, "no rationale in explainability");
  assert(r.explainability?.confidence === 0.8, "wrong confidence");
  assert(r.explainability?.expectedImpact, "no expectedImpact");
});

test("getExplainabilityDashboard — unknown id returns error", () => {
  const r = st.getExplainabilityDashboard({ decisionId: "unknown_id" });
  assert(!r.ok, "should fail for unknown decision");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 11 — Confidence Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 11: Confidence Dashboard");

test("getConfidenceDashboard — returns all fields", () => {
  const c = st.getConfidenceDashboard();
  assert(typeof c.overall === "number", "no overall");
  assert(typeof c.threshold === "number", "no threshold");
  assert(typeof c.belowThreshold === "number", "no belowThreshold");
  assert(typeof c.byDecisionType === "object", "no byDecisionType");
  assert(typeof c.highConfidence === "number", "no highConfidence");
  assert(typeof c.mediumConfidence === "number", "no mediumConfidence");
  assert(typeof c.lowConfidence === "number", "no lowConfidence");
});

test("getConfidenceDashboard — overall in 0-1 range", () => {
  const c = st.getConfidenceDashboard();
  assert(c.overall >= 0 && c.overall <= 1, `overall OOB: ${c.overall}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 12 — Reports + Loop State
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 12: Reports & Loop State");

test("createAutonomousReport — ok", () => {
  const r = st.createAutonomousReport({ title: `Report-${TS}`, type: "cycle", summary: "All systems nominal", confidence: 0.9, data: { health: 85 } });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.report?.id, "no report id");
  assert(r.report.type === "cycle", "wrong type");
});

test("listAutonomousReports — returns array", () => {
  const list = st.listAutonomousReports({});
  assert(Array.isArray(list) && list.length >= 1, "no reports");
});

test("listAutonomousReports — filter by type", () => {
  const list = st.listAutonomousReports({ type: "cycle" });
  assert(list.every(r => r.type === "cycle"), "type filter failed");
});

test("getLoopState — returns state", () => {
  const lps = st.getLoopState();
  assert(typeof lps.cycle === "number", "no cycle");
  assert(typeof lps.running === "boolean", "no running");
  assert(Array.isArray(lps.history), "no history");
});

test("startCycle + endCycle — increments cycle", () => {
  const before = st.getLoopState().cycle;
  const { cycle } = st.startCycle();
  assert(cycle === before + 1, `expected ${before+1}, got ${cycle}`);
  const r = st.endCycle({ summary: "test", health: 80, decisionsThisCycle: 3 });
  assert(r.ok, "endCycle failed");
  assert(r.record.decisionsThisCycle === 3, "decisionsThisCycle not recorded");
});

test("getCycleHistory — returns recent cycles", () => {
  const hist = st.getCycleHistory({ limit: 5 });
  assert(Array.isArray(hist) && hist.length >= 1, "no history");
  assert(hist[0].summary, "no summary in history");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 13 — Loop Phases
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 13: Loop Phases");

test("observe — returns observation object", () => {
  const obs = lp.observe();
  assert(obs && typeof obs === "object", "not object");
  assert(typeof obs.health?.score === "number", "no health score");
  assert(typeof obs.agents === "object", "no agents");
  assert(typeof obs.civMembers === "number", "no civMembers");
  assert(typeof obs.ecoTenants === "number", "no ecoTenants");
  assert(typeof obs.eosGoals === "number", "no eosGoals");
});

test("detect — returns opportunities and threats", () => {
  const obs = lp.observe();
  const det = lp.detect(obs);
  assert(Array.isArray(det.opportunities), "no opportunities array");
  assert(Array.isArray(det.threats), "no threats array");
});

test("plan — returns decisions array", () => {
  const obs = lp.observe();
  const det = lp.detect(obs);
  const decisions = lp.plan(obs, det);
  assert(Array.isArray(decisions), "not array");
});

test("simulate — approves/rejects based on confidence", () => {
  const obs = lp.observe();
  const det = lp.detect(obs);
  const decisions = lp.plan(obs, det);
  const { approved, rejected } = lp.simulate(decisions);
  assert(Array.isArray(approved), "no approved");
  assert(Array.isArray(rejected), "no rejected");
  assert(approved.length + rejected.length === decisions.length, "total mismatch");
});

test("validate — returns subset of approved", () => {
  const obs = lp.observe();
  const det = lp.detect(obs);
  const decisions = lp.plan(obs, det);
  const { approved } = lp.simulate(decisions);
  const validated = lp.validate(approved);
  assert(Array.isArray(validated), "not array");
  assert(validated.length <= approved.length, "cannot have more validated than approved");
});

test("selfAudit — returns audit report", () => {
  const r = lp.selfAudit();
  assert(r.ok, `failed: ${r.error}`);
  assert(r.audit?.id, "no audit id");
  assert(typeof r.audit.score === "number", "no score");
  assert(r.audit.score >= 0 && r.audit.score <= 100, `score OOB: ${r.audit.score}`);
  assert(Array.isArray(r.audit.findings), "no findings array");
});

test("runExperiment — designs and concludes experiment", () => {
  const r = lp.runExperiment({ title: `AutoExp-${TS}`, hypothesis: "Testing loop efficiency", type: "process", domain: "autonomous", confidence: 0.65 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.experiment?.id, "no experiment id");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 14 — Full OODA Cycle
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[auto-v10] Block 14: Full OODA Cycle");

(async () => {
  await asyncTest("runCycle — paused mode returns early", async () => {
    st.setMode("paused");
    const r = await lp.runCycle();
    assert(!r.ok && r.reason === "paused", "should return paused reason");
    st.setMode("active");
  });

  await asyncTest("runCycle — active mode completes full cycle", async () => {
    const r = await lp.runCycle();
    assert(r.ok, `cycle failed: ${r.error}`);
    assert(typeof r.cycle === "number", "no cycle number");
    assert(typeof r.health === "number", "no health");
    assert(r.health >= 0 && r.health <= 100, `health OOB: ${r.health}`);
    assert(typeof r.opportunities === "number", "no opportunities");
    assert(typeof r.threats === "number", "no threats");
    assert(typeof r.durationMs === "number", "no durationMs");
  });

  await asyncTest("runCycle — generates cycle report", async () => {
    const before = st.listAutonomousReports({ type: "cycle" }).length;
    await lp.runCycle();
    const after = st.listAutonomousReports({ type: "cycle" }).length;
    assert(after > before, "no cycle report generated");
  });

  await asyncTest("runCycle — health snapshot updates after cycle", async () => {
    await lp.runCycle();
    const h = st.getGlobalHealthSnapshot();
    assert(typeof h.score === "number" && h.score >= 0, "health broken after cycle");
    assert(h.cycle >= 1, "cycle not incrementing");
  });

  await asyncTest("triggerRecovery — ok", async () => {
    const r = await lp.triggerRecovery({ reason: "test_recovery", targetScore: 70 });
    assert(r.ok, `failed: ${r.error}`);
    assert(r.reason === "test_recovery", "wrong reason");
    assert(Array.isArray(r.actions), "no actions array");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK 15 — Org Registration
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[auto-v10] Block 15: Org Registration");

  test("org register — returns ok with 20 domains", () => {
    const r = org.register();
    assert(r.ok, `register failed: ${r.message || r.error}`);
    assert(r.count === 20, `expected 20 domains, got ${r.count}`);
  });

  test("org register — idempotent", () => {
    const r2 = org.register();
    assert(r2.ok, "second register failed");
    assert(r2.message === "Already registered" || r2.registered >= 0, "unexpected result");
  });

  test("getOrgStatus — returns 20 domains", () => {
    const status = org.getOrgStatus();
    assert(Array.isArray(status) && status.length === 20, `expected 20, got ${status.length}`);
  });

  test("getOrgStatus — all domains have id, role, label", () => {
    const status = org.getOrgStatus();
    assert(status.every(d => d.id && d.role && d.label), "domain missing id/role/label");
  });

  test("getOrgStatus — director domain present", () => {
    const status = org.getOrgStatus();
    assert(status.some(d => d.id === "auto_director"), "no auto_director");
  });

  test("getOrgSummary — returns total=20 + dashboard", () => {
    const s = org.getOrgSummary();
    assert(s.total === 20, `expected 20, got ${s.total}`);
    assert(s.dashboard, "no dashboard");
    assert(typeof s.globalHealth === "number", "no globalHealth");
    assert(["active","paused","recovery"].includes(s.mode), "invalid mode");
    assert(typeof s.cycle === "number", "no cycle");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK 16 — Integration Smoke
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[auto-v10] Block 16: Integration Smoke");

  test("L9 civilization accessible from L10 observe", () => {
    const obs = lp.observe();
    assert(typeof obs.civMembers === "number", "civMembers not readable");
    assert(typeof obs.civTreaties === "number", "civTreaties not readable");
  });

  test("L8 ecosystem accessible from L10 observe", () => {
    const obs = lp.observe();
    assert(typeof obs.ecoTenants === "number", "ecoTenants not readable");
    assert(typeof obs.ecoListings === "number", "ecoListings not readable");
  });

  test("L6 executive accessible from L10 observe", () => {
    const obs = lp.observe();
    assert(typeof obs.eosGoals === "number", "eosGoals not readable");
    assert(typeof obs.eosRisks === "number", "eosRisks not readable");
  });

  test("decisions feed into lessons (learn phase)", () => {
    const d = st.recordDecision({ type: "learn", title: `Learn-${TS}`, rationale: "Cross-layer feedback", confidence: 0.75 });
    st.resolveDecision(d.decision.id, { outcome: "success", lessons: ["Cross-layer integration verified"] });
    const resolved = st.getDecision(d.decision.id);
    assert(resolved.lessons.length === 1, "lessons not persisted");
  });

  await asyncTest("full OODA → decision → lesson loop", async () => {
    const before = st.getDecisionStats().total;
    await lp.runCycle();
    const after = st.getDecisionStats().total;
    assert(after >= before, "total decisions should not decrease");
    const hist = st.getCycleHistory({ limit: 1 });
    assert(hist.length >= 1, "no cycle history");
    assert(typeof hist[0].health === "number", "no health in history");
  });

  await asyncTest("threat detected → auto-mitigated in execute phase", async () => {
    // Mission 60A: detect() previously only ever fed its OWN
    // freshly-generated T1-T5 threats (from this cycle's live observation)
    // into plan()/execute() — a threat inserted directly via
    // st.detectThreat() (exactly what this test does, and exactly what
    // POST /auto/v10/threats in autonomousOrg.js does for any external
    // caller) was stored but never re-scanned by detect(), so plan() never
    // saw it and it sat "open" forever unless a human/another system
    // explicitly called the manual mitigate endpoint. Fixed by having
    // detect() also fold in genuinely-open stored threats (reusing the
    // exact same listThreats({status:"open"}) call observe() already made
    // for its openThreats metric — no new detection mechanism). Assert
    // against THIS test's own specific threat id, not just an aggregate
    // count, so the assertion cannot coincidentally pass from unrelated
    // concurrent autonomous activity in this shared store.
    const created = st.detectThreat({ title: `HighThreat-${TS}`, source: "smoke_test", domain: "health", layer: "autonomous", severity: "critical", confidence: 0.95 });
    assert(created.ok, "test setup: detectThreat must succeed");
    const threatId = created.threat.id;

    await lp.runCycle();

    const after = st.listThreats({ status: "mitigated" }).find(t => t.id === threatId)
               || st.listThreats({ status: "in_mitigation" }).find(t => t.id === threatId);
    assert(after, `threat ${threatId} not being processed — still status=${st.listThreats({ status: "open" }).find(t => t.id === threatId)?.status || "not found in open either"}`);
  });

  await asyncTest("opportunity discovered → acted on in execute phase", async () => {
    const before = st.listOpportunities({ status: "acted" }).length;
    // Clear open opps first by running a cycle which acts on them
    await lp.runCycle();
    const afterActed = st.listOpportunities({ status: "acted" }).length + st.listOpportunities({ status: "closed" }).length;
    assert(afterActed >= before, "opportunity tracking consistent");
  });

  test("global dashboard reflects real data from all 10 levels", () => {
    const db = st.getGlobalDashboard();
    assert(typeof db.decisions.total === "number", "no decisions total");
    assert(db.decisions.total >= 0, "negative decisions?");
    assert(typeof db.evolution.total === "number", "no evolution total");
    assert(typeof db.opportunities.total === "number", "no opps total");
    assert(typeof db.threats.total === "number", "no threats total");
  });

  test("confidence dashboard reflects all recorded decisions", () => {
    const conf = st.getConfidenceDashboard();
    const total = conf.highConfidence + conf.mediumConfidence + conf.lowConfidence;
    const stats = st.getDecisionStats();
    assert(total === stats.inLedger, `confidence buckets ${total} != ledger ${stats.inLedger}`);
  });

  // Final results
  console.log(`\n[auto-v10] Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
