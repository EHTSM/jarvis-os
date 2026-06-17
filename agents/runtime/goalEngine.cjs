"use strict";
/**
 * Goal Engine — creates, tracks, and completes structured goals.
 *
 * Entry points:
 *   createGoal(opts)              — define a new goal with auto-generated milestones
 *   getGoal(goalId)               — retrieve a goal by ID
 *   listGoals(opts)               — list goals with filters
 *   advanceTask(goalId, taskId, result) — record a task outcome, update progress
 *   completeGoal(goalId, opts)    — mark goal done, generate completion report
 *   abandonGoal(goalId, reason)   — mark goal abandoned
 *   getHealthScore(goalId)        — 0–100 goal health score
 *   getCompletionReport(goalId)   — full completion report
 *   executeGoalTask(goalId, taskId, opts) — run a task via projectRunner (async)
 *
 * Reuses (all fail-safe):
 *   unifiedMemoryEngine.index()         — register goal in cross-reference index
 *   unifiedMemoryEngine.getProjectMemory() — enrich dev goals with project context
 *   projectRunner.runProject()           — execute development task sequences
 *   blueprintGenerator.getBlueprint()    — attach blueprint context to dev goals
 *   pipelineOrchestrator.run()           — execute single-task pipeline runs
 *
 * Goal types:
 *   personal     — personal productivity, habits, learning
 *   business     — revenue, customers, marketing, growth
 *   development  — code, product, features, infrastructure
 *   operational  — health, deployments, incidents, reliability
 *
 * Milestone generation (rule-based, no AI):
 *   Each goal type has a standard milestone sequence.
 *   The goal description is parsed for keywords to refine the sequence.
 *   Dev goals: design → build → test → deploy → monitor
 *   Business goals: research → plan → execute → measure → optimize
 *   Operational goals: assess → fix → verify → document → prevent
 *   Personal goals: define → start → habit → review → complete
 *
 * Task decomposition:
 *   Each milestone gets 1–4 concrete tasks based on goal type and keywords.
 *   Tasks carry: taskId, milestoneId, title, detail, type (action type),
 *                status, estimatedMins, dependsOn[], projectRunId?
 *
 * Progress tracking:
 *   completedTasks / totalTasks → completionPct
 *   Milestone progress: all tasks in milestone complete → milestone complete
 *   Goal progress: all milestones complete → goal ready for completion
 *
 * Health scoring (0–100):
 *   velocity:     tasks completed per day vs expected rate          (30 pts)
 *   momentum:     time since last task update (freshness)           (25 pts)
 *   focus:        tasks blocked or failed as % of total             (25 pts)
 *   alignment:    milestone sequence integrity (no skips)           (20 pts)
 *
 * Goal shape (stored):
 *   {
 *     goalId, type, title, description, blueprintId?,
 *     status: "active"|"paused"|"completed"|"abandoned",
 *     createdAt, updatedAt, targetDate?,
 *     completedAt?, abandonedAt?,
 *     milestones: [{
 *       milestoneId, title, description, seq,
 *       status: "pending"|"active"|"completed",
 *       tasks: [{
 *         taskId, milestoneId, title, detail,
 *         type: "research"|"design"|"build"|"test"|"deploy"|"review"|"document"|"execute",
 *         status: "pending"|"running"|"completed"|"failed"|"skipped",
 *         estimatedMins,
 *         dependsOn: taskId[],
 *         startedAt?, completedAt?, result?, error?,
 *         projectRunId?,
 *       }],
 *     }],
 *     completionPct,      — 0–100
 *     healthScore,        — 0–100 (recomputed on every advance)
 *     completionReport?,  — populated on completeGoal()
 *   }
 *
 * Storage: data/goals.json  (max 200, newest-first, atomic write)
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR   = path.join(__dirname, "../../data");
const GOALS_PATH = path.join(DATA_DIR, "goals.json");
const MAX_GOALS  = 200;

// ── Lazy accessors ────────────────────────────────────────────────
function _ume()  { try { return require("./unifiedMemoryEngine.cjs");        } catch { return null; } }
function _pr()   { try { return require("../dev/projectRunner.cjs");         } catch { return null; } }
function _bg()   { try { return require("../dev/blueprintGenerator.cjs");    } catch { return null; } }
function _po()   { try { return require("../dev/pipelineOrchestrator.cjs");  } catch { return null; } }

// ── Storage ───────────────────────────────────────────────────────
function _loadGoals() {
    try {
        const raw = fs.readFileSync(GOALS_PATH, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : [];
    } catch { return []; }
}

function _saveGoals(goals) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = GOALS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(goals.slice(0, MAX_GOALS), null, 2));
    fs.renameSync(tmp, GOALS_PATH);
}

function _persistGoal(goal) {
    const all = _loadGoals();
    const idx = all.findIndex(g => g.goalId === goal.goalId);
    if (idx !== -1) all[idx] = goal;
    else all.unshift(goal);
    _saveGoals(all);
}

let _idCtr = Date.now();
function _id(prefix = "g") { return `${prefix}_${++_idCtr}`; }

// ═══════════════════════════════════════════════════════════════════
// MILESTONE TEMPLATES
// Each template is { title, description, taskTemplates[] }
// taskTemplates: { title, detail, type, estimatedMins }
// ═══════════════════════════════════════════════════════════════════

const MILESTONE_TEMPLATES = {
    development: [
        {
            title: "Design",
            description: "Define requirements, architecture, and approach",
            seq: 1,
            taskTemplates: [
                { title: "Define requirements", detail: "List the acceptance criteria and scope", type: "research",  estimatedMins: 30 },
                { title: "Design architecture", detail: "Sketch the technical approach and data model", type: "design", estimatedMins: 45 },
            ],
        },
        {
            title: "Build",
            description: "Implement the planned solution",
            seq: 2,
            taskTemplates: [
                { title: "Implement core logic",  detail: "Write the main implementation",           type: "build",  estimatedMins: 120 },
                { title: "Write unit tests",       detail: "Cover core paths with tests",             type: "test",   estimatedMins: 60  },
            ],
        },
        {
            title: "Verify",
            description: "Test, review, and validate",
            seq: 3,
            taskTemplates: [
                { title: "Run test suite",         detail: "Execute all tests and fix failures",      type: "test",   estimatedMins: 30 },
                { title: "Code review",            detail: "Review for correctness and style",        type: "review", estimatedMins: 30 },
            ],
        },
        {
            title: "Deploy",
            description: "Release to production",
            seq: 4,
            taskTemplates: [
                { title: "Deploy to production",   detail: "Run the deployment pipeline",             type: "deploy", estimatedMins: 20 },
                { title: "Smoke test",             detail: "Verify the live endpoint is healthy",     type: "test",   estimatedMins: 10 },
            ],
        },
        {
            title: "Monitor",
            description: "Observe and confirm stability",
            seq: 5,
            taskTemplates: [
                { title: "Monitor health",         detail: "Check telemetry and incident feed",       type: "execute", estimatedMins: 15 },
                { title: "Document outcome",       detail: "Record what was done and learned",        type: "document", estimatedMins: 20 },
            ],
        },
    ],

    business: [
        {
            title: "Research",
            description: "Understand the problem space and opportunity",
            seq: 1,
            taskTemplates: [
                { title: "Market research",        detail: "Identify target audience and competition", type: "research",  estimatedMins: 60 },
                { title: "Define success metrics", detail: "Set measurable KPIs for the goal",        type: "design",    estimatedMins: 30 },
            ],
        },
        {
            title: "Plan",
            description: "Create a concrete action plan",
            seq: 2,
            taskTemplates: [
                { title: "Draft action plan",      detail: "List specific actions and owners",        type: "design",    estimatedMins: 45 },
                { title: "Set milestones",         detail: "Define check-in points with dates",       type: "design",    estimatedMins: 20 },
            ],
        },
        {
            title: "Execute",
            description: "Carry out the planned actions",
            seq: 3,
            taskTemplates: [
                { title: "Execute primary action", detail: "Run the first high-impact action",        type: "execute",   estimatedMins: 90 },
                { title: "Track progress",         detail: "Log results against the plan",            type: "execute",   estimatedMins: 20 },
            ],
        },
        {
            title: "Measure",
            description: "Evaluate results against KPIs",
            seq: 4,
            taskTemplates: [
                { title: "Collect metrics",        detail: "Gather data on the defined KPIs",         type: "research",  estimatedMins: 30 },
                { title: "Analyze results",        detail: "Compare actuals to targets",              type: "review",    estimatedMins: 30 },
            ],
        },
        {
            title: "Optimize",
            description: "Improve based on results",
            seq: 5,
            taskTemplates: [
                { title: "Identify improvements",  detail: "Find top 3 areas to optimize",           type: "research",  estimatedMins: 30 },
                { title: "Document learnings",     detail: "Record what worked and what didn't",      type: "document",  estimatedMins: 20 },
            ],
        },
    ],

    operational: [
        {
            title: "Assess",
            description: "Understand the current operational state",
            seq: 1,
            taskTemplates: [
                { title: "Health check",           detail: "Run full system health evaluation",       type: "research",  estimatedMins: 15 },
                { title: "Identify root cause",    detail: "Determine what needs to be fixed",        type: "research",  estimatedMins: 30 },
            ],
        },
        {
            title: "Fix",
            description: "Resolve the identified issues",
            seq: 2,
            taskTemplates: [
                { title: "Apply fix",              detail: "Execute the fix plan",                    type: "execute",   estimatedMins: 45 },
                { title: "Verify fix applied",     detail: "Confirm the fix took effect",             type: "test",      estimatedMins: 10 },
            ],
        },
        {
            title: "Verify",
            description: "Confirm the system is stable",
            seq: 3,
            taskTemplates: [
                { title: "Run smoke tests",        detail: "Verify all critical paths are healthy",   type: "test",      estimatedMins: 20 },
                { title: "Check incident feed",    detail: "Confirm no new incidents opened",         type: "execute",   estimatedMins: 10 },
            ],
        },
        {
            title: "Document",
            description: "Record what happened and how it was resolved",
            seq: 4,
            taskTemplates: [
                { title: "Write incident report",  detail: "Summarize cause, fix, and timeline",     type: "document",  estimatedMins: 20 },
                { title: "Update runbook",         detail: "Add prevention steps to runbook",        type: "document",  estimatedMins: 15 },
            ],
        },
        {
            title: "Prevent",
            description: "Add safeguards to prevent recurrence",
            seq: 5,
            taskTemplates: [
                { title: "Add monitoring rule",    detail: "Create detection rule for this pattern", type: "build",     estimatedMins: 30 },
                { title: "Schedule review",        detail: "Book a post-mortem review session",      type: "execute",   estimatedMins: 15 },
            ],
        },
    ],

    personal: [
        {
            title: "Define",
            description: "Clarify what success looks like",
            seq: 1,
            taskTemplates: [
                { title: "Write goal statement",   detail: "State the goal in specific, measurable terms", type: "design",  estimatedMins: 20 },
                { title: "Identify blockers",      detail: "List what could prevent success",         type: "research",  estimatedMins: 15 },
            ],
        },
        {
            title: "Start",
            description: "Take the first concrete steps",
            seq: 2,
            taskTemplates: [
                { title: "First action",           detail: "Do the smallest useful first thing",      type: "execute",   estimatedMins: 30 },
                { title: "Set schedule",           detail: "Block recurring time for this goal",      type: "design",    estimatedMins: 10 },
            ],
        },
        {
            title: "Build habit",
            description: "Establish a consistent routine",
            seq: 3,
            taskTemplates: [
                { title: "Complete a session",     detail: "Work on the goal for a full session",     type: "execute",   estimatedMins: 60 },
                { title: "Track consistency",      detail: "Log three consecutive progress updates",  type: "execute",   estimatedMins: 5  },
            ],
        },
        {
            title: "Review",
            description: "Assess progress and adjust",
            seq: 4,
            taskTemplates: [
                { title: "Progress review",        detail: "Rate progress 1-10 and note gaps",        type: "review",    estimatedMins: 20 },
                { title: "Adjust approach",        detail: "Update plan based on what you learned",   type: "design",    estimatedMins: 15 },
            ],
        },
        {
            title: "Complete",
            description: "Finish and reflect",
            seq: 5,
            taskTemplates: [
                { title: "Final push",             detail: "Complete any remaining work",             type: "execute",   estimatedMins: 60 },
                { title: "Reflection",             detail: "Record what you achieved and learned",    type: "document",  estimatedMins: 15 },
            ],
        },
    ],
};

// ── Keyword refinement ────────────────────────────────────────────
// For development goals: if keywords suggest a shorter path, trim milestones
function _refineForKeywords(templates, description, type) {
    const d = (description || "").toLowerCase();

    // Trim to 3 milestones for small/quick goals
    if (/\bquick\b|\bsimple\b|\bsmall\b|\bfix\b|\bhot.?fix\b/.test(d)) {
        return templates.slice(0, 3);
    }

    // If already deployed / monitoring focus: start later
    if (type === "operational" && /\bmonitor\b|\bwatch\b|\bobserve\b/.test(d)) {
        return templates.filter(t => ["Verify", "Document", "Prevent"].includes(t.title));
    }

    // If research/planning focus: stop before execution
    if (/\bresearch\b|\banalyze\b|\bauditing\b/.test(d)) {
        return templates.filter(t => t.seq <= 2);
    }

    return templates;
}

// ── Milestone + task generation ───────────────────────────────────

function _generateMilestones(type, description) {
    const templates = MILESTONE_TEMPLATES[type] || MILESTONE_TEMPLATES.personal;
    const refined   = _refineForKeywords(templates, description, type);

    return refined.map(tpl => {
        const milestoneId = _id("ms");
        const tasks = tpl.taskTemplates.map((tt, i) => ({
            taskId:       _id("t"),
            milestoneId,
            title:        tt.title,
            detail:       tt.detail,
            type:         tt.type,
            status:       "pending",
            estimatedMins: tt.estimatedMins,
            dependsOn:    i > 0 ? [] : [],  // within-milestone deps could be wired here
            startedAt:    null,
            completedAt:  null,
            result:       null,
            error:        null,
            projectRunId: null,
        }));

        return {
            milestoneId,
            title:       tpl.title,
            description: tpl.description,
            seq:         tpl.seq,
            status:      "pending",
            tasks,
        };
    });
}

// ── Progress computation ──────────────────────────────────────────

function _recomputeProgress(goal) {
    const allTasks = goal.milestones.flatMap(m => m.tasks);
    const total    = allTasks.length;
    const done     = allTasks.filter(t => t.status === "completed").length;
    const failed   = allTasks.filter(t => t.status === "failed").length;

    goal.completionPct = total > 0 ? Math.round((done / total) * 100) : 0;

    // Update milestone statuses
    for (const ms of goal.milestones) {
        const msTasks = ms.tasks;
        const msTotal = msTasks.length;
        const msDone  = msTasks.filter(t => t.status === "completed").length;
        const msAny   = msTasks.some(t => t.status === "running" || t.status === "completed");

        if (msDone === msTotal && msTotal > 0) ms.status = "completed";
        else if (msAny)                         ms.status = "active";
        else                                    ms.status = "pending";
    }

    goal.updatedAt = new Date().toISOString();
    return { total, done, failed };
}

// ── Health scoring ────────────────────────────────────────────────

function _computeHealth(goal) {
    const now      = Date.now();
    const created  = new Date(goal.createdAt).getTime();
    const ageMs    = now - created;
    const ageDays  = ageMs / 86_400_000;

    const allTasks  = goal.milestones.flatMap(m => m.tasks);
    const total     = allTasks.length;
    const done      = allTasks.filter(t => t.status === "completed").length;
    const failed    = allTasks.filter(t => t.status === "failed").length;
    const blocked   = allTasks.filter(t => t.status === "failed" || t.status === "skipped").length;

    // velocity (30 pts): tasks/day vs expected 2 tasks/day
    const actualRate   = ageDays > 0 ? done / ageDays : done;
    const expectedRate = 2;
    const velocityPts  = Math.min(Math.round((actualRate / expectedRate) * 30), 30);

    // momentum (25 pts): penalise if no task update in > 3 days
    const lastUpdated = new Date(goal.updatedAt || goal.createdAt).getTime();
    const staleDays   = (now - lastUpdated) / 86_400_000;
    const momentumPts = staleDays < 1 ? 25 : staleDays < 3 ? 20 : staleDays < 7 ? 10 : 0;

    // focus (25 pts): failed+blocked as % of total → penalty
    const blockRate  = total > 0 ? blocked / total : 0;
    const focusPts   = Math.round((1 - blockRate) * 25);

    // alignment (20 pts): milestones done in order (no skipped)
    let alignPts  = 20;
    let prevDone  = true;
    for (const ms of goal.milestones) {
        if (ms.status === "active" && !prevDone) { alignPts -= 10; break; }
        if (ms.status === "completed") prevDone = true;
        else prevDone = false;
    }

    const total_score = Math.min(velocityPts + momentumPts + focusPts + alignPts, 100);
    return {
        total: total_score,
        dimensions: { velocity: velocityPts, momentum: momentumPts, focus: focusPts, alignment: alignPts },
    };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new goal with auto-generated milestones and tasks.
 *
 * @param {object} opts
 * @param {string}  opts.title          — goal title
 * @param {string}  [opts.description]  — detail description
 * @param {string}  [opts.type]         — "personal"|"business"|"development"|"operational"
 * @param {string}  [opts.targetDate]   — ISO date string (optional deadline)
 * @param {string}  [opts.blueprintId]  — link to a product blueprint (dev goals)
 * @param {string[]} [opts.tags]
 * @returns {Goal}
 */
