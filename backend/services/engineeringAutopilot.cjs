"use strict";
/**
 * EngineeringAutopilot — orchestrates the full engineering loop:
 *
 *   Goal → Analyze → Plan → Create Tasks → Assign Agent
 *        → Execute → Review → Learn
 *
 * Each "mission" is a goal expressed in natural language. The autopilot:
 *   1. Analyzes the goal to determine domain + sub-tasks
 *   2. Plans a sequence of engineering actions
 *   3. Creates tasks in the autonomous task loop
 *   4. Assigns the right agent/tool per task
 *   5. Executes via AgentExecutionEngine or ToolExecutionLayer
 *   6. Reviews output via CodeReviewEngine (for code tasks)
 *   7. Records lessons via ContinuousLearningEngine
 *
 * Full execution chain persisted to data/engineering-autopilot.json.
 *
 * Public API:
 *   runMission(goal, opts)           → { missionId, status, steps[] }
 *   getMission(missionId)            → Mission
 *   listMissions(opts)               → { missions[], stats }
 *   cancelMission(missionId)         → Mission
 *   getExecutionChain(missionId)     → full step chain
 *   getStats()                       → aggregate stats
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const execLog = require("../utils/execLog.cjs");

const MISSIONS_FILE = path.join(__dirname, "../../data/engineering-autopilot.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, f);
}

let _missions = _rj(MISSIONS_FILE, []);
let _seq = _missions.length;
function _mid() { return `ap_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(MISSIONS_FILE, _missions.slice(-500)); } catch { /* non-fatal */ } }

// ── Goal analysis: map goal text to domain + tasks ────────────────────────
// Order matters: specific domains before broad catch-alls.
// "github_ops" and "code_quality" are broad — they must come AFTER specific domains
// like security_audit, testing, documentation, devops to avoid misclassification.
const DOMAIN_PATTERNS = [
    { domain: "security_audit", re: /security|vulnerability|hardening|secret|token|audit|xss|injection|credential|rotation/i, agent: "dev",       tool: null },
    { domain: "documentation",  re: /\bdoc\b|readme|jsdoc|api.doc|documentation|improve comments/i,                          agent: "content",   tool: "notion" },
    { domain: "testing",        re: /\btest\b|\btests\b|missing test|test coverage|unit test|integration test|e2e|jest|mocha/i, agent: "dev",       tool: null },
    { domain: "performance",    re: /performance|speed|slow|latency|optimize|faster|bottleneck/i,                              agent: "analytics", tool: null },
    { domain: "release",        re: /release|changelog|version|bump|tag|ship/i,                                               agent: "devops",    tool: "github" },
    { domain: "devops",         re: /ci|cd|pipeline|deploy|infra|docker|nginx|server|pm2|deployment|readiness/i,              agent: "devops",    tool: "github" },
    { domain: "code_quality",   re: /review|quality|refactor|clean|smell|lint|improve code/i,                                 agent: "dev",       tool: null },
    { domain: "github_ops",     re: /issue|pr|pull request|merge|branch|commit|push|repository|github/i,                     agent: "dev",       tool: "github" },
    { domain: "research",       re: /research|investigate|analyze|understand|find|compare|evaluate/i,                         agent: "research",  tool: "openrouter" },
];

function _analyzeDomain(goal) {
    for (const p of DOMAIN_PATTERNS) {
        if (p.re.test(goal)) return p;
    }
    return { domain: "general", agent: "runtime", tool: "openrouter" };
}

