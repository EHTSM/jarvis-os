"use strict";
/**
 * Goal Engine — verification test
 *
 * Scenarios:
 *   1. Goal creation — all four types, milestone count, task count, field shape
 *   2. Milestone generation — development goal has 5 milestones; keyword trim works
 *   3. Task generation — tasks have required fields, correct types, estimatedMins
 *   4. Progress updates via advanceTask — completionPct, milestone status, health score
 *   5. Completion report — all fields, summary string, duration
 *   6. Goal health scoring — velocity + momentum + focus + alignment dimensions
 *   7. Memory integration — goal registered, getGoalSummary counts correct
 *   8. Type inference — keywords route to correct goal type
 *   9. Goal lifecycle — pause, resume, abandon
 *  10. listGoals filters — type, status, blueprintId
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ge-test-"));
const REAL_DATA = path.resolve(path.join(__dirname, "../../agents/runtime/../../data"));

const _origRead   = fs.readFileSync.bind(fs);
const _origWrite  = fs.writeFileSync.bind(fs);
const _origRename = fs.renameSync.bind(fs);
const _origMkdir  = fs.mkdirSync.bind(fs);

function remap(p) {
    if (typeof p === "string" && p.startsWith(REAL_DATA)) return p.replace(REAL_DATA, TMP_DIR);
    return p;
}
fs.readFileSync  = (p, ...a) => _origRead(remap(p), ...a);
fs.writeFileSync = (p, ...a) => _origWrite(remap(p), ...a);
fs.renameSync    = (p, q, ...a) => _origRename(remap(p), remap(q), ...a);
fs.mkdirSync     = (p, ...a) => { try { _origMkdir(remap(p), ...a); } catch { /* exists */ } };

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.writeFileSync(path.join(TMP_DIR, "goals.json"), JSON.stringify([]));

// ── Engine helpers ────────────────────────────────────────────────
function bust() {
    [require.resolve("../../agents/runtime/goalEngine.cjs"),
     require.resolve("../../agents/runtime/unifiedMemoryEngine.cjs"),
    ].forEach(p => { try { delete require.cache[p]; } catch { /* ok */ } });
}

function ge() { bust(); return require("../../agents/runtime/goalEngine.cjs"); }

function reset() {
    fs.writeFileSync(path.join(TMP_DIR, "goals.json"), JSON.stringify([]));
    bust();
}