function createGoal({ title, description = "", type, targetDate, blueprintId, tags = [] } = {}) {
    if (!title) return { ok: false, error: "title is required" };

    // Infer type from title+description if not provided
    const inferredType = type || _inferType(title + " " + description);
    const milestones   = _generateMilestones(inferredType, description);

    // Enrich dev goals with blueprint context if available
    let projectContext = null;
    if (blueprintId) {
        const ume = _ume();
        if (ume) projectContext = ume.getProjectMemory(blueprintId);
    }

    const now  = new Date().toISOString();
    const goal = {
        goalId:         _id("goal"),
        type:           inferredType,
        title:          title.slice(0, 200),
        description:    description.slice(0, 1000),
        blueprintId:    blueprintId || null,
        tags,
        status:         "active",
        createdAt:      now,
        updatedAt:      now,
        targetDate:     targetDate || null,
        completedAt:    null,
        abandonedAt:    null,
        milestones,
        completionPct:  0,
        healthScore:    _computeHealth({ milestones, createdAt: now, updatedAt: now }).total,
        projectContext: projectContext ? {
            productName:  projectContext.productName,
            featureCount: projectContext.features?.length || 0,
            apiCount:     projectContext.apis?.length || 0,
        } : null,
        completionReport: null,
    };

    _persistGoal(goal);

    // Register in unified memory index
    setImmediate(() => {
        try { _ume()?.index({ force: true }); } catch { /* non-fatal */ }
    });

    const totalTasks = milestones.flatMap(m => m.tasks).length;
    logger.info(`[GoalEngine] created ${goal.goalId} type=${inferredType} milestones=${milestones.length} tasks=${totalTasks}`);
    return goal;
}