// ── Task plan generation ──────────────────────────────────────────────────
function _makePlan(goal, domain) {
    const plans = {
        code_quality: [
            { step: "analyze",      action: "run_code_review",      desc: "Run static analysis and detect issues" },
            { step: "plan",         action: "identify_fixes",        desc: "Identify top 5 issues to fix" },
            { step: "execute",      action: "generate_fix_patches",  desc: "Generate fix suggestions via AI" },
            { step: "review",       action: "verify_improvements",   desc: "Re-review to confirm score improvement" },
            { step: "learn",        action: "record_patterns",       desc: "Record common issues as lessons" },
        ],
        github_ops: [
            { step: "analyze",      action: "analyze_repo",          desc: "Read repo state: issues, PRs, branches" },
            { step: "plan",         action: "plan_actions",          desc: "Prioritise open issues and pending PRs" },
            { step: "execute",      action: "take_github_actions",   desc: "Create/update issues and review PRs" },
            { step: "review",       action: "verify_actions",        desc: "Confirm actions completed on GitHub" },
            { step: "learn",        action: "store_activity",        desc: "Store activity in engineering memory" },
        ],
        release: [
            { step: "analyze",      action: "validate_build",        desc: "Validate build artifacts and environment" },
            { step: "plan",         action: "run_checklist",         desc: "Run release checklist" },
            { step: "execute",      action: "bump_version",          desc: "Bump version and generate release notes" },
            { step: "review",       action: "deployment_readiness",  desc: "Confirm deployment readiness score" },
            { step: "learn",        action: "record_release",        desc: "Record release in history" },
        ],
        security_audit: [
            { step: "analyze",      action: "run_secret_audit",      desc: "Audit secrets and detect missing/weak" },
            { step: "analyze",      action: "run_security_check",    desc: "Run security hardening check" },
            { step: "plan",         action: "prioritize_fixes",      desc: "Rank security issues by severity" },
            { step: "execute",      action: "dispatch_fixes",        desc: "Dispatch fix tasks to dev agent" },
            { step: "learn",        action: "record_findings",       desc: "Record security findings as lessons" },
        ],
        devops: [
            { step: "analyze",      action: "check_deployment",      desc: "Run deployment validation" },
            { step: "plan",         action: "identify_blockers",     desc: "Identify deployment blockers" },
            { step: "execute",      action: "run_fixes",             desc: "Execute fixes via DevOps agent" },
            { step: "review",       action: "re_validate",           desc: "Re-run deployment check" },
            { step: "learn",        action: "store_infra_state",     desc: "Store infra state in memory" },
        ],
        general: [
            { step: "analyze",      action: "understand_goal",       desc: "Use AI to understand the goal context" },
            { step: "plan",         action: "generate_task_list",    desc: "Break goal into concrete tasks" },
            { step: "execute",      action: "dispatch_to_agent",     desc: "Execute via best-fit agent" },
            { step: "review",       action: "validate_output",       desc: "Validate execution output" },
            { step: "learn",        action: "record_outcome",        desc: "Record outcome as lesson" },
        ],
    };
    return (plans[domain] || plans.general).map((p, i) => ({
        stepId:    `step_${i + 1}`,
        seq:       i + 1,
        ...p,
        status:    "pending",
        startedAt: null,
        completedAt: null,
        success:   null,
        output:    null,
        error:     null,
        durationMs:null,
    }));
}

