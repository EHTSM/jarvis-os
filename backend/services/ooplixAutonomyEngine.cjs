"use strict";
/**
 * OoplixAutonomyEngine — autonomously create and dispatch content, SEO,
 * support and marketing tasks, then track their influence on revenue,
 * traffic and support metrics.
 *
 * Integrates with:
 *   autonomousTaskLoop.cjs     — dispatches cycles per task type
 *   agentExecutionEngine.cjs   — direct agent dispatch
 *   memoryPersistenceLayer.cjs — stores completed work + influence data
 *   continuousLearningEngine.cjs — records outcomes as lessons
 *
 * Task types:
 *   content    — blog posts, newsletters, landing pages, social copy
 *   seo        — keyword gaps, meta tags, rank monitoring, link opportunities
 *   support    — ticket triage, FAQ updates, escalation review, KB articles
 *   marketing  — campaign creation, A/B copy, email sequences, ad copy
 *
 * Influence tracking:
 *   revenue    — estimated revenue impact (proxy: lead conversions from content)
 *   traffic    — page views influenced (proxy: SEO tasks completed × avg lift)
 *   support    — tickets deflected (proxy: support tasks × deflection rate)
 *
 * Persists to:
 *   data/ooplix-autonomy.json    — task queue + completed work
 *   data/ooplix-influence.json   — influence metrics over time
 *
 * Public API:
 *   createTask(type, spec)              → OoplixTask
 *   dispatchPending(opts)               → { dispatched[], errors[] }
 *   scheduleRecurring(type, cronSpec)   → { scheduleId }
 *   getTask(taskId)                     → OoplixTask | null
 *   listTasks(opts)                     → { tasks[], stats }
 *   recordInfluence(taskId, influence)  → InfluenceRecord
 *   getInfluenceReport(opts)            → { report }
 *   runAutonomousCycle()                → { created, dispatched }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const TASKS_FILE     = path.join(__dirname, "../../data/ooplix-autonomy.json");
const INFLUENCE_FILE = path.join(__dirname, "../../data/ooplix-influence.json");
const SCHEDULES_FILE = path.join(__dirname, "../../data/ooplix-schedules.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _tasks      = _rj(TASKS_FILE,     []);
let _influence  = _rj(INFLUENCE_FILE, []);
let _schedules  = _rj(SCHEDULES_FILE, []);
let _seq        = _tasks.length;
function _tid() { return `oat_${Date.now()}_${(++_seq).toString(36)}`; }
function _sid() { return `osc_${Date.now()}_${(++_seq).toString(36)}`; }

function _saveTasks()     { try { _wj(TASKS_FILE,     _tasks.slice(-2000));    } catch { /* non-fatal */ } }
function _saveInfluence() { try { _wj(INFLUENCE_FILE, _influence.slice(-5000)); } catch { /* non-fatal */ } }
function _saveSchedules() { try { _wj(SCHEDULES_FILE, _schedules);             } catch { /* non-fatal */ } }