function _inferType(text) {
    const t = text.toLowerCase();
    if (/\bbuild\b|\bfeature\b|\bcode\b|\bapi\b|\bdeploy\b|\bimplement\b|\brefactor\b|\btest\b|\bbug\b|\bfix\b/.test(t)) return "development";
    if (/\brevenue\b|\bcustomer\b|\bsales\b|\bmarket\b|\bgrowth\b|\blaunch\b|\bprice\b/.test(t)) return "business";
    if (/\bhealth\b|\bincident\b|\bperformance\b|\bmonitor\b|\buptime\b|\bstabiliz/.test(t)) return "operational";
    return "personal";
}

/**
 * Record a task outcome and recompute progress + health.
 *
 * @param {string} goalId
 * @param {string} taskId
 * @param {object} result  — { ok, detail, error?, projectRunId? }
 * @returns {{ ok, goal }}
 */
function advanceTask(goalId, taskId, result = {}) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };
    if (goal.status !== "active") return { ok: false, error: `goal is ${goal.status}` };

    let found = false;
    for (const ms of goal.milestones) {
        const task = ms.tasks.find(t => t.taskId === taskId);
        if (!task) continue;
        found = true;
        task.status      = result.ok !== false ? "completed" : "failed";
        task.completedAt = new Date().toISOString();
        task.result      = result.detail || null;
        task.error       = result.error  || null;
        if (result.projectRunId) task.projectRunId = result.projectRunId;
        if (!task.startedAt) task.startedAt = task.completedAt;
        break;
    }

    if (!found) return { ok: false, error: "task_not_found" };

    _recomputeProgress(goal);
    goal.healthScore = _computeHealth(goal).total;

    _saveGoals(all);

    logger.info(`[GoalEngine] ${goalId} advance task=${taskId} status=${result.ok !== false ? "completed" : "failed"} pct=${goal.completionPct}%`);
    return { ok: true, goal };
}