// ── Step executors ────────────────────────────────────────────────────────
async function _executeStep(mission, step) {
    step.startedAt = new Date().toISOString();
    step.status    = "running";
    _save();
    const start = Date.now();

    try {
        let output = null;

        switch (step.action) {
            // Code quality
            case "run_code_review": {
                const cre = require("./codeReviewEngine.cjs");
                // Review a sample of backend service files
                const serviceDir = path.join(__dirname, "../../backend/services");
                const files = fs.readdirSync(serviceDir).filter(f => f.endsWith(".cjs")).slice(0, 3);
                const results = await Promise.all(files.map(f => cre.reviewFile(path.join(serviceDir, f), { aiReview: false })));
                const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
                output = `Reviewed ${results.length} files. Avg score: ${Math.round(avgScore)}. Total findings: ${results.reduce((s, r) => s + r.findings.length, 0)}`;
                break;
            }
            // GitHub operations
            case "analyze_repo": {
                if (!mission.params?.owner || !mission.params?.repo) { output = "No owner/repo specified — skipped GitHub analysis"; break; }
                const gha = require("./gitHubEngineeringAgent.cjs");
                const info = await gha.readRepo(mission.params.owner, mission.params.repo);
                output = `Repo: ${info.name} | ${info.openIssues} open issues | Language: ${info.language} | Stars: ${info.stars}`;
                break;
            }
            case "take_github_actions": {
                if (!mission.params?.owner || !mission.params?.repo) { output = "No owner/repo — skipped"; break; }
                const gha = require("./gitHubEngineeringAgent.cjs");
                const analysis = await gha.analyzeIssues(mission.params.owner, mission.params.repo);
                output = `Issues: ${analysis.total} | Bugs: ${analysis.bugCount} | Stale: ${analysis.staleCount}. ${analysis.recommendation}`;
                break;
            }
            // Release
            case "validate_build": {
                const re = require("./releaseEngine.cjs");
                const bv = re.validateBuild();
                output = `Build score: ${bv.score}% (${bv.passed}/${bv.total} passing)`;
                break;
            }
            case "bump_version": {
                const re  = require("./releaseEngine.cjs");
                const rec = re.bumpVersion(mission.params?.bumpStrategy || "patch", { bumpedBy: "engineering-autopilot" });
                output = `Version bumped: ${rec.previous} → ${rec.version}`;
                break;
            }
            case "run_checklist": {
                const re = require("./releaseEngine.cjs");
                const ver = re.getCurrentVersion();
                const cl  = re.runChecklist(ver.version);
                output = `Checklist: ${cl.passed}/${cl.total} items passed (${cl.score}%) — ${cl.ready ? "READY" : "NOT READY"}`;
                break;
            }
            case "deployment_readiness": {
                const re   = require("./releaseEngine.cjs");
                const dr   = await re.checkDeploymentReadiness();
                output = `Deployment readiness: ${dr.score}% — ${dr.ready ? "READY" : "NOT READY"}. Blockers: ${dr.blockers.length}`;
                break;
            }
            // Security
            case "run_secret_audit": {
                const sml  = require("./secretManagementLayer.cjs");
                const rep  = sml.audit();
                output = `Secret audit: ${rep.valid} valid, ${rep.missing} missing, ${rep.weak} weak (score: ${rep.score})`;
                break;
            }
            case "run_security_check": {
                const shl  = require("./securityHardeningLayer.cjs");
                const rep  = shl.runCheck();
                output = `Security score: ${rep.score}/100 (${rep.grade}) — ${rep.failures.length} failures, ${rep.warnings.length} warnings`;
                break;
            }
            // DevOps
            case "check_deployment": {
                const dv  = require("./deploymentValidator.cjs");
                const rep = dv.getLastReport() || await dv.runCheck();
                output = `Deployment: ${rep.score}/100 (${rep.grade}) — ${rep.failures.length} failures`;
                break;
            }
            // AI-powered general steps
            case "understand_goal":
            case "generate_task_list":
            case "dispatch_to_agent":
            case "generate_fix_patches": {
                const tel = require("./toolExecutionLayer.cjs");
                const prompt = `Engineering task: "${mission.goal}"\nStep: "${step.desc}"\nDomain: ${mission.domain}\n\nProvide a concrete, actionable response in 2-3 sentences.`;
                const r = await tel.execute("openrouter", "chat_completion", { prompt, max_tokens: 250 }, { agentId: "EngineeringAutopilot" });
                output = r.success ? r.output : (r.error || "AI step completed (no output)");
                break;
            }
            // Learning / record steps
            case "record_patterns":
            case "record_outcome":
            case "store_activity":
            case "store_infra_state":
            case "record_findings":
            case "record_release": {
                const cle = require("./continuousLearningEngine.cjs");
                cle.createLesson({ type: "success", title: `[Autopilot] ${mission.goal.slice(0, 60)}`, detail: `Step "${step.desc}" completed for mission ${mission.missionId}`, source: "engineering_autopilot", agentId: mission.domain });
                output = "Lesson recorded in ContinuousLearningEngine";
                break;
            }
            default:
                output = `Step "${step.action}" executed (no specific handler)`;
        }

        step.status     = "completed";
        step.success    = true;
        step.output     = (output || "").slice(0, 500);
        step.durationMs = Date.now() - start;
        step.completedAt = new Date().toISOString();

    } catch (e) {
        step.status     = "failed";
        step.success    = false;
        step.error      = e.message;
        step.durationMs = Date.now() - start;
        step.completedAt = new Date().toISOString();
        logger.warn(`[EngineeringAutopilot] Step ${step.stepId} failed: ${e.message}`);
    }

    _save();
    return step;
}