// ── Task templates by type ────────────────────────────────────────────────
const TASK_SPECS = {
    content: [
        { title: "Write weekly blog post",        goal: "Write a 1200-word SEO-optimised blog post about our core product benefits. Include 3 internal links and a CTA.",  agent: "content",   priority: 2 },
        { title: "Draft email newsletter",         goal: "Draft this week's email newsletter: product updates, customer win story, and one actionable tip for subscribers.", agent: "content",   priority: 2 },
        { title: "Create landing page copy",       goal: "Write conversion-optimised copy for the main landing page hero section, features section and FAQ.",                agent: "content",   priority: 1 },
        { title: "Generate social media pack",     goal: "Create 5 social media posts for LinkedIn and Twitter about our latest feature release.",                           agent: "marketing", priority: 3 },
    ],
    seo: [
        { title: "Run keyword gap analysis",       goal: "Identify top 20 keywords our competitors rank for that we do not. Prioritise by search volume and intent.",       agent: "seo",       priority: 1 },
        { title: "Generate meta tags for top pages",goal: "Write optimised title tags and meta descriptions for our top 10 landing pages. Max 60/160 chars.",                agent: "seo",       priority: 2 },
        { title: "Identify backlink opportunities",goal: "Find 15 high-authority domains in our niche that accept guest posts or resource links.",                           agent: "seo",       priority: 2 },
        { title: "Audit internal link structure",  goal: "Analyse internal linking on the blog. Identify orphaned pages and suggest link additions.",                        agent: "seo",       priority: 3 },
    ],
    support: [
        { title: "Triage open support tickets",    goal: "Review all open support tickets, categorise by severity and type, flag any >24h unresolved for escalation.",      agent: "support",   priority: 1 },
        { title: "Update FAQ knowledge base",      goal: "Review last 50 support tickets. Identify top 5 recurring questions. Write FAQ answers for each.",                  agent: "support",   priority: 2 },
        { title: "Draft escalation responses",     goal: "Write templated responses for the 3 most common escalation scenarios in the support queue.",                       agent: "support",   priority: 2 },
        { title: "Analyse support trends",         goal: "Identify the top 3 support issue categories from the last 30 days and suggest product/doc improvements.",         agent: "analytics", priority: 3 },
    ],
    marketing: [
        { title: "Create email drip sequence",     goal: "Write a 5-email onboarding drip sequence for new trial users. Focus on activation milestones.",                   agent: "marketing", priority: 1 },
        { title: "Generate A/B test copy variants",goal: "Create 3 subject line variants and 2 CTA variants for the current lead nurture campaign.",                        agent: "marketing", priority: 2 },
        { title: "Draft ad copy for top channel",  goal: "Write 5 Google/Meta ad headline + description variants targeting our ICP. Include value proposition and CTA.",    agent: "marketing", priority: 2 },
        { title: "Build referral campaign brief",  goal: "Create a brief for a referral programme: incentive structure, messaging, email templates, and tracking plan.",     agent: "marketing", priority: 3 },
    ],
};

// ── Influence proxy coefficients ─────────────────────────────────────────
// Used to estimate influence when real analytics are not wired
const INFLUENCE_COEFFS = {
    content: {
        revenue:  12,   // $12 estimated revenue influence per content piece (lead → conversion proxy)
        traffic:  340,  // 340 page views per published content piece
        support:  0,
    },
    seo: {
        revenue:  8,
        traffic:  520,  // SEO tasks generate more traffic lift
        support:  0,
    },
    support: {
        revenue:  5,    // deflecting a ticket saves ~$5 support cost
        traffic:  0,
        support:  4,    // 4 tickets deflected per support task
    },
    marketing: {
        revenue:  25,   // marketing tasks closest to revenue
        traffic:  180,
        support:  0,
    },
};

// ── OoplixTask schema ─────────────────────────────────────────────────────
function _taskDefaults(type, spec) {
    const now = new Date().toISOString();
    return {
        taskId:      spec.taskId    || _tid(),
        type,
        title:       spec.title     || `${type} task`,
        goal:        (spec.goal     || spec.title || "").slice(0, 500),
        agent:       spec.agent     || _agentFor(type),
        priority:    spec.priority  || 2,
        status:      "pending",
        createdAt:   now,
        dispatchedAt:null,
        completedAt: null,
        cycleId:     null,
        runId:       null,
        output:      null,
        error:       null,
        influenceId: null,
        source:      spec.source    || "auto",
        metadata:    spec.metadata  || {},
    };
}

function _agentFor(type) {
    return { content: "content", seo: "seo", support: "support", marketing: "marketing" }[type] || "runtime";
}

// ── Public API ────────────────────────────────────────────────────────────

/** Create a single task (manual or auto-generated). */
function createTask(type, spec = {}) {
    if (!["content","seo","support","marketing"].includes(type)) {
        throw new Error(`Invalid type: ${type}. Must be content|seo|support|marketing`);
    }
    const task = _taskDefaults(type, spec);
    _tasks.push(task);
    _saveTasks();
    auditLog.append({ type: "ooplix_task_create", taskId: task.taskId, taskType: type, title: task.title });
    logger.info(`[OoplixAuto] Created task ${task.taskId}: ${task.title}`);
    return { ...task };
}