/**
 * Mark a task as started.
 */
function startTask(goalId, taskId) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };

    for (const ms of goal.milestones) {
        const task = ms.tasks.find(t => t.taskId === taskId);
        if (!task) continue;
        task.status    = "running";
        task.startedAt = new Date().toISOString();
        goal.updatedAt = new Date().toISOString();
        _saveGoals(all);
        return { ok: true, goal };
    }
    return { ok: false, error: "task_not_found" };
}

/**
 * Execute a goal task via projectRunner (for development goals).
 * Non-blocking — fires execution and records the projectRunId.
 *
 * @param {string} goalId
 * @param {string} taskId
 * @param {object} [opts]
 * @param {boolean} [opts.await=false]   — if true, wait for runProject to settle
 */
async function executeGoalTask(goalId, taskId, { await: awaitRun = false } = {}) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };

    let task = null;
    for (const ms of goal.milestones) {
        task = ms.tasks.find(t => t.taskId === taskId);
        if (task) break;
    }
    if (!task) return { ok: false, error: "task_not_found" };

    const pr = _pr();
    if (!pr) return { ok: false, error: "projectRunner unavailable" };

    // Mark as running
    startTask(goalId, taskId);

    const runFn = async () => {
        try {
            const run = await pr.runProject(
                `[Goal: ${goal.title}] ${task.title}: ${task.detail}`,
                { projectName: `${goal.goalId}/${task.taskId}`, skipDeploy: true }
            );
            advanceTask(goalId, taskId, {
                ok:           run.ok,
                detail:       run.summary,
                projectRunId: run.projectId,
            });
            return run;
        } catch (e) {
            advanceTask(goalId, taskId, { ok: false, error: e.message });
            return { ok: false, error: e.message };
        }
    };

    if (awaitRun) return runFn();
    setImmediate(runFn);
    return { ok: true, queued: true, taskId, goalId };
}

