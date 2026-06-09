"use strict";
/**
 * Project Runner — multi-step engineering project execution.
 *
 * Entry points:
 *   runProject(goal, opts)    — decompose → classify specialists → parallel waves → coordinator → deploy
 *   pauseProject(projectId)   — signal executor to stop after the current wave
 *   resumeProject(projectId)  — continue from first incomplete wave
 *   cancelProject(projectId)  — permanently cancel; marks all pending tasks cancelled
 *   getProject(projectId)     — retrieve a stored project run by id
 *   listProjects(opts)        — list recent project runs
 *
 * Reuses:
 *   - pipelineOrchestrator.run()   (Plan → Code → Patch → Apply → Test → Review → Deploy)
 *   - pipelineOrchestrator.deploy()
 *   - aiService.callAI()           (Groq, same as planner and reviewer)
 *
 * Specialist coordination model:
 *   After decomposition, each task is classified into a specialist domain:
 *     frontend  — UI components, CSS, client-side JS, React/Vue/templates
 *     backend   — API routes, server logic, middleware, services
 *     database  — schemas, migrations, queries, ORM models
 *     devops    — CI config, Dockerfiles, deploy scripts, infra
 *     general   — anything that doesn't fit a specific domain
 *
 *   The specialist label is stamped on each plan task and injected as a
 *   context prefix into the pipeline request so the code generator and
 *   reviewer receive domain-appropriate framing.
 *
 *   After all waves complete, a coordinator AI call reviews all task results
 *   together and makes a go/no-go deploy decision with a cross-domain assessment.
 *
 * Parallel execution model — wave scheduling:
 *   Tasks are grouped into waves by dependency depth.
 *   Wave 0: tasks with no dependencies  → run with Promise.all
 *   Wave 1: tasks whose deps are in wave 0 → run with Promise.all after wave 0 settles
 *   Wave N: tasks whose deps are all in waves 0..N-1
 *
 *   Within a wave, tasks targeting the same file are serialised (safe-exec guard)
 *   to prevent concurrent writes to the same path.
 *
 *   Between waves the pause/cancel signal is checked (disk read).
 *   Failure from any task in wave N propagates to dependents in wave N+1+.
 *
 * Storage: data/project-runs.json  (max 50 runs, newest-first, atomic write)
 *
 * Run shape (stored fields):
 *   projectId, projectName, goal
 *   projectStatus : "running" | "paused" | "completed" | "cancelled"
 *   ok            : boolean (true only when all tasks completed successfully)
 *   summary       : human-readable one-liner
 *   startedAt, completedAt, elapsedMs
 *   taskCount, completed, failed, skipped
 *   tests         : { pass, fail }
 *   reviews       : aggregated verdict string
 *   deployOpts, finalDeploy
 *   plan          : original decomposed tasks [ { seq, request, description, dependsOn, specialist } ]
 *   tasks         : execution results         [ { seq, status, specialist, error, trace, startedAt, completedAt } ]
 *   waves         : [ { waveIndex, seqs, parallelCount, elapsedMs } ]  — execution schedule
 *   coordinator   : { verdict, deploy, risks, summary, perSpecialist }  — cross-domain review
 */

const fs   = require("fs");
const path = require("path");