/** Dispatch all pending tasks (up to limit) via autonomousTaskLoop. */
async function dispatchPending({ limit = 10, type } = {}) {
    let pending = _tasks.filter(t => t.status === "pending");
    if (type) pending = pending.filter(t => t.type === type);
    pending.sort((a, b) => a.priority - b.priority);    // lower number = higher priority
    pending = pending.slice(0, limit);

    const dispatched = [];
    const errors     = [];

    // Lazy-load ATL and AEE
    let atl = null, aee = null;
    try { atl = require("./autonomousTaskLoop.cjs"); } catch { /* optional */ }
    try { aee = require("./agentExecutionEngine.cjs"); } catch { /* optional */ }

    for (const task of pending) {
        const idx = _tasks.findIndex(t => t.taskId === task.taskId);
        try {
            let cycleId = null, runId = null;

            if (atl) {
                // Preferred: run full Goal→Task→Memory cycle
                const cycle = atl.startCycle(task.goal, { goalType: task.type, source: "ooplix_auto" });
                cycleId = cycle.cycleId;
            } else if (aee) {
                // Fallback: direct agent dispatch
                const result = await aee.executeTask(task.agent, task.goal, { type: `ooplix_${task.type}` });
                runId = result.runId;
                if (result.success) {
                    _tasks[idx].output = (result.output || "").slice(0, 500);
                } else {
                    _tasks[idx].error  = result.error;
                }
            }

            _tasks[idx].status       = "dispatched";
            _tasks[idx].dispatchedAt = new Date().toISOString();
            _tasks[idx].cycleId      = cycleId;
            _tasks[idx].runId        = runId;

            dispatched.push({ taskId: task.taskId, cycleId, runId });
            auditLog.append({ type: "ooplix_task_dispatch", taskId: task.taskId, cycleId, runId });
        } catch (e) {
            _tasks[idx].status = "failed";
            _tasks[idx].error  = e.message;
            errors.push({ taskId: task.taskId, error: e.message });
            logger.warn(`[OoplixAuto] Dispatch failed for ${task.taskId}: ${e.message}`);
        }
    }

    _saveTasks();
    logger.info(`[OoplixAuto] Dispatched ${dispatched.length}/${pending.length} tasks`);
    return { dispatched, errors, total: pending.length };
}

/** Schedule recurring autonomous task generation for a type. */
function scheduleRecurring(type, cronSpec) {
    const scheduleId = _sid();
    const schedule = { scheduleId, type, cronSpec, active: true, createdAt: new Date().toISOString(), lastRunAt: null, runCount: 0 };
    _schedules.push(schedule);
    _saveSchedules();

    // Register with node-cron if available
    try {
        const cron = require("node-cron");
        if (!cron.validate(cronSpec)) throw new Error(`Invalid cron: ${cronSpec}`);
        cron.schedule(cronSpec, async () => {
            const sc = _schedules.find(s => s.scheduleId === scheduleId);
            if (!sc || !sc.active) return;
            sc.lastRunAt = new Date().toISOString();
            sc.runCount++;
            _saveSchedules();
            // Auto-generate one task of this type from templates
            const templates = TASK_SPECS[type];
            if (templates && templates.length) {
                const spec = templates[Math.floor(Math.random() * templates.length)];
                createTask(type, { ...spec, source: "scheduled" });
                await dispatchPending({ limit: 5, type });
            }
        });
        logger.info(`[OoplixAuto] Scheduled ${type} — cron: ${cronSpec}`);
    } catch (e) {
        logger.warn(`[OoplixAuto] Could not register cron for ${scheduleId}: ${e.message}`);
    }

    auditLog.append({ type: "ooplix_schedule_create", scheduleId, taskType: type, cronSpec });
    return { scheduleId, type, cronSpec };
}