/**
 * Generate and persist a completion report, then mark the goal done.
 *
 * @param {string} goalId
 * @param {object} [opts]
 * @param {string}  [opts.note]
 * @returns {{ ok, goal }}
 */
function completeGoal(goalId, { note = "" } = {}) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };
    if (goal.status === "completed") return { ok: false, error: "already completed" };
    if (goal.status === "abandoned") return { ok: false, error: "cannot complete — goal is abandoned" };

    const now       = new Date().toISOString();
    const allTasks  = goal.milestones.flatMap(m => m.tasks);
    const total     = allTasks.length;
    const done      = allTasks.filter(t => t.status === "completed").length;
    const failed    = allTasks.filter(t => t.status === "failed").length;
    const skipped   = allTasks.filter(t => t.status === "skipped").length;
    const pending   = allTasks.filter(t => t.status === "pending").length;

    const durationMs  = now ? Date.now() - new Date(goal.createdAt).getTime() : null;
    const durationDays = durationMs ? Math.round(durationMs / 86_400_000 * 10) / 10 : null;

    const completedMs = goal.milestones.filter(m => m.status === "completed").length;
    const health      = _computeHealth(goal);

    const report = {
        goalId,
        type:         goal.type,
        title:        goal.title,
        completedAt:  now,
        durationDays,
        totalTasks:   total,
        completedTasks: done,
        failedTasks:  failed,
        skippedTasks: skipped,
        pendingTasks: pending,
        completionPct: total > 0 ? Math.round(done / total * 100) : 100,
        milestonesCompleted: completedMs,
        milestonesTotal:     goal.milestones.length,
        healthScore:  health.total,
        finalNote:    note,
        summary:      _buildCompletionSummary(goal, done, total, durationDays),
        projectRunIds: allTasks.map(t => t.projectRunId).filter(Boolean),
    };

    goal.status          = "completed";
    goal.completedAt     = now;
    goal.updatedAt       = now;
    goal.completionPct   = report.completionPct;
    goal.healthScore     = health.total;
    goal.completionReport = report;

    _saveGoals(all);

    // Update unified memory index
    setImmediate(() => { try { _ume()?.index({ force: true }); } catch { /* non-fatal */ } });

    logger.info(`[GoalEngine] ${goalId} completed — ${done}/${total} tasks in ${durationDays}d`);
    return { ok: true, goal, report };
}