// ── Lazy loaders ──────────────────────────────────────────────────
function _pipeline() { return require("./pipelineOrchestrator.cjs"); }
function _ai()       { return require("../../backend/services/aiService"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/project-runs.json");
const MAX_RUNS   = 50;

function _loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveStore(runs) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persist(run) {
    const runs = _loadStore();
    const idx  = runs.findIndex(r => r.projectId === run.projectId);
    if (idx !== -1) runs[idx] = run;
    else runs.unshift(run);
    _saveStore(runs);
}

// Read the current projectStatus from disk for the given projectId.
// Used by the executor between tasks to detect a pause signal.
function _readStatus(projectId) {
    const run = _loadStore().find(r => r.projectId === projectId);
    return run?.projectStatus ?? null;
}

// ── Specialist classifier ─────────────────────────────────────────
// Assigns a specialist domain to each task using file path + description heuristics.
// Pure function — no AI call. Fast, deterministic, zero latency.
//
// Domains: frontend | backend | database | devops | general
const SPECIALIST_RULES = [
    { domain: "frontend",  patterns: [/frontend\//, /\/ui\//, /\/components?\//, /\.(jsx|tsx|vue|svelte|css|scss|sass|less)$/, /App\.[jt]sx?$/, /pages?\//, /views?\//] },
    { domain: "database",  patterns: [/\/db\//, /\/models?\//, /\/migrations?\//, /\/schema/, /sequelize/, /prisma/, /knex/, /mongoose/, /\.sql$/] },
    { domain: "devops",    patterns: [/Dockerfile/, /docker-compose/, /\.github\//, /\/ci\//, /ecosystem\.config/, /deploy\.sh/, /nginx/, /Makefile/, /\.ya?ml$/] },
    { domain: "backend",   patterns: [/backend\//, /\/routes?\//, /\/middleware\//, /\/controllers?\//, /\/services?\//, /\/api\//, /server\.[jt]s/, /app\.[jt]s/] },
];

function _classifySpecialist(task) {
    const target = task.request + " " + (task.description || "");
    for (const { domain, patterns } of SPECIALIST_RULES) {
        if (patterns.some(p => p.test(target))) return domain;
    }
    return "general";
}

// ── Specialist context prefixes ───────────────────────────────────
// Injected at the front of each pipeline request so the code generator
// and reviewer receive domain-appropriate framing without touching the pipeline.
const SPECIALIST_PREFIX = {
    frontend: "You are a frontend specialist. Focus on UI correctness, accessibility, and component design. ",
    backend:  "You are a backend specialist. Focus on API correctness, security, and request handling. ",
    database: "You are a database specialist. Focus on schema integrity, query efficiency, and data safety. ",
    devops:   "You are a DevOps specialist. Focus on reliability, reproducibility, and deployment safety. ",
    general:  "",
};

// ── Coordinator review ────────────────────────────────────────────
// After all tasks complete, calls Groq once to review ALL results together.
// Produces a cross-domain assessment and a go/no-go deploy verdict.
// Non-fatal — if the coordinator fails, the run still completes with the task results.
const COORDINATOR_SYSTEM =
    "You are a senior engineering coordinator. You receive the results of a multi-specialist " +
    "engineering project and must decide whether it is safe to deploy. " +
    "Return ONLY valid JSON with these exact fields:\n" +
    '  "verdict"       : "DEPLOY" | "HOLD" | "ROLLBACK"\n' +
    '  "deploy"        : boolean — true if safe to proceed with deployment\n' +
    '  "risks"         : array of risk strings across all specialist domains (empty if none)\n' +
    '  "summary"       : one sentence overall cross-domain assessment\n' +
    '  "perSpecialist" : object mapping specialist domain → one-line verdict string\n' +
    "Rules: DEPLOY when all tasks succeeded; HOLD when some failed but no rollback needed; " +
    "ROLLBACK when failures risk data loss or a broken production state.";

async function _coordinatorReview(projectName, goal, taskResults) {
    const ai = _ai();

    // Build a compact summary of each task for the coordinator prompt
    const taskBlock = taskResults.map(r => {
        const specialist = r.specialist || "general";
        const verdict    = r.trace?.stages?.review?.verdict ?? "—";
        const tests      = r.trace?.stages?.test
            ? `${r.trace.stages.test.pass}pass/${r.trace.stages.test.fail}fail`
            : "—";
        return `  [${specialist}] Task ${r.seq} (${r.status}): ${r.description} | tests:${tests} | review:${verdict}${r.error ? ` | error:${r.error.slice(0, 80)}` : ""}`;
    }).join("\n");

    const prompt =
        `PROJECT: ${projectName}\nGOAL: ${goal}\n\n` +
        `TASK RESULTS (${taskResults.length} tasks):\n${taskBlock}\n\n` +
        `Assess all results across specialist domains and return JSON.`;

    const raw     = await ai.callAI(prompt, { system: COORDINATOR_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    try {
        return { ok: true, ...JSON.parse(cleaned) };
    } catch {
        return {
            ok:            true,
            verdict:       "HOLD",
            deploy:        false,
            risks:         ["Coordinator response could not be parsed"],
            summary:       raw.slice(0, 200),
            perSpecialist: {},
        };
    }
}

// ── Decomposer ────────────────────────────────────────────────────
const DECOMPOSE_SYSTEM =
    "You are a senior engineering project planner. The user describes a multi-step software project. " +
    "Break it into an ordered list of atomic, single-file engineering tasks. " +
    "Each task must reference exactly one file and describe one change. " +
    "Return ONLY valid JSON — an object with two fields:\n" +
    '  "projectName" : short name for this project (string, max 60 chars)\n' +
    '  "tasks"       : ordered array of task objects, each with:\n' +
    '      "seq"         : integer sequence number starting at 1\n' +
    '      "request"     : self-contained natural-language pipeline request (include the file path)\n' +
    '      "description" : one sentence describing what this task does\n' +
    '      "dependsOn"   : array of seq numbers this task depends on (empty if no deps)\n' +
    "Rules: maximum 10 tasks. Prefer fewer, larger tasks over many tiny ones. " +
    "Only include tasks that require actual code changes — no documentation-only tasks unless asked. " +
    'Example: {"projectName":"Add JWT auth","tasks":[{"seq":1,"request":"Add JWT verification middleware to backend/middleware/auth.js","description":"Create the auth middleware module","dependsOn":[]},{"seq":2,"request":"Apply the JWT middleware to protected routes in backend/routes/api.js","description":"Wire middleware into route definitions","dependsOn":[1]}]}';

async function _decompose(goal) {
    const ai  = _ai();
    const raw = await ai.callAI(goal, { system: DECOMPOSE_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    let plan;
    try { plan = JSON.parse(cleaned); } catch {
        throw new Error(`[Project:Decompose] AI returned invalid JSON: ${cleaned.slice(0, 120)}`);
    }

    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
        throw new Error("[Project:Decompose] No tasks returned. Refine your project description.");
    }
    if (plan.tasks.length > 10) plan.tasks = plan.tasks.slice(0, 10);

    plan.tasks = plan.tasks.map((t, i) => {
        const base = {
            seq:         typeof t.seq === "number" ? t.seq : i + 1,
            request:     (t.request || "").trim(),
            description: (t.description || "").trim(),
            dependsOn:   Array.isArray(t.dependsOn) ? t.dependsOn : [],
        };
        base.specialist = _classifySpecialist(base);
        return base;
    });

    return {
        projectName: (plan.projectName || goal.slice(0, 60)).trim(),
        tasks:       plan.tasks,
    };
}

// ── Wave builder ─────────────────────────────────────────────────
// Groups tasks into dependency waves. Wave 0 has no deps; wave N depends
// only on tasks in waves 0..N-1. Tasks not reachable (cyclic deps) go last.
//
// Returns: [ [task, task, …], [task, …], … ]  — ordered waves, each is an array of tasks.
function _buildWaves(planTasks) {
    const seqToTask  = new Map(planTasks.map(t => [t.seq, t]));
    const assigned   = new Map();   // seq → waveIndex

    function waveOf(seq) {
        if (assigned.has(seq)) return assigned.get(seq);
        const task = seqToTask.get(seq);
        if (!task || task.dependsOn.length === 0) { assigned.set(seq, 0); return 0; }
        const maxDepWave = Math.max(...task.dependsOn.map(d => waveOf(d)));
        const w = maxDepWave + 1;
        assigned.set(seq, w);
        return w;
    }

    for (const t of planTasks) waveOf(t.seq);

    const maxWave = Math.max(0, ...assigned.values());
    const waves   = Array.from({ length: maxWave + 1 }, () => []);
    for (const t of planTasks) waves[assigned.get(t.seq)].push(t);
    return waves;
}

// ── Single-task runner ────────────────────────────────────────────
// Executes one task through pipelineOrchestrator.run().
// Injects the specialist context prefix into the request before passing it
// to the pipeline — gives the code generator and reviewer domain framing.
async function _runOne(task, totalCount, opts, onProgress) {
    const pipeline   = _pipeline();
    const specialist = task.specialist || "general";
    const prefix     = SPECIALIST_PREFIX[specialist] ?? "";
    const enriched   = prefix ? `${prefix}\n${task.request}` : task.request;

    const startedAt  = new Date().toISOString();
    onProgress?.({ seq: task.seq, status: "running", specialist, description: task.description, startedAt });
    console.log(`[Project:Task ${task.seq}/${totalCount}] [${specialist}] START — ${task.description}`);

    let trace = null, status = "failed", errorMsg = null;
    try {
        trace  = await pipeline.run(enriched, {
            autoApply:    opts.autoApply    ?? true,
            autoRollback: opts.autoRollback ?? true,
            autoDeploy:   opts.autoDeploy   ?? false,
            testCommand:  opts.testCommand,
            operatorId:   `${specialist}-specialist`,
        });
        status   = trace.ok ? "completed" : "failed";
        if (!trace.ok) errorMsg = trace.summary;
    } catch (err) {
        errorMsg = err.message;
    }

    const result = {
        seq: task.seq, request: task.request, description: task.description,
        specialist,
        status, error: errorMsg, trace,
        startedAt, completedAt: new Date().toISOString(),
    };
    onProgress?.(result);
    console.log(`[Project:Task ${task.seq}] [${specialist}] ${status.toUpperCase()} — ${trace?.summary || errorMsg || ""}`);
    return result;
}

// ── Wave executor ─────────────────────────────────────────────────
// Runs tasks wave by wave. Within each wave, independent tasks run in parallel
// via Promise.all. Tasks targeting the same file are serialised within the wave
// (safe-exec guard: pipelineOrchestrator.run writes to disk).
//
// Between waves: checks projectStatus on disk (stops if "paused" or "cancelled").
// Failure in wave N propagates to dependents in wave N+1+ as "skipped".
//
// @param {string}   projectId
// @param {object[]} planTasks    — full plan (seq, request, description, dependsOn)
// @param {object[]} priorResults — prior completed results (for resume)
// @param {object}   opts
// @param {Function} onProgress
//
// @returns {{ results, waveLog, pausedAtWave }}
async function _executeTasks(projectId, planTasks, priorResults, opts, onProgress) {
    const results    = [...priorResults];
    const failedSeqs = new Set(priorResults.filter(r => r.status === "failed" || r.status === "skipped").map(r => r.seq));
    const doneSeqs   = new Set(priorResults.map(r => r.seq));
    const waveLog    = [];
    let   pausedAtWave = null;

    const waves      = _buildWaves(planTasks);
    const totalCount = planTasks.length;

    for (let wi = 0; wi < waves.length; wi++) {
        // ── Between-wave pause/cancel check ───────────────────────
        const currentStatus = _readStatus(projectId);
        if (currentStatus === "paused" || currentStatus === "cancelled") {
            pausedAtWave = wi;
            console.log(`[Project:Wave ${wi}] HALTED — project status is "${currentStatus}"`);
            break;
        }

        // ── Partition wave into runnable vs blocked/done ──────────
        const waveTasks = waves[wi];
        const toRun     = [];
        for (const task of waveTasks) {
            if (doneSeqs.has(task.seq)) continue;   // already done in prior run

            const blockedBy = task.dependsOn.filter(dep => failedSeqs.has(dep));
            if (blockedBy.length > 0) {
                const skipped = {
                    seq: task.seq, request: task.request, description: task.description,
                    status: "skipped",
                    skippedBecause: `dependency seq(${blockedBy.join(",")}) failed`,
                    error: null, trace: null, startedAt: null, completedAt: null,
                };
                results.push(skipped);
                doneSeqs.add(task.seq);
                failedSeqs.add(task.seq);
                onProgress?.(skipped);
                console.log(`[Project:Task ${task.seq}] SKIPPED — blocked by seq(${blockedBy.join(",")})`);
            } else {
                toRun.push(task);
            }
        }

        if (toRun.length === 0) continue;

        // ── Safe-exec guard: group by target file ─────────────────
        // Tasks that touch the same file run sequentially within the wave;
        // tasks that touch different files run in parallel.
        const byFile  = new Map();
        const noFile  = [];
        for (const task of toRun) {
            // Extract file path from request with a simple heuristic
            const m = task.request.match(/\b([\w./-]+\.(?:js|cjs|mjs|jsx|ts|tsx|py|sh|json|yaml|yml))\b/i);
            if (m) {
                const f = m[1];
                if (!byFile.has(f)) byFile.set(f, []);
                byFile.get(f).push(task);
            } else {
                noFile.push(task);
            }
        }

        // Build parallel slots: one Promise per unique file (tasks within
        // the same file run sequentially inside that Promise).
        const waveStart = Date.now();
        console.log(`[Project:Wave ${wi}] ${toRun.length} task(s) — ${byFile.size + (noFile.length > 0 ? 1 : 0)} parallel slot(s)`);

        const slots = [];

        for (const [file, fileTasks] of byFile) {
            slots.push((async () => {
                const slotResults = [];
                for (const task of fileTasks) {
                    const r = await _runOne(task, totalCount, opts, onProgress);
                    slotResults.push(r);
                }
                return slotResults;
            })());
        }

        if (noFile.length > 0) {
            slots.push((async () => {
                const slotResults = [];
                for (const task of noFile) {
                    const r = await _runOne(task, totalCount, opts, onProgress);
                    slotResults.push(r);
                }
                return slotResults;
            })());
        }

        // ── Run wave in parallel, merge results ───────────────────
        const slotResults = await Promise.all(slots);
        const waveResults = slotResults.flat();
        const waveElapsed = Date.now() - waveStart;

        for (const r of waveResults) {
            results.push(r);
            doneSeqs.add(r.seq);
            if (r.status === "failed" || r.status === "skipped") failedSeqs.add(r.seq);
        }

        waveLog.push({
            waveIndex:     wi,
            seqs:          waveResults.map(r => r.seq),
            parallelCount: slots.length,
            elapsedMs:     waveElapsed,
            outcomes:      waveResults.map(r => ({ seq: r.seq, status: r.status })),
        });

        console.log(`[Project:Wave ${wi}] done in ${waveElapsed}ms — ${waveResults.filter(r => r.status === "completed").length}/${waveResults.length} succeeded`);
    }

    return { results, waveLog, pausedAtWave };
}

// ── Report builder ────────────────────────────────────────────────
function _buildCounts(results) {
    const completed = results.filter(r => r.status === "completed").length;
    const failed    = results.filter(r => r.status === "failed").length;
    const skipped   = results.filter(r => r.status === "skipped").length;
    const cancelled = results.filter(r => r.status === "cancelled").length;
    let totalPass = 0, totalFail = 0;
    for (const r of results) {
        totalPass += r.trace?.stages?.test?.pass ?? 0;
        totalFail += r.trace?.stages?.test?.fail ?? 0;
    }
    const reviewSummary = results
        .filter(r => r.trace?.stages?.review?.verdict)
        .map(r => `Task ${r.seq}: ${r.trace.stages.review.verdict}`)
        .join(", ") || "none";
    return { completed, failed, skipped, cancelled, totalPass, totalFail, reviewSummary };
}

function _buildSummary(counts, total, projectStatus, pausedAt) {
    const { completed, failed, skipped } = counts;
    if (projectStatus === "paused")    return `⏸ Paused after task ${pausedAt - 1 || "start"} — ${completed}/${total} completed`;
    if (projectStatus === "cancelled") return `✗ Cancelled — ${completed}/${total} completed before cancel`;
    if (failed === 0 && skipped === 0) return `✓ Project complete — ${completed}/${total} tasks succeeded, ${counts.totalPass} tests passed`;
    return `✗ Project partial — ${completed}/${total} succeeded, ${failed} failed, ${skipped} skipped`;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Run a multi-step engineering project.
 */
async function runProject(goal, opts = {}) {
    const projectId   = `proj_${Date.now()}`;
    const startedAt   = new Date().toISOString();
    const deployAtEnd = opts.deployAtEnd ?? true;

    // ── 1. DECOMPOSE (or accept pre-built plan from blueprintGenerator) ──
    // If opts.plan is provided (e.g. from runBlueprint), skip the AI decompose
    // call and use it directly. Specialist classification still runs per-task.
    let plan;
    if (Array.isArray(opts.plan) && opts.plan.length > 0) {
        const tasks = opts.plan.map((t, i) => {
            const base = {
                seq:         typeof t.seq === "number" ? t.seq : i + 1,
                request:     (t.request || "").trim(),
                description: (t.description || "").trim(),
                dependsOn:   Array.isArray(t.dependsOn) ? t.dependsOn : [],
            };
            base.specialist = t.specialist || _classifySpecialist(base);
            return base;
        });
        plan = { projectName: opts.projectName || goal.slice(0, 60), tasks };
        console.log(`[Project:${projectId}] "${plan.projectName}" — ${tasks.length} tasks (blueprint plan, skipping decompose)`);
        tasks.forEach(t => console.log(`[Project]   ${t.seq}. [${t.specialist}] ${t.description}`));
    } else {
        try {
            plan = await _decompose(goal);
            console.log(`[Project:${projectId}] "${plan.projectName}" — ${plan.tasks.length} tasks`);
            plan.tasks.forEach(t => console.log(`[Project]   ${t.seq}. ${t.description}`));
        } catch (err) {
            const run = {
                projectId, projectName: goal.slice(0, 60), goal,
                projectStatus: "completed", ok: false,
                summary: `Decompose failed: ${err.message}`,
                startedAt, completedAt: new Date().toISOString(), elapsedMs: 0,
                taskCount: 0, completed: 0, failed: 0, skipped: 0, cancelled: 0,
                tests: { pass: 0, fail: 0 }, reviews: "none",
                deployOpts: {}, finalDeploy: null, plan: [], tasks: [],
                decomposeError: err.message,
            };
            _persist(run);
            return run;
        }
    }

    // Persist the skeleton immediately so pause/cancel can find it
    const skeleton = {
        projectId, projectName: plan.projectName, goal,
        projectStatus: "running",
        ok: false, summary: "Running…",
        startedAt, completedAt: null, elapsedMs: null,
        taskCount: plan.tasks.length, completed: 0, failed: 0, skipped: 0, cancelled: 0,
        tests: { pass: 0, fail: 0 }, reviews: "none",
        deployOpts:  { autoDeploy: opts.autoDeploy ?? false, autoRollback: opts.autoRollback ?? true },
        finalDeploy: null,
        blueprintId: opts.blueprintId || null,
        plan:        plan.tasks,   // ← original plan preserved for resume
        tasks:       [],           // ← filled in as tasks complete
        waves:       [],           // ← wave execution log
    };
    _persist(skeleton);

    // ── 2. EXECUTE (parallel waves) ───────────────────────────────
    const { results, waveLog, pausedAtWave } = await _executeTasks(projectId, plan.tasks, [], opts, opts.onProgress);

    // ── 3. RELOAD status — may have been set to "paused" by pauseProject() ──
    const currentStatus = _readStatus(projectId) ?? "running";
    const isStopped     = currentStatus === "paused" || currentStatus === "cancelled";

    // ── 4. COORDINATOR REVIEW ─────────────────────────────────────
    // Runs after all waves settle. Reviews all task results together,
    // assesses cross-domain risks, and returns a go/no-go deploy verdict.
    // Non-fatal: coordinator failure never blocks the run from completing.
    let coordinator = null;
    const anySucceeded = results.some(r => r.status === "completed");
    if (!isStopped && anySucceeded) {
        try {
            console.log(`[Project:${projectId}] coordinator review…`);
            coordinator = await _coordinatorReview(plan.projectName, goal, results);
            console.log(`[Project:${projectId}] coordinator: ${coordinator.verdict} — ${coordinator.summary?.slice(0, 80)}`);
        } catch (err) {
            coordinator = { ok: false, error: err.message, verdict: "HOLD", deploy: false };
            console.log(`[Project:${projectId}] coordinator failed (non-fatal): ${err.message}`);
        }
    }

    // ── 5. FINAL DEPLOY ───────────────────────────────────────────
    // Deploy only when: not stopped, deployAtEnd is set, at least one task
    // succeeded, AND the coordinator says it's safe (verdict !== "HOLD"/"ROLLBACK").
    let finalDeploy = null;
    const coordinatorApproves = !coordinator || coordinator.deploy !== false;
    if (!isStopped && (opts.deployAtEnd ?? true) && anySucceeded && coordinatorApproves) {
        try {
            console.log(`[Project:${projectId}] running final deploy…`);
            finalDeploy = await _pipeline().deploy({
                autoRollback: opts.autoRollback ?? true,
                operatorId:   opts.operatorId ?? "project-runner",
            });
            console.log(`[Project:${projectId}] deploy ${finalDeploy.ok ? "healthy" : "FAILED"}`);
        } catch (err) {
            finalDeploy = { ok: false, error: err.message };
        }
    } else if (!isStopped && coordinator && !coordinatorApproves) {
        console.log(`[Project:${projectId}] deploy skipped — coordinator verdict: ${coordinator.verdict}`);
    }

    // ── 6. FINALIZE ───────────────────────────────────────────────
    const counts        = _buildCounts(results);
    const projectStatus = isStopped ? currentStatus : "completed";
    const completedAt   = new Date().toISOString();
    const summary       = _buildSummary(counts, plan.tasks.length, projectStatus, pausedAtWave);

    const run = {
        projectId, projectName: plan.projectName, goal,
        projectStatus,
        ok:          projectStatus === "completed" && counts.failed === 0 && counts.skipped === 0,
        summary:     finalDeploy ? `${summary} | Deploy: ${finalDeploy.ok ? "healthy" : "FAILED"}` : summary,
        startedAt, completedAt, elapsedMs: new Date(completedAt) - new Date(startedAt),
        taskCount:   plan.tasks.length,
        completed:   counts.completed,
        failed:      counts.failed,
        skipped:     counts.skipped,
        cancelled:   counts.cancelled,
        tests:       { pass: counts.totalPass, fail: counts.totalFail },
        reviews:     counts.reviewSummary,
        deployOpts:  { autoDeploy: opts.autoDeploy ?? false, autoRollback: opts.autoRollback ?? true },
        blueprintId: opts.blueprintId || null,
        coordinator,
        finalDeploy,
        plan:        plan.tasks,   // always preserved (with specialist field)
        tasks:       results,
        waves:       waveLog,
    };
    _persist(run);
    return run;
}

/**
 * Signal a running project to pause after its current task completes.
 * If the project is not running, returns an error.
 */
function pauseProject(projectId) {
    const runs = _loadStore();
    const idx  = runs.findIndex(r => r.projectId === projectId);
    if (idx === -1) return { ok: false, error: "project_not_found" };

    const run = runs[idx];
    if (run.projectStatus !== "running") {
        return { ok: false, error: `Cannot pause — project is "${run.projectStatus}"` };
    }

    run.projectStatus = "paused";
    run.summary = `⏸ Paused — ${run.completed}/${run.taskCount} completed`;
    _saveStore(runs);

    const pending = (run.plan || []).filter(t => !(run.tasks || []).some(r => r.seq === t.seq));
    console.log(`[Project:${projectId}] paused — ${pending.length} tasks remain`);
    return { ok: true, projectId, projectStatus: "paused", pendingTasks: pending.length };
}

/**
 * Resume a paused project from the first non-completed task.
 * Reuses the original plan and all prior results — no re-decomposition.
 */
async function resumeProject(projectId, opts = {}) {
    const run = _loadStore().find(r => r.projectId === projectId);
    if (!run)                           return { ok: false, error: "project_not_found" };
    if (run.projectStatus === "completed") return { ok: false, error: "Project already completed" };
    if (run.projectStatus === "cancelled") return { ok: false, error: "Cannot resume a cancelled project" };
    if (run.projectStatus === "running")   return { ok: false, error: "Project is already running" };
    if (!Array.isArray(run.plan) || run.plan.length === 0) {
        return { ok: false, error: "No plan found — this project cannot be resumed (missing plan)" };
    }

    // Mark running again so new pause signals work
    const runs = _loadStore();
    const idx  = runs.findIndex(r => r.projectId === projectId);
    runs[idx].projectStatus = "running";
    runs[idx].summary       = "Resuming…";
    _saveStore(runs);

    const priorResults = run.tasks || [];
    const pendingSeqs  = new Set(
        run.plan
            .filter(t => !priorResults.some(r => r.seq === t.seq))
            .map(t => t.seq)
    );

    console.log(`[Project:${projectId}] resuming — ${pendingSeqs.size} tasks remaining`);
    run.plan.forEach(t => {
        const state = priorResults.find(r => r.seq === t.seq)?.status ?? "pending";
        console.log(`[Project]   ${t.seq}. [${state}] ${t.description}`);
    });

    const deployAtEnd = opts.deployAtEnd ?? true;

    // ── Execute remaining tasks (parallel waves) ──────────────────
    const { results, waveLog, pausedAtWave } = await _executeTasks(
        projectId,
        run.plan,        // full original plan (executor skips already-done seqs)
        priorResults,    // inject prior results so failure propagation is correct
        opts,
        opts.onProgress,
    );

    const currentStatus = _readStatus(projectId) ?? "running";
    const isStopped     = currentStatus === "paused" || currentStatus === "cancelled";

    // ── Coordinator review (after resume) ────────────────────────
    let coordinator = run.coordinator || null;
    const newSuccesses = results.filter(r => pendingSeqs.has(r.seq) && r.status === "completed").length;
    if (!isStopped && newSuccesses > 0) {
        try {
            console.log(`[Project:${projectId}] coordinator review after resume…`);
            coordinator = await _coordinatorReview(run.projectName, run.goal, results);
            console.log(`[Project:${projectId}] coordinator: ${coordinator.verdict}`);
        } catch (err) {
            coordinator = { ok: false, error: err.message, verdict: "HOLD", deploy: false };
        }
    }

    // ── Final deploy ──────────────────────────────────────────────
    let finalDeploy = run.finalDeploy || null;
    const coordinatorApproves = !coordinator || coordinator.deploy !== false;
    if (!isStopped && deployAtEnd && newSuccesses > 0 && coordinatorApproves) {
        try {
            console.log(`[Project:${projectId}] running final deploy after resume…`);
            finalDeploy = await _pipeline().deploy({
                autoRollback: opts.autoRollback ?? true,
                operatorId:   opts.operatorId ?? "project-runner",
            });
            console.log(`[Project:${projectId}] deploy ${finalDeploy.ok ? "healthy" : "FAILED"}`);
        } catch (err) {
            finalDeploy = { ok: false, error: err.message };
        }
    }

    // ── Finalize ──────────────────────────────────────────────────
    const counts        = _buildCounts(results);
    const projectStatus = isStopped ? currentStatus : "completed";
    const completedAt   = new Date().toISOString();
    const summary       = _buildSummary(counts, run.plan.length, projectStatus, pausedAtWave);

    const updated = {
        ...run,
        projectStatus,
        ok:          projectStatus === "completed" && counts.failed === 0 && counts.skipped === 0,
        summary:     finalDeploy ? `${summary} | Deploy: ${finalDeploy.ok ? "healthy" : "FAILED"}` : summary,
        completedAt,
        elapsedMs:   (run.elapsedMs || 0) + (new Date(completedAt) - new Date(runs[idx]?.startedAt || run.startedAt)),
        completed:   counts.completed,
        failed:      counts.failed,
        skipped:     counts.skipped,
        cancelled:   counts.cancelled,
        tests:       { pass: counts.totalPass, fail: counts.totalFail },
        reviews:     counts.reviewSummary,
        coordinator,
        finalDeploy,
        tasks:       results,
        waves:       [...(run.waves || []), ...waveLog],
    };
    _persist(updated);
    return updated;
}

/**
 * Cancel a project — marks all pending tasks as cancelled.
 * A running project is paused first (the executor will stop at next check).
 */
function cancelProject(projectId) {
    const runs = _loadStore();
    const idx  = runs.findIndex(r => r.projectId === projectId);
    if (idx === -1) return { ok: false, error: "project_not_found" };

    const run = runs[idx];
    if (run.projectStatus === "completed") return { ok: false, error: "Project already completed — nothing to cancel" };
    if (run.projectStatus === "cancelled") return { ok: false, error: "Project already cancelled" };

    // Mark all pending (not yet in tasks[]) as cancelled
    const doneSeqs   = new Set((run.tasks || []).map(r => r.seq));
    const cancelled  = (run.plan || [])
        .filter(t => !doneSeqs.has(t.seq))
        .map(t => ({
            seq:         t.seq,
            request:     t.request,
            description: t.description,
            status:      "cancelled",
            error:       null,
            trace:       null,
            startedAt:   null,
            completedAt: new Date().toISOString(),
        }));

    run.tasks         = [...(run.tasks || []), ...cancelled];
    run.projectStatus = "cancelled";
    run.cancelled     = cancelled.length;
    run.summary       = `✗ Cancelled — ${run.completed || 0}/${run.taskCount} completed, ${cancelled.length} cancelled`;
    run.completedAt   = new Date().toISOString();

    _saveStore(runs);
    console.log(`[Project:${projectId}] cancelled — ${cancelled.length} tasks discarded`);
    return { ok: true, projectId, projectStatus: "cancelled", cancelledTasks: cancelled.length };
}

/** Retrieve a project run by id. */
function getProject(projectId) {
    return _loadStore().find(r => r.projectId === projectId) || null;
}

/**
 * List recent project runs.
 * @param {object} opts
 * @param {number} opts.limit        — max results (default 20)
 * @param {string} opts.projectStatus — filter by status: "running"|"paused"|"completed"|"cancelled"
 */
function listProjects({ limit = 20, status, projectStatus } = {}) {
    let runs = _loadStore();
    // Support both old `status` (ok/failed boolean) and new `projectStatus` filter
    if (projectStatus) runs = runs.filter(r => r.projectStatus === projectStatus);
    else if (status === "ok")     runs = runs.filter(r => r.ok);
    else if (status === "failed") runs = runs.filter(r => !r.ok);
    return runs.slice(0, limit).map(r => ({
        projectId:     r.projectId,
        projectName:   r.projectName,
        projectStatus: r.projectStatus,
        ok:            r.ok,
        summary:       r.summary,
        taskCount:     r.taskCount,
        completed:     r.completed,
        failed:        r.failed,
        skipped:       r.skipped,
        cancelled:     r.cancelled,
        startedAt:     r.startedAt,
        completedAt:   r.completedAt,
        elapsedMs:     r.elapsedMs,
    }));
}

module.exports = { runProject, pauseProject, resumeProject, cancelProject, getProject, listProjects };