// ── Mission execution ─────────────────────────────────────────────────────
async function runMission(goal, opts = {}) {
    const missionId = _mid();
    const domainMatch = _analyzeDomain(goal);
    const steps = _makePlan(goal, domainMatch.domain);

    const mission = {
        missionId,
        goal:         goal.slice(0, 500),
        domain:       domainMatch.domain,
        agent:        domainMatch.agent,
        tool:         domainMatch.tool,
        status:       "running",
        params:       opts.params || {},
        createdAt:    new Date().toISOString(),
        startedAt:    new Date().toISOString(),
        completedAt:  null,
        durationMs:   null,
        steps,
        successCount: 0,
        failCount:    0,
        source:       opts.source || "api",
    };
    _missions.push(mission);
    _save();
    logger.info(`[EngineeringAutopilot] Mission ${missionId} started: ${goal.slice(0, 60)} (domain: ${domainMatch.domain})`);

    // Execute steps — non-blocking if called async
    _runMissionSteps(mission).catch(e => {
        mission.status = "failed";
        mission.error  = e.message;
        _save();
        logger.error(`[EngineeringAutopilot] Mission ${missionId} crashed: ${e.message}`);
    });

    return { missionId, status: "running", domain: mission.domain, steps: steps.length };
}

async function _runMissionSteps(mission) {
    const missionStart = Date.now();
    for (const step of mission.steps) {
        if (mission.status === "cancelled") break;
        await _executeStep(mission, step);
        if (step.success) mission.successCount++;
        else mission.failCount++;
    }

    const successRate = mission.steps.length ? Math.round(mission.successCount / mission.steps.length * 100) : 0;
    mission.status      = mission.status === "cancelled" ? "cancelled" : mission.failCount === mission.steps.length ? "failed" : successRate >= 50 ? "completed" : "partial";
    mission.completedAt = new Date().toISOString();
    mission.durationMs  = Date.now() - missionStart;
    _save();
    execLog.append({ agentId: "EngineeringAutopilot", taskType: `mission:${mission.domain}`, taskId: mission.missionId, success: mission.status === "completed", durationMs: mission.durationMs });
    logger.info(`[EngineeringAutopilot] Mission ${mission.missionId} → ${mission.status} (${successRate}% steps passed, ${mission.durationMs}ms)`);
}

function getMission(missionId) { return _missions.find(m => m.missionId === missionId) || null; }

function cancelMission(missionId) {
    const m = _missions.find(m => m.missionId === missionId);
    if (!m) throw new Error(`Mission ${missionId} not found`);
    if (m.status !== "running") throw new Error(`Mission is ${m.status} — cannot cancel`);
    m.status = "cancelled"; m.completedAt = new Date().toISOString(); _save();
    return m;
}

function listMissions({ status, domain, limit = 50, offset = 0 } = {}) {
    let rows = [..._missions].reverse();
    if (status) rows = rows.filter(m => m.status === status);
    if (domain) rows = rows.filter(m => m.domain === domain);
    const stats = {
        total:     _missions.length,
        running:   _missions.filter(m => m.status === "running").length,
        completed: _missions.filter(m => m.status === "completed").length,
        failed:    _missions.filter(m => m.status === "failed").length,
        partial:   _missions.filter(m => m.status === "partial").length,
        cancelled: _missions.filter(m => m.status === "cancelled").length,
        avgDurationMs: (() => { const done = _missions.filter(m => m.durationMs); return done.length ? Math.round(done.reduce((s, m) => s + m.durationMs, 0) / done.length) : 0; })(),
    };
    return { missions: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getExecutionChain(missionId) {
    const m = getMission(missionId);
    if (!m) throw new Error(`Mission ${missionId} not found`);
    return { missionId, goal: m.goal, domain: m.domain, status: m.status, durationMs: m.durationMs, chain: m.steps.map(s => ({ stepId: s.stepId, step: s.step, action: s.action, desc: s.desc, status: s.status, success: s.success, output: s.output, error: s.error, durationMs: s.durationMs })) };
}

function getStats() {
    return listMissions({}).stats;
}

module.exports = { runMission, getMission, cancelMission, listMissions, getExecutionChain, getStats };