// ── Helpers ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
    if (condition) { passed++; console.log(`  ✓ ${label}`); }
    else           { failed++; console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: Goal creation — shape and defaults
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: Goal creation — shape and defaults");
reset();
{
    const G = ge();
    const g = G.createGoal({ title: "Build a login page", type: "development" });

    assert("goalId assigned",              g?.goalId?.startsWith("goal_"));
    assert("title preserved",             g?.title === "Build a login page");
    assert("type = development",          g?.type === "development");
    assert("status = active",             g?.status === "active");
    assert("milestones is array",         Array.isArray(g?.milestones));
    assert("milestones.length >= 3",      (g?.milestones?.length || 0) >= 3,  `len: ${g?.milestones?.length}`);
    assert("completionPct = 0",           g?.completionPct === 0);
    assert("healthScore > 0",             (g?.healthScore || 0) > 0);
    assert("createdAt set",               !!g?.createdAt);
    assert("completionReport null",       g?.completionReport === null);
    assert("each milestone has tasks",    g?.milestones?.every(m => m.tasks?.length >= 1));
    assert("each task has taskId",        g?.milestones?.flatMap(m => m.tasks).every(t => t.taskId?.startsWith("t_")));
    assert("goal persisted",              !!G.getGoal(g.goalId));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: Milestone generation — counts and keyword trim
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: Milestone generation");
reset();
{
    const G = ge();

    // Full development goal = 5 milestones
    const full = G.createGoal({ title: "Build subscription system", type: "development" });
    assert("development goal has 5 milestones", full?.milestones?.length === 5,
        `len: ${full?.milestones?.length}`);
    assert("milestones in seq order", full?.milestones?.every((m, i) => m.seq === i + 1));
    assert("first milestone = Design",    full?.milestones?.[0]?.title === "Design");
    assert("last milestone = Monitor",    full?.milestones?.[4]?.title === "Monitor");

    // Quick fix = 3 milestones (keyword trim)
    const quick = G.createGoal({ title: "Quick fix the auth bug", type: "development", description: "quick small fix" });
    assert("quick fix goal has <= 3 milestones", (quick?.milestones?.length || 0) <= 3,
        `len: ${quick?.milestones?.length}`);

    // All four types get milestones
    for (const type of ["personal", "business", "operational"]) {
        const g = G.createGoal({ title: `Test ${type} goal`, type });
        assert(`${type} goal gets milestones`, (g?.milestones?.length || 0) >= 3,
            `len: ${g?.milestones?.length}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Task generation — fields and structure
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: Task structure");
reset();
{
    const G   = ge();
    const g   = G.createGoal({ title: "Implement payment API", type: "development" });
    const all = g.milestones.flatMap(m => m.tasks);

    assert("all tasks have taskId",        all.every(t => !!t.taskId));
    assert("all tasks have milestoneId",   all.every(t => !!t.milestoneId));
    assert("all tasks have title",         all.every(t => typeof t.title === "string" && t.title.length > 0));
    assert("all tasks have detail",        all.every(t => typeof t.detail === "string"));
    assert("all tasks have type",          all.every(t => !!t.type));
    assert("all tasks have estimatedMins", all.every(t => typeof t.estimatedMins === "number" && t.estimatedMins > 0));
    assert("all tasks status = pending",   all.every(t => t.status === "pending"));
    assert("dependsOn is array",           all.every(t => Array.isArray(t.dependsOn)));
    assert("task types are valid",         all.every(t =>
        ["research","design","build","test","deploy","review","document","execute"].includes(t.type)));
    assert("development tasks include build type",
        all.some(t => t.type === "build" || t.type === "deploy"));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: Progress updates via advanceTask
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: Progress updates");
reset();
{
    const G  = ge();
    const g  = G.createGoal({ title: "Improve test coverage", type: "development" });
    const all = g.milestones.flatMap(m => m.tasks);
    assert("starts at 0%",         g.completionPct === 0);

    // Complete first task
    const t1 = all[0];
    const r1 = G.advanceTask(g.goalId, t1.taskId, { ok: true, detail: "Done" });
    assert("advanceTask ok",        r1.ok === true, r1.error || "");
    assert("completionPct > 0",    (r1.goal?.completionPct || 0) > 0,  `pct: ${r1.goal?.completionPct}`);

    // Fail a task
    const t2 = all[1];
    const r2 = G.advanceTask(g.goalId, t2.taskId, { ok: false, error: "Test failed" });
    assert("failed task recorded",  r2.ok === true);
    const failedTask = r2.goal?.milestones?.flatMap(m => m.tasks).find(t => t.taskId === t2.taskId);
    assert("task status = failed",  failedTask?.status === "failed");
    assert("error stored on task",  failedTask?.error === "Test failed");

    // Complete all tasks in first milestone
    const ms0 = g.milestones[0];
    for (const task of ms0.tasks) {
        if (task.taskId === t1.taskId || task.taskId === t2.taskId) continue;
        G.advanceTask(g.goalId, task.taskId, { ok: true, detail: "Done" });
    }
    // Re-advance the failed one as success
    G.advanceTask(g.goalId, t2.taskId, { ok: true, detail: "Retry succeeded" });

    const refreshed = G.getGoal(g.goalId);
    const ms0status = refreshed.milestones.find(m => m.milestoneId === ms0.milestoneId)?.status;
    assert("first milestone becomes completed when all tasks done",
        ms0status === "completed",  `ms0 status: ${ms0status}`);
    assert("healthScore updated",   typeof refreshed.healthScore === "number");

    // Error cases
    const badGoal = G.advanceTask("goal_nonexistent", t1.taskId, { ok: true });
    assert("unknown goalId → error",   !badGoal.ok);
    const badTask = G.advanceTask(g.goalId, "t_nonexistent", { ok: true });
    assert("unknown taskId → error",   !badTask.ok);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: Completion report
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: Completion report");
reset();
{
    const G  = ge();
    const g  = G.createGoal({ title: "Launch marketing campaign", type: "business" });
    const all = g.milestones.flatMap(m => m.tasks);

    // Complete some tasks
    for (const t of all.slice(0, 4)) {
        G.advanceTask(g.goalId, t.taskId, { ok: true, detail: "Done" });
    }

    const result = G.completeGoal(g.goalId, { note: "Campaign launched successfully" });
    assert("completeGoal ok",                  result.ok === true,        result.error || "");
    assert("goal.status = completed",          result.goal?.status === "completed");
    assert("goal.completedAt set",             !!result.goal?.completedAt);
    assert("report returned",                  !!result.report);
    assert("report.goalId matches",            result.report?.goalId === g.goalId);
    assert("report.totalTasks correct",        result.report?.totalTasks === all.length,
        `total: ${result.report?.totalTasks} vs ${all.length}`);
    assert("report.completedTasks = 4",        result.report?.completedTasks === 4);
    assert("report.finalNote preserved",       result.report?.finalNote === "Campaign launched successfully");
    assert("report.summary is string",         typeof result.report?.summary === "string" && result.report.summary.length > 10);
    assert("report.milestonesTotal correct",   result.report?.milestonesTotal === g.milestones.length);
    assert("report stored on goal",            !!G.getGoal(g.goalId)?.completionReport);

    // getCompletionReport convenience
    const fetched = G.getCompletionReport(g.goalId);
    assert("getCompletionReport returns report", fetched?.goalId === g.goalId);

    // Can't complete twice
    const dup = G.completeGoal(g.goalId);
    assert("double-complete returns error",     !dup.ok);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Health scoring dimensions
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: Health score dimensions");
reset();
{
    const G = ge();

    // Fresh goal with no tasks done — baseline score
    const fresh = G.createGoal({ title: "Fresh goal", type: "personal" });
    const h1    = G.getHealthScore(fresh.goalId);
    assert("getHealthScore returns object",     !!h1);
    assert("health.total is number",            typeof (h1?.total || fresh.healthScore) === "number");
    assert("health.total between 0 and 100",    (h1?.total ?? fresh.healthScore) >= 0 && (h1?.total ?? fresh.healthScore) <= 100);

    // After completing tasks, momentum should stay high (just created)
    const all = fresh.milestones.flatMap(m => m.tasks);
    for (const t of all.slice(0, 3)) {
        G.advanceTask(fresh.goalId, t.taskId, { ok: true, detail: "Done" });
    }
    const updated = G.getGoal(fresh.goalId);
    assert("healthScore > 0 after completions", (updated?.healthScore || 0) > 0);

    // Goal with failures should have lower focus score
    const flawed = G.createGoal({ title: "Flawed goal", type: "development" });
    const flawedAll = flawed.milestones.flatMap(m => m.tasks);
    for (const t of flawedAll) {
        G.advanceTask(flawed.goalId, t.taskId, { ok: false, error: "failed" });
    }
    const flawedUpdated = G.getGoal(flawed.goalId);
    // Goal with all failures should score lower than fresh goal
    assert("failed tasks lower health score",
        (flawedUpdated?.healthScore || 0) <= (updated?.healthScore || 100));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: Memory integration — getGoalSummary
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: Memory integration — getGoalSummary");
reset();
{
    const G = ge();
    G.createGoal({ title: "Goal A", type: "development" });
    G.createGoal({ title: "Goal B", type: "business" });
    G.createGoal({ title: "Goal C", type: "personal" });

    const s = G.getGoalSummary();
    assert("total = 3",               s.total === 3,        `total: ${s.total}`);
    assert("byType.development = 1",  s.byType.development === 1);
    assert("byType.business = 1",     s.byType.business === 1);
    assert("byType.personal = 1",     s.byType.personal === 1);
    assert("byStatus.active = 3",     s.byStatus.active === 3,   `active: ${s.byStatus.active}`);
    assert("activeCount = 3",         s.activeCount === 3);
    assert("avgHealth is number",     typeof s.avgHealth === "number");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 8: Type inference from keywords
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 8: Type inference");
reset();
{
    const G = ge();

    const cases = [
        ["Build and deploy the payment API feature", "development"],
        ["Grow revenue to 100k ARR this quarter",    "business"],
        ["Stabilize backend after incident outage",  "operational"],
        ["Learn piano for 30 minutes per day",       "personal"],
    ];

    for (const [title, expectedType] of cases) {
        const g = G.createGoal({ title });
        assert(`"${title.slice(0,30)}" → ${expectedType}`,
            g.type === expectedType,
            `got: ${g.type}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 9: Goal lifecycle — pause, resume, abandon
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 9: Goal lifecycle — pause, resume, abandon");
reset();
{
    const G = ge();

    // Pause / resume
    const g1 = G.createGoal({ title: "Pausable goal", type: "personal" });
    const p1  = G.pauseGoal(g1.goalId);
    assert("pause succeeds",         p1.ok === true,             p1.error || "");
    assert("status = paused",        p1.goal?.status === "paused");
    const p2 = G.pauseGoal(g1.goalId);
    assert("can't pause again",      !p2.ok);

    const r1 = G.resumeGoal(g1.goalId);
    assert("resume succeeds",        r1.ok === true);
    assert("status = active",        r1.goal?.status === "active");

    // Abandon
    const g2   = G.createGoal({ title: "Abandonment test", type: "business" });
    const abn  = G.abandonGoal(g2.goalId, "Changed priorities");
    assert("abandon succeeds",        abn.ok === true);
    assert("status = abandoned",      abn.goal?.status === "abandoned");
    assert("abandonReason stored",    abn.goal?.abandonReason === "Changed priorities");

    const abn2 = G.abandonGoal(g2.goalId);
    assert("can't complete abandoned goal", !G.completeGoal(g2.goalId).ok);

    // advance on inactive goal errors
    const at = G.advanceTask(g2.goalId, "t_x", { ok: true });
    assert("advanceTask on abandoned goal errors", !at.ok);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 10: listGoals filters
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 10: listGoals filters");
reset();
{
    const G = ge();

    const g1 = G.createGoal({ title: "Dev goal 1",    type: "development", blueprintId: "bp_test" });
    const g2 = G.createGoal({ title: "Dev goal 2",    type: "development" });
    const g3 = G.createGoal({ title: "Personal goal", type: "personal" });

    G.completeGoal(g1.goalId);

    const devGoals = G.listGoals({ type: "development" });
    assert("filter by type=development returns 2", devGoals.length === 2, `got: ${devGoals.length}`);

    const active = G.listGoals({ status: "active" });
    assert("filter by status=active returns 2",    active.length === 2, `got: ${active.length}`);

    const completed = G.listGoals({ status: "completed" });
    assert("filter by status=completed returns 1", completed.length === 1);

    const byBp = G.listGoals({ blueprintId: "bp_test" });
    assert("filter by blueprintId works",          byBp.length === 1 && byBp[0].goalId === g1.goalId);

    const missing = G.getGoal("goal_nonexistent");
    assert("getGoal null for missing",             missing === null);
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("GOAL ENGINE TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
else            { console.log("\nAll assertions passed."); process.exit(0); }