/** Record and persist influence data for a completed task. */
function recordInfluence(taskId, influence = {}) {
    const idx = _tasks.findIndex(t => t.taskId === taskId);
    if (idx < 0) throw new Error(`Task ${taskId} not found`);

    const task   = _tasks[idx];
    const coeffs = INFLUENCE_COEFFS[task.type] || {};
    const rec = {
        influenceId: `inf_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        taskId,
        taskType:     task.type,
        ts:           new Date().toISOString(),
        // Use provided values or estimate from coefficients
        revenue:      influence.revenue  ?? coeffs.revenue  ?? 0,
        traffic:      influence.traffic  ?? coeffs.traffic  ?? 0,
        support:      influence.support  ?? coeffs.support  ?? 0,
        notes:        influence.notes    || "auto-estimated",
        source:       influence.source   || "estimated",
    };
    _influence.push(rec);
    _saveInfluence();

    _tasks[idx].status      = "completed";
    _tasks[idx].completedAt = new Date().toISOString();
    _tasks[idx].influenceId = rec.influenceId;
    _saveTasks();

    // Store in memory persistence for cross-agent recall
    try {
        const mpl = require("./memoryPersistenceLayer.cjs");
        mpl.save({ key: `[Ooplix] ${task.title}`, value: { taskId, type: task.type, revenue: rec.revenue, traffic: rec.traffic, support: rec.support }, type: "metric", tags: [task.type, "ooplix_influence"], importance: 70, confidence: rec.source === "estimated" ? 60 : 90 });
    } catch { /* non-critical */ }

    return { ...rec };
}

function getTask(taskId) {
    return _tasks.find(t => t.taskId === taskId) || null;
}

function listTasks({ type, status, limit = 100, offset = 0 } = {}) {
    let rows = [..._tasks].reverse();
    if (type)   rows = rows.filter(t => t.type   === type);
    if (status) rows = rows.filter(t => t.status === status);

    const byType = {};
    for (const t of _tasks) { byType[t.type] = (byType[t.type] || 0) + 1; }

    const stats = {
        total:      _tasks.length,
        pending:    _tasks.filter(t => t.status === "pending").length,
        dispatched: _tasks.filter(t => t.status === "dispatched").length,
        completed:  _tasks.filter(t => t.status === "completed").length,
        failed:     _tasks.filter(t => t.status === "failed").length,
        byType,
    };
    return { tasks: rows.slice(offset, offset + limit), total: rows.length, stats };
}

/** Aggregate influence report. */
function getInfluenceReport({ type, since, limit = 200 } = {}) {
    let rows = [..._influence];
    if (type)  rows = rows.filter(r => r.taskType === type);
    if (since) rows = rows.filter(r => r.ts >= since);
    rows = rows.slice(-limit);

    const totals = rows.reduce((a, r) => ({
        revenue: a.revenue + (r.revenue || 0),
        traffic: a.traffic + (r.traffic || 0),
        support: a.support + (r.support || 0),
    }), { revenue: 0, traffic: 0, support: 0 });

    const byType = {};
    for (const r of rows) {
        if (!byType[r.taskType]) byType[r.taskType] = { revenue: 0, traffic: 0, support: 0, count: 0 };
        byType[r.taskType].revenue += r.revenue || 0;
        byType[r.taskType].traffic += r.traffic || 0;
        byType[r.taskType].support += r.support || 0;
        byType[r.taskType].count++;
    }

    return {
        report: {
            totalRevenue: Math.round(totals.revenue * 100) / 100,
            totalTraffic: totals.traffic,
            totalSupportDeflected: totals.support,
            byType,
            entries: rows.slice(-50),
            recordCount: rows.length,
        },
    };
}

/**
 * Full autonomous cycle:
 * 1. Generate one task per type from templates
 * 2. Dispatch all pending tasks
 * 3. Record estimated influence for any now-completed dispatched tasks
 */
async function runAutonomousCycle() {
    logger.info("[OoplixAuto] Running autonomous cycle...");
    const created = [];
    for (const type of ["content","seo","support","marketing"]) {
        const templates = TASK_SPECS[type];
        if (!templates) continue;
        // Pick the next template round-robin by counting existing tasks of this type
        const existingCount = _tasks.filter(t => t.type === type).length;
        const spec = templates[existingCount % templates.length];
        const task = createTask(type, { ...spec, source: "autonomous_cycle" });
        created.push(task.taskId);
    }

    const { dispatched, errors } = await dispatchPending({ limit: 20 });

    // Record estimated influence for dispatched tasks
    for (const d of dispatched) {
        try { recordInfluence(d.taskId); } catch { /* task may not be completable synchronously */ }
    }

    auditLog.append({ type: "ooplix_autonomous_cycle", created: created.length, dispatched: dispatched.length });
    logger.info(`[OoplixAuto] Cycle done: created=${created.length} dispatched=${dispatched.length} errors=${errors.length}`);
    return { created, dispatched, errors };
}

module.exports = { createTask, dispatchPending, scheduleRecurring, getTask, listTasks, recordInfluence, getInfluenceReport, runAutonomousCycle, TASK_SPECS };