function _buildCompletionSummary(goal, done, total, durationDays) {
    const pct = total > 0 ? Math.round(done / total * 100) : 100;
    const dur = durationDays != null ? ` in ${durationDays}d` : "";
    return `Goal "${goal.title}" completed${dur}: ${done}/${total} tasks (${pct}%) across ${goal.milestones.length} milestones.`;
}

/**
 * Abandon a goal.
 */
function abandonGoal(goalId, reason = "") {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };
    if (goal.status === "completed") return { ok: false, error: "already completed" };

    goal.status      = "abandoned";
    goal.abandonedAt = new Date().toISOString();
    goal.updatedAt   = new Date().toISOString();
    goal.abandonReason = reason;

    _saveGoals(all);
    logger.info(`[GoalEngine] ${goalId} abandoned: ${reason}`);
    return { ok: true, goal };
}

/**
 * Pause / resume a goal.
 */
function pauseGoal(goalId) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };
    if (goal.status !== "active") return { ok: false, error: `goal is ${goal.status}` };
    goal.status    = "paused";
    goal.updatedAt = new Date().toISOString();
    _saveGoals(all);
    return { ok: true, goal };
}

function resumeGoal(goalId) {
    const all  = _loadGoals();
    const goal = all.find(g => g.goalId === goalId);
    if (!goal) return { ok: false, error: "goal_not_found" };
    if (goal.status !== "paused") return { ok: false, error: `goal is ${goal.status}` };
    goal.status    = "active";
    goal.updatedAt = new Date().toISOString();
    _saveGoals(all);
    return { ok: true, goal };
}

// ── Reader API ────────────────────────────────────────────────────

function getGoal(goalId) {
    return _loadGoals().find(g => g.goalId === goalId) || null;
}

function listGoals({ type, status, blueprintId, limit = 20, tags } = {}) {
    let goals = _loadGoals();
    if (type)        goals = goals.filter(g => g.type === type);
    if (status)      goals = goals.filter(g => g.status === status);
    if (blueprintId) goals = goals.filter(g => g.blueprintId === blueprintId);
    if (tags?.length) goals = goals.filter(g => tags.some(t => g.tags?.includes(t)));
    return goals.slice(0, limit);
}

function getHealthScore(goalId) {
    const goal = getGoal(goalId);
    if (!goal) return null;
    return { goalId, ...goal.healthScore ? { total: goal.healthScore } : _computeHealth(goal) };
}

function getCompletionReport(goalId) {
    const goal = getGoal(goalId);
    return goal?.completionReport || null;
}

/**
 * Summary across all goals.
 */
function getGoalSummary() {
    const goals = _loadGoals();
    const byType   = {};
    const byStatus = {};
    for (const g of goals) {
        byType[g.type]     = (byType[g.type]     || 0) + 1;
        byStatus[g.status] = (byStatus[g.status] || 0) + 1;
    }
    const active = goals.filter(g => g.status === "active");
    const avgHealth = active.length
        ? Math.round(active.reduce((s, g) => s + (g.healthScore || 0), 0) / active.length)
        : null;

    return {
        total:       goals.length,
        byType,
        byStatus,
        activeCount: active.length,
        avgHealth,
    };
}

module.exports = {
    createGoal,
    getGoal,
    listGoals,
    advanceTask,
    startTask,
    executeGoalTask,
    completeGoal,
    abandonGoal,
    pauseGoal,
    resumeGoal,
    getHealthScore,
    getCompletionReport,
    getGoalSummary,
};
